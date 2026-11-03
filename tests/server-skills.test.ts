/**
 * Tests for Server Skills Integration
 *
 * Verifies:
 * - SkillLibrary integration with smart router
 * - Skill query handling via handleSkillQuery
 * - record_skill_outcome tool
 * - Skill search in retrieve_memory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  QueryType,
  classifyQuery,
  initSkillHandler,
  handleSkillQueryDirect,
  type RoutingContext,
} from '../src/router/smart-router.js';
import { SkillLibrary } from '../src/memory-layers/skill-library.js';
import {
  RecordSkillOutcomeInputSchema,
  validateInput,
} from '../src/utils/validation.js';

describe('Skill Query Router Integration', () => {
  let db: Database.Database;
  let skillLibrary: SkillLibrary;
  let context: RoutingContext;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');

    // Create skills table (matches production schema with lazy loading fields)
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

    skillLibrary = new SkillLibrary(db);

    // Initialize the skill handler with skill library
    initSkillHandler(skillLibrary);

    context = {
      userId: 'user1',
      conversationId: 'conv1',
      timestamp: new Date(),
    };
  });

  afterEach(() => {
    db.close();
  });

  describe('Skill Query Classification', () => {
    it('should classify "like before" as skill query', () => {
      const result = classifyQuery('Analyze this like before');
      expect(result.type).toBe(QueryType.SKILL);
    });

    it('should classify "same as" as skill query', () => {
      const result = classifyQuery('Do it the same as last time');
      expect(result.type).toBe(QueryType.SKILL);
    });

    it('should classify "how you" as skill query', () => {
      const result = classifyQuery('How you did the analysis before');
      expect(result.type).toBe(QueryType.SKILL);
    });

    it('should classify "analyze" as skill query', () => {
      const result = classifyQuery('Analyze this dataset');
      expect(result.type).toBe(QueryType.SKILL);
    });
  });

  describe('Direct Skill Query Handler', () => {
    it('should return skills matching query triggers', async () => {
      // Add test skills
      skillLibrary.addSkill({
        name: 'Data Analysis',
        description: 'Analyze datasets and provide insights',
        category: 'analysis',
        triggers: ['analyze', 'data', 'insights'],
      });

      const results = await handleSkillQueryDirect('Analyze this data', context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('Data Analysis');
      expect(results[0].source).toBe('procedural');
    });

    it('should return skills sorted by satisfaction score', async () => {
      const id1 = skillLibrary.addSkill({
        name: 'High Quality Analysis',
        description: 'Premium analysis with high satisfaction',
        category: 'analysis',
        triggers: ['analyze'],
      });

      const id2 = skillLibrary.addSkill({
        name: 'Basic Analysis',
        description: 'Basic analysis with lower satisfaction',
        category: 'analysis',
        triggers: ['analyze'],
      });

      // Record different satisfaction levels
      skillLibrary.recordSuccess(id1, 0.95);
      skillLibrary.recordSuccess(id2, 0.5);

      // Use a query that matches via name/category (returns summaries) not exact trigger (invocation)
      const results = await handleSkillQueryDirect('analysis', context);

      expect(results.length).toBe(2);
      expect(results[0].content).toContain('High Quality');
    });

    it('should return empty array when no skills match', async () => {
      const results = await handleSkillQueryDirect('unknown query', context);
      expect(results).toEqual([]);
    });

    it('should return empty array when skill library not initialized', async () => {
      // Reset skill handler
      initSkillHandler(null as any);

      const results = await handleSkillQueryDirect('analyze', context);
      expect(results).toEqual([]);

      // Restore
      initSkillHandler(skillLibrary);
    });

    it('should include skill metadata in results', async () => {
      skillLibrary.addSkill({
        name: 'Code Review',
        description: 'Review code for quality and best practices',
        category: 'review',
        triggers: ['review', 'code', 'quality'],
      });

      const results = await handleSkillQueryDirect('review code', context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toMatchObject({
        id: expect.any(String),
        source: 'procedural',
        content: expect.any(String),
        similarity: expect.any(Number),
        timestamp: expect.any(Date),
      });
    });

    it('should calculate similarity based on match score and satisfaction', async () => {
      const id = skillLibrary.addSkill({
        name: 'Test Skill',
        description: 'Test description',
        category: 'test',
        triggers: ['test'],
      });

      // Record some successes
      skillLibrary.recordSuccess(id, 0.8);
      skillLibrary.recordSuccess(id, 0.9);

      const results = await handleSkillQueryDirect('test', context);

      expect(results[0].similarity).toBeGreaterThan(0);
      expect(results[0].similarity).toBeLessThanOrEqual(1);
    });
  });

  describe('Skill Search Performance', () => {
    it('should complete skill search in under 20ms', async () => {
      // Add 50 skills
      for (let i = 0; i < 50; i++) {
        skillLibrary.addSkill({
          name: `Skill ${i}`,
          description: `Description for skill ${i}`,
          category: 'test',
          triggers: [`trigger${i}`, 'common'],
        });
      }

      const start = performance.now();
      await handleSkillQueryDirect('common trigger', context);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(20);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query', async () => {
      const results = await handleSkillQueryDirect('', context);
      expect(results).toEqual([]);
    });

    it('should handle whitespace-only query', async () => {
      const results = await handleSkillQueryDirect('   ', context);
      expect(results).toEqual([]);
    });

    it('should handle special characters in query', async () => {
      skillLibrary.addSkill({
        name: 'Special Skill',
        description: 'Handles special chars',
        category: 'test',
        triggers: ['@mention', '#hashtag'],
      });

      // Should not throw
      const results = await handleSkillQueryDirect('@mention', context);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle case-insensitive matching', async () => {
      skillLibrary.addSkill({
        name: 'Analysis Skill',
        description: 'Data analysis',
        category: 'analysis',
        triggers: ['ANALYZE', 'Data'],
      });

      const results = await handleSkillQueryDirect('analyze data', context);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

describe('record_skill_outcome Validation', () => {
  describe('Input Schema', () => {
    // These tests verify the Zod schema for the new tool
    it('should require skill_id', () => {
      const input = { outcome: 'success', satisfaction: 0.8 };
      expect(() => validateRecordSkillOutcome(input)).toThrow();
    });

    it('should require outcome', () => {
      const input = { skill_id: 'skill_123', satisfaction: 0.8 };
      expect(() => validateRecordSkillOutcome(input)).toThrow();
    });

    it('should validate outcome enum values', () => {
      const validSuccess = { skill_id: 'skill_123', outcome: 'success', satisfaction: 0.8 };
      const validFailure = { skill_id: 'skill_123', outcome: 'failure' };

      expect(() => validateRecordSkillOutcome(validSuccess)).not.toThrow();
      expect(() => validateRecordSkillOutcome(validFailure)).not.toThrow();

      const invalidOutcome = { skill_id: 'skill_123', outcome: 'maybe' };
      expect(() => validateRecordSkillOutcome(invalidOutcome)).toThrow();
    });

    it('should require satisfaction for success outcome', () => {
      const input = { skill_id: 'skill_123', outcome: 'success' };
      expect(() => validateRecordSkillOutcome(input)).toThrow();
    });

    it('should validate satisfaction range (0-1)', () => {
      const validInput = { skill_id: 'skill_123', outcome: 'success', satisfaction: 0.5 };
      expect(() => validateRecordSkillOutcome(validInput)).not.toThrow();

      const tooLow = { skill_id: 'skill_123', outcome: 'success', satisfaction: -0.1 };
      expect(() => validateRecordSkillOutcome(tooLow)).toThrow();

      const tooHigh = { skill_id: 'skill_123', outcome: 'success', satisfaction: 1.1 };
      expect(() => validateRecordSkillOutcome(tooHigh)).toThrow();
    });

    it('should accept satisfaction at boundaries', () => {
      const atZero = { skill_id: 'skill_123', outcome: 'success', satisfaction: 0 };
      const atOne = { skill_id: 'skill_123', outcome: 'success', satisfaction: 1 };

      expect(() => validateRecordSkillOutcome(atZero)).not.toThrow();
      expect(() => validateRecordSkillOutcome(atOne)).not.toThrow();
    });
  });
});

// Helper function to test validation
function validateRecordSkillOutcome(input: unknown): void {
  validateInput(RecordSkillOutcomeInputSchema, input);
}

describe('record_skill_outcome Integration', () => {
  let db: Database.Database;
  let skillLibrary: SkillLibrary;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');

    // Create skills table (matches production schema with lazy loading fields)
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

    skillLibrary = new SkillLibrary(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('Recording Success', () => {
    it('should increment success_count when recording success', () => {
      const skillId = skillLibrary.addSkill({
        name: 'Test Skill',
        description: 'A test skill',
        category: 'test',
        triggers: ['test'],
      });

      // Record a success
      skillLibrary.recordSuccess(skillId, 0.8);

      // Verify skill was updated
      const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
      expect(skill.success_count).toBe(1);
    });

    it('should update avg_user_satisfaction correctly', () => {
      const skillId = skillLibrary.addSkill({
        name: 'Test Skill',
        description: 'A test skill',
        category: 'test',
        triggers: ['test'],
      });

      // Initial satisfaction is 0.5 (default)
      // After recording 0.8 with success_count 0 -> avg = (0.5*0 + 0.8) / 1 = 0.8
      skillLibrary.recordSuccess(skillId, 0.8);

      const skill1 = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
      expect(skill1.avg_user_satisfaction).toBeCloseTo(0.8, 2);

      // After recording 0.6 with success_count 1 -> avg = (0.8*1 + 0.6) / 2 = 0.7
      skillLibrary.recordSuccess(skillId, 0.6);

      const skill2 = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
      expect(skill2.avg_user_satisfaction).toBeCloseTo(0.7, 2);
    });

    it('should handle multiple success recordings', () => {
      const skillId = skillLibrary.addSkill({
        name: 'Popular Skill',
        description: 'A frequently used skill',
        category: 'popular',
        triggers: ['popular'],
      });

      // Record multiple successes
      skillLibrary.recordSuccess(skillId, 0.9);
      skillLibrary.recordSuccess(skillId, 0.85);
      skillLibrary.recordSuccess(skillId, 0.95);

      const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
      expect(skill.success_count).toBe(3);
      // Weighted average calculation
      expect(skill.avg_user_satisfaction).toBeGreaterThan(0.85);
    });
  });

  describe('Recording Failure', () => {
    it('should increment failure_count when recording failure', () => {
      const skillId = skillLibrary.addSkill({
        name: 'Unreliable Skill',
        description: 'A skill that sometimes fails',
        category: 'test',
        triggers: ['unreliable'],
      });

      skillLibrary.recordFailure(skillId);

      const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
      expect(skill.failure_count).toBe(1);
    });

    it('should not affect success_count or satisfaction when recording failure', () => {
      const skillId = skillLibrary.addSkill({
        name: 'Test Skill',
        description: 'A test skill',
        category: 'test',
        triggers: ['test'],
      });

      // Record a success first
      skillLibrary.recordSuccess(skillId, 0.9);

      const beforeFailure = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;

      // Record a failure
      skillLibrary.recordFailure(skillId);

      const afterFailure = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;

      expect(afterFailure.success_count).toBe(beforeFailure.success_count);
      expect(afterFailure.avg_user_satisfaction).toBe(beforeFailure.avg_user_satisfaction);
      expect(afterFailure.failure_count).toBe(1);
    });

    it('should handle multiple failure recordings', () => {
      const skillId = skillLibrary.addSkill({
        name: 'Buggy Skill',
        description: 'A skill with bugs',
        category: 'buggy',
        triggers: ['buggy'],
      });

      skillLibrary.recordFailure(skillId);
      skillLibrary.recordFailure(skillId);
      skillLibrary.recordFailure(skillId);

      const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
      expect(skill.failure_count).toBe(3);
    });
  });

  describe('Non-existent Skill', () => {
    it('should not throw when recording success for non-existent skill', () => {
      // recordSuccess silently does nothing if skill not found
      expect(() => skillLibrary.recordSuccess('non_existent_skill', 0.5)).not.toThrow();
    });

    it('should not throw when recording failure for non-existent skill', () => {
      // recordFailure just runs UPDATE which affects 0 rows
      expect(() => skillLibrary.recordFailure('non_existent_skill')).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle satisfaction at boundary 0', () => {
      const skillId = skillLibrary.addSkill({
        name: 'Zero Satisfaction Skill',
        description: 'User is never happy',
        category: 'test',
        triggers: ['zero'],
      });

      skillLibrary.recordSuccess(skillId, 0);

      const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
      expect(skill.success_count).toBe(1);
      expect(skill.avg_user_satisfaction).toBe(0);
    });

    it('should handle satisfaction at boundary 1', () => {
      const skillId = skillLibrary.addSkill({
        name: 'Perfect Skill',
        description: 'User is always happy',
        category: 'test',
        triggers: ['perfect'],
      });

      skillLibrary.recordSuccess(skillId, 1);

      const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
      expect(skill.success_count).toBe(1);
      expect(skill.avg_user_satisfaction).toBe(1);
    });

    it('should handle mixed success and failure recordings', () => {
      const skillId = skillLibrary.addSkill({
        name: 'Mixed Skill',
        description: 'Sometimes works',
        category: 'test',
        triggers: ['mixed'],
      });

      skillLibrary.recordSuccess(skillId, 0.8);
      skillLibrary.recordFailure(skillId);
      skillLibrary.recordSuccess(skillId, 0.9);
      skillLibrary.recordFailure(skillId);

      const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
      expect(skill.success_count).toBe(2);
      expect(skill.failure_count).toBe(2);
      expect(skill.avg_user_satisfaction).toBeGreaterThan(0.8);
    });
  });
});
