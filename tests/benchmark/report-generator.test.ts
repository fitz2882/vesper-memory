/**
 * Tests for Report Generator
 *
 * TDD Phase 6: Generates markdown reports from benchmark results.
 *
 * Coverage targets:
 * - Markdown format validation
 * - All sections included
 * - Statistical data formatting
 * - Summary tables
 */

import { describe, it, expect } from "vitest";
import {
  generateMarkdownReport,
  formatNumber,
  formatPercentage,
  formatDuration,
  generateSummaryTable,
  generateComparisonSection,
} from "../../src/benchmark/report-generator";
import type {
  BenchmarkResult,
  ComparisonResult,
  BenchmarkSummary,
} from "../../src/benchmark/types";
import { createDefaultConfig } from "../../src/benchmark/types";

// Helper to create test benchmark result
function createTestBenchmarkResult(): BenchmarkResult {
  return {
    id: "bench-test-123",
    startTime: Date.now() - 60000,
    endTime: Date.now(),
    config: createDefaultConfig({
      warmupRuns: 3,
      measurementRuns: 10,
      scenarios: ["context-recall", "skill-retrieval"],
    }),
    comparisons: [
      {
        scenarioType: "context-recall",
        enabledResult: {
          scenarioType: "context-recall",
          phase: "vesper-enabled",
          metrics: [
            { timestamp: 1, latencyMs: 45, memoryHit: true, retrievalAccuracy: 0.9 },
            { timestamp: 2, latencyMs: 50, memoryHit: true, retrievalAccuracy: 0.85 },
          ],
          aggregates: {
            latencyP50: 47.5,
            latencyP95: 49.5,
            latencyP99: 50,
            memoryHitRate: 1.0,
            avgAccuracy: 0.875,
          },
          rawResponses: ["Response 1", "Response 2"],
        },
        disabledResult: {
          scenarioType: "context-recall",
          phase: "vesper-disabled",
          metrics: [
            { timestamp: 1, latencyMs: 100, memoryHit: false, retrievalAccuracy: 0 },
            { timestamp: 2, latencyMs: 120, memoryHit: false, retrievalAccuracy: 0 },
          ],
          aggregates: {
            latencyP50: 110,
            latencyP95: 118,
            latencyP99: 120,
            memoryHitRate: 0,
            avgAccuracy: 0,
          },
          rawResponses: ["No memory", "No memory"],
        },
        statistics: {
          latencyImprovement: 56.8,
          tokenSavings: 25,
          accuracyDelta: 0.875,
          tTestResult: {
            tStatistic: -5.5,
            pValue: 0.001,
            degreesOfFreedom: 18,
            significant: true,
            alpha: 0.05,
            meanDifference: -62.5,
          },
          effectSize: {
            cohensD: -1.8,
            interpretation: "large",
          },
        },
        winner: "vesper-enabled",
      },
      {
        scenarioType: "skill-retrieval",
        enabledResult: {
          scenarioType: "skill-retrieval",
          phase: "vesper-enabled",
          metrics: [
            { timestamp: 1, latencyMs: 55, memoryHit: true, retrievalAccuracy: 0.8 },
          ],
          aggregates: {
            latencyP50: 55,
            latencyP95: 55,
            latencyP99: 55,
            memoryHitRate: 1.0,
            avgAccuracy: 0.8,
          },
          rawResponses: ["Skill response"],
        },
        disabledResult: {
          scenarioType: "skill-retrieval",
          phase: "vesper-disabled",
          metrics: [
            { timestamp: 1, latencyMs: 60, memoryHit: false, retrievalAccuracy: 0 },
          ],
          aggregates: {
            latencyP50: 60,
            latencyP95: 60,
            latencyP99: 60,
            memoryHitRate: 0,
            avgAccuracy: 0,
          },
          rawResponses: ["No skill"],
        },
        statistics: {
          latencyImprovement: 8.3,
          tokenSavings: 10,
          accuracyDelta: 0.8,
          tTestResult: {
            tStatistic: -0.5,
            pValue: 0.35,
            degreesOfFreedom: 2,
            significant: false,
            alpha: 0.05,
            meanDifference: -5,
          },
          effectSize: {
            cohensD: -0.3,
            interpretation: "small",
          },
        },
        winner: "tie",
      },
    ],
    summary: {
      totalScenarios: 2,
      vesperWins: 1,
      disabledWins: 0,
      ties: 1,
      overallImprovement: 32.55,
      statisticallySignificant: true,
    },
    metadata: {
      version: "0.1.0",
      environment: "test",
      nodeVersion: "v20.0.0",
    },
  };
}

describe("Report Generator", () => {
  describe("generateMarkdownReport", () => {
    it("should generate valid markdown", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(0);
    });

    it("should include title", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      expect(report).toContain("# Vesper Benchmark Report");
    });

    it("should include timestamp", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      expect(report).toContain("Generated:");
    });

    it("should include summary section", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      expect(report).toContain("## Summary");
      expect(report).toContain("Total Scenarios");
    });

    it("should include comparison sections for each scenario", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      expect(report).toContain("context-recall");
      expect(report).toContain("skill-retrieval");
    });

    it("should include statistical results", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      expect(report).toContain("t-test");
      expect(report).toContain("p-value");
      expect(report).toContain("Cohen's d");
    });

    it("should include configuration section", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      expect(report).toContain("## Configuration");
      expect(report).toContain("Warmup Runs");
      expect(report).toContain("Measurement Runs");
    });

    it("should include metadata section", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      expect(report).toContain("## Metadata");
      expect(report).toContain("Version");
      expect(report).toContain("Environment");
    });

    it("should indicate winners clearly", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      // Should show Vesper won one scenario (displayed as "Vesper Enabled" in title case)
      expect(report).toContain("Vesper Enabled");
      expect(report).toContain("Winner");
    });

    it("should show improvement percentages", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      expect(report).toContain("%");
    });

    it("should be properly formatted markdown", () => {
      const result = createTestBenchmarkResult();
      const report = generateMarkdownReport(result);

      // Check for markdown headings
      expect(report).toMatch(/^# /m);
      expect(report).toMatch(/^## /m);

      // Check for tables (pipe characters)
      expect(report).toContain("|");

      // Check for proper newlines
      expect(report).toContain("\n\n");
    });
  });

  describe("Helper functions", () => {
    describe("formatNumber", () => {
      it("should format integers", () => {
        expect(formatNumber(42)).toBe("42");
      });

      it("should format decimals to specified precision", () => {
        expect(formatNumber(3.14159, 2)).toBe("3.14");
      });

      it("should handle zero", () => {
        expect(formatNumber(0)).toBe("0");
      });

      it("should handle negative numbers", () => {
        expect(formatNumber(-5.5, 1)).toBe("-5.5");
      });

      it("should handle large numbers", () => {
        expect(formatNumber(1000000)).toBe("1,000,000");
      });
    });

    describe("formatPercentage", () => {
      it("should format as percentage with sign", () => {
        expect(formatPercentage(50)).toBe("+50.0%");
      });

      it("should show negative percentages", () => {
        expect(formatPercentage(-25)).toBe("-25.0%");
      });

      it("should handle zero", () => {
        expect(formatPercentage(0)).toBe("0.0%");
      });
    });

    describe("formatDuration", () => {
      it("should format milliseconds", () => {
        expect(formatDuration(500)).toBe("500ms");
      });

      it("should format seconds", () => {
        expect(formatDuration(5000)).toBe("5.0s");
      });

      it("should format minutes", () => {
        expect(formatDuration(120000)).toBe("2m 0s");
      });
    });
  });

  describe("generateSummaryTable", () => {
    it("should generate a markdown table", () => {
      const summary: BenchmarkSummary = {
        totalScenarios: 5,
        vesperWins: 3,
        disabledWins: 1,
        ties: 1,
        overallImprovement: 45.5,
        statisticallySignificant: true,
      };

      const table = generateSummaryTable(summary);

      expect(table).toContain("|");
      expect(table).toContain("Metric");
      expect(table).toContain("Value");
      expect(table).toContain("5");
      expect(table).toContain("3");
    });

    it("should show statistical significance", () => {
      const summary: BenchmarkSummary = {
        totalScenarios: 5,
        vesperWins: 4,
        disabledWins: 0,
        ties: 1,
        overallImprovement: 60,
        statisticallySignificant: true,
      };

      const table = generateSummaryTable(summary);

      expect(table).toContain("Yes");
    });
  });

  describe("generateComparisonSection", () => {
    it("should generate comparison for a scenario", () => {
      const comparison: ComparisonResult = {
        scenarioType: "context-recall",
        enabledResult: {
          scenarioType: "context-recall",
          phase: "vesper-enabled",
          metrics: [{ timestamp: 1, latencyMs: 50, memoryHit: true }],
          aggregates: { latencyP50: 50, latencyP95: 55, latencyP99: 60 },
          rawResponses: ["test"],
        },
        disabledResult: {
          scenarioType: "context-recall",
          phase: "vesper-disabled",
          metrics: [{ timestamp: 1, latencyMs: 100, memoryHit: false }],
          aggregates: { latencyP50: 100, latencyP95: 110, latencyP99: 120 },
          rawResponses: ["test"],
        },
        statistics: {
          latencyImprovement: 50,
          tokenSavings: 20,
          accuracyDelta: 0.5,
          tTestResult: {
            tStatistic: -3.5,
            pValue: 0.01,
            degreesOfFreedom: 10,
            significant: true,
            alpha: 0.05,
            meanDifference: -50,
          },
          effectSize: {
            cohensD: -1.0,
            interpretation: "large",
          },
        },
        winner: "vesper-enabled",
      };

      const section = generateComparisonSection(comparison);

      // Scenario name is title-cased in the report
      expect(section).toContain("Context Recall");
      expect(section).toContain("Latency");
      // Winner text is title-cased
      expect(section).toContain("Vesper Enabled");
    });

    it("should show P50, P95, P99 latencies", () => {
      const comparison: ComparisonResult = {
        scenarioType: "context-recall",
        enabledResult: {
          scenarioType: "context-recall",
          phase: "vesper-enabled",
          metrics: [{ timestamp: 1, latencyMs: 50, memoryHit: true }],
          aggregates: { latencyP50: 50, latencyP95: 55, latencyP99: 60 },
          rawResponses: ["test"],
        },
        disabledResult: {
          scenarioType: "context-recall",
          phase: "vesper-disabled",
          metrics: [{ timestamp: 1, latencyMs: 100, memoryHit: false }],
          aggregates: { latencyP50: 100, latencyP95: 110, latencyP99: 120 },
          rawResponses: ["test"],
        },
        statistics: {
          latencyImprovement: 50,
          tokenSavings: 0,
          accuracyDelta: 0,
          tTestResult: {
            tStatistic: 0,
            pValue: 0.5,
            degreesOfFreedom: 2,
            significant: false,
            alpha: 0.05,
            meanDifference: 0,
          },
          effectSize: { cohensD: 0, interpretation: "negligible" },
        },
        winner: "tie",
      };

      const section = generateComparisonSection(comparison);

      expect(section).toContain("P50");
      expect(section).toContain("P95");
      expect(section).toContain("P99");
    });
  });
});
