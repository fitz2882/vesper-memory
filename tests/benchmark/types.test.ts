/**
 * Tests for Benchmark Type Definitions and Validation
 *
 * TDD Phase 2: Type definitions with runtime validation using Zod.
 *
 * Coverage targets:
 * - Type schema validation
 * - Default values
 * - Edge cases (invalid inputs, missing fields)
 * - Type inference correctness
 */

import { describe, it, expect } from "vitest";
import {
  BenchmarkConfigSchema,
  BenchmarkResultSchema,
  MetricsSnapshotSchema,
  ScenarioResultSchema,
  ComparisonResultSchema,
  validateBenchmarkConfig,
  validateBenchmarkResult,
  validateMetricsSnapshot,
  createDefaultConfig,
  BenchmarkConfig,
  BenchmarkResult,
  MetricsSnapshot,
  ScenarioResult,
  ComparisonResult,
  ScenarioType,
  BenchmarkPhase,
} from "../../src/benchmark/types";

describe("Types Module", () => {
  describe("BenchmarkConfig validation", () => {
    it("should validate a valid config", () => {
      const config: BenchmarkConfig = {
        warmupRuns: 3,
        measurementRuns: 10,
        timeoutMs: 30000,
        scenarios: ["context-recall", "skill-retrieval"],
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should reject invalid warmupRuns (negative)", () => {
      const config = {
        warmupRuns: -1,
        measurementRuns: 10,
        timeoutMs: 30000,
        scenarios: ["context-recall"],
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject invalid measurementRuns (too low)", () => {
      const config = {
        warmupRuns: 3,
        measurementRuns: 1, // Needs at least 2 for statistical significance
        timeoutMs: 30000,
        scenarios: ["context-recall"],
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject invalid significanceLevel (out of range)", () => {
      const config = {
        warmupRuns: 3,
        measurementRuns: 10,
        timeoutMs: 30000,
        scenarios: ["context-recall"],
        outputDirectory: "./benchmark-results",
        significanceLevel: 1.5, // Must be 0 < x < 1
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject empty scenarios array", () => {
      const config = {
        warmupRuns: 3,
        measurementRuns: 10,
        timeoutMs: 30000,
        scenarios: [],
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject invalid scenario names", () => {
      const config = {
        warmupRuns: 3,
        measurementRuns: 10,
        timeoutMs: 30000,
        scenarios: ["invalid-scenario-name"],
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject warmupRuns exceeding max bound (100)", () => {
      const config = {
        warmupRuns: 101,
        measurementRuns: 10,
        timeoutMs: 30000,
        scenarios: ["context-recall"],
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject measurementRuns exceeding max bound (1000)", () => {
      const config = {
        warmupRuns: 3,
        measurementRuns: 1001,
        timeoutMs: 30000,
        scenarios: ["context-recall"],
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject timeoutMs exceeding max bound (600000)", () => {
      const config = {
        warmupRuns: 3,
        measurementRuns: 10,
        timeoutMs: 600001,
        scenarios: ["context-recall"],
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should accept config at max bounds", () => {
      const config = {
        warmupRuns: 100,
        measurementRuns: 1000,
        timeoutMs: 600000,
        scenarios: ["context-recall"],
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should validate all valid scenario types", () => {
      const validScenarios: ScenarioType[] = [
        "context-recall",
        "cross-session",
        "skill-retrieval",
        "token-efficiency",
        "semantic-accuracy",
      ];

      const config = {
        warmupRuns: 3,
        measurementRuns: 10,
        timeoutMs: 30000,
        scenarios: validScenarios,
        outputDirectory: "./benchmark-results",
        significanceLevel: 0.05,
      };

      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("createDefaultConfig", () => {
    it("should create config with sensible defaults", () => {
      const config = createDefaultConfig();

      expect(config.warmupRuns).toBeGreaterThanOrEqual(0);
      expect(config.measurementRuns).toBeGreaterThanOrEqual(2);
      expect(config.timeoutMs).toBeGreaterThan(0);
      expect(config.scenarios.length).toBeGreaterThan(0);
      expect(config.significanceLevel).toBeGreaterThan(0);
      expect(config.significanceLevel).toBeLessThan(1);
    });

    it("should return valid config", () => {
      const config = createDefaultConfig();
      const result = BenchmarkConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should allow overriding defaults", () => {
      const config = createDefaultConfig({
        warmupRuns: 5,
        measurementRuns: 20,
      });

      expect(config.warmupRuns).toBe(5);
      expect(config.measurementRuns).toBe(20);
    });
  });

  describe("MetricsSnapshot validation", () => {
    it("should validate a valid metrics snapshot", () => {
      const snapshot: MetricsSnapshot = {
        timestamp: Date.now(),
        latencyMs: 45.5,
        tokensUsed: 150,
        retrievalAccuracy: 0.92,
        memoryHit: true,
        responseQuality: 0.85,
      };

      const result = MetricsSnapshotSchema.safeParse(snapshot);
      expect(result.success).toBe(true);
    });

    it("should reject negative latency", () => {
      const snapshot = {
        timestamp: Date.now(),
        latencyMs: -10,
        tokensUsed: 150,
        retrievalAccuracy: 0.92,
        memoryHit: true,
        responseQuality: 0.85,
      };

      const result = MetricsSnapshotSchema.safeParse(snapshot);
      expect(result.success).toBe(false);
    });

    it("should reject negative tokens", () => {
      const snapshot = {
        timestamp: Date.now(),
        latencyMs: 45.5,
        tokensUsed: -50,
        retrievalAccuracy: 0.92,
        memoryHit: true,
        responseQuality: 0.85,
      };

      const result = MetricsSnapshotSchema.safeParse(snapshot);
      expect(result.success).toBe(false);
    });

    it("should reject accuracy > 1", () => {
      const snapshot = {
        timestamp: Date.now(),
        latencyMs: 45.5,
        tokensUsed: 150,
        retrievalAccuracy: 1.5, // Invalid: must be 0-1
        memoryHit: true,
        responseQuality: 0.85,
      };

      const result = MetricsSnapshotSchema.safeParse(snapshot);
      expect(result.success).toBe(false);
    });

    it("should accept optional fields as undefined", () => {
      const snapshot = {
        timestamp: Date.now(),
        latencyMs: 45.5,
        memoryHit: false,
      };

      const result = MetricsSnapshotSchema.safeParse(snapshot);
      expect(result.success).toBe(true);
    });
  });

  describe("ScenarioResult validation", () => {
    it("should validate a valid scenario result", () => {
      const scenarioResult: ScenarioResult = {
        scenarioType: "context-recall",
        phase: "vesper-enabled",
        metrics: [
          {
            timestamp: Date.now(),
            latencyMs: 45.5,
            memoryHit: true,
          },
          {
            timestamp: Date.now(),
            latencyMs: 52.3,
            memoryHit: true,
          },
        ],
        aggregates: {
          latencyP50: 48.9,
          latencyP95: 52.0,
          latencyP99: 52.3,
          avgTokens: 150,
          avgAccuracy: 0.92,
          memoryHitRate: 1.0,
        },
        rawResponses: ["Response 1", "Response 2"],
      };

      const result = ScenarioResultSchema.safeParse(scenarioResult);
      expect(result.success).toBe(true);
    });

    it("should validate both phases", () => {
      const phases: BenchmarkPhase[] = ["vesper-enabled", "vesper-disabled"];

      for (const phase of phases) {
        const scenarioResult = {
          scenarioType: "context-recall" as ScenarioType,
          phase,
          metrics: [{ timestamp: Date.now(), latencyMs: 50, memoryHit: false }],
          aggregates: {
            latencyP50: 50,
            latencyP95: 50,
            latencyP99: 50,
          },
          rawResponses: ["Response"],
        };

        const result = ScenarioResultSchema.safeParse(scenarioResult);
        expect(result.success).toBe(true);
      }
    });

    it("should reject empty metrics array", () => {
      const scenarioResult = {
        scenarioType: "context-recall",
        phase: "vesper-enabled",
        metrics: [],
        aggregates: {
          latencyP50: 50,
          latencyP95: 50,
          latencyP99: 50,
        },
        rawResponses: [],
      };

      const result = ScenarioResultSchema.safeParse(scenarioResult);
      expect(result.success).toBe(false);
    });
  });

  describe("ComparisonResult validation", () => {
    it("should validate a valid comparison result", () => {
      const comparison: ComparisonResult = {
        scenarioType: "context-recall",
        enabledResult: {
          scenarioType: "context-recall",
          phase: "vesper-enabled",
          metrics: [{ timestamp: Date.now(), latencyMs: 45, memoryHit: true }],
          aggregates: { latencyP50: 45, latencyP95: 50, latencyP99: 55 },
          rawResponses: ["Response"],
        },
        disabledResult: {
          scenarioType: "context-recall",
          phase: "vesper-disabled",
          metrics: [{ timestamp: Date.now(), latencyMs: 100, memoryHit: false }],
          aggregates: { latencyP50: 100, latencyP95: 120, latencyP99: 150 },
          rawResponses: ["Response"],
        },
        statistics: {
          latencyImprovement: 55,
          tokenSavings: 30,
          accuracyDelta: 0.25,
          tTestResult: {
            tStatistic: -5.5,
            pValue: 0.001,
            degreesOfFreedom: 18,
            significant: true,
            alpha: 0.05,
            meanDifference: -55,
          },
          effectSize: {
            cohensD: -1.2,
            interpretation: "large",
          },
        },
        winner: "vesper-enabled",
      };

      const result = ComparisonResultSchema.safeParse(comparison);
      expect(result.success).toBe(true);
    });

    it("should accept tie as winner", () => {
      const comparison = {
        scenarioType: "context-recall" as ScenarioType,
        enabledResult: {
          scenarioType: "context-recall" as ScenarioType,
          phase: "vesper-enabled" as BenchmarkPhase,
          metrics: [{ timestamp: Date.now(), latencyMs: 50, memoryHit: true }],
          aggregates: { latencyP50: 50, latencyP95: 50, latencyP99: 50 },
          rawResponses: ["Response"],
        },
        disabledResult: {
          scenarioType: "context-recall" as ScenarioType,
          phase: "vesper-disabled" as BenchmarkPhase,
          metrics: [{ timestamp: Date.now(), latencyMs: 50, memoryHit: false }],
          aggregates: { latencyP50: 50, latencyP95: 50, latencyP99: 50 },
          rawResponses: ["Response"],
        },
        statistics: {
          latencyImprovement: 0,
          tokenSavings: 0,
          accuracyDelta: 0,
          tTestResult: {
            tStatistic: 0,
            pValue: 1,
            degreesOfFreedom: 8,
            significant: false,
            alpha: 0.05,
            meanDifference: 0,
          },
          effectSize: {
            cohensD: 0,
            interpretation: "negligible",
          },
        },
        winner: "tie",
      };

      const result = ComparisonResultSchema.safeParse(comparison);
      expect(result.success).toBe(true);
    });
  });

  describe("BenchmarkResult validation", () => {
    it("should validate a complete benchmark result", () => {
      const benchmarkResult: BenchmarkResult = {
        id: "bench-123",
        startTime: Date.now() - 60000,
        endTime: Date.now(),
        config: createDefaultConfig(),
        comparisons: [],
        summary: {
          totalScenarios: 5,
          vesperWins: 3,
          disabledWins: 1,
          ties: 1,
          overallImprovement: 35,
          statisticallySignificant: true,
        },
        metadata: {
          version: "0.1.0",
          environment: "test",
        },
      };

      const result = BenchmarkResultSchema.safeParse(benchmarkResult);
      expect(result.success).toBe(true);
    });

    it("should reject endTime before startTime", () => {
      const benchmarkResult = {
        id: "bench-123",
        startTime: Date.now(),
        endTime: Date.now() - 60000, // Before start
        config: createDefaultConfig(),
        comparisons: [],
        summary: {
          totalScenarios: 5,
          vesperWins: 3,
          disabledWins: 1,
          ties: 1,
          overallImprovement: 35,
          statisticallySignificant: true,
        },
        metadata: {
          version: "0.1.0",
          environment: "test",
        },
      };

      const result = BenchmarkResultSchema.safeParse(benchmarkResult);
      expect(result.success).toBe(false);
    });

    it("should reject if wins dont add up to total", () => {
      const benchmarkResult = {
        id: "bench-123",
        startTime: Date.now() - 60000,
        endTime: Date.now(),
        config: createDefaultConfig(),
        comparisons: [],
        summary: {
          totalScenarios: 5,
          vesperWins: 3,
          disabledWins: 3, // 3 + 3 + 1 = 7, not 5
          ties: 1,
          overallImprovement: 35,
          statisticallySignificant: true,
        },
        metadata: {
          version: "0.1.0",
          environment: "test",
        },
      };

      const result = BenchmarkResultSchema.safeParse(benchmarkResult);
      expect(result.success).toBe(false);
    });
  });

  describe("Helper validation functions", () => {
    it("validateBenchmarkConfig should return parsed config on valid input", () => {
      const input = {
        warmupRuns: 3,
        measurementRuns: 10,
        timeoutMs: 30000,
        scenarios: ["context-recall"],
        outputDirectory: "./results",
        significanceLevel: 0.05,
      };

      const result = validateBenchmarkConfig(input);
      expect(result.warmupRuns).toBe(3);
      expect(result.measurementRuns).toBe(10);
    });

    it("validateBenchmarkConfig should throw on invalid input", () => {
      const input = {
        warmupRuns: -1,
        measurementRuns: 0,
        timeoutMs: 30000,
        scenarios: [],
        outputDirectory: "",
        significanceLevel: 2,
      };

      expect(() => validateBenchmarkConfig(input)).toThrow();
    });

    it("validateMetricsSnapshot should return parsed snapshot", () => {
      const input = {
        timestamp: Date.now(),
        latencyMs: 50,
        memoryHit: true,
      };

      const result = validateMetricsSnapshot(input);
      expect(result.latencyMs).toBe(50);
    });
  });

  describe("Type inference", () => {
    it("should correctly infer ScenarioType", () => {
      const scenarios: ScenarioType[] = [
        "context-recall",
        "cross-session",
        "skill-retrieval",
        "token-efficiency",
        "semantic-accuracy",
      ];

      // TypeScript should accept these
      expect(scenarios.length).toBe(5);
    });

    it("should correctly infer BenchmarkPhase", () => {
      const phases: BenchmarkPhase[] = ["vesper-enabled", "vesper-disabled"];

      expect(phases.length).toBe(2);
    });
  });
});
