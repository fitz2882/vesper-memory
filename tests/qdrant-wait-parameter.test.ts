/**
 * Qdrant Wait Parameter Tests (TDD)
 *
 * Tests for the fix of the race condition where Qdrant upsert operations
 * return before indexing completes, causing immediate searches to fail.
 *
 * Root cause: upsertMemory() and createCollection() in hybrid-search.ts
 * do not use `wait: true` parameter, causing a race condition between
 * storage and retrieval.
 *
 * These tests verify that:
 * 1. Upserted vectors are immediately searchable (no manual delays)
 * 2. Collection creation completes before returning
 * 3. No race conditions between storage and retrieval
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { QdrantClient } from "@qdrant/js-client-rest";
import { randomUUID } from "crypto";
import { HybridSearchEngine } from "../src/retrieval/hybrid-search.js";

// Configuration
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "change-me-in-production";
const TEST_COLLECTION = `test-wait-param-${Date.now()}`;
const VECTOR_SIZE = 1024;

describe("Qdrant Wait Parameter Fix - Race Condition Prevention", () => {
  let engine: HybridSearchEngine;
  let client: QdrantClient;

  beforeAll(async () => {
    client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
    });

    // Create engine with test collection
    engine = new HybridSearchEngine(
      QDRANT_URL,
      TEST_COLLECTION,
      VECTOR_SIZE,
      QDRANT_API_KEY
    );

    // Initialize collection - this should wait for completion
    await engine.initializeCollection();
  });

  afterAll(async () => {
    // Cleanup test collection
    try {
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Ignore if collection doesn't exist
    }
  });

  beforeEach(async () => {
    // Clear all points from collection before each test
    try {
      const info = await client.getCollection(TEST_COLLECTION);
      if (info.points_count && info.points_count > 0) {
        // Delete all points
        await client.delete(TEST_COLLECTION, {
          filter: {
            must: [
              {
                is_empty: {
                  key: "nonexistent_field_that_matches_all",
                },
              },
            ],
          },
        });
      }
    } catch {
      // Ignore errors during cleanup
    }
  });

  /**
   * CRITICAL TEST: This is the core test for the race condition fix.
   *
   * Without `wait: true`, this test FAILS because:
   * 1. upsertMemory() returns immediately after Qdrant acknowledges the write
   * 2. Qdrant has NOT yet indexed the vector
   * 3. denseSearch() executes before indexing completes
   * 4. Search returns empty results
   *
   * With `wait: true`, this test PASSES because:
   * 1. upsertMemory() waits for Qdrant to complete indexing
   * 2. Only then does it return
   * 3. denseSearch() finds the indexed vector
   * 4. Search returns the expected result
   */
  it("should find upserted vector IMMEDIATELY without any delays", async () => {
    // Create a unique, identifiable vector
    const testId = randomUUID();
    const testVector = Array(VECTOR_SIZE)
      .fill(0)
      .map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5);
    const testPayload = {
      content: "This is a test memory that should be immediately searchable",
      type: "test",
      timestamp: new Date().toISOString(),
    };

    // Store memory
    await engine.upsertMemory(testId, testVector, testPayload);

    // IMMEDIATELY search - NO DELAYS, NO TIMEOUTS
    // This is the critical part: without wait:true, this fails
    const results = await engine.denseSearch(testVector, 5);

    // Verify the vector is found
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(testId);
    expect(results[0].score).toBeGreaterThan(0.99); // Exact match should be ~1.0
    expect(results[0].payload?.content).toBe(testPayload.content);
  });

  /**
   * Test multiple rapid upserts followed by immediate search.
   * This stress tests the wait parameter under concurrent-like conditions.
   */
  it("should find all vectors after rapid sequential upserts without delays", async () => {
    const vectors: Array<{ id: string; vector: number[]; payload: { index: number } }> = [];

    // Create 5 distinct vectors
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      const vector = Array(VECTOR_SIZE)
        .fill(0)
        .map((_, j) => Math.sin((j + i * 100) * 0.01) * 0.5 + 0.5);
      vectors.push({ id, vector, payload: { index: i } });
    }

    // Rapid sequential upserts - no delays between them
    for (const v of vectors) {
      await engine.upsertMemory(v.id, v.vector, v.payload);
    }

    // IMMEDIATELY search for each vector - NO DELAYS
    for (const v of vectors) {
      const results = await engine.denseSearch(v.vector, 1);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(v.id);
    }
  });

  /**
   * Test that hybrid search also works immediately after upsert.
   * This tests the full retrieval pipeline.
   */
  it("should find vector via hybridSearch immediately after upsert", async () => {
    const testId = randomUUID();
    const testVector = Array(VECTOR_SIZE)
      .fill(0)
      .map((_, i) => Math.cos(i * 0.02) * 0.5 + 0.5);
    const testPayload = {
      content: "Hybrid search test memory",
      type: "hybrid-test",
    };

    // Store memory
    await engine.upsertMemory(testId, testVector, testPayload);

    // IMMEDIATELY search via hybrid search - NO DELAYS
    const results = await engine.hybridSearch(testVector, 5);

    // Verify the vector is found
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(testId);
    expect(results[0].fusedScore).toBeGreaterThan(0);
  });

  /**
   * Test that getCollectionStats reflects the upsert immediately.
   * This verifies the write is fully committed.
   */
  it("should show updated point count immediately after upsert", async () => {
    // Get initial count
    const statsBefore = await engine.getCollectionStats();
    const countBefore = (statsBefore.pointsCount as number) || 0;

    // Upsert a new vector
    const testId = randomUUID();
    const testVector = Array(VECTOR_SIZE)
      .fill(0)
      .map(() => Math.random());
    await engine.upsertMemory(testId, testVector, { test: true });

    // IMMEDIATELY check stats - NO DELAYS
    const statsAfter = await engine.getCollectionStats();
    const countAfter = (statsAfter.pointsCount as number) || 0;

    // Count should have increased by 1
    expect(countAfter).toBe(countBefore + 1);
  });

  /**
   * Test upsert-then-update scenario.
   * Verifies that updates are also immediately visible.
   */
  it("should reflect payload updates immediately", async () => {
    const testId = randomUUID();
    const testVector = Array(VECTOR_SIZE)
      .fill(0)
      .map((_, i) => i / VECTOR_SIZE);

    // Initial upsert
    await engine.upsertMemory(testId, testVector, { version: 1, content: "initial" });

    // Update with new payload (same ID and vector)
    await engine.upsertMemory(testId, testVector, { version: 2, content: "updated" });

    // IMMEDIATELY search - should get updated payload
    const results = await engine.denseSearch(testVector, 1);

    expect(results.length).toBe(1);
    expect(results[0].id).toBe(testId);
    expect(results[0].payload?.version).toBe(2);
    expect(results[0].payload?.content).toBe("updated");
  });
});

describe("Collection Initialization Wait Parameter", () => {
  /**
   * Test that collection is fully ready after initializeCollection() returns.
   * This verifies wait:true is used in createCollection().
   */
  it("should have collection fully operational immediately after initialization", async () => {
    const uniqueCollection = `test-init-wait-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
    });

    try {
      const engine = new HybridSearchEngine(
        QDRANT_URL,
        uniqueCollection,
        VECTOR_SIZE,
        QDRANT_API_KEY
      );

      // Initialize collection
      await engine.initializeCollection();

      // IMMEDIATELY perform operations - NO DELAYS
      const testId = randomUUID();
      const testVector = Array(VECTOR_SIZE)
        .fill(0)
        .map(() => Math.random());

      // This should work immediately after initialization
      await engine.upsertMemory(testId, testVector, { test: true });

      // And search should work immediately
      const results = await engine.denseSearch(testVector, 1);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(testId);
    } finally {
      // Cleanup
      try {
        await client.deleteCollection(uniqueCollection);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
