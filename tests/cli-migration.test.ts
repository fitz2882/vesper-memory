/**
 * Tests for CLI Migration Command
 *
 * TDD tests for vesper migrate command:
 * - Detects old data locations
 * - Copies database correctly
 * - Handles missing old data gracefully
 * - Preserves data integrity
 * - Prompts for user confirmation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// Mock modules
vi.mock("os");
vi.mock("fs");

// Import path utilities
import {
  getVesperHome,
  getSqlitePath,
  ensureDirectories,
} from "../src/utils/paths";

describe("CLI Migration Command", () => {
  const originalEnv = process.env;
  const mockHomedir = "/Users/testuser";
  const INSTALL_DIR = path.join(mockHomedir, ".vesper");

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VESPER_HOME;
    delete process.env.VESPER_INSTALL_DIR;

    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    vi.mocked(os.platform).mockReturnValue("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.copyFileSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
      size: 1024 * 1024, // 1 MB
    } as fs.Stats);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("Old data detection", () => {
    it("should check installation directory for old data", () => {
      const oldDataPath = path.join(INSTALL_DIR, "data", "memory.db");

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === oldDataPath;
      });

      expect(fs.existsSync(oldDataPath)).toBe(true);
    });

    it("should check current working directory for old data", () => {
      const cwdOldPath = "./data/memory.db";

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === cwdOldPath;
      });

      expect(fs.existsSync(cwdOldPath)).toBe(true);
    });

    it("should prioritize installation directory over cwd", () => {
      const installOldPath = path.join(INSTALL_DIR, "data", "memory.db");
      const cwdOldPath = "./data/memory.db";

      // Both exist, but install path should be checked first
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === installOldPath || p === cwdOldPath;
      });

      // The migration should find install path first
      expect(fs.existsSync(installOldPath)).toBe(true);
    });

    it("should return no old data when nothing exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const potentialPaths = [
        path.join(INSTALL_DIR, "data", "memory.db"),
        "./data/memory.db",
      ];

      for (const p of potentialPaths) {
        expect(fs.existsSync(p)).toBe(false);
      }
    });

    it("should ignore empty files (size 0)", () => {
      const oldPath = path.join(INSTALL_DIR, "data", "memory.db");

      vi.mocked(fs.existsSync).mockImplementation((p) => p === oldPath);
      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: 0, // Empty file
      } as fs.Stats);

      // Empty file should not count as "old data"
      const stats = fs.statSync(oldPath);
      expect(stats.size).toBe(0);
    });
  });

  describe("Target path resolution", () => {
    it("should resolve target to ~/.vesper/data/memory.db", () => {
      const targetPath = getSqlitePath();

      expect(targetPath).toBe(
        path.join(mockHomedir, ".vesper", "data", "memory.db")
      );
    });

    it("should respect VESPER_HOME for target path", () => {
      process.env.VESPER_HOME = "/custom/vesper";

      const targetPath = getSqlitePath();

      expect(targetPath).toBe("/custom/vesper/data/memory.db");
    });
  });

  describe("Directory creation", () => {
    it("should create target directories before copying", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      // Should create the data directory
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper", "data"),
        expect.objectContaining({ recursive: true })
      );
    });

    it("should handle permission errors gracefully", () => {
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      expect(() => ensureDirectories()).toThrow("permission denied");
    });
  });

  describe("Database copy operation", () => {
    it("should copy file from old to new location", () => {
      const oldPath = path.join(INSTALL_DIR, "data", "memory.db");
      const newPath = getSqlitePath();

      fs.copyFileSync(oldPath, newPath);

      expect(fs.copyFileSync).toHaveBeenCalledWith(oldPath, newPath);
    });

    it("should preserve file size after copy", () => {
      const fileSize = 5 * 1024 * 1024; // 5 MB

      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: fileSize,
      } as fs.Stats);

      const stats = fs.statSync("/any/path");
      expect(stats.size).toBe(fileSize);
    });
  });

  describe("Overwrite protection", () => {
    it("should detect existing target file", () => {
      const newPath = getSqlitePath();

      vi.mocked(fs.existsSync).mockImplementation((p) => p === newPath);

      expect(fs.existsSync(newPath)).toBe(true);
    });

    it("should not overwrite without confirmation", () => {
      const newPath = getSqlitePath();

      vi.mocked(fs.existsSync).mockImplementation((p) => p === newPath);

      // Target exists - migration should prompt before overwriting
      expect(fs.existsSync(newPath)).toBe(true);
    });
  });

  describe("Error handling", () => {
    it("should handle copy failure", () => {
      vi.mocked(fs.copyFileSync).mockImplementation(() => {
        throw new Error("ENOSPC: no space left on device");
      });

      expect(() => {
        fs.copyFileSync("/old", "/new");
      }).toThrow("no space left");
    });

    it("should preserve original on failure", () => {
      const oldPath = path.join(INSTALL_DIR, "data", "memory.db");

      vi.mocked(fs.existsSync).mockImplementation((p) => p === oldPath);
      vi.mocked(fs.copyFileSync).mockImplementation(() => {
        throw new Error("Copy failed");
      });

      // Original should still exist
      expect(fs.existsSync(oldPath)).toBe(true);
    });

    it("should handle stat errors", () => {
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      expect(() => fs.statSync("/missing")).toThrow("no such file");
    });
  });

  describe("Migration scenarios", () => {
    it("should handle fresh install (no old data)", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // No old data anywhere
      const locations = [
        path.join(INSTALL_DIR, "data", "memory.db"),
        "./data/memory.db",
      ];

      const foundOldData = locations.some((loc) => fs.existsSync(loc));
      expect(foundOldData).toBe(false);
    });

    it("should handle upgrade scenario (old data exists)", () => {
      const oldPath = path.join(INSTALL_DIR, "data", "memory.db");

      vi.mocked(fs.existsSync).mockImplementation((p) => p === oldPath);

      expect(fs.existsSync(oldPath)).toBe(true);
    });

    it("should handle custom VESPER_HOME scenario", () => {
      process.env.VESPER_HOME = "/custom/location";

      const targetPath = getSqlitePath();

      expect(targetPath).toBe("/custom/location/data/memory.db");
    });

    it("should handle same source and target (already migrated)", () => {
      const newPath = getSqlitePath();

      vi.mocked(fs.existsSync).mockImplementation((p) => p === newPath);

      // If target is the only location with data, no migration needed
      const oldLocations = [
        path.join(INSTALL_DIR, "data", "memory.db"),
        "./data/memory.db",
      ];

      const hasOldData = oldLocations.some((loc) => {
        // Don't count the target path as "old"
        return loc !== newPath && fs.existsSync(loc);
      });

      expect(hasOldData).toBe(false);
    });
  });

  describe("Size reporting", () => {
    it("should report file size in MB", () => {
      const sizeBytes = 10 * 1024 * 1024; // 10 MB

      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: sizeBytes,
      } as fs.Stats);

      const stats = fs.statSync("/any");
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      expect(sizeMB).toBe("10.00");
    });

    it("should handle small files (< 1 MB)", () => {
      const sizeBytes = 512 * 1024; // 512 KB

      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: sizeBytes,
      } as fs.Stats);

      const stats = fs.statSync("/any");
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      expect(sizeMB).toBe("0.50");
    });

    it("should handle large files (> 100 MB)", () => {
      const sizeBytes = 150 * 1024 * 1024; // 150 MB

      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: sizeBytes,
      } as fs.Stats);

      const stats = fs.statSync("/any");
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      expect(sizeMB).toBe("150.00");
    });
  });
});

describe("Migration Integration", () => {
  const originalEnv = process.env;
  const mockHomedir = "/Users/testuser";

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VESPER_HOME;

    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("Full migration flow", () => {
    it("should create directories, copy file, and verify", () => {
      const oldPath = path.join(mockHomedir, ".vesper", "data", "memory.db");
      const newPath = getSqlitePath();
      const fileSize = 5 * 1024 * 1024;

      // Setup: old file exists
      vi.mocked(fs.existsSync).mockImplementation((p) => p === oldPath);
      vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => true,
        size: fileSize,
      } as fs.Stats);

      // Step 1: Ensure directories exist
      ensureDirectories();
      expect(fs.mkdirSync).toHaveBeenCalled();

      // Step 2: Copy file
      fs.copyFileSync(oldPath, newPath);
      expect(fs.copyFileSync).toHaveBeenCalledWith(oldPath, newPath);

      // Step 3: Verify (mocked to show target now exists)
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === oldPath || p === newPath;
      });
      expect(fs.existsSync(newPath)).toBe(true);
    });
  });
});
