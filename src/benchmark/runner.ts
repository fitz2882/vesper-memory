/**
 * Benchmark Runner
 *
 * Orchestrates the execution of all benchmark scenarios.
 * Runs A/B tests (Vesper enabled vs disabled) and compares results.
 */

import { randomUUID } from "crypto";
import type {
  BenchmarkConfig,
  BenchmarkResult,
  ScenarioResult,
  ComparisonResult,
  StatisticalComparison,
  BenchmarkSummary,
  ScenarioType,
  Winner,
} from "./types.js";
import { validateBenchmarkConfig } from "./types.js";
import { createScenario, MCPClient } from "./scenarios/index.js";
import { welchTTest, cohensD, interpretEffectSize, mean } from "./statistics.js";
import { estimateTokens } from "./metrics-collector.js";

/**
 * Benchmark runner interface
 */
export interface BenchmarkRunner {
  /** Get current configuration */
  getConfig(): BenchmarkConfig;

  /** Run all benchmarks */
  run(): Promise<BenchmarkResult>;
}

/**
 * Create a benchmark runner
 *
 * @param client - MCP client for memory operations
 * @param config - Benchmark configuration
 * @returns BenchmarkRunner instance
 */
export function createBenchmarkRunner(
  client: MCPClient,
  config: BenchmarkConfig
): BenchmarkRunner {
  // Validate config
  const validatedConfig = validateBenchmarkConfig(config);

  return {
    getConfig(): BenchmarkConfig {
      return { ...validatedConfig };
    },

    async run(): Promise<BenchmarkResult> {
      const startTime = Date.now();
      const benchmarkId = `bench-${randomUUID().slice(0, 8)}`;
      const comparisons: ComparisonResult[] = [];

      // Run each scenario
      for (const scenarioType of validatedConfig.scenarios) {
        try {
          const comparison = await runScenarioComparison(
            client,
            scenarioType,
            validatedConfig
          );
          comparisons.push(comparison);
        } catch (err) {
          console.error(
            `Error running scenario ${scenarioType}:`,
            err instanceof Error ? err.message : String(err)
          );
          // Create a placeholder comparison for failed scenario
          comparisons.push(createFailedComparison(scenarioType, err));
        }
      }

      const endTime = Date.now();

      // Calculate summary
      const summary = calculateSummary(comparisons);

      return {
        id: benchmarkId,
        startTime,
        endTime,
        config: validatedConfig,
        comparisons,
        summary,
        metadata: {
          version: "0.1.0",
          environment: process.env.NODE_ENV || "development",
          hostname: process.env.HOSTNAME,
          nodeVersion: process.version,
        },
      };
    },
  };
}

/**
 * Run a single scenario comparison (enabled vs disabled)
 */
async function runScenarioComparison(
  client: MCPClient,
  scenarioType: ScenarioType,
  config: BenchmarkConfig
): Promise<ComparisonResult> {
  const scenario = createScenario(scenarioType, client);

  // Setup scenario
  await scenario.setup();

  // Run warmup (if configured)
  for (let i = 0; i < config.warmupRuns; i++) {
    await scenario.run("vesper-enabled");
  }

  // Run measurement - Vesper enabled
  const enabledResults: ScenarioResult[] = [];
  for (let i = 0; i < config.measurementRuns; i++) {
    const result = await scenario.run("vesper-enabled");
    enabledResults.push(result);
  }

  // Aggregate enabled results
  const enabledResult = aggregateScenarioRuns(enabledResults, "vesper-enabled");

  // Run measurement - Vesper disabled
  const disabledResults: ScenarioResult[] = [];
  for (let i = 0; i < config.measurementRuns; i++) {
    const result = await scenario.run("vesper-disabled");
    disabledResults.push(result);
  }

  // Aggregate disabled results
  const disabledResult = aggregateScenarioRuns(disabledResults, "vesper-disabled");

  // Teardown
  await scenario.teardown();

  // Statistical comparison
  const statistics = comparePhasesStatistically(
    enabledResult,
    disabledResult,
    config.significanceLevel
  );

  // Determine winner
  const winner = determineWinner(statistics);

  return {
    scenarioType,
    enabledResult,
    disabledResult,
    statistics,
    winner,
  };
}

/**
 * Aggregate multiple scenario runs into a single result
 */
function aggregateScenarioRuns(
  runs: ScenarioResult[],
  phase: "vesper-enabled" | "vesper-disabled"
): ScenarioResult {
  if (runs.length === 0) {
    throw new Error("No runs to aggregate");
  }

  // Flatten all metrics
  const allMetrics = runs.flatMap((r) => r.metrics);

  // Aggregate latencies for percentiles
  const latencies = allMetrics.map((m) => m.latencyMs);
  const sortedLatencies = [...latencies].sort((a, b) => a - b);

  const latencyP50 = percentileFromSorted(sortedLatencies, 50);
  const latencyP95 = percentileFromSorted(sortedLatencies, 95);
  const latencyP99 = percentileFromSorted(sortedLatencies, 99);

  // Calculate memory hit rate
  const memoryHitRate =
    allMetrics.filter((m) => m.memoryHit).length / allMetrics.length;

  // Calculate average accuracy if available
  const accuracies = allMetrics
    .filter((m) => m.retrievalAccuracy !== undefined)
    .map((m) => m.retrievalAccuracy!);
  const avgAccuracy = accuracies.length > 0 ? mean(accuracies) : undefined;

  // Take the last run's metrics as the representative sample
  // (this matches the measurementRuns count for statistical analysis)
  const lastRun = runs[runs.length - 1];

  return {
    scenarioType: lastRun.scenarioType,
    phase,
    metrics: lastRun.metrics,
    aggregates: {
      latencyP50,
      latencyP95,
      latencyP99,
      memoryHitRate,
      avgAccuracy,
    },
    rawResponses: lastRun.rawResponses,
    errors: runs.flatMap((r) => r.errors || []),
  };
}

/**
 * Calculate percentile from sorted array
 */
function percentileFromSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Compare two scenario results statistically
 */
export function comparePhasesStatistically(
  enabledResult: ScenarioResult,
  disabledResult: ScenarioResult,
  alpha: number
): StatisticalComparison {
  const enabledLatencies = enabledResult.metrics.map((m) => m.latencyMs);
  const disabledLatencies = disabledResult.metrics.map((m) => m.latencyMs);

  // Calculate latency improvement (positive = enabled is faster)
  const enabledMean = mean(enabledLatencies);
  const disabledMean = mean(disabledLatencies);
  const latencyImprovement =
    disabledMean > 0
      ? ((disabledMean - enabledMean) / disabledMean) * 100
      : 0;

  // Calculate token savings (estimate based on response length)
  const enabledTokens = enabledResult.rawResponses
    .map((r) => estimateTokens(r))
    .reduce((a, b) => a + b, 0);
  const disabledTokens = disabledResult.rawResponses
    .map((r) => estimateTokens(r))
    .reduce((a, b) => a + b, 0);
  const tokenSavings =
    disabledTokens > 0
      ? ((disabledTokens - enabledTokens) / disabledTokens) * 100
      : 0;

  // Calculate accuracy delta
  const enabledAccuracies = enabledResult.metrics
    .filter((m) => m.retrievalAccuracy !== undefined)
    .map((m) => m.retrievalAccuracy!);
  const disabledAccuracies = disabledResult.metrics
    .filter((m) => m.retrievalAccuracy !== undefined)
    .map((m) => m.retrievalAccuracy!);

  const enabledAvgAccuracy =
    enabledAccuracies.length > 0 ? mean(enabledAccuracies) : 0;
  const disabledAvgAccuracy =
    disabledAccuracies.length > 0 ? mean(disabledAccuracies) : 0;
  const accuracyDelta = enabledAvgAccuracy - disabledAvgAccuracy;

  // Perform Welch's t-test on latencies
  let tTestResult;
  try {
    tTestResult = welchTTest(enabledLatencies, disabledLatencies, alpha);
  } catch {
    // Fallback if t-test fails (e.g., identical values)
    // Ensure degreesOfFreedom is non-negative (min 1 for valid schema)
    const df = Math.max(1, enabledLatencies.length + disabledLatencies.length - 2);
    tTestResult = {
      tStatistic: 0,
      pValue: 1,
      degreesOfFreedom: df,
      significant: false,
      alpha,
      meanDifference: enabledMean - disabledMean,
    };
  }

  // Calculate Cohen's d effect size
  let d = 0;
  let interpretation: "negligible" | "small" | "medium" | "large" = "negligible";
  try {
    d = cohensD(enabledLatencies, disabledLatencies);
    interpretation = interpretEffectSize(d) as
      | "negligible"
      | "small"
      | "medium"
      | "large";
  } catch {
    // Fallback
  }

  return {
    latencyImprovement,
    tokenSavings,
    accuracyDelta,
    tTestResult,
    effectSize: {
      cohensD: d,
      interpretation,
    },
  };
}

/**
 * Determine winner based on statistical comparison
 */
function determineWinner(stats: StatisticalComparison): Winner {
  // Primary criteria: statistical significance
  if (!stats.tTestResult.significant) {
    return "tie";
  }

  // If significant, check direction
  // Negative t-statistic means enabled < disabled (enabled is faster = better)
  // Positive latency improvement means enabled is faster
  if (stats.latencyImprovement > 0 && stats.tTestResult.tStatistic < 0) {
    return "vesper-enabled";
  }

  if (stats.latencyImprovement < 0 && stats.tTestResult.tStatistic > 0) {
    return "vesper-disabled";
  }

  // Secondary criteria: accuracy
  if (stats.accuracyDelta > 0.1) {
    return "vesper-enabled";
  }

  if (stats.accuracyDelta < -0.1) {
    return "vesper-disabled";
  }

  return "tie";
}

/**
 * Calculate summary from all comparisons
 */
function calculateSummary(comparisons: ComparisonResult[]): BenchmarkSummary {
  const vesperWins = comparisons.filter(
    (c) => c.winner === "vesper-enabled"
  ).length;
  const disabledWins = comparisons.filter(
    (c) => c.winner === "vesper-disabled"
  ).length;
  const ties = comparisons.filter((c) => c.winner === "tie").length;

  // Calculate overall improvement (average of latency improvements)
  const improvements = comparisons.map((c) => c.statistics.latencyImprovement);
  const overallImprovement =
    improvements.length > 0 ? mean(improvements) : 0;

  // Determine if overall result is statistically significant
  const significantCount = comparisons.filter(
    (c) => c.statistics.tTestResult.significant
  ).length;
  const statisticallySignificant = significantCount > comparisons.length / 2;

  return {
    totalScenarios: comparisons.length,
    vesperWins,
    disabledWins,
    ties,
    overallImprovement,
    statisticallySignificant,
  };
}

/**
 * Create a failed comparison placeholder
 */
function createFailedComparison(
  scenarioType: ScenarioType,
  error: unknown
): ComparisonResult {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const emptyResult: ScenarioResult = {
    scenarioType,
    phase: "vesper-enabled",
    metrics: [{ timestamp: Date.now(), latencyMs: 0, memoryHit: false }],
    aggregates: { latencyP50: 0, latencyP95: 0, latencyP99: 0 },
    rawResponses: [],
    errors: [errorMsg],
  };

  return {
    scenarioType,
    enabledResult: { ...emptyResult, phase: "vesper-enabled" },
    disabledResult: { ...emptyResult, phase: "vesper-disabled" },
    statistics: {
      latencyImprovement: 0,
      tokenSavings: 0,
      accuracyDelta: 0,
      tTestResult: {
        tStatistic: 0,
        pValue: 1,
        degreesOfFreedom: 0,
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
}

