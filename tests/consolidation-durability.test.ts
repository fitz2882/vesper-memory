import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ConsolidationPipeline } from "../src/consolidation/pipeline.js";
import { SemanticMemoryLayer } from "../src/memory-layers/semantic-memory.js";
import { SkillLibrary } from "../src/memory-layers/skill-library.js";
import type { WorkingMemoryLayer } from "../src/memory-layers/working-memory.js";

describe("consolidation durability", () => {
  let tempDirectory: string;
  let dbPath: string;
  let db: Database.Database;
  let semanticMemory: SemanticMemoryLayer;
  let skillLibrary: SkillLibrary;

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vesper-consolidation-"));
    dbPath = path.join(tempDirectory, "memory.db");
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        namespace TEXT DEFAULT 'default'
      );
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        description TEXT, confidence REAL DEFAULT 1.0, created_at TEXT NOT NULL,
        last_accessed TEXT NOT NULL, access_count INTEGER DEFAULT 1,
        namespace TEXT DEFAULT 'default'
      );
      CREATE TABLE relationships (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL, strength REAL DEFAULT 0.8, evidence TEXT,
        created_at TEXT NOT NULL, last_reinforced TEXT NOT NULL,
        namespace TEXT DEFAULT 'default'
      );
      CREATE TABLE facts (
        id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, property TEXT NOT NULL,
        value TEXT NOT NULL, confidence REAL DEFAULT 1.0, valid_from TEXT,
        valid_until TEXT, source_conversation TEXT, namespace TEXT DEFAULT 'default'
      );
      CREATE TABLE conflicts (
        id TEXT PRIMARY KEY, fact_id_1 TEXT, fact_id_2 TEXT, conflict_type TEXT,
        description TEXT, severity TEXT, resolution_status TEXT,
        namespace TEXT DEFAULT 'default'
      );
      CREATE TABLE skills (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        summary TEXT, category TEXT NOT NULL, triggers TEXT NOT NULL,
        success_count INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0,
        avg_user_satisfaction REAL DEFAULT 0.5, is_archived INTEGER DEFAULT 0,
        last_used TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        namespace TEXT DEFAULT 'default'
      );
      CREATE TABLE backup_metadata (
        id TEXT PRIMARY KEY, backup_timestamp TEXT NOT NULL,
        backup_type TEXT NOT NULL, status TEXT NOT NULL, backup_path TEXT NOT NULL,
        file_size_bytes INTEGER, num_memories INTEGER, num_entities INTEGER,
        num_relationships INTEGER, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        notes TEXT, metadata TEXT
      );
    `);
    semanticMemory = new SemanticMemoryLayer(db);
    skillLibrary = new SkillLibrary(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  const unavailableWorkingMemory = {
    getRecent: async () => {
      throw new Error("Redis must not be consulted");
    },
  } as unknown as WorkingMemoryLayer;

  function insertMemory(id: string, namespace: string, createdAt: number): void {
    db.prepare(
      `
      INSERT INTO memories (id, content, memory_type, created_at, updated_at, metadata, namespace)
      VALUES (?, ?, 'semantic', ?, ?, ?, ?)
    `
    ).run(
      id,
      `I prefer ${id}`,
      createdAt,
      createdAt,
      JSON.stringify({ keyEntities: [id], topics: [] }),
      namespace
    );
  }

  function pipeline(
    options: ConstructorParameters<typeof ConsolidationPipeline>[4] = {}
  ): ConsolidationPipeline {
    return new ConsolidationPipeline(unavailableWorkingMemory, semanticMemory, skillLibrary, db, {
      backupDirectory: path.join(tempDirectory, "backups"),
      ...options,
    });
  }

  it("processes a bounded namespace-aware SQLite batch exactly once without Redis", async () => {
    insertMemory("alpha-1", "alpha", 1);
    insertMemory("alpha-2", "alpha", 2);
    insertMemory("alpha-3", "alpha", 3);
    insertMemory("beta-1", "beta", 4);
    const consolidation = pipeline({ batchSize: 2 });

    expect((await consolidation.consolidate("alpha")).memoriesProcessed).toBe(2);
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM memories WHERE namespace = 'alpha' AND consolidated_at IS NOT NULL"
          )
          .get() as { count: number }
      ).count
    ).toBe(2);
    expect(
      (
        db.prepare("SELECT consolidated_at FROM memories WHERE id = 'beta-1'").get() as {
          consolidated_at: number | null;
        }
      ).consolidated_at
    ).toBeNull();

    expect((await consolidation.consolidate("alpha")).memoriesProcessed).toBe(1);
    expect((await consolidation.consolidate("alpha")).memoriesProcessed).toBe(0);
    expect(
      (
        db
          .prepare(
            "SELECT access_count FROM entities WHERE name = 'alpha-1' AND namespace = 'alpha'"
          )
          .get() as { access_count: number }
      ).access_count
    ).toBe(1);
  });

  it("checkpoints a source memory only after all of its derived work succeeds", async () => {
    const now = Date.now();
    db.prepare(
      `
      INSERT INTO memories (id, content, memory_type, created_at, updated_at, metadata, namespace)
      VALUES ('retry-me', 'analysis memory', 'semantic', ?, ?, ?, 'default')
    `
    ).run(now, now, JSON.stringify({ keyEntities: ["rolled-back"], topics: ["analysis"] }));
    const failingSkills = {
      search: () => [],
      addSkill: () => {
        throw new Error("derived skill write failed");
      },
    } as unknown as SkillLibrary;
    const consolidation = new ConsolidationPipeline(
      unavailableWorkingMemory,
      semanticMemory,
      failingSkills,
      db,
      { backupDirectory: path.join(tempDirectory, "backups") }
    );

    expect((await consolidation.consolidate()).memoriesProcessed).toBe(0);
    expect(
      (
        db.prepare("SELECT consolidated_at FROM memories WHERE id = 'retry-me'").get() as {
          consolidated_at: number | null;
        }
      ).consolidated_at
    ).toBeNull();
    expect(
      (
        db.prepare("SELECT COUNT(*) AS count FROM entities WHERE name = 'rolled-back'").get() as {
          count: number;
        }
      ).count
    ).toBe(0);
  });

  it("decays only the elapsed interval since the previous decay cursor", () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    const reinforced = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    const lastDecayed = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    db.prepare(
      `
      INSERT INTO relationships (
        id, source_id, target_id, relation_type, strength, evidence,
        created_at, last_reinforced, last_decayed_at, namespace
      ) VALUES ('rel-1', 'a', 'b', 'related', 0.9, '[]', ?, ?, ?, 'default')
    `
    ).run(reinforced, reinforced, lastDecayed);

    semanticMemory.applyTemporalDecay("default", now);
    const once = (
      db.prepare("SELECT strength FROM relationships WHERE id = 'rel-1'").get() as {
        strength: number;
      }
    ).strength;
    expect(once).toBeCloseTo(0.9 * Math.exp(-1), 10);

    semanticMemory.applyTemporalDecay("default", now);
    const twice = (
      db.prepare("SELECT strength FROM relationships WHERE id = 'rel-1'").get() as {
        strength: number;
      }
    ).strength;
    expect(twice).toBeCloseTo(once, 12);

    semanticMemory.applyTemporalDecay("default", new Date(now.getTime() + 86_400_000));
    const nextDay = (
      db.prepare("SELECT strength FROM relationships WHERE id = 'rel-1'").get() as {
        strength: number;
      }
    ).strength;
    expect(nextDay).toBeCloseTo(once * Math.exp(-1 / 30), 10);
  });

  it("records metadata only after creating a readable owner-protected SQLite backup", async () => {
    insertMemory("backup-source", "default", Date.now());
    await pipeline().consolidate();

    const metadata = db.prepare("SELECT * FROM backup_metadata").get() as {
      backup_path: string;
      file_size_bytes: number;
      status: string;
      metadata: string;
    };
    expect(path.isAbsolute(metadata.backup_path)).toBe(true);
    expect(metadata.status).toBe("completed");
    expect(JSON.parse(metadata.metadata)).toMatchObject({
      verified: true,
      method: "better-sqlite3.backup",
    });

    const fileStats = fs.statSync(metadata.backup_path);
    expect(fileStats.isFile()).toBe(true);
    expect(fileStats.size).toBe(metadata.file_size_bytes);
    if (process.platform !== "win32") {
      expect(fileStats.mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(metadata.backup_path)).mode & 0o777).toBe(0o700);
    }

    const backup = new Database(metadata.backup_path, { readonly: true, fileMustExist: true });
    try {
      expect(backup.pragma("quick_check", { simple: true })).toBe("ok");
      expect(
        (
          backup.prepare("SELECT COUNT(*) AS count FROM memories").get() as {
            count: number;
          }
        ).count
      ).toBe(1);
    } finally {
      backup.close();
    }
  });

  it("does not claim a completed backup when no backup file can be created", async () => {
    const invalidBackupDirectory = path.join(tempDirectory, "not-a-directory");
    fs.writeFileSync(invalidBackupDirectory, "occupied");
    const consolidation = pipeline({ backupDirectory: invalidBackupDirectory });

    await expect(consolidation.consolidate()).rejects.toThrow();
    expect(
      (
        db.prepare("SELECT COUNT(*) AS count FROM backup_metadata").get() as {
          count: number;
        }
      ).count
    ).toBe(0);
  });

  it("removes only expired verified backup files inside the configured backup directory", async () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    const backupDirectory = path.join(tempDirectory, "backups");
    fs.mkdirSync(backupDirectory, { recursive: true });
    const expiredPath = path.join(backupDirectory, "expired.db");
    fs.writeFileSync(expiredPath, "expired backup fixture");
    db.prepare(
      `INSERT INTO backup_metadata (
         id, backup_timestamp, backup_type, status, backup_path,
         created_at, expires_at
       ) VALUES ('expired', ?, 'consolidation', 'completed', ?, ?, ?)`
    ).run(
      new Date(now.getTime() - 2 * 86_400_000).toISOString(),
      expiredPath,
      new Date(now.getTime() - 2 * 86_400_000).toISOString(),
      new Date(now.getTime() - 86_400_000).toISOString()
    );

    await pipeline({ now: () => now, backupRetentionDays: 7 }).consolidate();

    expect(fs.existsSync(expiredPath)).toBe(false);
    expect(db.prepare("SELECT id FROM backup_metadata WHERE id = 'expired'").get()).toBeUndefined();
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM backup_metadata").get() as { count: number }).count
    ).toBe(1);
  });

  it("detects conflicts against the exact shipped SQLite schema", async () => {
    const shippedPath = path.join(tempDirectory, "shipped.db");
    const shippedDb = new Database(shippedPath);
    try {
      shippedDb.exec(
        fs.readFileSync(path.join(process.cwd(), "config", "sqlite-schema.sql"), "utf8")
      );
      const createdAt = new Date().toISOString();
      shippedDb
        .prepare(
          `INSERT INTO entities (
             id, name, type, created_at, last_accessed, namespace
           ) VALUES ('entity-1', 'Database', 'concept', ?, ?, 'default')`
        )
        .run(createdAt, createdAt);
      const insertFact = shippedDb.prepare(
        `INSERT INTO facts (
           id, entity_id, property, value, confidence, valid_from, namespace
         ) VALUES (?, 'entity-1', 'engine', ?, 1, ?, 'default')`
      );
      insertFact.run("fact-1", "PostgreSQL", createdAt);
      insertFact.run("fact-2", "SQLite", createdAt);

      const shippedPipeline = new ConsolidationPipeline(
        unavailableWorkingMemory,
        new SemanticMemoryLayer(shippedDb),
        new SkillLibrary(shippedDb),
        shippedDb,
        { backupDirectory: path.join(tempDirectory, "shipped-backups") }
      );
      expect((await shippedPipeline.consolidate()).conflictsDetected).toBe(1);
      expect(
        shippedDb
          .prepare("SELECT entity_id, property FROM conflicts WHERE fact_id_1 = 'fact-1'")
          .get()
      ).toEqual({ entity_id: "entity-1", property: "engine" });
    } finally {
      shippedDb.close();
    }
  });
});
