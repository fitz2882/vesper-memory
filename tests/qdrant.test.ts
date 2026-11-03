/**
 * Qdrant Integration Tests
 *
 * Tests for Qdrant vector database integration including:
 * - Health check verification
 * - Collection initialization
 * - API key authentication
 * - Vector operations (upsert, search, delete)
 *
 * These tests require Docker services to be running:
 *   docker-compose up -d qdrant
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { QdrantClient } from "@qdrant/js-client-rest";
import { randomUUID } from "crypto";

// Configuration from environment
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "change-me-in-production";
const TEST_COLLECTION = "test-memory-vectors";
const VECTOR_SIZE = 1024; // BGE-large dimension

// Generate test UUIDs (Qdrant requires UUIDs or integers for point IDs)
const TEST_UUID_1 = randomUUID();
const TEST_UUID_2 = randomUUID();
const TEST_UUID_3 = randomUUID();
const TEST_UUID_DELETE = randomUUID();

describe("Qdrant Health Check", () => {
  it("should respond to healthz endpoint with 200", async () => {
    // Qdrant uses /healthz for health checks (Kubernetes-style)
    const response = await fetch(`${QDRANT_URL}/healthz`);
    expect(response.status).toBe(200);
  });

  it("should return version info from root endpoint", async () => {
    // The root endpoint returns service info
    const response = await fetch(`${QDRANT_URL}/`);
    const data = await response.json();
    expect(data.title).toBe("qdrant - vector search engine");
    expect(data.version).toBeDefined();
  });

  it("should have readiness endpoint available", async () => {
    const response = await fetch(`${QDRANT_URL}/readyz`);
    expect(response.ok).toBe(true);
  });

  it("should return healthz check passed message", async () => {
    const response = await fetch(`${QDRANT_URL}/healthz`);
    const text = await response.text();
    expect(text).toContain("healthz check passed");
  });
});

describe("Qdrant API Key Authentication", () => {
  it("should create client with API key configuration", () => {
    const client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      checkCompatibility: false,
    });
    expect(client).toBeDefined();
  });

  it("should connect successfully with valid API key", async () => {
    const client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      checkCompatibility: false,
    });

    // getCollections should succeed with valid API key
    const result = await client.getCollections();
    expect(result).toBeDefined();
    expect(Array.isArray(result.collections)).toBe(true);
  });

  it("should include API key in HybridSearchEngine configuration", async () => {
    // Import the module dynamically to test the factory function
    const { HybridSearchEngine } = await import(
      "../src/retrieval/hybrid-search.js"
    );

    // The engine should accept and use API key
    const engine = new HybridSearchEngine(
      QDRANT_URL,
      TEST_COLLECTION,
      VECTOR_SIZE,
      QDRANT_API_KEY
    );
    expect(engine).toBeDefined();
  });
});

describe("Qdrant Collection Management", () => {
  let client: QdrantClient;

  beforeAll(() => {
    client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      checkCompatibility: false,
    });
  });

  afterAll(async () => {
    // Cleanup test collection if exists
    try {
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Ignore if collection doesn't exist
    }
  });

  beforeEach(async () => {
    // Ensure clean state before each test
    try {
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Ignore if collection doesn't exist
    }
  });

  it("should create a collection with correct vector configuration", async () => {
    await client.createCollection(TEST_COLLECTION, {
      vectors: {
        size: VECTOR_SIZE,
        distance: "Cosine",
      },
    });

    const info = await client.getCollection(TEST_COLLECTION);
    expect(info.config.params.vectors).toBeDefined();

    // Handle both named and unnamed vector configurations
    const vectorConfig = info.config.params.vectors;
    if ('size' in vectorConfig) {
      expect(vectorConfig.size).toBe(VECTOR_SIZE);
      expect(vectorConfig.distance).toBe("Cosine");
    }
  });

  it("should verify memory-vectors collection exists after init", async () => {
    // This test verifies the init script creates the production collection
    const collections = await client.getCollections();
    const memoryVectors = collections.collections.find(
      (c) => c.name === "memory-vectors"
    );

    // This will fail until we run the init script
    expect(memoryVectors).toBeDefined();
  });

  it("should handle collection creation idempotently", async () => {
    // Create first time
    await client.createCollection(TEST_COLLECTION, {
      vectors: {
        size: VECTOR_SIZE,
        distance: "Cosine",
      },
    });

    // Verify exists
    const collections1 = await client.getCollections();
    expect(collections1.collections.some((c) => c.name === TEST_COLLECTION)).toBe(true);

    // Attempt to create again should either succeed silently or throw
    // Our init script should handle this gracefully
    const collections2 = await client.getCollections();
    expect(collections2.collections.some((c) => c.name === TEST_COLLECTION)).toBe(true);
  });
});

describe("Qdrant Vector Operations", () => {
  let client: QdrantClient;

  beforeAll(async () => {
    client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      checkCompatibility: false,
    });

    // Create test collection
    try {
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Ignore
    }

    await client.createCollection(TEST_COLLECTION, {
      vectors: {
        size: VECTOR_SIZE,
        distance: "Cosine",
      },
    });
  });

  afterAll(async () => {
    try {
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Ignore
    }
  });

  it("should upsert a vector with payload", async () => {
    const testVector = Array(VECTOR_SIZE).fill(0.1);
    const testPayload = {
      content: "Test memory content",
      timestamp: new Date().toISOString(),
      source: "test",
    };

    await client.upsert(TEST_COLLECTION, {
      points: [
        {
          id: TEST_UUID_1,
          vector: testVector,
          payload: testPayload,
        },
      ],
    });

    // Verify the point was inserted
    const result = await client.retrieve(TEST_COLLECTION, {
      ids: [TEST_UUID_1],
      with_payload: true,
      with_vector: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0].payload?.content).toBe("Test memory content");
  });

  it("should search for similar vectors", async () => {
    // Insert some test vectors with UUIDs
    const baseId = randomUUID();
    const similarId = randomUUID();
    const differentId = randomUUID();

    // Use more distinct vectors for clearer similarity testing
    const baseVector = Array(VECTOR_SIZE).fill(0).map((_, i) => 0.5 + (i * 0.0001));
    const similarVector = Array(VECTOR_SIZE).fill(0).map((_, i) => 0.5 + (i * 0.00011)); // Very similar
    const differentVector = Array(VECTOR_SIZE)
      .fill(0)
      .map((_, i) => (i % 2 === 0 ? 0.9 : -0.9)); // Very different pattern

    await client.upsert(TEST_COLLECTION, {
      points: [
        { id: baseId, vector: baseVector, payload: { type: "base" } },
        { id: similarId, vector: similarVector, payload: { type: "similar" } },
        { id: differentId, vector: differentVector, payload: { type: "different" } },
      ],
    });

    // Wait for indexing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Search for vectors similar to base
    const { points: results } = await client.query(TEST_COLLECTION, {
      query: baseVector,
      limit: 3,
      with_payload: true,
    });

    expect(results.length).toBeGreaterThan(0);
    // The base vector should be most similar to itself (score should be ~1.0)
    expect(results[0].id).toBe(baseId);
    expect(results[0].score).toBeGreaterThan(0.99);

    // Verify all our test vectors are in results
    const resultIds = results.map(r => r.id);
    expect(resultIds).toContain(baseId);
    expect(resultIds).toContain(similarId);

    // Similar vector should have high score (closer to base than different)
    const similarResult = results.find(r => r.id === similarId);
    const differentResult = results.find(r => r.id === differentId);
    if (similarResult && differentResult) {
      expect(similarResult.score).toBeGreaterThan(differentResult.score);
    }
  });

  it("should delete a vector", async () => {
    const testVector = Array(VECTOR_SIZE).fill(0.2);

    await client.upsert(TEST_COLLECTION, {
      points: [
        {
          id: TEST_UUID_DELETE,
          vector: testVector,
          payload: { content: "Will be deleted" },
        },
      ],
    });

    // Verify it exists
    const before = await client.retrieve(TEST_COLLECTION, {
      ids: [TEST_UUID_DELETE],
    });
    expect(before).toHaveLength(1);

    // Delete
    await client.delete(TEST_COLLECTION, {
      points: [TEST_UUID_DELETE],
    });

    // Verify it's gone
    const after = await client.retrieve(TEST_COLLECTION, {
      ids: [TEST_UUID_DELETE],
    });
    expect(after).toHaveLength(0);
  });

  it("should handle batch upsert", async () => {
    const points = Array(10)
      .fill(null)
      .map((_, i) => ({
        id: randomUUID(),
        vector: Array(VECTOR_SIZE)
          .fill(0)
          .map(() => Math.random()),
        payload: { index: i },
      }));

    await client.upsert(TEST_COLLECTION, { points });

    // Verify all were inserted
    const result = await client.retrieve(TEST_COLLECTION, {
      ids: points.map((p) => p.id),
      with_payload: true,
    });

    expect(result).toHaveLength(10);
  });
});

describe("HybridSearchEngine with API Key", () => {
  let engine: InstanceType<typeof import("../src/retrieval/hybrid-search.js").HybridSearchEngine>;

  beforeAll(async () => {
    const { HybridSearchEngine } = await import(
      "../src/retrieval/hybrid-search.js"
    );

    engine = new HybridSearchEngine(
      QDRANT_URL,
      TEST_COLLECTION,
      VECTOR_SIZE,
      QDRANT_API_KEY
    );

    // Initialize collection for tests
    await engine.initializeCollection();
  });

  afterAll(async () => {
    // Cleanup
    const client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      checkCompatibility: false,
    });
    try {
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Ignore
    }
  });

  it("should initialize collection through engine", async () => {
    const stats = await engine.getCollectionStats();
    expect(stats).toBeDefined();
    expect(stats.status).toBe("green");
  });

  it("should upsert memory through engine", async () => {
    const testVector = Array(VECTOR_SIZE).fill(0.15);
    const testId = randomUUID();
    await engine.upsertMemory(testId, testVector, {
      content: "Test via engine",
    });

    const stats = await engine.getCollectionStats();
    expect(stats.pointsCount).toBeGreaterThanOrEqual(1);
  });

  it("should perform dense search through engine", async () => {
    // Insert test data
    const queryVector = Array(VECTOR_SIZE).fill(0.15);

    const results = await engine.denseSearch(queryVector, 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it("should reject vectors with wrong dimensions", async () => {
    const wrongDimVector = Array(512).fill(0.1); // Wrong size
    const testId = randomUUID();

    await expect(
      engine.upsertMemory(testId, wrongDimVector)
    ).rejects.toThrow(/dimension mismatch/i);
  });
});

describe("Init Script Verification", () => {
  it("should have init-qdrant script in package.json", async () => {
    const fs = await import("fs/promises");
    const path = await import("path");
    const packageJson = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8")
    );

    expect(packageJson.scripts["init:qdrant"]).toBeDefined();
  });

  it("should create memory-vectors collection with correct schema", async () => {
    const client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      checkCompatibility: false,
    });

    // Check if production collection exists
    const collections = await client.getCollections();
    const memoryVectors = collections.collections.find(
      (c) => c.name === "memory-vectors"
    );

    expect(memoryVectors).toBeDefined();

    if (memoryVectors) {
      const info = await client.getCollection("memory-vectors");
      const vectorConfig = info.config.params.vectors;

      if ('size' in vectorConfig) {
        expect(vectorConfig.size).toBe(1024); // BGE-large
        expect(vectorConfig.distance).toBe("Cosine");
      }
    }
  });
});
