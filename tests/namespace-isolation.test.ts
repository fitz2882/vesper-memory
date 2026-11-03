/**
 * Tests for Namespace Isolation
 *
 * Verifies that namespace parameter provides complete isolation across
 * all memory layers: SemanticMemoryLayer, SkillLibrary, and ConflictDetector.
 *
 * ~30 tests covering:
 * - Entity/relationship isolation
 * - Skill library isolation
 * - Conflict detection isolation
 * - Edge cases and special characters
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SemanticMemoryLayer } from '../src/memory-layers/semantic-memory.js';
import { SkillLibrary } from '../src/memory-layers/skill-library.js';
import { ConflictDetector } from '../src/synthesis/conflict-detector.js';

describe('Namespace Isolation', () => {
  let db: Database.Database;
  let semantic: SemanticMemoryLayer;
  let skillLib: SkillLibrary;
  let conflictDetector: ConflictDetector;

  beforeEach(() => {
    db = new Database(':memory:');

    // Create schema with namespace columns
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

      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        summary TEXT,
        category TEXT,
        triggers TEXT,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        avg_user_satisfaction REAL DEFAULT 0.5,
        is_archived INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used TEXT,
        namespace TEXT DEFAULT 'default'
      );
    `);

    semantic = new SemanticMemoryLayer(db);
    skillLib = new SkillLibrary(db);
    conflictDetector = new ConflictDetector(db);
  });

  describe('SemanticMemory Namespace Isolation', () => {
    it('should isolate entities between namespaces', () => {
      // Add entity to namespace A
      const entityA = semantic.upsertEntity(
        { name: 'Python', type: 'concept', confidence: 0.9 },
        'namespace-a'
      );

      // Add entity to namespace B
      const entityB = semantic.upsertEntity(
        { name: 'JavaScript', type: 'concept', confidence: 0.85 },
        'namespace-b'
      );

      // Verify entity A is only in namespace A
      const foundA = semantic.getEntity('Python', 'namespace-a');
      expect(foundA).toBeTruthy();
      expect(foundA.name).toBe('Python');

      // Verify entity A is NOT in namespace B
      const notFoundA = semantic.getEntity('Python', 'namespace-b');
      expect(notFoundA).toBeNull();

      // Verify entity B is only in namespace B
      const foundB = semantic.getEntity('JavaScript', 'namespace-b');
      expect(foundB).toBeTruthy();
      expect(foundB.name).toBe('JavaScript');

      // Verify entity B is NOT in namespace A
      const notFoundB = semantic.getEntity('JavaScript', 'namespace-a');
      expect(notFoundB).toBeNull();
    });

    it('should allow same entity name in different namespaces', () => {
      // Add "Python" entity to namespace A
      const entityA = semantic.upsertEntity(
        { name: 'Python', type: 'concept', description: 'Programming language', confidence: 0.9 },
        'namespace-a'
      );

      // Add "Python" entity to namespace B with different properties
      const entityB = semantic.upsertEntity(
        { name: 'Python', type: 'concept', description: 'Snake species', confidence: 0.8 },
        'namespace-b'
      );

      // Verify they have different IDs
      expect(entityA.id).not.toBe(entityB.id);

      // Verify namespace A has programming language version
      const foundA = semantic.getEntity('Python', 'namespace-a');
      expect(foundA.description).toBe('Programming language');
      expect(foundA.confidence).toBe(0.9);

      // Verify namespace B has snake version
      const foundB = semantic.getEntity('Python', 'namespace-b');
      expect(foundB.description).toBe('Snake species');
      expect(foundB.confidence).toBe(0.8);
    });

    it('should scope relationships to namespace', () => {
      // Create entities in namespace A
      const e1 = semantic.upsertEntity({ name: 'Alice', type: 'person' }, 'namespace-a');
      const e2 = semantic.upsertEntity({ name: 'ProjectX', type: 'project' }, 'namespace-a');

      // Create relationship in namespace A
      semantic.upsertRelationship(
        { sourceId: e1.id, targetId: e2.id, relationType: 'works_on', strength: 0.9 },
        'namespace-a'
      );

      // Verify relationship exists in namespace A via PageRank
      const resultsA = semantic.personalizedPageRank(e1.id, 2, 'namespace-a');
      expect(resultsA.length).toBeGreaterThan(0);
      const projectFound = resultsA.find((r: any) => r.name === 'ProjectX');
      expect(projectFound).toBeTruthy();

      // Create same entities in namespace B
      const e3 = semantic.upsertEntity({ name: 'Alice', type: 'person' }, 'namespace-b');
      const e4 = semantic.upsertEntity({ name: 'ProjectY', type: 'project' }, 'namespace-b');

      // Create relationship in namespace B
      semantic.upsertRelationship(
        { sourceId: e3.id, targetId: e4.id, relationType: 'works_on', strength: 0.8 },
        'namespace-b'
      );

      // Verify PageRank in namespace B only finds ProjectY, not ProjectX
      const resultsB = semantic.personalizedPageRank(e3.id, 2, 'namespace-b');
      const projectYFound = resultsB.find((r: any) => r.name === 'ProjectY');
      const projectXFound = resultsB.find((r: any) => r.name === 'ProjectX');
      expect(projectYFound).toBeTruthy();
      expect(projectXFound).toBeFalsy();
    });

    it('should keep PageRank traversal within namespace boundaries', () => {
      // Build a graph in namespace A: E1 -> E2 -> E3
      const e1a = semantic.upsertEntity({ name: 'E1', type: 'concept' }, 'namespace-a');
      const e2a = semantic.upsertEntity({ name: 'E2', type: 'concept' }, 'namespace-a');
      const e3a = semantic.upsertEntity({ name: 'E3', type: 'concept' }, 'namespace-a');

      semantic.upsertRelationship(
        { sourceId: e1a.id, targetId: e2a.id, relationType: 'related_to' },
        'namespace-a'
      );
      semantic.upsertRelationship(
        { sourceId: e2a.id, targetId: e3a.id, relationType: 'related_to' },
        'namespace-a'
      );

      // Build a different graph in namespace B: E1 -> E4
      const e1b = semantic.upsertEntity({ name: 'E1', type: 'concept' }, 'namespace-b');
      const e4b = semantic.upsertEntity({ name: 'E4', type: 'concept' }, 'namespace-b');

      semantic.upsertRelationship(
        { sourceId: e1b.id, targetId: e4b.id, relationType: 'related_to' },
        'namespace-b'
      );

      // PageRank from E1 in namespace A should reach E2 and E3, but not E4
      const resultsA = semantic.personalizedPageRank(e1a.id, 3, 'namespace-a');
      const namesA = resultsA.map((r: any) => r.name);
      expect(namesA).toContain('E1');
      expect(namesA).toContain('E2');
      expect(namesA).toContain('E3');
      expect(namesA).not.toContain('E4');

      // PageRank from E1 in namespace B should reach E4, but not E2 or E3
      const resultsB = semantic.personalizedPageRank(e1b.id, 3, 'namespace-b');
      const namesB = resultsB.map((r: any) => r.name);
      expect(namesB).toContain('E1');
      expect(namesB).toContain('E4');
      expect(namesB).not.toContain('E2');
      expect(namesB).not.toContain('E3');
    });

    it('should apply temporal decay only to target namespace', () => {
      // Create relationships in namespace A with old timestamp
      const e1a = semantic.upsertEntity({ name: 'NodeA', type: 'concept' }, 'namespace-a');
      const e2a = semantic.upsertEntity({ name: 'NodeB', type: 'concept' }, 'namespace-a');
      semantic.upsertRelationship(
        { sourceId: e1a.id, targetId: e2a.id, relationType: 'links_to', strength: 1.0 },
        'namespace-a'
      );

      // Manually update last_reinforced to 30 days ago for decay to have effect
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        'UPDATE relationships SET last_reinforced = ? WHERE namespace = ?'
      ).run(thirtyDaysAgo, 'namespace-a');

      // Create relationships in namespace B
      const e1b = semantic.upsertEntity({ name: 'NodeC', type: 'concept' }, 'namespace-b');
      const e2b = semantic.upsertEntity({ name: 'NodeD', type: 'concept' }, 'namespace-b');
      semantic.upsertRelationship(
        { sourceId: e1b.id, targetId: e2b.id, relationType: 'links_to', strength: 1.0 },
        'namespace-b'
      );

      // Apply decay to namespace A only
      const decayed = semantic.applyTemporalDecay('namespace-a');
      expect(decayed).toBe(1); // One relationship in namespace A

      // Check that namespace A relationships were decayed
      const relA = db.prepare(
        'SELECT strength FROM relationships WHERE namespace = ?'
      ).get('namespace-a') as any;
      expect(relA.strength).toBeLessThan(1.0);

      // Check that namespace B relationships were NOT decayed
      const relB = db.prepare(
        'SELECT strength FROM relationships WHERE namespace = ?'
      ).get('namespace-b') as any;
      expect(relB.strength).toBe(1.0);
    });

    it('should scope getPreferences to namespace', () => {
      // Add preferences to namespace A
      semantic.upsertEntity(
        { name: 'TypeScript', type: 'preference', description: 'Language preference' },
        'namespace-a'
      );
      semantic.upsertEntity(
        { name: 'Vim', type: 'preference', description: 'Editor preference' },
        'namespace-a'
      );

      // Add preferences to namespace B
      semantic.upsertEntity(
        { name: 'Python', type: 'preference', description: 'Language preference' },
        'namespace-b'
      );

      // Get preferences from namespace A
      const prefsA = semantic.getPreferences(undefined, 'namespace-a');
      expect(prefsA.length).toBe(2);
      const namesA = prefsA.map((p: any) => p.name);
      expect(namesA).toContain('TypeScript');
      expect(namesA).toContain('Vim');
      expect(namesA).not.toContain('Python');

      // Get preferences from namespace B
      const prefsB = semantic.getPreferences(undefined, 'namespace-b');
      expect(prefsB.length).toBe(1);
      expect(prefsB[0].name).toBe('Python');
    });

    it('should scope getByTimeRange to namespace', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Add entities to namespace A
      semantic.upsertEntity({ name: 'RecentA', type: 'concept' }, 'namespace-a');

      // Add entities to namespace B
      semantic.upsertEntity({ name: 'RecentB', type: 'concept' }, 'namespace-b');

      // Query namespace A
      const resultsA = semantic.getByTimeRange(yesterday, tomorrow, 'namespace-a');
      const namesA = resultsA.map((r: any) => r.name);
      expect(namesA).toContain('RecentA');
      expect(namesA).not.toContain('RecentB');

      // Query namespace B
      const resultsB = semantic.getByTimeRange(yesterday, tomorrow, 'namespace-b');
      const namesB = resultsB.map((r: any) => r.name);
      expect(namesB).toContain('RecentB');
      expect(namesB).not.toContain('RecentA');
    });

    it('should use default namespace when not specified', () => {
      // Add entity without namespace parameter (should use 'default')
      const entity = semantic.upsertEntity({ name: 'DefaultEntity', type: 'concept' });

      // Should be retrievable from 'default' namespace
      const found = semantic.getEntity('DefaultEntity', 'default');
      expect(found).toBeTruthy();
      expect(found.name).toBe('DefaultEntity');

      // Should also be retrievable without specifying namespace
      const foundImplicit = semantic.getEntity('DefaultEntity');
      expect(foundImplicit).toBeTruthy();
      expect(foundImplicit.name).toBe('DefaultEntity');

      // Should NOT be in other namespaces
      const notFound = semantic.getEntity('DefaultEntity', 'other-namespace');
      expect(notFound).toBeNull();
    });

    it('should increment access count only in target namespace', () => {
      // Create same entity name in two namespaces
      semantic.upsertEntity({ name: 'SharedName', type: 'concept' }, 'namespace-a');
      semantic.upsertEntity({ name: 'SharedName', type: 'concept' }, 'namespace-b');

      // Access entity in namespace A multiple times
      semantic.getEntity('SharedName', 'namespace-a');
      semantic.getEntity('SharedName', 'namespace-a');
      semantic.getEntity('SharedName', 'namespace-a');

      // Check access count in namespace A
      const entityA = db.prepare(
        'SELECT access_count FROM entities WHERE name = ? AND namespace = ?'
      ).get('SharedName', 'namespace-a') as any;
      expect(entityA.access_count).toBe(4); // 1 from upsert + 3 from getEntity

      // Check access count in namespace B (should be 1 from creation only)
      const entityB = db.prepare(
        'SELECT access_count FROM entities WHERE name = ? AND namespace = ?'
      ).get('SharedName', 'namespace-b') as any;
      expect(entityB.access_count).toBe(1);
    });

    it('should handle empty namespace by using empty string as-is', () => {
      // Empty string is treated as a valid namespace (not defaulted to 'default')
      const entity = semantic.upsertEntity({ name: 'TestEntity', type: 'concept' }, '');

      // Should be findable with empty string namespace
      const found = semantic.getEntity('TestEntity', '');
      expect(found).toBeTruthy();

      // Should NOT be in 'default' namespace (empty string is its own namespace)
      const notInDefault = semantic.getEntity('TestEntity', 'default');
      expect(notInDefault).toBeNull();
    });

    it('should allow namespace with special characters', () => {
      // Test hyphens
      const e1 = semantic.upsertEntity({ name: 'Entity1', type: 'concept' }, 'my-namespace');
      const found1 = semantic.getEntity('Entity1', 'my-namespace');
      expect(found1).toBeTruthy();

      // Test underscores
      const e2 = semantic.upsertEntity({ name: 'Entity2', type: 'concept' }, 'my_namespace');
      const found2 = semantic.getEntity('Entity2', 'my_namespace');
      expect(found2).toBeTruthy();

      // Test dots
      const e3 = semantic.upsertEntity({ name: 'Entity3', type: 'concept' }, 'com.example.namespace');
      const found3 = semantic.getEntity('Entity3', 'com.example.namespace');
      expect(found3).toBeTruthy();
    });

    it('should return empty results for non-existent namespace', () => {
      // Add some data to namespace A
      semantic.upsertEntity({ name: 'Data', type: 'concept' }, 'namespace-a');

      // Query non-existent namespace
      const entity = semantic.getEntity('Data', 'non-existent');
      expect(entity).toBeNull();

      const prefs = semantic.getPreferences(undefined, 'non-existent');
      expect(prefs.length).toBe(0);

      const timeRange = semantic.getByTimeRange(new Date(), new Date(), 'non-existent');
      expect(timeRange.length).toBe(0);
    });
  });

  describe('SkillLibrary Namespace Isolation', () => {
    it('should isolate skills between namespaces', () => {
      // Add skill to namespace A
      const skillIdA = skillLib.addSkill(
        {
          name: 'CodeReview',
          description: 'Review code for bugs',
          category: 'development',
          triggers: ['review', 'code'],
        },
        'namespace-a'
      );

      // Add skill to namespace B
      const skillIdB = skillLib.addSkill(
        {
          name: 'DataAnalysis',
          description: 'Analyze data patterns',
          category: 'analytics',
          triggers: ['analyze', 'data'],
        },
        'namespace-b'
      );

      // Search in namespace A
      const resultsA = skillLib.search('code', 5, 'namespace-a');
      expect(resultsA.length).toBe(1);
      expect(resultsA[0].name).toBe('CodeReview');

      // Search in namespace B
      const resultsB = skillLib.search('data', 5, 'namespace-b');
      expect(resultsB.length).toBe(1);
      expect(resultsB[0].name).toBe('DataAnalysis');
    });

    it('should allow same skill name in different namespaces', () => {
      // Add "Debug" skill to namespace A
      const skillIdA = skillLib.addSkill(
        {
          name: 'Debug',
          description: 'Debug JavaScript code',
          category: 'js-development',
          triggers: ['debug', 'js'],
        },
        'namespace-a'
      );

      // Add "Debug" skill to namespace B with different details
      const skillIdB = skillLib.addSkill(
        {
          name: 'Debug',
          description: 'Debug Python code',
          category: 'py-development',
          triggers: ['debug', 'python'],
        },
        'namespace-b'
      );

      // Verify they are different skills
      expect(skillIdA).not.toBe(skillIdB);

      // Verify namespace A has JS version
      const resultsA = skillLib.search('debug', 5, 'namespace-a');
      expect(resultsA.length).toBe(1);
      expect(resultsA[0].description).toBe('Debug JavaScript code');

      // Verify namespace B has Python version
      const resultsB = skillLib.search('debug', 5, 'namespace-b');
      expect(resultsB.length).toBe(1);
      expect(resultsB[0].description).toBe('Debug Python code');
    });

    it('should scope search to namespace', () => {
      // Add multiple skills to namespace A
      skillLib.addSkill(
        {
          name: 'Skill1',
          description: 'First skill',
          category: 'cat1',
          triggers: ['trigger1'],
        },
        'namespace-a'
      );
      skillLib.addSkill(
        {
          name: 'Skill2',
          description: 'Second skill',
          category: 'cat1',
          triggers: ['trigger2'],
        },
        'namespace-a'
      );

      // Add skill to namespace B
      skillLib.addSkill(
        {
          name: 'Skill3',
          description: 'Third skill',
          category: 'cat2',
          triggers: ['trigger3'],
        },
        'namespace-b'
      );

      // Search in namespace A should return only namespace A skills
      const resultsA = skillLib.search('trigger', 10, 'namespace-a');
      expect(resultsA.length).toBe(2);
      const namesA = resultsA.map(s => s.name);
      expect(namesA).toContain('Skill1');
      expect(namesA).toContain('Skill2');
      expect(namesA).not.toContain('Skill3');

      // Search in namespace B should return only namespace B skills
      const resultsB = skillLib.search('trigger', 10, 'namespace-b');
      expect(resultsB.length).toBe(1);
      expect(resultsB[0].name).toBe('Skill3');
    });

    it('should use default namespace when not specified', () => {
      // Add skill without namespace (should use 'default')
      const skillId = skillLib.addSkill({
        name: 'DefaultSkill',
        description: 'A default skill',
        category: 'general',
        triggers: ['default'],
      });

      // Should be searchable in 'default' namespace
      const resultsExplicit = skillLib.search('default', 5, 'default');
      expect(resultsExplicit.length).toBe(1);
      expect(resultsExplicit[0].name).toBe('DefaultSkill');

      // Should also be searchable without specifying namespace
      const resultsImplicit = skillLib.search('default', 5);
      expect(resultsImplicit.length).toBe(1);
      expect(resultsImplicit[0].name).toBe('DefaultSkill');

      // Should NOT be in other namespaces
      const resultsOther = skillLib.search('default', 5, 'other-namespace');
      expect(resultsOther.length).toBe(0);
    });

    it('should return empty results for non-existent namespace', () => {
      // Add skill to namespace A
      skillLib.addSkill(
        {
          name: 'TestSkill',
          description: 'Test skill',
          category: 'test',
          triggers: ['test'],
        },
        'namespace-a'
      );

      // Search in non-existent namespace should return empty
      const results = skillLib.search('test', 5, 'non-existent');
      expect(results.length).toBe(0);
    });

    it('should handle getSummaries with namespace isolation', () => {
      // Add skills to namespace A
      skillLib.addSkill(
        {
          name: 'SkillA1',
          description: 'Skill A1 description',
          category: 'catA',
          triggers: ['a1'],
        },
        'namespace-a'
      );
      skillLib.addSkill(
        {
          name: 'SkillA2',
          description: 'Skill A2 description',
          category: 'catA',
          triggers: ['a2'],
        },
        'namespace-a'
      );

      // Add skill to namespace B
      skillLib.addSkill(
        {
          name: 'SkillB1',
          description: 'Skill B1 description',
          category: 'catB',
          triggers: ['b1'],
        },
        'namespace-b'
      );

      // Get summaries from namespace A
      const summariesA = skillLib.getSummaries(10, undefined, 'namespace-a');
      expect(summariesA.length).toBe(2);
      const namesA = summariesA.map(s => s.name);
      expect(namesA).toContain('SkillA1');
      expect(namesA).toContain('SkillA2');
      expect(namesA).not.toContain('SkillB1');

      // Get summaries from namespace B
      const summariesB = skillLib.getSummaries(10, undefined, 'namespace-b');
      expect(summariesB.length).toBe(1);
      expect(summariesB[0].name).toBe('SkillB1');
    });

    it('should handle detectInvocation with namespace isolation', () => {
      // Add skill to namespace A
      skillLib.addSkill(
        {
          name: 'FormatCode',
          description: 'Format code like before',
          category: 'formatting',
          triggers: ['format', 'like before'],
        },
        'namespace-a'
      );

      // Add different skill to namespace B
      skillLib.addSkill(
        {
          name: 'LintCode',
          description: 'Lint code like before',
          category: 'linting',
          triggers: ['lint', 'like before'],
        },
        'namespace-b'
      );

      // Detect in namespace A should find FormatCode
      const detectionA = skillLib.detectInvocation('format like before', 'namespace-a');
      expect(detectionA.is_invocation).toBe(true);
      expect(detectionA.skill_id).toBeTruthy();

      // Detect in namespace B should find LintCode
      const detectionB = skillLib.detectInvocation('lint like before', 'namespace-b');
      expect(detectionB.is_invocation).toBe(true);
      expect(detectionB.skill_id).toBeTruthy();

      // The detected skills should be different
      expect(detectionA.skill_id).not.toBe(detectionB.skill_id);
    });

    it('should handle namespace with special characters for skills', () => {
      // Test with hyphenated namespace
      const skillId = skillLib.addSkill(
        {
          name: 'SpecialSkill',
          description: 'Special namespace skill',
          category: 'special',
          triggers: ['special'],
        },
        'my-special-namespace'
      );

      const results = skillLib.search('special', 5, 'my-special-namespace');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('SpecialSkill');
    });
  });

  describe('ConflictDetector Namespace Isolation', () => {
    it('should detect conflicts only within same namespace', () => {
      // Create entity and facts in namespace A
      const entityA = db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES ('entity-a', 'UserA', 'person', '2025-01-01', '2025-01-01', 'namespace-a')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, namespace)
        VALUES ('fact-a1', 'entity-a', 'location', 'NYC', 1.0, '2025-01-01', 'namespace-a')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, namespace)
        VALUES ('fact-a2', 'entity-a', 'location', 'LA', 1.0, '2025-01-01', 'namespace-a')
      `).run();

      // Create entity and facts in namespace B
      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES ('entity-b', 'UserB', 'person', '2025-01-01', '2025-01-01', 'namespace-b')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, namespace)
        VALUES ('fact-b1', 'entity-b', 'location', 'Chicago', 1.0, '2025-01-01', 'namespace-b')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, namespace)
        VALUES ('fact-b2', 'entity-b', 'location', 'Boston', 1.0, '2025-01-01', 'namespace-b')
      `).run();

      // Detect conflicts in namespace A
      const conflictsA = conflictDetector.detectAll('namespace-a');
      expect(conflictsA.length).toBe(1);
      expect(conflictsA[0].conflictType).toBe('contradiction');

      // Detect conflicts in namespace B
      const conflictsB = conflictDetector.detectAll('namespace-b');
      expect(conflictsB.length).toBe(1);
      expect(conflictsB[0].conflictType).toBe('contradiction');

      // Verify the conflicts reference different facts
      expect(conflictsA[0].factId1).not.toBe(conflictsB[0].factId1);
      expect(conflictsA[0].factId2).not.toBe(conflictsB[0].factId2);
    });

    it('should not detect cross-namespace conflicts', () => {
      // Create entity in namespace A
      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES ('entity-cross-a', 'SameUser', 'person', '2025-01-01', '2025-01-01', 'namespace-a')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, namespace)
        VALUES ('fact-cross-a', 'entity-cross-a', 'status', 'active', 1.0, '2025-01-01', 'namespace-a')
      `).run();

      // Create entity with same name in namespace B
      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES ('entity-cross-b', 'SameUser', 'person', '2025-01-01', '2025-01-01', 'namespace-b')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, namespace)
        VALUES ('fact-cross-b', 'entity-cross-b', 'status', 'inactive', 1.0, '2025-01-01', 'namespace-b')
      `).run();

      // Despite same property with different values, no conflict should be detected
      // because they're in different namespaces
      const conflictsA = conflictDetector.detectAll('namespace-a');
      expect(conflictsA.length).toBe(0);

      const conflictsB = conflictDetector.detectAll('namespace-b');
      expect(conflictsB.length).toBe(0);
    });

    it('should store conflicts with namespace', () => {
      const conflict = {
        id: 'conflict-test-1',
        factId1: 'fact-1',
        factId2: 'fact-2',
        conflictType: 'contradiction' as const,
        description: 'Test conflict',
        severity: 'medium' as const,
      };

      // Store conflict in namespace A
      conflictDetector.storeConflict(conflict, 'namespace-a');

      // Verify conflict is in namespace A
      const storedA = db.prepare(
        'SELECT * FROM conflicts WHERE id = ? AND namespace = ?'
      ).get(conflict.id, 'namespace-a');
      expect(storedA).toBeTruthy();

      // Verify conflict is NOT in namespace B
      const storedB = db.prepare(
        'SELECT * FROM conflicts WHERE id = ? AND namespace = ?'
      ).get(conflict.id, 'namespace-b');
      expect(storedB).toBeFalsy();
    });

    it('should handle temporal conflicts within namespace', () => {
      // Create overlapping temporal facts in namespace A
      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES ('temporal-entity-a', 'Company', 'concept', '2025-01-01', '2025-01-01', 'namespace-a')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until, namespace)
        VALUES ('temporal-a1', 'temporal-entity-a', 'ceo', 'Alice', 1.0, '2025-01-01', '2025-06-30', 'namespace-a')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until, namespace)
        VALUES ('temporal-a2', 'temporal-entity-a', 'ceo', 'Bob', 1.0, '2025-04-01', '2025-12-31', 'namespace-a')
      `).run();

      // Detect temporal conflicts in namespace A
      const conflicts = conflictDetector.detectAll('namespace-a');
      expect(conflicts.length).toBeGreaterThan(0);
      const temporalConflict = conflicts.find(c => c.conflictType === 'temporal_overlap');
      expect(temporalConflict).toBeTruthy();
    });

    it('should handle preference shift detection within namespace', () => {
      const now = new Date();
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      // Create preference shift in namespace A
      db.prepare(`
        INSERT INTO entities (id, name, type, description, created_at, last_accessed, namespace)
        VALUES ('pref-a1', 'Vim', 'preference', 'editor', ?, ?, 'namespace-a')
      `).run(twoWeeksAgo.toISOString(), twoWeeksAgo.toISOString());

      db.prepare(`
        INSERT INTO entities (id, name, type, description, created_at, last_accessed, namespace)
        VALUES ('pref-a2', 'VSCode', 'preference', 'editor', ?, ?, 'namespace-a')
      `).run(now.toISOString(), now.toISOString());

      // Detect preference shift in namespace A
      const conflicts = conflictDetector.detectAll('namespace-a');
      const prefShift = conflicts.find(c => c.conflictType === 'preference_shift');
      expect(prefShift).toBeTruthy();
      expect(prefShift?.description).toContain('Vim');
      expect(prefShift?.description).toContain('VSCode');
    });

    it('should use default namespace when not specified', () => {
      // Create conflicting facts in default namespace
      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES ('default-entity', 'TestEntity', 'concept', '2025-01-01', '2025-01-01', 'default')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, namespace)
        VALUES ('default-fact1', 'default-entity', 'attr', 'value1', 1.0, '2025-01-01', 'default')
      `).run();

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, namespace)
        VALUES ('default-fact2', 'default-entity', 'attr', 'value2', 1.0, '2025-01-01', 'default')
      `).run();

      // Detect without specifying namespace (should use 'default')
      const conflictsImplicit = conflictDetector.detectAll();
      expect(conflictsImplicit.length).toBe(1);

      // Detect with explicit 'default' namespace
      const conflictsExplicit = conflictDetector.detectAll('default');
      expect(conflictsExplicit.length).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty namespace string as a valid namespace', () => {
      // Empty namespace is treated as its own namespace
      const entity = semantic.upsertEntity({ name: 'EmptyTest', type: 'concept' }, '');

      // Should be findable with empty string
      const foundEmpty = semantic.getEntity('EmptyTest', '');
      expect(foundEmpty).toBeTruthy();

      // Should NOT be in 'default' namespace
      const notInDefault = semantic.getEntity('EmptyTest', 'default');
      expect(notInDefault).toBeNull();
    });

    it('should handle many namespaces without interference', () => {
      const namespaces = ['ns1', 'ns2', 'ns3', 'ns4', 'ns5'];

      // Create entities in each namespace
      namespaces.forEach((ns, idx) => {
        semantic.upsertEntity(
          { name: `Entity${idx}`, type: 'concept', description: `Namespace ${ns}` },
          ns
        );
      });

      // Verify each namespace has only its own entity
      namespaces.forEach((ns, idx) => {
        const found = semantic.getEntity(`Entity${idx}`, ns);
        expect(found).toBeTruthy();
        expect(found.description).toBe(`Namespace ${ns}`);

        // Verify other entities are not in this namespace
        namespaces.forEach((otherNs, otherIdx) => {
          if (idx !== otherIdx) {
            const notFound = semantic.getEntity(`Entity${otherIdx}`, ns);
            expect(notFound).toBeNull();
          }
        });
      });
    });

    it('should handle namespace with unicode characters', () => {
      const unicodeNamespace = '命名空间-🚀';

      const entity = semantic.upsertEntity(
        { name: 'UnicodeTest', type: 'concept' },
        unicodeNamespace
      );

      const found = semantic.getEntity('UnicodeTest', unicodeNamespace);
      expect(found).toBeTruthy();
      expect(found.name).toBe('UnicodeTest');
    });

    it('should handle very long namespace names', () => {
      const longNamespace = 'a'.repeat(100);

      const entity = semantic.upsertEntity(
        { name: 'LongNamespaceTest', type: 'concept' },
        longNamespace
      );

      const found = semantic.getEntity('LongNamespaceTest', longNamespace);
      expect(found).toBeTruthy();
    });

    it('should return empty results for operations on non-existent namespace', () => {
      // Add some data to an existing namespace
      semantic.upsertEntity({ name: 'ExistingData', type: 'concept' }, 'existing');
      skillLib.addSkill(
        {
          name: 'ExistingSkill',
          description: 'Test',
          category: 'test',
          triggers: ['test'],
        },
        'existing'
      );

      // Query non-existent namespace
      const entity = semantic.getEntity('ExistingData', 'non-existent');
      expect(entity).toBeNull();

      const prefs = semantic.getPreferences(undefined, 'non-existent');
      expect(prefs).toEqual([]);

      const pageRank = semantic.personalizedPageRank('any-id', 2, 'non-existent');
      expect(pageRank).toEqual([]);

      const skills = skillLib.search('test', 5, 'non-existent');
      expect(skills).toEqual([]);

      const conflicts = conflictDetector.detectAll('non-existent');
      expect(conflicts).toEqual([]);
    });

    it('should handle simultaneous operations across multiple namespaces', () => {
      // Simulate concurrent operations across namespaces
      const ns1Entity = semantic.upsertEntity({ name: 'Concurrent1', type: 'concept' }, 'ns1');
      const ns2Entity = semantic.upsertEntity({ name: 'Concurrent2', type: 'concept' }, 'ns2');
      const ns3Entity = semantic.upsertEntity({ name: 'Concurrent3', type: 'concept' }, 'ns3');

      const ns1Skill = skillLib.addSkill(
        { name: 'Skill1', description: 'Test 1', category: 'c1', triggers: ['t1'] },
        'ns1'
      );
      const ns2Skill = skillLib.addSkill(
        { name: 'Skill2', description: 'Test 2', category: 'c2', triggers: ['t2'] },
        'ns2'
      );
      const ns3Skill = skillLib.addSkill(
        { name: 'Skill3', description: 'Test 3', category: 'c3', triggers: ['t3'] },
        'ns3'
      );

      // Verify isolation
      expect(semantic.getEntity('Concurrent1', 'ns1')).toBeTruthy();
      expect(semantic.getEntity('Concurrent1', 'ns2')).toBeNull();
      expect(semantic.getEntity('Concurrent1', 'ns3')).toBeNull();

      expect(skillLib.search('t1', 5, 'ns1').length).toBe(1);
      expect(skillLib.search('t1', 5, 'ns2').length).toBe(0);
      expect(skillLib.search('t1', 5, 'ns3').length).toBe(0);
    });
  });
});
