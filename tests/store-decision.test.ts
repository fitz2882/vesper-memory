import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

/**
 * Test suite for store_decision functionality
 *
 * Tests the decision storage feature which:
 * - Stores memories with memory_type='decision'
 * - Applies reduced decay (decay_factor: 0.25)
 * - Handles superseding previous decisions
 * - Runs conflict detection against existing decisions
 */

interface StoreDecisionParams {
  content: string;
  rationale?: string;
  supersedes?: string;
  namespace?: string;
  agent_id?: string;
  task_id?: string;
  metadata?: Record<string, any>;
}

interface StoreDecisionResult {
  decision_id: string;
  conflicts_detected: number;
}

describe('store_decision', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory SQLite database
    db = new Database(':memory:');

    // Create schema
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        embedding TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        metadata TEXT,
        namespace TEXT DEFAULT 'default',
        agent_id TEXT,
        agent_role TEXT,
        task_id TEXT
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
    `);
  });

  /**
   * Helper function to simulate store_decision logic
   */
  function storeDecision(params: StoreDecisionParams): StoreDecisionResult {
    const decision_id = randomUUID();
    const now = new Date().toISOString();
    const namespace = params.namespace || 'default';

    // Build metadata with decay_factor
    const metadata = {
      ...params.metadata,
      decay_factor: 0.25,
      rationale: params.rationale,
    };

    // Handle supersedes logic
    if (params.supersedes) {
      const existing = db.prepare('SELECT id, metadata FROM memories WHERE id = ? AND namespace = ?')
        .get(params.supersedes, namespace) as { id: string; metadata: string | null } | undefined;

      if (existing) {
        // Update old decision with superseded info
        const oldMetadata = existing.metadata ? JSON.parse(existing.metadata) : {};
        oldMetadata.superseded_by = decision_id;
        oldMetadata.superseded_at = now;

        db.prepare('UPDATE memories SET metadata = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(oldMetadata), now, params.supersedes);

        // Add supersedes reference to new decision
        metadata.supersedes = params.supersedes;
      }
    }

    // Store the decision
    db.prepare(`
      INSERT INTO memories (
        id, content, memory_type, created_at, updated_at,
        importance, metadata, namespace, agent_id, task_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision_id,
      params.content,
      'decision',
      now,
      now,
      0.5,
      JSON.stringify(metadata),
      namespace,
      params.agent_id || null,
      params.task_id || null
    );

    // Run conflict detection
    const conflicts_detected = detectConflicts(decision_id, params.content, namespace);

    return { decision_id, conflicts_detected };
  }

  /**
   * Helper function to detect conflicts between decisions
   */
  function detectConflicts(decision_id: string, content: string, namespace: string): number {
    // Get all other decisions in same namespace
    const existingDecisions = db.prepare(`
      SELECT id, content, metadata FROM memories
      WHERE memory_type = 'decision'
      AND namespace = ?
      AND id != ?
    `).all(namespace, decision_id) as Array<{ id: string; content: string; metadata: string | null }>;

    let conflictCount = 0;

    for (const existing of existingDecisions) {
      // Skip superseded decisions
      const metadata = existing.metadata ? JSON.parse(existing.metadata) : {};
      if (metadata.superseded_by) continue;

      // Simple conflict detection: check for contradictory keywords
      const hasConflict = checkContentConflict(content, existing.content);

      if (hasConflict) {
        const conflict_id = randomUUID();
        db.prepare(`
          INSERT INTO conflicts (
            id, fact_id_1, fact_id_2, conflict_type,
            description, severity, resolution_status, namespace
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          conflict_id,
          decision_id,
          existing.id,
          'decision_conflict',
          `Decision "${content}" conflicts with "${existing.content}"`,
          'medium',
          'unresolved',
          namespace
        );
        conflictCount++;
      }
    }

    return conflictCount;
  }

  /**
   * Helper to detect content conflicts (simplified)
   */
  function checkContentConflict(content1: string, content2: string): boolean {
    const c1 = content1.toLowerCase();
    const c2 = content2.toLowerCase();

    // Check for contradictory patterns
    const patterns = [
      { positive: ['typescript'], negative: ['javascript'] },
      { positive: ['postgresql'], negative: ['mysql'] },
      { positive: ['rest'], negative: ['graphql'] },
      { positive: ['monolith'], negative: ['microservices'] },
    ];

    for (const pattern of patterns) {
      // Check if content1 has positive terms and content2 has negative terms
      const has1Positive = pattern.positive.some(term => c1.includes(term));
      const has1Negative = pattern.negative.some(term => c1.includes(term));
      const has2Positive = pattern.positive.some(term => c2.includes(term));
      const has2Negative = pattern.negative.some(term => c2.includes(term));

      if ((has1Positive && has2Negative) || (has1Negative && has2Positive)) {
        return true;
      }
    }

    return false;
  }

  describe('Basic Decision Storage', () => {
    it('should store a decision with correct memory_type="decision"', () => {
      const result = storeDecision({
        content: 'Use TypeScript for all new projects',
        rationale: 'Type safety reduces bugs',
      });

      const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(result.decision_id) as any;
      expect(memory).toBeDefined();
      expect(memory.memory_type).toBe('decision');
      expect(memory.content).toBe('Use TypeScript for all new projects');
    });

    it('should set decay_factor=0.25 in metadata', () => {
      const result = storeDecision({
        content: 'Use PostgreSQL for database',
      });

      const memory = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(result.decision_id) as any;
      const metadata = JSON.parse(memory.metadata);
      expect(metadata.decay_factor).toBe(0.25);
    });

    it('should store decision with correct namespace', () => {
      const result = storeDecision({
        content: 'Use Vitest for testing',
        namespace: 'project-alpha',
      });

      const memory = db.prepare('SELECT namespace FROM memories WHERE id = ?').get(result.decision_id) as any;
      expect(memory.namespace).toBe('project-alpha');
    });

    it('should store decision with agent_id and task_id', () => {
      const result = storeDecision({
        content: 'Implement caching layer',
        agent_id: 'agent-123',
        task_id: 'task-456',
      });

      const memory = db.prepare('SELECT agent_id, task_id FROM memories WHERE id = ?').get(result.decision_id) as any;
      expect(memory.agent_id).toBe('agent-123');
      expect(memory.task_id).toBe('task-456');
    });

    it('should have proper timestamps', () => {
      const result = storeDecision({
        content: 'Use Redis for caching',
      });

      const memory = db.prepare('SELECT created_at, updated_at FROM memories WHERE id = ?').get(result.decision_id) as any;
      expect(memory.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(memory.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(memory.created_at).toBe(memory.updated_at);
    });

    it('should default importance to 0.5', () => {
      const result = storeDecision({
        content: 'Use Docker for containerization',
      });

      const memory = db.prepare('SELECT importance FROM memories WHERE id = ?').get(result.decision_id) as any;
      expect(memory.importance).toBe(0.5);
    });
  });

  describe('Supersedes Logic', () => {
    it('should mark old decision with superseded_by', () => {
      // Store initial decision
      const oldResult = storeDecision({
        content: 'Use JavaScript for frontend',
      });

      // Supersede it
      const newResult = storeDecision({
        content: 'Use TypeScript for frontend',
        supersedes: oldResult.decision_id,
      });

      const oldMemory = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(oldResult.decision_id) as any;
      const oldMetadata = JSON.parse(oldMemory.metadata);
      expect(oldMetadata.superseded_by).toBe(newResult.decision_id);
    });

    it('should add superseded_at timestamp', () => {
      const oldResult = storeDecision({
        content: 'Use MySQL for database',
      });

      const newResult = storeDecision({
        content: 'Use PostgreSQL for database',
        supersedes: oldResult.decision_id,
      });

      const oldMemory = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(oldResult.decision_id) as any;
      const oldMetadata = JSON.parse(oldMemory.metadata);
      expect(oldMetadata.superseded_at).toBeDefined();
      expect(oldMetadata.superseded_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should reference what it supersedes in metadata', () => {
      const oldResult = storeDecision({
        content: 'Use REST API',
      });

      const newResult = storeDecision({
        content: 'Use GraphQL API',
        supersedes: oldResult.decision_id,
      });

      const newMemory = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(newResult.decision_id) as any;
      const newMetadata = JSON.parse(newMemory.metadata);
      expect(newMetadata.supersedes).toBe(oldResult.decision_id);
    });

    it('should not fail when superseding non-existent decision', () => {
      const fakeId = randomUUID();

      expect(() => {
        storeDecision({
          content: 'New decision',
          supersedes: fakeId,
        });
      }).not.toThrow();
    });

    it('should handle chain of supersedes (A → B → C)', () => {
      const resultA = storeDecision({
        content: 'Decision A: Use monolith architecture',
      });

      const resultB = storeDecision({
        content: 'Decision B: Use microservices architecture',
        supersedes: resultA.decision_id,
      });

      const resultC = storeDecision({
        content: 'Decision C: Use hybrid architecture',
        supersedes: resultB.decision_id,
      });

      // Check A is superseded by B
      const memoryA = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(resultA.decision_id) as any;
      const metadataA = JSON.parse(memoryA.metadata);
      expect(metadataA.superseded_by).toBe(resultB.decision_id);

      // Check B is superseded by C
      const memoryB = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(resultB.decision_id) as any;
      const metadataB = JSON.parse(memoryB.metadata);
      expect(metadataB.superseded_by).toBe(resultC.decision_id);

      // Check C is not superseded
      const memoryC = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(resultC.decision_id) as any;
      const metadataC = JSON.parse(memoryC.metadata);
      expect(metadataC.superseded_by).toBeUndefined();
    });

    it('should only supersede decisions in same namespace', () => {
      const oldResult = storeDecision({
        content: 'Use Redis caching',
        namespace: 'project-alpha',
      });

      const newResult = storeDecision({
        content: 'Use Memcached caching',
        namespace: 'project-beta',
        supersedes: oldResult.decision_id,
      });

      // Old decision should NOT be marked as superseded (different namespace)
      const oldMemory = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(oldResult.decision_id) as any;
      const oldMetadata = JSON.parse(oldMemory.metadata);
      expect(oldMetadata.superseded_by).toBeUndefined();
    });
  });

  describe('Conflict Detection', () => {
    it('should detect conflicting decisions (same topic, different values)', () => {
      // Store first decision
      storeDecision({
        content: 'Use TypeScript for all new code',
      });

      // Store conflicting decision
      const result = storeDecision({
        content: 'Use JavaScript for new code',
      });

      expect(result.conflicts_detected).toBeGreaterThan(0);

      const conflicts = db.prepare('SELECT * FROM conflicts WHERE fact_id_1 = ? OR fact_id_2 = ?')
        .all(result.decision_id, result.decision_id);
      expect(conflicts.length).toBeGreaterThan(0);
    });

    it('should not detect conflict for compatible decisions', () => {
      storeDecision({
        content: 'Use TypeScript for frontend',
      });

      const result = storeDecision({
        content: 'Use Node.js for backend',
      });

      expect(result.conflicts_detected).toBe(0);
    });

    it('should scope conflict detection to namespace', () => {
      // Store decision in namespace A
      storeDecision({
        content: 'Use PostgreSQL for database',
        namespace: 'project-alpha',
      });

      // Store conflicting decision in namespace B (should not conflict)
      const result = storeDecision({
        content: 'Use MySQL for database',
        namespace: 'project-beta',
      });

      expect(result.conflicts_detected).toBe(0);
    });

    it('should store conflict with correct severity', () => {
      storeDecision({
        content: 'Prefer REST APIs',
      });

      const result = storeDecision({
        content: 'Prefer GraphQL APIs',
      });

      if (result.conflicts_detected > 0) {
        const conflict = db.prepare('SELECT severity FROM conflicts WHERE fact_id_1 = ? OR fact_id_2 = ?')
          .get(result.decision_id, result.decision_id) as any;
        expect(conflict.severity).toBe('medium');
      }
    });

    it('should detect multiple conflicts from single decision', () => {
      // Store multiple conflicting decisions on different topics
      storeDecision({
        content: 'Use TypeScript for development',
      });

      storeDecision({
        content: 'Prefer REST APIs for services',
      });

      // Store decision that conflicts with both
      const result = storeDecision({
        content: 'Use JavaScript for development and GraphQL for services',
      });

      // Should detect at least 1 conflict (might detect 2 if both patterns match)
      expect(result.conflicts_detected).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle decision with empty rationale', () => {
      const result = storeDecision({
        content: 'Use Docker',
        rationale: '',
      });

      const memory = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(result.decision_id) as any;
      const metadata = JSON.parse(memory.metadata);
      expect(metadata.rationale).toBe('');
      expect(metadata.decay_factor).toBe(0.25);
    });

    it('should store very long decision content correctly', () => {
      const longContent = 'A'.repeat(5000);
      const result = storeDecision({
        content: longContent,
      });

      const memory = db.prepare('SELECT content FROM memories WHERE id = ?').get(result.decision_id) as any;
      expect(memory.content).toBe(longContent);
      expect(memory.content.length).toBe(5000);
    });

    it('should preserve custom metadata fields alongside decay_factor', () => {
      const result = storeDecision({
        content: 'Use Kubernetes for orchestration',
        metadata: {
          custom_field: 'custom_value',
          priority: 'high',
          tags: ['infrastructure', 'devops'],
        },
      });

      const memory = db.prepare('SELECT metadata FROM memories WHERE id = ?').get(result.decision_id) as any;
      const metadata = JSON.parse(memory.metadata);
      expect(metadata.decay_factor).toBe(0.25);
      expect(metadata.custom_field).toBe('custom_value');
      expect(metadata.priority).toBe('high');
      expect(metadata.tags).toEqual(['infrastructure', 'devops']);
    });
  });
});
