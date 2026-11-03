/**
 * Type Definitions for Scientific Benchmarks
 *
 * Comprehensive type system with runtime validation using Zod.
 * Ensures type safety at compile time and runtime.
 */

import { z } from "zod";

// =============================================================================
// Scenario Types
// =============================================================================

/**
 * Available benchmark scenario types
 */
export const ScenarioTypeEnum = z.enum([
  "context-recall",
  "cross-session",
  "skill-retrieval",
  "token-efficiency",
  "semantic-accuracy",
]);

export type ScenarioType = z.infer<typeof ScenarioTypeEnum>;

/**
 * Benchmark phases for A/B comparison
 */
export const BenchmarkPhaseEnum = z.enum(["vesper-enabled", "vesper-disabled"]);

export type BenchmarkPhase = z.infer<typeof BenchmarkPhaseEnum>;

/**
 * Winner determination
 */
export const WinnerEnum = z.enum([
  "vesper-enabled",
  "vesper-disabled",
  "tie",
]);

export type Winner = z.infer<typeof WinnerEnum>;

// =============================================================================
// Benchmark Configuration
// =============================================================================

/**
 * Configuration for running benchmarks
 */
export const BenchmarkConfigSchema = z.object({
  /** Number of warmup runs before measurement (to prime caches) */
  warmupRuns: z.number().int().min(0).max(100).default(3),

  /** Number of measurement runs (min 2 for statistical significance) */
  measurementRuns: z.number().int().min(2).max(1000).default(10),

  /** Timeout per scenario run in milliseconds (max 10 minutes) */
  timeoutMs: z.number().int().positive().max(600000).default(30000),

  /** Scenarios to run */
  scenarios: z.array(ScenarioTypeEnum).min(1),

  /** Output directory for reports */
  outputDirectory: z.string().min(1).default("./benchmark-results"),

  /** Statistical significance level (alpha) */
  significanceLevel: z.number().gt(0).lt(1).default(0.05),
});

export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;

// =============================================================================
// Metrics Snapshot
// =============================================================================

/**
 * A single metrics measurement point
 */
export const MetricsSnapshotSchema = z.object({
  /** Timestamp of measurement */
  timestamp: z.number().int().positive(),

  /** Latency in milliseconds */
  latencyMs: z.number().nonnegative(),

  /** Number of tokens used (optional) */
  tokensUsed: z.number().int().nonnegative().optional(),

  /** Retrieval accuracy 0-1 (optional) */
  retrievalAccuracy: z.number().min(0).max(1).optional(),

  /** Whether memory was hit */
  memoryHit: z.boolean(),

  /** Response quality score 0-1 (optional) */
  responseQuality: z.number().min(0).max(1).optional(),

  /** Additional metadata (optional) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;

// =============================================================================
// Aggregated Metrics
// =============================================================================

/**
 * Aggregated metrics from multiple runs
 */
export const AggregateMetricsSchema = z.object({
  /** 50th percentile latency */
  latencyP50: z.number().nonnegative(),

  /** 95th percentile latency */
  latencyP95: z.number().nonnegative(),

  /** 99th percentile latency */
  latencyP99: z.number().nonnegative(),

  /** Average tokens used (optional) */
  avgTokens: z.number().nonnegative().optional(),

  /** Average retrieval accuracy (optional) */
  avgAccuracy: z.number().min(0).max(1).optional(),

  /** Memory hit rate (optional) */
  memoryHitRate: z.number().min(0).max(1).optional(),

  /** Mean latency (optional) */
  latencyMean: z.number().nonnegative().optional(),

  /** Standard deviation (optional) */
  latencyStdDev: z.number().nonnegative().optional(),
});

export type AggregateMetrics = z.infer<typeof AggregateMetricsSchema>;

// =============================================================================
// Scenario Result
// =============================================================================

/**
 * Result from running a single scenario in one phase
 */
export const ScenarioResultSchema = z.object({
  /** Scenario type */
  scenarioType: ScenarioTypeEnum,

  /** Which phase this result is from */
  phase: BenchmarkPhaseEnum,

  /** Individual metric snapshots (at least 1) */
  metrics: z.array(MetricsSnapshotSchema).min(1),

  /** Aggregated statistics */
  aggregates: AggregateMetricsSchema,

  /** Raw responses for quality analysis */
  rawResponses: z.array(z.string()),

  /** Error messages if any */
  errors: z.array(z.string()).optional(),
});

export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;

// =============================================================================
// Statistical Results
// =============================================================================

/**
 * T-test result structure
 */
export const TTestResultSchema = z.object({
  tStatistic: z.number(),
  pValue: z.number().min(0).max(1),
  degreesOfFreedom: z.number().nonnegative(),
  significant: z.boolean(),
  alpha: z.number().gt(0).lt(1),
  meanDifference: z.number(),
});

export type TTestResult = z.infer<typeof TTestResultSchema>;

/**
 * Effect size result
 */
export const EffectSizeSchema = z.object({
  cohensD: z.number(),
  interpretation: z.enum(["negligible", "small", "medium", "large"]),
});

export type EffectSize = z.infer<typeof EffectSizeSchema>;

/**
 * Statistical comparison between enabled and disabled
 */
export const StatisticalComparisonSchema = z.object({
  /** Latency improvement percentage (positive = vesper is faster) */
  latencyImprovement: z.number(),

  /** Token savings percentage (positive = vesper uses fewer) */
  tokenSavings: z.number(),

  /** Accuracy difference (positive = vesper is more accurate) */
  accuracyDelta: z.number(),

  /** Welch's t-test result */
  tTestResult: TTestResultSchema,

  /** Cohen's d effect size */
  effectSize: EffectSizeSchema,
});

export type StatisticalComparison = z.infer<typeof StatisticalComparisonSchema>;

// =============================================================================
// Comparison Result
// =============================================================================

/**
 * Comparison between Vesper-enabled and Vesper-disabled for a scenario
 */
export const ComparisonResultSchema = z.object({
  /** Scenario type */
  scenarioType: ScenarioTypeEnum,

  /** Results with Vesper enabled */
  enabledResult: ScenarioResultSchema,

  /** Results with Vesper disabled */
  disabledResult: ScenarioResultSchema,

  /** Statistical comparison */
  statistics: StatisticalComparisonSchema,

  /** Winner of this scenario */
  winner: WinnerEnum,
});

export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;

// =============================================================================
// Benchmark Summary
// =============================================================================

/**
 * Summary of all benchmark results
 */
export const BenchmarkSummarySchema = z
  .object({
    /** Total number of scenarios run */
    totalScenarios: z.number().int().nonnegative(),

    /** Scenarios where Vesper won */
    vesperWins: z.number().int().nonnegative(),

    /** Scenarios where disabled won */
    disabledWins: z.number().int().nonnegative(),

    /** Scenarios that were ties */
    ties: z.number().int().nonnegative(),

    /** Overall improvement percentage */
    overallImprovement: z.number(),

    /** Whether results are statistically significant */
    statisticallySignificant: z.boolean(),
  })
  .refine((data) => data.vesperWins + data.disabledWins + data.ties === data.totalScenarios, {
    message: "Wins and ties must add up to total scenarios",
  });

export type BenchmarkSummary = z.infer<typeof BenchmarkSummarySchema>;

// =============================================================================
// Full Benchmark Result
// =============================================================================

/**
 * Complete benchmark result with all data
 */
export const BenchmarkResultSchema = z
  .object({
    /** Unique identifier for this benchmark run */
    id: z.string().min(1),

    /** Start timestamp */
    startTime: z.number().int().positive(),

    /** End timestamp */
    endTime: z.number().int().positive(),

    /** Configuration used */
    config: BenchmarkConfigSchema,

    /** Per-scenario comparisons */
    comparisons: z.array(ComparisonResultSchema),

    /** Summary statistics */
    summary: BenchmarkSummarySchema,

    /** Metadata */
    metadata: z.object({
      version: z.string(),
      environment: z.string(),
      hostname: z.string().optional(),
      nodeVersion: z.string().optional(),
    }),
  })
  .refine((data) => data.endTime >= data.startTime, {
    message: "End time must be after or equal to start time",
  });

export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a default benchmark configuration
 */
export function createDefaultConfig(
  overrides?: Partial<BenchmarkConfig>
): BenchmarkConfig {
  const defaults: BenchmarkConfig = {
    warmupRuns: 3,
    measurementRuns: 10,
    timeoutMs: 30000,
    scenarios: [
      "context-recall",
      "cross-session",
      "skill-retrieval",
      "token-efficiency",
      "semantic-accuracy",
    ],
    outputDirectory: "./benchmark-results",
    significanceLevel: 0.05,
  };

  if (!overrides) {
    return defaults;
  }

  return {
    ...defaults,
    ...overrides,
  };
}

/**
 * Validate and parse a benchmark configuration
 * @throws ZodError if validation fails
 */
export function validateBenchmarkConfig(input: unknown): BenchmarkConfig {
  return BenchmarkConfigSchema.parse(input);
}

/**
 * Validate and parse a benchmark result
 * @throws ZodError if validation fails
 */
export function validateBenchmarkResult(input: unknown): BenchmarkResult {
  return BenchmarkResultSchema.parse(input);
}

/**
 * Validate and parse a metrics snapshot
 * @throws ZodError if validation fails
 */
export function validateMetricsSnapshot(input: unknown): MetricsSnapshot {
  return MetricsSnapshotSchema.parse(input);
}

// =============================================================================
// Scenario Descriptions (for documentation and reports)
// =============================================================================

/**
 * Human-readable descriptions of each scenario
 */
export const SCENARIO_DESCRIPTIONS: Record<ScenarioType, string> = {
  "context-recall":
    "Tests ability to recall facts from previous conversations within the same session.",
  "cross-session":
    "Tests persistence of context across multiple conversation sessions.",
  "skill-retrieval":
    "Tests retrieval of learned procedural knowledge (how to do things).",
  "token-efficiency":
    "Measures token usage reduction from avoiding repeated context.",
  "semantic-accuracy":
    "Tests semantic search accuracy for finding relevant memories.",
};

/**
 * Get description for a scenario
 */
export function getScenarioDescription(scenario: ScenarioType): string {
  return SCENARIO_DESCRIPTIONS[scenario];
}
