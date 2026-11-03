/**
 * Tests for Consolidation Scheduler
 *
 * Verifies:
 * - Scheduler initialization and configuration
 * - Schedule time calculation (3 AM default)
 * - Manual trigger capability
 * - Graceful shutdown
 * - Error handling during consolidation
 * - Callback notifications
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ConsolidationScheduler,
  SchedulerConfig,
  SchedulerStatus,
  createScheduler,
} from "../src/scheduler/consolidation-scheduler.js";
import { SemanticMemoryLayer } from "../src/memory-layers/semantic-memory.js";
import { SkillLibrary } from "../src/memory-layers/skill-library.js";
import { ConsolidationPipeline } from "../src/consolidation/pipeline.js";

describe("ConsolidationScheduler", () => {
  let db: Database.Database;
  let semanticMemory: SemanticMemoryLayer;
  let skillLibrary: SkillLibrary;
  let pipeline: ConsolidationPipeline;
  let scheduler: ConsolidationScheduler;
  let backupDirectory: string;

  beforeEach(() => {
    // Setup in-memory SQLite
    db = new Database(":memory:");
    backupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vesper-scheduler-"));

    // Create schema
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

      CREATE TABLE backup_metadata (
        id TEXT PRIMARY KEY,
        backup_timestamp TIMESTAMP NOT NULL,
        backup_type TEXT NOT NULL,
        status TEXT NOT NULL,
        backup_path TEXT,
        file_size_bytes INTEGER,
        entities_count INTEGER,
        relationships_count INTEGER,
        skills_count INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      );
    `);

    semanticMemory = new SemanticMemoryLayer(db);
    skillLibrary = new SkillLibrary(db);
    pipeline = new ConsolidationPipeline(undefined, semanticMemory, skillLibrary, db, {
      backupDirectory,
    });
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.stop();
    }
    db.close();
    fs.rmSync(backupDirectory, { recursive: true, force: true });
  });

  function storeCanonicalMemory(memory: {
    conversationId: string;
    timestamp: Date;
    fullText: string;
    keyEntities: unknown;
    topics: unknown;
    userIntent: unknown;
  }): void {
    const timestamp = memory.timestamp.getTime();
    db.prepare(
      `
      INSERT INTO memories (
        id, content, memory_type, created_at, updated_at, metadata, namespace
      ) VALUES (?, ?, 'episodic', ?, ?, ?, 'default')
    `
    ).run(
      memory.conversationId,
      memory.fullText,
      timestamp,
      timestamp,
      JSON.stringify({
        keyEntities: memory.keyEntities,
        topics: memory.topics,
        userIntent: memory.userIntent,
      })
    );
  }

  describe("Initialization", () => {
    it("should create scheduler with default configuration", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      expect(scheduler).toBeDefined();
      expect(scheduler.getStatus().isRunning).toBe(false);
    });

    it("should create scheduler with custom configuration", () => {
      const config: SchedulerConfig = {
        scheduleHour: 4,
        scheduleMinute: 30,
        timezone: "UTC",
      };

      scheduler = new ConsolidationScheduler(pipeline, config);

      expect(scheduler).toBeDefined();
      const status = scheduler.getStatus();
      expect(status.scheduleHour).toBe(4);
      expect(status.scheduleMinute).toBe(30);
    });

    it("should use 3 AM as default schedule time", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      const status = scheduler.getStatus();
      expect(status.scheduleHour).toBe(3);
      expect(status.scheduleMinute).toBe(0);
    });

    it("should accept callback for completion notifications", () => {
      const callback = vi.fn();

      scheduler = new ConsolidationScheduler(pipeline, {}, callback);

      expect(scheduler).toBeDefined();
    });
  });

  describe("Schedule Time Calculation", () => {
    it("should calculate next run time correctly", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      const nextRun = scheduler.getNextRunTime();

      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun.getHours()).toBe(3);
      expect(nextRun.getMinutes()).toBe(0);
    });

    it("should calculate next run for tomorrow if past schedule time", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      const nextRun = scheduler.getNextRunTime();
      const now = new Date();

      // If current hour is past 3 AM, next run should be tomorrow
      if (now.getHours() >= 3) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        expect(nextRun.getDate()).toBe(tomorrow.getDate());
      }
    });

    it("should return milliseconds until next run", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      const msUntilRun = scheduler.getMsUntilNextRun();

      expect(typeof msUntilRun).toBe("number");
      expect(msUntilRun).toBeGreaterThan(0);
      expect(msUntilRun).toBeLessThanOrEqual(24 * 60 * 60 * 1000); // Max 24 hours
    });
  });

  describe("Start and Stop", () => {
    it("should start the scheduler", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      scheduler.start();

      expect(scheduler.getStatus().isRunning).toBe(true);
    });

    it("should stop the scheduler", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      scheduler.start();
      scheduler.stop();

      expect(scheduler.getStatus().isRunning).toBe(false);
    });

    it("should not throw when stopping a non-running scheduler", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      expect(() => scheduler.stop()).not.toThrow();
    });

    it("should not start multiple times", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      scheduler.start();
      scheduler.start(); // Second call should be no-op

      expect(scheduler.getStatus().isRunning).toBe(true);
    });
  });

  describe("Manual Trigger", () => {
    it("should run consolidation immediately when triggered manually", async () => {
      storeCanonicalMemory({
        conversationId: "conv-1",
        timestamp: new Date(),
        fullText: "Test memory for manual trigger",
        keyEntities: ["test"],
        topics: ["testing"],
        userIntent: "test",
      });

      scheduler = new ConsolidationScheduler(pipeline);

      const stats = await scheduler.runNow();

      expect(stats).toBeDefined();
      expect(stats.memoriesProcessed).toBe(1);
    });

    it("should call completion callback after manual run", async () => {
      const callback = vi.fn();
      scheduler = new ConsolidationScheduler(pipeline, {}, callback);

      await scheduler.runNow();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          memoriesProcessed: expect.any(Number),
          duration: expect.any(Number),
        }),
        null
      );
    });

    it("should pass error to callback on failure", async () => {
      const callback = vi.fn();
      const brokenPipeline = {
        consolidate: vi.fn().mockRejectedValue(new Error("Test error")),
      } as unknown as ConsolidationPipeline;

      scheduler = new ConsolidationScheduler(brokenPipeline, {}, callback);

      await expect(scheduler.runNow()).rejects.toThrow("Test error");
      expect(callback).toHaveBeenCalledWith(null, expect.any(Error));
    });
  });

  describe("Status Reporting", () => {
    it("should report scheduler status", () => {
      scheduler = new ConsolidationScheduler(pipeline);

      const status = scheduler.getStatus();

      expect(status).toMatchObject({
        isRunning: false,
        scheduleHour: 3,
        scheduleMinute: 0,
        lastRunTime: null,
        lastRunStats: null,
        nextRunTime: expect.any(Date),
      });
    });

    it("should update status after successful run", async () => {
      scheduler = new ConsolidationScheduler(pipeline);

      await scheduler.runNow();

      const status = scheduler.getStatus();
      expect(status.lastRunTime).toBeInstanceOf(Date);
      expect(status.lastRunStats).not.toBeNull();
    });

    it("should track run count", async () => {
      scheduler = new ConsolidationScheduler(pipeline);

      expect(scheduler.getStatus().runCount).toBe(0);

      await scheduler.runNow();
      expect(scheduler.getStatus().runCount).toBe(1);

      await scheduler.runNow();
      expect(scheduler.getStatus().runCount).toBe(2);
    });
  });

  describe("Error Handling", () => {
    it("should handle consolidation errors gracefully", async () => {
      const brokenPipeline = {
        consolidate: vi.fn().mockRejectedValue(new Error("Database error")),
      } as unknown as ConsolidationPipeline;

      scheduler = new ConsolidationScheduler(brokenPipeline);

      await expect(scheduler.runNow()).rejects.toThrow("Database error");

      // Scheduler should still be usable after error
      expect(scheduler.getStatus().isRunning).toBe(false);
    });

    it("should log errors without stopping scheduler", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const brokenPipeline = {
        consolidate: vi.fn().mockRejectedValue(new Error("Transient error")),
      } as unknown as ConsolidationPipeline;

      scheduler = new ConsolidationScheduler(brokenPipeline);
      scheduler.start();

      // Trigger an error (simulating scheduled run)
      try {
        await scheduler.runNow();
      } catch {
        // Expected
      }

      // Scheduler should still be running
      expect(scheduler.getStatus().isRunning).toBe(true);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Factory Function", () => {
    it("should create scheduler using factory function", () => {
      scheduler = createScheduler(pipeline);

      expect(scheduler).toBeInstanceOf(ConsolidationScheduler);
    });

    it("should create scheduler with config using factory", () => {
      scheduler = createScheduler(pipeline, { scheduleHour: 5 });

      expect(scheduler.getStatus().scheduleHour).toBe(5);
    });
  });
});
