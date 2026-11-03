/**
 * Skill Library - v3.0 Voyager-Style Implementation
 *
 * Procedural memory: reusable patterns learned from conversations.
 * Includes RelationalSkillLibrary for geometric embeddings and analogical reasoning.
 * Enhanced with lazy loading support for token efficiency.
 */

import Database from "better-sqlite3";
import { EmbeddingClient } from "../embeddings/client.js";
import {
  SkillSummary,
  FullSkill,
  InvocationDetection,
  LazyLoadingSkillLibrary,
} from "./skill-lazy-loading.js";

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  triggers: string[];
  successCount: number;
  failureCount: number;
  avgSatisfaction: number;
  embedding?: number[];
  similarity?: number;
}

export interface SkillRelationship {
  id: string;
  skillId1: string;
  skillId2: string;
  relationshipType: string;
  coOccurrenceCount: number;
  relationalVector?: number[];
  createdAt: Date;
  lastUpdated: Date;
}

export interface SkillWithScore extends Skill {
  fusedScore?: number;
  analogyScore?: number;
}

// Re-export lazy loading types
export type { SkillSummary, FullSkill, InvocationDetection };

export class SkillLibrary {
  private db: Database.Database;
  private lazyLoader: LazyLoadingSkillLibrary;

  constructor(db: Database.Database) {
    this.db = db;
    this.lazyLoader = new LazyLoadingSkillLibrary(db);
  }

  addSkill(
    skill: Omit<Skill, "id" | "successCount" | "failureCount" | "avgSatisfaction">,
    namespace: string = "default"
  ): string {
    const id = "skill_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);

    // Generate summary from description (first sentence or 100 chars)
    const summary =
      skill.description.length <= 100
        ? skill.description
        : skill.description.substring(0, 97) + "...";

    this.db
      .prepare(
        `
      INSERT INTO skills (
        id, name, description, summary, category, triggers,
        success_count, failure_count, avg_user_satisfaction, is_archived, namespace
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0.5, 0, ?)
    `
      )
      .run(
        id,
        skill.name,
        skill.description,
        summary,
        skill.category,
        JSON.stringify(skill.triggers),
        namespace
      );

    return id;
  }

  search(query: string, limit: number = 5, namespace: string = "default"): Skill[] {
    const queryLower = query.toLowerCase();

    const skills = this.db
      .prepare(
        "SELECT * FROM skills WHERE namespace = ? ORDER BY avg_user_satisfaction DESC, success_count DESC"
      )
      .all(namespace) as any[];

    const scored = skills
      .map((skill) => {
        const triggers = JSON.parse(skill.triggers || "[]");
        const matchScore = triggers.some(
          (t: string) =>
            queryLower.includes(t.toLowerCase()) || t.toLowerCase().includes(queryLower)
        )
          ? 1
          : 0;

        const nameMatch = skill.name.toLowerCase().includes(queryLower) ? 0.5 : 0;

        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          category: skill.category,
          triggers,
          successCount: skill.success_count,
          failureCount: skill.failure_count,
          avgSatisfaction: skill.avg_user_satisfaction,
          score: matchScore + nameMatch,
        };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
  }

  recordSuccess(skillId: string, satisfaction: number, namespace: string = "default"): void {
    const skill = this.db
      .prepare("SELECT * FROM skills WHERE id = ? AND namespace = ?")
      .get(skillId, namespace) as any;

    if (skill) {
      const newAvg =
        (skill.avg_user_satisfaction * skill.success_count + satisfaction) /
        (skill.success_count + 1);

      this.db
        .prepare(
          "UPDATE skills SET success_count = success_count + 1, avg_user_satisfaction = ? WHERE id = ? AND namespace = ?"
        )
        .run(newAvg, skillId, namespace);
    }
  }

  recordFailure(skillId: string, namespace: string = "default"): void {
    this.db
      .prepare("UPDATE skills SET failure_count = failure_count + 1 WHERE id = ? AND namespace = ?")
      .run(skillId, namespace);
  }

  /**
   * Get database instance for subclasses
   */
  protected getDb(): Database.Database {
    return this.db;
  }

  /**
   * Get skill summaries for lazy loading context injection
   *
   * Returns lightweight summaries (~50 tokens each) instead of full skills.
   * This reduces token usage by 80-90% for skill-related context.
   *
   * @param limit - Maximum number of summaries (default: 20)
   * @param category - Optional category filter
   * @returns Array of SkillSummary objects
   */
  getSummaries(
    limit: number = 20,
    category?: string,
    namespace: string = "default"
  ): SkillSummary[] {
    return this.lazyLoader.getSummaries(limit, category, namespace);
  }

  /**
   * Load full skill implementation on-demand
   *
   * Used when a skill is explicitly invoked and full details are needed.
   * Results should be cached in working memory to avoid repeated loads.
   *
   * @param skillId - The skill ID to load
   * @returns FullSkill object or null if not found
   */
  loadFull(skillId: string, namespace: string = "default"): FullSkill | null {
    const belongsToNamespace = this.db
      .prepare("SELECT 1 AS present FROM skills WHERE id = ? AND namespace = ?")
      .get(skillId, namespace);
    if (!belongsToNamespace) return null;

    const fullSkill = this.lazyLoader.loadFull(skillId);

    // Update last_used timestamp when loading a skill
    if (fullSkill) {
      this.db
        .prepare(
          `
        UPDATE skills
        SET last_used = CURRENT_TIMESTAMP
        WHERE id = ? AND namespace = ?
      `
        )
        .run(skillId, namespace);
    }

    return fullSkill;
  }

  /**
   * Detect if a query is attempting to invoke a specific skill
   *
   * Uses pattern matching to identify skill invocations.
   *
   * @param query - The user query
   * @returns InvocationDetection result with skill ID if detected
   */
  detectInvocation(query: string, namespace: string = "default"): InvocationDetection {
    const summaries = this.getSummaries(100, undefined, namespace); // Get all summaries for matching
    return this.lazyLoader.detectInvocation(query, summaries);
  }

  /**
   * Update last_used timestamp for a skill
   *
   * Called when a skill is successfully executed.
   *
   * @param skillId - The skill ID
   */
  updateLastUsed(skillId: string): void {
    this.db
      .prepare(
        `
      UPDATE skills
      SET last_used = CURRENT_TIMESTAMP
      WHERE id = ?
    `
      )
      .run(skillId);
  }
}

/**
 * RelationalSkillLibrary - Extended skill library with geometric embeddings
 * and analogical reasoning capabilities.
 *
 * Features:
 * - Skill embeddings for semantic similarity search
 * - Co-occurrence tracking between skills
 * - Relational vectors for analogical reasoning
 * - Hybrid search combining trigger-based and embedding-based results
 */
export class RelationalSkillLibrary extends SkillLibrary {
  private embeddingClient?: EmbeddingClient;

  constructor(db: Database.Database, embeddingClient?: EmbeddingClient) {
    super(db);
    this.embeddingClient = embeddingClient;
  }

  /**
   * Construct pattern text from skill properties for embedding generation.
   * Combines name, description, category, and triggers into a single text
   * that captures the skill's semantic meaning.
   */
  constructPatternText(
    skill: Omit<Skill, "id" | "successCount" | "failureCount" | "avgSatisfaction">
  ): string {
    const parts: string[] = [];

    parts.push(`Skill: ${skill.name}`);
    parts.push(`Description: ${skill.description}`);
    parts.push(`Category: ${skill.category}`);

    if (skill.triggers && skill.triggers.length > 0) {
      parts.push(`Triggers: ${skill.triggers.join(", ")}`);
    }

    return parts.join(". ");
  }

  /**
   * Add a skill with automatic embedding generation.
   * Falls back to adding without embedding if embedding service unavailable.
   */
  async addSkillWithEmbedding(
    skill: Omit<Skill, "id" | "successCount" | "failureCount" | "avgSatisfaction">
  ): Promise<string> {
    const id = "skill_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    const db = this.getDb();

    let embeddingBuffer: Buffer | null = null;

    // Try to generate embedding
    if (this.embeddingClient) {
      try {
        const patternText = this.constructPatternText(skill);
        const embedding = await this.embeddingClient.embed(patternText);
        embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
      } catch (err) {
        console.error(
          "[SkillLibrary] Failed to generate embedding:",
          err instanceof Error ? err.message : String(err)
        );
        // Continue without embedding
      }
    }

    db.prepare(
      `
      INSERT INTO skills (id, name, description, category, triggers, embedding, success_count, failure_count, avg_user_satisfaction)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0.5)
    `
    ).run(
      id,
      skill.name,
      skill.description,
      skill.category,
      JSON.stringify(skill.triggers),
      embeddingBuffer
    );

    return id;
  }

  /**
   * Generate embeddings for all skills that don't have one.
   * Useful for migrating existing skills or after embedding service comes back online.
   */
  async generateMissingEmbeddings(): Promise<number> {
    if (!this.embeddingClient) {
      return 0;
    }

    const db = this.getDb();

    // Get skills without embeddings
    const skills = db
      .prepare(
        "SELECT id, name, description, category, triggers FROM skills WHERE embedding IS NULL"
      )
      .all() as any[];

    if (skills.length === 0) {
      return 0;
    }

    // Construct pattern texts
    const patternTexts = skills.map((skill) =>
      this.constructPatternText({
        name: skill.name,
        description: skill.description,
        category: skill.category,
        triggers: JSON.parse(skill.triggers || "[]"),
      })
    );

    // Generate embeddings in batch
    const response = await this.embeddingClient.embedBatch(patternTexts);

    // Update skills with embeddings
    const updateStmt = db.prepare("UPDATE skills SET embedding = ? WHERE id = ?");

    for (let i = 0; i < skills.length; i++) {
      const embeddingBuffer = Buffer.from(new Float32Array(response.embeddings[i]).buffer);
      updateStmt.run(embeddingBuffer, skills[i].id);
    }

    return skills.length;
  }

  /**
   * Calculate cosine similarity between two embedding vectors.
   * Returns value between -1 and 1, where 1 is identical.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Embedding vectors must have same length");
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    // Handle zero vector case
    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Search skills by embedding similarity (geometric search).
   * Uses cosine similarity to find semantically similar skills.
   */
  async searchByEmbedding(query: string, limit: number = 5): Promise<Skill[]> {
    if (!this.embeddingClient) {
      return [];
    }

    const db = this.getDb();

    // Generate query embedding
    const queryEmbedding = await this.embeddingClient.embed(query);

    // Get all skills with embeddings
    const skills = db.prepare("SELECT * FROM skills WHERE embedding IS NOT NULL").all() as any[];

    // Calculate similarity for each skill
    const scoredSkills = skills.map((skill) => {
      const embeddingBuffer = skill.embedding as Buffer;
      const expectedBytes = 1024 * 4; // 1024 dimensions * 4 bytes per float32
      if (embeddingBuffer.byteLength !== expectedBytes) {
        throw new Error(
          `Invalid embedding size: expected ${expectedBytes} bytes, got ${embeddingBuffer.byteLength}`
        );
      }
      const embedding = new Float32Array(embeddingBuffer.buffer, embeddingBuffer.byteOffset, 1024);
      const embeddingArray = Array.from(embedding);

      const similarity = this.cosineSimilarity(queryEmbedding, embeddingArray);

      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        triggers: JSON.parse(skill.triggers || "[]"),
        successCount: skill.success_count,
        failureCount: skill.failure_count,
        avgSatisfaction: skill.avg_user_satisfaction,
        similarity,
      } as Skill;
    });

    // Sort by similarity (descending) and return top results
    return scoredSkills.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, limit);
  }

  /**
   * Hybrid search combining trigger-based and embedding-based search.
   * Uses Reciprocal Rank Fusion (RRF) with k=60 to combine results.
   */
  async hybridSearch(query: string, limit: number = 5): Promise<SkillWithScore[]> {
    // Get trigger-based results
    const triggerResults = this.search(query, limit * 2);

    // Get embedding-based results (if available)
    let embeddingResults: Skill[] = [];
    if (this.embeddingClient) {
      try {
        embeddingResults = await this.searchByEmbedding(query, limit * 2);
      } catch {
        // Fall back to trigger-only search
      }
    }

    // If no embedding results, return trigger results
    if (embeddingResults.length === 0) {
      return triggerResults.map((skill) => ({
        ...skill,
        fusedScore: 1 / (60 + 1), // RRF score for single list
      }));
    }

    // Combine using RRF (k=60)
    const k = 60;
    const fusedScores = new Map<string, { skill: Skill; score: number }>();

    // Add trigger results with RRF scores
    triggerResults.forEach((skill, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      fusedScores.set(skill.id, { skill, score: rrfScore });
    });

    // Add embedding results with RRF scores
    embeddingResults.forEach((skill, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = fusedScores.get(skill.id);

      if (existing) {
        existing.score += rrfScore;
        // Keep the one with similarity score if available
        if (skill.similarity !== undefined) {
          existing.skill = skill;
        }
      } else {
        fusedScores.set(skill.id, { skill, score: rrfScore });
      }
    });

    // Sort by fused score and return
    return Array.from(fusedScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ skill, score }) => ({
        ...skill,
        fusedScore: score,
      }));
  }

  /**
   * Record co-occurrence between two skills.
   * Used to track which skills are often used together.
   * Normalizes skill pair order for consistency.
   */
  async recordCoOccurrence(skillId1: string, skillId2: string): Promise<void> {
    const db = this.getDb();

    // Normalize order (smaller ID first)
    const [id1, id2] = skillId1 < skillId2 ? [skillId1, skillId2] : [skillId2, skillId1];

    // Use UPSERT to avoid TOCTOU race condition
    const relId = "rel_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    db.prepare(
      `
      INSERT INTO skill_relationships (id, skill_id_1, skill_id_2, relationship_type, co_occurrence_count, created_at, last_updated)
      VALUES (?, ?, ?, 'co_occurred', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(skill_id_1, skill_id_2, relationship_type)
      DO UPDATE SET
        co_occurrence_count = co_occurrence_count + 1,
        last_updated = CURRENT_TIMESTAMP
    `
    ).run(relId, id1, id2);
  }

  /**
   * Compute relational vectors for skill relationships that meet the threshold.
   * Relational vector = embedding(skill2) - embedding(skill1)
   * Used for analogical reasoning.
   */
  async computeRelationalVectors(minCoOccurrenceCount: number = 2): Promise<number> {
    const db = this.getDb();

    // Get relationships that need relational vectors
    const relationships = db
      .prepare(
        `
      SELECT sr.*, s1.embedding as emb1, s2.embedding as emb2
      FROM skill_relationships sr
      JOIN skills s1 ON sr.skill_id_1 = s1.id
      JOIN skills s2 ON sr.skill_id_2 = s2.id
      WHERE sr.co_occurrence_count >= ?
        AND sr.relational_vector IS NULL
        AND s1.embedding IS NOT NULL
        AND s2.embedding IS NOT NULL
    `
      )
      .all(minCoOccurrenceCount) as any[];

    let computed = 0;

    for (const rel of relationships) {
      // Get embeddings
      const expectedBytes = 1024 * 4; // 1024 dimensions * 4 bytes per float32
      if (rel.emb1.byteLength !== expectedBytes) {
        throw new Error(
          `Invalid embedding size for emb1: expected ${expectedBytes} bytes, got ${rel.emb1.byteLength}`
        );
      }
      if (rel.emb2.byteLength !== expectedBytes) {
        throw new Error(
          `Invalid embedding size for emb2: expected ${expectedBytes} bytes, got ${rel.emb2.byteLength}`
        );
      }
      const emb1 = new Float32Array(rel.emb1.buffer, rel.emb1.byteOffset, 1024);
      const emb2 = new Float32Array(rel.emb2.buffer, rel.emb2.byteOffset, 1024);

      // Compute relational vector (difference)
      const relationalVector = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        relationalVector[i] = emb2[i] - emb1[i];
      }

      // Store relational vector
      const vectorBuffer = Buffer.from(relationalVector.buffer);
      db.prepare("UPDATE skill_relationships SET relational_vector = ? WHERE id = ?").run(
        vectorBuffer,
        rel.id
      );

      computed++;
    }

    return computed;
  }

  /**
   * Find analogous skills using relational vectors.
   * Query: "What is to sourceB as targetA is to sourceA?"
   *
   * Uses the relationship between sourceA and targetA to find
   * a similar relationship starting from sourceB.
   */
  async analogicalSearch(
    sourceA: string,
    targetA: string,
    sourceB: string,
    limit: number = 5
  ): Promise<SkillWithScore[]> {
    const db = this.getDb();

    // Get embeddings for source skills
    const skillA = db.prepare("SELECT embedding FROM skills WHERE id = ?").get(sourceA) as any;
    const skillTargetA = db
      .prepare("SELECT embedding FROM skills WHERE id = ?")
      .get(targetA) as any;
    const skillB = db.prepare("SELECT embedding FROM skills WHERE id = ?").get(sourceB) as any;

    if (!skillA?.embedding || !skillTargetA?.embedding || !skillB?.embedding) {
      return [];
    }

    // Get relational vector between sourceA and targetA
    const [id1, id2] = sourceA < targetA ? [sourceA, targetA] : [targetA, sourceA];
    const relationship = db
      .prepare(
        `
      SELECT relational_vector FROM skill_relationships
      WHERE (skill_id_1 = ? AND skill_id_2 = ?) OR (skill_id_1 = ? AND skill_id_2 = ?)
    `
      )
      .get(id1, id2, id2, id1) as any;

    if (!relationship?.relational_vector) {
      return [];
    }

    // Extract relational vector
    const expectedBytes = 1024 * 4; // 1024 dimensions * 4 bytes per float32
    if (relationship.relational_vector.byteLength !== expectedBytes) {
      throw new Error(
        `Invalid relational vector size: expected ${expectedBytes} bytes, got ${relationship.relational_vector.byteLength}`
      );
    }
    const relVector = new Float32Array(
      relationship.relational_vector.buffer,
      relationship.relational_vector.byteOffset,
      1024
    );

    // Extract sourceB embedding
    if (skillB.embedding.byteLength !== expectedBytes) {
      throw new Error(
        `Invalid embedding size for skillB: expected ${expectedBytes} bytes, got ${skillB.embedding.byteLength}`
      );
    }
    const embB = new Float32Array(skillB.embedding.buffer, skillB.embedding.byteOffset, 1024);

    // Compute expected target embedding: embB + relVector
    const expectedTarget = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      expectedTarget[i] = embB[i] + relVector[i];
    }
    const expectedTargetArray = Array.from(expectedTarget);

    // Find skills closest to expected target
    const skills = db
      .prepare("SELECT * FROM skills WHERE embedding IS NOT NULL AND id != ?")
      .all(sourceB) as any[];

    const scoredSkills = skills.map((skill) => {
      const embeddingBuffer = skill.embedding as Buffer;
      const expectedBytes = 1024 * 4; // 1024 dimensions * 4 bytes per float32
      if (embeddingBuffer.byteLength !== expectedBytes) {
        throw new Error(
          `Invalid embedding size: expected ${expectedBytes} bytes, got ${embeddingBuffer.byteLength}`
        );
      }
      const embedding = new Float32Array(embeddingBuffer.buffer, embeddingBuffer.byteOffset, 1024);
      const embeddingArray = Array.from(embedding);

      const analogyScore = this.cosineSimilarity(expectedTargetArray, embeddingArray);

      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        triggers: JSON.parse(skill.triggers || "[]"),
        successCount: skill.success_count,
        failureCount: skill.failure_count,
        avgSatisfaction: skill.avg_user_satisfaction,
        analogyScore,
      } as SkillWithScore;
    });

    return scoredSkills
      .sort((a, b) => (b.analogyScore || 0) - (a.analogyScore || 0))
      .slice(0, limit);
  }
}
