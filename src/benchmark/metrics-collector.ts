/**
 * Metrics Collector for Scientific Benchmarks
 *
 * Real-time collection and aggregation of benchmark metrics.
 * Provides accurate latency measurement, token estimation, and quality evaluation.
 */

import type { MetricsSnapshot, AggregateMetrics } from "./types.js";
import { mean, median, percentile, standardDeviation } from "./statistics.js";

/**
 * Error class for metrics collection errors
 */
export class MetricsCollectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricsCollectorError";
  }
}

/**
 * Metrics collector interface
 */
export interface MetricsCollector {
  /** Record a new metrics snapshot */
  record(snapshot: MetricsSnapshot): void;

  /** Get all recorded metrics */
  getMetrics(): MetricsSnapshot[];

  /** Get count of recorded metrics */
  getCount(): number;

  /** Clear all recorded metrics */
  clear(): void;

  /** Aggregate all recorded metrics into summary statistics */
  aggregate(): AggregateMetrics;
}

/**
 * Create a new metrics collector
 */
export function createMetricsCollector(): MetricsCollector {
  const metrics: MetricsSnapshot[] = [];

  return {
    record(snapshot: MetricsSnapshot): void {
      metrics.push(snapshot);
    },

    getMetrics(): MetricsSnapshot[] {
      // Return a copy to maintain immutability
      return [...metrics];
    },

    getCount(): number {
      return metrics.length;
    },

    clear(): void {
      metrics.length = 0;
    },

    aggregate(): AggregateMetrics {
      if (metrics.length === 0) {
        throw new MetricsCollectorError("Cannot aggregate empty metrics");
      }

      return aggregateMetrics(metrics);
    },
  };
}

/**
 * Result of latency measurement
 */
export interface LatencyMeasurement<T> {
  result: T;
  latencyMs: number;
}

/**
 * Measure the latency of a function execution
 *
 * @param fn - Function to measure (can be sync or async)
 * @returns Object containing the result and latency in milliseconds
 */
export async function measureLatency<T>(
  fn: () => T | Promise<T>
): Promise<LatencyMeasurement<T>> {
  const start = performance.now();

  try {
    const result = await fn();
    const latencyMs = performance.now() - start;

    return { result, latencyMs };
  } catch (error) {
    // Re-throw to propagate errors
    throw error;
  }
}

/**
 * Content type hint for token estimation
 */
export type ContentType = "prose" | "code" | "mixed";

/**
 * Estimate the number of tokens in a text string
 *
 * Uses a heuristic approximation:
 * - English prose: ~4 characters per token
 * - Code: ~3 characters per token (more punctuation)
 * - Mixed: ~3.5 characters per token
 *
 * @param text - The text to estimate tokens for
 * @param contentType - Optional hint about content type
 * @returns Estimated token count
 */
export function estimateTokens(
  text: string,
  contentType: ContentType = "mixed"
): number {
  if (!text || text.trim().length === 0) {
    return 0;
  }

  // Clean up text
  const cleanText = text.trim();

  // Characters per token varies by content type
  let charsPerToken: number;
  switch (contentType) {
    case "code":
      charsPerToken = 3.0; // Code has more special chars = more tokens
      break;
    case "prose":
      charsPerToken = 4.0; // English prose averages ~4 chars per token
      break;
    case "mixed":
    default:
      charsPerToken = 3.5;
  }

  // Basic estimation
  const basicEstimate = cleanText.length / charsPerToken;

  // Adjust for word boundaries (whitespace indicates token boundaries)
  const wordCount = cleanText.split(/\s+/).filter((w) => w.length > 0).length;

  // Adjust for punctuation (often separate tokens)
  const punctuationCount = (cleanText.match(/[.,!?;:'"()\[\]{}]/g) || []).length;

  // Combine estimates with weights
  const weightedEstimate =
    basicEstimate * 0.6 + wordCount * 0.3 + punctuationCount * 0.1;

  return Math.round(weightedEstimate);
}

/**
 * Options for response quality evaluation
 */
export interface QualityEvaluationOptions {
  /** Evaluation mode: 'similarity' (default) or 'keywords' */
  mode?: "similarity" | "keywords";
  /** Minimum similarity threshold (0-1) */
  minThreshold?: number;
}

/**
 * Evaluate the quality of a response against expected content
 *
 * @param actual - The actual response
 * @param expected - Expected response (string) or keywords (array)
 * @param options - Evaluation options
 * @returns Quality score from 0.0 to 1.0
 */
export function evaluateResponseQuality(
  actual: string,
  expected: string | string[],
  options: QualityEvaluationOptions = {}
): number {
  const { mode = "similarity" } = options;

  if (!actual || actual.trim().length === 0) {
    return 0.0;
  }

  const actualLower = actual.toLowerCase().trim();

  // Keyword matching mode
  if (mode === "keywords" && Array.isArray(expected)) {
    const keywordsFound = expected.filter((keyword) =>
      actualLower.includes(keyword.toLowerCase())
    ).length;
    return keywordsFound / expected.length;
  }

  // Similarity mode
  const expectedStr = Array.isArray(expected) ? expected.join(" ") : expected;
  const expectedLower = expectedStr.toLowerCase().trim();

  // Exact match
  if (actualLower === expectedLower) {
    return 1.0;
  }

  // Calculate word overlap (Jaccard-like similarity)
  const actualWords = new Set(
    actualLower.split(/\s+/).filter((w) => w.length > 2)
  );
  const expectedWords = new Set(
    expectedLower.split(/\s+/).filter((w) => w.length > 2)
  );

  if (actualWords.size === 0 || expectedWords.size === 0) {
    return actualWords.size === expectedWords.size ? 1.0 : 0.0;
  }

  // Count intersection
  let intersection = 0;
  for (const word of actualWords) {
    if (expectedWords.has(word)) {
      intersection++;
    }
  }

  // Jaccard similarity: intersection / union
  const union = actualWords.size + expectedWords.size - intersection;
  const jaccard = intersection / union;

  // Also check for substring inclusion (important for factual responses)
  let substringBonus = 0;
  if (actualLower.includes(expectedLower) || expectedLower.includes(actualLower)) {
    substringBonus = 0.3;
  }

  // Combine metrics
  return Math.min(1.0, jaccard + substringBonus);
}

/**
 * Aggregate an array of metrics snapshots into summary statistics
 *
 * @param metrics - Array of metrics snapshots
 * @returns Aggregated metrics
 * @throws MetricsCollectorError if metrics array is empty
 */
export function aggregateMetrics(metrics: MetricsSnapshot[]): AggregateMetrics {
  if (metrics.length === 0) {
    throw new MetricsCollectorError("Cannot aggregate empty metrics");
  }

  // Extract latencies
  const latencies = metrics.map((m) => m.latencyMs);

  // Calculate latency percentiles
  const latencyP50 = percentile(latencies, 50);
  const latencyP95 = percentile(latencies, 95);
  const latencyP99 = percentile(latencies, 99);
  const latencyMean = mean(latencies);
  const latencyStdDev =
    latencies.length >= 2 ? standardDeviation(latencies, true) : 0;

  // Calculate memory hit rate
  const memoryHits = metrics.filter((m) => m.memoryHit).length;
  const memoryHitRate = memoryHits / metrics.length;

  // Calculate average tokens if available
  const tokensValues = metrics
    .filter((m) => m.tokensUsed !== undefined)
    .map((m) => m.tokensUsed!);
  const avgTokens =
    tokensValues.length > 0 ? Math.round(mean(tokensValues)) : undefined;

  // Calculate average accuracy if available
  const accuracyValues = metrics
    .filter((m) => m.retrievalAccuracy !== undefined)
    .map((m) => m.retrievalAccuracy!);
  const avgAccuracy =
    accuracyValues.length > 0 ? mean(accuracyValues) : undefined;

  return {
    latencyP50,
    latencyP95,
    latencyP99,
    latencyMean,
    latencyStdDev,
    memoryHitRate,
    avgTokens,
    avgAccuracy,
  };
}
