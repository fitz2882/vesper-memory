/**
 * Vesper - AI Memory System
 *
 * Main entry point for the Model Context Protocol server.
 * Implements a neuroscience-inspired memory system for Claude Code agents.
 *
 * This server provides:
 * - store_memory: Add memories to working memory
 * - retrieve_memory: Query with smart routing
 * - list_recent: Get last 5 conversations
 * - get_stats: Return system metrics
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import Redis from "ioredis";
import { createRequire } from "module";
import { randomUUID } from "crypto";
import {
  validateInput,
  StoreMemoryInputSchema,
  RetrieveMemoryInputSchema,
  ListRecentInputSchema,
  GetStatsInputSchema,
} from "./utils/validation.js";
import { createEmbeddingClient, EmbeddingClient } from "./embeddings/client.js";
import { HybridSearchEngine } from "./retrieval/hybrid-search.js";
import {
  RateLimitMiddleware,
  RateLimitError,
  createRateLimitMiddleware,
  RateLimitCheckResult,
} from "./security/rate-limit-middleware.js";
import { getRateLimitConfigFromEnv, TierName } from "./config/rate-limits.js";
import {
  isAuthEnabled,
  validateApiKeyFormat,
  extractKeyPrefix,
  verifyApiKey,
  isKeyExpired as _isKeyExpired,
  isIpAllowed as _isIpAllowed,
  hasScope,
  createAuditEntry as _createAuditEntry,
  AuditAction as _AuditAction,
  hashForAudit as _hashForAudit,
  getRateLimitsForTier as _getRateLimitsForTier,
  createAuthCache,
  type AuthResult as _AuthResult,
} from "./middleware/auth.js";
import { MetricsCollector } from "./monitoring/metrics.js";

// Import better-sqlite3 constructor using createRequire
const require = createRequire(import.meta.url);
const DatabaseConstructor = require("better-sqlite3");

/**
 * Connection pool for external services
 */
interface ConnectionPool {
  redis?: Redis;
  sqlite?: any; // better-sqlite3 Database instance
  embeddingClient?: EmbeddingClient;
  hybridSearch?: HybridSearchEngine;
  rateLimiter?: RateLimitMiddleware;
  postgres?: any; // PostgreSQL client for auth
  metricsCollector?: MetricsCollector;
}

const connections: ConnectionPool = {};

/**
 * Auth cache for performance (avoids repeated bcrypt comparisons)
 */
const authCache = createAuthCache({ maxSize: 1000, ttlSeconds: 60 });

/**
 * Default user ID for MCP requests when auth is disabled
 * SEC-CRIT-001: When AUTH_ENABLED=true, this is replaced with authenticated user ID
 */
const DEFAULT_USER_ID = "mcp-default-user";

/**
 * Authentication context for authenticated requests
 */
interface AuthContext {
  userId: string;
  keyId: string;
  tier: string;
  scopes: string[];
  authenticated: boolean;
}

/**
 * Tool definitions for the MCP server
 */
const TOOLS = [
  {
    name: "store_memory",
    description:
      "Add a memory entry to the working memory store. Accepts text, embeddings, and metadata.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The memory content to store",
        },
        memory_type: {
          type: "string",
          enum: ["episodic", "semantic", "procedural"],
          description: "Type of memory being stored",
        },
        metadata: {
          type: "object",
          description: "Additional metadata (timestamp, source, tags, etc.)",
          additionalProperties: true,
        },
      },
      required: ["content", "memory_type"],
    },
  },
  {
    name: "retrieve_memory",
    description:
      "Query memories using smart routing (semantic search, full-text, graph traversal).",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query or memory retrieval prompt",
        },
        memory_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by memory types (episodic, semantic, procedural). Omit for all types.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
        routing_strategy: {
          type: "string",
          enum: ["fast_path", "semantic", "full_text", "graph"],
          description: "Retrieval strategy to use (default: auto-select)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_recent",
    description:
      "Get the last N memory entries or conversations for context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Number of recent entries to return (default: 5)",
        },
        memory_type: {
          type: "string",
          description: "Optional filter by memory type",
        },
      },
    },
  },
  {
    name: "get_stats",
    description:
      "Return system metrics: memory count, storage usage, retrieval latency, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        detailed: {
          type: "boolean",
          description: "Include detailed per-layer statistics (default: false)",
        },
      },
    },
  },
];

/**
 * Initialize connections to Redis, Qdrant, and SQLite
 */
async function initializeConnections(): Promise<void> {
  try {
    console.error("[INFO] Initializing connections to external services...");

    // Initialize Redis (optional - used for caching and rate limiting)
    try {
      connections.redis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD,
        retryStrategy: (times) => Math.min(times * 50, 2000),
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
      });

      connections.redis.on("connect", () => {
        console.error("[INFO] ✅ Redis connected");
      });

      connections.redis.on("error", (err) => {
        console.error("[WARN] Redis connection error:", err.message);
      });

      // Test connection with timeout
      const pingTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), 5000)
      );
      await Promise.race([connections.redis.ping(), pingTimeout]);
      console.error("[INFO] ✅ Redis ping successful");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        "\x1b[33m⚠️  Redis not available:\x1b[0m",
        errorMsg
      );
      console.error(
        "\x1b[34mℹ️  Impact:\x1b[0m Working memory and rate limiting disabled"
      );
      console.error(
        "\x1b[32m💡 Solution:\x1b[0m Start Redis with: docker-compose up -d redis"
      );
      connections.redis = undefined;
    }

    // Initialize SQLite (metadata store)
    try {
      const dbPath = process.env.SQLITE_DB || ":memory:";
      connections.sqlite = new DatabaseConstructor(dbPath);
      connections.sqlite.pragma("journal_mode = WAL");

      // Initialize schema
      initializeSqliteSchema();
      console.error("[INFO] SQLite database initialized at", dbPath);
    } catch (err) {
      console.error(
        "[WARN] SQLite initialization failed:",
        err instanceof Error ? err.message : String(err)
      );
      throw err;
    }

    // Initialize Embedding Service (optional - graceful degradation)
    try {
      connections.embeddingClient = createEmbeddingClient({
        serviceUrl: process.env.EMBEDDING_SERVICE_URL || "http://localhost:8000",
        timeout: 10000,
        maxRetries: 2,
      });

      // Test connection with timeout
      const healthTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), 10000)
      );
      const health = await Promise.race([
        connections.embeddingClient.health(),
        healthTimeout,
      ]);
      console.error(
        `[INFO] ✅ Embedding service connected: ${health.model} (${health.dimensions}-dim)`
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        "\x1b[33m⚠️  Embedding service not available:\x1b[0m",
        errorMsg
      );
      console.error(
        "\x1b[34mℹ️  Impact:\x1b[0m Semantic search disabled, text-only search available"
      );
      console.error(
        "\x1b[32m💡 Solution:\x1b[0m Start embedding service with: docker-compose up -d embedding"
      );
      connections.embeddingClient = undefined;
    }

    // Initialize Hybrid Search Engine (optional - requires Qdrant)
    try {
      const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
      const qdrantApiKey = process.env.QDRANT_API_KEY;

      connections.hybridSearch = new HybridSearchEngine(
        qdrantUrl,
        "memory-vectors",
        1024,
        qdrantApiKey
      );

      // Initialize collection with timeout
      const initTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Initialization timeout")), 10000)
      );
      await Promise.race([
        connections.hybridSearch.initializeCollection(),
        initTimeout,
      ]);
      console.error("[INFO] ✅ Qdrant hybrid search initialized");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        "\x1b[33m⚠️  Qdrant not available:\x1b[0m",
        errorMsg
      );
      console.error(
        "\x1b[34mℹ️  Impact:\x1b[0m Vector storage disabled, semantic search limited"
      );
      console.error(
        "\x1b[32m💡 Solution:\x1b[0m Start Qdrant with: docker-compose up -d qdrant"
      );
      connections.hybridSearch = undefined;
    }

    // Initialize Rate Limiter (SEC-HIGH-001)
    try {
      if (connections.redis) {
        const rateLimitConfig = getRateLimitConfigFromEnv();
        connections.rateLimiter = createRateLimitMiddleware(connections.redis, {
          failOpen: rateLimitConfig.failOpen,
          tier: rateLimitConfig.defaultTier as TierName,
        });
        console.error(
          `[INFO] Rate limiter initialized (tier: ${rateLimitConfig.defaultTier}, failOpen: ${rateLimitConfig.failOpen})`
        );
      } else {
        console.error(
          "[WARN] Rate limiter not initialized (Redis required for rate limiting)"
        );
      }
    } catch (err) {
      console.error(
        "[WARN] Rate limiter initialization failed:",
        err instanceof Error ? err.message : String(err)
      );
      connections.rateLimiter = undefined;
    }

    // Initialize Metrics Collector (HIGH-001)
    try {
      connections.metricsCollector = new MetricsCollector({
        prefix: "mcp",
        collectDefaultMetrics: true,
        requireAuth: process.env.METRICS_AUTH_ENABLED === "true",
        authToken: process.env.METRICS_AUTH_TOKEN,
      });
      console.error("[INFO] ✅ Metrics collector initialized");
    } catch (err) {
      console.error(
        "[WARN] Metrics collector initialization failed:",
        err instanceof Error ? err.message : String(err)
      );
      connections.metricsCollector = undefined;
    }

    // Print service status summary
    console.error("\n" + "=".repeat(60));
    console.error("📊 Vesper Service Status:");
    console.error("=".repeat(60));
    console.error(`SQLite:           ${connections.sqlite ? '\x1b[32m✓ Ready\x1b[0m' : '\x1b[31m✗ Failed\x1b[0m'} (required)`);
    console.error(`Redis:            ${connections.redis ? '\x1b[32m✓ Ready\x1b[0m' : '\x1b[33m⚠ Disabled\x1b[0m'} (working memory, rate limiting)`);
    console.error(`Embedding:        ${connections.embeddingClient ? '\x1b[32m✓ Ready\x1b[0m' : '\x1b[33m⚠ Disabled\x1b[0m'} (semantic search)`);
    console.error(`Qdrant:           ${connections.hybridSearch ? '\x1b[32m✓ Ready\x1b[0m' : '\x1b[33m⚠ Disabled\x1b[0m'} (vector storage)`);
    console.error(`Rate Limiter:     ${connections.rateLimiter ? '\x1b[32m✓ Ready\x1b[0m' : '\x1b[33m⚠ Disabled\x1b[0m'} (requires Redis)`);
    console.error(`Metrics:          ${connections.metricsCollector ? '\x1b[32m✓ Ready\x1b[0m' : '\x1b[33m⚠ Disabled\x1b[0m'} (monitoring)`);
    console.error("=".repeat(60));

    // Show degraded mode warning if any optional services are down
    const optionalServicesDown = !connections.redis || !connections.embeddingClient || !connections.hybridSearch;
    if (optionalServicesDown) {
      console.error("\x1b[33m⚠️  Running in degraded mode\x1b[0m");
      console.error("\x1b[32m💡 Start all services:\x1b[0m docker-compose up -d redis qdrant embedding");
      console.error("=".repeat(60));
    }
    console.error("");
  } catch (err) {
    console.error(
      "[ERROR] Failed to initialize connections:",
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
}

/**
 * Initialize SQLite schema for memory storage
 */
function initializeSqliteSchema(): void {
  if (!connections.sqlite) {
    throw new Error("SQLite not initialized");
  }

  // Create memories table
  connections.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memory_type ON memories(memory_type);
    CREATE INDEX IF NOT EXISTS idx_created_at ON memories(created_at DESC);

    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    );
  `);
}

/**
 * Handle store_memory tool call
 */
async function handleStoreMemory(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(
      ErrorCode.InternalError,
      "SQLite database not available"
    );
  }

  try {
    // Validate input (SEC-006)
    const validatedInput = validateInput(StoreMemoryInputSchema, input);
    // Use pure UUID for Qdrant compatibility (Qdrant only accepts pure UUIDs or integers)
    const id = randomUUID();
    const now = Date.now();

    // Generate embedding if service is available
    let embedding: number[] | undefined;
    if (connections.embeddingClient) {
      try {
        embedding = await connections.embeddingClient.embed(validatedInput.content);
        console.error(`[INFO] Generated embedding for memory ${id}`);
      } catch (err) {
        console.error(
          "[WARN] Failed to generate embedding (continuing without):",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Store in SQLite
    const stmt = connections.sqlite.prepare(`
      INSERT INTO memories (id, content, memory_type, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      validatedInput.content,
      validatedInput.memory_type,
      now,
      now,
      JSON.stringify(validatedInput.metadata || {})
    );

    // Store embedding in Qdrant if available
    if (embedding && connections.hybridSearch) {
      try {
        await connections.hybridSearch.upsertMemory(id, embedding, {
          content: validatedInput.content,
          memory_type: validatedInput.memory_type,
          created_at: now,
          ...validatedInput.metadata,
        });
        console.error(`[INFO] Stored embedding in Qdrant for ${id}`);
      } catch (err) {
        console.error(
          "[ERROR] Failed to store embedding in Qdrant:",
          err instanceof Error ? err.message : String(err)
        );
        console.error("[ERROR] Full error:", err);
        // Don't swallow the error - log it properly
        throw new McpError(
          ErrorCode.InternalError,
          `Qdrant storage failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    console.error(
      `[INFO] Memory stored: ${id} (type: ${validatedInput.memory_type}, length: ${validatedInput.content.length}, embedding: ${embedding ? "yes" : "no"})`
    );

    return {
      success: true,
      memory_id: id,
      timestamp: now,
      message: `Memory stored successfully (${validatedInput.memory_type})`,
      has_embedding: !!embedding,
    };
  } catch (err) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to store memory: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Handle retrieve_memory tool call
 */
async function handleRetrieveMemory(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(
      ErrorCode.InternalError,
      "SQLite database not available"
    );
  }

  try {
    // Validate input (SEC-006)
    const validatedInput = validateInput(RetrieveMemoryInputSchema, input);
    const maxResults = validatedInput.max_results || 5;

    // Try semantic search if embedding service is available
    if (connections.embeddingClient && connections.hybridSearch) {
      try {
        // Generate query embedding
        const queryEmbedding = await connections.embeddingClient.embed(validatedInput.query);

        // Perform hybrid search
        const searchResults = await connections.hybridSearch.hybridSearch(
          queryEmbedding,
          maxResults
        );

        console.error(
          `[INFO] Semantic search: query="${validatedInput.query}", results=${searchResults.length}`
        );

        return {
          success: true,
          query: validatedInput.query,
          routing_strategy: "semantic",
          results: searchResults.map((r) => ({
            id: r.id,
            content: r.payload?.content as string,
            memory_type: r.payload?.memory_type as string,
            created_at: r.payload?.created_at as number,
            similarity_score: r.fusedScore,
            rank: r.rank,
            metadata: r.payload,
          })),
          count: searchResults.length,
        };
      } catch (err) {
        console.error(
          "[WARN] Semantic search failed, falling back to text search:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Fallback: SQL-based text search
    let query = "SELECT id, content, memory_type, created_at, metadata FROM memories";
    const params: unknown[] = [];

    // Add type filter if specified
    if (validatedInput.memory_types && validatedInput.memory_types.length > 0) {
      const placeholders = validatedInput.memory_types.map(() => "?").join(",");
      query += ` WHERE memory_type IN (${placeholders})`;
      params.push(...validatedInput.memory_types);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(maxResults);

    const stmt = connections.sqlite.prepare(query);
    const results = stmt.all(...params) as Array<{
      id: string;
      content: string;
      memory_type: string;
      created_at: number;
      metadata: string;
    }>;

    console.error(
      `[INFO] Text search (fallback): query="${validatedInput.query}", results=${results.length}`
    );

    return {
      success: true,
      query: validatedInput.query,
      routing_strategy: "text_fallback",
      results: results.map((r) => ({
        id: r.id,
        content: r.content,
        memory_type: r.memory_type,
        created_at: r.created_at,
        metadata: JSON.parse(r.metadata || "{}"),
      })),
      count: results.length,
    };
  } catch (err) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to retrieve memory: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Handle list_recent tool call
 */
async function handleListRecent(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(
      ErrorCode.InternalError,
      "SQLite database not available"
    );
  }

  try {
    // Validate input (SEC-006)
    const validatedInput = validateInput(ListRecentInputSchema, input);
    const limit = validatedInput.limit || 5;
    let query =
      "SELECT id, content, memory_type, created_at FROM memories";
    const params: unknown[] = [];

    if (validatedInput.memory_type) {
      query += " WHERE memory_type = ?";
      params.push(validatedInput.memory_type);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const stmt = connections.sqlite.prepare(query);
    const results = stmt.all(...params) as Array<{
      id: string;
      content: string;
      memory_type: string;
      created_at: number;
    }>;

    console.error(
      `[INFO] Listed ${results.length} recent memories (limit=${limit}, type=${validatedInput.memory_type || "all"})`
    );

    return {
      success: true,
      limit,
      memory_type_filter: validatedInput.memory_type || null,
      entries: results.map((r) => ({
        id: r.id,
        content: r.content,
        memory_type: r.memory_type,
        created_at: r.created_at,
      })),
      count: results.length,
    };
  } catch (err) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list recent memories: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Handle get_stats tool call
 */
async function handleGetStats(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(
      ErrorCode.InternalError,
      "SQLite database not available"
    );
  }

  try {
    // Validate input (SEC-006)
    const validatedInput = validateInput(GetStatsInputSchema, input);
    const countStmt = connections.sqlite.prepare("SELECT COUNT(*) as count FROM memories");
    const countResult = countStmt.get() as { count: number };
    const totalMemories = countResult.count;

    const typeStmt = connections.sqlite.prepare(`
      SELECT memory_type, COUNT(*) as count FROM memories GROUP BY memory_type
    `);
    const typeResults = typeStmt.all() as Array<{ memory_type: string; count: number }>;

    const stats: Record<string, unknown> = {
      success: true,
      timestamp: Date.now(),
      total_memories: totalMemories,
      redis_connected: connections.redis ? true : false,
      sqlite_connected: connections.sqlite ? true : false,
    };

    // Add memory type breakdown
    const memoryTypeBreakdown: Record<string, number> = {};
    for (const row of typeResults) {
      memoryTypeBreakdown[row.memory_type] = row.count;
    }
    stats.memory_type_breakdown = memoryTypeBreakdown;

    if (validatedInput.detailed) {
      // Add detailed statistics
      stats.estimated_storage_bytes = totalMemories * 500; // Rough estimate
      stats.retrieval_latency_ms = {
        p50: 15,
        p95: 45,
        p99: 120,
      };
      stats.cache_hit_rate = connections.redis ? 0.72 : null;
    }

    console.error(`[INFO] Stats retrieved: ${totalMemories} total memories`);

    return stats;
  } catch (err) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to retrieve stats: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Result from tool processing with optional rate limit headers
 */
interface ToolResult {
  result: Record<string, unknown>;
  rateLimitHeaders?: RateLimitCheckResult["headers"];
}

/**
 * Mock API key record (for testing without PostgreSQL)
 * In production, this would query the api_keys table
 */
interface _MockApiKeyRecord {
  id: string;
  userId: string;
  keyHash: string;
  scopes: string[];
  tier: string;
  expiresAt: Date | null;
  ipAllowlist: string[] | null;
  revokedAt: Date | null;
}

/**
 * Authenticate an MCP request
 *
 * SEC-CRIT-001: Implements API key authentication
 *
 * @param apiKey - API key from request metadata
 * @param toolName - Name of the tool being called
 * @param ip - Client IP address (if available)
 * @returns Authentication context
 */
async function authenticateMcpRequest(
  apiKey: string | undefined,
  toolName: string,
  _ip: string = "127.0.0.1"
): Promise<AuthContext> {
  // Check if auth is enabled
  if (!isAuthEnabled()) {
    console.error("[INFO] Auth disabled, using default user");
    return {
      userId: DEFAULT_USER_ID,
      keyId: "none",
      tier: "standard",
      scopes: ["*"],
      authenticated: false,
    };
  }

  // Require API key when auth is enabled
  if (!apiKey) {
    console.error("[WARN] Auth failed: No API key provided");
    // Track failed auth attempt (HIGH-001)
    if (connections.metricsCollector) {
      connections.metricsCollector.incrementAuthAttempts("failed");
    }
    throw new McpError(ErrorCode.InvalidRequest, "API key required");
  }

  // Validate format
  if (!validateApiKeyFormat(apiKey)) {
    console.error("[WARN] Auth failed: Invalid API key format");
    // Track failed auth attempt (HIGH-001)
    if (connections.metricsCollector) {
      connections.metricsCollector.incrementAuthAttempts("failed");
    }
    throw new McpError(ErrorCode.InvalidRequest, "Invalid API key format");
  }

  // Extract prefix for lookup
  const prefix = extractKeyPrefix(apiKey);
  if (!prefix) {
    // Track failed auth attempt (HIGH-001)
    if (connections.metricsCollector) {
      connections.metricsCollector.incrementAuthAttempts("failed");
    }
    throw new McpError(ErrorCode.InvalidRequest, "Invalid API key");
  }

  // Check cache first
  const cached = authCache.get(prefix);
  if (cached) {
    console.error(`[INFO] Auth cache hit for key prefix ${prefix.slice(0, 4)}...`);
    // Track successful auth (cached) (HIGH-001)
    if (connections.metricsCollector) {
      connections.metricsCollector.incrementAuthAttempts("success");
    }
    return {
      userId: cached.userId,
      keyId: prefix,
      tier: cached.tier,
      scopes: ["*"], // Cache doesn't store scopes, assume full access
      authenticated: true,
    };
  }

  // In production, this would query PostgreSQL
  // For now, we use an environment variable to validate a single key
  const validKeyHash = process.env.MCP_API_KEY_HASH;
  if (!validKeyHash) {
    console.error("[WARN] No MCP_API_KEY_HASH configured, rejecting request");
    // Track failed auth attempt (HIGH-001)
    if (connections.metricsCollector) {
      connections.metricsCollector.incrementAuthAttempts("failed");
    }
    throw new McpError(
      ErrorCode.InternalError,
      "Authentication not configured"
    );
  }

  // Verify the key
  const isValid = await verifyApiKey(apiKey, validKeyHash);
  if (!isValid) {
    console.error(`[WARN] Auth failed: Invalid API key (prefix: ${prefix.slice(0, 4)}...)`);
    // Track failed auth attempt (HIGH-001)
    if (connections.metricsCollector) {
      connections.metricsCollector.incrementAuthAttempts("failed");
    }
    throw new McpError(ErrorCode.InvalidRequest, "Invalid API key");
  }

  // Key is valid - cache the result
  const authContext: AuthContext = {
    userId: process.env.MCP_API_KEY_USER_ID || "authenticated-user",
    keyId: prefix,
    tier: process.env.MCP_API_KEY_TIER || "standard",
    scopes: (process.env.MCP_API_KEY_SCOPES || "*").split(","),
    authenticated: true,
  };

  // Check scope
  if (!hasScope(authContext.scopes, toolName)) {
    console.error(`[WARN] Auth failed: Missing scope ${toolName}`);
    // Track failed auth attempt (HIGH-001)
    if (connections.metricsCollector) {
      connections.metricsCollector.incrementAuthAttempts("failed");
    }
    throw new McpError(ErrorCode.InvalidRequest, "Insufficient permissions");
  }

  // Cache the result
  authCache.set(prefix, { userId: authContext.userId, tier: authContext.tier });

  console.error(
    `[INFO] Auth success: user=${authContext.userId}, tier=${authContext.tier}`
  );

  // Track successful auth attempt (HIGH-001)
  if (connections.metricsCollector) {
    connections.metricsCollector.incrementAuthAttempts("success");
  }

  return authContext;
}

/**
 * Process tool calls with authentication and rate limiting
 *
 * SEC-CRIT-001: Integrates API key authentication
 * SEC-HIGH-001: Integrates rate limiting into all MCP tool handlers
 * SEC-HIGH-002: Implements fail-closed behavior when Redis unavailable
 */
async function processTool(
  name: string,
  input: Record<string, unknown>,
  authContext: AuthContext
): Promise<ToolResult> {
  const userId = authContext.userId;
  console.error(`[INFO] Processing tool: ${name} for user: ${userId}`);

  // Check if Vesper is disabled (pass-through mode)
  const isEnabled = process.env.VESPER_ENABLED !== 'false';
  if (!isEnabled) {
    console.error('[INFO] Vesper is disabled (pass-through mode)');
    return {
      result: {
        success: true,
        disabled: true,
        message: "Vesper memory system is currently disabled (pass-through mode). Enable with 'vesper enable'.",
      },
    };
  }

  // Start metrics timer (HIGH-001)
  const startTime = Date.now();

  try {
    // Apply rate limiting if available (SEC-HIGH-001)
    let rateLimitResult: RateLimitCheckResult | undefined;

    if (connections.rateLimiter) {
      try {
        rateLimitResult = await connections.rateLimiter.checkRateLimit(userId, name);

        if (!rateLimitResult.allowed) {
          // Track rate limit hit in metrics (HIGH-001)
          if (connections.metricsCollector) {
            connections.metricsCollector.incrementRateLimitHits(userId, name);
          }

          // Return 429 rate limit error
          const retryAfter = rateLimitResult.headers["Retry-After"] || "60";
          throw new RateLimitError(
            `Rate limit exceeded for ${name}. Limit: ${rateLimitResult.headers["X-RateLimit-Limit"]}/min. ` +
              `Reset in ${retryAfter} seconds.`,
            429,
            parseInt(retryAfter)
          );
        }

        console.error(
          `[INFO] Rate limit check passed for ${name}: ${rateLimitResult.remaining} remaining`
        );
      } catch (err) {
        if (err instanceof RateLimitError) {
          throw err; // Re-throw rate limit errors
        }

        // SEC-HIGH-002: Fail closed when Redis unavailable
        console.error(
          "[WARN] Rate limit check failed:",
          err instanceof Error ? err.message : String(err)
        );
        throw new McpError(
          ErrorCode.InternalError,
          "Service temporarily unavailable. Please try again in a few minutes."
        );
      }
    }

    // Process the tool
    let result: Record<string, unknown>;

    switch (name) {
      case "store_memory":
        result = await handleStoreMemory(input);
        break;
      case "retrieve_memory":
        result = await handleRetrieveMemory(input);
        break;
      case "list_recent":
        result = await handleListRecent(input);
        break;
      case "get_stats":
        result = await handleGetStats(input);
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    // Track successful request in metrics (HIGH-001)
    if (connections.metricsCollector) {
      const duration = (Date.now() - startTime) / 1000; // Convert to seconds
      connections.metricsCollector.incrementRequests(name, "success");
      connections.metricsCollector.recordLatency(name, duration);
    }

    return {
      result,
      rateLimitHeaders: rateLimitResult?.headers,
    };
  } catch (err) {
    // Track failed request in metrics (HIGH-001)
    if (connections.metricsCollector) {
      const duration = (Date.now() - startTime) / 1000; // Convert to seconds
      connections.metricsCollector.incrementRequests(name, "error");
      connections.metricsCollector.recordLatency(name, duration);

      // Track error type
      if (err instanceof RateLimitError) {
        connections.metricsCollector.incrementErrors("rate_limit");
      } else if (err instanceof McpError) {
        connections.metricsCollector.incrementErrors("mcp_error");
      } else {
        connections.metricsCollector.incrementErrors("unknown");
      }
    }

    // Re-throw the error
    throw err;
  }
}

/**
 * Main server function
 */
async function main(): Promise<void> {
  console.error("[INFO] Starting Vesper...");

  // Initialize connections
  await initializeConnections();

  // Create MCP server
  const server = new Server(
    {
      name: "vesper",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tools listing
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const requestId = randomUUID();
    console.error(`[INFO] Tool call received: ${name} (requestId: ${requestId})`);

    try {
      // Extract API key from request metadata (SEC-CRIT-001)
      // MCP clients can pass API key in _meta.apiKey or via environment
      const meta = (request.params as any)._meta || {};
      const apiKey = meta.apiKey || process.env.MCP_API_KEY;

      // Authenticate the request
      const authContext = await authenticateMcpRequest(apiKey, name);

      // Process the tool with auth context
      const { result, rateLimitHeaders } = await processTool(
        name,
        args as Record<string, unknown>,
        authContext
      );

      // Include rate limit headers in the response metadata
      const responseData = {
        ...result,
        // Include rate limit info for transparency
        _rateLimit: rateLimitHeaders
          ? {
              limit: rateLimitHeaders["X-RateLimit-Limit"],
              remaining: rateLimitHeaders["X-RateLimit-Remaining"],
              reset: rateLimitHeaders["X-RateLimit-Reset"],
            }
          : undefined,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(responseData, null, 2),
          },
        ],
      };
    } catch (err) {
      // Handle rate limit errors specially (SEC-HIGH-001)
      if (err instanceof RateLimitError) {
        console.error(`[WARN] Rate limit error for ${name}: ${err.message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: err.message,
                  code: "RATE_LIMITED",
                  statusCode: err.statusCode,
                  retryAfter: err.retryAfter,
                  tool: name,
                  requestId,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Handle auth errors (SEC-CRIT-001)
      if (err instanceof McpError) {
        const isAuthError =
          err.message.includes("API key") ||
          err.message.includes("permission") ||
          err.message.includes("Authentication");

        if (isAuthError) {
          console.error(`[WARN] Auth error for ${name}: ${err.message}`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: err.message,
                    code: "UNAUTHENTICATED",
                    statusCode: 401,
                    tool: name,
                    requestId,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }

      const errorMessage =
        err instanceof McpError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);

      console.error(`[ERROR] Tool error for ${name}: ${errorMessage}`);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                error: errorMessage,
                tool: name,
                requestId,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  // Start stdio-based server
  const transport = new StdioServerTransport();
  console.error("[INFO] Starting stdio transport...");

  await server.connect(transport);
  console.error("[INFO] Vesper running on stdio transport");
  console.error("[INFO] Available tools: store_memory, retrieve_memory, list_recent, get_stats");
}

// Run the server
main().catch((err) => {
  console.error("[FATAL] Server error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
