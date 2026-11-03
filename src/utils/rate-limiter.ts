/**
 * Rate Limiting Module
 *
 * Token bucket implementation for preventing DoS attacks and abuse.
 * Limits requests per user per time window.
 *
 * Security Features:
 * - Per-user rate limiting
 * - Configurable limits per operation type
 * - Redis-backed for distributed systems
 * - Automatic token refill
 */

import { Redis } from 'ioredis';
import { validateUserId } from './validation.js';

/**
 * Rate limit configuration per operation type
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Time until window resets (seconds) */
  resetIn: number;
  /** Total limit */
  limit: number;
}

/**
 * Default rate limits per operation
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  store_memory: {
    maxRequests: 100,
    windowSeconds: 60, // 100 requests per minute
  },
  retrieve_memory: {
    maxRequests: 300,
    windowSeconds: 60, // 300 requests per minute
  },
  list_recent: {
    maxRequests: 60,
    windowSeconds: 60, // 60 requests per minute
  },
  get_stats: {
    maxRequests: 30,
    windowSeconds: 60, // 30 requests per minute
  },
};

/**
 * Token Bucket Rate Limiter
 *
 * Implements the token bucket algorithm using Redis for distributed rate limiting.
 * Each user has a separate bucket per operation type.
 */
export class RateLimiter {
  private redis: Redis;
  private limits: Record<string, RateLimitConfig>;

  constructor(redis: Redis, limits: Record<string, RateLimitConfig> = DEFAULT_RATE_LIMITS) {
    this.redis = redis;
    this.limits = limits;
  }

  /**
   * Check if a request is allowed under rate limits
   *
   * @param userId - User identifier
   * @param operation - Operation name (e.g., "store_memory")
   * @returns Rate limit result with allowed status and metadata
   */
  async checkLimit(userId: string, operation: string): Promise<RateLimitResult> {
    // Validate user ID to prevent injection attacks
    const sanitizedUserId = validateUserId(userId);

    // Get rate limit config for this operation
    const config = this.limits[operation];
    if (!config) {
      throw new Error(`No rate limit configured for operation: ${operation}`);
    }

    const key = `ratelimit:${sanitizedUserId}:${operation}`;
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;

    // Use Redis pipeline for atomic operations
    const pipeline = this.redis.pipeline();

    // Add current timestamp to sorted set with unique member
    // Use timestamp + random component to ensure uniqueness
    const member = `${now}:${Math.random().toString(36).substr(2, 9)}`;
    pipeline.zadd(key, now, member);

    // Remove timestamps outside the current window
    const windowStart = now - windowMs;
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Count requests in current window
    pipeline.zcard(key);

    // Set expiration to prevent memory leaks
    pipeline.expire(key, config.windowSeconds * 2);

    const results = await pipeline.exec();

    if (!results) {
      throw new Error('Redis pipeline failed');
    }

    // Extract count from pipeline results
    // results[2] is the zcard result: [error, count]
    const count = results[2][1] as number;

    const allowed = count <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - count);

    // Calculate reset time (time until oldest request expires)
    let resetIn = config.windowSeconds;
    if (count > 0) {
      const oldestTimestamps = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
      if (oldestTimestamps.length >= 2) {
        const oldestTime = parseInt(oldestTimestamps[1]);
        const expiresAt = oldestTime + windowMs;
        resetIn = Math.ceil((expiresAt - now) / 1000);
      }
    }

    return {
      allowed,
      remaining,
      resetIn: Math.max(0, resetIn),
      limit: config.maxRequests,
    };
  }

  /**
   * Reset rate limit for a user and operation
   *
   * Useful for testing or administrative overrides.
   *
   * @param userId - User identifier
   * @param operation - Operation name
   */
  async resetLimit(userId: string, operation: string): Promise<void> {
    const sanitizedUserId = validateUserId(userId);
    const key = `ratelimit:${sanitizedUserId}:${operation}`;
    await this.redis.del(key);
  }

  /**
   * Get current usage for a user and operation
   *
   * @param userId - User identifier
   * @param operation - Operation name
   * @returns Current request count in window
   */
  async getUsage(userId: string, operation: string): Promise<number> {
    const sanitizedUserId = validateUserId(userId);
    const config = this.limits[operation];
    if (!config) {
      throw new Error(`No rate limit configured for operation: ${operation}`);
    }

    const key = `ratelimit:${sanitizedUserId}:${operation}`;
    const now = Date.now();
    const windowStart = now - (config.windowSeconds * 1000);

    // Count requests in current window
    const count = await this.redis.zcount(key, windowStart, now);
    return count;
  }

  /**
   * Update rate limit configuration
   *
   * @param operation - Operation name
   * @param config - New rate limit configuration
   */
  setLimit(operation: string, config: RateLimitConfig): void {
    this.limits[operation] = config;
  }

  /**
   * Get rate limit configuration for an operation
   *
   * @param operation - Operation name
   * @returns Rate limit configuration
   */
  getLimit(operation: string): RateLimitConfig | undefined {
    return this.limits[operation];
  }
}

/**
 * Factory function to create a rate limiter
 *
 * @param redis - Redis client
 * @param limits - Optional custom rate limits
 */
export function createRateLimiter(
  redis: Redis,
  limits?: Record<string, RateLimitConfig>
): RateLimiter {
  return new RateLimiter(redis, limits);
}
