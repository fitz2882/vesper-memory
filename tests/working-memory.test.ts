/**
 * Tests for working memory layer
 * Verifies Redis-based storage, retrieval, and auto-eviction
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Redis } from "ioredis";
import { WorkingMemoryLayer } from "../src/memory-layers/working-memory.js";

describe("WorkingMemoryLayer", () => {
  let redis: Redis;
  let store: WorkingMemoryLayer;

  beforeEach(async () => {
    // Create Redis connection using database 1 for test isolation
    redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
      db: 1, // Use database 1 for working-memory tests
    });

    // Create store with max 3 conversations for testing
    store = new WorkingMemoryLayer(redis, 3);

    // Clear before each test
    await store.clear();
  });

  afterEach(async () => {
    await store.clear();
    await redis.quit();
  });

  describe("store and retrieve", () => {
    it("should store a conversation and retrieve it", async () => {
      const memory: WorkingMemory = {
        conversationId: "conv-1",
        timestamp: new Date(),
        fullText: "We discussed the new API design and authentication strategy",
        embedding: [0.1, 0.2, 0.3],
        keyEntities: ["API", "Authentication"],
        topics: ["architecture", "api"],
        userIntent: "Design system planning",
      };

      await store.store(memory);
      const retrieved = await store.get("conv-1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.conversationId).toBe("conv-1");
      expect(retrieved?.fullText).toBe(memory.fullText);
      expect(retrieved?.keyEntities).toEqual(["API", "Authentication"]);
      expect(retrieved?.topics).toEqual(["architecture", "api"]);
    });

    it("should return null for non-existent conversation", async () => {
      const retrieved = await store.get("non-existent");
      expect(retrieved).toBeNull();
    });

    it("should replay the same projection idempotently without evicting another conversation", async () => {
      const memory = (id: string): WorkingMemory => ({
        conversationId: id,
        timestamp: new Date(),
        fullText: `Conversation ${id}`,
        embedding: [],
        keyEntities: [],
        topics: [],
        userIntent: "",
      });
      await store.store(memory("conv-1"));
      await store.store(memory("conv-2"));
      await store.store(memory("conv-3"));
      await store.store({ ...memory("conv-2"), fullText: "Updated conversation conv-2" });

      const all = await store.getAll();
      expect(all.map((item) => item.conversationId)).toEqual(["conv-2", "conv-3", "conv-1"]);
      expect(all.filter((item) => item.conversationId === "conv-2")).toHaveLength(1);
      expect((await store.get("conv-2"))?.fullText).toBe("Updated conversation conv-2");
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      const memories: WorkingMemory[] = [
        {
          conversationId: "conv-1",
          timestamp: new Date(Date.now() - 1000000),
          fullText: "We discussed the authentication system and JWT tokens",
          embedding: [0.1, 0.2, 0.3],
          keyEntities: ["JWT", "Authentication"],
          topics: ["api", "security"],
          userIntent: "Implementation planning",
        },
        {
          conversationId: "conv-2",
          timestamp: new Date(Date.now() - 500000),
          fullText: "Let's design the database schema for our project",
          embedding: [0.2, 0.3, 0.4],
          keyEntities: ["Database", "Schema"],
          topics: ["architecture", "database"],
          userIntent: "Schema design",
        },
        {
          conversationId: "conv-3",
          timestamp: new Date(),
          fullText: "Performance optimization for the caching layer",
          embedding: [0.3, 0.4, 0.5],
          keyEntities: ["Cache", "Performance"],
          topics: ["performance", "architecture"],
          userIntent: "Optimization discussion",
        },
      ];

      for (const memory of memories) {
        await store.store(memory);
      }
    });

    it("should search by text keywords", async () => {
      const results = await store.search("authentication", 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].similarity).toBeGreaterThan(0);
      expect(results[0].memory.conversationId).toBe("conv-1");
    });

    it("should not treat whitespace-only tokens as relevant", async () => {
      expect(await store.search("     ", 3)).toEqual([]);
      expect(await store.search("  unrelated   phrase  ", 3)).toEqual([]);
    });

    it("should search by entities", async () => {
      const results = await store.searchByEntities(["Database"], 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.conversationId).toBe("conv-2");
      expect(results[0].matchedEntities).toContain("Database");
    });

    it("should search by topics", async () => {
      const results = await store.searchByTopics(["performance"], 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.conversationId).toBe("conv-3");
      expect(results[0].matchedTopics).toContain("performance");
    });

    it("should return top K results", async () => {
      const results = await store.search("architecture", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should rank results by similarity", async () => {
      const results = await store.search("database schema", 3);
      if (results.length > 1) {
        expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
      }
    });
  });

  describe("getAll", () => {
    it("should return all conversations in order", async () => {
      const memories: WorkingMemory[] = [
        {
          conversationId: "conv-1",
          timestamp: new Date(Date.now() - 2000),
          fullText: "First conversation",
          embedding: [],
          keyEntities: [],
          topics: [],
          userIntent: "",
        },
        {
          conversationId: "conv-2",
          timestamp: new Date(Date.now() - 1000),
          fullText: "Second conversation",
          embedding: [],
          keyEntities: [],
          topics: [],
          userIntent: "",
        },
        {
          conversationId: "conv-3",
          timestamp: new Date(),
          fullText: "Third conversation",
          embedding: [],
          keyEntities: [],
          topics: [],
          userIntent: "",
        },
      ];

      for (const memory of memories) {
        await store.store(memory);
      }

      const all = await store.getAll();
      expect(all.length).toBe(3);
      // Should be in reverse chronological order (newest first)
      expect(all[0].conversationId).toBe("conv-3");
    });

    it("should respect limit parameter", async () => {
      const memories: WorkingMemory[] = Array.from({ length: 5 }, (_, i) => ({
        conversationId: `conv-${i}`,
        timestamp: new Date(Date.now() - (5 - i) * 1000),
        fullText: `Conversation ${i}`,
        embedding: [],
        keyEntities: [],
        topics: [],
        userIntent: "",
      }));

      for (const memory of memories) {
        await store.store(memory);
      }

      const limited = await store.getAll(2);
      expect(limited.length).toBeLessThanOrEqual(2);
    });
  });

  describe("auto-eviction", () => {
    it("should evict oldest conversation when max capacity exceeded", async () => {
      // Store 4 conversations, max is 3
      const memories: WorkingMemory[] = Array.from({ length: 4 }, (_, i) => ({
        conversationId: `conv-${i}`,
        timestamp: new Date(Date.now() - (4 - i) * 1000),
        fullText: `Conversation ${i}`,
        embedding: [],
        keyEntities: [],
        topics: [],
        userIntent: "",
      }));

      for (const memory of memories) {
        await store.store(memory);
      }

      const stats = await store.getStats();
      expect(stats.totalConversations).toBe(3);

      // Oldest conversation should be gone
      const oldest = await store.get("conv-0");
      expect(oldest).toBeNull();
    });

    it("should keep the 3 most recent conversations", async () => {
      const memories: WorkingMemory[] = Array.from({ length: 4 }, (_, i) => ({
        conversationId: `conv-${i}`,
        timestamp: new Date(Date.now() - (4 - i) * 1000),
        fullText: `Conversation ${i}`,
        embedding: [],
        keyEntities: [],
        topics: [],
        userIntent: "",
      }));

      for (const memory of memories) {
        await store.store(memory);
      }

      // Check that most recent 3 are still there
      expect(await store.get("conv-1")).toBeDefined();
      expect(await store.get("conv-2")).toBeDefined();
      expect(await store.get("conv-3")).toBeDefined();
    });
  });

  describe("delete", () => {
    it("should delete a conversation", async () => {
      const memory: WorkingMemory = {
        conversationId: "conv-to-delete",
        timestamp: new Date(),
        fullText: "This will be deleted",
        embedding: [],
        keyEntities: [],
        topics: [],
        userIntent: "",
      };

      await store.store(memory);
      expect(await store.get("conv-to-delete")).toBeDefined();

      await store.delete("conv-to-delete");
      expect(await store.get("conv-to-delete")).toBeNull();
    });

    it("should remove every legacy duplicate from the recent list", async () => {
      const memory: WorkingMemory = {
        conversationId: "legacy-duplicate",
        timestamp: new Date(),
        fullText: "Legacy duplicate projection",
        embedding: [],
        keyEntities: [],
        topics: [],
        userIntent: "",
      };
      await store.store(memory);
      await redis.lpush("default:working:recent", memory.conversationId, memory.conversationId);

      await store.delete(memory.conversationId);

      expect(await redis.lrange("default:working:recent", 0, -1)).not.toContain(
        memory.conversationId
      );
      expect(await store.get(memory.conversationId)).toBeNull();
    });
  });

  describe("statistics", () => {
    it("should return empty stats when no conversations", async () => {
      const stats = await store.getStats();
      expect(stats.totalConversations).toBe(0);
      expect(stats.oldestConversation).toBeNull();
      expect(stats.newestConversation).toBeNull();
      expect(stats.totalTextSize).toBe(0);
    });

    it("should calculate stats correctly", async () => {
      const memory1: WorkingMemory = {
        conversationId: "conv-1",
        timestamp: new Date("2024-01-01"),
        fullText: "Hello world",
        embedding: [],
        keyEntities: [],
        topics: [],
        userIntent: "",
      };

      const memory2: WorkingMemory = {
        conversationId: "conv-2",
        timestamp: new Date("2024-01-02"),
        fullText: "Goodbye world",
        embedding: [],
        keyEntities: [],
        topics: [],
        userIntent: "",
      };

      await store.store(memory1);
      await store.store(memory2);

      const stats = await store.getStats();
      expect(stats.totalConversations).toBe(2);
      expect(stats.oldestConversation).toEqual(new Date("2024-01-01"));
      expect(stats.newestConversation).toEqual(new Date("2024-01-02"));
      expect(stats.totalTextSize).toBe("Hello worldGoodbye world".length);
    });
  });
});
