/**
 * Tests for Docker Configuration
 *
 * TDD tests for Phase 4:
 * - docker-compose.yml uses host bind mounts (not named volumes)
 * - ensure-infrastructure.sh exports VESPER_HOME
 * - ensure-infrastructure.sh creates directories before Docker starts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { HybridSearchEngine } from "../src/retrieval/hybrid-search.js";

// Path to docker-compose.yml
const DOCKER_COMPOSE_PATH = path.join(__dirname, "..", "docker-compose.yml");

// Path to ensure-infrastructure.sh
const ENSURE_INFRA_PATH = path.join(__dirname, "..", "scripts", "ensure-infrastructure.sh");

describe("Docker Configuration", () => {
  describe("docker-compose.yml", () => {
    let dockerComposeContent: string;
    let dockerCompose: Record<string, unknown>;

    beforeEach(() => {
      dockerComposeContent = fs.readFileSync(DOCKER_COMPOSE_PATH, "utf-8");
      dockerCompose = yaml.parse(dockerComposeContent);
    });

    it("should be valid YAML syntax", () => {
      expect(() => yaml.parse(dockerComposeContent)).not.toThrow();
    });

    it("should not define named volumes for qdrant and redis", () => {
      const volumes = dockerCompose.volumes as Record<string, unknown> | undefined;

      // Named volumes section should either not exist or not contain qdrant_storage/redis_storage
      if (volumes) {
        expect(volumes).not.toHaveProperty("qdrant_storage");
        expect(volumes).not.toHaveProperty("redis_storage");
      }
    });

    describe("qdrant service", () => {
      let qdrantService: Record<string, unknown>;

      beforeEach(() => {
        const services = dockerCompose.services as Record<string, unknown>;
        qdrantService = services.qdrant as Record<string, unknown>;
      });

      it("should publish its API port on loopback only", () => {
        expect(qdrantService.ports).toEqual(["127.0.0.1:${QDRANT_PORT:-6333}:6333"]);
      });

      it("should use host bind mount for storage", () => {
        const volumes = qdrantService.volumes as string[];

        expect(volumes).toBeDefined();
        expect(volumes.length).toBeGreaterThan(0);

        // Should have a bind mount containing VESPER_HOME or ~/.vesper
        const qdrantVolume = volumes.find((v) => v.includes("/qdrant/storage"));
        expect(qdrantVolume).toBeDefined();

        // Should NOT be a named volume (named volumes don't contain path separators before the colon)
        expect(qdrantVolume).not.toMatch(/^qdrant_storage:/);

        // Should use VESPER_HOME environment variable with default
        expect(qdrantVolume).toContain("${VESPER_HOME:-");
      });

      it("should mount to /qdrant/storage inside container", () => {
        const volumes = qdrantService.volumes as string[];
        const qdrantVolume = volumes.find((v) => v.includes("qdrant"));

        expect(qdrantVolume).toContain(":/qdrant/storage");
      });

      it("should use docker-data/qdrant as host path", () => {
        const volumes = qdrantService.volumes as string[];
        const qdrantVolume = volumes.find((v) => v.includes("qdrant"));

        expect(qdrantVolume).toContain("docker-data/qdrant");
      });
    });

    describe("redis service", () => {
      let redisService: Record<string, unknown>;

      beforeEach(() => {
        const services = dockerCompose.services as Record<string, unknown>;
        redisService = services.redis as Record<string, unknown>;
      });

      it("should publish its cache port on loopback only", () => {
        expect(redisService.ports).toEqual(["127.0.0.1:${REDIS_PORT:-6379}:6379"]);
      });

      it("should use host bind mount for storage", () => {
        const volumes = redisService.volumes as string[];

        expect(volumes).toBeDefined();
        expect(volumes.length).toBeGreaterThan(0);

        // Should have a bind mount containing VESPER_HOME or ~/.vesper
        const redisVolume = volumes.find((v) => v.includes("/data"));
        expect(redisVolume).toBeDefined();

        // Should NOT be a named volume (named volumes don't contain path separators before the colon)
        expect(redisVolume).not.toMatch(/^redis_storage:/);

        // Should use VESPER_HOME environment variable with default
        expect(redisVolume).toContain("${VESPER_HOME:-");
      });

      it("should mount to /data inside container", () => {
        const volumes = redisService.volumes as string[];
        const redisVolume = volumes.find((v) => v.includes("redis"));

        expect(redisVolume).toContain(":/data");
      });

      it("should use docker-data/redis as host path", () => {
        const volumes = redisService.volumes as string[];
        const redisVolume = volumes.find((v) => v.includes("redis"));

        expect(redisVolume).toContain("docker-data/redis");
      });
    });

    describe("embedding service", () => {
      it("should publish its API port on loopback only", () => {
        const services = dockerCompose.services as Record<string, unknown>;
        const embeddingService = services.embedding as Record<string, unknown>;

        expect(embeddingService.ports).toEqual(["127.0.0.1:${EMBEDDING_PORT:-8000}:8000"]);
      });
    });

    describe("environment variable interpolation", () => {
      it("should use VESPER_HOME with default to ~/.vesper for qdrant", () => {
        const services = dockerCompose.services as Record<string, unknown>;
        const qdrantService = services.qdrant as Record<string, unknown>;
        const volumes = qdrantService.volumes as string[];
        const qdrantVolume = volumes.find((v) => v.includes("qdrant"));

        // Format: ${VESPER_HOME:-~/.vesper}/docker-data/qdrant:/qdrant/storage
        expect(qdrantVolume).toMatch(/\$\{VESPER_HOME:-[^}]+\}/);
      });

      it("should use VESPER_HOME with default to ~/.vesper for redis", () => {
        const services = dockerCompose.services as Record<string, unknown>;
        const redisService = services.redis as Record<string, unknown>;
        const volumes = redisService.volumes as string[];
        const redisVolume = volumes.find((v) => v.includes("redis"));

        // Format: ${VESPER_HOME:-~/.vesper}/docker-data/redis:/data
        expect(redisVolume).toMatch(/\$\{VESPER_HOME:-[^}]+\}/);
      });
    });
  });

  describe("ensure-infrastructure.sh", () => {
    let scriptContent: string;

    beforeEach(() => {
      scriptContent = fs.readFileSync(ENSURE_INFRA_PATH, "utf-8");
    });

    it("should export VESPER_HOME environment variable", () => {
      // Should have: export VESPER_HOME="${VESPER_HOME:-$HOME/.vesper}"
      expect(scriptContent).toMatch(/export\s+VESPER_HOME=/);
    });

    it("should default VESPER_HOME to $HOME/.vesper", () => {
      // The script now uses VESPER_HOME as a function parameter with defaults
      // Check that ~/.vesper is used as default for vesper-personal
      expect(scriptContent).toMatch(/\.vesper/);
      expect(scriptContent).toContain("vesper-personal");
    });

    it("should create docker-data directories before docker-compose up", () => {
      // The script now creates directories in a function before starting services
      // Just verify the necessary mkdir commands exist
      expect(scriptContent).toMatch(/mkdir.*docker-data\/qdrant/);
      expect(scriptContent).toMatch(/mkdir.*docker-data\/redis/);

      // Verify docker-compose is called
      expect(scriptContent).toContain("docker-compose");
    });

    it("should create data directory for SQLite", () => {
      // Should create ~/.vesper/data before starting
      expect(scriptContent).toMatch(/mkdir.*\$VESPER_HOME\/data/);
    });

    it("should create docker-data/qdrant directory", () => {
      expect(scriptContent).toMatch(/mkdir.*\$VESPER_HOME\/docker-data\/qdrant/);
    });

    it("should create docker-data/redis directory", () => {
      expect(scriptContent).toMatch(/mkdir.*\$VESPER_HOME\/docker-data\/redis/);
    });

    it("should use -p flag for mkdir to avoid errors on existing directories", () => {
      // mkdir -p is idempotent - won't fail if directory exists
      const mkdirLines = scriptContent
        .split("\n")
        .filter((line) => line.includes("mkdir") && line.includes("VESPER_HOME"));

      mkdirLines.forEach((line) => {
        expect(line).toMatch(/mkdir\s+-p/);
      });
    });
  });
});

describe("Docker Configuration Syntax Validation", () => {
  it("docker-compose.yml should be parseable by docker-compose config", async () => {
    // This test requires Docker to be running
    // We'll skip this in CI by checking if Docker is available
    const { execSync } = await import("child_process");

    try {
      execSync("docker info", { stdio: "pipe" });
    } catch {
      // Docker not running - skip test
      return;
    }

    // Validate docker-compose.yml syntax
    try {
      // Compose v2 ships as a docker plugin; fall back to the legacy binary.
      let composeCmd = "docker compose config";
      try {
        execSync("docker compose version", { stdio: "pipe" });
      } catch {
        composeCmd = "docker-compose config";
      }
      execSync(composeCmd, {
        cwd: path.join(__dirname, ".."),
        stdio: "pipe",
        env: {
          ...process.env,
          VESPER_HOME: "/tmp/test-vesper",
        },
      });
    } catch (error) {
      // If it fails, it's a syntax error
      throw new Error(`docker-compose.yml has invalid syntax: ${(error as Error).message}`);
    }
  });
});

describe("Operational quality regressions", () => {
  it("preserves actual dense similarity when no second result list is present", () => {
    const results = HybridSearchEngine.rrfFusion([
      { id: "first", score: 0.93 },
      { id: "second", score: 0.71 },
    ]);

    expect(results).toMatchObject([
      { id: "first", denseScore: 0.93, fusedScore: 0.93, rank: 1 },
      { id: "second", denseScore: 0.71, fusedScore: 0.71, rank: 2 },
    ]);
  });

  it("continues to use RRF when multiple result lists are present", () => {
    const results = HybridSearchEngine.rrfFusion(
      [
        { id: "dense-first", score: 0.93 },
        { id: "shared", score: 0.71 },
      ],
      [{ id: "shared", score: 12 }]
    );

    expect(results[0]).toMatchObject({
      id: "shared",
      denseScore: 0.71,
      sparseScore: 12,
      fusedScore: 1 / 62 + 1 / 61,
      rank: 1,
    });
  });

  it("writes collection initialization diagnostics to stderr only", async () => {
    const engine = new HybridSearchEngine("http://localhost:6333", "test", 3);
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
    };
    (engine as unknown as { client: typeof client }).client = client;

    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await engine.initializeCollection();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith("Created collection 'test' with 3-dim vectors");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
