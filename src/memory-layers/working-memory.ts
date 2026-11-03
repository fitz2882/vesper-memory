/**
 * Working Memory Layer - v3.0 Implementation
 *
 * Redis-based cache for last 5 conversations with 7-day TTL.
 * Simple but effective - instant recall for recent context.
 *
 * Enhanced with skill caching for lazy loading support.
 * v0.5.0: Added namespace parameter for multi-agent isolation.
 */

import { Redis } from "ioredis";
import type { FullSkill, CachedSkill } from "./skill-lazy-loading.js";

export interface WorkingMemory {
  conversationId: string;
  timestamp: Date;
  fullText: string;
  embedding?: number[];
  keyEntities: string[];
  topics: string[];
  userIntent: string;
}

export class WorkingMemoryLayer {
  private redis: Redis;
  private readonly MAX_CONVERSATIONS: number;
  private readonly TTL_DAYS = 7;

  constructor(redis: Redis, maxConversations: number = 5) {
    this.redis = redis;
    this.MAX_CONVERSATIONS = maxConversations;
  }

  async store(memory: WorkingMemory, namespace: string = "default"): Promise<void> {
    const key = `${namespace}:working:${memory.conversationId}`;
    const listKey = `${namespace}:working:recent`;
    const ttl = this.TTL_DAYS * 24 * 60 * 60;

    // Projection replays must be idempotent. This script atomically writes the
    // value, removes any prior list occurrence, promotes the ID, and returns
    // only entries evicted by the bounded recent-list policy.
    const script = `
      redis.call('SETEX', KEYS[1], ARGV[1], ARGV[2])
      redis.call('LREM', KEYS[2], 0, ARGV[3])
      redis.call('LPUSH', KEYS[2], ARGV[3])
      local evicted = redis.call('LRANGE', KEYS[2], ARGV[4], -1)
      redis.call('LTRIM', KEYS[2], 0, ARGV[4] - 1)
      return evicted
    `;
    const toEvict = (await this.redis.eval(
      script,
      2,
      key,
      listKey,
      String(ttl),
      JSON.stringify(memory),
      memory.conversationId,
      String(this.MAX_CONVERSATIONS)
    )) as string[];

    // Delete evicted conversation data
    for (const id of toEvict) {
      if (id !== memory.conversationId) {
        await this.redis.del(`${namespace}:working:${id}`);
      }
    }
  }

  async search(
    query: string,
    limit: number = 3,
    namespace: string = "default"
  ): Promise<Array<{ memory: WorkingMemory; similarity: number }>> {
    const listKey = `${namespace}:working:recent`;
    const recentIds = await this.redis.lrange(listKey, 0, this.MAX_CONVERSATIONS - 1);
    const results: Array<{ memory: WorkingMemory; similarity: number }> = [];

    const queryWords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return [];

    for (const id of recentIds) {
      const data = await this.redis.get(`${namespace}:working:${id}`);
      if (!data) continue;

      const memory = JSON.parse(data) as WorkingMemory;
      const textLower = memory.fullText.toLowerCase();
      const matchCount = queryWords.filter((word) => textLower.includes(word)).length;
      const similarity = matchCount / queryWords.length;

      if (similarity > 0.3) {
        results.push({ memory, similarity });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  async getRecent(limit: number = 5, namespace: string = "default"): Promise<WorkingMemory[]> {
    const listKey = `${namespace}:working:recent`;
    const recentIds = await this.redis.lrange(listKey, 0, limit - 1);
    const memories: WorkingMemory[] = [];

    for (const id of recentIds) {
      const data = await this.redis.get(`${namespace}:working:${id}`);
      if (data) memories.push(JSON.parse(data));
    }

    return memories;
  }

  async getAll(limit?: number, namespace: string = "default"): Promise<WorkingMemory[]> {
    return this.getRecent(limit || this.MAX_CONVERSATIONS, namespace);
  }

  async get(conversationId: string, namespace: string = "default"): Promise<WorkingMemory | null> {
    const data = await this.redis.get(`${namespace}:working:${conversationId}`);
    return data ? JSON.parse(data) : null;
  }

  async delete(conversationId: string, namespace: string = "default"): Promise<void> {
    await this.redis.del(`${namespace}:working:${conversationId}`);
    // Remove every legacy duplicate left by pre-idempotency projection replay.
    await this.redis.lrem(`${namespace}:working:recent`, 0, conversationId);
  }

  async searchByEntities(
    entities: string[],
    limit: number = 3,
    namespace: string = "default"
  ): Promise<Array<{ memory: WorkingMemory; similarity: number; matchedEntities: string[] }>> {
    const listKey = `${namespace}:working:recent`;
    const recentIds = await this.redis.lrange(listKey, 0, this.MAX_CONVERSATIONS - 1);
    const results: Array<{ memory: WorkingMemory; similarity: number; matchedEntities: string[] }> =
      [];

    for (const id of recentIds) {
      const data = await this.redis.get(`${namespace}:working:${id}`);
      if (!data) continue;

      const memory = JSON.parse(data) as WorkingMemory;
      const matchedEntities = entities.filter((entity) =>
        memory.keyEntities.some((ke) => ke.toLowerCase() === entity.toLowerCase())
      );
      const similarity = matchedEntities.length / entities.length;

      if (similarity > 0) {
        results.push({ memory, similarity, matchedEntities });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  async searchByTopics(
    topics: string[],
    limit: number = 3,
    namespace: string = "default"
  ): Promise<Array<{ memory: WorkingMemory; similarity: number; matchedTopics: string[] }>> {
    const listKey = `${namespace}:working:recent`;
    const recentIds = await this.redis.lrange(listKey, 0, this.MAX_CONVERSATIONS - 1);
    const results: Array<{ memory: WorkingMemory; similarity: number; matchedTopics: string[] }> =
      [];

    for (const id of recentIds) {
      const data = await this.redis.get(`${namespace}:working:${id}`);
      if (!data) continue;

      const memory = JSON.parse(data) as WorkingMemory;
      const matchedTopics = topics.filter((topic) =>
        memory.topics.some((t) => t.toLowerCase() === topic.toLowerCase())
      );
      const similarity = matchedTopics.length / topics.length;

      if (similarity > 0) {
        results.push({ memory, similarity, matchedTopics });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  async getStats(namespace: string = "default"): Promise<{
    totalConversations: number;
    oldestConversation: Date | null;
    newestConversation: Date | null;
    totalTextSize: number;
  }> {
    const listKey = `${namespace}:working:recent`;
    const recentIds = await this.redis.lrange(listKey, 0, this.MAX_CONVERSATIONS - 1);
    const memories: WorkingMemory[] = [];

    for (const id of recentIds) {
      const data = await this.redis.get(`${namespace}:working:${id}`);
      if (data) memories.push(JSON.parse(data));
    }

    if (memories.length === 0) {
      return {
        totalConversations: 0,
        oldestConversation: null,
        newestConversation: null,
        totalTextSize: 0,
      };
    }

    const timestamps = memories.map((m) => new Date(m.timestamp));
    const totalTextSize = memories.reduce((sum, m) => sum + m.fullText.length, 0);

    return {
      totalConversations: memories.length,
      oldestConversation: new Date(Math.min(...timestamps.map((d) => d.getTime()))),
      newestConversation: new Date(Math.max(...timestamps.map((d) => d.getTime()))),
      totalTextSize,
    };
  }

  /**
   * Clear all working memory entries for a namespace
   *
   * Uses SCAN instead of KEYS to avoid blocking Redis server.
   */
  async clear(namespace: string = "default"): Promise<void> {
    let cursor = "0";
    const keysToDelete: string[] = [];

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${namespace}:working:*`,
        "COUNT",
        100
      );
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== "0");

    const BATCH_SIZE = 100;
    for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
      const batch = keysToDelete.slice(i, i + BATCH_SIZE);
      if (batch.length > 0) {
        await this.redis.del(...batch);
      }
    }
  }

  /**
   * Cache a loaded skill in working memory
   */
  async cacheSkill(
    skill: FullSkill,
    ttl: number = 3600,
    namespace: string = "default"
  ): Promise<void> {
    const key = `${namespace}:skill:cache:${skill.id}`;
    const cached: CachedSkill = {
      skill,
      loaded_at: new Date(),
      access_count: 1,
      ttl,
    };

    await this.redis.setex(key, ttl, JSON.stringify(cached));
    console.error(`[WorkingMemory] Cached skill: ${skill.name} (${skill.id}) for ${ttl}s`);
  }

  /**
   * Get a cached skill from working memory
   */
  async getCachedSkill(
    skillId: string,
    namespace: string = "default"
  ): Promise<CachedSkill | null> {
    const key = `${namespace}:skill:cache:${skillId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    const cached = JSON.parse(data) as CachedSkill;
    cached.access_count += 1;

    const ttl = await this.redis.ttl(key);
    if (ttl > 0) {
      await this.redis.setex(key, ttl, JSON.stringify(cached));
    }

    console.error(
      `[WorkingMemory] Skill cache hit: ${cached.skill.name} ` +
        `(access count: ${cached.access_count}, TTL: ${ttl}s)`
    );

    return cached;
  }

  /**
   * Invalidate a cached skill
   */
  async invalidateSkillCache(skillId: string, namespace: string = "default"): Promise<void> {
    const key = `${namespace}:skill:cache:${skillId}`;
    await this.redis.del(key);
    console.error(`[WorkingMemory] Invalidated skill cache: ${skillId}`);
  }

  /**
   * Get all cached skill IDs
   */
  async getCachedSkillIds(namespace: string = "default"): Promise<string[]> {
    const pattern = `${namespace}:skill:cache:*`;
    let cursor = "0";
    const skillIds: string[] = [];

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;

      for (const key of keys) {
        const skillId = key.replace(`${namespace}:skill:cache:`, "");
        skillIds.push(skillId);
      }
    } while (cursor !== "0");

    return skillIds;
  }

  /**
   * Clear all cached skills for a namespace
   */
  async clearSkillCache(namespace: string = "default"): Promise<void> {
    let cursor = "0";
    const keysToDelete: string[] = [];

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${namespace}:skill:cache:*`,
        "COUNT",
        100
      );
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== "0");

    if (keysToDelete.length > 0) {
      await this.redis.del(...keysToDelete);
      console.error(`[WorkingMemory] Cleared ${keysToDelete.length} cached skills`);
    }
  }
}
