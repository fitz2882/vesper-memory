/**
 * Consolidation Scheduler
 *
 * Simple setInterval-based scheduler for nightly consolidation runs.
 * Default schedule: 3 AM local time.
 *
 * Features:
 * - Configurable schedule time
 * - Manual trigger capability
 * - Status reporting
 * - Graceful shutdown
 * - Error handling with callback notifications
 */

import { ConsolidationPipeline, ConsolidationStats } from '../consolidation/pipeline.js';

/**
 * Scheduler configuration options
 */
export interface SchedulerConfig {
  /** Hour to run consolidation (0-23, default: 3) */
  scheduleHour?: number;
  /** Minute to run consolidation (0-59, default: 0) */
  scheduleMinute?: number;
  /** Timezone for scheduling (default: local timezone) */
  timezone?: string;
}

/**
 * Scheduler status information
 */
export interface SchedulerStatus {
  /** Whether scheduler is currently running */
  isRunning: boolean;
  /** Configured schedule hour */
  scheduleHour: number;
  /** Configured schedule minute */
  scheduleMinute: number;
  /** Time of last consolidation run */
  lastRunTime: Date | null;
  /** Statistics from last run */
  lastRunStats: ConsolidationStats | null;
  /** Next scheduled run time */
  nextRunTime: Date;
  /** Total number of runs completed */
  runCount: number;
}

/**
 * Completion callback type
 * Called after each consolidation run with stats or error
 */
export type CompletionCallback = (
  stats: ConsolidationStats | null,
  error: Error | null
) => void;

/**
 * Consolidation Scheduler
 *
 * Manages scheduled nightly consolidation runs using setInterval.
 * Calculates delay until next scheduled time and re-schedules after each run.
 */
export class ConsolidationScheduler {
  private pipeline: ConsolidationPipeline;
  private config: Required<Omit<SchedulerConfig, 'timezone'>> & { timezone?: string };
  private callback?: CompletionCallback;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private lastRunTime: Date | null = null;
  private lastRunStats: ConsolidationStats | null = null;
  private runCount = 0;

  /**
   * Create a new consolidation scheduler
   *
   * @param pipeline - ConsolidationPipeline instance to run
   * @param config - Optional scheduler configuration
   * @param callback - Optional completion callback
   */
  constructor(
    pipeline: ConsolidationPipeline,
    config: SchedulerConfig = {},
    callback?: CompletionCallback
  ) {
    this.pipeline = pipeline;
    this.config = {
      scheduleHour: config.scheduleHour ?? 3,
      scheduleMinute: config.scheduleMinute ?? 0,
      timezone: config.timezone,
    };
    this.callback = callback;
  }

  /**
   * Calculate the next scheduled run time
   *
   * @returns Date object for next scheduled run
   */
  getNextRunTime(): Date {
    const now = new Date();
    const next = new Date(now);

    next.setHours(this.config.scheduleHour, this.config.scheduleMinute, 0, 0);

    // If we're past today's schedule time, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  /**
   * Get milliseconds until next scheduled run
   *
   * @returns Milliseconds until next run
   */
  getMsUntilNextRun(): number {
    const nextRun = this.getNextRunTime();
    const now = new Date();
    return nextRun.getTime() - now.getTime();
  }

  /**
   * Start the scheduler
   *
   * Schedules the next consolidation run based on configured time.
   * No-op if already running.
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.scheduleNextRun();

    console.error(
      `[SCHEDULER] Started. Next run at ${this.getNextRunTime().toISOString()}`
    );
  }

  /**
   * Stop the scheduler
   *
   * Cancels any pending scheduled run.
   * Safe to call even if not running.
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isRunning = false;

    console.error('[SCHEDULER] Stopped');
  }

  /**
   * Run consolidation immediately (manual trigger)
   *
   * Does not affect scheduled runs.
   *
   * @returns Promise resolving to consolidation statistics
   * @throws Error if consolidation fails
   */
  async runNow(): Promise<ConsolidationStats> {
    console.error('[SCHEDULER] Manual consolidation triggered');

    try {
      const stats = await this.pipeline.consolidate();

      this.lastRunTime = new Date();
      this.lastRunStats = stats;
      this.runCount++;

      if (this.callback) {
        this.callback(stats, null);
      }

      console.error(
        `[SCHEDULER] Consolidation complete. Processed ${stats.memoriesProcessed} memories in ${stats.duration}ms`
      );

      return stats;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (this.callback) {
        this.callback(null, err);
      }

      console.error(`[SCHEDULER] Consolidation failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get current scheduler status
   *
   * @returns SchedulerStatus object
   */
  getStatus(): SchedulerStatus {
    return {
      isRunning: this.isRunning,
      scheduleHour: this.config.scheduleHour,
      scheduleMinute: this.config.scheduleMinute,
      lastRunTime: this.lastRunTime,
      lastRunStats: this.lastRunStats,
      nextRunTime: this.getNextRunTime(),
      runCount: this.runCount,
    };
  }

  /**
   * Schedule the next consolidation run
   * @private
   */
  private scheduleNextRun(): void {
    const msUntilRun = this.getMsUntilNextRun();

    this.timer = setTimeout(async () => {
      if (!this.isRunning) {
        return;
      }

      try {
        await this.runNow();
      } catch (error) {
        // Error already logged and callback called in runNow
        // Continue scheduling next run
      }

      // Schedule next run for tomorrow
      if (this.isRunning) {
        this.scheduleNextRun();
      }
    }, msUntilRun);
  }
}

/**
 * Factory function to create a scheduler
 *
 * @param pipeline - ConsolidationPipeline instance
 * @param config - Optional scheduler configuration
 * @param callback - Optional completion callback
 * @returns ConsolidationScheduler instance
 */
export function createScheduler(
  pipeline: ConsolidationPipeline,
  config?: SchedulerConfig,
  callback?: CompletionCallback
): ConsolidationScheduler {
  return new ConsolidationScheduler(pipeline, config, callback);
}
