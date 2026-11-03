import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

describe('Agent Attribution Storage and Filtering', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory SQLite database
    db = new Database(':memory:');

    // Create schema with agent attribution fields
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
    `);
  });

  describe('Storage with Agent Attribution', () => {
    it('should store memory with agent_id', () => {
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, agent_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run('mem-1', 'User prefers TypeScript', 'semantic', new Date().toISOString(), new Date().toISOString(), 'agent-123');

      const result = db.prepare('SELECT * FROM memories WHERE id = ?').get('mem-1') as any;
      expect(result.agent_id).toBe('agent-123');
      expect(result.agent_role).toBeNull();
      expect(result.task_id).toBeNull();
    });

    it('should store memory with agent_id and agent_role', () => {
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, agent_id, agent_role)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run('mem-2', 'Fixed race condition bug', 'episodic', new Date().toISOString(), new Date().toISOString(), 'agent-456', 'debugger');

      const result = db.prepare('SELECT * FROM memories WHERE id = ?').get('mem-2') as any;
      expect(result.agent_id).toBe('agent-456');
      expect(result.agent_role).toBe('debugger');
      expect(result.task_id).toBeNull();
    });

    it('should store memory with task_id', () => {
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, task_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run('mem-3', 'Implemented auth system', 'episodic', new Date().toISOString(), new Date().toISOString(), 'task-789');

      const result = db.prepare('SELECT * FROM memories WHERE id = ?').get('mem-3') as any;
      expect(result.agent_id).toBeNull();
      expect(result.task_id).toBe('task-789');
    });

    it('should store memory with all attribution fields', () => {
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, agent_id, agent_role, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run('mem-4', 'Optimized database queries', 'procedural', new Date().toISOString(), new Date().toISOString(), 'agent-999', 'optimizer', 'task-100');

      const result = db.prepare('SELECT * FROM memories WHERE id = ?').get('mem-4') as any;
      expect(result.agent_id).toBe('agent-999');
      expect(result.agent_role).toBe('optimizer');
      expect(result.task_id).toBe('task-100');
    });

    it('should store memory without attribution (null fields)', () => {
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run('mem-5', 'General knowledge', 'semantic', new Date().toISOString(), new Date().toISOString());

      const result = db.prepare('SELECT * FROM memories WHERE id = ?').get('mem-5') as any;
      expect(result.agent_id).toBeNull();
      expect(result.agent_role).toBeNull();
      expect(result.task_id).toBeNull();
    });

    it('should allow multiple agents storing to same namespace', () => {
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, agent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run('mem-6', 'Memory from agent A', 'semantic', new Date().toISOString(), new Date().toISOString(), 'project-x', 'agent-A');
      stmt.run('mem-7', 'Memory from agent B', 'semantic', new Date().toISOString(), new Date().toISOString(), 'project-x', 'agent-B');
      stmt.run('mem-8', 'Memory from agent C', 'semantic', new Date().toISOString(), new Date().toISOString(), 'project-x', 'agent-C');

      const results = db.prepare('SELECT * FROM memories WHERE namespace = ?').all('project-x') as any[];
      expect(results).toHaveLength(3);
      expect(results.map(r => r.agent_id).sort()).toEqual(['agent-A', 'agent-B', 'agent-C']);
    });
  });

  describe('Filtering by Agent', () => {
    beforeEach(() => {
      // Insert test data
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, agent_id, agent_role, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = new Date().toISOString();
      stmt.run('mem-10', 'Agent A memory 1', 'semantic', now, now, 'default', 'agent-A', 'coder', 'task-1');
      stmt.run('mem-11', 'Agent A memory 2', 'semantic', now, now, 'default', 'agent-A', 'coder', 'task-1');
      stmt.run('mem-12', 'Agent B memory 1', 'semantic', now, now, 'default', 'agent-B', 'reviewer', 'task-2');
      stmt.run('mem-13', 'Agent B memory 2', 'semantic', now, now, 'default', 'agent-B', 'reviewer', 'task-3');
      stmt.run('mem-14', 'No agent memory', 'semantic', now, now, 'default', null, null, null);
      stmt.run('mem-15', 'Agent A in other namespace', 'semantic', now, now, 'project-y', 'agent-A', 'coder', 'task-1');
    });

    it('should filter memories by agent_id', () => {
      const results = db.prepare('SELECT * FROM memories WHERE agent_id = ?').all('agent-A') as any[];

      expect(results).toHaveLength(3);
      expect(results.map(r => r.id).sort()).toEqual(['mem-10', 'mem-11', 'mem-15']);
    });

    it('should filter memories by task_id', () => {
      const results = db.prepare('SELECT * FROM memories WHERE task_id = ?').all('task-1') as any[];

      expect(results).toHaveLength(3);
      expect(results.map(r => r.id).sort()).toEqual(['mem-10', 'mem-11', 'mem-15']);
    });

    it('should filter memories by agent_id AND task_id combined', () => {
      const results = db.prepare('SELECT * FROM memories WHERE agent_id = ? AND task_id = ?').all('agent-A', 'task-1') as any[];

      expect(results).toHaveLength(3);
      expect(results.every(r => r.agent_id === 'agent-A' && r.task_id === 'task-1')).toBe(true);
    });

    it('should support exclude_agent filter (WHERE agent_id != ?)', () => {
      const results = db.prepare('SELECT * FROM memories WHERE namespace = ? AND (agent_id IS NULL OR agent_id != ?)').all('default', 'agent-A') as any[];

      expect(results).toHaveLength(3);
      expect(results.map(r => r.id).sort()).toEqual(['mem-12', 'mem-13', 'mem-14']);
    });

    it('should return empty when no matching agent', () => {
      const results = db.prepare('SELECT * FROM memories WHERE agent_id = ?').all('agent-nonexistent') as any[];

      expect(results).toHaveLength(0);
    });

    it('should filter multiple agents one at a time', () => {
      const agentAResults = db.prepare('SELECT * FROM memories WHERE agent_id = ? AND namespace = ?').all('agent-A', 'default') as any[];
      const agentBResults = db.prepare('SELECT * FROM memories WHERE agent_id = ? AND namespace = ?').all('agent-B', 'default') as any[];

      expect(agentAResults).toHaveLength(2);
      expect(agentBResults).toHaveLength(2);
      expect(agentAResults.map(r => r.id).sort()).toEqual(['mem-10', 'mem-11']);
      expect(agentBResults.map(r => r.id).sort()).toEqual(['mem-12', 'mem-13']);
    });

    it('should filter with namespace AND agent_id combined', () => {
      const results = db.prepare('SELECT * FROM memories WHERE namespace = ? AND agent_id = ?').all('default', 'agent-A') as any[];

      expect(results).toHaveLength(2);
      expect(results.map(r => r.id).sort()).toEqual(['mem-10', 'mem-11']);
    });

    it('should respect namespace boundary with agent filter', () => {
      const defaultResults = db.prepare('SELECT * FROM memories WHERE namespace = ? AND agent_id = ?').all('default', 'agent-A') as any[];
      const projectYResults = db.prepare('SELECT * FROM memories WHERE namespace = ? AND agent_id = ?').all('project-y', 'agent-A') as any[];

      expect(defaultResults).toHaveLength(2);
      expect(projectYResults).toHaveLength(1);
      expect(defaultResults.map(r => r.id).sort()).toEqual(['mem-10', 'mem-11']);
      expect(projectYResults[0].id).toBe('mem-15');
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, agent_id, agent_role, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = new Date().toISOString();
      stmt.run('mem-20', 'No agent attribution', 'semantic', now, now, 'default', null, null, null);
      stmt.run('mem-21', 'Empty string agent', 'semantic', now, now, 'default', '', null, null);
      stmt.run('mem-22', 'Proper agent', 'semantic', now, now, 'default', 'agent-X', 'tester', null);
      stmt.run('mem-23', 'Task in namespace A', 'semantic', now, now, 'namespace-a', 'agent-Y', null, 'task-shared');
      stmt.run('mem-24', 'Task in namespace B', 'semantic', now, now, 'namespace-b', 'agent-Z', null, 'task-shared');
    });

    it('should distinguish null agent_id from records with agent attribution', () => {
      const nullAgents = db.prepare('SELECT * FROM memories WHERE agent_id IS NULL').all() as any[];
      const withAgents = db.prepare('SELECT * FROM memories WHERE agent_id IS NOT NULL').all() as any[];

      expect(nullAgents).toHaveLength(1);
      expect(withAgents).toHaveLength(4);
      expect(nullAgents[0].id).toBe('mem-20');
    });

    it('should handle empty string agent_id vs null', () => {
      const emptyString = db.prepare('SELECT * FROM memories WHERE agent_id = ?').all('') as any[];
      const nullValues = db.prepare('SELECT * FROM memories WHERE agent_id IS NULL').all() as any[];

      expect(emptyString).toHaveLength(1);
      expect(emptyString[0].id).toBe('mem-21');
      expect(nullValues).toHaveLength(1);
      expect(nullValues[0].id).toBe('mem-20');
    });

    it('should filter task_id across different namespaces', () => {
      const allTaskMatches = db.prepare('SELECT * FROM memories WHERE task_id = ?').all('task-shared') as any[];

      expect(allTaskMatches).toHaveLength(2);
      expect(allTaskMatches.map(r => r.namespace).sort()).toEqual(['namespace-a', 'namespace-b']);
    });

    it('should count memories by agent', () => {
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, agent_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const now = new Date().toISOString();
      stmt.run('mem-25', 'Agent A mem 1', 'semantic', now, now, 'agent-A');
      stmt.run('mem-26', 'Agent A mem 2', 'semantic', now, now, 'agent-A');
      stmt.run('mem-27', 'Agent A mem 3', 'semantic', now, now, 'agent-A');
      stmt.run('mem-28', 'Agent B mem 1', 'semantic', now, now, 'agent-B');

      const counts = db.prepare(`
        SELECT agent_id, COUNT(*) as count
        FROM memories
        WHERE agent_id IS NOT NULL
        GROUP BY agent_id
      `).all() as any[];

      const agentACount = counts.find(c => c.agent_id === 'agent-A');
      const agentBCount = counts.find(c => c.agent_id === 'agent-B');

      expect(agentACount?.count).toBe(3);
      expect(agentBCount?.count).toBe(1);
    });

    it('should verify agent_role does not affect filtering (informational only)', () => {
      // Insert memories with same agent_id but different roles
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, agent_id, agent_role)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const now = new Date().toISOString();
      stmt.run('mem-30', 'Agent as coder', 'semantic', now, now, 'agent-multi', 'coder');
      stmt.run('mem-31', 'Agent as reviewer', 'semantic', now, now, 'agent-multi', 'reviewer');
      stmt.run('mem-32', 'Agent as tester', 'semantic', now, now, 'agent-multi', 'tester');

      // Filter only by agent_id (not role)
      const results = db.prepare('SELECT * FROM memories WHERE agent_id = ?').all('agent-multi') as any[];

      expect(results).toHaveLength(3);
      expect(results.map(r => r.agent_role).sort()).toEqual(['coder', 'reviewer', 'tester']);
    });

    it('should handle large number of agents in same namespace', () => {
      const stmt = db.prepare(`
        INSERT INTO memories (id, content, memory_type, created_at, updated_at, namespace, agent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const now = new Date().toISOString();
      const agentCount = 100;

      // Insert 100 agents
      for (let i = 0; i < agentCount; i++) {
        stmt.run(`mem-bulk-${i}`, `Memory from agent ${i}`, 'semantic', now, now, 'bulk-namespace', `agent-${i}`);
      }

      // Verify all inserted
      const allResults = db.prepare('SELECT * FROM memories WHERE namespace = ?').all('bulk-namespace') as any[];
      expect(allResults).toHaveLength(agentCount);

      // Verify unique agents
      const uniqueAgents = db.prepare(`
        SELECT DISTINCT agent_id
        FROM memories
        WHERE namespace = ?
      `).all('bulk-namespace') as any[];
      expect(uniqueAgents).toHaveLength(agentCount);

      // Filter specific agent
      const singleAgent = db.prepare('SELECT * FROM memories WHERE agent_id = ?').all('agent-42') as any[];
      expect(singleAgent).toHaveLength(1);
      expect(singleAgent[0].content).toBe('Memory from agent 42');
    });
  });
});
