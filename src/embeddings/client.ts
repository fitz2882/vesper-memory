/**
 * BGE-large Embedding Client
 *
 * TypeScript client for the BGE-large embedding service.
 * Provides methods for generating 1024-dimensional dense embeddings.
 */

import { LRUCache } from 'lru-cache';

/**
 * Embedding service response
 */
export interface EmbeddingResponse {
  embeddings: number[][];
  dimensions: number;
  count: number;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: string;
  model: string;
  dimensions: number;
}

/**
 * BGE-large embedding client configuration
 */
export interface EmbeddingClientConfig {
  /** Embedding service URL (default: http://localhost:8000) */
  serviceUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum retries on failure (default: 3) */
  maxRetries?: number;
}

/**
 * BGE-large Embedding Client
 *
 * Communicates with the Python embedding service to generate
 * 1024-dimensional dense embeddings using BGE-large-en-v1.5.
 */
export class EmbeddingClient {
  private serviceUrl: string;
  private timeout: number;
  private maxRetries: number;
  private embeddingCache: LRUCache<string, number[]>;

  constructor(config: EmbeddingClientConfig = {}) {
    this.serviceUrl = config.serviceUrl || process.env.EMBEDDING_SERVICE_URL || 'http://localhost:8000';
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;

    // Initialize LRU cache for embeddings (1000 entries, 1 hour TTL)
    this.embeddingCache = new LRUCache<string, number[]>({
      max: 1000,
      ttl: 1000 * 60 * 60, // 1 hour
    });
  }

  /**
   * Check if the embedding service is healthy
   *
   * @returns Health status and model information
   */
  async health(): Promise<HealthResponse> {
    const response = await this.fetchWithRetry(`${this.serviceUrl}/health`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as HealthResponse;
  }

  /**
   * Generate embedding for a single text
   *
   * @param text - Text to embed
   * @param normalize - Whether to normalize the embedding (default: true)
   * @returns 1024-dimensional embedding vector
   */
  async embed(text: string, normalize: boolean = true): Promise<number[]> {
    // Create cache key from text and normalize flag
    const cacheKey = `${text}:${normalize}`;

    // Check cache first
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Cache miss - generate embedding
    const response = await this.embedBatch([text], normalize);
    const embedding = response.embeddings[0];

    // Store in cache
    this.embeddingCache.set(cacheKey, embedding);

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts
   *
   * @param texts - Array of texts to embed
   * @param normalize - Whether to normalize embeddings (default: true)
   * @returns Array of 1024-dimensional embedding vectors
   */
  async embedBatch(texts: string[], normalize: boolean = true): Promise<EmbeddingResponse> {
    if (texts.length === 0) {
      return {
        embeddings: [],
        dimensions: 1024,
        count: 0,
      };
    }

    const response = await this.fetchWithRetry(`${this.serviceUrl}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        normalize,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding generation failed: ${response.status} ${error}`);
    }

    const result = (await response.json()) as EmbeddingResponse;

    // Validate dimensions
    if (result.dimensions !== 1024) {
      throw new Error(
        `Expected 1024-dimensional embeddings, got ${result.dimensions}`
      );
    }

    // Validate count
    if (result.count !== texts.length) {
      throw new Error(
        `Expected ${texts.length} embeddings, got ${result.count}`
      );
    }

    return result;
  }

  /**
   * Generate embeddings with optimized batching
   *
   * Automatically splits large batches to avoid memory issues
   * and timeouts on the embedding service.
   *
   * @param texts - Array of texts to embed
   * @param batchSize - Number of texts per batch (default: 32)
   * @returns Array of 1024-dimensional embedding vectors
   */
  async embedLargeBatch(
    texts: string[],
    batchSize: number = 32
  ): Promise<number[][]> {
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.embedBatch(batch);
      allEmbeddings.push(...response.embeddings);
    }

    return allEmbeddings;
  }

  /**
   * Fetch with automatic retry on failure
   *
   * @param url - URL to fetch
   * @param options - Fetch options
   * @returns Response
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries: number = 0
  ): Promise<Response> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      if (retries < this.maxRetries) {
        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, retries) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, options, retries + 1);
      }

      throw new Error(
        `Embedding service request failed after ${this.maxRetries} retries: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Factory function to create an embedding client
 *
 * @param config - Optional configuration
 * @returns Embedding client instance
 */
export function createEmbeddingClient(
  config?: EmbeddingClientConfig
): EmbeddingClient {
  return new EmbeddingClient(config);
}
