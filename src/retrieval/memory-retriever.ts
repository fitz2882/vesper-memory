/**
 * Canonical memory retrieval.
 *
 * SQLite owns memory contents and authorization-relevant attributes. FTS5 and
 * Qdrant are derived indexes: they may nominate ids, but their payloads are
 * never returned or trusted for filtering.
 */

import Database from "better-sqlite3";
import type { EmbeddingClient } from "../embeddings/client.js";
import type { DenseSearchResult, HybridSearchEngine } from "./hybrid-search.js";

export type RetrievalStrategy = "auto" | "hybrid" | "full_text" | "semantic";
export type EffectiveRetrievalStrategy = Exclude<RetrievalStrategy, "auto">;
export type RetrievalSource = "lexical" | "dense" | "fast_path";

export interface RetrieveMemoriesInput {
  query: string;
  namespace?: string;
  memoryTypes?: string[];
  maxResults?: number;
  strategy?: RetrievalStrategy;
  agentId?: string;
  taskId?: string;
  excludeAgent?: string;
  includeSuperseded?: boolean;
  includeArchived?: boolean;
  /** Unix epoch milliseconds at which the memory must have been valid. */
  asOf?: number;
  /** Include a content-free account of the retrieval stages. */
  explain?: boolean;
}

export interface MemoryRetrievalResult {
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
  /** Positive SQLite BM25 relevance (-1 * SQLite's lower-is-better value). */
  lexicalScore?: number;
  /** Reciprocal-rank-fusion score; present only for hybrid retrieval. */
  fusedScore?: number;
  rank: number;
  sources: RetrievalSource[];
}

export interface RetrievalTraceStage {
  stage: "lexical" | "dense" | "fusion" | "hydration" | "filtering";
  candidateCount: number;
  status: "ok" | "skipped" | "unavailable";
  fallback?: "unfiltered_legacy_vectors";
}

export interface RetrievalTrace {
  requestedStrategy: RetrievalStrategy;
  effectiveStrategy: EffectiveRetrievalStrategy;
  candidateLimit: number;
  stages: RetrievalTraceStage[];
  returnedCount: number;
}

export interface MemoryRetrievalResponse {
  strategy: EffectiveRetrievalStrategy;
  results: MemoryRetrievalResult[];
  trace?: RetrievalTrace;
}

export interface RetrieveByIdsInput {
  namespace?: string;
  memoryTypes?: string[];
  maxResults?: number;
  agentId?: string;
  taskId?: string;
  excludeAgent?: string;
  includeSuperseded?: boolean;
  includeArchived?: boolean;
  asOf?: number;
  /** Optional scores from the candidate source, keyed by canonical memory id. */
  similarityScores?: ReadonlyMap<string, number>;
  source?: RetrievalSource;
}

export interface MemoryRetrieverDependencies {
  db: Database.Database;
  embeddingClient?: Pick<EmbeddingClient, "embed">;
  hybridSearch?: Pick<HybridSearchEngine, "denseSearch">;
  now?: () => number;
  rrfK?: number;
  candidateMultiplier?: number;
  /** RRF weight of the lexical (BM25) ranking in hybrid retrieval. Default 1. */
  lexicalWeight?: number;
  /** RRF weight of the dense ranking in hybrid retrieval. Default 1. */
  denseWeight?: number;
  /**
   * Drop common English stopwords from the BM25 query when it is fused with
   * dense results. Without this, words like "what", "is" and "my" pull noisy
   * lexical candidates into the fusion and push good dense hits out of the top
   * results. BM25-only retrieval keeps every token. Default true.
   */
  hybridDropsStopwords?: boolean;
}

interface LexicalCandidate {
  id: string;
  score: number;
  rank: number;
}

interface DenseCandidate {
  id: string;
  score: number;
  rank: number;
}

interface CandidateScore {
  id: string;
  lexicalScore?: number;
  denseScore?: number;
  fusedScore?: number;
  lexicalRank?: number;
  denseRank?: number;
  sources: RetrievalSource[];
}

interface CanonicalMemoryRow {
  id: string;
  content: string;
  memory_type: string;
  created_at: string | number;
  updated_at: string | number;
  metadata: string | null;
  namespace: string | null;
  agent_id: string | null;
  agent_role: string | null;
  task_id: string | null;
  access_count?: number | null;
  last_accessed?: string | number | null;
  valid_from?: string | number | null;
  valid_until?: string | number | null;
  is_archived?: number | boolean | null;
  archived_at?: string | number | null;
  expired_at?: string | number | null;
}

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 100;
const DEFAULT_RRF_K = 60;
const DEFAULT_CANDIDATE_MULTIPLIER = 8;
const MAX_CANDIDATES = 800;
const MAX_FTS_TERMS = 64;

/** Common English function words that make an OR-of-tokens BM25 query match almost everything. */
const FTS_STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does doing for from had has have " +
    "he her hers him his how i if in into is it its me my mine myself no not of on or our " +
    "ours she should so that the their them then there these they this those to too was we " +
    "were what when where which who whom why will with would you your yours"
  ).split(" ")
);

export class MemoryRetriever {
  private readonly db: Database.Database;
  private readonly embeddingClient?: Pick<EmbeddingClient, "embed">;
  private readonly hybridSearch?: Pick<HybridSearchEngine, "denseSearch">;
  private readonly now: () => number;
  private readonly rrfK: number;
  private readonly lexicalWeight: number;
  private readonly denseWeight: number;
  private readonly hybridDropsStopwords: boolean;
  private readonly candidateMultiplier: number;
  private memoryColumns: Set<string> | undefined;

  constructor(dependencies: MemoryRetrieverDependencies) {
    this.db = dependencies.db;
    this.embeddingClient = dependencies.embeddingClient;
    this.hybridSearch = dependencies.hybridSearch;
    this.now = dependencies.now ?? Date.now;
    this.rrfK = dependencies.rrfK ?? DEFAULT_RRF_K;
    this.lexicalWeight = dependencies.lexicalWeight ?? 1;
    this.denseWeight = dependencies.denseWeight ?? 1;
    this.hybridDropsStopwords = dependencies.hybridDropsStopwords ?? true;
    for (const [name, weight] of [
      ["lexicalWeight", this.lexicalWeight],
      ["denseWeight", this.denseWeight],
    ] as const) {
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`${name} must be a non-negative finite number`);
      }
    }
    this.candidateMultiplier = dependencies.candidateMultiplier ?? DEFAULT_CANDIDATE_MULTIPLIER;

    if (!Number.isFinite(this.rrfK) || this.rrfK <= 0) {
      throw new Error("rrfK must be a positive finite number");
    }
    if (!Number.isInteger(this.candidateMultiplier) || this.candidateMultiplier < 1) {
      throw new Error("candidateMultiplier must be a positive integer");
    }
  }

  /**
   * Create the external-content FTS5 index and synchronization triggers.
   * Existing rows are backfilled only when the index is first created.
   */
  initialize(): void {
    const memoriesTable = this.db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
      .get() as { present: number } | undefined;

    if (!memoriesTable) {
      throw new Error("Cannot initialize retrieval before the memories table exists");
    }

    const existingFts = this.db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'memories_fts'"
      )
      .get() as { present: number } | undefined;

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content = 'memories',
        content_rowid = 'rowid',
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS memories_fts_after_insert
      AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_fts_after_delete
      AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content)
        VALUES ('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_fts_after_update
      AFTER UPDATE OF content ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content)
        VALUES ('delete', old.rowid, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);

    if (!existingFts) {
      this.db.prepare("INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')").run();
    }

    this.memoryColumns = undefined;
  }

  async retrieve(input: RetrieveMemoriesInput): Promise<MemoryRetrievalResponse> {
    const normalized = this.validateInput(input);
    const requestedStrategy = normalized.strategy;
    const denseAvailable = Boolean(this.embeddingClient && this.hybridSearch);
    let effectiveStrategy = this.effectiveStrategy(requestedStrategy, denseAvailable);
    const candidateLimit = Math.min(
      MAX_CANDIDATES,
      normalized.maxResults * this.candidateMultiplier
    );
    const stages: RetrievalTraceStage[] = [];

    let lexicalCandidates: LexicalCandidate[] = [];
    const lexicalDroppedStopwords = this.hybridDropsStopwords && effectiveStrategy === "hybrid";
    if (effectiveStrategy === "full_text" || effectiveStrategy === "hybrid") {
      lexicalCandidates = this.lexicalSearch(normalized, candidateLimit, lexicalDroppedStopwords);
      stages.push({
        stage: "lexical",
        candidateCount: lexicalCandidates.length,
        status: "ok",
      });
    } else {
      stages.push({ stage: "lexical", candidateCount: 0, status: "skipped" });
    }

    let denseCandidates: DenseCandidate[] = [];
    let denseStage: RetrievalTraceStage = {
      stage: "dense",
      candidateCount: 0,
      status: denseAvailable ? "skipped" : "unavailable",
    };
    if (effectiveStrategy === "semantic" || effectiveStrategy === "hybrid") {
      if (denseAvailable) {
        const denseResult = await this.denseSearch(normalized, candidateLimit);
        denseCandidates = denseResult.candidates;
        denseStage = {
          stage: "dense",
          candidateCount: denseCandidates.length,
          status: denseResult.available ? "ok" : "unavailable",
          ...(denseResult.usedLegacyFallback
            ? { fallback: "unfiltered_legacy_vectors" as const }
            : {}),
        };
        if (!denseResult.available && effectiveStrategy === "hybrid") {
          effectiveStrategy = "full_text";
        }
      }
    }
    stages.push(denseStage);

    // RRF is meaningful only when two non-empty ranked lists are present.
    // Preserve native channel scores when the other channel has no candidates.
    if (effectiveStrategy === "hybrid") {
      if (lexicalCandidates.length === 0 && denseCandidates.length > 0) {
        effectiveStrategy = "semantic";
      } else if (denseCandidates.length === 0) {
        effectiveStrategy = "full_text";
      }
    }
    // Stopword removal is only for fusion. If hybrid fell back to BM25 alone,
    // rerun the lexical query with every token.
    if (effectiveStrategy === "full_text" && lexicalDroppedStopwords) {
      lexicalCandidates = this.lexicalSearch(normalized, candidateLimit, false);
    }

    const rankedCandidates = this.rankCandidates(
      effectiveStrategy,
      lexicalCandidates,
      denseCandidates
    );
    stages.push({
      stage: "fusion",
      candidateCount: rankedCandidates.length,
      status: effectiveStrategy === "hybrid" ? "ok" : "skipped",
    });

    const hydrated = this.hydrate(rankedCandidates.map((candidate) => candidate.id));
    stages.push({
      stage: "hydration",
      candidateCount: hydrated.size,
      status: "ok",
    });

    const filtered = rankedCandidates
      .map((candidate) => {
        const row = hydrated.get(candidate.id);
        return row ? { candidate, row, metadata: parseMetadata(row.metadata) } : null;
      })
      .filter(
        (
          value
        ): value is {
          candidate: CandidateScore;
          row: CanonicalMemoryRow;
          metadata: Record<string, unknown>;
        } => value !== null
      )
      .filter(({ row, metadata }) => this.matchesFilters(row, metadata, normalized))
      .slice(0, normalized.maxResults);

    stages.push({
      stage: "filtering",
      candidateCount: filtered.length,
      status: "ok",
    });

    this.reinforceAccess(filtered.map(({ row }) => row.id));

    const results = filtered.map(({ candidate, row, metadata }, index) => {
      const similarityScore =
        effectiveStrategy === "hybrid"
          ? candidate.fusedScore
          : effectiveStrategy === "semantic"
            ? candidate.denseScore
            : candidate.lexicalScore;

      return {
        id: row.id,
        content: row.content,
        memoryType: row.memory_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata,
        namespace: row.namespace ?? "default",
        ...(row.agent_id !== null ? { agentId: row.agent_id } : {}),
        ...(row.agent_role !== null ? { agentRole: row.agent_role } : {}),
        ...(row.task_id !== null ? { taskId: row.task_id } : {}),
        ...(similarityScore !== undefined ? { similarityScore } : {}),
        ...(candidate.denseScore !== undefined ? { denseScore: candidate.denseScore } : {}),
        ...(candidate.lexicalScore !== undefined ? { lexicalScore: candidate.lexicalScore } : {}),
        ...(candidate.fusedScore !== undefined ? { fusedScore: candidate.fusedScore } : {}),
        rank: index + 1,
        sources: candidate.sources,
      } satisfies MemoryRetrievalResult;
    });

    return {
      strategy: effectiveStrategy,
      results,
      ...(normalized.explain
        ? {
            trace: {
              requestedStrategy,
              effectiveStrategy,
              candidateLimit,
              stages,
              returnedCount: results.length,
            },
          }
        : {}),
    };
  }

  /**
   * Canonically hydrate an ordered candidate list from a cache or legacy index.
   * Supplied order is preserved, duplicate/missing ids are removed, all filters
   * are applied to SQLite rows, and only returned rows receive access credit.
   */
  retrieveByIds(ids: readonly string[], input: RetrieveByIdsInput = {}): MemoryRetrievalResult[] {
    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) {
      throw new Error(`maxResults must be an integer between 1 and ${MAX_RESULTS}`);
    }
    if (input.asOf !== undefined && !Number.isFinite(input.asOf)) {
      throw new Error("asOf must be a finite Unix epoch millisecond timestamp");
    }

    const normalized: ReturnType<MemoryRetriever["validateInput"]> = {
      query: "candidate hydration",
      namespace: input.namespace ?? "default",
      memoryTypes: [...new Set(input.memoryTypes ?? [])],
      maxResults,
      strategy: "full_text",
      includeSuperseded: input.includeSuperseded ?? false,
      includeArchived: input.includeArchived ?? false,
      explain: false,
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      ...(input.excludeAgent !== undefined ? { excludeAgent: input.excludeAgent } : {}),
      ...(input.asOf !== undefined ? { asOf: input.asOf } : {}),
    };
    const orderedIds = [...new Set(ids)].slice(0, MAX_CANDIDATES);
    const hydrated = this.hydrate(orderedIds);
    const source = input.source ?? "fast_path";
    const selected = orderedIds
      .map((id) => {
        const row = hydrated.get(id);
        return row ? { row, metadata: parseMetadata(row.metadata) } : null;
      })
      .filter(
        (
          value
        ): value is {
          row: CanonicalMemoryRow;
          metadata: Record<string, unknown>;
        } => value !== null
      )
      .filter(({ row, metadata }) => this.matchesFilters(row, metadata, normalized))
      .slice(0, maxResults);

    this.reinforceAccess(selected.map(({ row }) => row.id));

    return selected.map(({ row, metadata }, index) => {
      const similarityScore = input.similarityScores?.get(row.id);
      return {
        id: row.id,
        content: row.content,
        memoryType: row.memory_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata,
        namespace: row.namespace ?? "default",
        ...(row.agent_id !== null ? { agentId: row.agent_id } : {}),
        ...(row.agent_role !== null ? { agentRole: row.agent_role } : {}),
        ...(row.task_id !== null ? { taskId: row.task_id } : {}),
        ...(similarityScore !== undefined ? { similarityScore } : {}),
        rank: index + 1,
        sources: [source],
      } satisfies MemoryRetrievalResult;
    });
  }

  private validateInput(
    input: RetrieveMemoriesInput
  ): Required<
    Pick<
      RetrieveMemoriesInput,
      | "query"
      | "namespace"
      | "memoryTypes"
      | "maxResults"
      | "strategy"
      | "includeSuperseded"
      | "includeArchived"
      | "explain"
    >
  > &
    Omit<
      RetrieveMemoriesInput,
      | "query"
      | "namespace"
      | "memoryTypes"
      | "maxResults"
      | "strategy"
      | "includeSuperseded"
      | "includeArchived"
      | "explain"
    > {
    if (!input || typeof input.query !== "string" || input.query.trim() === "") {
      throw new Error("Query cannot be empty");
    }

    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) {
      throw new Error(`maxResults must be an integer between 1 and ${MAX_RESULTS}`);
    }
    if (input.asOf !== undefined && !Number.isFinite(input.asOf)) {
      throw new Error("asOf must be a finite Unix epoch millisecond timestamp");
    }

    return {
      ...input,
      query: input.query.trim(),
      namespace: input.namespace ?? "default",
      memoryTypes: [...new Set(input.memoryTypes ?? [])],
      maxResults,
      strategy: input.strategy ?? "auto",
      includeSuperseded: input.includeSuperseded ?? false,
      includeArchived: input.includeArchived ?? false,
      explain: input.explain ?? false,
    };
  }

  private effectiveStrategy(
    strategy: RetrievalStrategy,
    denseAvailable: boolean
  ): EffectiveRetrievalStrategy {
    if (strategy === "auto") {
      return denseAvailable ? "hybrid" : "full_text";
    }
    if (strategy === "hybrid" && !denseAvailable) {
      return "full_text";
    }
    return strategy;
  }

  private lexicalSearch(
    input: ReturnType<MemoryRetriever["validateInput"]>,
    limit: number,
    dropStopwords = false
  ): LexicalCandidate[] {
    const ftsQuery = sanitizeFtsQuery(input.query, { dropStopwords });
    if (!ftsQuery) return [];

    // These canonical predicates reduce candidate starvation in large shared
    // databases. They are intentionally repeated after full hydration below.
    const columns = this.getMemoryColumns();
    const predicates = ["memories_fts MATCH ?"];
    const parameters: Array<string | number> = [ftsQuery];
    if (columns.has("namespace")) {
      predicates.push("COALESCE(m.namespace, 'default') = ?");
      parameters.push(input.namespace);
    }
    if (input.memoryTypes.length > 0) {
      predicates.push(`m.memory_type IN (${input.memoryTypes.map(() => "?").join(", ")})`);
      parameters.push(...input.memoryTypes);
    }
    if (input.agentId !== undefined && columns.has("agent_id")) {
      predicates.push("m.agent_id = ?");
      parameters.push(input.agentId);
    }
    if (input.taskId !== undefined && columns.has("task_id")) {
      predicates.push("m.task_id = ?");
      parameters.push(input.taskId);
    }
    if (input.excludeAgent !== undefined && columns.has("agent_id")) {
      predicates.push("(m.agent_id IS NULL OR m.agent_id != ?)");
      parameters.push(input.excludeAgent);
    }

    // Push lifecycle predicates into the canonical FTS query so invalid rows
    // cannot consume the bounded candidate window before hydration.
    const referenceTime = input.asOf ?? this.now();
    if (columns.has("valid_from")) {
      predicates.push(
        `(m.valid_from IS NULL OR ${sqliteEpochMillis("m.valid_from")} IS NULL OR ` +
          `${sqliteEpochMillis("m.valid_from")} <= ?)`
      );
      parameters.push(referenceTime);
    }
    if (columns.has("expired_at")) {
      predicates.push(
        `(m.expired_at IS NULL OR ${sqliteEpochMillis("m.expired_at")} IS NULL OR ` +
          `${sqliteEpochMillis("m.expired_at")} > ?)`
      );
      parameters.push(referenceTime);
    }
    if (columns.has("valid_until")) {
      if (input.includeSuperseded && columns.has("metadata")) {
        predicates.push(
          `(m.valid_until IS NULL OR ${sqliteEpochMillis("m.valid_until")} IS NULL OR ` +
            `${sqliteEpochMillis("m.valid_until")} > ? OR (` +
            `json_valid(m.metadata) AND json_extract(m.metadata, '$.superseded_by') IS NOT NULL ` +
            `AND ${sqliteEpochMillis("json_extract(m.metadata, '$.superseded_at')")} = ` +
            `${sqliteEpochMillis("m.valid_until")}))`
        );
      } else {
        predicates.push(
          `(m.valid_until IS NULL OR ${sqliteEpochMillis("m.valid_until")} IS NULL OR ` +
            `${sqliteEpochMillis("m.valid_until")} > ?)`
        );
      }
      parameters.push(referenceTime);
    }
    if (!input.includeArchived) {
      if (columns.has("is_archived")) predicates.push("COALESCE(m.is_archived, 0) = 0");
      if (columns.has("archived_at")) {
        predicates.push(
          `(m.archived_at IS NULL OR ${sqliteEpochMillis("m.archived_at")} IS NULL OR ` +
            `${sqliteEpochMillis("m.archived_at")} > ?)`
        );
        parameters.push(referenceTime);
      }
    }
    if (columns.has("metadata")) {
      predicates.push(
        `(m.metadata IS NULL OR json_valid(m.metadata) = 0 OR (` +
          `COALESCE(json_extract(m.metadata, '$.is_valid'), 1) != 0 AND ` +
          `COALESCE(json_extract(m.metadata, '$.invalid'), 0) = 0))`
      );
      predicates.push(
        `(m.metadata IS NULL OR json_valid(m.metadata) = 0 OR ` +
          (columns.has("valid_from") ? `m.valid_from IS NOT NULL OR ` : "") +
          `json_extract(m.metadata, '$.valid_from') IS NULL OR ` +
          `${sqliteEpochMillis("json_extract(m.metadata, '$.valid_from')")} IS NULL OR ` +
          `${sqliteEpochMillis("json_extract(m.metadata, '$.valid_from')")} <= ?)`
      );
      parameters.push(referenceTime);
      predicates.push(
        `(m.metadata IS NULL OR json_valid(m.metadata) = 0 OR ` +
          (columns.has("expired_at") ? `m.expired_at IS NOT NULL OR ` : "") +
          `json_extract(m.metadata, '$.expired_at') IS NULL OR ` +
          `${sqliteEpochMillis("json_extract(m.metadata, '$.expired_at')")} IS NULL OR ` +
          `${sqliteEpochMillis("json_extract(m.metadata, '$.expired_at')")} > ?)`
      );
      parameters.push(referenceTime);
      if (input.includeSuperseded) {
        predicates.push(
          `(m.metadata IS NULL OR json_valid(m.metadata) = 0 OR ` +
            (columns.has("valid_until") ? `m.valid_until IS NOT NULL OR ` : "") +
            `json_extract(m.metadata, '$.valid_until') IS NULL OR ` +
            `${sqliteEpochMillis("json_extract(m.metadata, '$.valid_until')")} IS NULL OR ` +
            `${sqliteEpochMillis("json_extract(m.metadata, '$.valid_until')")} > ? OR (` +
            `json_extract(m.metadata, '$.superseded_by') IS NOT NULL AND ` +
            `json_extract(m.metadata, '$.superseded_at') IS NOT NULL AND ` +
            `${sqliteEpochMillis("json_extract(m.metadata, '$.superseded_at')")} = ` +
            `${sqliteEpochMillis("json_extract(m.metadata, '$.valid_until')")}))`
        );
      } else {
        predicates.push(
          `(m.metadata IS NULL OR json_valid(m.metadata) = 0 OR ` +
            (columns.has("valid_until") ? `m.valid_until IS NOT NULL OR ` : "") +
            `json_extract(m.metadata, '$.valid_until') IS NULL OR ` +
            `${sqliteEpochMillis("json_extract(m.metadata, '$.valid_until')")} IS NULL OR ` +
            `${sqliteEpochMillis("json_extract(m.metadata, '$.valid_until')")} > ?)`
        );
      }
      parameters.push(referenceTime);
      if (!input.includeArchived) {
        predicates.push(
          `(m.metadata IS NULL OR json_valid(m.metadata) = 0 OR (` +
            `COALESCE(json_extract(m.metadata, '$.is_archived'), 0) = 0 AND ` +
            `COALESCE(json_extract(m.metadata, '$.archived'), 0) = 0 AND (` +
            (columns.has("archived_at") ? `m.archived_at IS NOT NULL OR ` : "") +
            `json_extract(m.metadata, '$.archived_at') IS NULL OR ` +
            `${sqliteEpochMillis("json_extract(m.metadata, '$.archived_at')")} IS NULL OR ` +
            `${sqliteEpochMillis("json_extract(m.metadata, '$.archived_at')")} > ?)))`
        );
        parameters.push(referenceTime);
      }
      if (!input.includeSuperseded) {
        predicates.push(
          `(m.metadata IS NULL OR json_valid(m.metadata) = 0 OR ` +
            `json_extract(m.metadata, '$.superseded_by') IS NULL OR (` +
            `json_extract(m.metadata, '$.superseded_at') IS NOT NULL AND ` +
            `${sqliteEpochMillis("json_extract(m.metadata, '$.superseded_at')")} > ?))`
        );
        parameters.push(referenceTime);
      }
    }

    const rows = this.db
      .prepare(
        `SELECT m.id AS id, bm25(memories_fts) AS bm25_score
         FROM memories_fts
         JOIN memories AS m ON m.rowid = memories_fts.rowid
         WHERE ${predicates.join(" AND ")}
         ORDER BY bm25_score ASC, m.id ASC
         LIMIT ?`
      )
      .all(...parameters, limit) as Array<{ id: string; bm25_score: number }>;

    return rows.map((row, index) => ({
      id: row.id,
      score: Math.max(0, -row.bm25_score),
      rank: index + 1,
    }));
  }

  private async denseSearch(
    input: ReturnType<MemoryRetriever["validateInput"]>,
    limit: number
  ): Promise<{
    candidates: DenseCandidate[];
    available: boolean;
    usedLegacyFallback: boolean;
  }> {
    if (!this.embeddingClient || !this.hybridSearch) {
      return { candidates: [], available: false, usedLegacyFallback: false };
    }

    try {
      const vector = await this.embeddingClient.embed(input.query);
      const filter = buildDenseFilter(input);
      const searchProgressively = async (
        candidateFilter?: Record<string, unknown>
      ): Promise<{ candidates: DenseCandidate[]; rawCount: number; eligibleCount: number }> => {
        let depth = Math.max(input.maxResults, limit);
        while (true) {
          const results = candidateFilter
            ? await this.hybridSearch!.denseSearch(vector, depth, candidateFilter)
            : await this.hybridSearch!.denseSearch(vector, depth);
          const candidates = deduplicateDenseResults(results);
          const hydrated = this.hydrate(candidates.map((candidate) => candidate.id));
          const eligibleCount = candidates.filter((candidate) => {
            const row = hydrated.get(candidate.id);
            return row ? this.matchesFilters(row, parseMetadata(row.metadata), input) : false;
          }).length;
          if (
            eligibleCount >= input.maxResults ||
            results.length < depth ||
            depth >= MAX_CANDIDATES
          ) {
            return { candidates, rawCount: results.length, eligibleCount };
          }
          depth = Math.min(MAX_CANDIDATES, depth * 2);
        }
      };

      let searchResult = await searchProgressively(filter);
      let usedLegacyFallback = false;

      // Vectors written before namespaces were introduced have no namespace
      // payload. They are candidates only; SQLite filtering below still
      // enforces the default namespace and every requested restriction.
      if (searchResult.eligibleCount < input.maxResults && input.namespace === "default") {
        const legacyResult = await searchProgressively();
        const byId = new Map<string, DenseCandidate>();
        for (const candidate of [...searchResult.candidates, ...legacyResult.candidates]) {
          const existing = byId.get(candidate.id);
          if (!existing || candidate.score > existing.score) byId.set(candidate.id, candidate);
        }
        const merged = [...byId.values()]
          .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
          .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
        searchResult = {
          candidates: merged,
          rawCount: legacyResult.rawCount,
          eligibleCount: legacyResult.eligibleCount,
        };
        usedLegacyFallback = true;
      }

      return {
        candidates: searchResult.candidates,
        available: true,
        usedLegacyFallback,
      };
    } catch {
      return { candidates: [], available: false, usedLegacyFallback: false };
    }
  }

  private rankCandidates(
    strategy: EffectiveRetrievalStrategy,
    lexical: LexicalCandidate[],
    dense: DenseCandidate[]
  ): CandidateScore[] {
    if (strategy === "full_text") {
      return lexical.map((candidate) => ({
        id: candidate.id,
        lexicalScore: candidate.score,
        lexicalRank: candidate.rank,
        sources: ["lexical"],
      }));
    }
    if (strategy === "semantic") {
      return dense.map((candidate) => ({
        id: candidate.id,
        denseScore: candidate.score,
        denseRank: candidate.rank,
        sources: ["dense"],
      }));
    }

    const fused = new Map<string, CandidateScore>();
    for (const candidate of lexical) {
      fused.set(candidate.id, {
        id: candidate.id,
        lexicalScore: candidate.score,
        lexicalRank: candidate.rank,
        fusedScore: this.lexicalWeight / (this.rrfK + candidate.rank),
        sources: ["lexical"],
      });
    }
    for (const candidate of dense) {
      const existing = fused.get(candidate.id);
      if (existing) {
        existing.denseScore = candidate.score;
        existing.denseRank = candidate.rank;
        existing.fusedScore =
          (existing.fusedScore ?? 0) + this.denseWeight / (this.rrfK + candidate.rank);
        existing.sources.push("dense");
      } else {
        fused.set(candidate.id, {
          id: candidate.id,
          denseScore: candidate.score,
          denseRank: candidate.rank,
          fusedScore: this.denseWeight / (this.rrfK + candidate.rank),
          sources: ["dense"],
        });
      }
    }

    return [...fused.values()].sort((left, right) => {
      const scoreDifference = (right.fusedScore ?? 0) - (left.fusedScore ?? 0);
      if (scoreDifference !== 0) return scoreDifference;
      const leftBestRank = Math.min(
        left.lexicalRank ?? Number.POSITIVE_INFINITY,
        left.denseRank ?? Number.POSITIVE_INFINITY
      );
      const rightBestRank = Math.min(
        right.lexicalRank ?? Number.POSITIVE_INFINITY,
        right.denseRank ?? Number.POSITIVE_INFINITY
      );
      return leftBestRank - rightBestRank || left.id.localeCompare(right.id);
    });
  }

  private hydrate(ids: string[]): Map<string, CanonicalMemoryRow> {
    if (ids.length === 0) return new Map();

    const columns = this.getMemoryColumns();
    const optionalColumn = (name: string, fallback: string): string =>
      columns.has(name) ? name : `${fallback} AS ${name}`;
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT id, content, memory_type, created_at, updated_at,
                ${optionalColumn("metadata", "NULL")},
                ${optionalColumn("namespace", "'default'")},
                ${optionalColumn("agent_id", "NULL")},
                ${optionalColumn("agent_role", "NULL")},
                ${optionalColumn("task_id", "NULL")},
                ${optionalColumn("access_count", "NULL")},
                ${optionalColumn("last_accessed", "NULL")},
                ${optionalColumn("valid_from", "NULL")},
                ${optionalColumn("valid_until", "NULL")},
                ${optionalColumn("is_archived", "0")},
                ${optionalColumn("archived_at", "NULL")},
                ${optionalColumn("expired_at", "NULL")}
         FROM memories
         WHERE id IN (${placeholders})`
      )
      .all(...ids) as CanonicalMemoryRow[];

    return new Map(rows.map((row) => [row.id, row]));
  }

  private matchesFilters(
    row: CanonicalMemoryRow,
    metadata: Record<string, unknown>,
    input: ReturnType<MemoryRetriever["validateInput"]>
  ): boolean {
    if ((row.namespace ?? "default") !== input.namespace) return false;
    if (input.memoryTypes.length > 0 && !input.memoryTypes.includes(row.memory_type)) {
      return false;
    }
    if (input.agentId !== undefined && row.agent_id !== input.agentId) return false;
    if (input.taskId !== undefined && row.task_id !== input.taskId) return false;
    if (input.excludeAgent !== undefined && row.agent_id === input.excludeAgent) {
      return false;
    }

    const referenceTime = input.asOf ?? this.now();
    const archivedAt = toEpochMilliseconds(row.archived_at ?? metadata.archived_at);
    const archived = Boolean(
      row.is_archived ||
      metadata.is_archived ||
      metadata.archived ||
      (archivedAt !== undefined && archivedAt <= referenceTime)
    );
    if (!input.includeArchived && archived) return false;
    if (metadata.is_valid === false || metadata.invalid === true) return false;

    const validFrom = toEpochMilliseconds(row.valid_from ?? metadata.valid_from ?? row.created_at);
    const validityEnds = [
      toEpochMilliseconds(row.valid_until ?? metadata.valid_until),
      toEpochMilliseconds(row.expired_at ?? metadata.expired_at),
    ].filter((value): value is number => value !== undefined);
    const validUntil = validityEnds.length > 0 ? Math.min(...validityEnds) : undefined;
    const supersededAt = toEpochMilliseconds(metadata.superseded_at);
    const closedBySupersession = Boolean(
      metadata.superseded_by &&
      supersededAt !== undefined &&
      validUntil !== undefined &&
      validUntil === supersededAt
    );
    if (validFrom !== undefined && validFrom > referenceTime) return false;
    if (
      validUntil !== undefined &&
      validUntil <= referenceTime &&
      !(input.includeSuperseded && closedBySupersession)
    ) {
      return false;
    }

    if (!input.includeSuperseded && metadata.superseded_by) {
      if (supersededAt === undefined || supersededAt <= referenceTime) {
        return false;
      }
    }

    return true;
  }

  private reinforceAccess(ids: string[]): void {
    if (ids.length === 0) return;
    const columns = this.getMemoryColumns();
    const assignments: string[] = [];
    const leadingParameters: Array<string | number> = [];

    if (columns.has("access_count")) {
      assignments.push("access_count = COALESCE(access_count, 0) + 1");
    }
    if (columns.has("last_accessed")) {
      assignments.push("last_accessed = ?");
      leadingParameters.push(this.now());
    }
    if (assignments.length === 0) return;

    const placeholders = ids.map(() => "?").join(", ");
    this.db
      .prepare(`UPDATE memories SET ${assignments.join(", ")} WHERE id IN (${placeholders})`)
      .run(...leadingParameters, ...ids);
  }

  private getMemoryColumns(): Set<string> {
    if (!this.memoryColumns) {
      const rows = this.db.prepare("PRAGMA table_info(memories)").all() as Array<{
        name: string;
      }>;
      this.memoryColumns = new Set(rows.map((row) => row.name));
    }
    return this.memoryColumns;
  }
}

/** Convert arbitrary text into literal FTS tokens, never executable FTS syntax. */
export function sanitizeFtsQuery(
  query: string,
  options: { dropStopwords?: boolean } = {}
): string | null {
  let tokens = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, MAX_FTS_TERMS) ?? [];
  if (options.dropStopwords) {
    const content = tokens.filter((token) => !FTS_STOPWORDS.has(token.toLowerCase()));
    // A query made only of stopwords keeps its tokens rather than matching nothing.
    if (content.length > 0) tokens = content;
  }
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"`).join(" OR ");
}

function deduplicateDenseResults(results: DenseSearchResult[]): DenseCandidate[] {
  const seen = new Set<string>();
  const candidates: DenseCandidate[] = [];
  for (const result of results) {
    if (seen.has(result.id) || !Number.isFinite(result.score)) continue;
    seen.add(result.id);
    candidates.push({ id: result.id, score: result.score, rank: candidates.length + 1 });
  }
  return candidates;
}

function buildDenseFilter(
  input: ReturnType<MemoryRetriever["validateInput"]>
): Record<string, unknown> {
  const must: Array<Record<string, unknown>> = [
    { key: "namespace", match: { value: input.namespace } },
  ];
  if (input.memoryTypes.length > 0) {
    must.push({ key: "memory_type", match: { any: input.memoryTypes } });
  }
  if (input.agentId !== undefined) {
    must.push({ key: "agent_id", match: { value: input.agentId } });
  }
  if (input.taskId !== undefined) {
    must.push({ key: "task_id", match: { value: input.taskId } });
  }

  return {
    must,
    ...(input.excludeAgent !== undefined
      ? {
          must_not: [{ key: "agent_id", match: { value: input.excludeAgent } }],
        }
      : {}),
  };
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toEpochMilliseconds(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    // SQLite CURRENT_TIMESTAMP values are text, while older Vesper rows use
    // epoch milliseconds. Treat small numeric epochs as seconds for resilience.
    return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** SQLite expression that normalizes numeric epochs and ISO timestamps to milliseconds. */
function sqliteEpochMillis(expression: string): string {
  return `(CASE
    WHEN typeof(${expression}) IN ('integer', 'real')
      THEN CASE WHEN ABS(${expression}) < 100000000000 THEN ${expression} * 1000 ELSE ${expression} END
    WHEN trim(${expression}) != ''
      AND trim(${expression}) NOT GLOB '*[^0-9.]*'
      THEN CASE
        WHEN ABS(CAST(${expression} AS REAL)) < 100000000000
          THEN CAST(${expression} AS REAL) * 1000
        ELSE CAST(${expression} AS REAL)
      END
    ELSE CAST(strftime('%s', ${expression}) AS INTEGER) * 1000
  END)`;
}
