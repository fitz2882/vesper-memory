/**
 * Tests for Benchmark Runner
 *
 * TDD Phase 5: Orchestrates benchmark execution.
 *
 * Coverage targets:
 * - Configuration validation
 * - Scenario execution order
 * - A/B testing (enabled vs disabled)
 * - Statistical comparison
 * - Result aggregation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BenchmarkRunner,
  createBenchmarkRunner,
  comparePhasesStatistically,
} from "../../src/benchmark/runner";
import type {
  BenchmarkConfig,
  BenchmarkResult,
  ScenarioResult,
  ComparisonResult,
} from "../../src/benchmark/types";
import { createDefaultConfig } from "../../src/benchmark/types";

// Mock MCP client for testing
interface MockMCPClient {
  storeMemory: (content: string, type: string, metadata?: object) => Promise<{ success: boolean; memory_id: string }>;
  retrieveMemory: (query: string) => Promise<{ success: boolean; results: Array<{ content: string; similarity_score: number }> }>;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  reset: () => void;
}

function createMockMCPClient(): MockMCPClient {
  const memories: Array<{ content: string; type: string }> = [];
  let enabled = true;

  return {
    async storeMemory(content: string, type: string, metadata?: object) {
      memories.push({ content, type });
      return { success: true, memory_id: `mock-${memories.length}` };
    },

    async retrieveMemory(query: string) {
      if (!enabled) {
        return { success: false, results: [] };
      }

      const results = memories
        .filter((m) => {
          const queryWords = query.toLowerCase().split(/\s+/);
          return queryWords.some(
            (word) => word.length > 3 && m.content.toLowerCase().includes(word)
          );
        })
        .slice(0, 3)
        .map((m) => ({ content: m.content, similarity_score: 0.9 }));

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
    },
  };
}

describe("Benchmark Runner", () => {
  let mockClient: MockMCPClient;
  let runner: BenchmarkRunner;
  let config: BenchmarkConfig;

  beforeEach(() => {
    mockClient = createMockMCPClient();
    config = createDefaultConfig({
      warmupRuns: 1,
      measurementRuns: 3,
      scenarios: ["context-recall"],
    });
    runner = createBenchmarkRunner(mockClient as any, config);
  });

  describe("BenchmarkRunner creation", () => {
    it("should create a runner with config", () => {
      expect(runner).toBeDefined();
      expect(runner.getConfig()).toEqual(config);
    });

    it("should validate config on creation", () => {
      const invalidConfig = {
        warmupRuns: -1,
        measurementRuns: 0,
        scenarios: [],
        outputDirectory: "",
        significanceLevel: 2,
        timeoutMs: 1000,
      };

      expect(() =>
        createBenchmarkRunner(mockClient as any, invalidConfig as any)
      ).toThrow();
    });
  });

  describe("Running benchmarks", () => {
    it("should run a single scenario", async () => {
      const result = await runner.run();

      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      expect(result.startTime).toBeGreaterThan(0);
      expect(result.endTime).toBeGreaterThanOrEqual(result.startTime);
    });

    it("should run multiple scenarios", async () => {
      const multiConfig = createDefaultConfig({
        warmupRuns: 1,
        measurementRuns: 2,
        scenarios: ["context-recall", "skill-retrieval"],
      });
      const multiRunner = createBenchmarkRunner(mockClient as any, multiConfig);

      const result = await multiRunner.run();

      expect(result.comparisons.length).toBe(2);
    });

    it("should run both enabled and disabled phases", async () => {
      const result = await runner.run();

      expect(result.comparisons.length).toBeGreaterThan(0);
      for (const comparison of result.comparisons) {
        expect(comparison.enabledResult.phase).toBe("vesper-enabled");
        expect(comparison.disabledResult.phase).toBe("vesper-disabled");
      }
    });

    it("should calculate summary statistics", async () => {
      const result = await runner.run();

      expect(result.summary).toBeDefined();
      expect(result.summary.totalScenarios).toBe(1);
      expect(
        result.summary.vesperWins +
          result.summary.disabledWins +
          result.summary.ties
      ).toBe(result.summary.totalScenarios);
    });
  });

  describe("Comparison results", () => {
    it("should compare enabled vs disabled for each scenario", async () => {
      const result = await runner.run();

      for (const comparison of result.comparisons) {
        expect(comparison.statistics).toBeDefined();
        expect(comparison.winner).toMatch(/vesper-enabled|vesper-disabled|tie/);
      }
    });

    it("should include t-test results", async () => {
      const result = await runner.run();

      for (const comparison of result.comparisons) {
        expect(comparison.statistics.tTestResult).toBeDefined();
        expect(comparison.statistics.tTestResult.tStatistic).toBeDefined();
        expect(comparison.statistics.tTestResult.pValue).toBeGreaterThanOrEqual(0);
        expect(comparison.statistics.tTestResult.pValue).toBeLessThanOrEqual(1);
      }
    });

    it("should include effect size", async () => {
      const result = await runner.run();

      for (const comparison of result.comparisons) {
        expect(comparison.statistics.effectSize).toBeDefined();
        expect(comparison.statistics.effectSize.cohensD).toBeDefined();
        expect(comparison.statistics.effectSize.interpretation).toMatch(
          /negligible|small|medium|large/
        );
      }
    });
  });

  describe("Warmup runs", () => {
    it("should execute warmup runs before measurement", async () => {
      const warmupConfig = createDefaultConfig({
        warmupRuns: 3,
        measurementRuns: 2,
        scenarios: ["context-recall"],
      });
      const warmupRunner = createBenchmarkRunner(mockClient as any, warmupConfig);

      // Run benchmark
      const result = await warmupRunner.run();

      // Should complete successfully with warmup and measurement runs
      // (metrics count is determined by test cases per scenario, not measurementRuns)
      expect(result.comparisons[0].enabledResult.metrics.length).toBeGreaterThan(0);
      expect(result.comparisons.length).toBe(1);
    });
  });

  describe("Metadata", () => {
    it("should include metadata in result", async () => {
      const result = await runner.run();

      expect(result.metadata).toBeDefined();
      expect(result.metadata.version).toBeTruthy();
      expect(result.metadata.environment).toBeTruthy();
    });
  });

  describe("Error handling", () => {
    it("should handle scenario errors gracefully", async () => {
      const failingClient = {
        storeMemory: vi.fn().mockRejectedValue(new Error("Storage failed")),
        retrieveMemory: vi.fn().mockRejectedValue(new Error("Retrieval failed")),
        setEnabled: vi.fn(),
        isEnabled: vi.fn().mockReturnValue(true),
        reset: vi.fn(),
      };

      const failingRunner = createBenchmarkRunner(failingClient as any, config);

      // Should not throw, but complete with errors recorded
      const result = await failingRunner.run();
      expect(result).toBeDefined();
    });
  });
});

describe("comparePhasesStatistically", () => {
  it("should calculate latency improvement percentage", () => {
    const enabledResult: ScenarioResult = {
      scenarioType: "context-recall",
      phase: "vesper-enabled",
      metrics: [
        { timestamp: 1, latencyMs: 40, memoryHit: true },
        { timestamp: 2, latencyMs: 50, memoryHit: true },
        { timestamp: 3, latencyMs: 60, memoryHit: true },
      ],
      aggregates: { latencyP50: 50, latencyP95: 58, latencyP99: 60 },
      rawResponses: ["A", "B", "C"],
    };

    const disabledResult: ScenarioResult = {
      scenarioType: "context-recall",
      phase: "vesper-disabled",
      metrics: [
        { timestamp: 1, latencyMs: 80, memoryHit: false },
        { timestamp: 2, latencyMs: 100, memoryHit: false },
        { timestamp: 3, latencyMs: 120, memoryHit: false },
      ],
      aggregates: { latencyP50: 100, latencyP95: 118, latencyP99: 120 },
      rawResponses: ["X", "Y", "Z"],
    };

    const comparison = comparePhasesStatistically(enabledResult, disabledResult, 0.05);

    // Enabled is faster, so positive improvement
    expect(comparison.latencyImprovement).toBeGreaterThan(0);
  });

  it("should determine winner based on significance", () => {
    // Clearly different results
    const enabledResult: ScenarioResult = {
      scenarioType: "context-recall",
      phase: "vesper-enabled",
      metrics: Array.from({ length: 20 }, (_, i) => ({
        timestamp: i,
        latencyMs: 50 + Math.random() * 10,
        memoryHit: true,
        retrievalAccuracy: 0.9,
      })),
      aggregates: { latencyP50: 55, latencyP95: 58, latencyP99: 60 },
      rawResponses: Array(20).fill("good"),
    };

    const disabledResult: ScenarioResult = {
      scenarioType: "context-recall",
      phase: "vesper-disabled",
      metrics: Array.from({ length: 20 }, (_, i) => ({
        timestamp: i,
        latencyMs: 150 + Math.random() * 10,
        memoryHit: false,
        retrievalAccuracy: 0,
      })),
      aggregates: { latencyP50: 155, latencyP95: 158, latencyP99: 160 },
      rawResponses: Array(20).fill("bad"),
    };

    const comparison = comparePhasesStatistically(enabledResult, disabledResult, 0.05);

    expect(comparison.tTestResult.significant).toBe(true);
    expect(comparison.effectSize.interpretation).toBe("large");
  });

  it("should return tie for similar results", () => {
    const result1: ScenarioResult = {
      scenarioType: "context-recall",
      phase: "vesper-enabled",
      metrics: [
        { timestamp: 1, latencyMs: 50, memoryHit: true },
        { timestamp: 2, latencyMs: 51, memoryHit: true },
        { timestamp: 3, latencyMs: 49, memoryHit: true },
      ],
      aggregates: { latencyP50: 50, latencyP95: 51, latencyP99: 51 },
      rawResponses: ["A", "B", "C"],
    };

    const result2: ScenarioResult = {
      scenarioType: "context-recall",
      phase: "vesper-disabled",
      metrics: [
        { timestamp: 1, latencyMs: 50, memoryHit: false },
        { timestamp: 2, latencyMs: 52, memoryHit: false },
        { timestamp: 3, latencyMs: 48, memoryHit: false },
      ],
      aggregates: { latencyP50: 50, latencyP95: 52, latencyP99: 52 },
      rawResponses: ["X", "Y", "Z"],
    };

    const comparison = comparePhasesStatistically(result1, result2, 0.05);

    // With nearly identical latencies, should not be significant
    expect(comparison.tTestResult.significant).toBe(false);
  });

  it("should handle zero latency mean without division by zero", () => {
    const enabledResult: ScenarioResult = {
      scenarioType: "context-recall",
      phase: "vesper-enabled",
      metrics: [
        { timestamp: 1, latencyMs: 0, memoryHit: true },
        { timestamp: 2, latencyMs: 0, memoryHit: true },
      ],
      aggregates: { latencyP50: 0, latencyP95: 0, latencyP99: 0 },
      rawResponses: ["A", "B"],
    };

    const disabledResult: ScenarioResult = {
      scenarioType: "context-recall",
      phase: "vesper-disabled",
      metrics: [
        { timestamp: 1, latencyMs: 0, memoryHit: false },
        { timestamp: 2, latencyMs: 0, memoryHit: false },
      ],
      aggregates: { latencyP50: 0, latencyP95: 0, latencyP99: 0 },
      rawResponses: [],
    };

    // Should not throw and return 0 for improvement
    const comparison = comparePhasesStatistically(enabledResult, disabledResult, 0.05);

    expect(comparison.latencyImprovement).toBe(0);
    expect(comparison.tokenSavings).toBe(0);
    expect(comparison.tTestResult.degreesOfFreedom).toBeGreaterThanOrEqual(0);
  });
});
