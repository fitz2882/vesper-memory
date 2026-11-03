/**
 * Consolidation Pipeline - v3.0 Implementation
 *
 * Nightly process: working → semantic memory transformation.
 * Runs at 3 AM, extracts knowledge, applies decay, detects conflicts.
 */

import type { WorkingMemoryLayer } from "../memory-layers/working-memory.js";
import { SemanticMemoryLayer } from "../memory-layers/semantic-memory.js";
import { SkillLibrary } from "../memory-layers/skill-library.js";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureBackupsDirectory } from "../utils/paths.js";

export interface ConsolidationStats {
  memoriesProcessed: number;
  entitiesExtracted: number;
  relationshipsCreated: number;
  conflictsDetected: number;
  memoriesPruned: number;
  skillsExtracted: number;
  duration: number;
}

export interface ConsolidationPipelineOptions {
  /** Maximum canonical memories processed by one consolidation run. */
  batchSize?: number;
  /** Override used by tests and installations with a separate backup volume. */
  backupDirectory?: string;
  /** Injectable clock for deterministic decay and retention behavior. */
  now?: () => Date;
  backupRetentionDays?: number;
}

interface CanonicalMemoryRow {
  id: string;
  content: string;
  memory_type: string;
  created_at: number | string;
  metadata: string | null;
  namespace: string | null;
}

interface ConsolidationMemory {
  conversationId: string;
  timestamp: Date;
  fullText: string;
  keyEntities: string[];
  topics: string[];
  userIntent: string;
}

export class ConsolidationPipeline {
  private semanticMemory: SemanticMemoryLayer;
  private skillLibrary: SkillLibrary;
  private db: Database.Database;
  private readonly batchSize: number;
  private readonly backupDirectory?: string;
  private readonly now: () => Date;
  private readonly backupRetentionDays: number;

  constructor(
    workingMemory: WorkingMemoryLayer | undefined,
    semanticMemory: SemanticMemoryLayer,
    skillLibrary: SkillLibrary,
    db: Database.Database,
    options: ConsolidationPipelineOptions = {}
  ) {
    // Kept in the signature for API compatibility. Canonical ingestion no
    // longer reads Redis through WorkingMemoryLayer.
    void workingMemory;
    this.semanticMemory = semanticMemory;
    this.skillLibrary = skillLibrary;
    this.db = db;
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? 100));
    this.backupDirectory = options.backupDirectory;
    this.now = options.now ?? (() => new Date());
    this.backupRetentionDays = Math.max(1, options.backupRetentionDays ?? 7);
    this.ensureDurabilitySchema();
  }

  /**
   * Run full consolidation cycle
   * If namespace is omitted, consolidates all namespaces.
   */
  async consolidate(namespace?: string): Promise<ConsolidationStats> {
    const startTime = Date.now();
    console.error("[CONSOLIDATION] Starting consolidation cycle...");

    const stats: ConsolidationStats = {
      memoriesProcessed: 0,
      entitiesExtracted: 0,
      relationshipsCreated: 0,
      conflictsDetected: 0,
      memoriesPruned: 0,
      skillsExtracted: 0,
      duration: 0,
    };

    try {
      // Step 1: Read a bounded batch from the canonical SQLite store. Redis is
      // a cache and must not determine whether a durable memory is processed.
      const canonicalMemories = this.getUnconsolidatedMemories(namespace);
      const processedNamespaces = new Set<string>();

      for (const row of canonicalMemories) {
        const ns = row.namespace || "default";
        const memory = this.toConsolidationMemory(row);

        try {
          const result = this.processMemory(row, memory, ns);
          stats.memoriesProcessed++;
          stats.entitiesExtracted += result.entitiesExtracted;
          stats.relationshipsCreated += result.relationshipsCreated;
          stats.skillsExtracted += result.skillsExtracted;
          processedNamespaces.add(ns);
        } catch (error) {
          // The per-memory transaction rolls back both derived work and the
          // checkpoint. A malformed or transiently failing row remains retryable.
          console.error(
            `[CONSOLIDATION] Failed memory ${row.id}; leaving unconsolidated:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }

      const namespacesToMaintain = namespace
        ? [namespace]
        : Array.from(new Set([...this.getDistinctNamespaces(), ...processedNamespaces]));

      for (const ns of namespacesToMaintain) {
        // Step 2: Apply temporal decay
        this.semanticMemory.applyTemporalDecay(ns, this.now());

        // Step 3: Detect conflicts
        stats.conflictsDetected += this.detectConflicts(ns);

        // Step 4: Prune low-value memories
        stats.memoriesPruned += this.pruneMemories(ns);
      }

      // Step 6: Create backup
      await this.createBackup();

      stats.duration = Date.now() - startTime;

      console.error(
        `[CONSOLIDATION] Complete! Processed ${stats.memoriesProcessed} memories in ${stats.duration}ms`
      );
      console.error(
        `[CONSOLIDATION] Extracted ${stats.entitiesExtracted} entities, ${stats.relationshipsCreated} relationships`
      );
      console.error(
        `[CONSOLIDATION] Detected ${stats.conflictsDetected} conflicts, pruned ${stats.memoriesPruned} memories`
      );

      return stats;
    } catch (error) {
      console.error("[CONSOLIDATION] Error:", error);
      throw error;
    }
  }

  private ensureDurabilitySchema(): void {
    const memoryColumns = this.db.pragma("table_info(memories)") as Array<{ name: string }>;
    if (
      memoryColumns.length > 0 &&
      !memoryColumns.some((column) => column.name === "consolidated_at")
    ) {
      this.db.exec("ALTER TABLE memories ADD COLUMN consolidated_at INTEGER");
    }

    const conflictColumns = this.db.pragma("table_info(conflicts)") as Array<{ name: string }>;
    if (conflictColumns.length > 0) {
      if (!conflictColumns.some((column) => column.name === "entity_id")) {
        this.db.exec("ALTER TABLE conflicts ADD COLUMN entity_id TEXT");
      }
      if (!conflictColumns.some((column) => column.name === "property")) {
        this.db.exec("ALTER TABLE conflicts ADD COLUMN property TEXT");
      }
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_consolidation
      ON memories(namespace, consolidated_at, created_at)
    `);
  }

  private getUnconsolidatedMemories(namespace?: string): CanonicalMemoryRow[] {
    if (namespace) {
      return this.db
        .prepare(
          `
        SELECT id, content, memory_type, created_at, metadata, namespace
        FROM memories
        WHERE consolidated_at IS NULL
          AND COALESCE(namespace, 'default') = ?
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `
        )
        .all(namespace, this.batchSize) as CanonicalMemoryRow[];
    }

    return this.db
      .prepare(
        `
      SELECT id, content, memory_type, created_at, metadata, namespace
      FROM memories
      WHERE consolidated_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `
      )
      .all(this.batchSize) as CanonicalMemoryRow[];
  }

  private toConsolidationMemory(row: CanonicalMemoryRow): ConsolidationMemory {
    let metadata: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        const parsed = JSON.parse(row.metadata);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        // Invalid optional metadata must not make the canonical content unusable.
      }
    }

    const stringArray = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
    const timestamp =
      typeof row.created_at === "number" ? new Date(row.created_at) : new Date(row.created_at);

    return {
      conversationId: row.id,
      timestamp: Number.isNaN(timestamp.getTime()) ? this.now() : timestamp,
      fullText: row.content,
      keyEntities: stringArray(metadata.keyEntities ?? metadata.key_entities),
      topics: stringArray(metadata.topics),
      userIntent:
        typeof metadata.userIntent === "string"
          ? metadata.userIntent
          : typeof metadata.user_intent === "string"
            ? metadata.user_intent
            : "",
    };
  }

  private processMemory(
    row: CanonicalMemoryRow,
    memory: ConsolidationMemory,
    namespace: string
  ): { entitiesExtracted: number; relationshipsCreated: number; skillsExtracted: number } {
    return this.db.transaction(() => {
      const extracted = this.extractKnowledge(memory);

      for (const entity of extracted.entities) {
        this.semanticMemory.upsertEntity(entity, namespace);
      }

      for (const rel of extracted.relationships) {
        this.semanticMemory.upsertRelationship(rel, namespace);
      }

      const skillsExtracted = this.extractSkills([memory], namespace);
      const checkpoint = this.db
        .prepare(
          `
        UPDATE memories
        SET consolidated_at = ?
        WHERE id = ?
          AND COALESCE(namespace, 'default') = ?
          AND consolidated_at IS NULL
      `
        )
        .run(this.now().getTime(), row.id, namespace);

      if (checkpoint.changes !== 1) {
        throw new Error("Canonical memory checkpoint was not acquired");
      }

      return {
        entitiesExtracted: extracted.entities.length,
        relationshipsCreated: extracted.relationships.length,
        skillsExtracted,
      };
    })();
  }

  /**
   * Extract entities and relationships from memory
   * Simple keyword-based extraction (will enhance with LLM later)
   */
  private extractKnowledge(memory: ConsolidationMemory): {
    entities: Array<{
      name: string;
      type: "person" | "project" | "concept" | "preference";
      confidence: number;
    }>;
    relationships: Array<{ sourceId: string; targetId: string; relationType: string }>;
  } {
    const entities: Array<{
      name: string;
      type: "person" | "project" | "concept" | "preference";
      confidence: number;
    }> = [];
    const relationships: Array<{
      sourceId: string;
      targetId: string;
      relationType: string;
    }> = [];

    // Use pre-extracted entities if available
    if (memory.keyEntities && memory.keyEntities.length > 0) {
      for (const entityName of memory.keyEntities) {
        entities.push({
          name: entityName,
          type: "concept" as const,
          confidence: 0.8,
        });
      }
    }

    // Extract preferences
    const prefPatterns = [/prefer (\w+)/gi, /like (\w+)/gi, /favorite is (\w+)/gi];

    for (const pattern of prefPatterns) {
      const matches = memory.fullText.matchAll(pattern);
      for (const match of matches) {
        entities.push({
          name: match[1],
          type: "preference" as const,
          confidence: 0.9,
        });
      }
    }

    return { entities, relationships };
  }

  /**
   * Get distinct namespaces from memories table
   */
  private getDistinctNamespaces(): string[] {
    const rows = this.db
      .prepare(
        `SELECT namespace FROM (
        SELECT COALESCE(namespace, 'default') AS namespace FROM memories
        UNION
        SELECT COALESCE(namespace, 'default') AS namespace FROM relationships
      ) ORDER BY namespace`
      )
      .all() as any[];
    if (rows.length === 0) return ["default"];
    return rows.map((r) => r.namespace);
  }

  /**
   * Detect simple conflicts (temporal impossibilities, contradictions)
   */
  private detectConflicts(namespace: string = "default"): number {
    let detected = 0;

    // Temporal conflicts: same property, overlapping time ranges, different values
    const conflicts = this.db
      .prepare(
        `
      SELECT f1.id as id1, f2.id as id2, f1.entity_id, f1.property,
             f1.value as val1, f2.value as val2
      FROM facts f1
      JOIN facts f2 ON f1.entity_id = f2.entity_id AND f1.property = f2.property
      WHERE f1.id < f2.id
        AND f1.value != f2.value
        AND f1.valid_until IS NULL
        AND f2.valid_until IS NULL
        AND f1.namespace = ? AND f2.namespace = ?
    `
      )
      .all(namespace, namespace) as any[];

    for (const conflict of conflicts) {
      // Check if already flagged
      const existing = this.db
        .prepare("SELECT * FROM conflicts WHERE fact_id_1 = ? AND fact_id_2 = ?")
        .get(conflict.id1, conflict.id2);

      if (!existing) {
        const conflictId = "conflict_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);

        this.db
          .prepare(
            `
          INSERT INTO conflicts (
            id, fact_id_1, fact_id_2, conflict_type, entity_id, property,
            description, severity, resolution_status, namespace
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            conflictId,
            conflict.id1,
            conflict.id2,
            "contradiction",
            conflict.entity_id,
            conflict.property,
            `Conflicting values for ${conflict.property}: "${conflict.val1}" vs "${conflict.val2}"`,
            "medium",
            "flagged",
            namespace
          );

        // Lower confidence on both facts
        this.db.prepare("UPDATE facts SET confidence = 0.5 WHERE id = ?").run(conflict.id1);
        this.db.prepare("UPDATE facts SET confidence = 0.5 WHERE id = ?").run(conflict.id2);

        detected++;
      }
    }

    return detected;
  }

  /**
   * Prune low-value memories
   */
  private pruneMemories(namespace: string = "default"): number {
    // Find relationships to prune (weak relationships with low-access entities)
    const toPrune = this.db
      .prepare(
        `
      SELECT r.id
      FROM relationships r
      INNER JOIN entities source ON r.source_id = source.id
      INNER JOIN entities target ON r.target_id = target.id
      WHERE r.strength < 0.05
        AND source.access_count < 3
        AND target.access_count < 3
        AND r.namespace = ?
    `
      )
      .all(namespace) as any[];

    // Delete them
    let deleted = 0;
    for (const row of toPrune) {
      this.db.prepare("DELETE FROM relationships WHERE id = ?").run(row.id);
      deleted++;
    }

    return deleted;
  }

  /**
   * Extract skills from positive interactions
   */
  private extractSkills(memories: any[], namespace: string = "default"): number {
    let extracted = 0;

    for (const memory of memories) {
      // Look for repeated patterns
      if (memory.topics && memory.topics.includes("analysis")) {
        // Check if skill already exists
        const existing = this.skillLibrary.search("data analysis", 1, namespace);

        if (existing.length === 0) {
          this.skillLibrary.addSkill(
            {
              name: "Data Analysis",
              description: "Analyze datasets and provide insights",
              category: "analysis",
              triggers: ["analyze", "data", "insights"],
            },
            namespace
          );
          extracted++;
        }
      }
    }

    return extracted;
  }

  /**
   * Create backup for rollback capability
   */
  private async createBackup(): Promise<void> {
    const backupId = `backup_${this.now().getTime()}_${randomUUID()}`;
    const now = this.now();
    const nowIso = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + this.backupRetentionDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const backupDirectory = this.backupDirectory
      ? path.resolve(this.backupDirectory)
      : ensureBackupsDirectory();

    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const backupDirectoryStats = fs.lstatSync(backupDirectory);
    if (backupDirectoryStats.isSymbolicLink() || !backupDirectoryStats.isDirectory()) {
      throw new Error(`Backup destination is not a secure directory: ${backupDirectory}`);
    }
    fs.chmodSync(backupDirectory, 0o700);
    const backupPath = path.join(backupDirectory, `${backupId}.db`);

    await this.db.backup(backupPath);
    fs.chmodSync(backupPath, 0o600);

    const fileStats = fs.statSync(backupPath);
    if (!fileStats.isFile() || fileStats.size === 0) {
      throw new Error(`SQLite backup was not created at ${backupPath}`);
    }

    const verificationDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      const quickCheck = verificationDb.pragma("quick_check", { simple: true });
      if (quickCheck !== "ok") {
        throw new Error(`SQLite backup verification failed: ${String(quickCheck)}`);
      }
    } finally {
      verificationDb.close();
    }

    const counts = {
      memories: this.tableCount("memories"),
      entities: this.tableCount("entities"),
      relationships: this.tableCount("relationships"),
      facts: this.tableCount("facts"),
      skills: this.tableCount("skills"),
    };
    this.insertBackupMetadata({
      id: backupId,
      path: backupPath,
      createdAt: nowIso,
      expiresAt,
      size: fileStats.size,
      counts,
    });
    this.removeExpiredBackups(backupDirectory, now);
  }

  private removeExpiredBackups(backupDirectory: string, now: Date): void {
    const root = path.resolve(backupDirectory);
    const rows = this.db
      .prepare(
        `SELECT id, backup_path FROM backup_metadata
         WHERE expires_at IS NOT NULL AND expires_at <= ?`
      )
      .all(now.toISOString()) as Array<{ id: string; backup_path: string | null }>;
    const removeMetadata = this.db.prepare("DELETE FROM backup_metadata WHERE id = ?");

    for (const row of rows) {
      if (!row.backup_path) {
        removeMetadata.run(row.id);
        continue;
      }
      const candidate = path.resolve(row.backup_path);
      const isInsideRoot = candidate.startsWith(`${root}${path.sep}`);
      if (!isInsideRoot || path.dirname(candidate) !== root) {
        console.error(
          `[CONSOLIDATION] Refusing to delete backup outside configured directory: ${candidate}`
        );
        continue;
      }

      if (fs.existsSync(candidate)) {
        const stats = fs.lstatSync(candidate);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          console.error(`[CONSOLIDATION] Refusing to delete unsafe backup path: ${candidate}`);
          continue;
        }
        fs.unlinkSync(candidate);
      }
      removeMetadata.run(row.id);
    }
  }

  private tableCount(
    table: "memories" | "entities" | "relationships" | "facts" | "skills"
  ): number {
    const exists = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (!exists) return 0;
    return (this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
      .count;
  }

  private insertBackupMetadata(backup: {
    id: string;
    path: string;
    createdAt: string;
    expiresAt: string;
    size: number;
    counts: {
      memories: number;
      entities: number;
      relationships: number;
      facts: number;
      skills: number;
    };
  }): void {
    const available = new Set(
      (this.db.pragma("table_info(backup_metadata)") as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (available.size === 0) {
      throw new Error("backup_metadata table is missing");
    }

    const candidates: Array<[string, unknown]> = [
      ["id", backup.id],
      ["backup_timestamp", backup.createdAt],
      ["backup_type", "consolidation"],
      ["status", "completed"],
      ["backup_path", backup.path],
      ["file_size_bytes", backup.size],
      ["num_memories", backup.counts.memories],
      ["num_entities", backup.counts.entities],
      ["entities_count", backup.counts.entities],
      ["num_relationships", backup.counts.relationships],
      ["relationships_count", backup.counts.relationships],
      ["facts_count", backup.counts.facts],
      ["skills_count", backup.counts.skills],
      ["created_at", backup.createdAt],
      ["expires_at", backup.expiresAt],
      ["notes", "Verified with PRAGMA quick_check after better-sqlite3 backup"],
      ["metadata", JSON.stringify({ verified: true, method: "better-sqlite3.backup" })],
    ];
    const values = candidates.filter(([column]) => available.has(column));
    const columns = values.map(([column]) => column);
    const placeholders = columns.map(() => "?").join(", ");

    this.db
      .prepare(`INSERT INTO backup_metadata (${columns.join(", ")}) VALUES (${placeholders})`)
      .run(...values.map(([, value]) => value));
  }
}
