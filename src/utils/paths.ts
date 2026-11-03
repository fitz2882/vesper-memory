/**
 * Path Utility Module
 *
 * Provides cross-platform path resolution for Vesper's user-level storage.
 * All data is stored at ~/.vesper/ by default, with VESPER_HOME override.
 *
 * Directory Structure:
 *   ~/.vesper/
 *   ├── data/
 *   │   └── memory.db          # SQLite database
 *   ├── backups/               # Verified SQLite backups
 *   ├── docker-data/
 *   │   ├── qdrant/            # Qdrant vector storage
 *   │   └── redis/             # Redis data
 *   └── logs/                  # Application logs
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";

/**
 * Subdirectories to create under VESPER_HOME
 */
export const VESPER_SUBDIRS = [
  "data",
  "backups",
  "docker-data",
  "docker-data/qdrant",
  "docker-data/redis",
  "logs",
] as const;

/**
 * Expands ~ to home directory in a path
 *
 * @param inputPath - Path that may contain ~
 * @returns Expanded path with ~ replaced by home directory
 */
function expandTilde(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  return inputPath;
}

/**
 * Get the Vesper home directory
 *
 * Returns ~/.vesper by default, or VESPER_HOME environment variable if set.
 * Paths are normalized and made absolute.
 *
 * @returns Absolute path to Vesper home directory
 */
export function getVesperHome(): string {
  const envHome = process.env.VESPER_HOME;

  // Use environment variable if set and not empty/whitespace
  if (envHome && envHome.trim()) {
    let expanded = expandTilde(envHome.trim());
    // Normalize the path (handles double slashes, etc.)
    expanded = path.normalize(expanded);
    // Remove trailing slash (path.normalize doesn't do this on all platforms)
    if (expanded.length > 1 && expanded.endsWith(path.sep)) {
      expanded = expanded.slice(0, -1);
    }

    // SECURITY: Warn if path is a system directory
    const systemPaths = [
      "/etc",
      "/var",
      "/usr",
      "/bin",
      "/sbin",
      "/System",
      "/Library",
      "C:\\Windows",
      "C:\\Program Files",
    ];
    const isSystemPath = systemPaths.some(
      (sys) => expanded === sys || expanded.startsWith(sys + path.sep)
    );

    if (isSystemPath) {
      console.error(`[WARN] VESPER_HOME points to system directory: ${expanded}`);
      console.error("[WARN] This may cause permission issues or system instability");
    }

    // SECURITY: Warn if path is user's home directory root
    const home = os.homedir();
    if (expanded === home) {
      console.error(`[WARN] VESPER_HOME is set to home directory root: ${expanded}`);
      console.error("[WARN] Consider using ~/.vesper or a subdirectory");
    }

    return expanded;
  }

  // Default to ~/.vesper
  return path.join(os.homedir(), ".vesper");
}

/**
 * Get the SQLite database path
 *
 * Returns ~/.vesper/data/memory.db by default.
 *
 * @returns Absolute path to SQLite database file
 */
export function getSqlitePath(): string {
  return path.join(getVesperHome(), "data", "memory.db");
}

/**
 * Get the directory used for durable SQLite backups.
 *
 * Backups live outside the active data directory so callers can apply a
 * separate retention policy without risking the canonical database.
 */
export function getBackupsDir(): string {
  return path.join(getVesperHome(), "backups");
}

/**
 * Create the backup directory with owner-only permissions.
 */
export function ensureBackupsDirectory(): string {
  const backupsDir = getBackupsDir();
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(backupsDir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Backup destination is not a secure directory: ${backupsDir}`);
  }
  fs.chmodSync(backupsDir, 0o700);
  return backupsDir;
}

/**
 * Get the Docker data directory
 *
 * Returns ~/.vesper/docker-data by default.
 * Used for bind mounts in docker-compose.yml.
 *
 * @returns Absolute path to Docker data directory
 */
export function getDockerDataDir(): string {
  return path.join(getVesperHome(), "docker-data");
}

/**
 * Get the Qdrant data directory
 *
 * Returns ~/.vesper/docker-data/qdrant by default.
 *
 * @returns Absolute path to Qdrant data directory
 */
export function getQdrantDataDir(): string {
  return path.join(getDockerDataDir(), "qdrant");
}

/**
 * Get the Redis data directory
 *
 * Returns ~/.vesper/docker-data/redis by default.
 *
 * @returns Absolute path to Redis data directory
 */
export function getRedisDataDir(): string {
  return path.join(getDockerDataDir(), "redis");
}

/**
 * Ensure all Vesper directories exist
 *
 * Creates ~/.vesper and all subdirectories if they don't exist.
 * Safe to call multiple times (idempotent).
 *
 * @returns The Vesper home directory path
 * @throws Error if directory creation fails (e.g., permission denied)
 */
export function ensureDirectories(): string {
  const vesperHome = getVesperHome();

  try {
    // Create home directory with restrictive permissions (owner read/write/execute only)
    // This protects sensitive data on shared systems
    fs.mkdirSync(vesperHome, { recursive: true, mode: 0o700 });

    // Create all subdirectories with same restrictive permissions
    for (const subdir of VESPER_SUBDIRS) {
      const fullPath = path.join(vesperHome, subdir);
      fs.mkdirSync(fullPath, { recursive: true, mode: 0o700 });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to create Vesper directories at ${vesperHome}: ${errorMsg}. ` +
        `Check permissions or set VESPER_HOME to a writable location.`
    );
  }

  return vesperHome;
}
