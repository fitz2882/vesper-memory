import type { EmbeddingClient } from "../embeddings/client.js";
import type { WorkingMemoryLayer } from "../memory-layers/working-memory.js";
import type { HybridSearchEngine } from "./hybrid-search.js";

export type IndexOperation = "upsert" | "delete";
export type IndexState = "indexed" | "pending";

export interface IndexMutation {
  memoryId: string;
  operation: IndexOperation;
  namespace: string;
  content?: string;
  memoryType?: string;
  metadata?: Record<string, unknown>;
  agentId?: string;
  taskId?: string;
  createdAt: number;
}

interface IndexOutboxRow {
  memory_id: string;
  operation: IndexOperation;
  namespace: string;
  content: string | null;
  memory_type: string | null;
  metadata: string | null;
  agent_id: string | null;
  task_id: string | null;
  created_at: number;
  qdrant_pending: number;
  redis_pending: number;
  attempts: number;
  revision: number;
}

export interface IndexDrainStats {
  examined: number;
  completed: number;
  pending: number;
  errors: string[];
}

export function initializeIndexOutboxSchema(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_outbox (
      memory_id TEXT PRIMARY KEY,
      operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
      namespace TEXT NOT NULL,
      content TEXT,
      memory_type TEXT,
      metadata TEXT,
      agent_id TEXT,
      task_id TEXT,
      created_at INTEGER NOT NULL,
      qdrant_pending INTEGER NOT NULL DEFAULT 1,
      redis_pending INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_index_outbox_pending
      ON index_outbox(qdrant_pending, redis_pending, updated_at);
  `);

  const columns = db.prepare("PRAGMA table_info(index_outbox)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "revision")) {
    db.exec("ALTER TABLE index_outbox ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
  }
}

/**
 * Keeps Redis and Qdrant as rebuildable projections of canonical SQLite rows.
 * Enqueue methods are synchronous so callers can include them in a SQLite
 * transaction. Draining is best-effort and may be retried safely.
 */
export class IndexOutboxProcessor {
  private activeDrain?: Promise<IndexDrainStats>;
  private readonly desiredQdrantProjection: boolean;
  private readonly desiredRedisProjection: boolean;

  constructor(
    private readonly db: any,
    private readonly dependencies: {
      embeddingClient?: EmbeddingClient;
      hybridSearch?: HybridSearchEngine;
      workingMemory?: WorkingMemoryLayer;
      projectionConfig?: { qdrant: boolean; redis: boolean };
    }
  ) {
    this.desiredQdrantProjection =
      dependencies.projectionConfig?.qdrant ??
      Boolean(dependencies.embeddingClient && dependencies.hybridSearch);
    this.desiredRedisProjection =
      dependencies.projectionConfig?.redis ?? Boolean(dependencies.workingMemory);
  }

  enqueue(mutation: IndexMutation): void {
    const now = Date.now();
    const qdrantPending = this.desiredQdrantProjection ? 1 : 0;
    const redisPending = this.desiredRedisProjection ? 1 : 0;
    if (qdrantPending === 0 && redisPending === 0) {
      // SQLite + FTS are already canonical and synchronous. Do not report an
      // intentionally unconfigured projection as a permanent failed write.
      this.db.prepare("DELETE FROM index_outbox WHERE memory_id = ?").run(mutation.memoryId);
      return;
    }
    this.db
      .prepare(
        `
      INSERT INTO index_outbox (
        memory_id, operation, namespace, content, memory_type, metadata,
        agent_id, task_id, created_at, qdrant_pending, redis_pending,
        attempts, last_error, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        operation = excluded.operation,
        namespace = excluded.namespace,
        content = excluded.content,
        memory_type = excluded.memory_type,
        metadata = excluded.metadata,
        agent_id = excluded.agent_id,
        task_id = excluded.task_id,
        created_at = excluded.created_at,
        qdrant_pending = excluded.qdrant_pending,
        redis_pending = excluded.redis_pending,
        attempts = 0,
        last_error = NULL,
        revision = index_outbox.revision + 1,
        updated_at = excluded.updated_at
    `
      )
      .run(
        mutation.memoryId,
        mutation.operation,
        mutation.namespace,
        mutation.content ?? null,
        mutation.memoryType ?? null,
        JSON.stringify(mutation.metadata ?? {}),
        mutation.agentId ?? null,
        mutation.taskId ?? null,
        mutation.createdAt,
        qdrantPending,
        redisPending,
        now
      );
  }

  getState(memoryId: string): IndexState {
    const pending = this.db.prepare("SELECT 1 FROM index_outbox WHERE memory_id = ?").get(memoryId);
    return pending ? "pending" : "indexed";
  }

  getPendingCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM index_outbox").get() as {
      count: number;
    };
    return row.count;
  }

  drain(limit: number = 100): Promise<IndexDrainStats> {
    if (this.activeDrain) return this.activeDrain;
    const operation = this.performDrain(limit).finally(() => {
      if (this.activeDrain === operation) this.activeDrain = undefined;
    });
    this.activeDrain = operation;
    return operation;
  }

  private async performDrain(limit: number): Promise<IndexDrainStats> {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM index_outbox
      WHERE qdrant_pending = 1 OR redis_pending = 1
      ORDER BY updated_at ASC
      LIMIT ?
    `
      )
      .all(limit) as IndexOutboxRow[];

    const stats: IndexDrainStats = {
      examined: rows.length,
      completed: 0,
      pending: 0,
      errors: [],
    };

    for (const row of rows) {
      const errors: string[] = [];
      let qdrantPending = row.qdrant_pending === 1;
      let redisPending = row.redis_pending === 1;

      const hybridSearch = this.dependencies.hybridSearch;
      const qdrantReady =
        hybridSearch && (row.operation === "delete" || this.dependencies.embeddingClient);
      if (qdrantPending && qdrantReady) {
        try {
          if (row.operation === "delete") {
            await hybridSearch.deleteMemory(row.memory_id);
          } else if (row.content && row.memory_type) {
            const vector = await this.dependencies.embeddingClient!.embed(row.content);
            const metadata = parseMetadata(row.metadata);
            await hybridSearch.upsertMemory(row.memory_id, vector, {
              ...metadata,
              content: row.content,
              memory_type: row.memory_type,
              created_at: row.created_at,
              namespace: row.namespace,
              agent_id: row.agent_id ?? undefined,
              task_id: row.task_id ?? undefined,
            });
          }
          qdrantPending = false;
        } catch (error) {
          errors.push(`qdrant: ${errorMessage(error)}`);
        }
      }

      if (redisPending && this.dependencies.workingMemory) {
        try {
          if (row.operation === "delete") {
            await this.dependencies.workingMemory.delete(row.memory_id, row.namespace);
          } else if (row.content && row.memory_type) {
            const metadata = parseMetadata(row.metadata);
            await this.dependencies.workingMemory.store(
              {
                conversationId: row.memory_id,
                timestamp: new Date(row.created_at),
                fullText: row.content,
                keyEntities: stringArray(metadata.key_entities),
                topics: stringArray(metadata.topics ?? metadata.tags),
                userIntent:
                  typeof metadata.user_intent === "string" ? metadata.user_intent : row.memory_type,
              },
              row.namespace
            );
          }
          redisPending = false;
        } catch (error) {
          errors.push(`redis: ${errorMessage(error)}`);
        }
      }

      if (!qdrantPending && !redisPending) {
        const deleted = this.db
          .prepare("DELETE FROM index_outbox WHERE memory_id = ? AND revision = ?")
          .run(row.memory_id, row.revision);
        if (deleted.changes > 0) stats.completed++;
        else stats.pending++;
      } else {
        const unavailable: string[] = [];
        if (
          qdrantPending &&
          (!this.dependencies.hybridSearch ||
            (row.operation !== "delete" && !this.dependencies.embeddingClient))
        ) {
          unavailable.push("qdrant dependencies unavailable");
        }
        if (redisPending && !this.dependencies.workingMemory) {
          unavailable.push("redis unavailable");
        }
        const messages = [...errors, ...unavailable];
        const updated = this.db
          .prepare(
            `
          UPDATE index_outbox
          SET qdrant_pending = ?, redis_pending = ?, attempts = attempts + ?,
              last_error = ?, updated_at = ?
          WHERE memory_id = ? AND revision = ?
        `
          )
          .run(
            qdrantPending ? 1 : 0,
            redisPending ? 1 : 0,
            errors.length > 0 ? 1 : 0,
            messages.join("; ") || null,
            Date.now(),
            row.memory_id,
            row.revision
          );
        stats.pending++;
        if (updated.changes > 0) {
          stats.errors.push(...errors.map((message) => `${row.memory_id}: ${message}`));
        }
      }
    }

    return stats;
  }
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
