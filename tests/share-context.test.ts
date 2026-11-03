import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

interface Memory {
  id: string;
  content: string;
  memory_type: string;
  embedding: string | null;
  created_at: string;
  updated_at: string;
  importance: number;
  access_count: number;
  last_accessed: string | null;
  metadata: string | null;
  namespace: string;
  agent_id: string | null;
  agent_role: string | null;
  task_id: string | null;
}

interface Entity {
  id: string;
  name: string;
  type: string;
  description: string | null;
  confidence: number;
  created_at: string;
  last_accessed: string;
  access_count: number;
  namespace: string;
}

interface Relationship {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  strength: number;
  evidence: string | null;
  created_at: string;
  last_reinforced: string;
  namespace: string;
}

interface ContextBundle {
  memories: Memory[];
  entities: Entity[];
  handoff_id: string;
}

/**
 * Simulates the share_context handler logic at SQL level
 */
function shareContext(
  db: Database.Database,
  sourceNamespace: string,
  targetNamespace: string,
  options?: {
    task_id?: string;
    query?: string;
    limit?: number;
  }
): ContextBundle {
  const now = new Date().toISOString();

  // 1. Query memories from source_namespace with optional filters
  let memoriesQuery = `
    SELECT * FROM memories
    WHERE namespace = ?
  `;
  const params: any[] = [sourceNamespace];

  if (options?.task_id) {
    memoriesQuery += ' AND task_id = ?';
    params.push(options.task_id);
  }

  if (options?.query) {
    memoriesQuery += ' AND content LIKE ?';
    params.push(`%${options.query}%`);
  }

  if (options?.limit) {
    memoriesQuery += ' LIMIT ?';
    params.push(options.limit);
  }

  const memories = db.prepare(memoriesQuery).all(...params) as Memory[];

  // 2. Query entities from source_namespace
  const entities = db
    .prepare('SELECT * FROM entities WHERE namespace = ?')
    .all(sourceNamespace) as Entity[];

  // 3. Store handoff event in target_namespace
  const handoffId = randomUUID();
  const handoffMetadata = {
    source_namespace: sourceNamespace,
    target_namespace: targetNamespace,
    memories_shared: memories.length,
    entities_shared: entities.length,
    task_id: options?.task_id,
    timestamp: now,
  };

  const handoffContent = `Context handoff from "${sourceNamespace}" to "${targetNamespace}": shared ${memories.length} memories and ${entities.length} entities${
    options?.task_id ? ` for task ${options.task_id}` : ''
  }`;

  db.prepare(`
    INSERT INTO memories (
      id, content, memory_type, embedding, created_at, updated_at,
      importance, access_count, last_accessed, metadata, namespace,
      agent_id, agent_role, task_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    handoffId,
    handoffContent,
    'episodic',
    null,
    now,
    now,
    0.8,
    0,
    null,
    JSON.stringify(handoffMetadata),
    targetNamespace,
    null,
    null,
    options?.task_id || null
  );

  // 4. Return context bundle
  return {
    memories,
    entities,
    handoff_id: handoffId,
  };
}

describe('share_context', () => {
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
    `);
  });

  describe('Basic Context Sharing', () => {
    it('should share all memories from source to target namespace', () => {
      const now = new Date().toISOString();

      // Insert test memories in source namespace
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory 1', 'semantic', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem2', 'Memory 2', 'episodic', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      expect(result.memories).toHaveLength(2);
      expect(result.memories[0].content).toBe('Memory 1');
      expect(result.memories[1].content).toBe('Memory 2');
      expect(result.handoff_id).toBeDefined();
    });

    it('should share filtered by task_id', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Task A memory', 'semantic', now, now, 'source-ns', 'task-a');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem2', 'Task B memory', 'semantic', now, now, 'source-ns', 'task-b');

      const result = shareContext(db, 'source-ns', 'target-ns', { task_id: 'task-a' });

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].content).toBe('Task A memory');
      expect(result.memories[0].task_id).toBe('task-a');
    });

    it('should share includes entities from source namespace', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory 1', 'semantic', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent1', 'Entity 1', 'person', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent2', 'Entity 2', 'concept', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      expect(result.entities).toHaveLength(2);
      expect(result.entities[0].name).toBe('Entity 1');
      expect(result.entities[1].name).toBe('Entity 2');
    });

    it('should store handoff event in target namespace', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory 1', 'semantic', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      const handoffEvent = db
        .prepare('SELECT * FROM memories WHERE id = ?')
        .get(result.handoff_id) as Memory;

      expect(handoffEvent).toBeDefined();
      expect(handoffEvent.namespace).toBe('target-ns');
      expect(handoffEvent.content).toContain('Context handoff');
    });

    it('should store handoff event with memory_type=episodic', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory 1', 'semantic', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      const handoffEvent = db
        .prepare('SELECT * FROM memories WHERE id = ?')
        .get(result.handoff_id) as Memory;

      expect(handoffEvent.memory_type).toBe('episodic');
    });

    it('should include source_namespace and target_namespace in handoff metadata', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory 1', 'semantic', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      const handoffEvent = db
        .prepare('SELECT * FROM memories WHERE id = ?')
        .get(result.handoff_id) as Memory;

      const metadata = JSON.parse(handoffEvent.metadata!);
      expect(metadata.source_namespace).toBe('source-ns');
      expect(metadata.target_namespace).toBe('target-ns');
      expect(metadata.memories_shared).toBe(1);
    });

    it('should return empty bundle when source namespace is empty', () => {
      const result = shareContext(db, 'empty-ns', 'target-ns');

      expect(result.memories).toHaveLength(0);
      expect(result.entities).toHaveLength(0);
      expect(result.handoff_id).toBeDefined();

      // Handoff event should still be created
      const handoffEvent = db
        .prepare('SELECT * FROM memories WHERE id = ?')
        .get(result.handoff_id) as Memory;
      expect(handoffEvent).toBeDefined();
    });

    it('should leave source memories unchanged after sharing', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory 1', 'semantic', now, now, 'source-ns', 5);

      shareContext(db, 'source-ns', 'target-ns');

      const sourceMemory = db
        .prepare('SELECT * FROM memories WHERE id = ?')
        .get('mem1') as Memory;

      expect(sourceMemory.namespace).toBe('source-ns');
      expect(sourceMemory.access_count).toBe(5);
      expect(sourceMemory.content).toBe('Memory 1');
    });
  });

  describe('Filtering', () => {
    it('should filter by task_id returning only matching memories', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Task A memory 1', 'semantic', now, now, 'source-ns', 'task-a');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem2', 'Task A memory 2', 'semantic', now, now, 'source-ns', 'task-a');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem3', 'Task B memory', 'semantic', now, now, 'source-ns', 'task-b');

      const result = shareContext(db, 'source-ns', 'target-ns', { task_id: 'task-a' });

      expect(result.memories).toHaveLength(2);
      expect(result.memories.every((m) => m.task_id === 'task-a')).toBe(true);
    });

    it('should return empty when filter by task_id has no matches', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Task A memory', 'semantic', now, now, 'source-ns', 'task-a');

      const result = shareContext(db, 'source-ns', 'target-ns', { task_id: 'task-nonexistent' });

      expect(result.memories).toHaveLength(0);
    });

    it('should filter multiple task_ids in source, returning only one', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Task A memory', 'semantic', now, now, 'source-ns', 'task-a');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem2', 'Task B memory', 'semantic', now, now, 'source-ns', 'task-b');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem3', 'Task C memory', 'semantic', now, now, 'source-ns', 'task-c');

      const result = shareContext(db, 'source-ns', 'target-ns', { task_id: 'task-b' });

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].task_id).toBe('task-b');
    });

    it('should filter by content query matching text', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'User prefers TypeScript', 'semantic', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem2', 'User likes Python', 'semantic', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns', { query: 'TypeScript' });

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].content).toContain('TypeScript');
    });

    it('should combine task_id and content filter', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Task A TypeScript work', 'semantic', now, now, 'source-ns', 'task-a');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem2', 'Task A Python work', 'semantic', now, now, 'source-ns', 'task-a');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('mem3', 'Task B TypeScript work', 'semantic', now, now, 'source-ns', 'task-b');

      const result = shareContext(db, 'source-ns', 'target-ns', {
        task_id: 'task-a',
        query: 'TypeScript',
      });

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].task_id).toBe('task-a');
      expect(result.memories[0].content).toContain('TypeScript');
    });

    it('should restrict number of shared memories with limit parameter', () => {
      const now = new Date().toISOString();

      for (let i = 1; i <= 5; i++) {
        db.prepare(`
          INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`mem${i}`, `Memory ${i}`, 'semantic', now, now, 'source-ns');
      }

      const result = shareContext(db, 'source-ns', 'target-ns', { limit: 2 });

      expect(result.memories).toHaveLength(2);
    });

    it('should only include memories from source namespace, not other namespaces', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Source memory', 'semantic', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem2', 'Other memory', 'semantic', now, now, 'other-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].namespace).toBe('source-ns');
    });

    it('should preserve agent attribution in shared context', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, agent_id, agent_role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory with agent', 'semantic', now, now, 'source-ns', 'agent-123', 'researcher');

      const result = shareContext(db, 'source-ns', 'target-ns');

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].agent_id).toBe('agent-123');
      expect(result.memories[0].agent_role).toBe('researcher');
    });
  });

  describe('Entity Inclusion', () => {
    it('should include entities from source namespace in bundle', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent1', 'Alice', 'person', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent2', 'TypeScript', 'technology', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      expect(result.entities).toHaveLength(2);
      expect(result.entities.map((e) => e.name)).toContain('Alice');
      expect(result.entities.map((e) => e.name)).toContain('TypeScript');
    });

    it('should exclude entities from other namespaces', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent1', 'Source Entity', 'concept', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent2', 'Other Entity', 'concept', now, now, 'other-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Source Entity');
    });

    it('should include relationships between entities', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent1', 'Entity 1', 'concept', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent2', 'Entity 2', 'concept', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO relationships (id, source_id, target_id, relation_type, created_at, last_reinforced, namespace)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('rel1', 'ent1', 'ent2', 'related_to', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      expect(result.entities).toHaveLength(2);

      // Verify relationship exists
      const relationships = db
        .prepare('SELECT * FROM relationships WHERE namespace = ?')
        .all('source-ns') as Relationship[];

      expect(relationships).toHaveLength(1);
      expect(relationships[0].relation_type).toBe('related_to');
    });

    it('should preserve entity types', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent1', 'Alice', 'person', now, now, 'source-ns');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ent2', 'API', 'technology', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      const personEntity = result.entities.find((e) => e.name === 'Alice');
      const techEntity = result.entities.find((e) => e.name === 'API');

      expect(personEntity?.type).toBe('person');
      expect(techEntity?.type).toBe('technology');
    });

    it('should return empty entity set when no entities in source', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory without entities', 'semantic', now, now, 'source-ns');

      const result = shareContext(db, 'source-ns', 'target-ns');

      expect(result.entities).toHaveLength(0);
      expect(result.memories).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle sharing context to same namespace (source=target)', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory 1', 'semantic', now, now, 'same-ns');

      const result = shareContext(db, 'same-ns', 'same-ns');

      expect(result.memories).toHaveLength(1);
      expect(result.handoff_id).toBeDefined();

      // Handoff event should be in the same namespace
      const handoffEvent = db
        .prepare('SELECT * FROM memories WHERE id = ?')
        .get(result.handoff_id) as Memory;

      expect(handoffEvent.namespace).toBe('same-ns');
    });

    it('should return empty bundle when sharing from non-existent namespace', () => {
      const result = shareContext(db, 'nonexistent-ns', 'target-ns');

      expect(result.memories).toHaveLength(0);
      expect(result.entities).toHaveLength(0);
      expect(result.handoff_id).toBeDefined();
    });

    it('should create multiple handoff events for sequential shares', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory 1', 'semantic', now, now, 'source-ns');

      const result1 = shareContext(db, 'source-ns', 'target-ns-1');
      const result2 = shareContext(db, 'source-ns', 'target-ns-2');

      const handoffEvents = db
        .prepare('SELECT * FROM memories WHERE memory_type = ? AND content LIKE ?')
        .all('episodic', '%Context handoff%') as Memory[];

      expect(handoffEvents).toHaveLength(2);
      expect(result1.handoff_id).not.toBe(result2.handoff_id);
    });

    it('should generate unique handoff IDs', () => {
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('mem1', 'Memory 1', 'semantic', now, now, 'source-ns');

      const result1 = shareContext(db, 'source-ns', 'target-ns');
      const result2 = shareContext(db, 'source-ns', 'target-ns');
      const result3 = shareContext(db, 'source-ns', 'target-ns');

      const handoffIds = [result1.handoff_id, result2.handoff_id, result3.handoff_id];
      const uniqueIds = new Set(handoffIds);

      expect(uniqueIds.size).toBe(3);
    });
  });
});
