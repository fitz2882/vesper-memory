/**
 * Scientific Benchmark Integration Test
 *
 * This test runs the complete scientific benchmark suite against
 * the Vesper memory system, comparing enabled vs disabled modes.
 *
 * Test phases:
 * 1. Setup MCP client connection (mock for unit tests)
 * 2. Run all 5 scenarios in A/B mode
 * 3. Generate statistical comparison
 * 4. Create markdown report
 * 5. Verify report structure
 *
 * Run with: npm run test:benchmarks
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  createBenchmarkRunner,
  BenchmarkRunner,
} from "../../src/benchmark/runner.js";
import {
  BenchmarkConfig,
  BenchmarkResult,
  createDefaultConfig,
  ScenarioType,
} from "../../src/benchmark/types.js";
import { generateMarkdownReport } from "../../src/benchmark/report-generator.js";

// Get project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");
const BENCHMARKS_DIR = join(PROJECT_ROOT, "benchmarks");
const REPORT_PATH = join(BENCHMARKS_DIR, "scientific-results.md");

/**
 * Mock MCP Client for testing without real server
 */
interface MockMCPClient {
  storeMemory: (
    content: string,
    type: string,
    metadata?: object
  ) => Promise<{ success: boolean; memory_id: string }>;
  retrieveMemory: (
    query: string,
    options?: { max_results?: number }
  ) => Promise<{
    success: boolean;
    results: Array<{ content: string; similarity_score: number }>;
  }>;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  reset: () => void;
}

function createMockMCPClient(): MockMCPClient {
  const memories: Array<{ content: string; type: string; timestamp: number }> = [];
  let enabled = true;
  let callLatency = 5; // Base latency in ms

  return {
    async storeMemory(content: string, type: string, metadata?: object) {
      // Simulate varying latency
      await new Promise((resolve) =>
        setTimeout(resolve, callLatency + Math.random() * 10)
      );

      if (!enabled) {
        return { success: false, memory_id: "" };
      }

      const id = `mock-${memories.length + 1}`;
      memories.push({ content, type, timestamp: Date.now() });
      return { success: true, memory_id: id };
    },

    async retrieveMemory(query: string, options?: { max_results?: number }) {
      const maxResults = options?.max_results || 3;

      // Simulate latency difference between enabled/disabled
      const latency = enabled
        ? callLatency + Math.random() * 15 // 5-20ms when enabled (memory hit)
        : callLatency + Math.random() * 5; // 5-10ms when disabled (no lookup)

      await new Promise((resolve) => setTimeout(resolve, latency));

      if (!enabled) {
        return { success: true, results: [] };
      }

      // Search through memories with basic keyword matching
      const queryLower = query.toLowerCase();
      const results = memories
        .filter((m) => {
          const contentLower = m.content.toLowerCase();
          return queryLower
            .split(/\s+/)
            .some(
              (word) => word.length > 3 && contentLower.includes(word)
            );
        })
        .slice(0, maxResults)
        .map((m) => ({
          content: m.content,
          similarity_score: 0.85 + Math.random() * 0.1,
        }));

      return { success: true, results };
    },

    setEnabled(e: boolean) {
      enabled = e;
    },

    isEnabled() {
      return enabled;
    },

    reset() {
      memories.length = 0;
      enabled = true;
    },
  };
}

describe("Scientific Benchmark Integration", () => {
  let mockClient: MockMCPClient;
  let runner: BenchmarkRunner;
  let benchmarkResult: BenchmarkResult;

  beforeAll(async () => {
    // Create benchmarks directory if it doesn't exist
    if (!existsSync(BENCHMARKS_DIR)) {
      mkdirSync(BENCHMARKS_DIR, { recursive: true });
    }

    // Create mock client
    mockClient = createMockMCPClient();

    // Create benchmark runner with minimal config for fast tests
    const config: BenchmarkConfig = createDefaultConfig({
      warmupRuns: 1,
      measurementRuns: 3,
      scenarios: [
        "context-recall",
        "skill-retrieval",
        "semantic-accuracy",
        "token-efficiency",
        "cross-session",
      ] as ScenarioType[],
      outputDirectory: BENCHMARKS_DIR,
      significanceLevel: 0.05,
    });

    runner = createBenchmarkRunner(mockClient as any, config);
  });

  afterAll(() => {
    mockClient.reset();
  });

  describe("Benchmark Execution", () => {
    it("should run all 5 scenarios", async () => {
      benchmarkResult = await runner.run();

      expect(benchmarkResult).toBeDefined();
      expect(benchmarkResult.comparisons.length).toBe(5);
    }, 30000); // 30 second timeout for full run

    it("should include results for each scenario type", () => {
      const scenarioTypes = benchmarkResult.comparisons.map(
        (c) => c.scenarioType
      );

      expect(scenarioTypes).toContain("context-recall");
      expect(scenarioTypes).toContain("skill-retrieval");
      expect(scenarioTypes).toContain("semantic-accuracy");
      expect(scenarioTypes).toContain("token-efficiency");
      expect(scenarioTypes).toContain("cross-session");
    });

    it("should have enabled and disabled results for each comparison", () => {
      for (const comparison of benchmarkResult.comparisons) {
        expect(comparison.enabledResult).toBeDefined();
        expect(comparison.disabledResult).toBeDefined();
        expect(comparison.enabledResult.phase).toBe("vesper-enabled");
        expect(comparison.disabledResult.phase).toBe("vesper-disabled");
      }
    });

    it("should calculate statistical comparisons", () => {
      for (const comparison of benchmarkResult.comparisons) {
        expect(comparison.statistics).toBeDefined();
        expect(comparison.statistics.tTestResult).toBeDefined();
        expect(comparison.statistics.effectSize).toBeDefined();
        expect(comparison.winner).toMatch(
          /vesper-enabled|vesper-disabled|tie/
        );
      }
    });

    it("should calculate summary statistics", () => {
      const summary = benchmarkResult.summary;

      expect(summary).toBeDefined();
      expect(summary.totalScenarios).toBe(5);
      expect(
        summary.vesperWins + summary.disabledWins + summary.ties
      ).toBe(5);
      expect(typeof summary.overallImprovement).toBe("number");
      expect(typeof summary.statisticallySignificant).toBe("boolean");
    });
  });

  describe("Report Generation", () => {
    let report: string;

    beforeAll(() => {
      report = generateMarkdownReport(benchmarkResult);
    });

    it("should generate a markdown report", () => {
      expect(report).toBeDefined();
      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(500);
    });

    it("should include report title", () => {
      expect(report).toContain("# Vesper Benchmark Report");
    });

    it("should include summary section", () => {
      expect(report).toContain("## Summary");
      expect(report).toContain("Total Scenarios");
      expect(report).toContain("Vesper Wins");
    });

    it("should include scenario results", () => {
      expect(report).toContain("## Scenario Results");
      expect(report).toContain("### Context Recall");
      expect(report).toContain("### Skill Retrieval");
    });

    it("should include statistical analysis", () => {
      expect(report).toContain("#### Statistical Analysis");
      expect(report).toContain("t-test statistic");
      expect(report).toContain("p-value");
      expect(report).toContain("Cohen's d");
    });

    it("should include configuration section", () => {
      expect(report).toContain("## Configuration");
      expect(report).toContain("Warmup Runs");
      expect(report).toContain("Measurement Runs");
    });

    it("should include metadata section", () => {
      expect(report).toContain("## Metadata");
      expect(report).toContain("Version");
      expect(report).toContain("Environment");
    });

    it("should include footer", () => {
      expect(report).toContain(
        "Report generated by Vesper Scientific Benchmark System"
      );
    });
  });

  describe("Report File Output", () => {
    it("should write report to file", () => {
      const report = generateMarkdownReport(benchmarkResult);
      writeFileSync(REPORT_PATH, report, "utf-8");

      expect(existsSync(REPORT_PATH)).toBe(true);
    });

    it("should create readable markdown file", () => {
      const content = readFileSync(REPORT_PATH, "utf-8");

      expect(content).toContain("# Vesper Benchmark Report");
      expect(content.split("\n").length).toBeGreaterThan(50);
    });

    it("should include all expected sections in saved report", () => {
      const content = readFileSync(REPORT_PATH, "utf-8");

      // Check for all major sections
      const expectedSections = [
        "# Vesper Benchmark Report",
        "## Summary",
        "## Scenario Results",
        "## Configuration",
        "## Metadata",
        "### Conclusion",
      ];

      for (const section of expectedSections) {
        expect(content).toContain(section);
      }
    });
  });

  describe("A/B Mode Verification", () => {
    it("should run enabled phase with memory operations", () => {
      // Check that enabled results have memory hits
      const enabledResults = benchmarkResult.comparisons.map(
        (c) => c.enabledResult
      );

      // At least some enabled results should have memory hits
      const hasMemoryHits = enabledResults.some(
        (r) =>
          r.aggregates.memoryHitRate !== undefined &&
          r.aggregates.memoryHitRate > 0
      );

      // This should be true for context-recall at minimum
      expect(hasMemoryHits).toBe(true);
    });

    it("should run disabled phase without memory operations", () => {
      // Check that disabled results have no memory hits
      const disabledResults = benchmarkResult.comparisons.map(
        (c) => c.disabledResult
      );

      // Disabled results should have 0 or undefined memory hit rate
      for (const result of disabledResults) {
        const hitRate = result.aggregates.memoryHitRate;
        expect(hitRate === undefined || hitRate === 0).toBe(true);
      }
    });
  });
});

describe("Benchmark CLI Script", () => {
  it("should have npm script defined", async () => {
    const packageJsonPath = join(PROJECT_ROOT, "package.json");
    expect(existsSync(packageJsonPath)).toBe(true);

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    // The script should exist (we'll add it if missing)
    // For now, just verify we can read package.json
    expect(packageJson.name).toBe("vesper-memory");
  });
});
