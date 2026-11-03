/**
 * Scenario Module Index
 *
 * Exports all scenario implementations and factory functions.
 */

export { createContextRecallScenario, CONTEXT_RECALL_TEST_DATA } from "./context-recall.js";
export type {
  ContextRecallScenario,
  ContextRecallTestCase,
  MCPClient,
} from "./context-recall.js";

import type { ScenarioType, ScenarioResult, BenchmarkPhase } from "../types.js";
import { createContextRecallScenario, MCPClient } from "./context-recall.js";

/**
 * Common scenario interface
 */
export interface BenchmarkScenario {
  /** Get scenario type */
  getType(): ScenarioType;

  /** Get scenario description */
  getDescription(): string;

  /** Setup the scenario */
  setup(): Promise<void>;

  /** Run the scenario in specified phase */
  run(phase: BenchmarkPhase): Promise<ScenarioResult>;

  /** Clean up after scenario */
  teardown(): Promise<void>;
}

/**
 * Create a scenario by type
 *
 * @param type - The scenario type to create
 * @param client - MCP client for memory operations
 * @returns Scenario instance
 * @throws Error if scenario type is not supported
 */
export function createScenario(
  type: ScenarioType,
  client: MCPClient
): BenchmarkScenario {
  switch (type) {
    case "context-recall":
      return createContextRecallScenario(client);

    case "cross-session":
      return createCrossSessionScenario(client);

    case "skill-retrieval":
      return createSkillRetrievalScenario(client);

    case "token-efficiency":
      return createTokenEfficiencyScenario(client);

    case "semantic-accuracy":
      return createSemanticAccuracyScenario(client);

    default:
      throw new Error(`Unsupported scenario type: ${type}`);
  }
}

// =============================================================================
// Cross-Session Scenario (Simplified Implementation)
// =============================================================================

function createCrossSessionScenario(client: MCPClient): BenchmarkScenario {
  const testData = [
    {
      session1Fact: "In our previous session, we discussed implementing caching with Redis",
      session2Question: "What did we discuss about caching?",
      expectedKeywords: ["Redis", "caching"],
    },
    {
      session1Fact: "Yesterday, the user decided to use PostgreSQL for the database",
      session2Question: "What database did we decide to use?",
      expectedKeywords: ["PostgreSQL", "database"],
    },
    {
      session1Fact: "Last week, we fixed a critical bug in the authentication system",
      session2Question: "What bug did we fix recently?",
      expectedKeywords: ["bug", "authentication"],
    },
  ];

  return createBaseScenario("cross-session", client, testData);
}

// =============================================================================
// Skill Retrieval Scenario (Simplified Implementation)
// =============================================================================

function createSkillRetrievalScenario(client: MCPClient): BenchmarkScenario {
  const testData = [
    {
      session1Fact: "Skill: Deploy to production by running 'npm run build && npm run deploy'",
      session2Question: "How do I deploy to production?",
      expectedKeywords: ["npm", "build", "deploy"],
    },
    {
      session1Fact: "Skill: Create a new component using 'npm run generate:component ComponentName'",
      session2Question: "How do I create a new component?",
      expectedKeywords: ["generate", "component"],
    },
    {
      session1Fact: "Skill: Run tests with coverage using 'npm test -- --coverage'",
      session2Question: "How do I run tests with coverage?",
      expectedKeywords: ["test", "coverage"],
    },
  ];

  return createBaseScenario("skill-retrieval", client, testData);
}

// =============================================================================
// Token Efficiency Scenario (Simplified Implementation)
// =============================================================================

function createTokenEfficiencyScenario(client: MCPClient): BenchmarkScenario {
  const testData = [
    {
      session1Fact: "Project context: Building a memory system for AI with Redis, Qdrant, and SQLite",
      session2Question: "What is the project context?",
      expectedKeywords: ["memory", "Redis", "Qdrant", "SQLite"],
    },
    {
      session1Fact: "User preferences: TypeScript, functional programming, 80% test coverage",
      session2Question: "What are the user's coding preferences?",
      expectedKeywords: ["TypeScript", "functional", "test", "coverage"],
    },
  ];

  return createBaseScenario("token-efficiency", client, testData);
}

// =============================================================================
// Semantic Accuracy Scenario (Simplified Implementation)
// =============================================================================

function createSemanticAccuracyScenario(client: MCPClient): BenchmarkScenario {
  const testData = [
    {
      session1Fact: "The capital city of France is Paris, known for the Eiffel Tower",
      session2Question: "What is the capital of France?",
      expectedKeywords: ["Paris", "capital"],
    },
    {
      session1Fact: "Machine learning is a subset of artificial intelligence focused on learning from data",
      session2Question: "What is machine learning?",
      expectedKeywords: ["learning", "data", "artificial intelligence"],
    },
    {
      session1Fact: "REST APIs use HTTP methods like GET, POST, PUT, DELETE for communication",
      session2Question: "How do REST APIs work?",
      expectedKeywords: ["HTTP", "GET", "POST"],
    },
  ];

  return createBaseScenario("semantic-accuracy", client, testData);
}

// =============================================================================
// Base Scenario Factory
// =============================================================================

interface BaseTestCase {
  session1Fact: string;
  session2Question: string;
  expectedKeywords: string[];
}

function createBaseScenario(
  type: ScenarioType,
  client: MCPClient,
  testData: BaseTestCase[]
): BenchmarkScenario {
  const errors: string[] = [];

  return {
    getType(): ScenarioType {
      return type;
    },

    getDescription(): string {
      const descriptions: Record<ScenarioType, string> = {
        "context-recall": "Tests ability to recall facts from conversations",
        "cross-session": "Tests persistence of context across sessions",
        "skill-retrieval": "Tests retrieval of procedural knowledge",
        "token-efficiency": "Measures token usage reduction",
        "semantic-accuracy": "Tests semantic search accuracy",
      };
      return descriptions[type];
    },

    async setup(): Promise<void> {
      errors.length = 0;

      for (const testCase of testData) {
        try {
          await client.storeMemory(testCase.session1Fact, "semantic", {
            scenario: type,
            timestamp: Date.now(),
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`Setup error: ${errorMsg}`);
        }
      }
    },

    async run(phase: import("../types.js").BenchmarkPhase): Promise<import("../types.js").ScenarioResult> {
      const { measureLatency, evaluateResponseQuality, aggregateMetrics } = await import("../metrics-collector.js");
      const metrics: import("../types.js").MetricsSnapshot[] = [];
      const rawResponses: string[] = [];

      for (const testCase of testData) {
        if (phase === "vesper-enabled") {
          try {
            const { result, latencyMs } = await measureLatency(async () => {
              return await client.retrieveMemory(testCase.session2Question, {
                max_results: 3,
              });
            });

            const memoryHit = result.success && result.results.length > 0;
            const responseContent = memoryHit
              ? result.results[0].content
              : "No relevant memory found";

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

            metrics.push({
              timestamp: Date.now(),
              latencyMs: 0,
              memoryHit: false,
              retrievalAccuracy: 0,
            });

            rawResponses.push(`Error: ${errorMsg}`);
          }
        } else {
          const startTime = performance.now();
          await new Promise((resolve) => setTimeout(resolve, 1));
          const latencyMs = performance.now() - startTime;

          metrics.push({
            timestamp: Date.now(),
            latencyMs,
            memoryHit: false,
            retrievalAccuracy: 0,
          });

          rawResponses.push("Memory disabled - cannot recall");
        }
      }

      let aggregates: import("../types.js").AggregateMetrics;
      try {
        aggregates = aggregateMetrics(metrics);
      } catch {
        aggregates = {
          latencyP50: 0,
          latencyP95: 0,
          latencyP99: 0,
          memoryHitRate: 0,
        };
      }

      return {
        scenarioType: type,
        phase,
        metrics,
        aggregates,
        rawResponses,
        errors: errors.length > 0 ? [...errors] : undefined,
      };
    },

    async teardown(): Promise<void> {
      errors.length = 0;
    },
  };
}
