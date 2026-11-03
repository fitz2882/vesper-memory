/**
 * Tests for Context Recall Scenario
 *
 * TDD Phase 4a: Tests ability to recall facts from previous conversations.
 *
 * Coverage targets:
 * - Scenario initialization
 * - Fact storage and recall
 * - Quality evaluation
 * - Metrics collection
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ContextRecallScenario,
  createContextRecallScenario,
  CONTEXT_RECALL_TEST_DATA,
} from "../../../src/benchmark/scenarios/context-recall";
import type {
  ScenarioResult,
  BenchmarkPhase,
  MetricsSnapshot,
} from "../../../src/benchmark/types";

// Mock MCP client for testing
interface MockMCPClient {
  storeMemory: (content: string, type: string, metadata?: object) => Promise<{ success: boolean; memory_id: string }>;
  retrieveMemory: (query: string) => Promise<{ success: boolean; results: Array<{ content: string; similarity_score: number }> }>;
  reset: () => void;
  getStoredMemories: () => Array<{ content: string; type: string }>;
}

function createMockMCPClient(): MockMCPClient {
  const memories: Array<{ content: string; type: string; metadata?: object }> = [];

  return {
    async storeMemory(content: string, type: string, metadata?: object) {
      memories.push({ content, type, metadata });
      return { success: true, memory_id: `mock-${memories.length}` };
    },

    async retrieveMemory(query: string) {
      // Simple substring matching for testing
      const results = memories
        .filter((m) => m.content.toLowerCase().includes(query.toLowerCase().split(" ")[0]))
        .map((m) => ({ content: m.content, similarity_score: 0.9 }));

      return { success: true, results };
    },

    reset() {
      memories.length = 0;
    },

    getStoredMemories() {
      return [...memories];
    },
  };
}

describe("Context Recall Scenario", () => {
  let scenario: ContextRecallScenario;
  let mockClient: MockMCPClient;

  beforeEach(() => {
    mockClient = createMockMCPClient();
    scenario = createContextRecallScenario(mockClient as any);
  });

  describe("Scenario initialization", () => {
    it("should have correct scenario type", () => {
      expect(scenario.getType()).toBe("context-recall");
    });

    it("should have a description", () => {
      expect(scenario.getDescription()).toContain("recall");
    });

    it("should have test data available", () => {
      expect(CONTEXT_RECALL_TEST_DATA.length).toBeGreaterThan(0);
    });
  });

  describe("Test data structure", () => {
    it("should have facts with questions and expected answers", () => {
      for (const testCase of CONTEXT_RECALL_TEST_DATA) {
        expect(testCase.fact).toBeTruthy();
        expect(testCase.question).toBeTruthy();
        expect(testCase.expectedKeywords).toBeInstanceOf(Array);
        expect(testCase.expectedKeywords.length).toBeGreaterThan(0);
      }
    });

    it("should cover different fact categories", () => {
      const categories = new Set(CONTEXT_RECALL_TEST_DATA.map((tc) => tc.category));
      expect(categories.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Setup phase", () => {
    it("should store facts during setup", async () => {
      await scenario.setup();

      const stored = mockClient.getStoredMemories();
      expect(stored.length).toBe(CONTEXT_RECALL_TEST_DATA.length);
    });

    it("should store facts as semantic memories", async () => {
      await scenario.setup();

      const stored = mockClient.getStoredMemories();
      for (const memory of stored) {
        expect(memory.type).toBe("semantic");
      }
    });
  });

  describe("Run phase with Vesper enabled", () => {
    beforeEach(async () => {
      await scenario.setup();
    });

    it("should return scenario result for enabled phase", async () => {
      const result = await scenario.run("vesper-enabled");

      expect(result.scenarioType).toBe("context-recall");
      expect(result.phase).toBe("vesper-enabled");
      expect(result.metrics.length).toBeGreaterThan(0);
      expect(result.aggregates).toBeDefined();
    });

    it("should collect metrics for each test case", async () => {
      const result = await scenario.run("vesper-enabled");

      // Should have one metric per test case
      expect(result.metrics.length).toBe(CONTEXT_RECALL_TEST_DATA.length);
    });

    it("should evaluate response quality", async () => {
      const result = await scenario.run("vesper-enabled");

      // With memory enabled and mocked retrieval, should have some quality scores
      for (const metric of result.metrics) {
        expect(metric.memoryHit).toBeDefined();
      }
    });

    it("should capture raw responses", async () => {
      const result = await scenario.run("vesper-enabled");

      expect(result.rawResponses.length).toBe(CONTEXT_RECALL_TEST_DATA.length);
    });
  });

  describe("Run phase with Vesper disabled", () => {
    it("should return scenario result for disabled phase", async () => {
      const result = await scenario.run("vesper-disabled");

      expect(result.scenarioType).toBe("context-recall");
      expect(result.phase).toBe("vesper-disabled");
      expect(result.metrics.length).toBeGreaterThan(0);
    });

    it("should simulate no memory access", async () => {
      const result = await scenario.run("vesper-disabled");

      // With memory disabled, should have no memory hits
      for (const metric of result.metrics) {
        expect(metric.memoryHit).toBe(false);
      }
    });

    it("should have lower quality scores without memory", async () => {
      await scenario.setup();

      const enabledResult = await scenario.run("vesper-enabled");
      const disabledResult = await scenario.run("vesper-disabled");

      // Calculate average quality for each
      const enabledQuality =
        enabledResult.metrics.reduce((sum, m) => sum + (m.retrievalAccuracy || 0), 0) /
        enabledResult.metrics.length;
      const disabledQuality =
        disabledResult.metrics.reduce((sum, m) => sum + (m.retrievalAccuracy || 0), 0) /
        disabledResult.metrics.length;

      // Enabled should generally have better quality
      expect(enabledQuality).toBeGreaterThanOrEqual(disabledQuality);
    });
  });

  describe("Teardown phase", () => {
    it("should clean up after scenario", async () => {
      await scenario.setup();
      await scenario.run("vesper-enabled");
      await scenario.teardown();

      // Should be able to run again after teardown
      await scenario.setup();
      const result = await scenario.run("vesper-enabled");
      expect(result.metrics.length).toBeGreaterThan(0);
    });
  });

  describe("Aggregates calculation", () => {
    beforeEach(async () => {
      await scenario.setup();
    });

    it("should calculate latency percentiles", async () => {
      const result = await scenario.run("vesper-enabled");

      expect(result.aggregates.latencyP50).toBeGreaterThanOrEqual(0);
      expect(result.aggregates.latencyP95).toBeGreaterThanOrEqual(result.aggregates.latencyP50);
      expect(result.aggregates.latencyP99).toBeGreaterThanOrEqual(result.aggregates.latencyP95);
    });

    it("should calculate memory hit rate", async () => {
      const result = await scenario.run("vesper-enabled");

      expect(result.aggregates.memoryHitRate).toBeGreaterThanOrEqual(0);
      expect(result.aggregates.memoryHitRate).toBeLessThanOrEqual(1);
    });
  });

  describe("Error handling", () => {
    it("should handle MCP client errors gracefully", async () => {
      const failingClient = {
        storeMemory: vi.fn().mockRejectedValue(new Error("Storage failed")),
        retrieveMemory: vi.fn().mockRejectedValue(new Error("Retrieval failed")),
      };

      const failingScenario = createContextRecallScenario(failingClient as any);

      // Should not throw, but record errors
      const result = await failingScenario.run("vesper-enabled");
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe("Timing behavior", () => {
    it("should measure realistic latencies", async () => {
      await scenario.setup();
      const result = await scenario.run("vesper-enabled");

      // Latencies should be positive
      for (const metric of result.metrics) {
        expect(metric.latencyMs).toBeGreaterThan(0);
      }
    });
  });
});
