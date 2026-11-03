/**
 * Hybrid Search Engine
 *
 * Implements multi-index retrieval combining dense embeddings, sparse vectors,
 * and BM25 full-text search. Currently implements dense search with RRF fusion
 * stubs for future sparse/BM25 integration.
 *
 * Retrieval Pipeline:
 * - Dense embeddings (BGE-large, 1024-dim)
 * - Sparse vectors (SPLADE++, coming soon)
 * - BM25 full-text search (coming soon)
 * - ColBERT late-interaction reranking (Phase 2)
 * - Reciprocal Rank Fusion (k=60)
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { validateVector, sanitizeCollectionName } from "../utils/validation.js";

/**
 * Dense search result from vector similarity
 */
export interface DenseSearchResult {
  id: string;
  score: number;
  payload?: Record<string, unknown>;
}

/**
 * Sparse search result from sparse embeddings
 */
export interface SparseSearchResult {
  id: string;
  score: number;
  payload?: Record<string, unknown>;
}

/**
 * BM25 full-text search result
 */
export interface BM25SearchResult {
  id: string;
  score: number;
  payload?: Record<string, unknown>;
}

/**
 * Unified search result after RRF fusion
 */
export interface HybridSearchResult {
  id: string;
  denseScore?: number;
  sparseScore?: number;
  bm25Score?: number;
  fusedScore: number;
  payload?: Record<string, unknown>;
  rank: number;
}

/**
 * Configuration for Qdrant collection
 */
interface _CollectionConfig {
  name: string;
  vectorSize: number;
  distanceMetric: "Cosine" | "Euclid" | "Manhattan";
}

/**
 * Qdrant Hybrid Search Engine
 *
 * Manages vector operations and retrieval across multiple index types.
 * Currently focused on dense search; sparse and BM25 stubs provided for future phases.
 */
export class HybridSearchEngine {
  private client: QdrantClient;
  private collectionName: string;
  private vectorSize: number;

  /**
   * Initialize the hybrid search engine
   *
   * @param qdrantUrl - Qdrant server URL (default: http://localhost:6333)
   * @param collectionName - Name of the collection (default: memory-vectors)
   * @param vectorSize - Dimension of dense vectors (default: 1024 for BGE-large)
   * @param apiKey - Optional Qdrant API key for authentication
   */
  constructor(
    qdrantUrl: string = "http://localhost:6333",
    collectionName: string = "memory-vectors",
    vectorSize: number = 1024,
    apiKey?: string
  ) {
    // Sanitize collection name to prevent injection attacks (SEC-012)
    this.collectionName = sanitizeCollectionName(collectionName);
    this.vectorSize = vectorSize;

    const clientConfig: { url: string; apiKey?: string; checkCompatibility?: boolean } = {
      url: qdrantUrl,
      checkCompatibility: false, // Allow client 1.16.2 with server 1.7.4
    };

    // Add API key if provided
    if (apiKey) {
      clientConfig.apiKey = apiKey;
    }

    this.client = new QdrantClient(clientConfig);
  }

  /**
   * Initialize collection with proper schema
   *
   * Creates a collection with:
   * - Dense vectors (1024-dim, cosine similarity)
   * - Payload storage for metadata
   * - Future: sparse vectors, BM25 indexes
   */
  async initializeCollection(): Promise<void> {
    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const collectionExists = collections.collections.some((c) => c.name === this.collectionName);

      if (collectionExists) {
        console.error(`Collection '${this.collectionName}' already exists`);
        return;
      }

      // Create new collection with dense vector index
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorSize,
          distance: "Cosine",
        },
      });

      console.error(
        `Created collection '${this.collectionName}' with ${this.vectorSize}-dim vectors`
      );

      // TODO: Phase 2 - Add sparse vector index
      // TODO: Phase 2 - Add BM25 index
    } catch (error) {
      console.error(
        "Failed to initialize collection:",
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  /**
   * Dense vector search using cosine similarity
   *
   * Performs semantic search using dense embeddings (BGE-large, 1024-dim).
   * Returns top-k results ranked by similarity score.
   *
   * @param queryVector - Query embedding (1024-dim array)
   * @param topK - Number of results to return (default: 5)
   * @returns Array of dense search results sorted by score (highest first)
   */
  async denseSearch(
    queryVector: number[],
    topK: number = 5,
    filter?: Record<string, unknown>
  ): Promise<DenseSearchResult[]> {
    // Validate vector dimensions and values (SEC-005)
    validateVector(queryVector, this.vectorSize);

    try {
      // Qdrant client >= 1.17 removed `search`; `query` is the universal API.
      const { points: searchResults } = await this.client.query(this.collectionName, {
        query: queryVector,
        limit: topK,
        with_payload: true,
        with_vector: false,
        ...(filter ? { filter } : {}),
      });

      return searchResults.map((result) => ({
        id: String(result.id),
        score: result.score,
        payload: result.payload ?? undefined,
      }));
    } catch (error) {
      console.error("Dense search failed:", error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Sparse vector search using SPLADE++ (stub)
   *
   * TODO: Phase 2 implementation
   * - Integrate SPLADE++ sparse embeddings
   * - Query sparse index in Qdrant
   * - Return top-k sparse results
   *
   * @param querySparseVector - Query sparse embedding
   * @param topK - Number of results to return
   * @returns Array of sparse search results
   */
  async sparseSearch(
    _querySparseVector: Record<number, number>,
    _topK: number = 5
  ): Promise<SparseSearchResult[]> {
    console.warn("sparseSearch: Not yet implemented (Phase 2)");
    return [];
  }

  /**
   * BM25 full-text search (stub)
   *
   * TODO: Phase 2 implementation
   * - Integrate BM25 index (Qdrant or external)
   * - Tokenize and search query text
   * - Return top-k BM25 results
   *
   * @param queryText - Query text for full-text search
   * @param topK - Number of results to return
   * @returns Array of BM25 search results
   */
  async bm25Search(_queryText: string, _topK: number = 5): Promise<BM25SearchResult[]> {
    console.warn("bm25Search: Not yet implemented (Phase 2)");
    return [];
  }

  /**
   * Reciprocal Rank Fusion combining multiple indexes
   *
   * Implements RRF formula to combine rankings from dense, sparse, and BM25 indexes:
   * RRF(d) = Σ 1 / (k + rank(d))
   *
   * where k is the fusion parameter (default 60) and rank is the position in each ranking.
   *
   * TODO: Phase 2 - Integrate with sparse/BM25 results once available
   *
   * @param denseResults - Results from dense search
   * @param sparseResults - Results from sparse search
   * @param bm25Results - Results from BM25 search
   * @param k - RRF fusion parameter (default: 60)
   * @returns Fused results sorted by RRF score
   */
  static rrfFusion(
    denseResults: DenseSearchResult[],
    sparseResults: SparseSearchResult[] = [],
    bm25Results: BM25SearchResult[] = [],
    k: number = 60
  ): HybridSearchResult[] {
    // A single ranked list does not need rank fusion. Preserve the dense
    // similarity in the compatibility `fusedScore` field so callers receive a
    // meaningful score instead of the near-constant 1 / (k + rank) values.
    const denseOnly = sparseResults.length === 0 && bm25Results.length === 0;

    // Create a map to accumulate scores
    const resultMap = new Map<string, HybridSearchResult>();

    // Process dense results
    denseResults.forEach((result, index) => {
      const rrfScore = 1 / (k + index + 1);
      resultMap.set(result.id, {
        id: result.id,
        denseScore: result.score,
        fusedScore: denseOnly ? result.score : rrfScore,
        payload: result.payload,
        rank: 0, // Will be set after final sort
      });
    });

    // Process sparse results
    sparseResults.forEach((result, index) => {
      const rrfScore = 1 / (k + index + 1);
      const existing = resultMap.get(result.id);
      if (existing) {
        existing.sparseScore = result.score;
        existing.fusedScore += rrfScore;
      } else {
        resultMap.set(result.id, {
          id: result.id,
          sparseScore: result.score,
          fusedScore: rrfScore,
          payload: result.payload,
          rank: 0,
        });
      }
    });

    // Process BM25 results
    bm25Results.forEach((result, index) => {
      const rrfScore = 1 / (k + index + 1);
      const existing = resultMap.get(result.id);
      if (existing) {
        existing.bm25Score = result.score;
        existing.fusedScore += rrfScore;
      } else {
        resultMap.set(result.id, {
          id: result.id,
          bm25Score: result.score,
          fusedScore: rrfScore,
          payload: result.payload,
          rank: 0,
        });
      }
    });

    // Sort by fused score and assign ranks
    const fused = Array.from(resultMap.values())
      .sort((a, b) => b.fusedScore - a.fusedScore)
      .map((result, index) => {
        result.rank = index + 1;
        return result;
      });

    return fused;
  }

  /**
   * Hybrid search combining all available indexes
   *
   * Currently implements dense search only. Will be extended to include
   * sparse vectors and BM25 once those are implemented in Phase 2.
   *
   * Pipeline:
   * 1. Dense vector search (semantic search)
   * 2. Sparse vector search (keyword-level semantics)
   * 3. BM25 full-text search
   * 4. Reciprocal Rank Fusion
   *
   * @param queryVector - Query embedding (1024-dim for BGE-large)
   * @param topK - Number of final results to return (default: 5)
   * @returns Array of fused results ranked by combined scores
   */
  async hybridSearch(
    queryVector: number[],
    topK: number = 5,
    filter?: Record<string, unknown>
  ): Promise<HybridSearchResult[]> {
    // Phase 1: Dense search only
    const denseResults = await this.denseSearch(queryVector, topK, filter);

    // Phase 2: Will add sparse and BM25
    // const sparseResults = await this.sparseSearch(querySparseVector, topK);
    // const bm25Results = await this.bm25Search(queryText, topK);

    // Combine results with RRF
    const fused = HybridSearchEngine.rrfFusion(denseResults);

    return fused.slice(0, topK);
  }

  /**
   * Add or update a memory record with embedding
   *
   * @param id - Unique identifier for the memory
   * @param vector - Dense embedding (1024-dim)
   * @param payload - Associated metadata (content, timestamp, source, etc.)
   */
  async upsertMemory(
    id: string,
    vector: number[],
    payload?: Record<string, unknown>
  ): Promise<void> {
    // Validate vector dimensions and values (SEC-005)
    validateVector(vector, this.vectorSize);

    try {
      await this.client.upsert(this.collectionName, {
        wait: true, // Wait for indexing to complete before returning (fixes race condition)
        points: [
          {
            id: id,
            vector: vector,
            payload: payload || {},
          },
        ],
      });
    } catch (error) {
      console.error("Failed to upsert memory:", error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Delete a memory record
   *
   * @param id - Unique identifier of the memory to delete
   */
  async deleteMemory(id: string): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        wait: true, // Wait for deletion to complete before returning
        points: [id],
      });
    } catch (error) {
      console.error("Failed to delete memory:", error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Get collection statistics
   *
   * @returns Object containing collection size, vector count, etc.
   */
  async getCollectionStats(): Promise<Record<string, unknown>> {
    try {
      const info = await this.client.getCollection(this.collectionName);
      return {
        pointsCount: info.points_count,
        indexedVectorsCount: info.indexed_vectors_count,
        segmentsCount: info.segments_count,
        status: info.status,
      };
    } catch (error) {
      console.error(
        "Failed to get collection stats:",
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }
}

/**
 * Factory function to create and initialize a hybrid search engine
 *
 * Usage:
 * ```typescript
 * const engine = await createHybridSearchEngine();
 * const results = await engine.hybridSearch(queryVector);
 * ```
 *
 * @param qdrantUrl - Qdrant server URL (default: http://localhost:6333)
 * @param collectionName - Name of the collection (default: memory-vectors)
 * @param vectorSize - Dimension of dense vectors (default: 1024 for BGE-large)
 * @param apiKey - Optional Qdrant API key for authentication
 */
export async function createHybridSearchEngine(
  qdrantUrl?: string,
  collectionName?: string,
  vectorSize?: number,
  apiKey?: string
): Promise<HybridSearchEngine> {
  const engine = new HybridSearchEngine(qdrantUrl, collectionName, vectorSize, apiKey);
  await engine.initializeCollection();
  return engine;
}
