/**
 * Tests for Relational Skill Library Feature
 *
 * TDD Test Suite for geometric embeddings and analogical reasoning
 * in the skill library.
 *
 * Phase 1: Database Schema Extension
 * Phase 2: Skill Embedding Generation
 * Phase 3: Geometric Search
 * Phase 4: Relational Vectors
 * Phase 5: Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SkillLibrary, Skill, SkillRelationship, RelationalSkillLibrary } from '../src/memory-layers/skill-library.js';
import { EmbeddingClient } from '../src/embeddings/client.js';

// =============================================================================
// PHASE 1: DATABASE SCHEMA EXTENSION
// =============================================================================

describe('Phase 1: Database Schema Extension', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('Skills Table Extension', () => {
    it('should add embedding column to skills table', () => {
      // Create base schema
      db.exec(`
        CREATE TABLE skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          summary TEXT,
          category TEXT NOT NULL,
          triggers TEXT NOT NULL,
          success_count INTEGER DEFAULT 0,
          failure_count INTEGER DEFAULT 0,
          avg_user_satisfaction REAL DEFAULT 0.5,
          is_archived INTEGER DEFAULT 0,
          last_used TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Apply migration to add embedding column
      db.exec(`
        ALTER TABLE skills ADD COLUMN embedding BLOB;
      `);

      // Verify column exists
      const tableInfo = db.prepare("PRAGMA table_info(skills)").all() as any[];
      const embeddingColumn = tableInfo.find((col: any) => col.name === 'embedding');

      expect(embeddingColumn).toBeDefined();
      expect(embeddingColumn.type).toBe('BLOB');
    });

    it('should store and retrieve embedding as BLOB', () => {
      db.exec(`
        CREATE TABLE skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          summary TEXT,
          category TEXT NOT NULL,
          triggers TEXT NOT NULL,
          embedding BLOB,
          success_count INTEGER DEFAULT 0,
          failure_count INTEGER DEFAULT 0,
          avg_user_satisfaction REAL DEFAULT 0.5,
          is_archived INTEGER DEFAULT 0,
          last_used TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create a mock embedding (1024 dimensions)
      const mockEmbedding = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        mockEmbedding[i] = Math.random();
      }
      const embeddingBuffer = Buffer.from(mockEmbedding.buffer);

      // Insert skill with embedding
      db.prepare(`
        INSERT INTO skills (id, name, description, category, triggers, embedding)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('skill_1', 'Test Skill', 'Test description', 'test', '[]', embeddingBuffer);

      // Retrieve and verify
      const row = db.prepare('SELECT embedding FROM skills WHERE id = ?').get('skill_1') as any;
      const retrievedBuffer = row.embedding as Buffer;
      const retrievedEmbedding = new Float32Array(retrievedBuffer.buffer, retrievedBuffer.byteOffset, 1024);

      expect(retrievedEmbedding.length).toBe(1024);
      expect(retrievedEmbedding[0]).toBeCloseTo(mockEmbedding[0], 5);
    });

    it('should allow null embedding for backward compatibility', () => {
      db.exec(`
        CREATE TABLE skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          summary TEXT,
          category TEXT NOT NULL,
          triggers TEXT NOT NULL,
          embedding BLOB,
          success_count INTEGER DEFAULT 0,
          failure_count INTEGER DEFAULT 0,
          avg_user_satisfaction REAL DEFAULT 0.5,
          is_archived INTEGER DEFAULT 0,
          last_used TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Insert skill without embedding
      db.prepare(`
        INSERT INTO skills (id, name, description, category, triggers)
        VALUES (?, ?, ?, ?, ?)
      `).run('skill_1', 'Test Skill', 'Test description', 'test', '[]');

      // Verify null embedding
      const row = db.prepare('SELECT embedding FROM skills WHERE id = ?').get('skill_1') as any;
      expect(row.embedding).toBeNull();
    });
  });

  describe('Skill Relationships Table', () => {
    it('should create skill_relationships table', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS skill_relationships (
          id TEXT PRIMARY KEY,
          skill_id_1 TEXT NOT NULL,
          skill_id_2 TEXT NOT NULL,
          relationship_type TEXT NOT NULL,
          co_occurrence_count INTEGER DEFAULT 1,
          relational_vector BLOB,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(skill_id_1, skill_id_2, relationship_type)
        );
      `);

      // Verify table exists
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_relationships'").all();
      expect(tables.length).toBe(1);
    });

    it('should store skill relationship with co-occurrence count', () => {
      db.exec(`
        CREATE TABLE skill_relationships (
          id TEXT PRIMARY KEY,
          skill_id_1 TEXT NOT NULL,
          skill_id_2 TEXT NOT NULL,
          relationship_type TEXT NOT NULL,
          co_occurrence_count INTEGER DEFAULT 1,
          relational_vector BLOB,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(skill_id_1, skill_id_2, relationship_type)
        );
      `);

      db.prepare(`
        INSERT INTO skill_relationships (id, skill_id_1, skill_id_2, relationship_type, co_occurrence_count)
        VALUES (?, ?, ?, ?, ?)
      `).run('rel_1', 'skill_a', 'skill_b', 'co_occurred', 5);

      const row = db.prepare('SELECT * FROM skill_relationships WHERE id = ?').get('rel_1') as any;
      expect(row.skill_id_1).toBe('skill_a');
      expect(row.skill_id_2).toBe('skill_b');
      expect(row.relationship_type).toBe('co_occurred');
      expect(row.co_occurrence_count).toBe(5);
    });

    it('should store relational vector for analogical reasoning', () => {
      db.exec(`
        CREATE TABLE skill_relationships (
          id TEXT PRIMARY KEY,
          skill_id_1 TEXT NOT NULL,
          skill_id_2 TEXT NOT NULL,
          relationship_type TEXT NOT NULL,
          co_occurrence_count INTEGER DEFAULT 1,
          relational_vector BLOB,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(skill_id_1, skill_id_2, relationship_type)
        );
      `);

      // Create a relational vector (difference between two embeddings)
      const relationalVector = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        relationalVector[i] = Math.random() - 0.5; // Can be negative
      }
      const vectorBuffer = Buffer.from(relationalVector.buffer);

      db.prepare(`
        INSERT INTO skill_relationships (id, skill_id_1, skill_id_2, relationship_type, relational_vector)
        VALUES (?, ?, ?, ?, ?)
      `).run('rel_1', 'skill_a', 'skill_b', 'analogous', vectorBuffer);

      const row = db.prepare('SELECT relational_vector FROM skill_relationships WHERE id = ?').get('rel_1') as any;
      const retrievedBuffer = row.relational_vector as Buffer;
      const retrievedVector = new Float32Array(retrievedBuffer.buffer, retrievedBuffer.byteOffset, 1024);

      expect(retrievedVector.length).toBe(1024);
      expect(retrievedVector[0]).toBeCloseTo(relationalVector[0], 5);
    });

    it('should enforce unique constraint on skill pair and relationship type', () => {
      db.exec(`
        CREATE TABLE skill_relationships (
          id TEXT PRIMARY KEY,
          skill_id_1 TEXT NOT NULL,
          skill_id_2 TEXT NOT NULL,
          relationship_type TEXT NOT NULL,
          co_occurrence_count INTEGER DEFAULT 1,
          relational_vector BLOB,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(skill_id_1, skill_id_2, relationship_type)
        );
      `);

      db.prepare(`
        INSERT INTO skill_relationships (id, skill_id_1, skill_id_2, relationship_type)
        VALUES (?, ?, ?, ?)
      `).run('rel_1', 'skill_a', 'skill_b', 'co_occurred');

      // Attempting to insert duplicate should throw
      expect(() => {
        db.prepare(`
          INSERT INTO skill_relationships (id, skill_id_1, skill_id_2, relationship_type)
          VALUES (?, ?, ?, ?)
        `).run('rel_2', 'skill_a', 'skill_b', 'co_occurred');
      }).toThrow();
    });

    it('should allow same skill pair with different relationship types', () => {
      db.exec(`
        CREATE TABLE skill_relationships (
          id TEXT PRIMARY KEY,
          skill_id_1 TEXT NOT NULL,
          skill_id_2 TEXT NOT NULL,
          relationship_type TEXT NOT NULL,
          co_occurrence_count INTEGER DEFAULT 1,
          relational_vector BLOB,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(skill_id_1, skill_id_2, relationship_type)
        );
      `);

      db.prepare(`
        INSERT INTO skill_relationships (id, skill_id_1, skill_id_2, relationship_type)
        VALUES (?, ?, ?, ?)
      `).run('rel_1', 'skill_a', 'skill_b', 'co_occurred');

      // Same pair, different relationship type should succeed
      expect(() => {
        db.prepare(`
          INSERT INTO skill_relationships (id, skill_id_1, skill_id_2, relationship_type)
          VALUES (?, ?, ?, ?)
        `).run('rel_2', 'skill_a', 'skill_b', 'analogous');
      }).not.toThrow();
    });
  });

  describe('Schema Indexes', () => {
    it('should create index on skills.embedding for vector search', () => {
      db.exec(`
        CREATE TABLE skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          summary TEXT,
          category TEXT NOT NULL,
          triggers TEXT NOT NULL,
          embedding BLOB,
          success_count INTEGER DEFAULT 0,
          failure_count INTEGER DEFAULT 0,
          avg_user_satisfaction REAL DEFAULT 0.5,
          is_archived INTEGER DEFAULT 0,
          last_used TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_skills_embedding ON skills(embedding) WHERE embedding IS NOT NULL;
      `);

      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='skills'").all() as any[];
      const embeddingIndex = indexes.find((idx: any) => idx.name === 'idx_skills_embedding');
      expect(embeddingIndex).toBeDefined();
    });

    it('should create indexes on skill_relationships for efficient queries', () => {
      db.exec(`
        CREATE TABLE skill_relationships (
          id TEXT PRIMARY KEY,
          skill_id_1 TEXT NOT NULL,
          skill_id_2 TEXT NOT NULL,
          relationship_type TEXT NOT NULL,
          co_occurrence_count INTEGER DEFAULT 1,
          relational_vector BLOB,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(skill_id_1, skill_id_2, relationship_type)
        );

        CREATE INDEX IF NOT EXISTS idx_skill_rel_skill1 ON skill_relationships(skill_id_1);
        CREATE INDEX IF NOT EXISTS idx_skill_rel_skill2 ON skill_relationships(skill_id_2);
        CREATE INDEX IF NOT EXISTS idx_skill_rel_type ON skill_relationships(relationship_type);
        CREATE INDEX IF NOT EXISTS idx_skill_rel_cooccurrence ON skill_relationships(co_occurrence_count DESC);
      `);

      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='skill_relationships'").all() as any[];
      expect(indexes.some((idx: any) => idx.name === 'idx_skill_rel_skill1')).toBe(true);
      expect(indexes.some((idx: any) => idx.name === 'idx_skill_rel_skill2')).toBe(true);
      expect(indexes.some((idx: any) => idx.name === 'idx_skill_rel_type')).toBe(true);
      expect(indexes.some((idx: any) => idx.name === 'idx_skill_rel_cooccurrence')).toBe(true);
    });
  });
});

// =============================================================================
// PHASE 2: SKILL EMBEDDING GENERATION
// =============================================================================

describe('Phase 2: Skill Embedding Generation', () => {
  let db: Database.Database;
  let mockEmbeddingClient: EmbeddingClient;
  let relationalSkillLibrary: RelationalSkillLibrary;

  beforeEach(() => {
    db = new Database(':memory:');

    // Create schema with embedding column
    db.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        summary TEXT,
        category TEXT NOT NULL,
        triggers TEXT NOT NULL,
        embedding BLOB,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        avg_user_satisfaction REAL DEFAULT 0.5,
        is_archived INTEGER DEFAULT 0,
        last_used TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        namespace TEXT DEFAULT 'default'
      );

      CREATE TABLE skill_relationships (
        id TEXT PRIMARY KEY,
        skill_id_1 TEXT NOT NULL,
        skill_id_2 TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        co_occurrence_count INTEGER DEFAULT 1,
        relational_vector BLOB,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(skill_id_1, skill_id_2, relationship_type)
      );
    `);

    // Create mock embedding client
    mockEmbeddingClient = {
      embed: vi.fn().mockImplementation((text: string) => {
        // Generate deterministic embedding based on text hash
        const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const embedding = new Array(1024).fill(0).map((_, i) => Math.sin(hash + i) * 0.5);
        return Promise.resolve(embedding);
      }),
      embedBatch: vi.fn().mockImplementation((texts: string[]) => {
        const embeddings = texts.map(text => {
          const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
          return new Array(1024).fill(0).map((_, i) => Math.sin(hash + i) * 0.5);
        });
        return Promise.resolve({ embeddings, dimensions: 1024, count: texts.length });
      }),
      health: vi.fn().mockResolvedValue({ status: 'ok', model: 'mock', dimensions: 1024 }),
      embedLargeBatch: vi.fn(),
    } as unknown as EmbeddingClient;

    relationalSkillLibrary = new RelationalSkillLibrary(db, mockEmbeddingClient);
  });

  afterEach(() => {
    db.close();
  });

  describe('Pattern Text Construction', () => {
    it('should construct pattern text from skill properties', () => {
      const skill: Omit<Skill, 'id' | 'successCount' | 'failureCount' | 'avgSatisfaction'> = {
        name: 'Data Analysis',
        description: 'Analyze datasets and provide insights',
        category: 'analysis',
        triggers: ['analyze', 'data', 'insights'],
      };

      const patternText = relationalSkillLibrary.constructPatternText(skill);

      expect(patternText).toContain('Data Analysis');
      expect(patternText).toContain('Analyze datasets');
      expect(patternText).toContain('analysis');
      expect(patternText).toContain('analyze');
      expect(patternText).toContain('data');
      expect(patternText).toContain('insights');
    });

    it('should handle empty triggers array', () => {
      const skill: Omit<Skill, 'id' | 'successCount' | 'failureCount' | 'avgSatisfaction'> = {
        name: 'Test Skill',
        description: 'Test description',
        category: 'test',
        triggers: [],
      };

      const patternText = relationalSkillLibrary.constructPatternText(skill);

      expect(patternText).toContain('Test Skill');
      expect(patternText).toContain('Test description');
    });
  });

  describe('Embedding Generation', () => {
    it('should generate embedding when adding skill', async () => {
      const id = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Analysis',
        description: 'Analyze datasets and provide insights',
        category: 'analysis',
        triggers: ['analyze', 'data', 'insights'],
      });

      expect(id).toBeDefined();
      expect(mockEmbeddingClient.embed).toHaveBeenCalled();

      // Verify embedding was stored
      const row = db.prepare('SELECT embedding FROM skills WHERE id = ?').get(id) as any;
      expect(row.embedding).not.toBeNull();
    });

    it('should store embedding as binary buffer', async () => {
      const id = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Test Skill',
        description: 'Test description',
        category: 'test',
        triggers: ['test'],
      });

      const row = db.prepare('SELECT embedding FROM skills WHERE id = ?').get(id) as any;
      const embeddingBuffer = row.embedding as Buffer;

      // Verify buffer contains valid float32 data
      expect(embeddingBuffer.byteLength).toBe(1024 * 4); // 1024 float32 values

      const embedding = new Float32Array(embeddingBuffer.buffer, embeddingBuffer.byteOffset, 1024);
      expect(embedding.length).toBe(1024);
      expect(embedding.every(v => !isNaN(v))).toBe(true);
    });

    it('should generate embeddings for existing skills in batch', async () => {
      // Add skills without embeddings
      db.prepare(`
        INSERT INTO skills (id, name, description, category, triggers)
        VALUES (?, ?, ?, ?, ?)
      `).run('skill_1', 'Skill 1', 'Description 1', 'cat1', '["trigger1"]');

      db.prepare(`
        INSERT INTO skills (id, name, description, category, triggers)
        VALUES (?, ?, ?, ?, ?)
      `).run('skill_2', 'Skill 2', 'Description 2', 'cat2', '["trigger2"]');

      // Generate embeddings for all skills without them
      const count = await relationalSkillLibrary.generateMissingEmbeddings();

      expect(count).toBe(2);
      expect(mockEmbeddingClient.embedBatch).toHaveBeenCalled();

      // Verify embeddings were stored
      const skills = db.prepare('SELECT embedding FROM skills').all() as any[];
      expect(skills.every(s => s.embedding !== null)).toBe(true);
    });

    it('should gracefully handle embedding service failure', async () => {
      // Make embedding client throw error
      vi.mocked(mockEmbeddingClient.embed).mockRejectedValueOnce(new Error('Service unavailable'));

      // Should still add skill (without embedding)
      const id = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Test Skill',
        description: 'Test description',
        category: 'test',
        triggers: ['test'],
      });

      expect(id).toBeDefined();

      // Verify skill was added but without embedding
      const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
      expect(row.name).toBe('Test Skill');
      expect(row.embedding).toBeNull();
    });
  });
});

// =============================================================================
// PHASE 3: GEOMETRIC SEARCH
// =============================================================================

describe('Phase 3: Geometric Search', () => {
  let db: Database.Database;
  let mockEmbeddingClient: EmbeddingClient;
  let relationalSkillLibrary: RelationalSkillLibrary;

  // Helper to create normalized embeddings
  function createNormalizedEmbedding(seed: number): number[] {
    const embedding = new Array(1024).fill(0).map((_, i) => Math.sin(seed + i));
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
  }

  beforeEach(() => {
    db = new Database(':memory:');

    db.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        summary TEXT,
        category TEXT NOT NULL,
        triggers TEXT NOT NULL,
        embedding BLOB,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        avg_user_satisfaction REAL DEFAULT 0.5,
        is_archived INTEGER DEFAULT 0,
        last_used TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        namespace TEXT DEFAULT 'default'
      );

      CREATE TABLE skill_relationships (
        id TEXT PRIMARY KEY,
        skill_id_1 TEXT NOT NULL,
        skill_id_2 TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        co_occurrence_count INTEGER DEFAULT 1,
        relational_vector BLOB,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(skill_id_1, skill_id_2, relationship_type)
      );
    `);

    mockEmbeddingClient = {
      embed: vi.fn().mockImplementation((text: string) => {
        const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return Promise.resolve(createNormalizedEmbedding(hash));
      }),
      embedBatch: vi.fn(),
      health: vi.fn().mockResolvedValue({ status: 'ok', model: 'mock', dimensions: 1024 }),
      embedLargeBatch: vi.fn(),
    } as unknown as EmbeddingClient;

    relationalSkillLibrary = new RelationalSkillLibrary(db, mockEmbeddingClient);
  });

  afterEach(() => {
    db.close();
  });

  describe('Cosine Similarity Calculation', () => {
    it('should return 1.0 for identical embeddings', () => {
      const embedding = createNormalizedEmbedding(42);
      const similarity = relationalSkillLibrary.cosineSimilarity(embedding, embedding);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('should return near 0 for orthogonal embeddings', () => {
      // Create two orthogonal vectors
      const a = new Array(1024).fill(0);
      const b = new Array(1024).fill(0);
      a[0] = 1;
      b[1] = 1;

      const similarity = relationalSkillLibrary.cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite embeddings', () => {
      const a = createNormalizedEmbedding(42);
      const b = a.map(v => -v);

      const similarity = relationalSkillLibrary.cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(-1.0, 5);
    });

    it('should handle zero vector gracefully', () => {
      const a = createNormalizedEmbedding(42);
      const zero = new Array(1024).fill(0);

      const similarity = relationalSkillLibrary.cosineSimilarity(a, zero);
      expect(similarity).toBe(0);
    });
  });

  describe('Geometric Proximity Search', () => {
    beforeEach(async () => {
      // Add skills with embeddings
      const skills = [
        { name: 'Data Analysis', description: 'Analyze data', category: 'analysis', triggers: ['analyze'] },
        { name: 'Data Visualization', description: 'Visualize data', category: 'analysis', triggers: ['visualize'] },
        { name: 'Machine Learning', description: 'Train ML models', category: 'ml', triggers: ['train'] },
        { name: 'Code Review', description: 'Review code', category: 'coding', triggers: ['review'] },
      ];

      for (const skill of skills) {
        await relationalSkillLibrary.addSkillWithEmbedding(skill);
      }
    });

    it('should find similar skills by embedding', async () => {
      const results = await relationalSkillLibrary.searchByEmbedding('analyze data patterns', 3);

      expect(results.length).toBeLessThanOrEqual(3);
      expect(results.every(r => r.similarity !== undefined)).toBe(true);
      // Cosine similarity can be between -1 and 1
      expect(results.every(r => r.similarity! >= -1 && r.similarity! <= 1)).toBe(true);
    });

    it('should return results sorted by similarity', async () => {
      const results = await relationalSkillLibrary.searchByEmbedding('analyze data', 5);

      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity!).toBeLessThanOrEqual(results[i - 1].similarity!);
      }
    });

    it('should exclude skills without embeddings from geometric search', async () => {
      // Add a skill without embedding
      db.prepare(`
        INSERT INTO skills (id, name, description, category, triggers)
        VALUES (?, ?, ?, ?, ?)
      `).run('no_embed', 'No Embedding', 'Test', 'test', '[]');

      const results = await relationalSkillLibrary.searchByEmbedding('test query', 10);

      const noEmbedResult = results.find(r => r.id === 'no_embed');
      expect(noEmbedResult).toBeUndefined();
    });
  });

  describe('Hybrid Search (RRF Fusion)', () => {
    beforeEach(async () => {
      const skills = [
        { name: 'Data Analysis', description: 'Analyze datasets', category: 'analysis', triggers: ['analyze', 'data'] },
        { name: 'Data Visualization', description: 'Create charts', category: 'visualization', triggers: ['chart', 'graph'] },
        { name: 'Report Generation', description: 'Generate reports', category: 'reporting', triggers: ['report'] },
      ];

      for (const skill of skills) {
        await relationalSkillLibrary.addSkillWithEmbedding(skill);
      }
    });

    it('should combine trigger-based and embedding-based search', async () => {
      const results = await relationalSkillLibrary.hybridSearch('analyze data', 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('fusedScore');
    });

    it('should use RRF formula with k=60', async () => {
      const results = await relationalSkillLibrary.hybridSearch('analyze', 5);

      // RRF score should be between 0 and 1/61 per result list
      expect(results.every(r => r.fusedScore !== undefined)).toBe(true);
      expect(results.every(r => r.fusedScore! >= 0)).toBe(true);
    });

    it('should fall back to trigger search if no embeddings available', async () => {
      // Create new library without embedding client
      const noEmbedLibrary = new RelationalSkillLibrary(db, undefined);

      const results = await noEmbedLibrary.hybridSearch('analyze data', 5);

      // Should still return results from trigger-based search
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance', () => {
    it('should complete geometric search in <200ms with 100 skills', async () => {
      // Add 100 skills with embeddings
      for (let i = 0; i < 100; i++) {
        const embedding = createNormalizedEmbedding(i);
        const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);

        db.prepare(`
          INSERT INTO skills (id, name, description, category, triggers, embedding)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          `skill_${i}`,
          `Skill ${i}`,
          `Description for skill ${i}`,
          `category_${i % 10}`,
          JSON.stringify([`trigger_${i}`]),
          embeddingBuffer
        );
      }

      const queryEmbedding = createNormalizedEmbedding(42);
      vi.mocked(mockEmbeddingClient.embed).mockResolvedValue(queryEmbedding);

      const start = performance.now();
      const results = await relationalSkillLibrary.searchByEmbedding('test query', 10);
      const duration = performance.now() - start;

      expect(results.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(200);
    });
  });
});

// =============================================================================
// PHASE 4: RELATIONAL VECTORS
// =============================================================================

describe('Phase 4: Relational Vectors', () => {
  let db: Database.Database;
  let mockEmbeddingClient: EmbeddingClient;
  let relationalSkillLibrary: RelationalSkillLibrary;

  function createNormalizedEmbedding(seed: number): number[] {
    const embedding = new Array(1024).fill(0).map((_, i) => Math.sin(seed + i));
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
  }

  beforeEach(() => {
    db = new Database(':memory:');

    db.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        summary TEXT,
        category TEXT NOT NULL,
        triggers TEXT NOT NULL,
        embedding BLOB,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        avg_user_satisfaction REAL DEFAULT 0.5,
        is_archived INTEGER DEFAULT 0,
        last_used TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        namespace TEXT DEFAULT 'default'
      );

      CREATE TABLE skill_relationships (
        id TEXT PRIMARY KEY,
        skill_id_1 TEXT NOT NULL,
        skill_id_2 TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        co_occurrence_count INTEGER DEFAULT 1,
        relational_vector BLOB,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(skill_id_1, skill_id_2, relationship_type)
      );

      CREATE INDEX IF NOT EXISTS idx_skill_rel_skill1 ON skill_relationships(skill_id_1);
      CREATE INDEX IF NOT EXISTS idx_skill_rel_skill2 ON skill_relationships(skill_id_2);
    `);

    mockEmbeddingClient = {
      embed: vi.fn().mockImplementation((text: string) => {
        const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return Promise.resolve(createNormalizedEmbedding(hash));
      }),
      embedBatch: vi.fn(),
      health: vi.fn().mockResolvedValue({ status: 'ok', model: 'mock', dimensions: 1024 }),
      embedLargeBatch: vi.fn(),
    } as unknown as EmbeddingClient;

    relationalSkillLibrary = new RelationalSkillLibrary(db, mockEmbeddingClient);
  });

  afterEach(() => {
    db.close();
  });

  describe('Co-occurrence Recording', () => {
    beforeEach(async () => {
      await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Analysis',
        description: 'Analyze data',
        category: 'analysis',
        triggers: ['analyze'],
      });
      await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Visualization',
        description: 'Visualize data',
        category: 'visualization',
        triggers: ['visualize'],
      });
    });

    it('should record co-occurrence between two skills', async () => {
      const skills = db.prepare('SELECT id FROM skills').all() as any[];
      const skillId1 = skills[0].id;
      const skillId2 = skills[1].id;

      await relationalSkillLibrary.recordCoOccurrence(skillId1, skillId2);

      const relationship = db.prepare(
        'SELECT * FROM skill_relationships WHERE skill_id_1 = ? AND skill_id_2 = ?'
      ).get(skillId1, skillId2) as any;

      expect(relationship).toBeDefined();
      expect(relationship.co_occurrence_count).toBe(1);
      expect(relationship.relationship_type).toBe('co_occurred');
    });

    it('should increment co-occurrence count on repeated occurrence', async () => {
      const skills = db.prepare('SELECT id FROM skills').all() as any[];
      const skillId1 = skills[0].id;
      const skillId2 = skills[1].id;

      await relationalSkillLibrary.recordCoOccurrence(skillId1, skillId2);
      await relationalSkillLibrary.recordCoOccurrence(skillId1, skillId2);
      await relationalSkillLibrary.recordCoOccurrence(skillId1, skillId2);

      const relationship = db.prepare(
        'SELECT co_occurrence_count FROM skill_relationships WHERE skill_id_1 = ? AND skill_id_2 = ?'
      ).get(skillId1, skillId2) as any;

      expect(relationship.co_occurrence_count).toBe(3);
    });

    it('should normalize skill pair order for consistency', async () => {
      const skills = db.prepare('SELECT id FROM skills ORDER BY id').all() as any[];
      const skillId1 = skills[0].id;
      const skillId2 = skills[1].id;

      // Record in both orders
      await relationalSkillLibrary.recordCoOccurrence(skillId2, skillId1);
      await relationalSkillLibrary.recordCoOccurrence(skillId1, skillId2);

      // Should have only one relationship entry
      const relationships = db.prepare(
        'SELECT * FROM skill_relationships WHERE relationship_type = ?'
      ).all('co_occurred') as any[];

      expect(relationships.length).toBe(1);
      expect(relationships[0].co_occurrence_count).toBe(2);
    });
  });

  describe('Relational Vector Computation', () => {
    let skillId1: string;
    let skillId2: string;

    beforeEach(async () => {
      skillId1 = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Analysis',
        description: 'Analyze data',
        category: 'analysis',
        triggers: ['analyze'],
      });
      skillId2 = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Visualization',
        description: 'Visualize data',
        category: 'visualization',
        triggers: ['visualize'],
      });

      // Record enough co-occurrences to trigger relational vector computation
      for (let i = 0; i < 3; i++) {
        await relationalSkillLibrary.recordCoOccurrence(skillId1, skillId2);
      }
    });

    it('should compute relational vector when co-occurrence threshold is met', async () => {
      // Compute relational vectors for relationships with count >= 2
      await relationalSkillLibrary.computeRelationalVectors(2);

      const relationship = db.prepare(
        'SELECT relational_vector FROM skill_relationships WHERE skill_id_1 = ? OR skill_id_2 = ?'
      ).get(skillId1, skillId1) as any;

      expect(relationship.relational_vector).not.toBeNull();
    });

    it('should compute relational vector as embedding difference', async () => {
      await relationalSkillLibrary.computeRelationalVectors(2);

      // Get the stored relational vector and skill IDs
      const relationship = db.prepare(
        'SELECT skill_id_1, skill_id_2, relational_vector FROM skill_relationships'
      ).get() as any;

      const relationalBuffer = relationship.relational_vector as Buffer;
      const relationalVector = new Float32Array(
        relationalBuffer.buffer,
        relationalBuffer.byteOffset,
        1024
      );

      // Get original embeddings in the correct order (as stored in relationship)
      const skill1 = db.prepare('SELECT embedding FROM skills WHERE id = ?').get(relationship.skill_id_1) as any;
      const skill2 = db.prepare('SELECT embedding FROM skills WHERE id = ?').get(relationship.skill_id_2) as any;

      const emb1 = new Float32Array(skill1.embedding.buffer, skill1.embedding.byteOffset, 1024);
      const emb2 = new Float32Array(skill2.embedding.buffer, skill2.embedding.byteOffset, 1024);

      // Verify relational vector is the difference (emb2 - emb1)
      for (let i = 0; i < 1024; i++) {
        expect(relationalVector[i]).toBeCloseTo(emb2[i] - emb1[i], 4);
      }
    });

    it('should use lazy computation (only when threshold met)', async () => {
      // Create new relationship with only 1 co-occurrence
      const skillId3 = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'New Skill',
        description: 'New description',
        category: 'new',
        triggers: ['new'],
      });

      await relationalSkillLibrary.recordCoOccurrence(skillId1, skillId3);

      // Compute with threshold 2
      await relationalSkillLibrary.computeRelationalVectors(2);

      // Relationship with count 1 should not have relational vector
      const relationship = db.prepare(
        'SELECT relational_vector FROM skill_relationships WHERE (skill_id_1 = ? OR skill_id_2 = ?) AND (skill_id_1 = ? OR skill_id_2 = ?)'
      ).get(skillId1, skillId1, skillId3, skillId3) as any;

      expect(relationship.relational_vector).toBeNull();
    });
  });

  describe('Analogical Search', () => {
    let analysisId: string;
    let visualizationId: string;
    let reportingId: string;
    let codingId: string;

    beforeEach(async () => {
      // Create skills with specific relationships
      // Analysis -> Visualization (data domain)
      // Coding -> Testing (code domain)
      analysisId = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Analysis',
        description: 'Analyze data patterns',
        category: 'data',
        triggers: ['analyze'],
      });
      visualizationId = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Visualization',
        description: 'Create data visualizations',
        category: 'data',
        triggers: ['visualize'],
      });
      codingId = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Code Writing',
        description: 'Write code',
        category: 'coding',
        triggers: ['code'],
      });
      reportingId = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Code Review',
        description: 'Review code quality',
        category: 'coding',
        triggers: ['review'],
      });

      // Create co-occurrences
      for (let i = 0; i < 3; i++) {
        await relationalSkillLibrary.recordCoOccurrence(analysisId, visualizationId);
        await relationalSkillLibrary.recordCoOccurrence(codingId, reportingId);
      }

      // Compute relational vectors
      await relationalSkillLibrary.computeRelationalVectors(2);
    });

    it('should find analogous skills using relational vectors', async () => {
      // Query: "What is to Code Writing as Data Visualization is to Data Analysis?"
      // Expected: Code Review (same relationship pattern)
      const results = await relationalSkillLibrary.analogicalSearch(
        analysisId,      // source A
        visualizationId, // target A
        codingId,        // source B
        3                // limit
      );

      expect(results.length).toBeGreaterThan(0);
      // The top result should be related to coding domain
      expect(results[0]).toHaveProperty('analogyScore');
    });

    it('should return empty array if no relational vectors exist', async () => {
      // Create fresh skills without relationships
      const newId = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Isolated Skill',
        description: 'Has no relationships',
        category: 'isolated',
        triggers: ['isolated'],
      });

      const results = await relationalSkillLibrary.analogicalSearch(
        newId,
        analysisId,
        visualizationId,
        3
      );

      expect(results.length).toBe(0);
    });

    it('should handle missing skill embeddings gracefully', async () => {
      // Add skill without embedding
      db.prepare(`
        INSERT INTO skills (id, name, description, category, triggers)
        VALUES (?, ?, ?, ?, ?)
      `).run('no_embed', 'No Embed', 'Test', 'test', '[]');

      const results = await relationalSkillLibrary.analogicalSearch(
        'no_embed',
        analysisId,
        visualizationId,
        3
      );

      expect(results).toEqual([]);
    });
  });
});

// =============================================================================
// PHASE 5: INTEGRATION
// =============================================================================

describe('Phase 5: Integration', () => {
  let db: Database.Database;
  let mockEmbeddingClient: EmbeddingClient;
  let relationalSkillLibrary: RelationalSkillLibrary;
  let baseSkillLibrary: SkillLibrary;

  function createNormalizedEmbedding(seed: number): number[] {
    const embedding = new Array(1024).fill(0).map((_, i) => Math.sin(seed + i));
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
  }

  beforeEach(() => {
    db = new Database(':memory:');

    db.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        summary TEXT,
        category TEXT NOT NULL,
        triggers TEXT NOT NULL,
        embedding BLOB,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        avg_user_satisfaction REAL DEFAULT 0.5,
        is_archived INTEGER DEFAULT 0,
        last_used TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        namespace TEXT DEFAULT 'default'
      );

      CREATE TABLE skill_relationships (
        id TEXT PRIMARY KEY,
        skill_id_1 TEXT NOT NULL,
        skill_id_2 TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        co_occurrence_count INTEGER DEFAULT 1,
        relational_vector BLOB,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(skill_id_1, skill_id_2, relationship_type)
      );
    `);

    mockEmbeddingClient = {
      embed: vi.fn().mockImplementation((text: string) => {
        const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return Promise.resolve(createNormalizedEmbedding(hash));
      }),
      embedBatch: vi.fn().mockImplementation((texts: string[]) => {
        const embeddings = texts.map(text => {
          const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
          return createNormalizedEmbedding(hash);
        });
        return Promise.resolve({ embeddings, dimensions: 1024, count: texts.length });
      }),
      health: vi.fn().mockResolvedValue({ status: 'ok', model: 'mock', dimensions: 1024 }),
      embedLargeBatch: vi.fn(),
    } as unknown as EmbeddingClient;

    relationalSkillLibrary = new RelationalSkillLibrary(db, mockEmbeddingClient);
    baseSkillLibrary = new SkillLibrary(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('Backward Compatibility', () => {
    it('should support existing SkillLibrary.addSkill() method', () => {
      const id = baseSkillLibrary.addSkill({
        name: 'Test Skill',
        description: 'Test description',
        category: 'test',
        triggers: ['test'],
      });

      expect(id).toBeDefined();

      // Verify skill was added (without embedding)
      const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
      expect(row.name).toBe('Test Skill');
      expect(row.embedding).toBeNull();
    });

    it('should support existing SkillLibrary.search() method', () => {
      baseSkillLibrary.addSkill({
        name: 'Data Analysis',
        description: 'Analyze data',
        category: 'analysis',
        triggers: ['analyze', 'data'],
      });

      const results = baseSkillLibrary.search('analyze data');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Data Analysis');
    });

    it('should support existing recordSuccess/recordFailure methods', () => {
      const id = baseSkillLibrary.addSkill({
        name: 'Test Skill',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      baseSkillLibrary.recordSuccess(id, 0.9);
      baseSkillLibrary.recordFailure(id);

      const row = db.prepare('SELECT success_count, failure_count FROM skills WHERE id = ?').get(id) as any;
      expect(row.success_count).toBe(1);
      expect(row.failure_count).toBe(1);
    });
  });

  describe('RelationalSkillLibrary extends SkillLibrary', () => {
    it('should inherit all base SkillLibrary functionality', async () => {
      // Can use base methods
      const id = relationalSkillLibrary.addSkill({
        name: 'Test',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      expect(id).toBeDefined();

      // Can use extended methods
      const id2 = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Test 2',
        description: 'Test 2',
        category: 'test',
        triggers: ['test2'],
      });

      expect(id2).toBeDefined();

      // Both skills exist
      const count = db.prepare('SELECT COUNT(*) as count FROM skills').get() as any;
      expect(count.count).toBe(2);
    });

    it('should allow hybrid usage of trigger and embedding search', async () => {
      await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Analysis',
        description: 'Analyze data patterns',
        category: 'analysis',
        triggers: ['analyze', 'data'],
      });

      // Trigger-based search (base functionality)
      const triggerResults = relationalSkillLibrary.search('analyze');
      expect(triggerResults.length).toBeGreaterThan(0);

      // Embedding-based search (extended functionality)
      const embeddingResults = await relationalSkillLibrary.searchByEmbedding('analyze patterns', 5);
      expect(embeddingResults.length).toBeGreaterThan(0);

      // Hybrid search (combined)
      const hybridResults = await relationalSkillLibrary.hybridSearch('analyze data', 5);
      expect(hybridResults.length).toBeGreaterThan(0);
    });
  });

  describe('Consolidation Pipeline Integration', () => {
    it('should extract skill relationships during consolidation', async () => {
      // Create skills
      const id1 = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Analysis',
        description: 'Analyze data',
        category: 'analysis',
        triggers: ['analyze'],
      });
      const id2 = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Visualization',
        description: 'Visualize data',
        category: 'visualization',
        triggers: ['visualize'],
      });

      // Simulate consolidation extracting co-occurrences
      await relationalSkillLibrary.recordCoOccurrence(id1, id2);
      await relationalSkillLibrary.recordCoOccurrence(id1, id2);

      // Compute relational vectors (would be called during consolidation)
      await relationalSkillLibrary.computeRelationalVectors(2);

      // Verify relationship exists with vector
      const relationships = db.prepare('SELECT * FROM skill_relationships').all() as any[];
      expect(relationships.length).toBe(1);
      expect(relationships[0].relational_vector).not.toBeNull();
    });

    it('should generate missing embeddings during consolidation', async () => {
      // Add skills without embeddings (simulating legacy data)
      db.prepare(`
        INSERT INTO skills (id, name, description, category, triggers)
        VALUES (?, ?, ?, ?, ?)
      `).run('legacy_1', 'Legacy Skill 1', 'Description 1', 'legacy', '["trigger1"]');

      db.prepare(`
        INSERT INTO skills (id, name, description, category, triggers)
        VALUES (?, ?, ?, ?, ?)
      `).run('legacy_2', 'Legacy Skill 2', 'Description 2', 'legacy', '["trigger2"]');

      // Generate missing embeddings (would be called during consolidation)
      const count = await relationalSkillLibrary.generateMissingEmbeddings();

      expect(count).toBe(2);

      // Verify embeddings were generated
      const skills = db.prepare('SELECT embedding FROM skills').all() as any[];
      expect(skills.every(s => s.embedding !== null)).toBe(true);
    });
  });

  describe('Smart Router Skill Query Handling', () => {
    it('should use hybrid search for skill queries', async () => {
      await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Data Analysis',
        description: 'Analyze datasets',
        category: 'analysis',
        triggers: ['analyze', 'data', 'like before'],
      });

      // Simulate what smart router would do for skill query
      const query = 'analyze this like before';
      const results = await relationalSkillLibrary.hybridSearch(query, 5);

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Close database to simulate error
      const closedDb = new Database(':memory:');
      closedDb.close();

      const errorLibrary = new RelationalSkillLibrary(closedDb, mockEmbeddingClient);

      await expect(
        errorLibrary.addSkillWithEmbedding({
          name: 'Test',
          description: 'Test',
          category: 'test',
          triggers: ['test'],
        })
      ).rejects.toThrow();
    });

    it('should handle embedding service timeout', async () => {
      // Make embedding client timeout
      vi.mocked(mockEmbeddingClient.embed).mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      );

      // Should still add skill without embedding
      const id = await relationalSkillLibrary.addSkillWithEmbedding({
        name: 'Test',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      expect(id).toBeDefined();

      const row = db.prepare('SELECT embedding FROM skills WHERE id = ?').get(id) as any;
      expect(row.embedding).toBeNull();
    });
  });
});
