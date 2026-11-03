/**
 * Scheduler Module - Barrel Export
 *
 * Exports the consolidation scheduler for nightly memory consolidation.
 */

export {
  ConsolidationScheduler,
  SchedulerConfig,
  SchedulerStatus,
  CompletionCallback,
  createScheduler,
} from './consolidation-scheduler.js';
