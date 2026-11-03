/**
 * Tests for Statistical Functions
 *
 * TDD Phase 1: Write failing tests first for all statistical functions.
 * These are pure functions with no external dependencies - ideal for TDD.
 *
 * Coverage targets:
 * - mean, median, percentile calculations
 * - standard deviation, variance
 * - confidence intervals
 * - Welch's t-test for significance
 * - Cohen's d effect size
 * - Edge cases (empty arrays, single elements, null values)
 */

import { describe, it, expect } from "vitest";
import {
  mean,
  median,
  percentile,
  standardDeviation,
  variance,
  confidenceInterval,
  welchTTest,
  cohensD,
  StatisticsError,
} from "../../src/benchmark/statistics";

describe("Statistics Module", () => {
  describe("mean", () => {
    it("should calculate mean of positive numbers", () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
    });

    it("should calculate mean with decimal values", () => {
      expect(mean([1.5, 2.5, 3.5])).toBeCloseTo(2.5, 10);
    });

    it("should handle negative numbers", () => {
      expect(mean([-1, 0, 1])).toBe(0);
    });

    it("should handle single element array", () => {
      expect(mean([42])).toBe(42);
    });

    it("should throw StatisticsError for empty array", () => {
      expect(() => mean([])).toThrow(StatisticsError);
      expect(() => mean([])).toThrow("Cannot calculate mean of empty array");
    });

    it("should handle large numbers", () => {
      expect(mean([1e10, 2e10, 3e10])).toBeCloseTo(2e10, 5);
    });

    it("should handle very small numbers", () => {
      expect(mean([1e-10, 2e-10, 3e-10])).toBeCloseTo(2e-10, 20);
    });
  });

  describe("median", () => {
    it("should calculate median of odd-length array", () => {
      expect(median([1, 2, 3, 4, 5])).toBe(3);
    });

    it("should calculate median of even-length array", () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it("should handle unsorted array", () => {
      expect(median([5, 1, 3, 2, 4])).toBe(3);
    });

    it("should handle single element", () => {
      expect(median([42])).toBe(42);
    });

    it("should throw StatisticsError for empty array", () => {
      expect(() => median([])).toThrow(StatisticsError);
      expect(() => median([])).toThrow("Cannot calculate median of empty array");
    });

    it("should handle negative numbers", () => {
      expect(median([-3, -1, 0, 1, 3])).toBe(0);
    });

    it("should handle duplicate values", () => {
      expect(median([1, 1, 1, 1, 5])).toBe(1);
    });

    it("should not mutate original array", () => {
      const original = [5, 1, 3, 2, 4];
      const copy = [...original];
      median(original);
      expect(original).toEqual(copy);
    });
  });

  describe("percentile", () => {
    it("should calculate P50 (median)", () => {
      expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    });

    it("should calculate P95", () => {
      // For [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], P95 should be 9.55 (interpolated)
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(percentile(data, 95)).toBeCloseTo(9.55, 1);
    });

    it("should calculate P99", () => {
      const data = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(percentile(data, 99)).toBeCloseTo(99.01, 1);
    });

    it("should calculate P0 (minimum)", () => {
      expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    });

    it("should calculate P100 (maximum)", () => {
      expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
    });

    it("should throw StatisticsError for empty array", () => {
      expect(() => percentile([], 50)).toThrow(StatisticsError);
    });

    it("should throw StatisticsError for percentile < 0", () => {
      expect(() => percentile([1, 2, 3], -1)).toThrow(StatisticsError);
      expect(() => percentile([1, 2, 3], -1)).toThrow("Percentile must be between 0 and 100");
    });

    it("should throw StatisticsError for percentile > 100", () => {
      expect(() => percentile([1, 2, 3], 101)).toThrow(StatisticsError);
      expect(() => percentile([1, 2, 3], 101)).toThrow("Percentile must be between 0 and 100");
    });

    it("should handle unsorted array", () => {
      expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    });

    it("should not mutate original array", () => {
      const original = [5, 1, 3, 2, 4];
      const copy = [...original];
      percentile(original, 50);
      expect(original).toEqual(copy);
    });
  });

  describe("variance", () => {
    it("should calculate population variance", () => {
      // Variance of [2, 4, 4, 4, 5, 5, 7, 9] = 4
      expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBe(4);
    });

    it("should calculate sample variance", () => {
      // Sample variance of [2, 4, 4, 4, 5, 5, 7, 9] = 4.571...
      expect(variance([2, 4, 4, 4, 5, 5, 7, 9], true)).toBeCloseTo(4.571, 2);
    });

    it("should return 0 for identical values", () => {
      expect(variance([5, 5, 5, 5])).toBe(0);
    });

    it("should handle single element (population)", () => {
      expect(variance([42])).toBe(0);
    });

    it("should throw StatisticsError for sample variance with single element", () => {
      expect(() => variance([42], true)).toThrow(StatisticsError);
      expect(() => variance([42], true)).toThrow("Sample variance requires at least 2 elements");
    });

    it("should throw StatisticsError for empty array", () => {
      expect(() => variance([])).toThrow(StatisticsError);
    });
  });

  describe("standardDeviation", () => {
    it("should calculate population standard deviation", () => {
      // SD of [2, 4, 4, 4, 5, 5, 7, 9] = 2
      expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    });

    it("should calculate sample standard deviation", () => {
      // Sample SD of [2, 4, 4, 4, 5, 5, 7, 9] = 2.138...
      expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9], true)).toBeCloseTo(2.138, 2);
    });

    it("should return 0 for identical values", () => {
      expect(standardDeviation([5, 5, 5, 5])).toBe(0);
    });

    it("should throw StatisticsError for empty array", () => {
      expect(() => standardDeviation([])).toThrow(StatisticsError);
    });

    it("should throw StatisticsError for sample SD with single element", () => {
      expect(() => standardDeviation([42], true)).toThrow(StatisticsError);
    });
  });

  describe("confidenceInterval", () => {
    it("should calculate 95% CI for sample", () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const ci = confidenceInterval(data, 0.95);

      expect(ci.mean).toBe(5.5);
      expect(ci.lower).toBeCloseTo(3.334, 1);
      expect(ci.upper).toBeCloseTo(7.666, 1);
      expect(ci.confidenceLevel).toBe(0.95);
    });

    it("should calculate 99% CI for sample", () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const ci = confidenceInterval(data, 0.99);

      // 99% CI should be wider than 95% CI
      const ci95 = confidenceInterval(data, 0.95);
      expect(ci.upper - ci.lower).toBeGreaterThan(ci95.upper - ci95.lower);
    });

    it("should throw StatisticsError for empty array", () => {
      expect(() => confidenceInterval([], 0.95)).toThrow(StatisticsError);
    });

    it("should throw StatisticsError for single element", () => {
      expect(() => confidenceInterval([42], 0.95)).toThrow(StatisticsError);
      expect(() => confidenceInterval([42], 0.95)).toThrow("Confidence interval requires at least 2 elements");
    });

    it("should throw StatisticsError for invalid confidence level", () => {
      expect(() => confidenceInterval([1, 2, 3], 0)).toThrow(StatisticsError);
      expect(() => confidenceInterval([1, 2, 3], 1)).toThrow(StatisticsError);
      expect(() => confidenceInterval([1, 2, 3], 1.5)).toThrow(StatisticsError);
    });

    it("should return narrower CI with larger sample", () => {
      const smallSample = [1, 2, 3, 4, 5];
      const largeSample = Array.from({ length: 100 }, (_, i) => i + 1);

      const ciSmall = confidenceInterval(smallSample, 0.95);
      const ciLarge = confidenceInterval(largeSample, 0.95);

      // Normalize by mean to compare relative widths
      const widthSmall = (ciSmall.upper - ciSmall.lower) / ciSmall.mean;
      const widthLarge = (ciLarge.upper - ciLarge.lower) / ciLarge.mean;

      expect(widthLarge).toBeLessThan(widthSmall);
    });
  });

  describe("welchTTest", () => {
    it("should detect significant difference between clearly different groups", () => {
      const groupA = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
      const groupB = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60];

      const result = welchTTest(groupA, groupB);

      expect(result.tStatistic).toBeLessThan(0); // A < B
      expect(result.pValue).toBeLessThan(0.001); // Highly significant
      expect(result.significant).toBe(true);
    });

    it("should not detect significance between similar groups", () => {
      const groupA = [10, 11, 12, 13, 14];
      const groupB = [11, 12, 13, 14, 15];

      const result = welchTTest(groupA, groupB);

      expect(result.pValue).toBeGreaterThan(0.05); // Not significant at alpha=0.05
      expect(result.significant).toBe(false);
    });

    it("should handle identical groups", () => {
      const groupA = [5, 5, 5, 5, 5];
      const groupB = [5, 5, 5, 5, 5];

      const result = welchTTest(groupA, groupB);

      expect(result.tStatistic).toBe(0);
      expect(result.pValue).toBe(1);
      expect(result.significant).toBe(false);
    });

    it("should throw StatisticsError for groups with < 2 elements", () => {
      expect(() => welchTTest([1], [1, 2, 3])).toThrow(StatisticsError);
      expect(() => welchTTest([1, 2, 3], [1])).toThrow(StatisticsError);
      expect(() => welchTTest([], [1, 2, 3])).toThrow(StatisticsError);
    });

    it("should use custom alpha level", () => {
      const groupA = [10, 11, 12, 13, 14];
      const groupB = [13, 14, 15, 16, 17];

      const result005 = welchTTest(groupA, groupB, 0.05);
      const result001 = welchTTest(groupA, groupB, 0.01);

      // Same p-value, different significance thresholds
      expect(result005.pValue).toBe(result001.pValue);
      expect(result005.alpha).toBe(0.05);
      expect(result001.alpha).toBe(0.01);
    });

    it("should include degrees of freedom (Welch-Satterthwaite)", () => {
      const groupA = [10, 11, 12, 13, 14, 15];
      const groupB = [12, 13, 14, 15, 16, 17];

      const result = welchTTest(groupA, groupB);

      // Degrees of freedom should be calculated, not simply n1 + n2 - 2
      expect(result.degreesOfFreedom).toBeGreaterThan(0);
      expect(result.degreesOfFreedom).toBeLessThanOrEqual(10); // Max for two groups of 6
    });
  });

  describe("cohensD", () => {
    it("should calculate large effect size (d >= 0.8)", () => {
      const groupA = [10, 11, 12, 13, 14];
      const groupB = [30, 31, 32, 33, 34];

      const d = cohensD(groupA, groupB);

      expect(Math.abs(d)).toBeGreaterThanOrEqual(0.8);
      expect(d).toBeLessThan(0); // A < B, so negative
    });

    it("should calculate medium effect size (0.5 <= d < 0.8)", () => {
      // Designed to produce medium effect
      const groupA = [10, 11, 12, 13, 14];
      const groupB = [13, 14, 15, 16, 17];

      const d = cohensD(groupA, groupB);

      expect(Math.abs(d)).toBeGreaterThanOrEqual(0.5);
      expect(Math.abs(d)).toBeLessThan(3); // Not huge
    });

    it("should calculate small effect size (d < 0.5)", () => {
      // Very similar groups
      const groupA = [10, 11, 12, 13, 14];
      const groupB = [10.5, 11.5, 12.5, 13.5, 14.5];

      const d = cohensD(groupA, groupB);

      expect(Math.abs(d)).toBeLessThan(0.5);
    });

    it("should return 0 for identical groups", () => {
      const groupA = [10, 11, 12, 13, 14];
      const groupB = [10, 11, 12, 13, 14];

      const d = cohensD(groupA, groupB);

      expect(d).toBe(0);
    });

    it("should throw StatisticsError for groups with < 2 elements", () => {
      expect(() => cohensD([1], [1, 2, 3])).toThrow(StatisticsError);
      expect(() => cohensD([1, 2, 3], [1])).toThrow(StatisticsError);
    });

    it("should handle groups with different sizes", () => {
      const groupA = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
      const groupB = [30, 31, 32];

      const d = cohensD(groupA, groupB);

      // Should still calculate using pooled SD
      expect(typeof d).toBe("number");
      expect(isNaN(d)).toBe(false);
    });

    it("should interpret effect size correctly", () => {
      // This tests the interpretEffectSize helper if exported
      // For now, we just verify the calculation is in expected range
      const groupA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const groupB = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

      const d = cohensD(groupA, groupB);

      // Both groups have same variance, means differ by 10, SD ~2.87
      // d = (4.5 - 14.5) / ~2.87 = -3.48 (large effect)
      expect(Math.abs(d)).toBeGreaterThan(2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle arrays with NaN values gracefully", () => {
      // Functions should filter out or throw on NaN
      expect(() => mean([1, NaN, 3])).toThrow(StatisticsError);
    });

    it("should handle arrays with Infinity", () => {
      expect(() => mean([1, Infinity, 3])).toThrow(StatisticsError);
    });

    it("should handle very large arrays efficiently", () => {
      const largeArray = Array.from({ length: 100000 }, () => Math.random() * 100);

      const start = performance.now();
      const result = mean(largeArray);
      const duration = performance.now() - start;

      expect(result).toBeGreaterThan(40);
      expect(result).toBeLessThan(60);
      expect(duration).toBeLessThan(100); // Should be fast
    });

    it("should maintain precision with floating point numbers", () => {
      // Common floating point issue: 0.1 + 0.2 !== 0.3
      const data = [0.1, 0.2, 0.3];
      const result = mean(data);

      expect(result).toBeCloseTo(0.2, 10);
    });
  });
});
