#!/usr/bin/env npx ts-node --esm
/**
 * Qdrant Collection Initialization Script
 *
 * Creates the memory-vectors collection with proper configuration:
 * - 1024-dim dense vectors (BGE-large embedding dimension)
 * - Cosine similarity distance metric
 * - Payload indexing for metadata filtering
 *
 * Usage:
 *   npm run init:qdrant
 *
 * Environment variables:
 *   QDRANT_URL - Qdrant server URL (default: http://localhost:6333)
 *   QDRANT_API_KEY - API key for authentication (required in production)
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "dotenv";

// Load environment variables
config();

// Configuration
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION_NAME = "memory-vectors";
const VECTOR_SIZE = 1024; // BGE-large dimension

interface InitResult {
  success: boolean;
  message: string;
  collectionName: string;
  vectorSize: number;
}

/**
 * Initialize Qdrant collection for memory storage
 */
async function initializeQdrant(): Promise<InitResult> {
  console.log("Initializing Qdrant collection...");
  console.log(`  URL: ${QDRANT_URL}`);
  console.log(`  Collection: ${COLLECTION_NAME}`);
  console.log(`  Vector Size: ${VECTOR_SIZE}`);
  console.log(`  API Key: ${QDRANT_API_KEY ? "configured" : "not configured"}`);

  // Create client with optional API key
  const clientConfig: {
    url: string;
    apiKey?: string;
    checkCompatibility: boolean;
  } = {
    url: QDRANT_URL,
    // Vesper's pinned server can be older than the generated REST client. The
    // APIs used by this initializer are covered by integration tests.
    checkCompatibility: false,
  };

  if (QDRANT_API_KEY) {
    clientConfig.apiKey = QDRANT_API_KEY;
  }

  const client = new QdrantClient(clientConfig);

  try {
    // Check Qdrant health first
    console.log("\nChecking Qdrant health...");
    const response = await fetch(`${QDRANT_URL}/healthz`);
    if (!response.ok) {
      throw new Error(`Qdrant health check failed: ${response.status}`);
    }
    console.log("  Qdrant is healthy");

    // Check if collection already exists
    console.log("\nChecking existing collections...");
    const collections = await client.getCollections();
    const existingCollection = collections.collections.find((c) => c.name === COLLECTION_NAME);

    if (existingCollection) {
      // Verify configuration matches
      const info = await client.getCollection(COLLECTION_NAME);
      const vectorConfig = info.config.params.vectors;

      if ("size" in vectorConfig) {
        if (vectorConfig.size !== VECTOR_SIZE) {
          console.warn(
            `  WARNING: Existing collection has different vector size: ${vectorConfig.size}`
          );
          console.warn(`  Expected: ${VECTOR_SIZE}. You may need to recreate the collection.`);
        } else {
          console.log(
            `  Collection '${COLLECTION_NAME}' already exists with correct configuration`
          );
        }
      }
    } else {
      // Create new collection
      console.log(`\nCreating collection '${COLLECTION_NAME}'...`);
      await client.createCollection(COLLECTION_NAME, {
        vectors: {
          size: VECTOR_SIZE,
          distance: "Cosine",
        },
        // Optimize for memory retrieval workload
        optimizers_config: {
          default_segment_number: 2,
          indexing_threshold: 10000,
        },
        // Enable write-ahead logging for durability
        wal_config: {
          wal_capacity_mb: 32,
          wal_segments_ahead: 0,
        },
      });

      console.log(`  Collection created successfully`);
    }

    // Create payload indexes for common query patterns
    console.log("\nCreating payload indexes...");

    // Match the fields used by MemoryRetriever's dense candidate filter. All
    // authorization is still repeated against canonical SQLite rows.
    for (const fieldName of ["namespace", "memory_type", "agent_id", "task_id"]) {
      await client.createPayloadIndex(COLLECTION_NAME, {
        wait: true,
        field_name: fieldName,
        field_schema: "keyword",
      });
      console.log(`  Ensured index: ${fieldName} (keyword)`);
    }

    // Verify collection was created
    const verifyInfo = await client.getCollection(COLLECTION_NAME);
    console.log("\nCollection verification:");
    console.log(`  Status: ${verifyInfo.status}`);
    console.log(`  Points: ${verifyInfo.points_count}`);
    console.log(`  Indexed vectors: ${verifyInfo.indexed_vectors_count}`);

    return {
      success: true,
      message: `Collection '${COLLECTION_NAME}' created successfully`,
      collectionName: COLLECTION_NAME,
      vectorSize: VECTOR_SIZE,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\nError initializing Qdrant: ${errorMessage}`);

    return {
      success: false,
      message: `Failed to initialize: ${errorMessage}`,
      collectionName: COLLECTION_NAME,
      vectorSize: VECTOR_SIZE,
    };
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  initializeQdrant()
    .then((result) => {
      console.log("\n" + "=".repeat(50));
      if (result.success) {
        console.log("Qdrant initialization completed successfully");
        console.log(`  Collection: ${result.collectionName}`);
        console.log(`  Vector size: ${result.vectorSize}`);
        process.exit(0);
      } else {
        console.error("Qdrant initialization failed");
        console.error(`  Error: ${result.message}`);
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("Unexpected error:", error);
      process.exit(1);
    });
}

export { initializeQdrant, InitResult };
