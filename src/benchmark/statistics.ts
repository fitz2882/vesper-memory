/**
 * Statistical Functions for Scientific Benchmarks
 *
 * Pure functions for calculating:
 * - Descriptive statistics (mean, median, percentile)
 * - Dispersion measures (variance, standard deviation)
 * - Confidence intervals
 * - Hypothesis testing (Welch's t-test)
 * - Effect size (Cohen's d)
 *
 * All functions are designed to be accurate, efficient, and safe.
 */

/**
 * Custom error class for statistics-related errors
 */
export class StatisticsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatisticsError";
  }
}

/**
 * Validate that array contains only finite numbers
 */
function validateArray(arr: number[], name: string): void {
  if (!Array.isArray(arr)) {
    throw new StatisticsError(`${name} must be an array`);
  }
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) {
      throw new StatisticsError(
        `${name} contains non-finite value at index ${i}: ${arr[i]}`
      );
    }
  }
}

/**
 * Calculate arithmetic mean of an array
 *
 * @param values - Array of numbers
 * @returns The arithmetic mean
 * @throws StatisticsError if array is empty or contains non-finite values
 */
export function mean(values: number[]): number {
  validateArray(values, "Values array");

  if (values.length === 0) {
    throw new StatisticsError("Cannot calculate mean of empty array");
  }

  // Use Kahan summation for better numerical precision
  let sum = 0;
  let compensation = 0;

  for (const value of values) {
    const y = value - compensation;
    const t = sum + y;
    compensation = t - sum - y;
    sum = t;
  }

  return sum / values.length;
}

/**
 * Calculate median of an array
 *
 * @param values - Array of numbers
 * @returns The median value
 * @throws StatisticsError if array is empty
 */
export function median(values: number[]): number {
  validateArray(values, "Values array");

  if (values.length === 0) {
    throw new StatisticsError("Cannot calculate median of empty array");
  }

  // Sort a copy to avoid mutating original
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

/**
 * Calculate percentile using linear interpolation
 *
 * @param values - Array of numbers
 * @param p - Percentile to calculate (0-100)
 * @returns The percentile value
 * @throws StatisticsError if array is empty or percentile is out of range
 */
export function percentile(values: number[], p: number): number {
  validateArray(values, "Values array");

  if (values.length === 0) {
    throw new StatisticsError("Cannot calculate percentile of empty array");
  }

  if (p < 0 || p > 100) {
    throw new StatisticsError("Percentile must be between 0 and 100");
  }

  // Sort a copy to avoid mutating original
  const sorted = [...values].sort((a, b) => a - b);

  if (p === 0) {
    return sorted[0];
  }

  if (p === 100) {
    return sorted[sorted.length - 1];
  }

  // Linear interpolation
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  if (lower === upper) {
    return sorted[lower];
  }

  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Calculate variance of an array
 *
 * @param values - Array of numbers
 * @param sample - If true, calculate sample variance (n-1 denominator); default is population variance
 * @returns The variance
 * @throws StatisticsError if array is empty or too small for sample variance
 */
export function variance(values: number[], sample: boolean = false): number {
  validateArray(values, "Values array");

  if (values.length === 0) {
    throw new StatisticsError("Cannot calculate variance of empty array");
  }

  if (sample && values.length < 2) {
    throw new StatisticsError("Sample variance requires at least 2 elements");
  }

  const avg = mean(values);
  let sumSquaredDiff = 0;

  for (const value of values) {
    sumSquaredDiff += (value - avg) ** 2;
  }

  const denominator = sample ? values.length - 1 : values.length;
  return sumSquaredDiff / denominator;
}

/**
 * Calculate standard deviation of an array
 *
 * @param values - Array of numbers
 * @param sample - If true, calculate sample standard deviation
 * @returns The standard deviation
 * @throws StatisticsError if array is empty or too small for sample SD
 */
export function standardDeviation(
  values: number[],
  sample: boolean = false
): number {
  return Math.sqrt(variance(values, sample));
}

/**
 * Result of confidence interval calculation
 */
export interface ConfidenceIntervalResult {
  mean: number;
  lower: number;
  upper: number;
  confidenceLevel: number;
  marginOfError: number;
  standardError: number;
}

/**
 * Calculate confidence interval using t-distribution
 *
 * @param values - Array of sample values
 * @param confidenceLevel - Confidence level (0 < level < 1), e.g., 0.95 for 95% CI
 * @returns ConfidenceIntervalResult with mean, lower, upper bounds
 * @throws StatisticsError if array has less than 2 elements or invalid confidence level
 */
export function confidenceInterval(
  values: number[],
  confidenceLevel: number
): ConfidenceIntervalResult {
  validateArray(values, "Values array");

  if (values.length < 2) {
    throw new StatisticsError(
      "Confidence interval requires at least 2 elements"
    );
  }

  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new StatisticsError("Confidence level must be between 0 and 1 (exclusive)");
  }

  const n = values.length;
  const avg = mean(values);
  const sd = standardDeviation(values, true); // Sample SD
  const standardError = sd / Math.sqrt(n);

  // Get t-critical value for given confidence level and degrees of freedom
  const alpha = 1 - confidenceLevel;
  const df = n - 1;
  const tCritical = tDistributionInverse(1 - alpha / 2, df);

  const marginOfError = tCritical * standardError;

  return {
    mean: avg,
    lower: avg - marginOfError,
    upper: avg + marginOfError,
    confidenceLevel,
    marginOfError,
    standardError,
  };
}

/**
 * Result of Welch's t-test
 */
export interface WelchTTestResult {
  tStatistic: number;
  pValue: number;
  degreesOfFreedom: number;
  significant: boolean;
  alpha: number;
  meanDifference: number;
}

/**
 * Perform Welch's t-test for two independent samples
 *
 * Welch's t-test is more robust than Student's t-test when
 * variances are unequal between groups.
 *
 * @param groupA - First sample
 * @param groupB - Second sample
 * @param alpha - Significance level (default 0.05)
 * @returns WelchTTestResult with test statistics and significance
 * @throws StatisticsError if either group has less than 2 elements
 */
export function welchTTest(
  groupA: number[],
  groupB: number[],
  alpha: number = 0.05
): WelchTTestResult {
  validateArray(groupA, "Group A");
  validateArray(groupB, "Group B");

  if (groupA.length < 2) {
    throw new StatisticsError("Group A must have at least 2 elements");
  }

  if (groupB.length < 2) {
    throw new StatisticsError("Group B must have at least 2 elements");
  }

  const n1 = groupA.length;
  const n2 = groupB.length;
  const mean1 = mean(groupA);
  const mean2 = mean(groupB);
  const var1 = variance(groupA, true);
  const var2 = variance(groupB, true);

  // Handle identical groups (zero variance)
  if (var1 === 0 && var2 === 0) {
    return {
      tStatistic: mean1 === mean2 ? 0 : mean1 < mean2 ? -Infinity : Infinity,
      pValue: mean1 === mean2 ? 1 : 0,
      degreesOfFreedom: n1 + n2 - 2,
      significant: mean1 !== mean2,
      alpha,
      meanDifference: mean1 - mean2,
    };
  }

  // Calculate t-statistic
  const se1 = var1 / n1;
  const se2 = var2 / n2;
  const tStatistic = (mean1 - mean2) / Math.sqrt(se1 + se2);

  // Welch-Satterthwaite degrees of freedom
  const df =
    (se1 + se2) ** 2 / (se1 ** 2 / (n1 - 1) + se2 ** 2 / (n2 - 1));

  // Calculate p-value (two-tailed)
  const pValue = 2 * (1 - tDistributionCDF(Math.abs(tStatistic), df));

  return {
    tStatistic,
    pValue,
    degreesOfFreedom: df,
    significant: pValue < alpha,
    alpha,
    meanDifference: mean1 - mean2,
  };
}

/**
 * Calculate Cohen's d effect size
 *
 * Cohen's d measures the standardized difference between two means.
 * Guidelines: |d| < 0.2 negligible, 0.2-0.5 small, 0.5-0.8 medium, > 0.8 large
 *
 * @param groupA - First sample
 * @param groupB - Second sample
 * @returns Cohen's d (positive if A > B, negative if A < B)
 * @throws StatisticsError if either group has less than 2 elements
 */
export function cohensD(groupA: number[], groupB: number[]): number {
  validateArray(groupA, "Group A");
  validateArray(groupB, "Group B");

  if (groupA.length < 2) {
    throw new StatisticsError("Group A must have at least 2 elements");
  }

  if (groupB.length < 2) {
    throw new StatisticsError("Group B must have at least 2 elements");
  }

  const mean1 = mean(groupA);
  const mean2 = mean(groupB);
  const n1 = groupA.length;
  const n2 = groupB.length;
  const var1 = variance(groupA, true);
  const var2 = variance(groupB, true);

  // Pooled standard deviation
  const pooledVar = ((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2);
  const pooledSD = Math.sqrt(pooledVar);

  if (pooledSD === 0) {
    return 0; // Identical groups
  }

  return (mean1 - mean2) / pooledSD;
}

/**
 * Interpret Cohen's d effect size
 *
 * @param d - Cohen's d value
 * @returns String interpretation
 */
export function interpretEffectSize(d: number): string {
  const absD = Math.abs(d);

  if (absD < 0.2) {
    return "negligible";
  } else if (absD < 0.5) {
    return "small";
  } else if (absD < 0.8) {
    return "medium";
  } else {
    return "large";
  }
}

// =============================================================================
// Internal helper functions for t-distribution
// =============================================================================

/**
 * Approximate the inverse of the t-distribution CDF
 * Used for calculating t-critical values for confidence intervals
 *
 * Uses the approximation from Abramowitz and Stegun (1964)
 */
function tDistributionInverse(p: number, df: number): number {
  // For large df, use normal approximation
  if (df > 100) {
    return normalInverse(p);
  }

  // Use iterative refinement
  let x = normalInverse(p);
  for (let i = 0; i < 10; i++) {
    const cdf = tDistributionCDF(x, df);
    const pdf = tDistributionPDF(x, df);
    x = x - (cdf - p) / pdf;
  }
  return x;
}

/**
 * Approximate the CDF of the t-distribution
 * Used for calculating p-values
 */
function tDistributionCDF(t: number, df: number): number {
  // For large df, use normal approximation
  if (df > 100) {
    return normalCDF(t);
  }

  // Use the regularized incomplete beta function
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;

  if (t >= 0) {
    return 1 - 0.5 * incompleteBeta(x, a, b);
  } else {
    return 0.5 * incompleteBeta(x, a, b);
  }
}

/**
 * PDF of the t-distribution
 */
function tDistributionPDF(t: number, df: number): number {
  const numerator = gamma((df + 1) / 2);
  const denominator = Math.sqrt(df * Math.PI) * gamma(df / 2);
  const base = 1 + (t * t) / df;
  return (numerator / denominator) * Math.pow(base, -(df + 1) / 2);
}

/**
 * Approximate the inverse of the standard normal CDF
 * Uses the Abramowitz and Stegun approximation
 */
function normalInverse(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.383577518672690e2,
    -3.066479806614716e1,
    2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838e0,
    -2.549732539343734e0,
    4.374664141464968e0,
    2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996e0,
    3.754408661907416e0,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      )
    );
  }
}

/**
 * Standard normal CDF approximation
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1 / (1 + p * x);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

/**
 * Gamma function approximation using Stirling's formula with corrections
 */
function gamma(z: number): number {
  if (z <= 0 && Number.isInteger(z)) {
    return Infinity;
  }

  // Use reflection formula for z < 0.5
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  }

  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }

  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/**
 * Regularized incomplete beta function approximation
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x === 0) return 0;
  if (x === 1) return 1;

  // Use continued fraction expansion
  const maxIterations = 200;
  const epsilon = 1e-10;

  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Lentz's algorithm for continued fraction
  let f = 1;
  let c = 1;
  let d = 0;

  for (let i = 0; i <= maxIterations; i++) {
    const m = Math.floor(i / 2);
    let numerator: number;

    if (i === 0) {
      numerator = 1;
    } else if (i % 2 === 0) {
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    } else {
      numerator =
        -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }

    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;

    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;

    const delta = c * d;
    f *= delta;

    if (Math.abs(delta - 1) < epsilon) {
      return front * (f - 1);
    }
  }

  return front * (f - 1);
}

/**
 * Log gamma function
 */
function logGamma(z: number): number {
  const c = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];

  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;

  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += c[j] / y;
  }

  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
