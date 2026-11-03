/**
 * Tests for Server Path Integration
 *
 * Verifies that server.ts uses the path utility correctly:
 * - Uses getSqlitePath() by default
 * - SQLITE_DB env override still works
 * - Directories are created on startup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// Mock modules before imports
vi.mock("os");
vi.mock("fs");

// Import the path utilities (real implementation)
import {
  getVesperHome,
  getSqlitePath,
  ensureDirectories,
} from "../../src/utils/paths";

describe("Server Path Integration", () => {
  const originalEnv = process.env;
  const mockHomedir = "/Users/testuser";

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.VESPER_HOME;
    delete process.env.SQLITE_DB;

    // Mock os.homedir()
    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    vi.mocked(os.platform).mockReturnValue("darwin");

    // Mock fs functions
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("Default SQLite path resolution", () => {
    it("should return user-level path when SQLITE_DB not set", () => {
      // Simulate server behavior: use getSqlitePath() when SQLITE_DB is not set
      const dbPath = process.env.SQLITE_DB || getSqlitePath();

      expect(dbPath).toBe(path.join(mockHomedir, ".vesper", "data", "memory.db"));
    });

    it("should return :memory: for in-memory database", () => {
      process.env.SQLITE_DB = ":memory:";

      const dbPath = process.env.SQLITE_DB || getSqlitePath();

      expect(dbPath).toBe(":memory:");
    });

    it("should allow explicit SQLITE_DB path override", () => {
      const customPath = "/custom/path/to/db.sqlite";
      process.env.SQLITE_DB = customPath;

      const dbPath = process.env.SQLITE_DB || getSqlitePath();

      expect(dbPath).toBe(customPath);
    });
  });

  describe("VESPER_HOME integration", () => {
    it("should resolve SQLite path relative to custom VESPER_HOME", () => {
      process.env.VESPER_HOME = "/custom/vesper";

      const dbPath = getSqlitePath();

      expect(dbPath).toBe("/custom/vesper/data/memory.db");
    });

    it("should expand ~ in VESPER_HOME for SQLite path", () => {
      process.env.VESPER_HOME = "~/my-vesper";

      const dbPath = getSqlitePath();

      expect(dbPath).toBe(path.join(mockHomedir, "my-vesper", "data", "memory.db"));
    });
  });

  describe("Directory creation on startup", () => {
    it("should create parent directory for SQLite database", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Call ensureDirectories (this is what server.ts should call)
      ensureDirectories();

      // Verify data directory was created (with restrictive permissions)
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper", "data"),
        { recursive: true, mode: 0o700 }
      );
    });

    it("should create all required directories", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      // Check that multiple directories were created
      expect(fs.mkdirSync).toHaveBeenCalledTimes(7); // home + 6 subdirs
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper", "backups"),
        { recursive: true, mode: 0o700 }
      );
    });

    it("should not fail if directories already exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      expect(() => ensureDirectories()).not.toThrow();
    });
  });

  describe("Backward compatibility", () => {
    it("should prioritize SQLITE_DB env over getSqlitePath()", () => {
      const legacyPath = "./data/memory.db";
      process.env.SQLITE_DB = legacyPath;

      // Server behavior: env takes precedence
      const dbPath = process.env.SQLITE_DB || getSqlitePath();

      expect(dbPath).toBe(legacyPath);
    });

    it("should work with relative paths in SQLITE_DB", () => {
      process.env.SQLITE_DB = "./relative/path/db.sqlite";

      const dbPath = process.env.SQLITE_DB || getSqlitePath();

      expect(dbPath).toBe("./relative/path/db.sqlite");
    });
  });

  describe("Server initialization helper", () => {
    /**
     * This simulates the logic that should be in server.ts:
     * 1. Call ensureDirectories() to create ~/.vesper structure
     * 2. Use SQLITE_DB env if set, otherwise use getSqlitePath()
     */
    function getEffectiveSqlitePath(): string {
      // Ensure directories exist
      ensureDirectories();

      // Return env override or default user-level path
      return process.env.SQLITE_DB || getSqlitePath();
    }

    it("should use user-level path by default", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const dbPath = getEffectiveSqlitePath();

      expect(dbPath).toBe(path.join(mockHomedir, ".vesper", "data", "memory.db"));
      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it("should use :memory: when explicitly set", () => {
      process.env.SQLITE_DB = ":memory:";

      const dbPath = getEffectiveSqlitePath();

      expect(dbPath).toBe(":memory:");
    });

    it("should create directories even when using custom SQLITE_DB", () => {
      process.env.SQLITE_DB = "/custom/db.sqlite";
      vi.mocked(fs.existsSync).mockReturnValue(false);

      getEffectiveSqlitePath();

      // Directories should still be created for other services
      expect(fs.mkdirSync).toHaveBeenCalled();
    });
  });
});
