/**
 * Scientific Benchmark System for Vesper Memory
 *
 * Main entry point for the benchmark module.
 * Provides A/B testing with statistical analysis.
 */

// Types
export {
  BenchmarkConfigSchema,
  BenchmarkResultSchema,
  MetricsSnapshotSchema,
  ScenarioResultSchema,
  ComparisonResultSchema,
  validateBenchmarkConfig,
  validateBenchmarkResult,
  validateMetricsSnapshot,
  createDefaultConfig,
  SCENARIO_DESCRIPTIONS,
  getScenarioDescription,
} from "./types.js";

export type {
  BenchmarkConfig,
  BenchmarkResult,
  MetricsSnapshot,
  ScenarioResult,
  ComparisonResult,
  AggregateMetrics,
  StatisticalComparison,
  BenchmarkSummary,
  TTestResult,
  EffectSize,
  ScenarioType,
  BenchmarkPhase,
  Winner,
} from "./types.js";

// Statistics
export {
  mean,
  median,
  percentile,
  variance,
  standardDeviation,
  confidenceInterval,
  welchTTest,
  cohensD,
  interpretEffectSize,
  StatisticsError,
} from "./statistics.js";

export type {
  ConfidenceIntervalResult,
  WelchTTestResult,
} from "./statistics.js";

// Metrics Collector
export {
  createMetricsCollector,
  measureLatency,
  estimateTokens,
  evaluateResponseQuality,
  aggregateMetrics,
  MetricsCollectorError,
} from "./metrics-collector.js";

export type {
  MetricsCollector,
  LatencyMeasurement,
  ContentType,
  QualityEvaluationOptions,
} from "./metrics-collector.js";

// Scenarios
export {
  createScenario,
  createContextRecallScenario,
  CONTEXT_RECALL_TEST_DATA,
} from "./scenarios/index.js";

export type {
  BenchmarkScenario,
  MCPClient,
  ContextRecallScenario,
  ContextRecallTestCase,
} from "./scenarios/index.js";

// Runner
export {
  createBenchmarkRunner,
  comparePhasesStatistically,
} from "./runner.js";

export type { BenchmarkRunner } from "./runner.js";

// Report Generator
export {
  generateMarkdownReport,
  formatNumber,
  formatPercentage,
  formatDuration,
  generateSummaryTable,
  generateComparisonSection,
} from "./report-generator.js";
