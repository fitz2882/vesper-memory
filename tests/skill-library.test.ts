/**
 * Tests for Skill Library
 *
 * Verifies:
 * - Skill creation and storage
 * - Trigger-based search
 * - Success/failure tracking
 * - Satisfaction scoring
 * - Skill ranking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SkillLibrary } from '../src/memory-layers/skill-library.js';

describe('SkillLibrary', () => {
  let db: Database.Database;
  let skills: SkillLibrary;

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
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        avg_user_satisfaction REAL DEFAULT 0.5,
        is_archived INTEGER DEFAULT 0,
        last_used TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        namespace TEXT DEFAULT 'default'
      );
    `);

    skills = new SkillLibrary(db);
  });

  describe('Skill Creation', () => {
    it('should add a new skill', () => {
      const id = skills.addSkill({
        name: 'Data Analysis',
        description: 'Analyze datasets and provide insights',
        category: 'analysis',
        triggers: ['analyze', 'data', 'insights'],
      });

      expect(id).toBeDefined();
      expect(id).toContain('skill_');

      const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
      expect(row.name).toBe('Data Analysis');
      expect(row.success_count).toBe(0);
      expect(row.failure_count).toBe(0);
      expect(row.avg_user_satisfaction).toBe(0.5);
    });

    it('should initialize with default metrics', () => {
      const id = skills.addSkill({
        name: 'Test Skill',
        description: 'Test description',
        category: 'test',
        triggers: ['test'],
      });

      const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
      expect(row.success_count).toBe(0);
      expect(row.failure_count).toBe(0);
      expect(row.avg_user_satisfaction).toBe(0.5);
    });

    it('should store triggers as JSON', () => {
      const triggers = ['analyze', 'data', 'report'];

      const id = skills.addSkill({
        name: 'Test',
        description: 'Test',
        category: 'test',
        triggers,
      });

      const row = db.prepare('SELECT triggers FROM skills WHERE id = ?').get(id) as any;
      const parsed = JSON.parse(row.triggers);

      expect(parsed).toEqual(triggers);
    });
  });

  describe('Skill Search', () => {
    beforeEach(() => {
      skills.addSkill({
        name: 'Data Analysis',
        description: 'Analyze datasets',
        category: 'analysis',
        triggers: ['analyze', 'data', 'dataset'],
      });

      skills.addSkill({
        name: 'Code Review',
        description: 'Review code for quality',
        category: 'review',
        triggers: ['review', 'code', 'quality'],
      });

      skills.addSkill({
        name: 'Report Generation',
        description: 'Generate reports',
        category: 'reporting',
        triggers: ['report', 'generate', 'summary'],
      });
    });

    it('should find skills by trigger match', () => {
      const results = skills.search('analyze data');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Data Analysis');
    });

    it('should find skills by partial trigger match', () => {
      const results = skills.search('code');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Code Review');
    });

    it('should find skills by name match', () => {
      const results = skills.search('report');

      expect(results.length).toBeGreaterThan(0);
      const hasReportSkill = results.some(s => s.name === 'Report Generation');
      expect(hasReportSkill).toBe(true);
    });

    it('should return empty array for no matches', () => {
      const results = skills.search('nonexistent keyword');
      expect(results).toHaveLength(0);
    });

    it('should respect limit parameter', () => {
      const results = skills.search('review', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should rank by satisfaction score', () => {
      const id1 = skills.addSkill({
        name: 'High Satisfaction',
        description: 'Test',
        category: 'test',
        triggers: ['test', 'query'],
      });

      const id2 = skills.addSkill({
        name: 'Low Satisfaction',
        description: 'Test',
        category: 'test',
        triggers: ['test', 'query'],
      });

      // Record successes with different satisfaction
      skills.recordSuccess(id1, 0.95);
      skills.recordSuccess(id2, 0.3);

      const results = skills.search('test');

      // Higher satisfaction should rank first
      expect(results[0].name).toBe('High Satisfaction');
    });

    it('should handle case-insensitive search', () => {
      const results = skills.search('ANALYZE DATA');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Data Analysis');
    });
  });

  describe('Success Tracking', () => {
    it('should increment success count', () => {
      const id = skills.addSkill({
        name: 'Test Skill',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      skills.recordSuccess(id, 0.8);

      const row = db.prepare('SELECT success_count FROM skills WHERE id = ?').get(id) as any;
      expect(row.success_count).toBe(1);
    });

    it('should update average satisfaction', () => {
      const id = skills.addSkill({
        name: 'Test Skill',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      skills.recordSuccess(id, 0.8);
      skills.recordSuccess(id, 0.6);

      const row = db.prepare('SELECT avg_user_satisfaction FROM skills WHERE id = ?').get(id) as any;

      // Average should be (0.5 * 0 + 0.8) / 1 = 0.8 for first
      // Then (0.8 * 1 + 0.6) / 2 = 0.7 for second
      expect(row.avg_user_satisfaction).toBeCloseTo(0.7, 1);
    });

    it('should handle multiple successes', () => {
      const id = skills.addSkill({
        name: 'Test Skill',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      for (let i = 0; i < 5; i++) {
        skills.recordSuccess(id, 0.9);
      }

      const row = db.prepare('SELECT success_count FROM skills WHERE id = ?').get(id) as any;
      expect(row.success_count).toBe(5);
    });

    it('should handle satisfaction values at boundaries', () => {
      const id = skills.addSkill({
        name: 'Test Skill',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      skills.recordSuccess(id, 0.0);
      skills.recordSuccess(id, 1.0);

      const row = db.prepare('SELECT avg_user_satisfaction FROM skills WHERE id = ?').get(id) as any;
      expect(row.avg_user_satisfaction).toBeGreaterThanOrEqual(0.0);
      expect(row.avg_user_satisfaction).toBeLessThanOrEqual(1.0);
    });

    it('should ignore success for non-existent skill', () => {
      expect(() => {
        skills.recordSuccess('nonexistent-id', 0.8);
      }).not.toThrow();
    });
  });

  describe('Failure Tracking', () => {
    it('should increment failure count', () => {
      const id = skills.addSkill({
        name: 'Test Skill',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      skills.recordFailure(id);

      const row = db.prepare('SELECT failure_count FROM skills WHERE id = ?').get(id) as any;
      expect(row.failure_count).toBe(1);
    });

    it('should not affect satisfaction on failure', () => {
      const id = skills.addSkill({
        name: 'Test Skill',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      const before = db.prepare('SELECT avg_user_satisfaction FROM skills WHERE id = ?').get(id) as any;

      skills.recordFailure(id);

      const after = db.prepare('SELECT avg_user_satisfaction FROM skills WHERE id = ?').get(id) as any;

      expect(after.avg_user_satisfaction).toBe(before.avg_user_satisfaction);
    });

    it('should handle multiple failures', () => {
      const id = skills.addSkill({
        name: 'Test Skill',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      for (let i = 0; i < 3; i++) {
        skills.recordFailure(id);
      }

      const row = db.prepare('SELECT failure_count FROM skills WHERE id = ?').get(id) as any;
      expect(row.failure_count).toBe(3);
    });
  });

  describe('Skill Ranking', () => {
    it('should rank by success count when satisfaction is equal', () => {
      const id1 = skills.addSkill({
        name: 'Skill 1',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      const id2 = skills.addSkill({
        name: 'Skill 2',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      // Same satisfaction, different success counts
      skills.recordSuccess(id1, 0.8);
      skills.recordSuccess(id1, 0.8);
      skills.recordSuccess(id1, 0.8);

      skills.recordSuccess(id2, 0.8);

      const results = skills.search('test');

      expect(results[0].name).toBe('Skill 1');
      expect(results[0].successCount).toBe(3);
    });

    it('should prioritize satisfaction over success count', () => {
      const id1 = skills.addSkill({
        name: 'High Quality',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      const id2 = skills.addSkill({
        name: 'High Volume',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      // High volume, low quality
      for (let i = 0; i < 10; i++) {
        skills.recordSuccess(id2, 0.4);
      }

      // Low volume, high quality
      skills.recordSuccess(id1, 0.95);

      const results = skills.search('test');

      expect(results[0].name).toBe('High Quality');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty triggers array', () => {
      const id = skills.addSkill({
        name: 'No Triggers',
        description: 'Test',
        category: 'test',
        triggers: [],
      });

      expect(id).toBeDefined();

      const results = skills.search('anything');
      expect(results).toHaveLength(0);
    });

    it('should handle special characters in triggers', () => {
      const id = skills.addSkill({
        name: 'Special',
        description: 'Test',
        category: 'test',
        triggers: ['@mention', '#hashtag', 'regular'],
      });

      const results = skills.search('regular');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle very long skill names', () => {
      const longName = 'A'.repeat(500);

      const id = skills.addSkill({
        name: longName,
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      expect(id).toBeDefined();

      const row = db.prepare('SELECT name FROM skills WHERE id = ?').get(id) as any;
      expect(row.name).toBe(longName);
    });

    it('should handle concurrent skill additions', () => {
      const ids: string[] = [];

      for (let i = 0; i < 100; i++) {
        ids.push(
          skills.addSkill({
            name: `Skill ${i}`,
            description: `Description ${i}`,
            category: 'test',
            triggers: [`trigger${i}`],
          })
        );
      }

      // All should have unique IDs
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(100);
    });

    it('should handle queries with only whitespace', () => {
      skills.addSkill({
        name: 'Test',
        description: 'Test',
        category: 'test',
        triggers: ['test'],
      });

      const results = skills.search('   ');
      expect(results).toHaveLength(0);
    });

    it('should return triggers in search results', () => {
      const triggers = ['analyze', 'data', 'insights'];

      skills.addSkill({
        name: 'Data Analysis',
        description: 'Test',
        category: 'analysis',
        triggers,
      });

      const results = skills.search('analyze');

      expect(results[0].triggers).toEqual(triggers);
    });
  });
});
