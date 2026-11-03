/**
 * Context Recall Scenario
 *
 * Tests the ability to recall facts from previous conversations.
 * This is the most basic memory scenario - can we remember what was said?
 */

import type {
  ScenarioType,
  ScenarioResult,
  BenchmarkPhase,
  MetricsSnapshot,
  AggregateMetrics,
} from "../types.js";
import {
  createMetricsCollector,
  measureLatency,
  evaluateResponseQuality,
  aggregateMetrics,
} from "../metrics-collector.js";

/**
 * Test case structure for context recall
 */
export interface ContextRecallTestCase {
  /** The fact to store */
  fact: string;
  /** The question to ask */
  question: string;
  /** Expected keywords in the response */
  expectedKeywords: string[];
  /** Category of the fact */
  category: "personal" | "project" | "preference" | "technical";
}

/**
 * Test data for context recall scenario
 */
export const CONTEXT_RECALL_TEST_DATA: ContextRecallTestCase[] = [
  {
    fact: "The user prefers TypeScript over JavaScript for type safety",
    question: "What programming language do I prefer?",
    expectedKeywords: ["TypeScript", "type safety"],
    category: "preference",
  },
  {
    fact: "The user is working on a project called Vesper, which is a memory system for AI",
    question: "What project am I currently working on?",
    expectedKeywords: ["Vesper", "memory"],
    category: "project",
  },
  {
    fact: "The user's name is David and they are based in San Francisco",
    question: "What is my name?",
    expectedKeywords: ["David"],
    category: "personal",
  },
  {
    fact: "The user wants test coverage above 80% for all code",
    question: "What are my testing requirements?",
    expectedKeywords: ["80%", "coverage", "test"],
    category: "technical",
  },
  {
    fact: "The user prefers functional programming style over object-oriented",
    question: "What programming paradigm do I prefer?",
    expectedKeywords: ["functional"],
    category: "preference",
  },
  {
    fact: "The user is collaborating with Claude on this project",
    question: "Who am I collaborating with?",
    expectedKeywords: ["Claude"],
    category: "personal",
  },
  {
    fact: "The target latency for the system is under 200ms P95",
    question: "What is the target latency for the system?",
    expectedKeywords: ["200ms", "P95", "latency"],
    category: "technical",
  },
  {
    fact: "The user emphasizes pragmatic solutions over theoretical perfection",
    question: "What is my approach to problem solving?",
    expectedKeywords: ["pragmatic"],
    category: "preference",
  },
];

/**
 * MCP Client interface for memory operations
 */
export interface MCPClient {
  storeMemory(
    content: string,
    memoryType: string,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; memory_id: string }>;

  retrieveMemory(
    query: string,
    options?: { max_results?: number }
  ): Promise<{
    success: boolean;
    results: Array<{ content: string; similarity_score: number }>;
  }>;
}

/**
 * Context Recall Scenario interface
 */
export interface ContextRecallScenario {
  /** Get scenario type */
  getType(): ScenarioType;

  /** Get scenario description */
  getDescription(): string;

  /** Setup the scenario (store initial facts) */
  setup(): Promise<void>;

  /** Run the scenario in specified phase */
  run(phase: BenchmarkPhase): Promise<ScenarioResult>;

  /** Clean up after scenario */
  teardown(): Promise<void>;
}

/**
 * Create a context recall scenario
 *
 * @param client - MCP client for memory operations
 * @returns ContextRecallScenario instance
 */
export function createContextRecallScenario(
  client: MCPClient
): ContextRecallScenario {
  const errors: string[] = [];

  return {
    getType(): ScenarioType {
      return "context-recall";
    },

    getDescription(): string {
      return "Tests ability to recall facts from previous conversations within the same session.";
    },

    async setup(): Promise<void> {
      errors.length = 0;

      // Store all facts as semantic memories
      for (const testCase of CONTEXT_RECALL_TEST_DATA) {
        try {
          await client.storeMemory(testCase.fact, "semantic", {
            category: testCase.category,
            timestamp: Date.now(),
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`Setup error storing fact: ${errorMsg}`);
        }
      }
    },

    async run(phase: BenchmarkPhase): Promise<ScenarioResult> {
      const metrics: MetricsSnapshot[] = [];
      const rawResponses: string[] = [];

      for (const testCase of CONTEXT_RECALL_TEST_DATA) {
        if (phase === "vesper-enabled") {
          // With Vesper enabled: retrieve from memory
          try {
            const { result, latencyMs } = await measureLatency(async () => {
              return await client.retrieveMemory(testCase.question, {
                max_results: 3,
              });
            });

            const memoryHit = result.success && result.results.length > 0;
            const responseContent = memoryHit
              ? result.results[0].content
              : "No relevant memory found";

            // Evaluate quality
            const retrievalAccuracy = memoryHit
              ? evaluateResponseQuality(responseContent, testCase.expectedKeywords, {
                  mode: "keywords",
                })
              : 0;

            metrics.push({
              timestamp: Date.now(),
              latencyMs,
              memoryHit,
              retrievalAccuracy,
            });

            rawResponses.push(responseContent);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            errors.push(`Run error: ${errorMsg}`);

            // Record failed attempt
            metrics.push({
              timestamp: Date.now(),
              latencyMs: 0,
              memoryHit: false,
              retrievalAccuracy: 0,
            });

            rawResponses.push(`Error: ${errorMsg}`);
          }
        } else {
          // With Vesper disabled: simulate no memory access
          const startTime = performance.now();

          // Simulate baseline latency (no memory lookup, just processing)
          await new Promise((resolve) => setTimeout(resolve, 1));

          const latencyMs = performance.now() - startTime;

          // Without memory, we can't recall the fact
          metrics.push({
            timestamp: Date.now(),
            latencyMs,
            memoryHit: false,
            retrievalAccuracy: 0,
          });

          rawResponses.push("Memory disabled - cannot recall");
        }
      }

      // Calculate aggregates
      let aggregates: AggregateMetrics;
      try {
        aggregates = aggregateMetrics(metrics);
      } catch (err) {
        // Fallback if aggregation fails
        aggregates = {
          latencyP50: 0,
          latencyP95: 0,
          latencyP99: 0,
          memoryHitRate: 0,
        };
      }

      return {
        scenarioType: "context-recall",
        phase,
        metrics,
        aggregates,
        rawResponses,
        errors: errors.length > 0 ? [...errors] : undefined,
      };
    },

    async teardown(): Promise<void> {
      errors.length = 0;
      // MCP client cleanup would happen at a higher level
    },
  };
}
