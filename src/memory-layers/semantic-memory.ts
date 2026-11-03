/**
 * Semantic Memory Layer - v3.0 Implementation
 *
 * SQLite knowledge graph with HippoRAG Personalized PageRank.
 * v0.5.0: Added namespace parameter for multi-agent isolation.
 */

import Database from "better-sqlite3";

export interface Entity {
  id: string;
  name: string;
  type: "person" | "project" | "concept" | "preference";
  description?: string;
  confidence: number;
}

export interface Fact {
  id: string;
  entity_id: string;
  property: string;
  value: string;
  confidence: number;
  valid_from?: string;
  valid_until?: string;
  source_conversation?: string;
}

export interface TraversalPath {
  sourceId: string;
  targetId: string;
  hops: number;
  path: string[];
  relationType: string;
}

export interface FactChain {
  targetId: string;
  targetName: string;
  intermediaries: string[];
  totalScore: number;
}

export interface PageRankWithFactsResult {
  entities: Array<Entity & { relevanceScore: number }>;
  facts: Fact[];
  paths: TraversalPath[];
  chains?: FactChain[];
}

export class SemanticMemoryLayer {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureDecayCursor();
  }

  /**
   * Older databases predate incremental decay. Keep the migration next to the
   * behavior so every caller gets the non-compounding semantics.
   */
  private ensureDecayCursor(): void {
    const columns = this.db.pragma("table_info(relationships)") as Array<{ name: string }>;
    if (columns.length > 0 && !columns.some((column) => column.name === "last_decayed_at")) {
      this.db.exec("ALTER TABLE relationships ADD COLUMN last_decayed_at TEXT");
    }
  }

  upsertEntity(
    entity: Partial<Entity> & { name: string; type: string },
    namespace: string = "default"
  ): Entity {
    if (!entity.name || entity.name.trim() === "") {
      throw new Error("Entity name cannot be empty");
    }

    const existing = this.db
      .prepare("SELECT * FROM entities WHERE name = ? AND type = ? AND namespace = ?")
      .get(entity.name, entity.type, namespace) as any;

    if (existing) {
      this.db
        .prepare(
          "UPDATE entities SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?"
        )
        .run(new Date().toISOString(), existing.id);
      return existing;
    }

    const id = "entity_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
      INSERT INTO entities (id, name, type, description, confidence, created_at, last_accessed, access_count, namespace)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        entity.name,
        entity.type,
        entity.description || null,
        entity.confidence || 1.0,
        now,
        now,
        1,
        namespace
      );

    return {
      id,
      name: entity.name,
      type: entity.type as any,
      description: entity.description,
      confidence: entity.confidence || 1.0,
    };
  }

  getEntity(name: string, namespace: string = "default"): any | null {
    const result = this.db
      .prepare(
        "SELECT * FROM entities WHERE name = ? AND namespace = ? ORDER BY confidence DESC LIMIT 1"
      )
      .get(name, namespace);

    if (result) {
      this.db
        .prepare(
          "UPDATE entities SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?"
        )
        .run(new Date().toISOString(), (result as any).id);
    }

    return result || null;
  }

  upsertRelationship(
    rel: { sourceId: string; targetId: string; relationType: string; strength?: number },
    namespace: string = "default"
  ): void {
    const existing = this.db
      .prepare(
        "SELECT * FROM relationships WHERE source_id = ? AND target_id = ? AND relation_type = ? AND namespace = ?"
      )
      .get(rel.sourceId, rel.targetId, rel.relationType, namespace) as any;

    const now = new Date().toISOString();

    if (existing) {
      const newStrength = Math.min(1.0, existing.strength + 0.2);
      this.db
        .prepare("UPDATE relationships SET strength = ?, last_reinforced = ? WHERE id = ?")
        .run(newStrength, now, existing.id);
      return;
    }

    const id = "rel_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);

    this.db
      .prepare(
        `
      INSERT INTO relationships (id, source_id, target_id, relation_type, strength, evidence, created_at, last_reinforced, namespace)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        rel.sourceId,
        rel.targetId,
        rel.relationType,
        rel.strength || 0.8,
        "[]",
        now,
        now,
        namespace
      );
  }

  personalizedPageRank(entityId: string, depth: number = 3, namespace: string = "default"): any[] {
    const visited = new Set<string>();
    const results: any[] = [];
    let currentLayer = [{ entityId, score: 1.0 }];

    for (let d = 0; d < depth && currentLayer.length > 0; d++) {
      const nextLayer: any[] = [];

      for (const node of currentLayer) {
        if (visited.has(node.entityId)) continue;
        visited.add(node.entityId);

        const entity = this.db
          .prepare("SELECT * FROM entities WHERE id = ? AND namespace = ?")
          .get(node.entityId, namespace);
        if (entity) results.push({ ...entity, relevanceScore: node.score });

        const rels = this.db
          .prepare(
            "SELECT * FROM relationships WHERE (source_id = ? OR target_id = ?) AND namespace = ?"
          )
          .all(node.entityId, node.entityId, namespace) as any[];

        for (const rel of rels) {
          const nextId = rel.source_id === node.entityId ? rel.target_id : rel.source_id;
          const score = node.score * rel.strength * 0.7;

          if (!visited.has(nextId) && score > 0.1) {
            nextLayer.push({ entityId: nextId, score });
          }
        }
      }

      currentLayer = nextLayer;
    }

    return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  personalizedPageRankWithFacts(
    entityId: string,
    depth: number = 3,
    namespace: string = "default"
  ): PageRankWithFactsResult {
    const visited = new Set<string>();
    const entities: Array<Entity & { relevanceScore: number }> = [];
    const allFacts: Fact[] = [];
    const paths: TraversalPath[] = [];
    const chains: FactChain[] = [];

    const pathTracker = new Map<string, { path: string[]; hops: number; relationType: string }>();

    let currentLayer = [
      {
        entityId,
        score: 1.0,
        path: [entityId],
        depth: 0,
        lastRelationType: "start",
      },
    ];

    const startEntity = this.db
      .prepare("SELECT * FROM entities WHERE id = ? AND namespace = ?")
      .get(entityId, namespace) as any;
    if (!startEntity) {
      return { entities: [], facts: [], paths: [], chains: [] };
    }

    for (let d = 0; d <= depth && currentLayer.length > 0; d++) {
      const nextLayer: Array<{
        entityId: string;
        score: number;
        path: string[];
        depth: number;
        lastRelationType: string;
      }> = [];

      for (const node of currentLayer) {
        if (visited.has(node.entityId)) continue;
        visited.add(node.entityId);

        const entity = this.db
          .prepare("SELECT * FROM entities WHERE id = ? AND namespace = ?")
          .get(node.entityId, namespace) as any;
        if (entity) {
          entities.push({ ...entity, relevanceScore: node.score });

          const entityFacts = this.db
            .prepare(
              `
            SELECT * FROM facts
            WHERE entity_id = ? AND namespace = ?
            AND (valid_until IS NULL OR valid_until > datetime('now'))
            ORDER BY confidence DESC
          `
            )
            .all(node.entityId, namespace) as Fact[];

          allFacts.push(...entityFacts);

          if (node.depth > 0) {
            pathTracker.set(node.entityId, {
              path: node.path,
              hops: node.depth,
              relationType: node.lastRelationType,
            });

            paths.push({
              sourceId: entityId,
              targetId: node.entityId,
              hops: node.depth,
              path: node.path,
              relationType: node.lastRelationType,
            });

            if (node.path.length > 2) {
              const intermediaryIds = node.path.slice(1, -1);
              const intermediaryNames: string[] = [];

              for (const interId of intermediaryIds) {
                const interEntity = this.db
                  .prepare("SELECT name FROM entities WHERE id = ? AND namespace = ?")
                  .get(interId, namespace) as any;
                if (interEntity) {
                  intermediaryNames.push(interEntity.name);
                }
              }

              chains.push({
                targetId: node.entityId,
                targetName: entity.name,
                intermediaries: intermediaryNames,
                totalScore: node.score,
              });
            }
          }
        }

        if (d < depth) {
          const rels = this.db
            .prepare(
              "SELECT * FROM relationships WHERE (source_id = ? OR target_id = ?) AND namespace = ?"
            )
            .all(node.entityId, node.entityId, namespace) as any[];

          for (const rel of rels) {
            const nextId = rel.source_id === node.entityId ? rel.target_id : rel.source_id;
            const score = node.score * rel.strength * 0.7;

            if (!visited.has(nextId) && score > 0.05) {
              nextLayer.push({
                entityId: nextId,
                score,
                path: [...node.path, nextId],
                depth: node.depth + 1,
                lastRelationType: rel.relation_type,
              });
            }
          }
        }
      }

      currentLayer = nextLayer;
    }

    entities.sort((a, b) => b.relevanceScore - a.relevanceScore);
    allFacts.sort((a, b) => b.confidence - a.confidence);

    const uniqueFacts = allFacts.filter(
      (fact, index, self) => index === self.findIndex((f) => f.id === fact.id)
    );

    return {
      entities,
      facts: uniqueFacts,
      paths,
      chains: chains.length > 0 ? chains : undefined,
    };
  }

  applyTemporalDecay(namespace: string = "default", now: Date = new Date()): number {
    const relationships = this.db
      .prepare("SELECT * FROM relationships WHERE namespace = ?")
      .all(namespace) as any[];
    let updated = 0;
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    for (const rel of relationships) {
      const lastReinforcedMs = new Date(rel.last_reinforced).getTime();
      const lastDecayedMs = rel.last_decayed_at
        ? new Date(rel.last_decayed_at).getTime()
        : Number.NaN;
      const validReinforcedMs = Number.isFinite(lastReinforcedMs) ? lastReinforcedMs : nowMs;
      const validDecayedMs = Number.isFinite(lastDecayedMs) ? lastDecayedMs : validReinforcedMs;
      const decayFromMs = Math.max(validReinforcedMs, validDecayedMs);
      const elapsedDays = Math.max(0, nowMs - decayFromMs) / (1000 * 60 * 60 * 24);
      const newStrength = rel.strength * Math.exp(-elapsedDays / 30);

      this.db
        .prepare("UPDATE relationships SET strength = ?, last_decayed_at = ? WHERE id = ?")
        .run(newStrength, nowIso, rel.id);
      updated++;
    }

    return updated;
  }

  getPreferences(domain?: string, namespace: string = "default"): any[] {
    if (domain) {
      return this.db
        .prepare(
          "SELECT * FROM entities WHERE type = ? AND namespace = ? AND (name LIKE ? OR description LIKE ?)"
        )
        .all("preference", namespace, `%${domain}%`, `%${domain}%`) as any[];
    }
    return this.db
      .prepare("SELECT * FROM entities WHERE type = ? AND namespace = ?")
      .all("preference", namespace) as any[];
  }

  getByTimeRange(start?: Date, end?: Date, namespace: string = "default"): any[] {
    let query = "SELECT * FROM entities WHERE namespace = ?";
    const params: any[] = [namespace];

    if (start) {
      query += " AND created_at >= ?";
      params.push(start.toISOString());
    }
    if (end) {
      query += " AND created_at <= ?";
      params.push(end.toISOString());
    }

    query += " ORDER BY created_at DESC LIMIT 20";
    return this.db.prepare(query).all(...params) as any[];
  }
}
