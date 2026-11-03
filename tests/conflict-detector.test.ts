/**
 * Tests for Conflict Detector
 *
 * Verifies:
 * - Temporal overlap detection
 * - Direct contradiction detection
 * - Preference shift detection
 * - Conflict storage
 * - Severity classification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConflictDetector } from '../src/synthesis/conflict-detector.js';

describe('ConflictDetector', () => {
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

  describe('Temporal Overlap Detection', () => {
    it('should detect overlapping temporal facts', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'employer', 'Company A', 1.0, '2024-01-01', '2024-06-30');

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'employer', 'Company B', 1.0, '2024-05-01', '2024-12-31');

      const conflicts = detector.detectAll();

      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].conflictType).toBe('temporal_overlap');
      expect(conflicts[0].severity).toBe('high');
    });

    it('should not detect non-overlapping periods', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'employer', 'Company A', 1.0, '2024-01-01', '2024-03-31');

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'employer', 'Company B', 1.0, '2024-04-01', '2024-12-31');

      const conflicts = detector.detectAll();

      const temporalConflicts = conflicts.filter(c => c.conflictType === 'temporal_overlap');
      expect(temporalConflicts).toHaveLength(0);
    });

    it('should detect partial overlaps', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'location', 'NYC', 1.0, '2024-01-01', '2024-06-30');

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'location', 'SF', 1.0, '2024-06-15', '2024-12-31');

      const conflicts = detector.detectAll();

      const temporalConflicts = conflicts.filter(c => c.conflictType === 'temporal_overlap');
      expect(temporalConflicts.length).toBeGreaterThan(0);
    });

    it('should handle open-ended periods (null valid_until)', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'skill', 'Python', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'skill', 'Java', 1.0, '2024-06-01', null);

      const conflicts = detector.detectAll();

      const temporalConflicts = conflicts.filter(c => c.conflictType === 'temporal_overlap');
      expect(temporalConflicts.length).toBeGreaterThan(0);
    });
  });

  describe('Direct Contradiction Detection', () => {
    it('should detect conflicting current facts', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'favorite_color', 'blue', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'favorite_color', 'red', 1.0, '2024-01-01', null);

      const conflicts = detector.detectAll();

      const contradictions = conflicts.filter(c => c.conflictType === 'contradiction');
      expect(contradictions.length).toBeGreaterThan(0);
      expect(contradictions[0].severity).toBe('medium');
    });

    it('should not detect historical vs current as contradiction', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'favorite_color', 'blue', 1.0, '2023-01-01', '2023-12-31');

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'favorite_color', 'red', 1.0, '2024-01-01', null);

      const conflicts = detector.detectAll();

      const contradictions = conflicts.filter(c => c.conflictType === 'contradiction');
      expect(contradictions).toHaveLength(0);
    });

    it('should detect multiple contradictions', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      // Three conflicting facts for same property
      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'language', 'Python', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'language', 'JavaScript', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f3', 'e1', 'language', 'Rust', 1.0, '2024-01-01', null);

      const conflicts = detector.detectAll();

      const contradictions = conflicts.filter(c => c.conflictType === 'contradiction');
      expect(contradictions.length).toBeGreaterThanOrEqual(2); // Multiple pairs
    });

    it('should only compare facts from same entity', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User1',
        'person',
        '2024-01-01'
      );

      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e2',
        'User2',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'skill', 'Python', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e2', 'skill', 'Java', 1.0, '2024-01-01', null);

      const conflicts = detector.detectAll();

      const contradictions = conflicts.filter(c => c.conflictType === 'contradiction');
      expect(contradictions).toHaveLength(0);
    });
  });

  describe('Preference Shift Detection', () => {
    it('should detect preference changes over time', () => {
      const now = new Date();
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      db.prepare('INSERT INTO entities (id, name, type, created_at, description) VALUES (?, ?, ?, ?, ?)').run(
        'e1',
        'Python',
        'preference',
        twoWeeksAgo.toISOString(),
        'programming'
      );

      db.prepare('INSERT INTO entities (id, name, type, created_at, description) VALUES (?, ?, ?, ?, ?)').run(
        'e2',
        'Rust',
        'preference',
        now.toISOString(),
        'programming'
      );

      const conflicts = detector.detectAll();

      const shifts = conflicts.filter(c => c.conflictType === 'preference_shift');
      expect(shifts.length).toBeGreaterThan(0);
      expect(shifts[0].severity).toBe('low');
    });

    it('should not detect recent preference additions as shifts', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

      db.prepare('INSERT INTO entities (id, name, type, created_at, description) VALUES (?, ?, ?, ?, ?)').run(
        'e1',
        'Python',
        'preference',
        yesterday.toISOString(),
        'programming'
      );

      db.prepare('INSERT INTO entities (id, name, type, created_at, description) VALUES (?, ?, ?, ?, ?)').run(
        'e2',
        'Rust',
        'preference',
        now.toISOString(),
        'programming'
      );

      const conflicts = detector.detectAll();

      const shifts = conflicts.filter(c => c.conflictType === 'preference_shift');
      expect(shifts).toHaveLength(0); // Too recent (<7 days)
    });

    it('should only compare preferences with same description', () => {
      const now = new Date();
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      db.prepare('INSERT INTO entities (id, name, type, created_at, description) VALUES (?, ?, ?, ?, ?)').run(
        'e1',
        'Python',
        'preference',
        twoWeeksAgo.toISOString(),
        'programming'
      );

      db.prepare('INSERT INTO entities (id, name, type, created_at, description) VALUES (?, ?, ?, ?, ?)').run(
        'e2',
        'Coffee',
        'preference',
        now.toISOString(),
        'beverage'
      );

      const conflicts = detector.detectAll();

      const shifts = conflicts.filter(c => c.conflictType === 'preference_shift');
      expect(shifts).toHaveLength(0); // Different domains
    });

    it('should include time difference in description', () => {
      const now = new Date();
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      db.prepare('INSERT INTO entities (id, name, type, created_at, description) VALUES (?, ?, ?, ?, ?)').run(
        'e1',
        'Python',
        'preference',
        twoWeeksAgo.toISOString(),
        'programming'
      );

      db.prepare('INSERT INTO entities (id, name, type, created_at, description) VALUES (?, ?, ?, ?, ?)').run(
        'e2',
        'Rust',
        'preference',
        now.toISOString(),
        'programming'
      );

      const conflicts = detector.detectAll();

      const shift = conflicts.find(c => c.conflictType === 'preference_shift');
      expect(shift).toBeDefined();
      expect(shift!.description).toContain('days');
    });
  });

  describe('Conflict Storage', () => {
    it('should store detected conflict', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'skill', 'Python', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'skill', 'Java', 1.0, '2024-01-01', null);

      const conflicts = detector.detectAll();
      const conflict = conflicts[0];

      detector.storeConflict(conflict);

      const stored = db.prepare('SELECT * FROM conflicts WHERE id = ?').get(conflict.id) as any;

      expect(stored).toBeDefined();
      expect(stored.fact_id_1).toBe(conflict.factId1);
      expect(stored.fact_id_2).toBe(conflict.factId2);
      expect(stored.conflict_type).toBe(conflict.conflictType);
      expect(stored.resolution_status).toBe('flagged');
    });

    it('should lower confidence on both conflicting facts', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'skill', 'Python', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'skill', 'Java', 1.0, '2024-01-01', null);

      const conflicts = detector.detectAll();
      detector.storeConflict(conflicts[0]);

      const fact1 = db.prepare('SELECT confidence FROM facts WHERE id = ?').get('f1') as any;
      const fact2 = db.prepare('SELECT confidence FROM facts WHERE id = ?').get('f2') as any;

      expect(fact1.confidence).toBe(0.5);
      expect(fact2.confidence).toBe(0.5);
    });

    it('should set resolution status to flagged', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'skill', 'Python', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'skill', 'Java', 1.0, '2024-01-01', null);

      const conflicts = detector.detectAll();
      detector.storeConflict(conflicts[0]);

      const stored = db.prepare('SELECT resolution_status FROM conflicts').get() as any;
      expect(stored.resolution_status).toBe('flagged');
    });
  });

  describe('Edge Cases', () => {
    it('should handle no conflicts gracefully', () => {
      const conflicts = detector.detectAll();
      expect(conflicts).toHaveLength(0);
    });

    it('should handle same value in overlapping periods (not a conflict)', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'skill', 'Python', 1.0, '2024-01-01', '2024-06-30');

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'skill', 'Python', 1.0, '2024-05-01', '2024-12-31');

      const conflicts = detector.detectAll();

      const temporalConflicts = conflicts.filter(c => c.conflictType === 'temporal_overlap');
      expect(temporalConflicts).toHaveLength(0); // Same value, no conflict
    });

    it('should handle multiple conflict types for same facts', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'location', 'NYC', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'location', 'SF', 1.0, '2024-01-01', null);

      const conflicts = detector.detectAll();

      // Should detect as both temporal_overlap AND contradiction
      expect(conflicts.length).toBeGreaterThan(0);
    });

    it('should generate unique conflict IDs', () => {
      db.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
        'e1',
        'User',
        'person',
        '2024-01-01'
      );

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f1', 'e1', 'prop1', 'val1', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f2', 'e1', 'prop1', 'val2', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f3', 'e1', 'prop2', 'val3', 1.0, '2024-01-01', null);

      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('f4', 'e1', 'prop2', 'val4', 1.0, '2024-01-01', null);

      const conflicts = detector.detectAll();

      const ids = conflicts.map(c => c.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });
});
