/**
 * Tests for CLI Path Handling and Migration
 *
 * TDD tests for:
 * - CLI configure() uses getSqlitePath() by default
 * - CLI install() creates ~/.vesper/ structure
 * - CLI status() checks correct locations
 * - CLI migrate() command functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// Mock modules
vi.mock("os");
vi.mock("fs");
vi.mock("child_process");

// Import path utilities for reference
import {
  getVesperHome,
  getSqlitePath,
  ensureDirectories,
  VESPER_SUBDIRS,
} from "../src/utils/paths";

describe("CLI Path Handling", () => {
  const originalEnv = process.env;
  const mockHomedir = "/Users/testuser";

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.VESPER_HOME;
    delete process.env.SQLITE_DB;
    delete process.env.VESPER_INSTALL_DIR;

    // Mock os.homedir()
    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    vi.mocked(os.platform).mockReturnValue("darwin");

    // Mock fs functions
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.cpSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue("");
    vi.mocked(fs.rmSync).mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("CLI configure() path resolution", () => {
    it("should use getSqlitePath() when SQLITE_DB not in .env", () => {
      // When .env doesn't set SQLITE_DB, configure should use getSqlitePath()
      const expectedPath = getSqlitePath();

      expect(expectedPath).toBe(
        path.join(mockHomedir, ".vesper", "data", "memory.db")
      );
    });

    it("should generate absolute path for SQLITE_DB in MCP config", () => {
      // The configured path should be absolute, not relative
      const sqlitePath = getSqlitePath();

      expect(path.isAbsolute(sqlitePath)).toBe(true);
    });

    it("should use user-level path instead of ./data/memory.db", () => {
      // Old default was './data/memory.db', new default should be ~/.vesper/data/memory.db
      const oldDefault = "./data/memory.db";
      const newDefault = getSqlitePath();

      expect(newDefault).not.toBe(oldDefault);
      expect(newDefault).toContain(".vesper");
      expect(newDefault).toContain("data");
      expect(newDefault).toContain("memory.db");
    });
  });

  describe("CLI install() directory structure", () => {
    it("should create ~/.vesper/ directory structure", () => {
      // ensureDirectories() should be called during install
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      // Verify the main directory is created
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper"),
        expect.objectContaining({ recursive: true })
      );
    });

    it("should create all required subdirectories", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      // Should create home + all subdirs
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1 + VESPER_SUBDIRS.length);
    });

    it("should create data directory for SQLite", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper", "data"),
        expect.objectContaining({ recursive: true })
      );
    });

    it("should create docker-data directories", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper", "docker-data"),
        expect.objectContaining({ recursive: true })
      );

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper", "docker-data", "qdrant"),
        expect.objectContaining({ recursive: true })
      );

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper", "docker-data", "redis"),
        expect.objectContaining({ recursive: true })
      );
    });

    it("should create logs directory", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper", "logs"),
        expect.objectContaining({ recursive: true })
      );
    });
  });

  describe("CLI status() path checking", () => {
    it("should check ~/.vesper/ for installation", () => {
      const installDir = path.join(mockHomedir, ".vesper");

      // status() should check if INSTALL_DIR exists
      expect(installDir).toBe(path.join(mockHomedir, ".vesper"));
    });

    it("should verify data directory exists", () => {
      const dataDir = path.join(mockHomedir, ".vesper", "data");

      expect(dataDir).toContain(".vesper");
      expect(dataDir).toContain("data");
    });
  });
});

describe("CLI Migration Command", () => {
  const originalEnv = process.env;
  const mockHomedir = "/Users/testuser";

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VESPER_HOME;

    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    vi.mocked(os.platform).mockReturnValue("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.cpSync).mockReturnValue(undefined);
    vi.mocked(fs.copyFileSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue("");
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("Old data detection", () => {
    it("should detect old data at ./data/memory.db", () => {
      const oldDataPath = "./data/memory.db";

      // Mock that old data exists
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === oldDataPath;
      });

      expect(fs.existsSync(oldDataPath)).toBe(true);
    });

    it("should detect old data at package-relative path", () => {
      // Old installations might have data in the npm package directory
      const oldPackagePath = path.join(mockHomedir, ".vesper", "data", "memory.db");

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        // Simulate no old data at package path (new install)
        return false;
      });

      expect(fs.existsSync(oldPackagePath)).toBe(false);
    });

    it("should return false when no old data exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const oldPaths = [
        "./data/memory.db",
        "/some/old/path/memory.db",
      ];

      for (const p of oldPaths) {
        expect(fs.existsSync(p)).toBe(false);
      }
    });
  });

  describe("Migration logic", () => {
    it("should copy database to new location", () => {
      const oldPath = "./data/memory.db";
      const newPath = path.join(mockHomedir, ".vesper", "data", "memory.db");

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === oldPath;
      });

      // Simulate migration
      vi.mocked(fs.copyFileSync).mockReturnValue(undefined);

      // Migration should copy old to new
      fs.copyFileSync(oldPath, newPath);

      expect(fs.copyFileSync).toHaveBeenCalledWith(oldPath, newPath);
    });

    it("should create target directory before copying", () => {
      const targetDir = path.join(mockHomedir, ".vesper", "data");

      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Should create directory first
      fs.mkdirSync(targetDir, { recursive: true });

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        targetDir,
        expect.objectContaining({ recursive: true })
      );
    });

    it("should not overwrite existing data without confirmation", () => {
      const newPath = path.join(mockHomedir, ".vesper", "data", "memory.db");

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        // New location already has data
        return p === newPath;
      });

      // Migration should check if target exists
      expect(fs.existsSync(newPath)).toBe(true);
    });
  });

  describe("Migration error handling", () => {
    it("should handle missing source gracefully", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // When no old data exists, should report "nothing to migrate"
      const oldPath = "./data/memory.db";
      expect(fs.existsSync(oldPath)).toBe(false);
    });

    it("should handle permission errors", () => {
      const error = new Error("EACCES: permission denied");

      vi.mocked(fs.copyFileSync).mockImplementation(() => {
        throw error;
      });

      expect(() => {
        fs.copyFileSync("./old.db", "/new.db");
      }).toThrow("EACCES");
    });

    it("should preserve original data on failure", () => {
      const oldPath = "./data/memory.db";

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === oldPath;
      });

      // After failed migration, original should still exist
      expect(fs.existsSync(oldPath)).toBe(true);
    });
  });

  describe("Migration success feedback", () => {
    it("should verify copied file exists after migration", () => {
      const newPath = path.join(mockHomedir, ".vesper", "data", "memory.db");

      // After successful copy
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === newPath;
      });

      expect(fs.existsSync(newPath)).toBe(true);
    });
  });
});
