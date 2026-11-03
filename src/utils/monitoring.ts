/**
 * Monitoring & Logging - v3.0
 *
 * Track latency, accuracy, cache hit rates.
 */

export interface PerformanceMetrics {
  p50: number;
  p95: number;
  p99: number;
}

export class PerformanceMonitor {
  private latencies: number[] = [];
  private cacheHits: number = 0;
  private cacheMisses: number = 0;

  recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 1000) {
      this.latencies.shift();
    }
  }

  recordCacheHit(): void {
    this.cacheHits++;
  }

  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  getMetrics(): {
    latency: PerformanceMetrics;
    cacheHitRate: number;
    totalCacheRequests: number;
    totalRequests: number;
  } {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? this.cacheHits / total : 0;

    return {
      latency: { p50, p95, p99 },
      cacheHitRate: hitRate,
      totalCacheRequests: total,
      totalRequests: this.latencies.length,
    };
  }

  reset(): void {
    this.latencies = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}
