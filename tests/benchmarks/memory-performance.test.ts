/**
 * Synthetic Benchmark: Memory System Diagnostics
 *
 * This suite measures bounded component behavior on synthetic fixtures. It is
 * not evidence of end-task improvement or production cost savings; those
 * claims require a matched scratch baseline and held-out relevance labels.
 *
 * Metrics tested:
 * - Query latency (P50/P95/P99)
 * - Retrieval accuracy (precision/recall)
 * - Context retention across sessions
 * - Token efficiency (estimated savings)
 * - Response consistency
 *
 * Run with: npm run benchmark
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Redis from "ioredis";
import { createRequire } from "module";
import { MemoryRetriever } from "../../src/retrieval/memory-retriever.js";

// Import better-sqlite3 using createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

interface BenchmarkResult {
  metric: string;
  observed: number | null;
  acceptance: string;
  passed: boolean | null;
  unit: string;
  reason?: string;
  kind?: "observed" | "declared_model";
}

interface QueryTestCase {
  query: string;
  expectedFacts: string[];
  category: string;
  relevantId: string;
}

interface MemoryRow {
  content: string;
}

// Test dataset: Real-world queries that benefit from memory
const testQueries: QueryTestCase[] = [
  {
    query: "What programming language do I prefer?",
    expectedFacts: ["TypeScript"],
    category: "preference",
    relevantId: "language-preference",
  },
  {
    query: "What was the last project I worked on?",
    expectedFacts: ["Vesper", "memory system"],
    category: "temporal",
    relevantId: "current-project",
  },
  {
    query: "What is my coding style preference?",
    expectedFacts: ["functional", "type-safe"],
    category: "preference",
    relevantId: "coding-style",
  },
  {
    query: "Who am I collaborating with?",
    expectedFacts: ["David", "Fitzsimmons"],
    category: "factual",
    relevantId: "collaborator",
  },
  {
    query: "What did I say about testing?",
    expectedFacts: ["important", "coverage", "171 tests"],
    category: "temporal",
    relevantId: "testing",
  },
];

// Seed memories for testing
const seedMemories = [
  {
    id: "language-preference",
    content: "The programming language preference is TypeScript for type safety and tooling",
    tags: ["preference", "language"],
  },
  {
    id: "current-project",
    content: "Currently working on Vesper, a memory system for Claude Code",
    tags: ["project", "current"],
  },
  {
    id: "coding-style",
    content: "The coding style preference is functional and type-safe programming",
    tags: ["preference", "coding-style"],
  },
  {
    id: "collaborator",
    content: "Collaborating with David Fitzsimmons on this project",
    tags: ["collaboration", "people"],
  },
  {
    id: "testing",
    content: "Testing is important; the project emphasizes coverage and has 171 tests passing",
    tags: ["testing", "quality"],
  },
  {
    id: "security",
    content: "User values production-ready security over quick hacks",
    tags: ["philosophy", "security"],
  },
  {
    id: "research-interest",
    content: "User is curious about neuroscience-inspired approaches",
    tags: ["interest", "research"],
  },
  {
    id: "technology-stack",
    content: "Project uses Redis, PostgreSQL, Qdrant, and SQLite",
    tags: ["technology", "stack"],
  },
  {
    id: "latency-target",
    content: "Target latency is under 200ms P95",
    tags: ["performance", "metrics"],
  },
  {
    id: "cost-target",
    content: "Cost efficiency is important: under $1/user/month target",
    tags: ["cost", "efficiency"],
  },
];

describe("Memory System Performance Benchmarks", () => {
  let redis: Redis | null = null;
  let redisAvailable = false;
  let db: ReturnType<typeof Database>;
  let retriever: MemoryRetriever;
  const userId = "benchmark-user";
  const results: BenchmarkResult[] = [];

  beforeAll(async () => {
    // Setup Redis connection (optional - tests will skip if unavailable)
    try {
      redis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD,
        connectTimeout: 1_000,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });
      redis.on("error", () => {
        // Availability is reflected by the guarded ping below.
      });

      // Test connection
      await redis.ping();
      redisAvailable = true;
      console.log("✅ Redis connected - all benchmarks will run\n");
    } catch (err) {
      console.log("⚠️  Redis unavailable - Redis-dependent tests will be skipped\n");
      console.log(`   Error: ${err instanceof Error ? err.message : String(err)}\n`);
      redis = null;
      redisAvailable = false;
    }

    db = new Database(":memory:");

    // Create schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        namespace TEXT NOT NULL DEFAULT 'benchmark'
      );
      CREATE INDEX idx_memories_namespace ON memories(namespace);
      CREATE INDEX idx_memories_created ON memories(created_at);
    `);

    // Seed test data
    const stmt = db.prepare(
      `INSERT INTO memories (
         id, content, memory_type, created_at, updated_at, metadata, namespace
       ) VALUES (?, ?, 'semantic', ?, ?, ?, 'benchmark')`
    );

    for (const memory of seedMemories) {
      const timestamp = Date.now();
      stmt.run(
        memory.id,
        memory.content,
        timestamp,
        timestamp,
        JSON.stringify({ tags: memory.tags })
      );
    }
    retriever = new MemoryRetriever({ db });
    retriever.initialize();

    console.log(`\n✅ Seeded ${seedMemories.length} test memories\n`);
  });

  afterAll(async () => {
    if (redis && redisAvailable) {
      await redis.quit();
    }
    db.close();

    // Save results to file
    const resultsDir = join(process.cwd(), "benchmarks");
    if (!existsSync(resultsDir)) {
      mkdirSync(resultsDir, { recursive: true });
    }

    const markdown = generateMarkdownReport(results);
    const outputPath = join(resultsDir, "results.md");
    writeFileSync(outputPath, markdown);
    console.log(`\n📊 Benchmark results saved to: ${outputPath}\n`);
  });

  it("Benchmark 1: Query Latency (P50/P95/P99)", async () => {
    if (!redisAvailable) {
      console.log("[SKIP] Redis required for latency benchmark");
      results.push({
        metric: "Query Latency (P95)",
        observed: null,
        acceptance: "< 200 ms",
        passed: null,
        unit: "ms",
        reason: "Redis was unavailable",
      });
      return;
    }

    const iterations = 1000;
    const latenciesWithMemory: number[] = [];

    // Test WITH memory (simulated retrieval from Redis + DB)
    for (let i = 0; i < iterations; i++) {
      const query = testQueries[i % testQueries.length].query;
      const start = performance.now();

      // Simulate memory retrieval
      await redis!.get(`memory:${userId}:${query}`);
      const dbResults = db
        .prepare("SELECT * FROM memories WHERE namespace = ? LIMIT 5")
        .all("benchmark");

      const end = performance.now();
      latenciesWithMemory.push(end - start);
    }

    // Calculate percentiles
    const p50With = percentile(latenciesWithMemory, 50);
    const p95With = percentile(latenciesWithMemory, 95);
    const p99With = percentile(latenciesWithMemory, 99);

    results.push({
      metric: "Query Latency (P95)",
      observed: p95With,
      acceptance: "< 200 ms",
      passed: p95With < 200,
      unit: "ms",
    });

    console.log(`Latency distribution: P50=${p50With}ms P95=${p95With}ms P99=${p99With}ms`);

    expect(p95With).toBeLessThan(200);
  }, 30000);

  it("Benchmark 2: Production Retrieval Recall@3", async () => {
    let relevantRetrieved = 0;
    let reciprocalRankSum = 0;
    const totalQueries = testQueries.length;

    for (const testCase of testQueries) {
      const response = await retriever.retrieve({
        query: testCase.query,
        namespace: "benchmark",
        strategy: "full_text",
        maxResults: 3,
      });
      const rank = response.results.findIndex((result) => result.id === testCase.relevantId);
      if (rank >= 0) {
        relevantRetrieved++;
        reciprocalRankSum += 1 / (rank + 1);
      }
    }

    const recallAt3 = (relevantRetrieved / totalQueries) * 100;
    const mrr = reciprocalRankSum / totalQueries;

    results.push({
      metric: "Production Retrieval Recall@3",
      observed: recallAt3,
      acceptance: ">= 80% on frozen relevance labels",
      passed: recallAt3 >= 80,
      unit: "%",
    });
    console.log(
      `Frozen retrieval labels: Recall@3=${recallAt3.toFixed(1)}%, MRR=${mrr.toFixed(3)}`
    );

    expect(recallAt3).toBeGreaterThanOrEqual(80);
  });

  it("Benchmark 3: Context Retention", async () => {
    if (!redisAvailable) {
      console.log("[SKIP] Redis required for context retention benchmark");
      results.push({
        metric: "Context Retention",
        observed: null,
        acceptance: "100% immediate Redis read-after-write",
        passed: null,
        unit: "%",
        reason: "Redis was unavailable",
      });
      return;
    }

    // Simulate multi-session retention
    const sessions = 50;
    let retainedAcrossSessions = 0;

    for (let i = 0; i < sessions; i++) {
      const sessionKey = `session:${userId}:${i}`;

      // Store in Redis with TTL
      await redis!.setex(
        sessionKey,
        604800,
        JSON.stringify({
          sessionId: i,
          timestamp: Date.now(),
          facts: seedMemories.slice(0, 3),
        })
      );

      // Check if still retrievable
      const retrieved = await redis!.get(sessionKey);
      if (retrieved) {
        retainedAcrossSessions++;
      }
    }

    const retentionRate = (retainedAcrossSessions / sessions) * 100;

    results.push({
      metric: "Context Retention",
      observed: retentionRate,
      acceptance: "100% immediate Redis read-after-write",
      passed: retentionRate === 100,
      unit: "%",
    });

    expect(retentionRate).toBe(100);
  });

  it("Benchmark 4: Declared Token-Size Model", async () => {
    // Estimate token savings
    const avgContextWithoutMemory = 500; // Tokens needed to re-explain context
    const avgContextWithMemory = 50; // Tokens for memory retrieval

    const queriesPerSession = 10;
    const sessions = 100;

    const tokensWithoutMemory = queriesPerSession * sessions * avgContextWithoutMemory;
    const tokensWithMemory = queriesPerSession * sessions * avgContextWithMemory;

    const tokenSavings = ((tokensWithoutMemory - tokensWithMemory) / tokensWithoutMemory) * 100;

    results.push({
      metric: "Declared Token-Size Model",
      observed: tokenSavings,
      acceptance: "> 80% in declared token-size model",
      passed: tokenSavings > 80,
      unit: "%",
      kind: "declared_model",
    });

    expect(tokenSavings).toBeGreaterThan(80);
  });

  it("Benchmark 5: Response Consistency", async () => {
    // Test same query multiple times
    const query = "What programming language do I prefer?";
    const iterations = 20;
    const responses: string[] = [];

    for (let i = 0; i < iterations; i++) {
      const results = (
        await retriever.retrieve({
          query,
          namespace: "benchmark",
          strategy: "full_text",
          maxResults: 1,
        })
      ).results as MemoryRow[];

      if (results.length > 0) {
        responses.push(results[0].content);
      }
    }

    // Calculate consistency (% same response)
    const mostCommon = mode(responses);
    const consistency = (responses.filter((r) => r === mostCommon).length / iterations) * 100;

    results.push({
      metric: "Consistency Score",
      observed: consistency,
      acceptance: "> 90% deterministic fixture lookup",
      passed: consistency > 90,
      unit: "%",
    });

    expect(consistency).toBeGreaterThan(90);
  });
});

// Helper functions
function percentile(arr: number[], p: number): number {
  const sorted = arr.slice().sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[index] * 100) / 100;
}

function mode(arr: string[]): string {
  const counts = new Map<string, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  let maxCount = 0;
  let modeValue = arr[0];

  for (const [value, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      modeValue = value;
    }
  }

  return modeValue;
}

function generateMarkdownReport(results: BenchmarkResult[]): string {
  const timestamp = new Date().toISOString();
  const failed = results.filter((result) => result.passed === false).length;
  const skipped = results.filter((result) => result.passed === null).length;
  const observedPassed = results.filter(
    (result) => result.passed === true && result.kind !== "declared_model"
  ).length;
  const modelPassed = results.filter(
    (result) => result.passed === true && result.kind === "declared_model"
  ).length;
  const latencyRan = results.some(
    (result) => result.metric.startsWith("Query Latency") && result.passed !== null
  );
  const retentionRan = results.some(
    (result) => result.metric === "Context Retention" && result.passed !== null
  );

  return `# Vesper Memory System - Synthetic Diagnostics

Generated: ${timestamp}

## Summary

These are component-level synthetic checks. They do not establish end-task improvement, real-user cost savings, or superiority to a matched no-memory baseline.

## Results

| Metric | Observed | Acceptance | Result | Unit |
|--------|----------|------------|--------|------|
${results
  .map(
    (r) =>
      `| ${r.metric} | ${r.observed === null ? "—" : r.observed.toFixed(1)} | ${r.acceptance} | ${r.passed === null ? "SKIP" : r.passed ? "PASS" : "FAIL"} | ${r.unit} |`
  )
  .join("\n")}

## Interpretation

${results
  .map((r) => {
    return `### ${r.passed === null ? "SKIP" : r.passed ? "PASS" : "FAIL"}: ${r.metric}

- **Observed**: ${r.observed === null ? "Not run" : `${r.observed.toFixed(1)} ${r.unit}`}
- **Acceptance**: ${r.acceptance}
${r.reason ? `- **Reason**: ${r.reason}\n` : ""}
`;
  })
  .join("\n")}

## Methodology

- **Test Dataset**: ${seedMemories.length} realistic user memories
- **Query Set**: ${testQueries.length} representative queries across categories
- **Latency iterations**: ${latencyRan ? "1,000" : "Not run (Redis unavailable)"}
- **Retention sessions**: ${retentionRan ? "50" : "Not run (Redis unavailable)"}
- **Consistency**: 20 repeated queries

Tests run against local Redis and SQLite with a small synthetic dataset. The accuracy fixture is lexical rather than human-labelled semantic relevance.

## Conclusion

${observedPassed} observed checks passed, ${modelPassed} declared model checks passed, ${failed} failed, and ${skipped} not run. Declared model checks and skipped checks are not empirical performance evidence.

Use the frozen contract in \`docs/RETRIEVAL_EVALUATION.md\` for comparative retrieval or end-task claims.

---

*Built by Claude Code, with assistance by David Fitzsimmons*
*Run benchmarks yourself: \`npm run benchmark\`*
`;
}
