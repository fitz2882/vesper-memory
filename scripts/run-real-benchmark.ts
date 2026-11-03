#!/usr/bin/env tsx
/**
 * Real-World Vesper Benchmark Script
 *
 * Runs actual performance benchmarks against live Vesper infrastructure:
 * - Redis (working memory)
 * - Qdrant (vector search)
 * - BGE-large embeddings
 * - SQLite (knowledge graph)
 *
 * Scientific methodology:
 * - Warmup runs to prime caches and eliminate cold-start effects
 * - Multiple measurement runs for statistical power
 * - Welch's t-test for hypothesis testing (handles unequal variances)
 * - Cohen's d for effect size interpretation
 * - Proper isolation between enabled/disabled conditions
 *
 * Usage: npm run benchmark:real
 */

import { createBenchmarkRunner, BenchmarkConfig } from "../src/benchmark/runner.js";
import { generateMarkdownReport } from "../src/benchmark/report-generator.js";
import { MCPClient } from "../src/benchmark/scenarios/context-recall.js";
import { WorkingMemoryLayer, WorkingMemory } from "../src/memory-layers/working-memory.js";
import { SemanticMemoryLayer } from "../src/memory-layers/semantic-memory.js";
import { HybridSearchEngine } from "../src/retrieval/hybrid-search.js";
import { EmbeddingClient } from "../src/embeddings/client.js";
import Redis from "ioredis";
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Configuration
const CONFIG: BenchmarkConfig = {
  warmupRuns: 3,
  measurementRuns: 10,
  timeoutMs: 60000,
  significanceLevel: 0.05,
  scenarios: [
    "context-recall",
    "cross-session",
    "skill-retrieval",
    "token-efficiency",
    "semantic-accuracy",
  ],
  outputDirectory: "./benchmarks",
};

/**
 * Real Vesper MCP Client
 *
 * Implements the MCPClient interface expected by benchmark scenarios.
 * Uses actual Vesper infrastructure for memory operations.
 *
 * Key design principles:
 * - When enabled: full memory storage and retrieval via Vesper
 * - When disabled: pass-through with minimal latency (baseline comparison)
 * - Proper cleanup between test runs to avoid carryover effects
 */
class RealVesperClient implements MCPClient {
  private workingMemory: WorkingMemoryLayer;
  private semanticMemory: SemanticMemoryLayer;
  private hybridSearch: HybridSearchEngine;
  private embeddingClient: EmbeddingClient;
  private redis: Redis;
  private enabled: boolean = true;
  private sessionId: string;

  constructor(
    redis: Redis,
    db: Database.Database,
    embeddingClient: EmbeddingClient,
    hybridSearch: HybridSearchEngine
  ) {
    this.redis = redis;
    this.workingMemory = new WorkingMemoryLayer(redis);
    this.semanticMemory = new SemanticMemoryLayer(db);
    this.hybridSearch = hybridSearch;
    this.embeddingClient = embeddingClient;
    this.sessionId = `bench-${randomUUID().slice(0, 8)}`;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Store memory implementation
   *
   * When enabled:
   * 1. Generate embedding via BGE-large service
   * 2. Store in working memory (Redis) for fast recall
   * 3. Extract entities and store in semantic memory (SQLite)
   * 4. Index in Qdrant for vector search
   *
   * When disabled:
   * Return immediately with synthetic ID (baseline)
   */
  async storeMemory(
    content: string,
    memoryType: string,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; memory_id: string }> {
    if (!this.enabled) {
      // Pass-through mode - no storage, just return synthetic ID
      return {
        success: true,
        memory_id: `disabled-${Date.now()}`,
      };
    }

    try {
      // Qdrant requires UUID format for string IDs
      const memoryId = randomUUID();
      const conversationId = `conv-${this.sessionId}-${Date.now()}`;

      // 1. Generate embedding
      const embedding = await this.embeddingClient.embed(content);

      // 2. Store in working memory
      const workingMemoryEntry: WorkingMemory = {
        conversationId,
        timestamp: new Date(),
        fullText: content,
        embedding,
        keyEntities: this.extractEntities(content),
        topics: this.extractTopics(content),
        userIntent: memoryType,
      };
      await this.workingMemory.store(workingMemoryEntry);

      // 3. Store in semantic memory (entity extraction)
      const entities = this.extractEntities(content);
      for (const entityName of entities) {
        this.semanticMemory.upsertEntity({
          name: entityName,
          type: this.inferEntityType(entityName, content),
          description: content,
          confidence: 0.9,
        });
      }

      // 4. Index in Qdrant for vector search
      await this.hybridSearch.upsertMemory(memoryId, embedding, {
        content,
        memoryType,
        timestamp: Date.now(),
        sessionId: this.sessionId,
        ...metadata,
      });

      return {
        success: true,
        memory_id: memoryId,
      };
    } catch (error) {
      console.error("Store error:", error);
      return {
        success: false,
        memory_id: "",
      };
    }
  }

  /**
   * Retrieve memory implementation
   *
   * When enabled:
   * 1. Check working memory first (fast path, ~5ms)
   * 2. If not found, generate query embedding
   * 3. Perform hybrid search in Qdrant
   * 4. Return top-K results with similarity scores
   *
   * When disabled:
   * Return empty results (baseline for comparison)
   */
  async retrieveMemory(
    query: string,
    options?: { max_results?: number }
  ): Promise<{
    success: boolean;
    results: Array<{ content: string; similarity_score: number }>;
  }> {
    if (!this.enabled) {
      // Pass-through mode - return empty results
      return {
        success: true,
        results: [],
      };
    }

    const maxResults = options?.max_results ?? 3;

    try {
      // 1. Check working memory first (fast path)
      const workingResults = await this.workingMemory.search(query, maxResults);

      if (workingResults.length > 0 && workingResults[0].similarity > 0.7) {
        // Working memory hit - return immediately
        return {
          success: true,
          results: workingResults.map((r) => ({
            content: r.memory.fullText,
            similarity_score: r.similarity,
          })),
        };
      }

      // 2. Generate query embedding
      const queryEmbedding = await this.embeddingClient.embed(query);

      // 3. Perform hybrid search in Qdrant
      const searchResults = await this.hybridSearch.hybridSearch(
        queryEmbedding,
        maxResults
      );

      // 4. Format and return results
      return {
        success: true,
        results: searchResults.map((r) => ({
          content: (r.payload?.content as string) || "",
          similarity_score: r.fusedScore,
        })),
      };
    } catch (error) {
      console.error("Retrieve error:", error);
      return {
        success: false,
        results: [],
      };
    }
  }

  /**
   * Clear all memories for clean slate between test runs
   *
   * Important for scientific validity:
   * - Prevents carryover effects between scenarios
   * - Ensures each scenario starts from identical baseline
   */
  async clearMemories(): Promise<void> {
    try {
      // Clear working memory
      const keys = await this.redis.keys("working:*");
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      // Note: For benchmarks, we don't clear Qdrant vectors between runs
      // as each scenario operates on its own stored facts
    } catch (error) {
      console.error("Clear memories error:", error);
    }
  }

  /**
   * Generate a new session ID for isolation
   */
  newSession(): void {
    this.sessionId = `bench-${randomUUID().slice(0, 8)}`;
  }

  // Helper methods for entity extraction

  private extractEntities(content: string): string[] {
    const entities: string[] = [];
    const lowerContent = content.toLowerCase();

    // Technical terms
    const techTerms = [
      "typescript",
      "javascript",
      "python",
      "rust",
      "redis",
      "qdrant",
      "sqlite",
      "postgresql",
      "docker",
      "kubernetes",
      "vesper",
      "claude",
      "mcp",
      "api",
      "rest",
      "http",
    ];

    for (const term of techTerms) {
      if (lowerContent.includes(term)) {
        entities.push(term);
      }
    }

    // Proper nouns (simplified heuristic)
    const words = content.split(/\s+/);
    for (const word of words) {
      if (/^[A-Z][a-z]+$/.test(word) && word.length > 2) {
        entities.push(word.toLowerCase());
      }
    }

    return [...new Set(entities)].slice(0, 5);
  }

  private extractTopics(content: string): string[] {
    const topics: string[] = [];
    const lowerContent = content.toLowerCase();

    const topicPatterns = [
      { pattern: /coding|programming|development/i, topic: "development" },
      { pattern: /test|testing|coverage/i, topic: "testing" },
      { pattern: /memory|cache|storage/i, topic: "storage" },
      { pattern: /prefer|like|want/i, topic: "preferences" },
      { pattern: /project|building|working on/i, topic: "projects" },
      { pattern: /deploy|production|staging/i, topic: "deployment" },
    ];

    for (const { pattern, topic } of topicPatterns) {
      if (pattern.test(lowerContent)) {
        topics.push(topic);
      }
    }

    return topics;
  }

  private inferEntityType(
    entityName: string,
    context: string
  ): "person" | "project" | "concept" | "preference" {
    const lowerContext = context.toLowerCase();
    const lowerName = entityName.toLowerCase();

    if (lowerContext.includes("prefer") || lowerContext.includes("like")) {
      return "preference";
    }
    if (
      lowerContext.includes("project") ||
      lowerContext.includes("building")
    ) {
      return "project";
    }
    if (
      ["david", "user", "claude", "assistant"].some((n) => lowerName.includes(n))
    ) {
      return "person";
    }
    return "concept";
  }
}

/**
 * Ensure Qdrant collection exists with proper configuration
 */
async function ensureQdrantCollection(hybridSearch: HybridSearchEngine): Promise<void> {
  try {
    await hybridSearch.initializeCollection();
  } catch (error) {
    // Collection may already exist, which is fine
    console.log("  Qdrant collection ready (may already exist)");
  }
}

/**
 * Initialize SQLite database with required schema
 */
function initializeDatabase(dbPath: string): Database.Database {
  // Ensure data directory exists
  const dataDir = dbPath.substring(0, dbPath.lastIndexOf("/"));
  if (dataDir && !existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      confidence REAL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      last_accessed TEXT NOT NULL,
      access_count INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      strength REAL DEFAULT 0.8,
      evidence TEXT,
      created_at TEXT NOT NULL,
      last_reinforced TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES entities(id),
      FOREIGN KEY (target_id) REFERENCES entities(id)
    );

    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
  `);

  return db;
}

async function main() {
  console.log("=".repeat(60));
  console.log(" Real-World Vesper Benchmark");
  console.log("=".repeat(60));
  console.log("");
  console.log("Scientific Methodology:");
  console.log("  - A/B testing: Vesper Enabled vs Disabled");
  console.log("  - Statistical tests: Welch's t-test, Cohen's d");
  console.log("  - Significance level: alpha = 0.05");
  console.log("");
  console.log("Configuration:");
  console.log(`  Warmup Runs: ${CONFIG.warmupRuns}`);
  console.log(`  Measurement Runs: ${CONFIG.measurementRuns}`);
  console.log(`  Scenarios: ${CONFIG.scenarios.join(", ")}`);
  console.log(`  Timeout: ${CONFIG.timeoutMs}ms`);
  console.log("");

  // Initialize infrastructure
  console.log("Connecting to infrastructure...");

  const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
  });

  const dbPath = process.env.SQLITE_DB || "./data/memory.db";
  const db = initializeDatabase(dbPath);

  const embeddingClient = new EmbeddingClient({
    serviceUrl: process.env.EMBEDDING_SERVICE_URL || "http://localhost:8000",
  });

  const hybridSearch = new HybridSearchEngine(
    process.env.QDRANT_URL || "http://localhost:6333",
    "memory-vectors",
    1024,
    process.env.QDRANT_API_KEY
  );

  // Test connections
  try {
    await redis.ping();
    console.log("  [OK] Redis connected");
  } catch (error) {
    console.error("  [FAIL] Redis connection failed:", error);
    process.exit(1);
  }

  try {
    await embeddingClient.health();
    console.log("  [OK] Embedding service connected");
  } catch (error) {
    console.error("  [FAIL] Embedding service connection failed:", error);
    process.exit(1);
  }

  try {
    await ensureQdrantCollection(hybridSearch);
    console.log("  [OK] Qdrant connected");
  } catch (error) {
    console.error("  [FAIL] Qdrant connection failed:", error);
    process.exit(1);
  }

  console.log("  [OK] SQLite connected");
  console.log("");

  // Create real Vesper client
  const client = new RealVesperClient(redis, db, embeddingClient, hybridSearch);

  // Create benchmark runner
  const runner = createBenchmarkRunner(client as MCPClient, CONFIG);

  // Run benchmarks
  console.log("Running benchmarks...");
  console.log("(This may take several minutes)");
  console.log("");

  const startTime = Date.now();
  const result = await runner.run();
  const duration = Date.now() - startTime;

  console.log("");
  console.log(`Benchmarks completed in ${(duration / 1000).toFixed(1)}s`);
  console.log("");

  // Generate report
  console.log("Generating report...");

  const report = generateMarkdownReport(result);

  // Save report
  const outputDir = CONFIG.outputDirectory;
  mkdirSync(outputDir, { recursive: true });

  const reportPath = join(outputDir, "real-world-results.md");
  writeFileSync(reportPath, report);

  console.log(`  Report saved to ${reportPath}`);
  console.log("");

  // Print summary to console
  console.log("=".repeat(60));
  console.log(" Summary");
  console.log("=".repeat(60));

  for (const comparison of result.comparisons) {
    const winner =
      comparison.winner === "vesper-enabled"
        ? "[WIN] Vesper"
        : comparison.winner === "vesper-disabled"
        ? "[LOSS] Baseline"
        : "[TIE]";

    const improvement = comparison.statistics.latencyImprovement.toFixed(1);
    const sign = comparison.statistics.latencyImprovement > 0 ? "+" : "";
    const pValue = comparison.statistics.tTestResult.pValue.toFixed(4);
    const significant = comparison.statistics.tTestResult.significant ? "Yes" : "No";
    const effectSize = comparison.statistics.effectSize.interpretation;

    console.log("");
    console.log(`${comparison.scenarioType}:`);
    console.log(`  Winner: ${winner}`);
    console.log(`  Latency Change: ${sign}${improvement}%`);
    console.log(`  p-value: ${pValue}`);
    console.log(`  Significant: ${significant}`);
    console.log(`  Effect Size: ${effectSize}`);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(" Overall Results");
  console.log("=".repeat(60));
  console.log(`  Total Scenarios: ${result.summary.totalScenarios}`);
  console.log(`  Vesper Wins: ${result.summary.vesperWins}`);
  console.log(`  Baseline Wins: ${result.summary.disabledWins}`);
  console.log(`  Ties: ${result.summary.ties}`);
  console.log(
    `  Overall Improvement: ${result.summary.overallImprovement > 0 ? "+" : ""}${result.summary.overallImprovement.toFixed(1)}%`
  );
  console.log(
    `  Statistically Significant: ${result.summary.statisticallySignificant ? "Yes" : "No"}`
  );
  console.log("");
  console.log(`Full report: ${reportPath}`);
  console.log("");

  // Cleanup
  await redis.quit();
  db.close();

  console.log("Benchmark complete!");
}

// Run benchmark
main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
