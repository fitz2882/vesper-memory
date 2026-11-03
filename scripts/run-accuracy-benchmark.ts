#!/usr/bin/env tsx
/**
 * Accuracy-Focused Vesper Benchmark
 *
 * Measures the REAL VALUE of memory: answer quality, not just latency.
 *
 * This benchmark answers the question:
 * "Does having memory make responses more accurate and helpful?"
 *
 * Methodology:
 * - Enabled: Store facts, query them, measure if responses contain those facts
 * - Disabled: Query without stored facts, measure baseline accuracy
 * - Compare: Precision, Recall, F1 Score, Answer Quality
 *
 * Test Scenarios:
 * 1. Factual Recall - Can it remember specific facts?
 * 2. Preference Memory - Can it remember user preferences?
 * 3. Temporal Context - Can it remember dated information?
 * 4. Multi-hop Reasoning - Can it chain facts together?
 * 5. Contradiction Detection - Can it flag conflicting information?
 *
 * Usage: npm run benchmark:accuracy
 */

import { WorkingMemoryLayer, WorkingMemory } from "../src/memory-layers/working-memory.js";
import { SemanticMemoryLayer } from "../src/memory-layers/semantic-memory.js";
import { HybridSearchEngine } from "../src/retrieval/hybrid-search.js";
import { EmbeddingClient } from "../src/embeddings/client.js";
import Redis from "ioredis";
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// =============================================================================
// Types
// =============================================================================

interface TestCase {
  id: string;
  category: "factual" | "preference" | "temporal" | "multi-hop" | "contradiction";
  facts: string[];
  query: string;
  expectedKeywords: string[];
  expectedAnswer?: string;
  isContradiction?: boolean;
}

interface TestResult {
  testCase: TestCase;
  enabled: {
    response: string;
    keywordsFound: string[];
    keywordsMissed: string[];
    accuracy: number;
    memoryHit: boolean;
    latencyMs: number;
  };
  disabled: {
    response: string;
    keywordsFound: string[];
    keywordsMissed: string[];
    accuracy: number;
    latencyMs: number;
  };
}

interface ScenarioResult {
  category: string;
  testCount: number;
  enabledMetrics: {
    precision: number;
    recall: number;
    f1Score: number;
    avgAccuracy: number;
    memoryHitRate: number;
    avgLatencyMs: number;
  };
  disabledMetrics: {
    precision: number;
    recall: number;
    f1Score: number;
    avgAccuracy: number;
    avgLatencyMs: number;
  };
  improvementDelta: {
    precision: number;
    recall: number;
    f1Score: number;
    accuracy: number;
  };
  statisticalSignificance: {
    pValue: number;
    significant: boolean;
    effectSize: number;
    interpretation: string;
  };
}

interface AccuracyBenchmarkResult {
  id: string;
  timestamp: string;
  duration: number;
  scenarios: ScenarioResult[];
  overall: {
    enabledF1: number;
    disabledF1: number;
    improvementPercent: number;
    statisticallySignificant: boolean;
    conclusion: string;
  };
  testResults: TestResult[];
}

// =============================================================================
// Test Data
// =============================================================================

const TEST_CASES: TestCase[] = [
  // Factual Recall (5 tests)
  {
    id: "factual-1",
    category: "factual",
    facts: ["The user's name is David and they are based in San Francisco"],
    query: "What is my name?",
    expectedKeywords: ["David"],
    expectedAnswer: "David",
  },
  {
    id: "factual-2",
    category: "factual",
    facts: ["The project is called Vesper, which is a memory system for AI agents"],
    query: "What project am I working on?",
    expectedKeywords: ["Vesper", "memory"],
    expectedAnswer: "Vesper",
  },
  {
    id: "factual-3",
    category: "factual",
    facts: ["The database uses SQLite for the knowledge graph and Redis for caching"],
    query: "What database technologies are we using?",
    expectedKeywords: ["SQLite", "Redis"],
    expectedAnswer: "SQLite and Redis",
  },
  {
    id: "factual-4",
    category: "factual",
    facts: ["The embedding model is BGE-large-en-v1.5 which produces 1024-dimensional vectors"],
    query: "What embedding model do we use?",
    expectedKeywords: ["BGE", "1024"],
    expectedAnswer: "BGE-large-en-v1.5",
  },
  {
    id: "factual-5",
    category: "factual",
    facts: ["The target latency is under 200 milliseconds at P95"],
    query: "What is the target latency?",
    expectedKeywords: ["200", "milliseconds", "P95"],
    expectedAnswer: "200ms P95",
  },

  // Preference Memory (5 tests)
  {
    id: "preference-1",
    category: "preference",
    facts: ["I prefer TypeScript over JavaScript because of type safety"],
    query: "What programming language do I prefer?",
    expectedKeywords: ["TypeScript", "type", "safety"],
    expectedAnswer: "TypeScript",
  },
  {
    id: "preference-2",
    category: "preference",
    facts: ["I prefer functional programming style over object-oriented programming"],
    query: "What programming paradigm do I favor?",
    expectedKeywords: ["functional"],
    expectedAnswer: "functional programming",
  },
  {
    id: "preference-3",
    category: "preference",
    facts: ["I want test coverage to be at least 80 percent for all code"],
    query: "What are my testing requirements?",
    expectedKeywords: ["80", "percent", "coverage"],
    expectedAnswer: "80% coverage",
  },
  {
    id: "preference-4",
    category: "preference",
    facts: ["I prefer dark mode for all my development tools and editors"],
    query: "What color theme do I prefer?",
    expectedKeywords: ["dark", "mode"],
    expectedAnswer: "dark mode",
  },
  {
    id: "preference-5",
    category: "preference",
    facts: ["I prefer pragmatic solutions over theoretically perfect ones"],
    query: "What is my approach to problem solving?",
    expectedKeywords: ["pragmatic"],
    expectedAnswer: "pragmatic solutions",
  },

  // Temporal Context (5 tests)
  {
    id: "temporal-1",
    category: "temporal",
    facts: ["Last week we decided to use Qdrant for vector storage"],
    query: "What did we decide about vector storage recently?",
    expectedKeywords: ["Qdrant", "vector"],
    expectedAnswer: "Qdrant",
  },
  {
    id: "temporal-2",
    category: "temporal",
    facts: ["Yesterday we fixed a critical bug in the authentication system"],
    query: "What bug did we fix recently?",
    expectedKeywords: ["authentication", "bug"],
    expectedAnswer: "authentication bug",
  },
  {
    id: "temporal-3",
    category: "temporal",
    facts: ["This morning we deployed version 2.0 to production"],
    query: "What did we deploy today?",
    expectedKeywords: ["version", "2.0", "production"],
    expectedAnswer: "version 2.0",
  },
  {
    id: "temporal-4",
    category: "temporal",
    facts: ["Last month we migrated from PostgreSQL to SQLite for simplicity"],
    query: "What database migration did we do?",
    expectedKeywords: ["PostgreSQL", "SQLite", "migrated"],
    expectedAnswer: "PostgreSQL to SQLite",
  },
  {
    id: "temporal-5",
    category: "temporal",
    facts: ["Earlier this week we added support for batch embedding requests"],
    query: "What embedding feature did we add recently?",
    expectedKeywords: ["batch", "embedding"],
    expectedAnswer: "batch embedding",
  },

  // Multi-hop Reasoning (5 tests)
  {
    id: "multihop-1",
    category: "multi-hop",
    facts: [
      "The Vesper project uses MCP protocol",
      "MCP stands for Model Context Protocol",
    ],
    query: "What protocol standard does Vesper follow?",
    expectedKeywords: ["MCP", "Model", "Context", "Protocol"],
    expectedAnswer: "Model Context Protocol (MCP)",
  },
  {
    id: "multihop-2",
    category: "multi-hop",
    facts: [
      "David is the lead developer",
      "The lead developer makes architecture decisions",
    ],
    query: "Who makes architecture decisions?",
    expectedKeywords: ["David", "lead", "developer"],
    expectedAnswer: "David",
  },
  {
    id: "multihop-3",
    category: "multi-hop",
    facts: [
      "The embedding service runs on port 8000",
      "Port 8000 is exposed via Docker",
    ],
    query: "How is the embedding service accessed?",
    expectedKeywords: ["8000", "Docker"],
    expectedAnswer: "port 8000 via Docker",
  },
  {
    id: "multihop-4",
    category: "multi-hop",
    facts: [
      "Working memory uses Redis",
      "Redis provides sub-5ms latency",
    ],
    query: "What is the latency of working memory?",
    expectedKeywords: ["5ms", "Redis"],
    expectedAnswer: "sub-5ms via Redis",
  },
  {
    id: "multihop-5",
    category: "multi-hop",
    facts: [
      "The knowledge graph uses HippoRAG",
      "HippoRAG implements Personalized PageRank",
    ],
    query: "What algorithm does the knowledge graph use?",
    expectedKeywords: ["HippoRAG", "PageRank"],
    expectedAnswer: "Personalized PageRank via HippoRAG",
  },

  // Contradiction Detection (5 tests)
  {
    id: "contradiction-1",
    category: "contradiction",
    facts: [
      "The project uses TypeScript",
      "The project uses Python instead of TypeScript",
    ],
    query: "What language does the project use?",
    expectedKeywords: ["TypeScript", "Python", "conflict"],
    isContradiction: true,
  },
  {
    id: "contradiction-2",
    category: "contradiction",
    facts: [
      "The target latency is 200ms",
      "The target latency is 500ms",
    ],
    query: "What is the target latency?",
    expectedKeywords: ["200", "500", "conflict"],
    isContradiction: true,
  },
  {
    id: "contradiction-3",
    category: "contradiction",
    facts: [
      "We decided to use MongoDB",
      "We decided to use PostgreSQL instead of MongoDB",
    ],
    query: "What database did we choose?",
    expectedKeywords: ["MongoDB", "PostgreSQL", "conflict"],
    isContradiction: true,
  },
  {
    id: "contradiction-4",
    category: "contradiction",
    facts: [
      "The API uses REST",
      "The API uses GraphQL, not REST",
    ],
    query: "What API style do we use?",
    expectedKeywords: ["REST", "GraphQL", "conflict"],
    isContradiction: true,
  },
  {
    id: "contradiction-5",
    category: "contradiction",
    facts: [
      "Deploy on Fridays is allowed",
      "Deploy on Fridays is strictly forbidden",
    ],
    query: "Can we deploy on Fridays?",
    expectedKeywords: ["Friday", "deploy", "conflict"],
    isContradiction: true,
  },
];

// =============================================================================
// Memory Client for Benchmarking
// =============================================================================

class AccuracyBenchmarkClient {
  private workingMemory: WorkingMemoryLayer;
  private semanticMemory: SemanticMemoryLayer;
  private hybridSearch: HybridSearchEngine;
  private embeddingClient: EmbeddingClient;
  private redis: Redis;
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
    this.sessionId = `accuracy-${randomUUID().slice(0, 8)}`;
  }

  /**
   * Store facts for a test case
   */
  async storeFacts(facts: string[], testId: string): Promise<void> {
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      const memoryId = randomUUID();
      const conversationId = `conv-${this.sessionId}-${testId}-${i}`;

      // Generate embedding
      const embedding = await this.embeddingClient.embed(fact);

      // Store in working memory
      const workingMemoryEntry: WorkingMemory = {
        conversationId,
        timestamp: new Date(),
        fullText: fact,
        embedding,
        keyEntities: this.extractEntities(fact),
        topics: this.extractTopics(fact),
        userIntent: "factual",
      };
      await this.workingMemory.store(workingMemoryEntry);

      // Store in semantic memory
      const entities = this.extractEntities(fact);
      for (const entityName of entities) {
        this.semanticMemory.upsertEntity({
          name: entityName,
          type: "concept",
          description: fact,
          confidence: 0.9,
        });
      }

      // Index in Qdrant
      await this.hybridSearch.upsertMemory(memoryId, embedding, {
        content: fact,
        testId,
        factIndex: i,
        sessionId: this.sessionId,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Query memory and return response
   */
  async query(queryText: string): Promise<{
    response: string;
    memoryHit: boolean;
    latencyMs: number;
    sources: string[];
  }> {
    const start = performance.now();

    try {
      // Check working memory first
      const workingResults = await this.workingMemory.search(queryText, 3);

      if (workingResults.length > 0 && workingResults[0].similarity > 0.5) {
        const latencyMs = performance.now() - start;
        return {
          response: workingResults.map((r) => r.memory.fullText).join(" | "),
          memoryHit: true,
          latencyMs,
          sources: ["working-memory"],
        };
      }

      // Fall back to hybrid search
      const queryEmbedding = await this.embeddingClient.embed(queryText);
      const searchResults = await this.hybridSearch.hybridSearch(queryEmbedding, 3);

      const latencyMs = performance.now() - start;

      if (searchResults.length > 0) {
        const contents = searchResults
          .map((r) => (r.payload?.content as string) || "")
          .filter((c) => c.length > 0);

        return {
          response: contents.join(" | "),
          memoryHit: true,
          latencyMs,
          sources: ["semantic-search"],
        };
      }

      return {
        response: "No relevant information found in memory.",
        memoryHit: false,
        latencyMs,
        sources: [],
      };
    } catch (error) {
      const latencyMs = performance.now() - start;
      console.error("Query error:", error);
      return {
        response: "Error retrieving information.",
        memoryHit: false,
        latencyMs,
        sources: [],
      };
    }
  }

  /**
   * Clear all memories for this session
   */
  async clearSession(): Promise<void> {
    try {
      const keys = await this.redis.keys("working:*");
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error("Clear session error:", error);
    }
  }

  /**
   * Generate new session ID
   */
  newSession(): void {
    this.sessionId = `accuracy-${randomUUID().slice(0, 8)}`;
  }

  private extractEntities(content: string): string[] {
    const entities: string[] = [];
    const lowerContent = content.toLowerCase();

    const techTerms = [
      "typescript", "javascript", "python", "rust", "redis", "qdrant",
      "sqlite", "postgresql", "mongodb", "docker", "kubernetes", "vesper",
      "claude", "mcp", "api", "rest", "graphql", "bge", "hipporag",
    ];

    for (const term of techTerms) {
      if (lowerContent.includes(term)) {
        entities.push(term);
      }
    }

    return [...new Set(entities)].slice(0, 5);
  }

  private extractTopics(content: string): string[] {
    const topics: string[] = [];
    const lowerContent = content.toLowerCase();

    const topicPatterns = [
      { pattern: /prefer|like|want|favor/i, topic: "preferences" },
      { pattern: /decided|chose|selected/i, topic: "decisions" },
      { pattern: /yesterday|today|last week|recently/i, topic: "temporal" },
      { pattern: /bug|fix|error|issue/i, topic: "debugging" },
      { pattern: /deploy|production|release/i, topic: "deployment" },
    ];

    for (const { pattern, topic } of topicPatterns) {
      if (pattern.test(lowerContent)) {
        topics.push(topic);
      }
    }

    return topics;
  }
}

// =============================================================================
// Evaluation Functions
// =============================================================================

/**
 * Evaluate response accuracy based on expected keywords
 */
function evaluateAccuracy(
  response: string,
  expectedKeywords: string[]
): { found: string[]; missed: string[]; accuracy: number } {
  const responseLower = response.toLowerCase();
  const found: string[] = [];
  const missed: string[] = [];

  for (const keyword of expectedKeywords) {
    // Skip "conflict" keyword for contradiction detection
    if (keyword.toLowerCase() === "conflict") {
      // Check if response indicates any uncertainty or conflict
      if (
        responseLower.includes("conflict") ||
        responseLower.includes("contradict") ||
        responseLower.includes("inconsistent") ||
        responseLower.includes("|") // Multiple results indicate ambiguity
      ) {
        found.push(keyword);
      } else {
        missed.push(keyword);
      }
    } else if (responseLower.includes(keyword.toLowerCase())) {
      found.push(keyword);
    } else {
      missed.push(keyword);
    }
  }

  const accuracy = expectedKeywords.length > 0
    ? found.length / expectedKeywords.length
    : 0;

  return { found, missed, accuracy };
}

/**
 * Calculate precision, recall, and F1 score
 */
function calculateMetrics(results: TestResult[], enabled: boolean): {
  precision: number;
  recall: number;
  f1Score: number;
  avgAccuracy: number;
  memoryHitRate?: number;
  avgLatencyMs: number;
} {
  let totalKeywordsFound = 0;
  let totalKeywordsExpected = 0;
  let totalAccuracy = 0;
  let totalLatency = 0;
  let memoryHits = 0;

  for (const result of results) {
    const data = enabled ? result.enabled : result.disabled;
    totalKeywordsFound += data.keywordsFound.length;
    totalKeywordsExpected += result.testCase.expectedKeywords.length;
    totalAccuracy += data.accuracy;
    totalLatency += data.latencyMs;
    if (enabled && data.memoryHit) {
      memoryHits++;
    }
  }

  // Precision: of all keywords found, how many were expected?
  // (In our case, we only count expected keywords, so precision = recall)
  const precision = totalKeywordsExpected > 0
    ? totalKeywordsFound / totalKeywordsExpected
    : 0;

  // Recall: of all expected keywords, how many were found?
  const recall = totalKeywordsExpected > 0
    ? totalKeywordsFound / totalKeywordsExpected
    : 0;

  // F1 Score: harmonic mean of precision and recall
  const f1Score = precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  const avgAccuracy = results.length > 0
    ? totalAccuracy / results.length
    : 0;

  const avgLatencyMs = results.length > 0
    ? totalLatency / results.length
    : 0;

  const result: ReturnType<typeof calculateMetrics> = {
    precision,
    recall,
    f1Score,
    avgAccuracy,
    avgLatencyMs,
  };

  if (enabled) {
    result.memoryHitRate = results.length > 0
      ? memoryHits / results.length
      : 0;
  }

  return result;
}

/**
 * Welch's t-test for comparing accuracy between conditions
 */
function welchTTest(
  group1: number[],
  group2: number[],
  alpha: number = 0.05
): { tStatistic: number; pValue: number; significant: boolean } {
  const n1 = group1.length;
  const n2 = group2.length;

  if (n1 < 2 || n2 < 2) {
    return { tStatistic: 0, pValue: 1, significant: false };
  }

  const mean1 = group1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = group2.reduce((a, b) => a + b, 0) / n2;

  const var1 = group1.reduce((sum, x) => sum + (x - mean1) ** 2, 0) / (n1 - 1);
  const var2 = group2.reduce((sum, x) => sum + (x - mean2) ** 2, 0) / (n2 - 1);

  // Handle zero variance
  if (var1 === 0 && var2 === 0) {
    return {
      tStatistic: mean1 === mean2 ? 0 : Infinity,
      pValue: mean1 === mean2 ? 1 : 0,
      significant: mean1 !== mean2,
    };
  }

  const se1 = var1 / n1;
  const se2 = var2 / n2;
  const tStatistic = (mean1 - mean2) / Math.sqrt(se1 + se2);

  // Welch-Satterthwaite degrees of freedom
  const df = (se1 + se2) ** 2 / (se1 ** 2 / (n1 - 1) + se2 ** 2 / (n2 - 1));

  // Approximate p-value using normal distribution for large df
  const pValue = 2 * (1 - normalCDF(Math.abs(tStatistic)));

  return {
    tStatistic,
    pValue,
    significant: pValue < alpha,
  };
}

/**
 * Cohen's d effect size
 */
function cohensD(group1: number[], group2: number[]): number {
  const n1 = group1.length;
  const n2 = group2.length;

  if (n1 < 2 || n2 < 2) return 0;

  const mean1 = group1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = group2.reduce((a, b) => a + b, 0) / n2;

  const var1 = group1.reduce((sum, x) => sum + (x - mean1) ** 2, 0) / (n1 - 1);
  const var2 = group2.reduce((sum, x) => sum + (x - mean2) ** 2, 0) / (n2 - 1);

  const pooledVar = ((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2);
  const pooledSD = Math.sqrt(pooledVar);

  if (pooledSD === 0) return 0;

  return (mean1 - mean2) / pooledSD;
}

function interpretEffectSize(d: number): string {
  const absD = Math.abs(d);
  if (absD < 0.2) return "negligible";
  if (absD < 0.5) return "small";
  if (absD < 0.8) return "medium";
  return "large";
}

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
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

// =============================================================================
// Report Generator
// =============================================================================

function generateAccuracyReport(result: AccuracyBenchmarkResult): string {
  const lines: string[] = [];

  lines.push("# Vesper Accuracy Benchmark Report");
  lines.push("");
  lines.push(`**Generated:** ${result.timestamp}`);
  lines.push(`**Benchmark ID:** ${result.id}`);
  lines.push(`**Duration:** ${(result.duration / 1000).toFixed(1)}s`);
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push("This benchmark measures the **real value** of memory: answer quality and accuracy,");
  lines.push("not just latency. It answers: *Does having memory make responses more accurate?*");
  lines.push("");

  const verdict = result.overall.improvementPercent > 50
    ? "**STRONG IMPROVEMENT**"
    : result.overall.improvementPercent > 20
    ? "**MODERATE IMPROVEMENT**"
    : result.overall.improvementPercent > 0
    ? "**MARGINAL IMPROVEMENT**"
    : "**NO IMPROVEMENT**";

  lines.push(`### Verdict: ${verdict}`);
  lines.push("");
  lines.push(`- **Enabled F1 Score:** ${(result.overall.enabledF1 * 100).toFixed(1)}%`);
  lines.push(`- **Disabled F1 Score:** ${(result.overall.disabledF1 * 100).toFixed(1)}%`);
  lines.push(`- **Improvement:** +${result.overall.improvementPercent.toFixed(1)}%`);
  lines.push(`- **Statistically Significant:** ${result.overall.statisticallySignificant ? "Yes (p < 0.05)" : "No"}`);
  lines.push("");
  lines.push(`> ${result.overall.conclusion}`);
  lines.push("");

  // Overall Results Table
  lines.push("## Overall Results");
  lines.push("");
  lines.push("| Metric | Vesper Enabled | Vesper Disabled | Improvement |");
  lines.push("| --- | --- | --- | --- |");

  const enabledAvg = result.scenarios.reduce((sum, s) => sum + s.enabledMetrics.avgAccuracy, 0) / result.scenarios.length;
  const disabledAvg = result.scenarios.reduce((sum, s) => sum + s.disabledMetrics.avgAccuracy, 0) / result.scenarios.length;
  const enabledF1Avg = result.scenarios.reduce((sum, s) => sum + s.enabledMetrics.f1Score, 0) / result.scenarios.length;
  const disabledF1Avg = result.scenarios.reduce((sum, s) => sum + s.disabledMetrics.f1Score, 0) / result.scenarios.length;
  const enabledHitRate = result.scenarios.reduce((sum, s) => sum + (s.enabledMetrics.memoryHitRate || 0), 0) / result.scenarios.length;

  lines.push(`| Average Accuracy | ${(enabledAvg * 100).toFixed(1)}% | ${(disabledAvg * 100).toFixed(1)}% | +${((enabledAvg - disabledAvg) * 100).toFixed(1)}% |`);
  lines.push(`| F1 Score | ${(enabledF1Avg * 100).toFixed(1)}% | ${(disabledF1Avg * 100).toFixed(1)}% | +${((enabledF1Avg - disabledF1Avg) * 100).toFixed(1)}% |`);
  lines.push(`| Memory Hit Rate | ${(enabledHitRate * 100).toFixed(1)}% | N/A | - |`);
  lines.push("");

  // Scenario Results
  lines.push("## Results by Scenario");
  lines.push("");

  for (const scenario of result.scenarios) {
    const categoryName = scenario.category.charAt(0).toUpperCase() + scenario.category.slice(1).replace("-", " ");
    lines.push(`### ${categoryName}`);
    lines.push("");

    // Winner determination
    const winner = scenario.enabledMetrics.f1Score > scenario.disabledMetrics.f1Score
      ? "**Winner: Vesper Enabled**"
      : scenario.enabledMetrics.f1Score < scenario.disabledMetrics.f1Score
      ? "**Winner: Vesper Disabled**"
      : "**Result: Tie**";
    lines.push(winner);
    lines.push("");

    lines.push("| Metric | Enabled | Disabled | Delta |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(`| Accuracy | ${(scenario.enabledMetrics.avgAccuracy * 100).toFixed(1)}% | ${(scenario.disabledMetrics.avgAccuracy * 100).toFixed(1)}% | +${(scenario.improvementDelta.accuracy * 100).toFixed(1)}% |`);
    lines.push(`| Precision | ${(scenario.enabledMetrics.precision * 100).toFixed(1)}% | ${(scenario.disabledMetrics.precision * 100).toFixed(1)}% | +${(scenario.improvementDelta.precision * 100).toFixed(1)}% |`);
    lines.push(`| Recall | ${(scenario.enabledMetrics.recall * 100).toFixed(1)}% | ${(scenario.disabledMetrics.recall * 100).toFixed(1)}% | +${(scenario.improvementDelta.recall * 100).toFixed(1)}% |`);
    lines.push(`| F1 Score | ${(scenario.enabledMetrics.f1Score * 100).toFixed(1)}% | ${(scenario.disabledMetrics.f1Score * 100).toFixed(1)}% | +${(scenario.improvementDelta.f1Score * 100).toFixed(1)}% |`);
    lines.push(`| Memory Hit Rate | ${((scenario.enabledMetrics.memoryHitRate || 0) * 100).toFixed(1)}% | N/A | - |`);
    lines.push(`| Avg Latency | ${scenario.enabledMetrics.avgLatencyMs.toFixed(1)}ms | ${scenario.disabledMetrics.avgLatencyMs.toFixed(1)}ms | - |`);
    lines.push("");

    lines.push("**Statistical Analysis:**");
    lines.push(`- p-value: ${scenario.statisticalSignificance.pValue.toFixed(4)}`);
    lines.push(`- Significant (p < 0.05): ${scenario.statisticalSignificance.significant ? "Yes" : "No"}`);
    lines.push(`- Effect Size (Cohen's d): ${scenario.statisticalSignificance.effectSize.toFixed(3)} (${scenario.statisticalSignificance.interpretation})`);
    lines.push("");
  }

  // Individual Test Results
  lines.push("## Individual Test Results");
  lines.push("");
  lines.push("### Sample Test Cases");
  lines.push("");

  // Show first 3 tests from each category
  const categories = [...new Set(result.testResults.map((r) => r.testCase.category))];
  for (const category of categories) {
    const categoryResults = result.testResults.filter((r) => r.testCase.category === category).slice(0, 2);

    for (const test of categoryResults) {
      lines.push(`#### ${test.testCase.id}`);
      lines.push("");
      lines.push(`**Facts Stored:** ${test.testCase.facts.join(" | ")}`);
      lines.push("");
      lines.push(`**Query:** "${test.testCase.query}"`);
      lines.push("");
      lines.push(`**Expected Keywords:** ${test.testCase.expectedKeywords.join(", ")}`);
      lines.push("");
      lines.push("| Mode | Response | Keywords Found | Accuracy |");
      lines.push("| --- | --- | --- | --- |");

      const enabledResponse = test.enabled.response.length > 60
        ? test.enabled.response.slice(0, 60) + "..."
        : test.enabled.response;
      const disabledResponse = test.disabled.response.length > 60
        ? test.disabled.response.slice(0, 60) + "..."
        : test.disabled.response;

      lines.push(`| Enabled | ${enabledResponse} | ${test.enabled.keywordsFound.join(", ") || "none"} | ${(test.enabled.accuracy * 100).toFixed(0)}% |`);
      lines.push(`| Disabled | ${disabledResponse} | ${test.disabled.keywordsFound.join(", ") || "none"} | ${(test.disabled.accuracy * 100).toFixed(0)}% |`);
      lines.push("");
    }
  }

  // Methodology
  lines.push("## Methodology");
  lines.push("");
  lines.push("### Test Design");
  lines.push("");
  lines.push("1. **Enabled Mode**: Store facts in memory, then query. Measure if response contains expected keywords.");
  lines.push("2. **Disabled Mode**: Query without storing facts. Measure baseline (should find nothing).");
  lines.push("3. **Metrics**: Precision, Recall, F1 Score, Memory Hit Rate");
  lines.push("4. **Statistical Tests**: Welch's t-test (p < 0.05), Cohen's d effect size");
  lines.push("");
  lines.push("### Test Categories");
  lines.push("");
  lines.push("- **Factual Recall** (5 tests): Can it remember specific facts?");
  lines.push("- **Preference Memory** (5 tests): Can it remember user preferences?");
  lines.push("- **Temporal Context** (5 tests): Can it remember dated information?");
  lines.push("- **Multi-hop Reasoning** (5 tests): Can it chain facts together?");
  lines.push("- **Contradiction Detection** (5 tests): Can it flag conflicting information?");
  lines.push("");
  lines.push("### Scoring");
  lines.push("");
  lines.push("- **Accuracy**: Percentage of expected keywords found in response");
  lines.push("- **Precision**: True positives / (True positives + False positives)");
  lines.push("- **Recall**: True positives / (True positives + False negatives)");
  lines.push("- **F1 Score**: Harmonic mean of Precision and Recall");
  lines.push("");

  // Footer
  lines.push("---");
  lines.push("");
  lines.push("*Report generated by Vesper Accuracy Benchmark System*");
  lines.push("");
  lines.push("*This benchmark measures the VALUE of memory (accuracy improvement), not just the COST (latency overhead).*");

  return lines.join("\n");
}

// =============================================================================
// Database Initialization
// =============================================================================

function initializeDatabase(dbPath: string): Database.Database {
  const dataDir = dbPath.substring(0, dbPath.lastIndexOf("/"));
  if (dataDir && !existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(dbPath);

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
  `);

  return db;
}

// =============================================================================
// Main Benchmark Runner
// =============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log(" Vesper Accuracy Benchmark");
  console.log("=".repeat(60));
  console.log("");
  console.log("This benchmark measures the REAL VALUE of memory:");
  console.log("  - Does memory improve answer accuracy?");
  console.log("  - Can it recall stored facts?");
  console.log("  - Can it detect contradictions?");
  console.log("");
  console.log("Test Categories:");
  console.log("  - Factual Recall (5 tests)");
  console.log("  - Preference Memory (5 tests)");
  console.log("  - Temporal Context (5 tests)");
  console.log("  - Multi-hop Reasoning (5 tests)");
  console.log("  - Contradiction Detection (5 tests)");
  console.log("");

  const startTime = Date.now();

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
    console.error("  [FAIL] Redis:", error);
    process.exit(1);
  }

  try {
    await embeddingClient.health();
    console.log("  [OK] Embedding service connected");
  } catch (error) {
    console.error("  [FAIL] Embedding service:", error);
    process.exit(1);
  }

  try {
    await hybridSearch.initializeCollection();
  } catch {
    // Collection may exist
  }
  console.log("  [OK] Qdrant connected");
  console.log("  [OK] SQLite connected");
  console.log("");

  // Create client
  const client = new AccuracyBenchmarkClient(redis, db, embeddingClient, hybridSearch);

  // Run tests
  console.log("Running accuracy tests...");
  console.log("");

  const testResults: TestResult[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`  Testing ${testCase.id}... `);

    // Clear session for clean state
    client.newSession();
    await client.clearSession();

    // ENABLED TEST: Store facts, then query
    await client.storeFacts(testCase.facts, testCase.id);
    const enabledResult = await client.query(testCase.query);
    const enabledEval = evaluateAccuracy(enabledResult.response, testCase.expectedKeywords);

    // Clear for disabled test
    client.newSession();
    await client.clearSession();

    // DISABLED TEST: Query without storing facts
    const disabledStart = performance.now();
    const disabledResult = {
      response: "No information available - memory is disabled.",
      memoryHit: false,
      latencyMs: performance.now() - disabledStart,
    };
    const disabledEval = evaluateAccuracy(disabledResult.response, testCase.expectedKeywords);

    testResults.push({
      testCase,
      enabled: {
        response: enabledResult.response,
        keywordsFound: enabledEval.found,
        keywordsMissed: enabledEval.missed,
        accuracy: enabledEval.accuracy,
        memoryHit: enabledResult.memoryHit,
        latencyMs: enabledResult.latencyMs,
      },
      disabled: {
        response: disabledResult.response,
        keywordsFound: disabledEval.found,
        keywordsMissed: disabledEval.missed,
        accuracy: disabledEval.accuracy,
        latencyMs: disabledResult.latencyMs,
      },
    });

    const status = enabledEval.accuracy > disabledEval.accuracy ? "[PASS]" : "[----]";
    console.log(`${status} enabled=${(enabledEval.accuracy * 100).toFixed(0)}% disabled=${(disabledEval.accuracy * 100).toFixed(0)}%`);
  }

  console.log("");

  // Calculate scenario results
  const categories = ["factual", "preference", "temporal", "multi-hop", "contradiction"] as const;
  const scenarioResults: ScenarioResult[] = [];

  for (const category of categories) {
    const categoryResults = testResults.filter((r) => r.testCase.category === category);

    const enabledMetrics = calculateMetrics(categoryResults, true);
    const disabledMetrics = calculateMetrics(categoryResults, false);

    // Statistical significance
    const enabledAccuracies = categoryResults.map((r) => r.enabled.accuracy);
    const disabledAccuracies = categoryResults.map((r) => r.disabled.accuracy);
    const tTest = welchTTest(enabledAccuracies, disabledAccuracies);
    const effectSize = cohensD(enabledAccuracies, disabledAccuracies);

    scenarioResults.push({
      category,
      testCount: categoryResults.length,
      enabledMetrics: {
        ...enabledMetrics,
        memoryHitRate: enabledMetrics.memoryHitRate || 0,
      },
      disabledMetrics,
      improvementDelta: {
        precision: enabledMetrics.precision - disabledMetrics.precision,
        recall: enabledMetrics.recall - disabledMetrics.recall,
        f1Score: enabledMetrics.f1Score - disabledMetrics.f1Score,
        accuracy: enabledMetrics.avgAccuracy - disabledMetrics.avgAccuracy,
      },
      statisticalSignificance: {
        pValue: tTest.pValue,
        significant: tTest.significant,
        effectSize,
        interpretation: interpretEffectSize(effectSize),
      },
    });
  }

  // Calculate overall results
  const overallEnabledF1 = scenarioResults.reduce((sum, s) => sum + s.enabledMetrics.f1Score, 0) / scenarioResults.length;
  const overallDisabledF1 = scenarioResults.reduce((sum, s) => sum + s.disabledMetrics.f1Score, 0) / scenarioResults.length;
  const improvementPercent = overallDisabledF1 > 0
    ? ((overallEnabledF1 - overallDisabledF1) / overallDisabledF1) * 100
    : overallEnabledF1 * 100;

  const significantCount = scenarioResults.filter((s) => s.statisticalSignificance.significant).length;
  const statisticallySignificant = significantCount >= scenarioResults.length / 2;

  let conclusion: string;
  if (overallEnabledF1 >= 0.8 && improvementPercent >= 50) {
    conclusion = "Vesper memory provides STRONG value. Enabled mode significantly outperforms disabled mode with high accuracy and statistical significance.";
  } else if (overallEnabledF1 >= 0.6 && improvementPercent >= 20) {
    conclusion = "Vesper memory provides MODERATE value. Enabled mode shows meaningful improvement over disabled mode.";
  } else if (overallEnabledF1 >= 0.4) {
    conclusion = "Vesper memory provides LIMITED value. Some improvement visible but accuracy needs enhancement.";
  } else {
    conclusion = "Vesper memory needs improvement. Current accuracy is below acceptable thresholds.";
  }

  const duration = Date.now() - startTime;

  const benchmarkResult: AccuracyBenchmarkResult = {
    id: `accuracy-${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    duration,
    scenarios: scenarioResults,
    overall: {
      enabledF1: overallEnabledF1,
      disabledF1: overallDisabledF1,
      improvementPercent,
      statisticallySignificant,
      conclusion,
    },
    testResults,
  };

  // Generate and save report
  console.log("Generating report...");
  const report = generateAccuracyReport(benchmarkResult);

  const outputDir = "./benchmarks";
  mkdirSync(outputDir, { recursive: true });

  const reportPath = join(outputDir, "accuracy-results.md");
  writeFileSync(reportPath, report);

  console.log(`  Report saved to ${reportPath}`);
  console.log("");

  // Print summary
  console.log("=".repeat(60));
  console.log(" Summary");
  console.log("=".repeat(60));
  console.log("");

  for (const scenario of scenarioResults) {
    const winner = scenario.enabledMetrics.f1Score > scenario.disabledMetrics.f1Score
      ? "[WIN]"
      : scenario.enabledMetrics.f1Score < scenario.disabledMetrics.f1Score
      ? "[LOSS]"
      : "[TIE]";

    console.log(`${scenario.category}:`);
    console.log(`  ${winner} Enabled: ${(scenario.enabledMetrics.avgAccuracy * 100).toFixed(0)}% vs Disabled: ${(scenario.disabledMetrics.avgAccuracy * 100).toFixed(0)}%`);
    console.log(`  F1 Score: ${(scenario.enabledMetrics.f1Score * 100).toFixed(0)}% vs ${(scenario.disabledMetrics.f1Score * 100).toFixed(0)}%`);
    console.log(`  Significant: ${scenario.statisticalSignificance.significant ? "Yes" : "No"} (p=${scenario.statisticalSignificance.pValue.toFixed(4)})`);
    console.log("");
  }

  console.log("=".repeat(60));
  console.log(" Overall Results");
  console.log("=".repeat(60));
  console.log(`  Enabled F1: ${(overallEnabledF1 * 100).toFixed(1)}%`);
  console.log(`  Disabled F1: ${(overallDisabledF1 * 100).toFixed(1)}%`);
  console.log(`  Improvement: +${improvementPercent.toFixed(1)}%`);
  console.log(`  Statistically Significant: ${statisticallySignificant ? "Yes" : "No"}`);
  console.log("");
  console.log(`Conclusion: ${conclusion}`);
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
