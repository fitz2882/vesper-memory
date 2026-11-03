/**
 * Vesper - AI Memory System (Simplified)
 *
 * Main entry point for the Model Context Protocol server.
 * This is a simplified version with NO authentication, rate limiting, or monitoring.
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
  DeleteMemoryInputSchema,
  RecordSkillOutcomeInputSchema,
  LoadSkillInputSchema,
  ShareContextInputSchema,
  StoreDecisionInputSchema,
  ListNamespacesInputSchema,
  NamespaceStatsInputSchema,
} from "./utils/validation.js";
import { getSqlitePath, ensureDirectories } from "./utils/paths.js";
import { createEmbeddingClient, EmbeddingClient } from "./embeddings/client.js";
import { HybridSearchEngine } from "./retrieval/hybrid-search.js";
import { MemoryRetriever } from "./retrieval/memory-retriever.js";
import { IndexOutboxProcessor, initializeIndexOutboxSchema } from "./retrieval/index-outbox.js";
import { WorkingMemoryLayer } from "./memory-layers/working-memory.js";
import { SemanticMemoryLayer } from "./memory-layers/semantic-memory.js";
import { SkillLibrary } from "./memory-layers/skill-library.js";
import { ConsolidationPipeline } from "./consolidation/pipeline.js";
import { ConsolidationScheduler } from "./scheduler/consolidation-scheduler.js";
import { PerformanceMonitor } from "./utils/monitoring.js";
import * as SmartRouter from "./router/smart-router.js";

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
  workingMemory?: WorkingMemoryLayer;
  semanticMemory?: SemanticMemoryLayer;
  skillLibrary?: SkillLibrary;
  consolidationPipeline?: ConsolidationPipeline;
  consolidationScheduler?: ConsolidationScheduler;
  memoryRetriever?: MemoryRetriever;
  indexOutbox?: IndexOutboxProcessor;
  indexOutboxTimer?: ReturnType<typeof setInterval>;
}

const connections: ConnectionPool = {};

/**
 * Runtime state for Vesper enable/disable
 * Used for A/B benchmarking (enabled vs disabled comparison)
 */
let vesperEnabled = true;
const retrievalMonitor = new PerformanceMonitor();

/**
 * Tool definitions for the MCP server
 */
const NAMESPACE_PROP = {
  type: "string",
  description: "Namespace for multi-agent isolation (default: 'default')",
};

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
          enum: ["episodic", "semantic", "procedural", "decision"],
          description: "Type of memory being stored",
        },
        metadata: {
          type: "object",
          description: "Additional metadata (timestamp, source, tags, etc.)",
          additionalProperties: true,
        },
        namespace: NAMESPACE_PROP,
        agent_id: { type: "string", description: "ID of the agent storing this memory" },
        agent_role: {
          type: "string",
          description: "Role of the agent (e.g., 'orchestrator', 'code-reviewer')",
        },
        task_id: { type: "string", description: "Task ID this memory is associated with" },
        importance: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Write-time salience from 0 to 1 (default: 0.5)",
        },
        valid_from: {
          oneOf: [{ type: "number" }, { type: "string", format: "date-time" }],
          description: "When this memory became valid (Unix milliseconds or ISO 8601)",
        },
        valid_until: {
          oneOf: [{ type: "number" }, { type: "string", format: "date-time" }],
          description: "When this memory stopped being valid (Unix milliseconds or ISO 8601)",
        },
        expired_at: {
          oneOf: [{ type: "number" }, { type: "string", format: "date-time" }],
          description: "Optional retention expiry; expired memories are excluded from retrieval",
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
            "Filter by memory types (episodic, semantic, procedural, decision). Omit for all types.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
        routing_strategy: {
          type: "string",
          enum: ["fast_path", "semantic", "full_text", "hybrid", "graph"],
          description: "Retrieval strategy to use (default: auto-select)",
        },
        namespace: NAMESPACE_PROP,
        agent_id: { type: "string", description: "Filter by agent ID" },
        task_id: { type: "string", description: "Filter by task ID" },
        exclude_agent: { type: "string", description: "Exclude memories from this agent" },
        include_superseded: {
          type: "boolean",
          description: "Include decisions replaced by newer decisions (default: false)",
        },
        include_archived: {
          type: "boolean",
          description: "Include archived memories (default: false)",
        },
        as_of: {
          oneOf: [{ type: "number" }, { type: "string", format: "date-time" }],
          description: "Return memories valid at this time (Unix milliseconds or ISO 8601)",
        },
        explain: {
          type: "boolean",
          description: "Include content-free retrieval stage status and candidate counts",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_recent",
    description: "Get the last N memory entries or conversations for context.",
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
        namespace: NAMESPACE_PROP,
      },
    },
  },
  {
    name: "get_stats",
    description: "Return system metrics: memory count, storage usage, retrieval latency, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        detailed: {
          type: "boolean",
          description: "Include detailed per-layer statistics (default: false)",
        },
        namespace: NAMESPACE_PROP,
      },
    },
  },
  {
    name: "delete_memory",
    description:
      "Delete a memory entry by ID. Removes from SQLite, Qdrant, Redis, and cleans up orphaned facts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        memory_id: {
          type: "string",
          description: "The ID of the memory to delete",
        },
        namespace: NAMESPACE_PROP,
      },
      required: ["memory_id"],
    },
  },
  {
    name: "vesper_enable",
    description: "Enable the Vesper memory system. Used for A/B benchmarking.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "vesper_disable",
    description: "Disable the Vesper memory system (pass-through mode). Used for A/B benchmarking.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "vesper_status",
    description: "Get the current status of the Vesper memory system (enabled or disabled).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "record_skill_outcome",
    description:
      "Record success or failure feedback for a skill execution. Used to improve skill ranking over time.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          description: "The ID of the skill to record feedback for",
        },
        outcome: {
          type: "string",
          enum: ["success", "failure"],
          description: "Whether the skill execution was successful or not",
        },
        satisfaction: {
          type: "number",
          description: "User satisfaction score (0-1). Required for success outcome.",
        },
        namespace: NAMESPACE_PROP,
      },
      required: ["skill_id", "outcome"],
    },
  },
  {
    name: "load_skill",
    description:
      "Load full skill implementation on-demand. Use when a skill summary needs complete details for execution. Loaded skills are cached for the session.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          description: "The ID of the skill to load",
        },
        namespace: NAMESPACE_PROP,
      },
      required: ["skill_id"],
    },
  },
  {
    name: "share_context",
    description:
      "Share context (memories, skills, entities) from one namespace to another. Used for agent handoffs in multi-agent workflows.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source_namespace: { type: "string", description: "Namespace to share from" },
        target_namespace: { type: "string", description: "Namespace to share to" },
        task_id: { type: "string", description: "Filter source memories by task ID" },
        query: { type: "string", description: "Semantic query to select relevant memories" },
        max_items: { type: "number", description: "Max items to share (default: 10)" },
        include_skills: {
          type: "boolean",
          description: "Include matching skills (default: false)",
        },
        include_entities: {
          type: "boolean",
          description: "Include related entities (default: true)",
        },
      },
      required: ["source_namespace", "target_namespace"],
    },
  },
  {
    name: "store_decision",
    description:
      "Store a versioned architectural or design decision with reduced decay; optionally close a superseded decision without deleting its history.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "The decision content" },
        namespace: NAMESPACE_PROP,
        agent_id: { type: "string", description: "ID of the agent making this decision" },
        agent_role: { type: "string", description: "Role of the agent" },
        task_id: { type: "string", description: "Related task ID" },
        supersedes: { type: "string", description: "ID of a previous decision this replaces" },
        valid_from: {
          oneOf: [{ type: "number" }, { type: "string", format: "date-time" }],
          description: "When this decision became valid (Unix milliseconds or ISO 8601)",
        },
        valid_until: {
          oneOf: [{ type: "number" }, { type: "string", format: "date-time" }],
          description: "When this decision stopped being valid (Unix milliseconds or ISO 8601)",
        },
        metadata: {
          type: "object",
          description: "Additional metadata",
          additionalProperties: true,
        },
      },
      required: ["content"],
    },
  },
  {
    name: "list_namespaces",
    description:
      "List all namespaces with memory counts. Useful for discovering active agent namespaces.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "namespace_stats",
    description:
      "Get detailed statistics for a specific namespace including memory counts, entity counts, skill counts, and active agents.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "The namespace to get stats for" },
      },
      required: ["namespace"],
    },
  },
];

/**
 * Initialize connections to Redis, Qdrant, and SQLite
 */
export async function initializeConnections(): Promise<void> {
  try {
    console.error("[INFO] Initializing connections to external services...");

    // Initialize Redis (optional - used for caching)
    let redisClient: Redis | undefined;
    try {
      if (process.env.VESPER_DISABLE_OPTIONAL_SERVICES === "1") {
        throw new Error("disabled by VESPER_DISABLE_OPTIONAL_SERVICES");
      }
      redisClient = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD,
        retryStrategy: (times) => (times <= 3 ? Math.min(times * 50, 2000) : null),
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
      });

      redisClient.on("connect", () => {
        console.error("[INFO] ✅ Redis connected");
      });

      redisClient.on("error", (err) => {
        console.error("[WARN] Redis connection error:", err.message);
      });

      // Test connection with timeout
      let pingTimer: NodeJS.Timeout | undefined;
      const pingTimeout = new Promise<never>((_, reject) => {
        pingTimer = setTimeout(() => reject(new Error("Connection timeout")), 5000);
      });
      try {
        await Promise.race([redisClient.ping(), pingTimeout]);
      } finally {
        if (pingTimer) clearTimeout(pingTimer);
      }
      connections.redis = redisClient;
      console.error("[INFO] ✅ Redis ping successful");

      // Initialize Working Memory Layer
      connections.workingMemory = new WorkingMemoryLayer(redisClient, 5);
      console.error("[INFO] ✅ Working memory layer initialized");
    } catch (err) {
      redisClient?.disconnect();
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("\x1b[33m⚠️  Redis not available:\x1b[0m", errorMsg);
      console.error("\x1b[34mℹ️  Impact:\x1b[0m Working memory disabled");
      console.error("\x1b[32m💡 Solution:\x1b[0m Start Redis with: docker-compose up -d redis");
      connections.redis = undefined;
    }

    // Initialize SQLite (metadata store)
    try {
      // Ensure ~/.vesper directories exist (for user-level storage)
      ensureDirectories();

      // Use SQLITE_DB env if set, otherwise use user-level path (~/.vesper/data/memory.db)
      const isUserLevel = !process.env.SQLITE_DB;
      const dbPath = process.env.SQLITE_DB || getSqlitePath();
      connections.sqlite = new DatabaseConstructor(dbPath);
      connections.sqlite.pragma("journal_mode = WAL");
      connections.sqlite.pragma("foreign_keys = ON");
      connections.sqlite.pragma("busy_timeout = 5000");

      // Initialize schema
      initializeSqliteSchema();

      // Clear logging about storage location
      if (isUserLevel) {
        console.error(`[INFO] SQLite database initialized at ${dbPath} (user-level storage)`);
      } else {
        console.error(`[INFO] SQLite database initialized at ${dbPath} (SQLITE_DB override)`);
      }
    } catch (err) {
      console.error(
        "[WARN] SQLite initialization failed:",
        err instanceof Error ? err.message : String(err)
      );
      throw err;
    }

    // Initialize Embedding Service (optional - graceful degradation)
    try {
      if (process.env.VESPER_DISABLE_OPTIONAL_SERVICES === "1") {
        throw new Error("disabled by VESPER_DISABLE_OPTIONAL_SERVICES");
      }
      connections.embeddingClient = createEmbeddingClient({
        serviceUrl: process.env.EMBEDDING_SERVICE_URL || "http://localhost:8000",
        timeout: 10000,
        maxRetries: 2,
      });

      // Test connection with timeout
      const healthTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), 10000)
      );
      const health = await Promise.race([connections.embeddingClient.health(), healthTimeout]);
      console.error(
        `[INFO] ✅ Embedding service connected: ${health.model} (${health.dimensions}-dim)`
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("\x1b[33m⚠️  Embedding service not available:\x1b[0m", errorMsg);
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
      if (process.env.VESPER_DISABLE_OPTIONAL_SERVICES === "1") {
        throw new Error("disabled by VESPER_DISABLE_OPTIONAL_SERVICES");
      }
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
      await Promise.race([connections.hybridSearch.initializeCollection(), initTimeout]);
      console.error("[INFO] ✅ Qdrant hybrid search initialized");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("\x1b[33m⚠️  Qdrant not available:\x1b[0m", errorMsg);
      console.error("\x1b[34mℹ️  Impact:\x1b[0m Vector storage disabled, semantic search limited");
      console.error("\x1b[32m💡 Solution:\x1b[0m Start Qdrant with: docker-compose up -d qdrant");
      connections.hybridSearch = undefined;
    }

    // Initialize Semantic Memory Layer (requires SQLite)
    if (connections.sqlite) {
      try {
        // Initialize semantic memory schema
        initializeSemanticMemorySchema();
        connections.semanticMemory = new SemanticMemoryLayer(connections.sqlite);
        console.error("[INFO] ✅ Semantic memory layer initialized");
      } catch (err) {
        console.error(
          "[WARN] Semantic memory initialization failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Initialize Skill Library (requires SQLite)
    if (connections.sqlite) {
      try {
        // Initialize skill library schema
        initializeSkillLibrarySchema();
        connections.skillLibrary = new SkillLibrary(connections.sqlite);
        console.error("[INFO] ✅ Skill library initialized");
      } catch (err) {
        console.error(
          "[WARN] Skill library initialization failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // SQLite is canonical. FTS retrieval is always available; Redis and Qdrant
    // are optional projections repaired through the durable index outbox.
    if (connections.sqlite) {
      connections.memoryRetriever = new MemoryRetriever({
        db: connections.sqlite,
        embeddingClient: connections.embeddingClient,
        hybridSearch: connections.hybridSearch,
      });
      connections.memoryRetriever.initialize();

      connections.indexOutbox = new IndexOutboxProcessor(connections.sqlite, {
        embeddingClient: connections.embeddingClient,
        hybridSearch: connections.hybridSearch,
        workingMemory: connections.workingMemory,
        projectionConfig: {
          qdrant: process.env.VESPER_DISABLE_OPTIONAL_SERVICES !== "1",
          redis: process.env.VESPER_DISABLE_OPTIONAL_SERVICES !== "1",
        },
      });

      setImmediate(async () => {
        try {
          const stats = await connections.indexOutbox!.drain();
          console.error(
            `[INFO] Index outbox: ${stats.completed} completed, ${stats.pending} pending`
          );
        } catch (error) {
          console.error(
            "[WARN] Index outbox drain failed:",
            error instanceof Error ? error.message : String(error)
          );
        }
      });
      connections.indexOutboxTimer = setInterval(async () => {
        try {
          await connections.indexOutbox?.drain();
        } catch (error) {
          console.error(
            "[WARN] Periodic index repair failed:",
            error instanceof Error ? error.message : String(error)
          );
        }
      }, 30_000);
      connections.indexOutboxTimer.unref();
    }

    // Consolidation reads canonical SQLite rows. Redis is an optional cache,
    // not an ingestion dependency.
    if (connections.semanticMemory && connections.skillLibrary && connections.sqlite) {
      try {
        connections.consolidationPipeline = new ConsolidationPipeline(
          connections.workingMemory,
          connections.semanticMemory,
          connections.skillLibrary,
          connections.sqlite
        );
        console.error("[INFO] ✅ Consolidation pipeline initialized");

        connections.consolidationScheduler = new ConsolidationScheduler(
          connections.consolidationPipeline
        );
        connections.consolidationScheduler.start();

        // Process the bounded, durable backlog without delaying MCP startup.
        if (process.env.VESPER_DISABLE_STARTUP_CONSOLIDATION !== "1")
          setImmediate(async () => {
            try {
              console.error("[INFO] 🔄 Running startup consolidation...");
              const stats = await connections.consolidationScheduler!.runNow();
              console.error(
                `[INFO] ✅ Startup consolidation complete: ${stats.memoriesProcessed} memories, ` +
                  `${stats.entitiesExtracted} entities, ${stats.conflictsDetected} conflicts, ` +
                  `${stats.skillsExtracted} skills in ${stats.duration}ms`
              );
            } catch (err) {
              console.error(
                "[WARN] Startup consolidation failed:",
                err instanceof Error ? err.message : String(err)
              );
            }
          });
      } catch (err) {
        console.error(
          "[WARN] Consolidation pipeline initialization failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    } else {
      console.error("[WARN] Consolidation pipeline not initialized (missing SQLite-backed layers)");
    }

    // Initialize Smart Router with all available dependencies
    SmartRouter.init({
      workingMemory: connections.workingMemory,
      semanticMemory: connections.semanticMemory,
      hybridSearch: connections.hybridSearch,
      embeddingClient: connections.embeddingClient,
      sqlite: connections.sqlite,
    });

    // Initialize skill handler in router
    if (connections.skillLibrary) {
      SmartRouter.initSkillHandler(connections.skillLibrary);
      console.error("[INFO] ✅ Smart router skill handler initialized");
    }

    // Initialize preference handler in router
    if (connections.semanticMemory) {
      SmartRouter.initPreferenceHandler(connections.semanticMemory);
      console.error("[INFO] ✅ Smart router preference handler initialized");
    }

    console.error("[INFO] ✅ Smart router initialized");

    // Print service status summary
    console.error("\n" + "=".repeat(60));
    console.error("📊 Vesper Service Status:");
    console.error("=".repeat(60));
    console.error(
      `SQLite:           ${connections.sqlite ? "\x1b[32m✓ Ready\x1b[0m" : "\x1b[31m✗ Failed\x1b[0m"} (required)`
    );
    console.error(
      `Redis:            ${connections.redis ? "\x1b[32m✓ Ready\x1b[0m" : "\x1b[33m⚠ Disabled\x1b[0m"} (working memory)`
    );
    console.error(
      `Embedding:        ${connections.embeddingClient ? "\x1b[32m✓ Ready\x1b[0m" : "\x1b[33m⚠ Disabled\x1b[0m"} (semantic search)`
    );
    console.error(
      `Qdrant:           ${connections.hybridSearch ? "\x1b[32m✓ Ready\x1b[0m" : "\x1b[33m⚠ Disabled\x1b[0m"} (vector storage)`
    );
    console.error("=".repeat(60));

    // Show degraded mode warning if any optional services are down
    const optionalServicesDown =
      !connections.redis || !connections.embeddingClient || !connections.hybridSearch;
    if (optionalServicesDown) {
      console.error("\x1b[33m⚠️  Running in degraded mode\x1b[0m");
      console.error(
        "\x1b[32m💡 Start all services:\x1b[0m docker-compose up -d redis qdrant embedding"
      );
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

  ensureColumn("memories", "consolidated_at", "INTEGER");
  ensureColumn("memories", "namespace", "TEXT DEFAULT 'default'");
  ensureColumn("memories", "agent_id", "TEXT");
  ensureColumn("memories", "agent_role", "TEXT");
  ensureColumn("memories", "task_id", "TEXT");
  ensureColumn("memories", "importance", "REAL DEFAULT 0.5");
  ensureColumn("memories", "access_count", "INTEGER DEFAULT 0");
  ensureColumn("memories", "last_accessed", "INTEGER");
  const addedValidFrom = ensureColumn("memories", "valid_from", "INTEGER");
  ensureColumn("memories", "valid_until", "INTEGER");
  ensureColumn("memories", "expired_at", "INTEGER");
  ensureColumn("memories", "archived_at", "INTEGER");

  // Leave legacy rows unconsolidated. The old write path did not reliably
  // populate the Redis source consumed by the old pipeline, so bounded runs of
  // the canonical SQLite pipeline must be allowed to backfill them.
  if (addedValidFrom) {
    connections.sqlite.exec("UPDATE memories SET valid_from = created_at WHERE valid_from IS NULL");
  }

  connections.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(namespace, agent_id);
    CREATE INDEX IF NOT EXISTS idx_memories_task ON memories(namespace, task_id);
    CREATE INDEX IF NOT EXISTS idx_memories_validity
      ON memories(namespace, valid_from, valid_until, expired_at, archived_at);
  `);

  initializeIndexOutboxSchema(connections.sqlite);
  connections.sqlite.pragma("user_version = 1");
}

function ensureColumn(table: string, column: string, definition: string): boolean {
  if (!connections.sqlite) throw new Error("SQLite not initialized");
  const columns = connections.sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (columns.some((existing) => existing.name === column)) return false;
  connections.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function toEpochMillis(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid timestamp: ${value}`);
  }
  return parsed;
}

function sqliteEpochMillisExpression(expression: string): string {
  return `(CASE
    WHEN typeof(${expression}) IN ('integer', 'real')
      THEN CASE WHEN ABS(${expression}) < 100000000000 THEN ${expression} * 1000 ELSE ${expression} END
    WHEN trim(${expression}) != '' AND trim(${expression}) NOT GLOB '*[^0-9.]*'
      THEN CASE
        WHEN ABS(CAST(${expression} AS REAL)) < 100000000000
          THEN CAST(${expression} AS REAL) * 1000
        ELSE CAST(${expression} AS REAL)
      END
    ELSE CAST(strftime('%s', ${expression}) AS INTEGER) * 1000
  END)`;
}

/**
 * Initialize SQLite schema for semantic memory (HippoRAG knowledge graph)
 */
function initializeSemanticMemorySchema(): void {
  if (!connections.sqlite) {
    throw new Error("SQLite not initialized");
  }

  connections.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      confidence REAL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      last_accessed TEXT NOT NULL,
      access_count INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      strength REAL DEFAULT 0.8,
      evidence TEXT,
      created_at TEXT NOT NULL,
      last_reinforced TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);

    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      property TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      valid_from TEXT,
      valid_until TEXT,
      source_conversation TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id);

    CREATE TABLE IF NOT EXISTS conflicts (
      id TEXT PRIMARY KEY,
      fact_id_1 TEXT,
      fact_id_2 TEXT,
      conflict_type TEXT,
      entity_id TEXT,
      property TEXT,
      description TEXT,
      severity TEXT,
      resolution_status TEXT
    );

    CREATE TABLE IF NOT EXISTS backup_metadata (
      id TEXT PRIMARY KEY,
      backup_timestamp TEXT,
      backup_type TEXT NOT NULL,
      status TEXT DEFAULT 'completed',
      backup_path TEXT NOT NULL,
      file_size_bytes INTEGER,
      entities_count INTEGER,
      relationships_count INTEGER,
      facts_count INTEGER,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      notes TEXT,
      metadata TEXT
    );
  `);

  // v0.5.0 namespace migration for semantic memory tables
  const semanticNamespaceMigrations = [
    "ALTER TABLE entities ADD COLUMN namespace TEXT DEFAULT 'default'",
    "ALTER TABLE relationships ADD COLUMN namespace TEXT DEFAULT 'default'",
    "ALTER TABLE facts ADD COLUMN namespace TEXT DEFAULT 'default'",
    "ALTER TABLE conflicts ADD COLUMN namespace TEXT DEFAULT 'default'",
  ];
  for (const sql of semanticNamespaceMigrations) {
    try {
      connections.sqlite.exec(sql);
    } catch (_) {
      /* column already exists */
    }
  }
  ensureColumn("conflicts", "entity_id", "TEXT");
  ensureColumn("conflicts", "property", "TEXT");

  ensureColumn("backup_metadata", "backup_timestamp", "TEXT");
  ensureColumn("backup_metadata", "status", "TEXT DEFAULT 'completed'");
  ensureColumn("backup_metadata", "file_size_bytes", "INTEGER");
  ensureColumn("backup_metadata", "entities_count", "INTEGER");
  ensureColumn("backup_metadata", "relationships_count", "INTEGER");
  ensureColumn("backup_metadata", "facts_count", "INTEGER");
  ensureColumn("backup_metadata", "notes", "TEXT");
  ensureColumn("backup_metadata", "metadata", "TEXT");
  connections.sqlite.exec(`
    UPDATE backup_metadata
    SET backup_timestamp = COALESCE(backup_timestamp, created_at),
        status = COALESCE(status, 'completed')
  `);

  ensureColumn("relationships", "last_decayed_at", "TEXT");
  connections.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_entities_namespace ON entities(namespace);
    CREATE INDEX IF NOT EXISTS idx_relationships_namespace ON relationships(namespace);
    CREATE INDEX IF NOT EXISTS idx_facts_namespace ON facts(namespace);
    CREATE INDEX IF NOT EXISTS idx_conflicts_namespace ON conflicts(namespace);
  `);
}

/**
 * Initialize SQLite schema for skill library (procedural memory)
 */
function initializeSkillLibrarySchema(): void {
  if (!connections.sqlite) {
    throw new Error("SQLite not initialized");
  }

  connections.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      triggers TEXT NOT NULL,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      avg_user_satisfaction REAL DEFAULT 0.5
    );

    CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
  `);

  // v0.5.0 namespace migration for skills table
  try {
    connections.sqlite.exec("ALTER TABLE skills ADD COLUMN namespace TEXT DEFAULT 'default'");
  } catch (_) {
    /* column already exists */
  }
  connections.sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_skills_namespace ON skills(namespace);`);

  // Apply lazy loading migration (idempotent - safe to run multiple times)
  try {
    connections.sqlite.exec(`
      -- Add lazy loading columns if they don't exist
      -- SQLite 3.35.0+ supports IF NOT EXISTS for ALTER TABLE ADD COLUMN

      -- Add summary column (lightweight description for context injection)
      ALTER TABLE skills ADD COLUMN summary TEXT;
    `);
  } catch (err) {
    // Column already exists, continue
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN is_archived INTEGER DEFAULT 0;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN last_used TEXT;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN last_modified TEXT DEFAULT CURRENT_TIMESTAMP;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN version INTEGER DEFAULT 1;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN code TEXT;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN code_type TEXT DEFAULT 'reference';
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN prerequisites TEXT;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN uses_skills TEXT;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN used_by_skills TEXT;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN created_from TEXT;
    `);
  } catch (err) {
    // Column already exists
  }

  try {
    connections.sqlite.exec(`
      ALTER TABLE skills ADD COLUMN notes TEXT;
    `);
  } catch (err) {
    // Column already exists
  }

  // Create indexes for lazy loading (idempotent)
  connections.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_skills_lazy_loading
      ON skills(is_archived, avg_user_satisfaction DESC, success_count DESC);

    CREATE INDEX IF NOT EXISTS idx_skills_last_used
      ON skills(last_used DESC);

    CREATE INDEX IF NOT EXISTS idx_skills_category_quality
      ON skills(category, avg_user_satisfaction DESC, success_count DESC);
  `);

  // Update existing skills with defaults
  connections.sqlite.exec(`
    UPDATE skills
    SET summary = CASE
      WHEN summary IS NULL AND length(description) <= 100 THEN description
      WHEN summary IS NULL THEN substr(description, 1, 97) || '...'
      ELSE summary
    END
    WHERE summary IS NULL OR summary = '';

    UPDATE skills
    SET created_at = CURRENT_TIMESTAMP
    WHERE created_at IS NULL;

    UPDATE skills
    SET last_modified = CURRENT_TIMESTAMP
    WHERE last_modified IS NULL;

    UPDATE skills
    SET is_archived = 0
    WHERE is_archived IS NULL;
  `);
}

/**
 * Handle store_memory tool call
 */
async function handleStoreMemory(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(ErrorCode.InternalError, "SQLite database not available");
  }

  try {
    const validatedInput = validateInput(StoreMemoryInputSchema, input);
    const namespace = validatedInput.namespace || "default";
    const id = randomUUID();
    const now = Date.now();
    const validFrom = toEpochMillis(validatedInput.valid_from) ?? now;
    const validUntil = toEpochMillis(validatedInput.valid_until);
    const expiredAt = toEpochMillis(validatedInput.expired_at);
    if (validUntil !== undefined && validUntil <= validFrom) {
      throw new McpError(ErrorCode.InvalidParams, "valid_until must be after valid_from");
    }

    const metadata = validatedInput.metadata || {};
    const commit = connections.sqlite.transaction(() => {
      connections.sqlite
        .prepare(
          `
        INSERT INTO memories (
          id, content, memory_type, created_at, updated_at, metadata, namespace,
          agent_id, agent_role, task_id, importance, access_count, last_accessed,
          valid_from, valid_until, expired_at, archived_at, consolidated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, NULL, NULL)
      `
        )
        .run(
          id,
          validatedInput.content,
          validatedInput.memory_type,
          now,
          now,
          JSON.stringify(metadata),
          namespace,
          validatedInput.agent_id || null,
          validatedInput.agent_role || null,
          validatedInput.task_id || null,
          validatedInput.importance ?? 0.5,
          validFrom,
          validUntil ?? null,
          expiredAt ?? null
        );

      connections.indexOutbox?.enqueue({
        memoryId: id,
        operation: "upsert",
        namespace,
        content: validatedInput.content,
        memoryType: validatedInput.memory_type,
        metadata,
        agentId: validatedInput.agent_id,
        taskId: validatedInput.task_id,
        createdAt: now,
      });
    });
    commit();

    if (connections.indexOutbox) {
      try {
        await connections.indexOutbox.drain(20);
      } catch (error) {
        console.error(
          "[WARN] Inline index drain failed; mutation remains durable:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const indexState = connections.indexOutbox?.getState(id) ?? "pending";

    console.error(
      `[INFO] Memory stored: ${id} (type: ${validatedInput.memory_type}, ns: ${namespace}, index: ${indexState})`
    );

    return {
      success: true,
      memory_id: id,
      namespace,
      timestamp: now,
      message: `Memory stored successfully (${validatedInput.memory_type})`,
      has_embedding: indexState === "indexed" && !!connections.hybridSearch,
      index_state: indexState,
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
    throw new McpError(ErrorCode.InternalError, "SQLite database not available");
  }

  const startedAt = performance.now();
  try {
    const validatedInput = validateInput(RetrieveMemoryInputSchema, input);
    const namespace = validatedInput.namespace || "default";
    const maxResults = validatedInput.max_results || 5;
    const commonFilters = {
      namespace,
      memoryTypes: validatedInput.memory_types,
      maxResults,
      agentId: validatedInput.agent_id,
      taskId: validatedInput.task_id,
      excludeAgent: validatedInput.exclude_agent,
      includeSuperseded: validatedInput.include_superseded,
      includeArchived: validatedInput.include_archived,
      asOf: toEpochMillis(validatedInput.as_of),
    };

    if (!connections.memoryRetriever) {
      throw new McpError(ErrorCode.InternalError, "Memory retriever not available");
    }

    // Redis can nominate recent candidates, but SQLite still authorizes and
    // hydrates every returned field. A cache miss falls through to FTS.
    if (validatedInput.routing_strategy === "fast_path" && connections.workingMemory) {
      try {
        const cached = await connections.workingMemory.search(
          validatedInput.query,
          Math.min(maxResults * 4, 100),
          namespace
        );
        const scores = new Map(
          cached.map(({ memory, similarity }) => [memory.conversationId, similarity])
        );
        const results = connections.memoryRetriever.retrieveByIds(
          cached.map(({ memory }) => memory.conversationId),
          { ...commonFilters, similarityScores: scores, source: "fast_path" }
        );
        if (results.length > 0) {
          retrievalMonitor.recordCacheHit();
          return formatRetrievalResponse(
            validatedInput.query,
            namespace,
            "fast_path",
            results,
            validatedInput.explain
              ? {
                  requested_strategy: "fast_path",
                  effective_strategy: "fast_path",
                  stages: [{ stage: "cache", candidate_count: cached.length, status: "ok" }],
                  returned_count: results.length,
                }
              : undefined
          );
        }
        retrievalMonitor.recordCacheMiss();
      } catch (error) {
        retrievalMonitor.recordCacheMiss();
        console.error(
          "[WARN] Fast-path lookup failed; falling back to canonical retrieval:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // The legacy graph route did not implement the advertised PPR algorithm
    // and returned non-memory entities. Preserve the public option as a safe
    // compatibility alias while keeping the memory contract truthful.
    const requestedStrategy = validatedInput.routing_strategy;
    const strategy =
      requestedStrategy === "semantic" ||
      requestedStrategy === "full_text" ||
      requestedStrategy === "hybrid"
        ? requestedStrategy
        : requestedStrategy === "fast_path"
          ? "full_text"
          : "auto";
    const response = await connections.memoryRetriever.retrieve({
      query: validatedInput.query,
      ...commonFilters,
      strategy,
      explain: validatedInput.explain,
    });

    const trace = response.trace
      ? {
          requested_strategy: requestedStrategy ?? "auto",
          effective_strategy: response.strategy,
          compatibility_fallback: requestedStrategy === "graph" ? "hybrid_or_full_text" : undefined,
          candidate_limit: response.trace.candidateLimit,
          stages: response.trace.stages.map((stage) => ({
            stage: stage.stage,
            candidate_count: stage.candidateCount,
            status: stage.status,
            fallback: stage.fallback,
          })),
          returned_count: response.trace.returnedCount,
        }
      : undefined;

    console.error(
      `[INFO] Canonical retrieval: query="${validatedInput.query}", ns=${namespace}, ` +
        `strategy=${response.strategy}, results=${response.results.length}`
    );
    return formatRetrievalResponse(
      validatedInput.query,
      namespace,
      response.strategy,
      response.results,
      trace
    );
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to retrieve memory: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    retrievalMonitor.recordLatency(performance.now() - startedAt);
  }
}

function formatRetrievalResponse(
  query: string,
  namespace: string,
  strategy: string,
  results: Array<{
    id: string;
    content: string;
    memoryType: string;
    createdAt: string | number;
    updatedAt: string | number;
    metadata: Record<string, unknown>;
    namespace: string;
    agentId?: string;
    agentRole?: string;
    taskId?: string;
    similarityScore?: number;
    denseScore?: number;
    lexicalScore?: number;
    fusedScore?: number;
    rank: number;
    sources: string[];
  }>,
  trace?: Record<string, unknown>
): Record<string, unknown> {
  return {
    success: true,
    query,
    namespace,
    routing_strategy: strategy,
    results: results.map((result) => ({
      id: result.id,
      content: result.content,
      memory_type: result.memoryType,
      created_at: result.createdAt,
      updated_at: result.updatedAt,
      namespace: result.namespace,
      agent_id: result.agentId,
      agent_role: result.agentRole,
      task_id: result.taskId,
      similarity_score: result.similarityScore,
      dense_score: result.denseScore,
      lexical_score: result.lexicalScore,
      fused_score: result.fusedScore,
      rank: result.rank,
      sources: result.sources,
      metadata: result.metadata,
    })),
    count: results.length,
    ...(trace ? { trace } : {}),
  };
}

/**
 * Handle list_recent tool call
 */
async function handleListRecent(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(ErrorCode.InternalError, "SQLite database not available");
  }

  try {
    // Validate input
    const validatedInput = validateInput(ListRecentInputSchema, input);
    const namespace = validatedInput.namespace || "default";
    const limit = validatedInput.limit || 5;
    const now = Date.now();
    let query = `SELECT id, content, memory_type, created_at, agent_id, task_id
       FROM memories
       WHERE namespace = ?
         AND (valid_from IS NULL OR ${sqliteEpochMillisExpression("valid_from")} IS NULL OR ${sqliteEpochMillisExpression("valid_from")} <= ?)
         AND (valid_until IS NULL OR ${sqliteEpochMillisExpression("valid_until")} IS NULL OR ${sqliteEpochMillisExpression("valid_until")} > ?)
         AND (expired_at IS NULL OR ${sqliteEpochMillisExpression("expired_at")} IS NULL OR ${sqliteEpochMillisExpression("expired_at")} > ?)
         AND (archived_at IS NULL OR ${sqliteEpochMillisExpression("archived_at")} IS NULL OR ${sqliteEpochMillisExpression("archived_at")} > ?)
         AND (metadata IS NULL OR json_valid(metadata) = 0 OR (
           COALESCE(json_extract(metadata, '$.is_valid'), 1) != 0
           AND COALESCE(json_extract(metadata, '$.invalid'), 0) = 0
           AND COALESCE(json_extract(metadata, '$.is_archived'), 0) = 0
           AND COALESCE(json_extract(metadata, '$.archived'), 0) = 0
           AND (
             valid_from IS NOT NULL
             OR
             json_extract(metadata, '$.valid_from') IS NULL
             OR ${sqliteEpochMillisExpression("json_extract(metadata, '$.valid_from')")} IS NULL
             OR ${sqliteEpochMillisExpression("json_extract(metadata, '$.valid_from')")} <= ?
           )
           AND (
             valid_until IS NOT NULL
             OR
             json_extract(metadata, '$.valid_until') IS NULL
             OR ${sqliteEpochMillisExpression("json_extract(metadata, '$.valid_until')")} IS NULL
             OR ${sqliteEpochMillisExpression("json_extract(metadata, '$.valid_until')")} > ?
           )
           AND (
             expired_at IS NOT NULL
             OR
             json_extract(metadata, '$.expired_at') IS NULL
             OR ${sqliteEpochMillisExpression("json_extract(metadata, '$.expired_at')")} IS NULL
             OR ${sqliteEpochMillisExpression("json_extract(metadata, '$.expired_at')")} > ?
           )
           AND (
             archived_at IS NOT NULL
             OR
             json_extract(metadata, '$.archived_at') IS NULL
             OR ${sqliteEpochMillisExpression("json_extract(metadata, '$.archived_at')")} IS NULL
             OR ${sqliteEpochMillisExpression("json_extract(metadata, '$.archived_at')")} > ?
           )
           AND (
             json_extract(metadata, '$.superseded_by') IS NULL
             OR (
               json_extract(metadata, '$.superseded_at') IS NOT NULL
               AND ${sqliteEpochMillisExpression("json_extract(metadata, '$.superseded_at')")} > ?
             )
           )
         ))`;
    const params: unknown[] = [namespace, now, now, now, now, now, now, now, now, now];

    if (validatedInput.memory_type) {
      query += " AND memory_type = ?";
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
      agent_id: string | null;
      task_id: string | null;
    }>;

    console.error(
      `[INFO] Listed ${results.length} recent memories (ns=${namespace}, limit=${limit}, type=${validatedInput.memory_type || "all"})`
    );

    return {
      success: true,
      namespace,
      limit,
      memory_type_filter: validatedInput.memory_type || null,
      entries: results.map((r) => ({
        id: r.id,
        content: r.content,
        memory_type: r.memory_type,
        created_at: r.created_at,
        agent_id: r.agent_id,
        task_id: r.task_id,
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
    throw new McpError(ErrorCode.InternalError, "SQLite database not available");
  }

  try {
    // Validate input
    const validatedInput = validateInput(GetStatsInputSchema, input);
    const namespace = validatedInput.namespace || "default";
    const countStmt = connections.sqlite.prepare(
      "SELECT COUNT(*) as count FROM memories WHERE namespace = ?"
    );
    const countResult = countStmt.get(namespace) as { count: number };
    const totalMemories = countResult.count;

    const typeStmt = connections.sqlite.prepare(`
      SELECT memory_type, COUNT(*) as count FROM memories WHERE namespace = ? GROUP BY memory_type
    `);
    const typeResults = typeStmt.all(namespace) as Array<{ memory_type: string; count: number }>;

    const stats: Record<string, unknown> = {
      success: true,
      namespace,
      timestamp: Date.now(),
      total_memories: totalMemories,
      redis_connected: connections.redis ? true : false,
      sqlite_connected: connections.sqlite ? true : false,
      embedding_connected: connections.embeddingClient ? true : false,
      qdrant_connected: connections.hybridSearch ? true : false,
    };

    // Add memory type breakdown
    const memoryTypeBreakdown: Record<string, number> = {};
    for (const row of typeResults) {
      memoryTypeBreakdown[row.memory_type] = row.count;
    }
    stats.memory_type_breakdown = memoryTypeBreakdown;

    if (validatedInput.detailed) {
      const pageCount = connections.sqlite.pragma("page_count", { simple: true }) as number;
      const pageSize = connections.sqlite.pragma("page_size", { simple: true }) as number;
      const retrievalMetrics = retrievalMonitor.getMetrics();
      const lifecycle = connections.sqlite
        .prepare(
          `
        SELECT
          SUM(CASE WHEN valid_until IS NOT NULL THEN 1 ELSE 0 END) AS closed,
          SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived,
          SUM(access_count) AS total_accesses
        FROM memories WHERE namespace = ?
      `
        )
        .get(namespace) as {
        closed: number | null;
        archived: number | null;
        total_accesses: number | null;
      };

      stats.sqlite_storage_bytes = pageCount * pageSize;
      stats.retrieval_latency_ms = retrievalMetrics.latency;
      stats.retrieval_requests_observed = retrievalMetrics.totalRequests;
      stats.cache_hit_rate =
        retrievalMetrics.totalCacheRequests > 0 ? retrievalMetrics.cacheHitRate : null;
      stats.cache_requests_observed = retrievalMetrics.totalCacheRequests;
      stats.index_outbox_pending = connections.indexOutbox?.getPendingCount() ?? null;
      stats.lifecycle = {
        closed: lifecycle.closed ?? 0,
        archived: lifecycle.archived ?? 0,
        total_accesses: lifecycle.total_accesses ?? 0,
      };
      stats.consolidation_scheduler = connections.consolidationScheduler?.getStatus() ?? null;

      if (connections.workingMemory) {
        try {
          stats.working_memory = await connections.workingMemory.getStats(namespace);
        } catch (error) {
          stats.working_memory = {
            available: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      if (connections.hybridSearch) {
        try {
          stats.vector_index = await connections.hybridSearch.getCollectionStats();
        } catch (error) {
          stats.vector_index = {
            available: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
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
 * Handle delete_memory tool call
 */
async function handleDeleteMemory(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(ErrorCode.InternalError, "SQLite database not available");
  }

  try {
    const validatedInput = validateInput(DeleteMemoryInputSchema, input);
    const namespace = validatedInput.namespace || "default";

    // Verify memory exists in SQLite
    const existing = connections.sqlite
      .prepare(
        `SELECT id, content, memory_type, created_at, metadata, agent_id, task_id
       FROM memories WHERE id = ? AND namespace = ?`
      )
      .get(validatedInput.memory_id, namespace) as
      | {
          id: string;
          content: string;
          memory_type: string;
          created_at: number;
          metadata: string | null;
          agent_id: string | null;
          task_id: string | null;
        }
      | undefined;

    if (!existing) {
      return {
        success: false,
        message: `Memory not found: ${validatedInput.memory_id} in namespace '${namespace}'`,
      };
    }

    // Canonical deletion and its projection tombstone commit together. Derived
    // stores can be offline; the outbox is retried on later starts/writes.
    const commit = connections.sqlite.transaction(() => {
      connections.sqlite
        .prepare("DELETE FROM facts WHERE source_conversation = ? AND namespace = ?")
        .run(validatedInput.memory_id, namespace);
      connections.sqlite
        .prepare("DELETE FROM memories WHERE id = ? AND namespace = ?")
        .run(validatedInput.memory_id, namespace);
      connections.indexOutbox?.enqueue({
        memoryId: existing.id,
        operation: "delete",
        namespace,
        content: existing.content,
        memoryType: existing.memory_type,
        metadata: safeJsonObject(existing.metadata),
        agentId: existing.agent_id ?? undefined,
        taskId: existing.task_id ?? undefined,
        createdAt: existing.created_at,
      });
    });
    commit();

    if (connections.indexOutbox) {
      try {
        await connections.indexOutbox.drain(20);
      } catch (error) {
        console.error(
          "[WARN] Inline index deletion failed; tombstone remains durable:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    const indexState = connections.indexOutbox?.getState(existing.id) ?? "pending";

    console.error(
      `[INFO] Memory deleted: ${validatedInput.memory_id} (type: ${existing.memory_type}, ns: ${namespace})`
    );

    return {
      success: true,
      deleted: {
        id: existing.id,
        content: existing.content,
        memory_type: existing.memory_type,
        created_at: existing.created_at,
      },
      namespace,
      index_state: indexState,
      message: `Memory deleted successfully`,
    };
  } catch (err) {
    if (err instanceof McpError) {
      throw err;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to delete memory: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function safeJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Handle vesper_enable tool call
 */
async function handleVesperEnable(): Promise<Record<string, unknown>> {
  vesperEnabled = true;
  console.error("[INFO] Vesper memory system enabled");
  return {
    success: true,
    enabled: true,
    message: "Vesper memory system enabled",
  };
}

/**
 * Handle vesper_disable tool call
 */
async function handleVesperDisable(): Promise<Record<string, unknown>> {
  vesperEnabled = false;
  console.error("[INFO] Vesper memory system disabled (pass-through mode)");
  return {
    success: true,
    enabled: false,
    message: "Vesper memory system disabled (pass-through mode)",
  };
}

/**
 * Handle vesper_status tool call
 */
async function handleVesperStatus(): Promise<Record<string, unknown>> {
  console.error(`[INFO] Vesper status: ${vesperEnabled ? "enabled" : "disabled"}`);
  return {
    success: true,
    enabled: vesperEnabled,
    mode: vesperEnabled ? "active" : "pass-through",
    message: vesperEnabled
      ? "Vesper is actively processing memory operations"
      : "Vesper is in pass-through mode (memory operations are skipped)",
  };
}

/**
 * Handle record_skill_outcome tool call
 *
 * Records success or failure feedback for a skill execution.
 * Used to improve skill ranking over time.
 */
async function handleRecordSkillOutcome(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.skillLibrary) {
    throw new McpError(ErrorCode.InternalError, "Skill library not available");
  }

  try {
    // Validate input
    const validatedInput = validateInput(RecordSkillOutcomeInputSchema, input);

    if (validatedInput.outcome === "success") {
      if (validatedInput.satisfaction === undefined) {
        throw new McpError(ErrorCode.InvalidParams, "satisfaction is required for success outcome");
      }
      connections.skillLibrary.recordSuccess(
        validatedInput.skill_id,
        validatedInput.satisfaction,
        validatedInput.namespace
      );
      console.error(
        `[INFO] Recorded skill success: ${validatedInput.skill_id} (satisfaction: ${validatedInput.satisfaction})`
      );
    } else {
      connections.skillLibrary.recordFailure(validatedInput.skill_id, validatedInput.namespace);
      console.error(`[INFO] Recorded skill failure: ${validatedInput.skill_id}`);
    }

    return {
      success: true,
      skill_id: validatedInput.skill_id,
      outcome: validatedInput.outcome,
      satisfaction: validatedInput.satisfaction,
      message: `Skill ${validatedInput.outcome} recorded for ${validatedInput.skill_id}`,
    };
  } catch (err) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to record skill outcome: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Handle load_skill tool call
 *
 * Loads full skill implementation on-demand when a skill is invoked.
 * This is part of the lazy loading system to reduce token usage by 80-90%.
 *
 * Performance:
 * - First load: ~20ms (database query)
 * - Cached load: ~5ms (working memory cache hit)
 *
 * Caching:
 * - Loaded skills are cached in Redis for 1 hour (3600s)
 * - Cache automatically expires or can be invalidated
 * - Reduces database load and improves response time
 *
 * @param input - LoadSkillInput with skill_id
 * @returns Full skill implementation with all details
 */
async function handleLoadSkill(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.skillLibrary) {
    throw new McpError(ErrorCode.InternalError, "Skill library not available");
  }

  try {
    // Validate input
    const validatedInput = validateInput(LoadSkillInputSchema, input);
    const startTime = Date.now();
    let fromCache = false;

    // Step 1: Check cache first (if working memory available)
    let fullSkill: any = null;

    if (connections.workingMemory) {
      try {
        const cached = await connections.workingMemory.getCachedSkill(
          validatedInput.skill_id,
          validatedInput.namespace
        );
        if (cached) {
          fullSkill = cached.skill;
          fromCache = true;
          console.error(
            `[INFO] Skill cache hit: ${fullSkill.name} (${validatedInput.skill_id}) ` +
              `access count: ${cached.access_count}`
          );
        }
      } catch (err) {
        console.warn(
          `[WARN] Skill cache lookup failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Step 2: Load from database if not cached
    if (!fullSkill) {
      fullSkill = connections.skillLibrary.loadFull(
        validatedInput.skill_id,
        validatedInput.namespace
      );

      if (!fullSkill) {
        throw new McpError(ErrorCode.InvalidParams, `Skill not found: ${validatedInput.skill_id}`);
      }

      // Cache the loaded skill (if working memory available)
      if (connections.workingMemory) {
        try {
          await connections.workingMemory.cacheSkill(fullSkill, 3600, validatedInput.namespace); // 1 hour TTL
        } catch (err) {
          console.warn(
            `[WARN] Failed to cache skill: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    const loadTime = Date.now() - startTime;
    console.error(
      `[INFO] Loaded full skill: ${fullSkill.name} (${validatedInput.skill_id}) ` +
        `in ${loadTime}ms (${fromCache ? "cache" : "database"})`
    );

    return {
      success: true,
      skill: {
        id: fullSkill.id,
        name: fullSkill.name,
        summary: fullSkill.summary,
        description: fullSkill.description,
        category: fullSkill.category,
        triggers: fullSkill.triggers,
        code: fullSkill.code,
        code_type: fullSkill.code_type,
        prerequisites: fullSkill.prerequisites,
        quality_score: fullSkill.quality_score,
        success_count: fullSkill.success_count,
        failure_count: fullSkill.failure_count,
        avg_user_satisfaction: fullSkill.avg_user_satisfaction,
        uses_skills: fullSkill.uses_skills,
        used_by_skills: fullSkill.used_by_skills,
        created_from: fullSkill.created_from,
        created_at: fullSkill.created_at.toISOString(),
        last_modified: fullSkill.last_modified.toISOString(),
        last_used: fullSkill.last_used?.toISOString(),
        version: fullSkill.version,
        notes: fullSkill.notes,
      },
      load_time_ms: loadTime,
      from_cache: fromCache,
      message: `Loaded full skill: ${fullSkill.name}${fromCache ? " (cached)" : ""}`,
    };
  } catch (err) {
    if (err instanceof McpError) {
      throw err;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to load skill: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Handle share_context tool call
 *
 * Shares memories from one namespace to another for agent handoffs.
 */
async function handleShareContext(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(ErrorCode.InternalError, "SQLite database not available");
  }

  try {
    const validatedInput = validateInput(ShareContextInputSchema, input);
    const { source_namespace, target_namespace } = validatedInput;
    if (source_namespace === target_namespace) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "source_namespace and target_namespace must be different"
      );
    }
    const maxItems = validatedInput.max_items || 10;
    const now = Date.now();
    const sharedItems: Array<{ type: string; id: string; original_id: string }> = [];

    let memoryIds: string[];
    if (validatedInput.query && connections.memoryRetriever) {
      const selected = await connections.memoryRetriever.retrieve({
        query: validatedInput.query,
        namespace: source_namespace,
        taskId: validatedInput.task_id,
        maxResults: maxItems,
        strategy: "auto",
      });
      memoryIds = selected.results.map((memory) => memory.id);
    } else {
      let selectionSql = `
        SELECT id FROM memories
        WHERE namespace = ? AND archived_at IS NULL
          AND (valid_from IS NULL OR valid_from <= ?)
          AND (valid_until IS NULL OR valid_until > ?)
          AND (expired_at IS NULL OR expired_at > ?)
      `;
      const selectionParams: unknown[] = [source_namespace, now, now, now];
      if (validatedInput.task_id) {
        selectionSql += " AND task_id = ?";
        selectionParams.push(validatedInput.task_id);
      }
      selectionSql += " ORDER BY created_at DESC LIMIT ?";
      selectionParams.push(maxItems);
      memoryIds = (
        connections.sqlite.prepare(selectionSql).all(...selectionParams) as Array<{ id: string }>
      ).map((row) => row.id);
    }

    const memories =
      memoryIds.length > 0
        ? (connections.sqlite
            .prepare(
              `
          SELECT id, content, memory_type, created_at, metadata, agent_id,
                 agent_role, task_id, importance, valid_from, valid_until, expired_at
          FROM memories WHERE namespace = ? AND id IN (${memoryIds.map(() => "?").join(",")})
        `
            )
            .all(source_namespace, ...memoryIds) as Array<Record<string, any>>)
        : [];
    const memoryOrder = new Map(memoryIds.map((id, index) => [id, index]));
    memories.sort((a, b) => (memoryOrder.get(a.id) ?? 0) - (memoryOrder.get(b.id) ?? 0));

    const selectedSkills = validatedInput.include_skills
      ? (connections.sqlite
          .prepare(
            `
          SELECT * FROM skills
          WHERE namespace = ? AND is_archived = 0
            AND (? IS NULL OR name LIKE ? OR description LIKE ? OR triggers LIKE ?)
          ORDER BY avg_user_satisfaction DESC, success_count DESC
          LIMIT ?
        `
          )
          .all(
            source_namespace,
            validatedInput.query ?? null,
            `%${validatedInput.query ?? ""}%`,
            `%${validatedInput.query ?? ""}%`,
            `%${validatedInput.query ?? ""}%`,
            maxItems
          ) as Array<Record<string, any>>)
      : [];
    const selectedEntities = validatedInput.include_entities
      ? (connections.sqlite
          .prepare("SELECT * FROM entities WHERE namespace = ? LIMIT ?")
          .all(source_namespace, maxItems) as Array<Record<string, any>>)
      : [];

    let skillsShared = 0;
    let entityCount = 0;
    const handoffId = randomUUID();
    const handoffContent = `Context handoff from namespace '${source_namespace}': ${memories.length} memories selected`;
    const handoffMetadata = {
      handoff: true,
      source_namespace,
      query: validatedInput.query ?? null,
    };
    const commit = connections.sqlite.transaction(() => {
      for (const memory of memories) {
        const newId = randomUUID();
        const copiedMetadata = {
          ...safeJsonObject(memory.metadata),
          shared_from_namespace: source_namespace,
          shared_from_memory_id: memory.id,
          shared_at: now,
        };
        connections.sqlite
          .prepare(
            `
          INSERT INTO memories (
            id, content, memory_type, created_at, updated_at, metadata, namespace,
            agent_id, agent_role, task_id, importance, access_count, last_accessed,
            valid_from, valid_until, expired_at, archived_at, consolidated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, NULL, NULL)
        `
          )
          .run(
            newId,
            memory.content,
            memory.memory_type,
            memory.created_at,
            now,
            JSON.stringify(copiedMetadata),
            target_namespace,
            memory.agent_id,
            memory.agent_role,
            memory.task_id,
            memory.importance ?? 0.5,
            memory.valid_from ?? memory.created_at,
            memory.valid_until,
            memory.expired_at
          );
        connections.indexOutbox?.enqueue({
          memoryId: newId,
          operation: "upsert",
          namespace: target_namespace,
          content: memory.content,
          memoryType: memory.memory_type,
          metadata: copiedMetadata,
          agentId: memory.agent_id ?? undefined,
          taskId: memory.task_id ?? undefined,
          createdAt: memory.created_at,
        });
        sharedItems.push({ type: "memory", id: newId, original_id: memory.id });
      }

      for (const skill of selectedSkills) {
        const newId = randomUUID();
        const targetName = `${skill.name} [${target_namespace}]`;
        const result = connections.sqlite
          .prepare(
            `
          INSERT OR IGNORE INTO skills (
            id, name, description, summary, category, code, code_type, triggers,
            prerequisites, success_count, failure_count, avg_user_satisfaction,
            uses_skills, used_by_skills, namespace, is_archived, created_from,
            created_at, last_used, last_modified, version, notes, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            newId,
            targetName,
            skill.description,
            skill.summary,
            skill.category,
            skill.code,
            skill.code_type,
            skill.triggers,
            skill.prerequisites,
            skill.success_count,
            skill.failure_count,
            skill.avg_user_satisfaction,
            skill.uses_skills,
            skill.used_by_skills,
            target_namespace,
            skill.created_from,
            skill.created_at,
            skill.last_used,
            now,
            skill.version,
            skill.notes,
            skill.metadata
          );
        if (result.changes > 0) {
          skillsShared++;
          sharedItems.push({ type: "skill", id: newId, original_id: skill.id });
        }
      }

      for (const entity of selectedEntities) {
        const existing = connections.sqlite
          .prepare("SELECT id FROM entities WHERE namespace = ? AND name = ? AND type = ? LIMIT 1")
          .get(target_namespace, entity.name, entity.type) as { id: string } | undefined;
        if (existing) {
          connections.sqlite
            .prepare(
              `UPDATE entities
               SET description = COALESCE(?, description),
                   confidence = MAX(confidence, ?), last_accessed = ?
               WHERE id = ?`
            )
            .run(
              entity.description,
              entity.confidence ?? 1,
              new Date(now).toISOString(),
              existing.id
            );
        } else {
          connections.sqlite
            .prepare(
              `INSERT INTO entities (
                 id, name, type, description, confidence, created_at,
                 last_accessed, access_count, namespace
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              randomUUID(),
              entity.name,
              entity.type,
              entity.description,
              entity.confidence ?? 1,
              entity.created_at ?? new Date(now).toISOString(),
              new Date(now).toISOString(),
              entity.access_count ?? 1,
              target_namespace
            );
        }
        entityCount++;
      }

      connections.sqlite
        .prepare(
          `
        INSERT INTO memories (
          id, content, memory_type, created_at, updated_at, metadata, namespace,
          importance, access_count, valid_from, consolidated_at
        ) VALUES (?, ?, 'episodic', ?, ?, ?, ?, 0.5, 0, ?, NULL)
      `
        )
        .run(
          handoffId,
          handoffContent,
          now,
          now,
          JSON.stringify(handoffMetadata),
          target_namespace,
          now
        );
      connections.indexOutbox?.enqueue({
        memoryId: handoffId,
        operation: "upsert",
        namespace: target_namespace,
        content: handoffContent,
        memoryType: "episodic",
        metadata: handoffMetadata,
        createdAt: now,
      });
    });
    commit();

    if (connections.indexOutbox) {
      try {
        await connections.indexOutbox.drain(maxItems + 1);
      } catch (error) {
        console.error(
          "[WARN] Shared-context index drain failed; mutations remain durable:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    console.error(
      `[INFO] Shared ${memories.length} memories + ${skillsShared} skills + ${entityCount} entities from ${source_namespace} to ${target_namespace}`
    );

    return {
      success: true,
      source_namespace,
      target_namespace,
      memories_shared: memories.length,
      skills_shared: skillsShared,
      entities_shared: entityCount,
      handoff_id: handoffId,
    };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to share context: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Handle store_decision tool call
 *
 * Stores a versioned decision with reduced decay and explicit supersession.
 */
async function handleStoreDecision(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(ErrorCode.InternalError, "SQLite database not available");
  }

  try {
    const validatedInput = validateInput(StoreDecisionInputSchema, input);
    const namespace = validatedInput.namespace || "default";
    const id = randomUUID();
    const now = Date.now();
    const validFrom = toEpochMillis(validatedInput.valid_from) ?? now;
    const validUntil = toEpochMillis(validatedInput.valid_until);
    if (validUntil !== undefined && validUntil <= validFrom) {
      throw new McpError(ErrorCode.InvalidParams, "valid_until must be after valid_from");
    }

    const metadata = {
      ...(validatedInput.metadata || {}),
      decay_factor: 0.25,
      supersedes: validatedInput.supersedes || null,
    };
    const superseded = validatedInput.supersedes
      ? (connections.sqlite
          .prepare(
            `
          SELECT id, content, memory_type, created_at, metadata, agent_id, task_id,
                 valid_from, valid_until
          FROM memories
          WHERE id = ? AND namespace = ? AND memory_type = 'decision'
        `
          )
          .get(validatedInput.supersedes, namespace) as
          | {
              id: string;
              content: string;
              memory_type: string;
              created_at: number;
              metadata: string | null;
              agent_id: string | null;
              task_id: string | null;
              valid_from: number | null;
              valid_until: number | null;
            }
          | undefined)
      : undefined;
    if (validatedInput.supersedes && !superseded) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Superseded decision not found in namespace '${namespace}'`
      );
    }
    if (superseded) {
      const supersededMetadata = safeJsonObject(superseded.metadata);
      if (typeof supersededMetadata.superseded_by === "string") {
        throw new McpError(ErrorCode.InvalidParams, "Decision has already been superseded");
      }
      if (superseded.valid_from !== null && validFrom < superseded.valid_from) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "A replacement decision cannot become effective before the decision it supersedes"
        );
      }
      if (superseded.valid_until !== null && validFrom > superseded.valid_until) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Replacement valid_from cannot be after the superseded decision's valid_until"
        );
      }
    }

    const commit = connections.sqlite.transaction(() => {
      connections.sqlite
        .prepare(
          `
        INSERT INTO memories (
          id, content, memory_type, created_at, updated_at, metadata, namespace,
          agent_id, agent_role, task_id, importance, access_count, last_accessed,
          valid_from, valid_until, expired_at, archived_at, consolidated_at
        ) VALUES (?, ?, 'decision', ?, ?, ?, ?, ?, ?, ?, 0.9, 0, NULL, ?, ?, NULL, NULL, NULL)
      `
        )
        .run(
          id,
          validatedInput.content,
          now,
          now,
          JSON.stringify(metadata),
          namespace,
          validatedInput.agent_id || null,
          validatedInput.agent_role || null,
          validatedInput.task_id || null,
          validFrom,
          validUntil ?? null
        );
      connections.indexOutbox?.enqueue({
        memoryId: id,
        operation: "upsert",
        namespace,
        content: validatedInput.content,
        memoryType: "decision",
        metadata,
        agentId: validatedInput.agent_id,
        taskId: validatedInput.task_id,
        createdAt: now,
      });

      if (superseded) {
        const oldMetadata = {
          ...safeJsonObject(superseded.metadata),
          superseded_by: id,
          superseded_at: validFrom,
          superseded_recorded_at: now,
        };
        const supersessionUpdate = connections.sqlite
          .prepare(
            `
          UPDATE memories
          SET metadata = ?, updated_at = ?, valid_until = ?
          WHERE id = ? AND namespace = ?
            AND metadata IS ? AND valid_until IS ?
        `
          )
          .run(
            JSON.stringify(oldMetadata),
            now,
            validFrom,
            superseded.id,
            namespace,
            superseded.metadata,
            superseded.valid_until
          );
        if (supersessionUpdate.changes !== 1) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Superseded decision changed concurrently; retry with the current decision"
          );
        }
        connections.indexOutbox?.enqueue({
          memoryId: superseded.id,
          operation: "upsert",
          namespace,
          content: superseded.content,
          memoryType: superseded.memory_type,
          metadata: oldMetadata,
          agentId: superseded.agent_id ?? undefined,
          taskId: superseded.task_id ?? undefined,
          createdAt: superseded.created_at,
        });
      }
    });
    commit();

    if (connections.indexOutbox) {
      try {
        await connections.indexOutbox.drain(20);
      } catch (error) {
        console.error(
          "[WARN] Decision index drain failed; mutation remains durable:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    const indexState = connections.indexOutbox?.getState(id) ?? "pending";

    // This is intentionally a count of candidates, not a claim that semantic
    // conflicts were detected. Conflict classification requires a verifier.
    const existingDecisions = connections.sqlite
      .prepare(
        `SELECT id FROM memories
       WHERE namespace = ? AND memory_type = 'decision' AND id != ?
         AND valid_until IS NULL
       ORDER BY created_at DESC LIMIT 10`
      )
      .all(namespace, id) as Array<{ id: string }>;

    console.error(
      `[INFO] Decision stored: ${id} (ns: ${namespace}, supersedes: ${validatedInput.supersedes || "none"})`
    );

    return {
      success: true,
      decision_id: id,
      namespace,
      timestamp: now,
      has_embedding: indexState === "indexed" && !!connections.hybridSearch,
      index_state: indexState,
      supersedes: validatedInput.supersedes || null,
      potential_conflict_candidates: existingDecisions.length,
      message: `Decision stored successfully`,
    };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to store decision: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Handle list_namespaces tool call
 */
async function handleListNamespaces(): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(ErrorCode.InternalError, "SQLite database not available");
  }

  try {
    const namespaces = connections.sqlite
      .prepare(
        `
      SELECT namespace, COUNT(*) as memory_count,
        COUNT(DISTINCT agent_id) as agent_count,
        MAX(created_at) as last_activity
      FROM memories
      WHERE namespace IS NOT NULL
      GROUP BY namespace
      ORDER BY last_activity DESC
    `
      )
      .all() as any[];

    return {
      success: true,
      namespaces: namespaces.map((ns) => ({
        namespace: ns.namespace,
        memory_count: ns.memory_count,
        agent_count: ns.agent_count,
        last_activity: ns.last_activity,
      })),
      count: namespaces.length,
    };
  } catch (err) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list namespaces: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Handle namespace_stats tool call
 */
async function handleNamespaceStats(input: unknown): Promise<Record<string, unknown>> {
  if (!connections.sqlite) {
    throw new McpError(ErrorCode.InternalError, "SQLite database not available");
  }

  try {
    const validatedInput = validateInput(NamespaceStatsInputSchema, input);
    const namespace = validatedInput.namespace;

    const memoryCount = (
      connections.sqlite
        .prepare("SELECT COUNT(*) as count FROM memories WHERE namespace = ?")
        .get(namespace) as any
    ).count;

    const typeBreakdown = connections.sqlite
      .prepare(
        "SELECT memory_type, COUNT(*) as count FROM memories WHERE namespace = ? GROUP BY memory_type"
      )
      .all(namespace) as any[];

    const entityCount = (
      connections.sqlite
        .prepare("SELECT COUNT(*) as count FROM entities WHERE namespace = ?")
        .get(namespace) as any
    ).count;

    const skillCount = (
      connections.sqlite
        .prepare("SELECT COUNT(*) as count FROM skills WHERE namespace = ?")
        .get(namespace) as any
    ).count;

    const agents = connections.sqlite
      .prepare(
        "SELECT DISTINCT agent_id, agent_role FROM memories WHERE namespace = ? AND agent_id IS NOT NULL"
      )
      .all(namespace) as any[];

    const decisionCount = (
      connections.sqlite
        .prepare(
          "SELECT COUNT(*) as count FROM memories WHERE namespace = ? AND memory_type = 'decision'"
        )
        .get(namespace) as any
    ).count;

    return {
      success: true,
      namespace,
      memories: memoryCount,
      memory_type_breakdown: Object.fromEntries(typeBreakdown.map((t) => [t.memory_type, t.count])),
      entities: entityCount,
      skills: skillCount,
      decisions: decisionCount,
      agents: agents.map((a) => ({ agent_id: a.agent_id, agent_role: a.agent_role })),
      agent_count: agents.length,
    };
  } catch (err) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get namespace stats: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Process tool calls
 */
export async function processTool(
  name: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  console.error(`[INFO] Processing tool: ${name}`);

  // Handle toggle tools first (these always work regardless of enabled state)
  switch (name) {
    case "vesper_enable":
      return await handleVesperEnable();
    case "vesper_disable":
      return await handleVesperDisable();
    case "vesper_status":
      return await handleVesperStatus();
  }

  // Check if Vesper is disabled (pass-through mode)
  if (!vesperEnabled) {
    console.error("[INFO] Vesper is disabled (pass-through mode)");
    return {
      success: true,
      disabled: true,
      message:
        "Vesper memory system is currently disabled (pass-through mode). Enable with vesper_enable tool.",
    };
  }

  // Process memory tools
  switch (name) {
    case "store_memory":
      return await handleStoreMemory(input);
    case "retrieve_memory":
      return await handleRetrieveMemory(input);
    case "list_recent":
      return await handleListRecent(input);
    case "get_stats":
      return await handleGetStats(input);
    case "delete_memory":
      return await handleDeleteMemory(input);
    case "record_skill_outcome":
      return await handleRecordSkillOutcome(input);
    case "load_skill":
      return await handleLoadSkill(input);
    case "share_context":
      return await handleShareContext(input);
    case "store_decision":
      return await handleStoreDecision(input);
    case "list_namespaces":
      return await handleListNamespaces();
    case "namespace_stats":
      return await handleNamespaceStats(input);
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

/**
 * Main server function
 */
async function main(): Promise<void> {
  console.error("[INFO] Starting Vesper (Simplified)...");

  // Initialize connections
  await initializeConnections();

  // Create MCP server
  const server = new Server(
    {
      name: "vesper",
      version: "0.5.4",
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
      // Process the tool (no authentication or rate limiting)
      const result = await processTool(name, args as Record<string, unknown>);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const errorMessage =
        err instanceof McpError ? err.message : err instanceof Error ? err.message : String(err);

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
  console.error(
    "[INFO] Available tools: store_memory, retrieve_memory, list_recent, get_stats, record_skill_outcome, load_skill, vesper_enable, vesper_disable, vesper_status"
  );
}

// Cleanup handler for graceful shutdown
function cleanup(): void {
  console.error("[INFO] Shutting down Vesper...");

  connections.consolidationScheduler?.stop();
  if (connections.indexOutboxTimer) clearInterval(connections.indexOutboxTimer);

  if (connections.redis) {
    connections.redis.disconnect();
  }

  if (connections.sqlite) {
    connections.sqlite.close();
  }

  console.error("[INFO] Vesper shutdown complete");
  process.exit(0);
}

export function closeConnectionsForTesting(): void {
  connections.consolidationScheduler?.stop();
  if (connections.indexOutboxTimer) clearInterval(connections.indexOutboxTimer);
  connections.redis?.disconnect();
  if (connections.sqlite?.open) connections.sqlite.close();
  for (const key of Object.keys(connections) as Array<keyof ConnectionPool>) {
    delete connections[key];
  }
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Run the server unless a test imports the production handlers directly.
if (process.env.VESPER_SKIP_AUTO_START !== "1") {
  main().catch((err) => {
    console.error("[FATAL] Server error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
