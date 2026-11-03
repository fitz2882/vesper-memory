import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

describe('Namespace Tools - SQL Level', () => {
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

      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        triggers TEXT,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        avg_satisfaction REAL DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        namespace TEXT DEFAULT 'default'
      );
    `);
  });

  describe('list_namespaces', () => {
    it('should return all distinct namespaces from memories table', () => {
      // Insert memories with different namespaces
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m1', 'Memory 1', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'project-a');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m2', 'Memory 2', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'project-b');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m3', 'Memory 3', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'default');

      // Query distinct namespaces
      const namespaces = db.prepare(`
        SELECT DISTINCT namespace FROM (
          SELECT namespace FROM memories
          UNION
          SELECT namespace FROM entities
          UNION
          SELECT namespace FROM skills
        )
        ORDER BY namespace
      `).all();

      expect(namespaces).toHaveLength(3);
      expect(namespaces.map((n: any) => n.namespace)).toEqual(['default', 'project-a', 'project-b']);
    });

    it('should return namespaces from entities table', () => {
      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('e1', 'Entity 1', 'person', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'entities-ns');

      const namespaces = db.prepare(`
        SELECT DISTINCT namespace FROM (
          SELECT namespace FROM memories
          UNION
          SELECT namespace FROM entities
          UNION
          SELECT namespace FROM skills
        )
        ORDER BY namespace
      `).all();

      expect(namespaces).toHaveLength(1);
      expect(namespaces[0].namespace).toBe('entities-ns');
    });

    it('should return namespaces from skills table', () => {
      db.prepare(`
        INSERT INTO skills (id, name, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'Skill 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'skills-ns');

      const namespaces = db.prepare(`
        SELECT DISTINCT namespace FROM (
          SELECT namespace FROM memories
          UNION
          SELECT namespace FROM entities
          UNION
          SELECT namespace FROM skills
        )
        ORDER BY namespace
      `).all();

      expect(namespaces).toHaveLength(1);
      expect(namespaces[0].namespace).toBe('skills-ns');
    });

    it('should deduplicate namespaces across all tables', () => {
      // Insert same namespace across different tables
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m1', 'Memory 1', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'shared-ns');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('e1', 'Entity 1', 'person', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'shared-ns');

      db.prepare(`
        INSERT INTO skills (id, name, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'Skill 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'shared-ns');

      const namespaces = db.prepare(`
        SELECT DISTINCT namespace FROM (
          SELECT namespace FROM memories
          UNION
          SELECT namespace FROM entities
          UNION
          SELECT namespace FROM skills
        )
        ORDER BY namespace
      `).all();

      expect(namespaces).toHaveLength(1);
      expect(namespaces[0].namespace).toBe('shared-ns');
    });

    it('should return correct counts per namespace', () => {
      // Insert multiple items per namespace
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m1', 'Memory 1', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'project-a');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m2', 'Memory 2', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'project-a');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('e1', 'Entity 1', 'person', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'project-a');

      // Get counts per namespace
      const stats = db.prepare(`
        SELECT namespace,
          (SELECT COUNT(*) FROM memories WHERE namespace = ns.namespace) as memory_count,
          (SELECT COUNT(*) FROM entities WHERE namespace = ns.namespace) as entity_count,
          (SELECT COUNT(*) FROM skills WHERE namespace = ns.namespace) as skill_count
        FROM (
          SELECT DISTINCT namespace FROM (
            SELECT namespace FROM memories
            UNION
            SELECT namespace FROM entities
            UNION
            SELECT namespace FROM skills
          )
        ) ns
      `).all();

      expect(stats).toHaveLength(1);
      expect(stats[0]).toMatchObject({
        namespace: 'project-a',
        memory_count: 2,
        entity_count: 1,
        skill_count: 0
      });
    });

    it('should return empty list for empty database', () => {
      const namespaces = db.prepare(`
        SELECT DISTINCT namespace FROM (
          SELECT namespace FROM memories
          UNION
          SELECT namespace FROM entities
          UNION
          SELECT namespace FROM skills
        )
        ORDER BY namespace
      `).all();

      expect(namespaces).toHaveLength(0);
    });

    it('should handle many namespaces', () => {
      // Insert 10 different namespaces
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`m${i}`, `Memory ${i}`, 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', `namespace-${i}`);
      }

      const namespaces = db.prepare(`
        SELECT DISTINCT namespace FROM (
          SELECT namespace FROM memories
          UNION
          SELECT namespace FROM entities
          UNION
          SELECT namespace FROM skills
        )
        ORDER BY namespace
      `).all();

      expect(namespaces).toHaveLength(10);
      expect(namespaces.map((n: any) => n.namespace)).toEqual([
        'namespace-0', 'namespace-1', 'namespace-2', 'namespace-3', 'namespace-4',
        'namespace-5', 'namespace-6', 'namespace-7', 'namespace-8', 'namespace-9'
      ]);
    });
  });

  describe('namespace_stats', () => {
    it('should return correct memory count for namespace', () => {
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m1', 'Memory 1', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m2', 'Memory 2', 'episodic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m3', 'Memory 3', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'other-ns');

      const result = db.prepare(`
        SELECT COUNT(*) as memory_count
        FROM memories
        WHERE namespace = ?
      `).get('test-ns');

      expect(result).toMatchObject({ memory_count: 2 });
    });

    it('should return correct entity count for namespace', () => {
      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('e1', 'Entity 1', 'person', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('e2', 'Entity 2', 'organization', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      db.prepare(`
        INSERT INTO entities (id, name, type, created_at, last_accessed, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('e3', 'Entity 3', 'person', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      const result = db.prepare(`
        SELECT COUNT(*) as entity_count
        FROM entities
        WHERE namespace = ?
      `).get('test-ns');

      expect(result).toMatchObject({ entity_count: 3 });
    });

    it('should return correct skill count for namespace', () => {
      db.prepare(`
        INSERT INTO skills (id, name, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?)
      `).run('s1', 'Skill 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      db.prepare(`
        INSERT INTO skills (id, name, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?)
      `).run('s2', 'Skill 2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      const result = db.prepare(`
        SELECT COUNT(*) as skill_count
        FROM skills
        WHERE namespace = ?
      `).get('test-ns');

      expect(result).toMatchObject({ skill_count: 2 });
    });

    it('should return distinct agent_ids in namespace', () => {
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, agent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('m1', 'Memory 1', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns', 'agent-1');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, agent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('m2', 'Memory 2', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns', 'agent-2');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, agent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('m3', 'Memory 3', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns', 'agent-1');

      const result = db.prepare(`
        SELECT COUNT(DISTINCT agent_id) as distinct_agents
        FROM memories
        WHERE namespace = ? AND agent_id IS NOT NULL
      `).get('test-ns');

      expect(result).toMatchObject({ distinct_agents: 2 });
    });

    it('should return distinct task_ids in namespace', () => {
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('m1', 'Memory 1', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns', 'task-1');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('m2', 'Memory 2', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns', 'task-2');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('m3', 'Memory 3', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns', 'task-3');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('m4', 'Memory 4', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns', 'task-1');

      const result = db.prepare(`
        SELECT COUNT(DISTINCT task_id) as distinct_tasks
        FROM memories
        WHERE namespace = ? AND task_id IS NOT NULL
      `).get('test-ns');

      expect(result).toMatchObject({ distinct_tasks: 3 });
    });

    it('should return decision count for namespace', () => {
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m1', 'Decision 1', 'decision', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m2', 'Memory 2', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m3', 'Decision 2', 'decision', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      const result = db.prepare(`
        SELECT COUNT(*) as decision_count
        FROM memories
        WHERE namespace = ? AND memory_type = 'decision'
      `).get('test-ns');

      expect(result).toMatchObject({ decision_count: 2 });
    });

    it('should return correct date range for namespace', () => {
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m1', 'Memory 1', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'test-ns');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m2', 'Memory 2', 'semantic', '2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z', 'test-ns');

      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m3', 'Memory 3', 'semantic', '2026-01-31T00:00:00Z', '2026-01-31T00:00:00Z', 'test-ns');

      const result = db.prepare(`
        SELECT
          MIN(created_at) as earliest_created,
          MAX(created_at) as latest_created
        FROM memories
        WHERE namespace = ?
      `).get('test-ns');

      expect(result).toMatchObject({
        earliest_created: '2026-01-01T00:00:00Z',
        latest_created: '2026-01-31T00:00:00Z'
      });
    });

    it('should return zero counts for non-existent namespace', () => {
      // Insert data in different namespace
      db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('m1', 'Memory 1', 'semantic', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'other-ns');

      // Query non-existent namespace
      const result = db.prepare(`
        SELECT
          COUNT(*) as memory_count,
          (SELECT COUNT(*) FROM entities WHERE namespace = ?) as entity_count,
          (SELECT COUNT(*) FROM skills WHERE namespace = ?) as skill_count,
          (SELECT COUNT(DISTINCT agent_id) FROM memories WHERE namespace = ? AND agent_id IS NOT NULL) as distinct_agents,
          (SELECT COUNT(DISTINCT task_id) FROM memories WHERE namespace = ? AND task_id IS NOT NULL) as distinct_tasks,
          (SELECT COUNT(*) FROM memories WHERE namespace = ? AND memory_type = 'decision') as decision_count
        FROM memories
        WHERE namespace = ?
      `).get('non-existent', 'non-existent', 'non-existent', 'non-existent', 'non-existent', 'non-existent');

      expect(result).toMatchObject({
        memory_count: 0,
        entity_count: 0,
        skill_count: 0,
        distinct_agents: 0,
        distinct_tasks: 0,
        decision_count: 0
      });
    });
  });
});
