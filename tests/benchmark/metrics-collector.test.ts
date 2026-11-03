/**
 * Tests for Metrics Collector
 *
 * TDD Phase 3: Real-time metrics collection during benchmark runs.
 *
 * Coverage targets:
 * - Latency measurement accuracy
 * - Token counting
 * - Response quality evaluation
 * - Memory hit tracking
 * - Aggregation of multiple runs
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MetricsCollector,
  createMetricsCollector,
  measureLatency,
  estimateTokens,
  evaluateResponseQuality,
  aggregateMetrics,
} from "../../src/benchmark/metrics-collector";
import type { MetricsSnapshot, AggregateMetrics } from "../../src/benchmark/types";

describe("Metrics Collector", () => {
  describe("MetricsCollector class", () => {
    let collector: MetricsCollector;

    beforeEach(() => {
      collector = createMetricsCollector();
    });

    it("should initialize with empty metrics", () => {
      expect(collector.getMetrics()).toEqual([]);
      expect(collector.getCount()).toBe(0);
    });

    it("should record a metric snapshot", () => {
      const snapshot: MetricsSnapshot = {
        timestamp: Date.now(),
        latencyMs: 45.5,
        memoryHit: true,
        tokensUsed: 150,
      };

      collector.record(snapshot);

      expect(collector.getCount()).toBe(1);
      expect(collector.getMetrics()[0]).toEqual(snapshot);
    });

    it("should record multiple snapshots", () => {
      const snapshot1: MetricsSnapshot = {
        timestamp: Date.now(),
        latencyMs: 45.5,
        memoryHit: true,
      };
      const snapshot2: MetricsSnapshot = {
        timestamp: Date.now() + 1000,
        latencyMs: 52.3,
        memoryHit: false,
      };

      collector.record(snapshot1);
      collector.record(snapshot2);

      expect(collector.getCount()).toBe(2);
    });

    it("should clear all metrics", () => {
      collector.record({
        timestamp: Date.now(),
        latencyMs: 45.5,
        memoryHit: true,
      });
      collector.record({
        timestamp: Date.now(),
        latencyMs: 52.3,
        memoryHit: false,
      });

      collector.clear();

      expect(collector.getCount()).toBe(0);
      expect(collector.getMetrics()).toEqual([]);
    });

    it("should compute aggregates", () => {
      // Record 5 measurements
      const latencies = [40, 45, 50, 55, 100]; // P50=50, P95~100, P99~100

      for (const latency of latencies) {
        collector.record({
          timestamp: Date.now(),
          latencyMs: latency,
          memoryHit: latency < 60, // 4/5 hits
          tokensUsed: latency * 2,
        });
      }

      const aggregates = collector.aggregate();

      expect(aggregates.latencyP50).toBe(50);
      expect(aggregates.latencyP95).toBeGreaterThanOrEqual(90);
      expect(aggregates.latencyP99).toBeGreaterThanOrEqual(95);
      expect(aggregates.memoryHitRate).toBe(0.8); // 4/5
      expect(aggregates.avgTokens).toBe(116); // Mean of [80, 90, 100, 110, 200]
    });

    it("should throw when aggregating empty metrics", () => {
      expect(() => collector.aggregate()).toThrow("Cannot aggregate empty metrics");
    });

    it("should return a copy of metrics (immutability)", () => {
      collector.record({
        timestamp: Date.now(),
        latencyMs: 45.5,
        memoryHit: true,
      });

      const metrics1 = collector.getMetrics();
      const metrics2 = collector.getMetrics();

      expect(metrics1).not.toBe(metrics2);
      expect(metrics1).toEqual(metrics2);
    });
  });

  describe("measureLatency", () => {
    it("should measure async function latency", async () => {
      const asyncFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "result";
      };

      const { result, latencyMs } = await measureLatency(asyncFn);

      expect(result).toBe("result");
      expect(latencyMs).toBeGreaterThanOrEqual(9); // Allow for timing precision (~9.84ms)
      expect(latencyMs).toBeLessThan(100); // Should be fast
    });

    it("should measure sync function latency", async () => {
      const syncFn = () => {
        let sum = 0;
        for (let i = 0; i < 1000000; i++) {
          sum += i;
        }
        return sum;
      };

      const { result, latencyMs } = await measureLatency(syncFn);

      expect(result).toBeGreaterThan(0);
      expect(latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should propagate errors from measured function", async () => {
      const failingFn = async () => {
        throw new Error("Test error");
      };

      await expect(measureLatency(failingFn)).rejects.toThrow("Test error");
    });

    it("should handle void functions", async () => {
      const voidFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      };

      const { result, latencyMs } = await measureLatency(voidFn);

      expect(result).toBeUndefined();
      // Allow some tolerance for system scheduling variance
      expect(latencyMs).toBeGreaterThanOrEqual(8);
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens for English text", () => {
      const text = "Hello, how are you today?"; // ~6-7 tokens
      const tokens = estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });

    it("should estimate tokens proportionally to text length", () => {
      const text = "abcd".repeat(100); // 400 chars
      const tokens = estimateTokens(text);

      // Token estimation uses a weighted formula combining character count,
      // word count, and punctuation. For repeated "abcd" (single long word),
      // the estimate will be lower than simple char/4 division.
      expect(tokens).toBeGreaterThan(50);
      expect(tokens).toBeLessThan(150);
    });

    it("should handle empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("should handle whitespace-only string", () => {
      expect(estimateTokens("   ")).toBe(0);
    });

    it("should count special tokens for common patterns", () => {
      // Code typically has more tokens per character
      const code = "function foo() { return bar; }";
      const prose = "This is a simple sentence.";

      const codeTokens = estimateTokens(code, "code");
      const proseTokens = estimateTokens(prose, "prose");

      // Code usually has higher token density
      expect(codeTokens / code.length).toBeGreaterThanOrEqual(
        proseTokens / prose.length - 0.1
      );
    });

    it("should handle Unicode characters", () => {
      const unicode = "Hello, world! [Japanese: konnichiwa]";
      const tokens = estimateTokens(unicode);

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe("evaluateResponseQuality", () => {
    it("should return 1.0 for exact match", () => {
      const expected = "The answer is 42";
      const actual = "The answer is 42";

      const quality = evaluateResponseQuality(actual, expected);

      expect(quality).toBe(1.0);
    });

    it("should return high score for partial match", () => {
      const expected = "The capital of France is Paris";
      const actual = "Paris is the capital of France";

      const quality = evaluateResponseQuality(actual, expected);

      expect(quality).toBeGreaterThan(0.7);
    });

    it("should return low score for unrelated responses", () => {
      const expected = "The capital of France is Paris";
      const actual = "I like pizza";

      const quality = evaluateResponseQuality(actual, expected);

      expect(quality).toBeLessThan(0.3);
    });

    it("should return 0.0 for empty response", () => {
      const expected = "The answer is 42";
      const actual = "";

      const quality = evaluateResponseQuality(actual, expected);

      expect(quality).toBe(0.0);
    });

    it("should be case-insensitive", () => {
      const expected = "HELLO WORLD";
      const actual = "hello world";

      const quality = evaluateResponseQuality(actual, expected);

      expect(quality).toBe(1.0);
    });

    it("should handle keyword matching mode", () => {
      const keywords = ["Paris", "capital", "France"];
      const actual = "Paris is the capital city of France and is known for the Eiffel Tower";

      const quality = evaluateResponseQuality(actual, keywords, { mode: "keywords" });

      expect(quality).toBe(1.0); // All keywords present
    });

    it("should score partial keyword match", () => {
      const keywords = ["Paris", "capital", "France", "Europe"];
      const actual = "Paris is the capital of France";

      const quality = evaluateResponseQuality(actual, keywords, { mode: "keywords" });

      expect(quality).toBe(0.75); // 3/4 keywords
    });
  });

  describe("aggregateMetrics", () => {
    it("should aggregate latencies correctly", () => {
      const metrics: MetricsSnapshot[] = [
        { timestamp: 1, latencyMs: 10, memoryHit: true },
        { timestamp: 2, latencyMs: 20, memoryHit: true },
        { timestamp: 3, latencyMs: 30, memoryHit: false },
        { timestamp: 4, latencyMs: 40, memoryHit: true },
        { timestamp: 5, latencyMs: 50, memoryHit: false },
      ];

      const aggregates = aggregateMetrics(metrics);

      expect(aggregates.latencyP50).toBe(30);
      expect(aggregates.latencyP95).toBeGreaterThanOrEqual(45);
      expect(aggregates.memoryHitRate).toBe(0.6); // 3/5
    });

    it("should handle single metric", () => {
      const metrics: MetricsSnapshot[] = [
        { timestamp: 1, latencyMs: 50, memoryHit: true, tokensUsed: 100 },
      ];

      const aggregates = aggregateMetrics(metrics);

      expect(aggregates.latencyP50).toBe(50);
      expect(aggregates.latencyP95).toBe(50);
      expect(aggregates.latencyP99).toBe(50);
      expect(aggregates.avgTokens).toBe(100);
    });

    it("should throw for empty metrics array", () => {
      expect(() => aggregateMetrics([])).toThrow("Cannot aggregate empty metrics");
    });

    it("should calculate standard deviation", () => {
      const metrics: MetricsSnapshot[] = [
        { timestamp: 1, latencyMs: 10, memoryHit: true },
        { timestamp: 2, latencyMs: 20, memoryHit: true },
        { timestamp: 3, latencyMs: 30, memoryHit: true },
      ];

      const aggregates = aggregateMetrics(metrics);

      expect(aggregates.latencyMean).toBe(20);
      // Sample standard deviation of [10, 20, 30] = 10
      expect(aggregates.latencyStdDev).toBeCloseTo(10, 1);
    });

    it("should handle metrics with missing optional fields", () => {
      const metrics: MetricsSnapshot[] = [
        { timestamp: 1, latencyMs: 50, memoryHit: true },
        { timestamp: 2, latencyMs: 60, memoryHit: false },
      ];

      const aggregates = aggregateMetrics(metrics);

      expect(aggregates.avgTokens).toBeUndefined();
      expect(aggregates.avgAccuracy).toBeUndefined();
    });

    it("should calculate accuracy average when present", () => {
      const metrics: MetricsSnapshot[] = [
        { timestamp: 1, latencyMs: 50, memoryHit: true, retrievalAccuracy: 0.9 },
        { timestamp: 2, latencyMs: 60, memoryHit: true, retrievalAccuracy: 0.8 },
        { timestamp: 3, latencyMs: 70, memoryHit: false, retrievalAccuracy: 0.7 },
      ];

      const aggregates = aggregateMetrics(metrics);

      // Average of 0.9 + 0.8 + 0.7 = 2.4 / 3 = 0.8
      expect(aggregates.avgAccuracy).toBeCloseTo(0.8, 10);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very small latencies", () => {
      const collector = createMetricsCollector();

      collector.record({
        timestamp: Date.now(),
        latencyMs: 0.001,
        memoryHit: true,
      });

      const aggregates = collector.aggregate();

      expect(aggregates.latencyP50).toBe(0.001);
    });

    it("should handle very large latencies", () => {
      const collector = createMetricsCollector();

      collector.record({
        timestamp: Date.now(),
        latencyMs: 1000000,
        memoryHit: false,
      });

      const aggregates = collector.aggregate();

      expect(aggregates.latencyP50).toBe(1000000);
    });

    it("should handle all memory hits", () => {
      const metrics: MetricsSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
        timestamp: Date.now() + i,
        latencyMs: 50 + i,
        memoryHit: true,
      }));

      const aggregates = aggregateMetrics(metrics);

      expect(aggregates.memoryHitRate).toBe(1.0);
    });

    it("should handle no memory hits", () => {
      const metrics: MetricsSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
        timestamp: Date.now() + i,
        latencyMs: 50 + i,
        memoryHit: false,
      }));

      const aggregates = aggregateMetrics(metrics);

      expect(aggregates.memoryHitRate).toBe(0.0);
    });
  });
});
