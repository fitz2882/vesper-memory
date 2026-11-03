/**
 * Tests for Path Utility Module
 *
 * Verifies:
 * - User-level storage paths at ~/.vesper/
 * - Cross-platform path resolution
 * - Environment variable overrides
 * - Directory creation on first run
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// Mock modules before importing the paths module
vi.mock("os");
vi.mock("fs");

// Import after mocking
import {
  getVesperHome,
  getSqlitePath,
  getDockerDataDir,
  getQdrantDataDir,
  getRedisDataDir,
  ensureDirectories,
  VESPER_SUBDIRS,
} from "../../src/utils/paths";

describe("Path Utilities", () => {
  const originalEnv = process.env;
  const mockHomedir = "/Users/testuser";

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.VESPER_HOME;

    // Mock os.homedir() to return consistent path
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

  describe("getVesperHome()", () => {
    it("should return ~/.vesper by default (expanded)", () => {
      const result = getVesperHome();
      expect(result).toBe(path.join(mockHomedir, ".vesper"));
    });

    it("should respect VESPER_HOME environment variable override", () => {
      const customPath = "/custom/vesper/path";
      process.env.VESPER_HOME = customPath;

      const result = getVesperHome();
      expect(result).toBe(customPath);
    });

    it("should expand ~ in VESPER_HOME environment variable", () => {
      process.env.VESPER_HOME = "~/custom-vesper";

      const result = getVesperHome();
      expect(result).toBe(path.join(mockHomedir, "custom-vesper"));
    });

    it("should return absolute path", () => {
      const result = getVesperHome();
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe("getSqlitePath()", () => {
    it("should return ~/.vesper/data/memory.db by default", () => {
      const result = getSqlitePath();
      expect(result).toBe(path.join(mockHomedir, ".vesper", "data", "memory.db"));
    });

    it("should respect VESPER_HOME override", () => {
      process.env.VESPER_HOME = "/custom/path";

      const result = getSqlitePath();
      expect(result).toBe(path.join("/custom/path", "data", "memory.db"));
    });

    it("should return absolute path", () => {
      const result = getSqlitePath();
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe("getDockerDataDir()", () => {
    it("should return ~/.vesper/docker-data by default", () => {
      const result = getDockerDataDir();
      expect(result).toBe(path.join(mockHomedir, ".vesper", "docker-data"));
    });

    it("should respect VESPER_HOME override", () => {
      process.env.VESPER_HOME = "/custom/path";

      const result = getDockerDataDir();
      expect(result).toBe(path.join("/custom/path", "docker-data"));
    });
  });

  describe("getQdrantDataDir()", () => {
    it("should return ~/.vesper/docker-data/qdrant by default", () => {
      const result = getQdrantDataDir();
      expect(result).toBe(path.join(mockHomedir, ".vesper", "docker-data", "qdrant"));
    });
  });

  describe("getRedisDataDir()", () => {
    it("should return ~/.vesper/docker-data/redis by default", () => {
      const result = getRedisDataDir();
      expect(result).toBe(path.join(mockHomedir, ".vesper", "docker-data", "redis"));
    });
  });

  describe("Cross-platform behavior", () => {
    it("should work on macOS (darwin)", () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(os.homedir).mockReturnValue("/Users/testuser");

      const result = getVesperHome();
      expect(result).toBe("/Users/testuser/.vesper");
    });

    it("should work on Linux", () => {
      vi.mocked(os.platform).mockReturnValue("linux");
      vi.mocked(os.homedir).mockReturnValue("/home/testuser");

      const result = getVesperHome();
      expect(result).toBe("/home/testuser/.vesper");
    });

    it("should work on Windows", () => {
      vi.mocked(os.platform).mockReturnValue("win32");
      vi.mocked(os.homedir).mockReturnValue("C:\\Users\\testuser");

      const result = getVesperHome();
      // path.join handles cross-platform correctly
      expect(result).toBe(path.join("C:\\Users\\testuser", ".vesper"));
    });
  });

  describe("VESPER_SUBDIRS constant", () => {
    it("should contain data subdirectory", () => {
      expect(VESPER_SUBDIRS).toContain("data");
    });

    it("should contain docker-data subdirectory", () => {
      expect(VESPER_SUBDIRS).toContain("docker-data");
    });

    it("should contain docker-data/qdrant subdirectory", () => {
      expect(VESPER_SUBDIRS).toContain("docker-data/qdrant");
    });

    it("should contain docker-data/redis subdirectory", () => {
      expect(VESPER_SUBDIRS).toContain("docker-data/redis");
    });

    it("should contain logs subdirectory", () => {
      expect(VESPER_SUBDIRS).toContain("logs");
    });
  });

  describe("ensureDirectories()", () => {
    it("should create ~/.vesper if it does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(mockHomedir, ".vesper"),
        { recursive: true, mode: 0o700 }
      );
    });

    it("should create all subdirectories", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      // Should create each subdirectory
      for (const subdir of VESPER_SUBDIRS) {
        expect(fs.mkdirSync).toHaveBeenCalledWith(
          path.join(mockHomedir, ".vesper", subdir),
          { recursive: true, mode: 0o700 }
        );
      }
    });

    it("should not throw if directories already exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      expect(() => ensureDirectories()).not.toThrow();
    });

    it("should use VESPER_HOME override when creating directories", () => {
      process.env.VESPER_HOME = "/custom/vesper";
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureDirectories();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        "/custom/vesper",
        { recursive: true, mode: 0o700 }
      );
    });

    it("should return the vesper home path", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = ensureDirectories();

      expect(result).toBe(path.join(mockHomedir, ".vesper"));
    });
  });

  describe("Edge cases", () => {
    it("should handle empty VESPER_HOME (use default)", () => {
      process.env.VESPER_HOME = "";

      const result = getVesperHome();
      expect(result).toBe(path.join(mockHomedir, ".vesper"));
    });

    it("should handle whitespace-only VESPER_HOME (use default)", () => {
      process.env.VESPER_HOME = "   ";

      const result = getVesperHome();
      expect(result).toBe(path.join(mockHomedir, ".vesper"));
    });

    it("should normalize paths with trailing slashes", () => {
      process.env.VESPER_HOME = "/custom/path/";

      const result = getVesperHome();
      // path.normalize removes trailing slash
      expect(result).toBe("/custom/path");
    });

    it("should handle paths with double slashes", () => {
      process.env.VESPER_HOME = "/custom//path";

      const result = getVesperHome();
      expect(result).toBe("/custom/path");
    });
  });
});
