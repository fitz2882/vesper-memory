import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

/**
 * Test suite for delete_memory functionality
 *
 * Tests the memory deletion feature which:
 * - Deletes a memory from SQLite by ID and namespace
 * - Returns deleted memory details for confirmation
 * - Returns success: false if memory not found
 * - Cleans up orphaned facts where source_conversation = memory_id
 * - Handles namespace isolation correctly
 */

describe('delete_memory', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');

    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
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
    `);
  });

  function insertMemory(overrides: Partial<{
    id: string;
    content: string;
    memory_type: string;
    namespace: string;
    agent_id: string;
    task_id: string;
  }> = {}) {
    const id = overrides.id || randomUUID();
    const now = Date.now();
    db.prepare(`
      INSERT INTO memories (id, content, memory_type, created_at, updated_at, metadata, namespace, agent_id, task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      overrides.content || 'Test memory content',
      overrides.memory_type || 'semantic',
      now,
      now,
      '{}',
      overrides.namespace || 'default',
      overrides.agent_id || null,
      overrides.task_id || null
    );
    return { id, created_at: now };
  }

  function insertFact(memoryId: string, namespace = 'default') {
    const factId = randomUUID();
    db.prepare(`
      INSERT INTO facts (id, entity_id, property, value, source_conversation, namespace)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(factId, randomUUID(), 'test_prop', 'test_value', memoryId, namespace);
    return factId;
  }

  function deleteMemory(memoryId: string, namespace = 'default') {
    // Verify memory exists
    const existing = db.prepare(
      "SELECT id, content, memory_type, created_at FROM memories WHERE id = ? AND namespace = ?"
    ).get(memoryId, namespace) as any | undefined;

    if (!existing) {
      return { success: false, message: `Memory not found: ${memoryId} in namespace '${namespace}'` };
    }

    // Delete from SQLite
    db.prepare("DELETE FROM memories WHERE id = ? AND namespace = ?").run(memoryId, namespace);

    // Clean up orphaned facts
    db.prepare("DELETE FROM facts WHERE source_conversation = ? AND namespace = ?").run(memoryId, namespace);

    return {
      success: true,
      deleted: {
        id: existing.id,
        content: existing.content,
        memory_type: existing.memory_type,
        created_at: existing.created_at,
      },
      namespace,
      message: 'Memory deleted successfully',
    };
  }

  describe('Basic Deletion', () => {
    it('should delete an existing memory and return its details', () => {
      const { id } = insertMemory({ content: 'Memory to delete' });
      const result = deleteMemory(id);

      expect(result.success).toBe(true);
      expect(result.deleted).toBeDefined();
      expect(result.deleted.id).toBe(id);
      expect(result.deleted.content).toBe('Memory to delete');
      expect(result.deleted.memory_type).toBe('semantic');
      expect(result.message).toBe('Memory deleted successfully');
    });

    it('should actually remove the memory from the database', () => {
      const { id } = insertMemory();
      deleteMemory(id);

      const remaining = db.prepare("SELECT COUNT(*) as count FROM memories WHERE id = ?").get(id) as any;
      expect(remaining.count).toBe(0);
    });

    it('should return success: false for non-existent memory', () => {
      const fakeId = randomUUID();
      const result = deleteMemory(fakeId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Memory not found');
      expect(result.message).toContain(fakeId);
    });

    it('should not affect other memories when deleting one', () => {
      const { id: id1 } = insertMemory({ content: 'Keep this' });
      const { id: id2 } = insertMemory({ content: 'Delete this' });
      const { id: id3 } = insertMemory({ content: 'Keep this too' });

      deleteMemory(id2);

      const remaining = db.prepare("SELECT COUNT(*) as count FROM memories").get() as any;
      expect(remaining.count).toBe(2);

      const kept1 = db.prepare("SELECT content FROM memories WHERE id = ?").get(id1) as any;
      expect(kept1.content).toBe('Keep this');
      const kept3 = db.prepare("SELECT content FROM memories WHERE id = ?").get(id3) as any;
      expect(kept3.content).toBe('Keep this too');
    });
  });

  describe('Namespace Isolation', () => {
    it('should only delete memory in the specified namespace', () => {
      const { id: idA } = insertMemory({ content: 'NS-A memory', namespace: 'ns-a' });
      const { id: idB } = insertMemory({ content: 'NS-B memory', namespace: 'ns-b' });

      // Delete from ns-a
      const result = deleteMemory(idA, 'ns-a');
      expect(result.success).toBe(true);

      // NS-B memory should still exist
      const nsB = db.prepare("SELECT id FROM memories WHERE id = ? AND namespace = ?").get(idB, 'ns-b') as any;
      expect(nsB).toBeDefined();
    });

    it('should not delete memory from a different namespace', () => {
      const { id: idA } = insertMemory({ content: 'NS-A memory', namespace: 'ns-a' });
      const { id: idB } = insertMemory({ content: 'NS-B memory', namespace: 'ns-b' });

      // Try to delete ns-a memory using ns-b namespace
      const result = deleteMemory(idA, 'ns-b');
      expect(result.success).toBe(false);

      // Original still exists in ns-a
      const still = db.prepare("SELECT id FROM memories WHERE id = ? AND namespace = ?").get(idA, 'ns-a') as any;
      expect(still).toBeDefined();
    });

    it('should include namespace in the response', () => {
      const { id } = insertMemory({ namespace: 'my-ns' });
      const result = deleteMemory(id, 'my-ns');

      expect(result.success).toBe(true);
      expect(result.namespace).toBe('my-ns');
    });

    it('should default to "default" namespace', () => {
      const { id } = insertMemory();
      const result = deleteMemory(id);

      expect(result.success).toBe(true);
      expect(result.namespace).toBe('default');
    });
  });

  describe('Orphaned Facts Cleanup', () => {
    it('should delete facts linked to the deleted memory', () => {
      const { id } = insertMemory();
      const factId = insertFact(id);

      deleteMemory(id);

      const remaining = db.prepare("SELECT COUNT(*) as count FROM facts WHERE id = ?").get(factId) as any;
      expect(remaining.count).toBe(0);
    });

    it('should not delete facts linked to other memories', () => {
      const { id: id1 } = insertMemory();
      const { id: id2 } = insertMemory();
      insertFact(id1);
      const otherFactId = insertFact(id2);

      deleteMemory(id1);

      const remaining = db.prepare("SELECT COUNT(*) as count FROM facts WHERE id = ?").get(otherFactId) as any;
      expect(remaining.count).toBe(1);
    });

    it('should only delete facts in the same namespace', () => {
      const { id } = insertMemory({ namespace: 'ns-a' });
      // Create a fact in a different namespace with same source_conversation
      const crossNsFact = randomUUID();
      db.prepare(`
        INSERT INTO facts (id, entity_id, property, value, source_conversation, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(crossNsFact, randomUUID(), 'prop', 'val', id, 'ns-b');

      insertFact(id, 'ns-a');

      deleteMemory(id, 'ns-a');

      // Cross-namespace fact should survive
      const remaining = db.prepare("SELECT COUNT(*) as count FROM facts WHERE id = ?").get(crossNsFact) as any;
      expect(remaining.count).toBe(1);
    });
  });

  describe('Memory Types', () => {
    it('should delete episodic memories', () => {
      const { id } = insertMemory({ memory_type: 'episodic' });
      const result = deleteMemory(id);
      expect(result.success).toBe(true);
      expect(result.deleted.memory_type).toBe('episodic');
    });

    it('should delete semantic memories', () => {
      const { id } = insertMemory({ memory_type: 'semantic' });
      const result = deleteMemory(id);
      expect(result.success).toBe(true);
      expect(result.deleted.memory_type).toBe('semantic');
    });

    it('should delete procedural memories', () => {
      const { id } = insertMemory({ memory_type: 'procedural' });
      const result = deleteMemory(id);
      expect(result.success).toBe(true);
      expect(result.deleted.memory_type).toBe('procedural');
    });

    it('should delete decision memories', () => {
      const { id } = insertMemory({ memory_type: 'decision' });
      const result = deleteMemory(id);
      expect(result.success).toBe(true);
      expect(result.deleted.memory_type).toBe('decision');
    });
  });

  describe('Validation', () => {
    it('should handle empty string memory_id', () => {
      const result = deleteMemory('');
      expect(result.success).toBe(false);
    });

    it('should handle UUID-format memory_id that does not exist', () => {
      const result = deleteMemory(randomUUID());
      expect(result.success).toBe(false);
      expect(result.message).toContain('Memory not found');
    });
  });

  describe('Idempotency', () => {
    it('should return not found on second delete attempt', () => {
      const { id } = insertMemory();

      const first = deleteMemory(id);
      expect(first.success).toBe(true);

      const second = deleteMemory(id);
      expect(second.success).toBe(false);
      expect(second.message).toContain('Memory not found');
    });
  });
});
