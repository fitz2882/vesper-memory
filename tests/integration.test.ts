/**
 * Integration Tests - Memory System v3.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Redis } from 'ioredis';
import Database from 'better-sqlite3';
import { WorkingMemoryLayer } from '../src/memory-layers/working-memory.js';
import { SemanticMemoryLayer } from '../src/memory-layers/semantic-memory.js';
import { SkillLibrary } from '../src/memory-layers/skill-library.js';
import { ConflictDetector } from '../src/synthesis/conflict-detector.js';
import { classifyQuery, QueryType } from '../src/router/smart-router.js';

describe('Working Memory Layer', () => {
  let redis: Redis;
  let workingMemory: WorkingMemoryLayer;

  beforeEach(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: 3,  // Use database 3 for integration tests
    });
    workingMemory = new WorkingMemoryLayer(redis);
    await workingMemory.clear();
  });

  afterEach(async () => {
    await workingMemory.clear();
    await redis.quit();
  });

  it('should store and retrieve memories', async () => {
    await workingMemory.store({
      conversationId: 'test-1',
      timestamp: new Date(),
      fullText: 'User prefers Python over JavaScript',
      keyEntities: ['Python', 'JavaScript'],
      topics: ['programming'],
      userIntent: 'express preference',
    });

    const recent = await workingMemory.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].conversationId).toBe('test-1');
  });

  it('should limit to 5 conversations', async () => {
    for (let i = 0; i < 10; i++) {
      await workingMemory.store({
        conversationId: `test-${i}`,
        timestamp: new Date(),
        fullText: `Conversation ${i}`,
        keyEntities: [],
        topics: [],
        userIntent: 'test',
      });
    }

    const recent = await workingMemory.getRecent();
    expect(recent.length).toBeLessThanOrEqual(5);
  });

  it('should search by keywords', async () => {
    await workingMemory.store({
      conversationId: 'test-python',
      timestamp: new Date(),
      fullText: 'I really like Python programming',
      keyEntities: ['Python'],
      topics: ['programming'],
      userIntent: 'preference',
    });

    const results = await workingMemory.search('Python');
    expect(results).toHaveLength(1);
    expect(results[0].similarity).toBeGreaterThan(0);
  });
});

describe('Semantic Memory Layer', () => {
  let db: Database.Database;
  let semanticMemory: SemanticMemoryLayer;

  beforeEach(() => {
    db = new Database(':memory:');

    // Create minimal schema
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        confidence REAL DEFAULT 1.0,
        created_at TEXT NOT NULL,
        last_accessed TEXT NOT NULL,
        access_count INTEGER DEFAULT 1,
        namespace TEXT DEFAULT 'default'
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        strength REAL DEFAULT 0.8,
        evidence TEXT,
        created_at TEXT NOT NULL,
        last_reinforced TEXT NOT NULL,
        namespace TEXT DEFAULT 'default'
      );

      CREATE TABLE facts (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        property TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        valid_from TEXT,
        valid_until TEXT,
        source_conversation TEXT,
        namespace TEXT DEFAULT 'default'
      );
    `);

    semanticMemory = new SemanticMemoryLayer(db);
  });

  it('should upsert entities', () => {
    const entity = semanticMemory.upsertEntity({
      name: 'Python',
      type: 'concept',
      confidence: 0.9,
    });

    expect(entity.id).toBeDefined();
    expect(entity.name).toBe('Python');

    // Upsert again should update access count
    const entity2 = semanticMemory.upsertEntity({
      name: 'Python',
      type: 'concept',
    });

    expect(entity2.id).toBe(entity.id);
  });

  it('should create relationships', () => {
    const user = semanticMemory.upsertEntity({ name: 'User', type: 'person' });
    const python = semanticMemory.upsertEntity({ name: 'Python', type: 'concept' });

    semanticMemory.upsertRelationship({
      sourceId: user.id,
      targetId: python.id,
      relationType: 'prefers',
      strength: 0.9,
    });

    // Verify relationship was created
    const rels = db.prepare('SELECT * FROM relationships').all();
    expect(rels).toHaveLength(1);
  });

  it('should perform Personalized PageRank traversal', () => {
    const user = semanticMemory.upsertEntity({ name: 'User', type: 'person' });
    const python = semanticMemory.upsertEntity({ name: 'Python', type: 'concept' });
    const django = semanticMemory.upsertEntity({ name: 'Django', type: 'concept' });

    semanticMemory.upsertRelationship({
      sourceId: user.id,
      targetId: python.id,
      relationType: 'prefers',
    });

    semanticMemory.upsertRelationship({
      sourceId: python.id,
      targetId: django.id,
      relationType: 'related_to',
    });

    const results = semanticMemory.personalizedPageRank(user.id, 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].relevanceScore).toBe(1.0); // Starting node
  });
});

describe('Smart Query Router', () => {
  it('should classify factual queries', () => {
    const result = classifyQuery("What is my dog's name?");
    expect(result.type).toBe(QueryType.FACTUAL);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('should classify preference queries', () => {
    const result = classifyQuery('What do I prefer for breakfast?');
    expect(result.type).toBe(QueryType.PREFERENCE);
  });

  it('should classify project queries', () => {
    const result = classifyQuery('What did we decide about the MetricPilot project?');
    expect(result.type).toBe(QueryType.PROJECT);
  });

  it('should classify temporal queries', () => {
    const result = classifyQuery('What were we working on last week?');
    expect(result.type).toBe(QueryType.TEMPORAL);
  });

  it('should classify skill queries', () => {
    const result = classifyQuery('Analyze this like before');
    expect(result.type).toBe(QueryType.SKILL);
  });

  it('should default to complex for ambiguous queries', () => {
    const result = classifyQuery('Tell me more');
    expect(result.type).toBe(QueryType.COMPLEX);
  });
});

describe('Conflict Detection', () => {
  let db: Database.Database;
  let detector: ConflictDetector;

  beforeEach(() => {
    db = new Database(':memory:');

    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        created_at TEXT,
        description TEXT,
        namespace TEXT DEFAULT 'default'
      );

      CREATE TABLE facts (
        id TEXT PRIMARY KEY,
        entity_id TEXT,
        property TEXT,
        value TEXT,
        confidence REAL,
        valid_from TEXT,
        valid_until TEXT,
        namespace TEXT DEFAULT 'default'
      );

      CREATE TABLE conflicts (
        id TEXT PRIMARY KEY,
        fact_id_1 TEXT,
        fact_id_2 TEXT,
        conflict_type TEXT,
        description TEXT,
        severity TEXT,
        resolution_status TEXT,
        namespace TEXT DEFAULT 'default'
      );
    `);

    detector = new ConflictDetector(db);
  });

  it('should detect direct contradictions', () => {
    db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
      'e1', 'User', 'person', new Date().toISOString()
    );

    db.prepare(`
      INSERT INTO facts (id, entity_id, property, value, confidence, valid_from)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('f1', 'e1', 'favorite_language', 'Python', 1.0, new Date().toISOString());

    db.prepare(`
      INSERT INTO facts (id, entity_id, property, value, confidence, valid_from)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('f2', 'e1', 'favorite_language', 'JavaScript', 1.0, new Date().toISOString());

    const conflicts = detector.detectAll();
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].conflictType).toBe('contradiction');
  });
});
