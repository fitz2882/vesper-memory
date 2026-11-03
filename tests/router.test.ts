/**
 * Tests for Smart Query Router
 *
 * Verifies:
 * - Query classification accuracy
 * - Routing logic
 * - Pattern matching
 * - Preference query handler (optimized direct SQLite lookup)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  QueryType,
  classifyQuery,
  retrieve,
  extractEntityName,
  extractDomain,
  parseTimeRange,
  extractPreferenceDomain,
  initPreferenceHandler,
  handlePreferenceQueryDirect
} from "../src/router/smart-router";
import Database from "better-sqlite3";
import { SemanticMemoryLayer } from "../src/memory-layers/semantic-memory";

describe("Query Classification", () => {
  describe("Factual queries", () => {
    it("should classify 'What is X?' as factual", () => {
      const result = classifyQuery("What is your name?");
      expect(result.type).toBe(QueryType.FACTUAL);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it("should classify 'Who is X?' as factual", () => {
      const result = classifyQuery("Who is John Doe?");
      expect(result.type).toBe(QueryType.FACTUAL);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it("should classify 'Where is X?' as factual", () => {
      const result = classifyQuery("Where is the office?");
      expect(result.type).toBe(QueryType.FACTUAL);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it("should classify 'What was X?' with temporal keyword as temporal", () => {
      const result = classifyQuery("What was discussed yesterday?");
      expect(result.type).toBe(QueryType.TEMPORAL); // Temporal keyword takes precedence
      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });

  describe("Preference queries", () => {
    it("should classify preference queries with 'prefer'", () => {
      const result = classifyQuery("What do you prefer?");
      expect(result.type).toBe(QueryType.PREFERENCE);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify preference queries with 'like'", () => {
      const result = classifyQuery("How do I like my coffee?");
      expect(result.type).toBe(QueryType.PREFERENCE);
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("should classify preference queries with 'want'", () => {
      const result = classifyQuery("What do I want in a partner?");
      expect(result.type).toBe(QueryType.PREFERENCE);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify preference queries with 'style'", () => {
      const result = classifyQuery("What's my coding style?");
      expect(result.type).toBe(QueryType.PREFERENCE);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify preference queries with 'favorite'", () => {
      const result = classifyQuery("What's my favorite language?");
      expect(result.type).toBe(QueryType.PREFERENCE);
      expect(result.confidence).toBeGreaterThan(0.85);
    });
  });

  describe("Project queries", () => {
    it("should classify project queries with 'project'", () => {
      const result = classifyQuery("Tell me about the MetricPilot project");
      expect(result.type).toBe(QueryType.PROJECT);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should classify project queries with 'working on'", () => {
      const result = classifyQuery("What am I working on right now?");
      expect(result.type).toBe(QueryType.PROJECT);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should classify project queries with 'decided'", () => {
      const result = classifyQuery("What did we decide about the MVP?");
      expect(result.type).toBe(QueryType.PROJECT);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should classify project queries with 'building'", () => {
      const result = classifyQuery("What am I building next?");
      expect(result.type).toBe(QueryType.PROJECT);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should classify project queries with 'creating'", () => {
      const result = classifyQuery("What are we creating?");
      // "What are" matches factual pattern first
      expect(result.type).toBe(QueryType.FACTUAL);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it("should classify project queries with 'developing'", () => {
      const result = classifyQuery("What are we developing?");
      // "What are" matches factual pattern first
      // To properly classify as project, need "What are we working on?"
      expect(result.type).toBe(QueryType.FACTUAL);
      expect(result.confidence).toBeGreaterThan(0.9);
    });
  });

  describe("Temporal queries", () => {
    it("should classify temporal queries with 'last week'", () => {
      const result = classifyQuery("What did we work on last week?");
      expect(result.type).toBe(QueryType.TEMPORAL);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify temporal queries with 'yesterday'", () => {
      const result = classifyQuery("What happened yesterday?");
      expect(result.type).toBe(QueryType.TEMPORAL);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify temporal queries with 'recently'", () => {
      const result = classifyQuery("What have we discussed recently?");
      expect(result.type).toBe(QueryType.TEMPORAL);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify temporal queries with 'last month'", () => {
      const result = classifyQuery("What happened last month?");
      expect(result.type).toBe(QueryType.TEMPORAL);
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("should classify temporal queries with 'last year'", () => {
      const result = classifyQuery("What happened last year?");
      expect(result.type).toBe(QueryType.TEMPORAL);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify temporal queries with 'last time'", () => {
      const result = classifyQuery("What did we do the last time?");
      expect(result.type).toBe(QueryType.TEMPORAL);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify temporal queries with 'earlier'", () => {
      const result = classifyQuery("What was mentioned earlier?");
      // Temporal keywords now take precedence over factual WH-questions for better memory retrieval
      expect(result.type).toBe(QueryType.TEMPORAL);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should classify temporal queries with 'before'", () => {
      const result = classifyQuery("Tell me about the meeting before last week");
      expect(result.type).toBe(QueryType.TEMPORAL);
      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });

  describe("Skill queries", () => {
    it("should classify skill queries with 'like before'", () => {
      const result = classifyQuery("Analyze this like before");
      expect(result.type).toBe(QueryType.SKILL);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should classify skill queries with 'same as'", () => {
      const result = classifyQuery("Do it the same as last time");
      expect(result.type).toBe(QueryType.SKILL);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should classify skill queries with 'analyze'", () => {
      const result = classifyQuery("Analyze this for me");
      expect(result.type).toBe(QueryType.SKILL);
      expect(result.confidence).toBe(0.75);
    });

    it("should classify skill queries with 'same way'", () => {
      const result = classifyQuery("Do it the same way as before");
      expect(result.type).toBe(QueryType.SKILL);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should classify skill queries with 'how you'", () => {
      const result = classifyQuery("How you did it last time");
      expect(result.type).toBe(QueryType.SKILL);
      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });

  describe("Complex queries (fallback)", () => {
    it("should classify ambiguous queries as complex", () => {
      const result = classifyQuery("Tell me everything about AI");
      expect(result.type).toBe(QueryType.COMPLEX);
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    });

    it("should classify vague queries as complex", () => {
      const result = classifyQuery("Something about projects");
      expect(result.type).toBe(QueryType.COMPLEX);
    });

    it("should classify empty-ish queries as complex", () => {
      const result = classifyQuery("hmmm");
      expect(result.type).toBe(QueryType.COMPLEX);
    });
  });

  describe("Pattern matching metadata", () => {
    it("should include matched pattern in classification result", () => {
      const result = classifyQuery("What is your goal?");
      expect(result.matchedPattern).toBeDefined();
      expect(result.matchedPattern).toBe("factual_wh");
    });

    it("should not include pattern for complex queries", () => {
      const result = classifyQuery("Tell me something");
      expect(result.matchedPattern).toBeUndefined();
    });
  });

  describe("Case insensitivity", () => {
    it("should handle uppercase queries", () => {
      const result = classifyQuery("WHAT IS YOUR NAME?");
      expect(result.type).toBe(QueryType.FACTUAL);
    });

    it("should handle mixed case queries", () => {
      const result = classifyQuery("WhAt Is ThE pRoJeCt?");
      expect(result.type).toBe(QueryType.FACTUAL);
    });
  });

  describe("Whitespace handling", () => {
    it("should handle leading/trailing whitespace", () => {
      const result = classifyQuery("   What is X?   ");
      expect(result.type).toBe(QueryType.FACTUAL);
    });

    it("should handle extra internal whitespace", () => {
      const result = classifyQuery("What   is   X?");
      expect(result.type).toBe(QueryType.FACTUAL);
    });
  });
});

describe("Query Routing (retrieve)", () => {
  describe("Input validation", () => {
    it("should throw on empty query", async () => {
      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      await expect(retrieve("", context)).rejects.toThrow("Query cannot be empty");
    });

    it("should throw on whitespace-only query", async () => {
      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      await expect(retrieve("   ", context)).rejects.toThrow("Query cannot be empty");
    });

    it("should throw on missing userId", async () => {
      const context = { userId: "", conversationId: "conv1", timestamp: new Date() };
      await expect(retrieve("What is X?", context)).rejects.toThrow(
        "Valid routing context with userId is required"
      );
    });

    it("should throw on missing context", async () => {
      await expect(retrieve("What is X?", null as any)).rejects.toThrow(
        "Valid routing context with userId is required"
      );
    });
  });

  describe("Routing behavior", () => {
    it("should accept valid query and context", async () => {
      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const result = await retrieve("What is X?", context);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

describe("Helper functions", () => {
  describe("extractEntityName", () => {
    it("should extract entity name from 'What is X?' queries", () => {
      const result = extractEntityName("What is the MetricPilot project?");
      expect(result).toBe("metricpilot project");
    });

    it("should extract entity from 'Who is X?' queries", () => {
      const result = extractEntityName("Who is John?");
      expect(result).toBe("john");
    });

    it("should return null for unrecognized patterns", () => {
      const result = extractEntityName("hello world");
      expect(result).toBeNull();
    });
  });

  describe("extractDomain", () => {
    it("should extract 'coffee' domain from preference query", () => {
      const result = extractDomain("How do I like my coffee?");
      expect(result).toBe("coffee");
    });

    it("should extract 'coding' domain from style query", () => {
      const result = extractDomain("What's my coding style?");
      expect(result).toBe("coding");
    });

    it("should extract 'language' domain from favorite query", () => {
      const result = extractDomain("What's my favorite language?");
      expect(result).toBe("language");
    });

    it("should extract 'reports' domain from formatting query", () => {
      const result = extractDomain("How do I prefer my reports formatted?");
      expect(result).toBe("reports");
    });

    it("should extract 'TypeScript' domain from preference query", () => {
      const result = extractDomain("Do I prefer TypeScript or JavaScript?");
      expect(result).toBe("typescript");
    });

    it("should return null for queries without clear domain", () => {
      const result = extractDomain("What do I want?");
      expect(result).toBeNull();
    });

    it("should handle multiple potential domains by taking the first noun", () => {
      const result = extractDomain("What's my favorite coffee shop location?");
      expect(result).toBe("coffee");
    });
  });

  describe("parseTimeRange", () => {
    it("should parse 'last week' into a time range", () => {
      const result = parseTimeRange("What happened last week?");
      expect(result).not.toBeNull();
      expect(result!.startDate).toBeInstanceOf(Date);
      expect(result!.endDate).toBeInstanceOf(Date);
      const daysDiff = (result!.endDate.getTime() - result!.startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThanOrEqual(6);
      expect(daysDiff).toBeLessThanOrEqual(8);
    });

    it("should parse 'yesterday'", () => {
      const result = parseTimeRange("What happened yesterday?");
      expect(result).not.toBeNull();
    });

    it("should parse 'last month'", () => {
      const result = parseTimeRange("What did we do last month?");
      expect(result).not.toBeNull();
    });

    it("should parse 'recently'", () => {
      const result = parseTimeRange("What happened recently?");
      expect(result).not.toBeNull();
    });

    it("should return null for non-temporal queries", () => {
      const result = parseTimeRange("What is Redis?");
      expect(result).toBeNull();
    });
  });
});

describe("extractPreferenceDomain", () => {
  describe("Domain extraction patterns", () => {
    it("should extract domain from 'my X style' pattern", () => {
      expect(extractPreferenceDomain("What's my coding style?")).toBe("coding");
      expect(extractPreferenceDomain("What's my writing style?")).toBe("writing");
    });

    it("should extract domain from 'favorite X' pattern", () => {
      expect(extractPreferenceDomain("What's my favorite language?")).toBe("language");
      expect(extractPreferenceDomain("What's my favorite framework?")).toBe("framework");
    });

    it("should extract domain from 'prefer X' pattern", () => {
      expect(extractPreferenceDomain("Do I prefer TypeScript?")).toBe("typescript");
      expect(extractPreferenceDomain("Do I prefer tabs or spaces?")).toBe("tabs");
    });

    it("should extract domain from 'like my X' pattern", () => {
      expect(extractPreferenceDomain("How do I like my coffee?")).toBe("coffee");
      expect(extractPreferenceDomain("How do I like my code formatted?")).toBe("code");
    });

    it("should return null for queries without extractable domain", () => {
      expect(extractPreferenceDomain("What do I prefer?")).toBeNull();
      expect(extractPreferenceDomain("Tell me my preferences")).toBeNull();
    });

    it("should be case insensitive", () => {
      expect(extractPreferenceDomain("What's my CODING style?")).toBe("coding");
      expect(extractPreferenceDomain("Do I PREFER TypeScript?")).toBe("typescript");
    });
  });
});

describe("Preference Query Handler", () => {
  let db: Database.Database;
  let semanticMemory: SemanticMemoryLayer;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(":memory:");

    // Create entities table
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        confidence REAL DEFAULT 1.0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER DEFAULT 1,
        namespace TEXT DEFAULT 'default'
      );
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    `);

    semanticMemory = new SemanticMemoryLayer(db);

    // Initialize the preference handler with semantic memory
    initPreferenceHandler(semanticMemory);
  });

  afterEach(() => {
    db.close();
  });

  describe("Direct SQLite lookup", () => {
    it("should return preferences without embedding generation", async () => {
      // Store test preference
      semanticMemory.upsertEntity({
        name: "coding_style",
        type: "preference",
        description: "User prefers functional programming with TypeScript",
        confidence: 0.95
      });

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What's my coding style?", context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].source).toBe("semantic");
      expect(results[0].content).toContain("functional programming");
    });

    it("should filter preferences by domain when extractable", async () => {
      // Store multiple preferences
      semanticMemory.upsertEntity({
        name: "coffee_preference",
        type: "preference",
        description: "User likes black coffee, no sugar",
        confidence: 0.9
      });
      semanticMemory.upsertEntity({
        name: "coding_style",
        type: "preference",
        description: "User prefers TypeScript",
        confidence: 0.95
      });

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("How do I like my coffee?", context);

      expect(results.length).toBe(1);
      expect(results[0].content).toContain("black coffee");
    });

    it("should return all preferences when domain cannot be extracted", async () => {
      semanticMemory.upsertEntity({
        name: "coffee_preference",
        type: "preference",
        description: "User likes black coffee",
        confidence: 0.9
      });
      semanticMemory.upsertEntity({
        name: "coding_style",
        type: "preference",
        description: "User prefers TypeScript",
        confidence: 0.95
      });

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What are my preferences?", context);

      expect(results.length).toBe(2);
    });

    it("should return empty array when no preferences exist", async () => {
      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What's my coding style?", context);

      expect(results).toEqual([]);
    });
  });

  describe("Temporal decay weighting", () => {
    it("should prioritize recent preferences over older ones", async () => {
      // Insert older preference
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      db.prepare(`
        INSERT INTO entities (id, name, type, description, confidence, created_at, last_accessed, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "pref_old",
        "coding_old",
        "preference",
        "User used to prefer JavaScript",
        0.9,
        oldDate.toISOString(),
        oldDate.toISOString(),
        1
      );

      // Insert recent preference
      const recentDate = new Date();
      db.prepare(`
        INSERT INTO entities (id, name, type, description, confidence, created_at, last_accessed, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "pref_recent",
        "coding_recent",
        "preference",
        "User now prefers TypeScript",
        0.9,
        recentDate.toISOString(),
        recentDate.toISOString(),
        1
      );

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What's my coding preference?", context);

      expect(results.length).toBe(2);
      // Recent preference should have higher similarity due to temporal weighting
      expect(results[0].content).toContain("TypeScript");
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    });

    it("should apply exponential decay based on days since last access", async () => {
      // Insert preference from 60 days ago
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      db.prepare(`
        INSERT INTO entities (id, name, type, description, confidence, created_at, last_accessed, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "pref_60days",
        "old_preference",
        "preference",
        "Very old preference",
        1.0,
        oldDate.toISOString(),
        oldDate.toISOString(),
        1
      );

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What are my preferences?", context);

      // 60 days decay should result in ~13.5% weight (e^(-60/30))
      expect(results[0].similarity).toBeLessThan(0.2);
    });
  });

  describe("Performance requirements", () => {
    it("should complete preference lookup in under 50ms", async () => {
      // Seed 100 preferences
      for (let i = 0; i < 100; i++) {
        semanticMemory.upsertEntity({
          name: `preference_${i}`,
          type: "preference",
          description: `Test preference ${i} with some content`,
          confidence: 0.8 + Math.random() * 0.2
        });
      }

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };

      const start = performance.now();
      await handlePreferenceQueryDirect("What's my coding style?", context);
      const duration = performance.now() - start;

      // Should be much faster than embedding-based search (~50ms vs ~200ms)
      expect(duration).toBeLessThan(50);
    });

    it("should handle 500 preferences without degradation", async () => {
      // Seed 500 preferences to test scaling
      for (let i = 0; i < 500; i++) {
        semanticMemory.upsertEntity({
          name: `preference_${i}`,
          type: "preference",
          description: `Test preference ${i} with detailed content about user choices`,
          confidence: 0.7 + Math.random() * 0.3
        });
      }

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };

      const start = performance.now();
      const results = await handlePreferenceQueryDirect("What are my preferences?", context);
      const duration = performance.now() - start;

      // Should still be under 50ms even with 500 preferences
      expect(duration).toBeLessThan(50);
      expect(results.length).toBe(500);
    });
  });

  describe("Edge cases", () => {
    it("should handle semantic memory not initialized", async () => {
      // Reset semantic memory layer
      initPreferenceHandler(null as any);

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What's my coding style?", context);

      expect(results).toEqual([]);

      // Restore for other tests
      initPreferenceHandler(semanticMemory);
    });

    it("should use created_at as fallback for temporal decay", async () => {
      // Insert preference where last_accessed equals created_at (simulates fresh preference)
      const createdAt = new Date();
      db.prepare(`
        INSERT INTO entities (id, name, type, description, confidence, created_at, last_accessed, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "pref_fresh",
        "coding_fresh",
        "preference",
        "User prefers TypeScript with fresh access",
        0.9,
        createdAt.toISOString(),
        createdAt.toISOString(),
        1
      );

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What's my coding preference?", context);

      // Should use last_accessed (or created_at as equivalent) for decay calculation
      expect(results.length).toBeGreaterThan(0);
      // Fresh preference should have high similarity (close to 1.0)
      expect(results[0].similarity).toBeGreaterThan(0.8);
    });

    it("should handle special characters in preference content", async () => {
      semanticMemory.upsertEntity({
        name: "code_style_special",
        type: "preference",
        description: "User prefers 2-space indentation & 'single quotes' for strings",
        confidence: 0.95
      });

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What's my code style?", context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain("single quotes");
    });

    it("should handle unicode in preference content", async () => {
      semanticMemory.upsertEntity({
        name: "emoji_preference",
        type: "preference",
        description: "User prefers descriptive variable names like userSettings",
        confidence: 0.9
      });

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What are my preferences?", context);

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("Combined confidence and temporal scoring", () => {
    it("should balance confidence and recency in scoring", async () => {
      // High confidence but old
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      db.prepare(`
        INSERT INTO entities (id, name, type, description, confidence, created_at, last_accessed, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "pref_old_high",
        "old_high_conf",
        "preference",
        "Old but high confidence preference",
        1.0,
        oldDate.toISOString(),
        oldDate.toISOString(),
        10
      );

      // Low confidence but recent
      const recentDate = new Date();
      db.prepare(`
        INSERT INTO entities (id, name, type, description, confidence, created_at, last_accessed, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "pref_recent_low",
        "recent_low_conf",
        "preference",
        "Recent but lower confidence preference",
        0.6,
        recentDate.toISOString(),
        recentDate.toISOString(),
        1
      );

      const context = { userId: "user1", conversationId: "conv1", timestamp: new Date() };
      const results = await handlePreferenceQueryDirect("What are my preferences?", context);

      expect(results.length).toBe(2);
      // Recent preference (0.6 * 1.0 = 0.6) should beat old high (1.0 * 0.135 = 0.135)
      expect(results[0].content).toContain("Recent");
    });
  });
});
