/**
 * Tests for All Scenarios and Factory
 *
 * TDD Phase 4b: Tests scenario factory and all scenario types.
 *
 * Coverage targets:
 * - Scenario factory creates correct types
 * - All scenarios follow common interface
 * - All scenarios collect metrics correctly
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createScenario,
  BenchmarkScenario,
} from "../../../src/benchmark/scenarios";
import type { ScenarioType, BenchmarkPhase } from "../../../src/benchmark/types";

// Mock MCP client for testing
interface MockMCPClient {
  storeMemory: (content: string, type: string, metadata?: object) => Promise<{ success: boolean; memory_id: string }>;
  retrieveMemory: (query: string) => Promise<{ success: boolean; results: Array<{ content: string; similarity_score: number }> }>;
  reset: () => void;
}

function createMockMCPClient(): MockMCPClient {
  const memories: Array<{ content: string; type: string }> = [];

  return {
    async storeMemory(content: string, type: string, metadata?: object) {
      memories.push({ content, type });
      return { success: true, memory_id: `mock-${memories.length}` };
    },

    async retrieveMemory(query: string) {
      const results = memories
        .filter((m) => {
          const queryWords = query.toLowerCase().split(/\s+/);
          return queryWords.some((word) =>
            word.length > 3 && m.content.toLowerCase().includes(word)
          );
        })
        .slice(0, 3)
        .map((m) => ({ content: m.content, similarity_score: 0.9 }));

      return { success: true, results };
    },

    reset() {
      memories.length = 0;
    },
  };
}

describe("Scenario Factory", () => {
  let mockClient: MockMCPClient;

  beforeEach(() => {
    mockClient = createMockMCPClient();
  });

  describe("createScenario", () => {
    const scenarioTypes: ScenarioType[] = [
      "context-recall",
      "cross-session",
      "skill-retrieval",
      "token-efficiency",
      "semantic-accuracy",
    ];

    it.each(scenarioTypes)("should create %s scenario", (type) => {
      const scenario = createScenario(type, mockClient as any);

      expect(scenario).toBeDefined();
      expect(scenario.getType()).toBe(type);
    });

    it("should throw for invalid scenario type", () => {
      expect(() => createScenario("invalid" as any, mockClient as any)).toThrow(
        "Unsupported scenario type"
      );
    });
  });

  describe("Common scenario interface", () => {
    const scenarioTypes: ScenarioType[] = [
      "context-recall",
      "cross-session",
      "skill-retrieval",
      "token-efficiency",
      "semantic-accuracy",
    ];

    it.each(scenarioTypes)("%s has correct interface methods", async (type) => {
      const scenario = createScenario(type, mockClient as any);

      // Check interface methods exist
      expect(typeof scenario.getType).toBe("function");
      expect(typeof scenario.getDescription).toBe("function");
      expect(typeof scenario.setup).toBe("function");
      expect(typeof scenario.run).toBe("function");
      expect(typeof scenario.teardown).toBe("function");
    });

    it.each(scenarioTypes)("%s returns correct type", (type) => {
      const scenario = createScenario(type, mockClient as any);
      expect(scenario.getType()).toBe(type);
    });

    it.each(scenarioTypes)("%s has description", (type) => {
      const scenario = createScenario(type, mockClient as any);
      const description = scenario.getDescription();

      expect(typeof description).toBe("string");
      expect(description.length).toBeGreaterThan(0);
    });
  });

  describe("Scenario execution", () => {
    const scenarioTypes: ScenarioType[] = [
      "context-recall",
      "cross-session",
      "skill-retrieval",
      "token-efficiency",
      "semantic-accuracy",
    ];

    it.each(scenarioTypes)("%s can complete full lifecycle", async (type) => {
      const scenario = createScenario(type, mockClient as any);

      // Setup
      await scenario.setup();

      // Run enabled phase
      const enabledResult = await scenario.run("vesper-enabled");
      expect(enabledResult.scenarioType).toBe(type);
      expect(enabledResult.phase).toBe("vesper-enabled");
      expect(enabledResult.metrics.length).toBeGreaterThan(0);

      // Run disabled phase
      mockClient.reset();
      const disabledResult = await scenario.run("vesper-disabled");
      expect(disabledResult.scenarioType).toBe(type);
      expect(disabledResult.phase).toBe("vesper-disabled");
      expect(disabledResult.metrics.length).toBeGreaterThan(0);

      // Teardown
      await scenario.teardown();
    });

    it.each(scenarioTypes)("%s collects metrics in enabled phase", async (type) => {
      const scenario = createScenario(type, mockClient as any);
      await scenario.setup();

      const result = await scenario.run("vesper-enabled");

      expect(result.metrics.length).toBeGreaterThan(0);
      for (const metric of result.metrics) {
        expect(metric.timestamp).toBeGreaterThan(0);
        expect(metric.latencyMs).toBeGreaterThanOrEqual(0);
        expect(typeof metric.memoryHit).toBe("boolean");
      }
    });

    it.each(scenarioTypes)("%s has no memory hits in disabled phase", async (type) => {
      const scenario = createScenario(type, mockClient as any);

      const result = await scenario.run("vesper-disabled");

      for (const metric of result.metrics) {
        expect(metric.memoryHit).toBe(false);
      }
    });

    it.each(scenarioTypes)("%s calculates aggregates", async (type) => {
      const scenario = createScenario(type, mockClient as any);
      await scenario.setup();

      const result = await scenario.run("vesper-enabled");

      expect(result.aggregates).toBeDefined();
      expect(result.aggregates.latencyP50).toBeGreaterThanOrEqual(0);
      expect(result.aggregates.latencyP95).toBeGreaterThanOrEqual(0);
      expect(result.aggregates.latencyP99).toBeGreaterThanOrEqual(0);
    });

    it.each(scenarioTypes)("%s captures raw responses", async (type) => {
      const scenario = createScenario(type, mockClient as any);
      await scenario.setup();

      const result = await scenario.run("vesper-enabled");

      expect(result.rawResponses.length).toBeGreaterThan(0);
      for (const response of result.rawResponses) {
        expect(typeof response).toBe("string");
      }
    });
  });

  describe("Memory hit behavior", () => {
    it("should have memory hits when Vesper is enabled and data matches", async () => {
      const scenario = createScenario("context-recall", mockClient as any);
      await scenario.setup();

      const result = await scenario.run("vesper-enabled");

      // At least some should have hits (depends on mock matching logic)
      const hitCount = result.metrics.filter((m) => m.memoryHit).length;
      expect(hitCount).toBeGreaterThan(0);
    });

    it("should have higher quality scores with memory hits", async () => {
      const scenario = createScenario("context-recall", mockClient as any);
      await scenario.setup();

      const enabledResult = await scenario.run("vesper-enabled");
      const disabledResult = await scenario.run("vesper-disabled");

      const enabledAvgAccuracy =
        enabledResult.metrics.reduce((sum, m) => sum + (m.retrievalAccuracy || 0), 0) /
        enabledResult.metrics.length;

      const disabledAvgAccuracy =
        disabledResult.metrics.reduce((sum, m) => sum + (m.retrievalAccuracy || 0), 0) /
        disabledResult.metrics.length;

      expect(enabledAvgAccuracy).toBeGreaterThanOrEqual(disabledAvgAccuracy);
    });
  });
});

describe("Cross-Session Scenario", () => {
  let mockClient: MockMCPClient;

  beforeEach(() => {
    mockClient = createMockMCPClient();
  });

  it("should test persistence across simulated sessions", async () => {
    const scenario = createScenario("cross-session", mockClient as any);
    await scenario.setup();

    const result = await scenario.run("vesper-enabled");

    expect(result.scenarioType).toBe("cross-session");
    expect(result.metrics.length).toBeGreaterThan(0);
  });

  it("should have descriptive text about sessions", () => {
    const scenario = createScenario("cross-session", mockClient as any);
    const description = scenario.getDescription();

    expect(description.toLowerCase()).toContain("session");
  });
});

describe("Skill Retrieval Scenario", () => {
  let mockClient: MockMCPClient;

  beforeEach(() => {
    mockClient = createMockMCPClient();
  });

  it("should test procedural knowledge retrieval", async () => {
    const scenario = createScenario("skill-retrieval", mockClient as any);
    await scenario.setup();

    const result = await scenario.run("vesper-enabled");

    expect(result.scenarioType).toBe("skill-retrieval");
    expect(result.metrics.length).toBeGreaterThan(0);
  });

  it("should have descriptive text about skills", () => {
    const scenario = createScenario("skill-retrieval", mockClient as any);
    const description = scenario.getDescription();

    expect(
      description.toLowerCase().includes("skill") ||
        description.toLowerCase().includes("procedural")
    ).toBe(true);
  });
});

describe("Token Efficiency Scenario", () => {
  let mockClient: MockMCPClient;

  beforeEach(() => {
    mockClient = createMockMCPClient();
  });

  it("should test token usage efficiency", async () => {
    const scenario = createScenario("token-efficiency", mockClient as any);
    await scenario.setup();

    const result = await scenario.run("vesper-enabled");

    expect(result.scenarioType).toBe("token-efficiency");
    expect(result.metrics.length).toBeGreaterThan(0);
  });

  it("should have descriptive text about tokens", () => {
    const scenario = createScenario("token-efficiency", mockClient as any);
    const description = scenario.getDescription();

    expect(description.toLowerCase()).toContain("token");
  });
});

describe("Semantic Accuracy Scenario", () => {
  let mockClient: MockMCPClient;

  beforeEach(() => {
    mockClient = createMockMCPClient();
  });

  it("should test semantic search accuracy", async () => {
    const scenario = createScenario("semantic-accuracy", mockClient as any);
    await scenario.setup();

    const result = await scenario.run("vesper-enabled");

    expect(result.scenarioType).toBe("semantic-accuracy");
    expect(result.metrics.length).toBeGreaterThan(0);
  });

  it("should have descriptive text about semantic", () => {
    const scenario = createScenario("semantic-accuracy", mockClient as any);
    const description = scenario.getDescription();

    expect(description.toLowerCase()).toContain("semantic");
  });
});
