import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRetriever, sanitizeFtsQuery } from "../src/retrieval/memory-retriever.js";

interface InsertMemory {
  id: string;
  content: string;
  memoryType?: string;
  createdAt?: number;
  updatedAt?: number;
  metadata?: Record<string, unknown> | string;
  namespace?: string;
  agentId?: string;
  agentRole?: string;
  taskId?: string;
  validFrom?: number;
  validUntil?: number;
  archived?: boolean;
  archivedAt?: number;
  expiredAt?: number;
}

describe("MemoryRetriever", () => {
  let db: Database.Database;
  const now = Date.UTC(2026, 7, 2, 12);

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        namespace TEXT NOT NULL DEFAULT 'default',
        agent_id TEXT,
        agent_role TEXT,
        task_id TEXT,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        valid_from INTEGER,
        valid_until INTEGER,
        is_archived INTEGER DEFAULT 0,
        archived_at INTEGER,
        expired_at INTEGER
      )
    `);
  });

  afterEach(() => db.close());

  function createRetriever(
    optional: Partial<ConstructorParameters<typeof MemoryRetriever>[0]> = {}
  ): MemoryRetriever {
    const retriever = new MemoryRetriever({ db, now: () => now, ...optional });
    retriever.initialize();
    return retriever;
  }

  function insert(memory: InsertMemory): void {
    db.prepare(
      `INSERT INTO memories (
        id, content, memory_type, created_at, updated_at, metadata,
        namespace, agent_id, agent_role, task_id, valid_from, valid_until,
        is_archived, archived_at, expired_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      memory.id,
      memory.content,
      memory.memoryType ?? "semantic",
      memory.createdAt ?? now - 10_000,
      memory.updatedAt ?? now - 10_000,
      typeof memory.metadata === "string" ? memory.metadata : JSON.stringify(memory.metadata ?? {}),
      memory.namespace ?? "default",
      memory.agentId ?? null,
      memory.agentRole ?? null,
      memory.taskId ?? null,
      memory.validFrom ?? null,
      memory.validUntil ?? null,
      memory.archived ? 1 : 0,
      memory.archivedAt ?? null,
      memory.expiredAt ?? null
    );
  }

  it("initializes FTS5, backfills existing rows, and tracks content changes", async () => {
    insert({ id: "before", content: "durable outbox before initialization" });
    const retriever = createRetriever();

    expect((await retriever.retrieve({ query: "outbox" })).results[0]?.id).toBe("before");

    insert({ id: "after", content: "canonical hydration after initialization" });
    expect((await retriever.retrieve({ query: "hydration" })).results[0]?.id).toBe("after");

    db.prepare("UPDATE memories SET content = ? WHERE id = ?").run(
      "updated reciprocal ranking",
      "after"
    );
    expect((await retriever.retrieve({ query: "hydration" })).results).toEqual([]);
    expect((await retriever.retrieve({ query: "reciprocal" })).results[0]?.id).toBe("after");

    db.prepare("DELETE FROM memories WHERE id = ?").run("after");
    expect((await retriever.retrieve({ query: "reciprocal" })).results).toEqual([]);
  });

  it("turns user text into quoted literal tokens instead of raw FTS syntax", async () => {
    const retriever = createRetriever();
    insert({ id: "safe", content: "alpha release" });

    expect(sanitizeFtsQuery('alpha" OR * NOT (beta')).toBe('"alpha" OR "OR" OR "NOT" OR "beta"');
    await expect(
      retriever.retrieve({ query: 'alpha" OR * NOT (beta', strategy: "full_text" })
    ).resolves.toMatchObject({ results: [{ id: "safe" }] });
    await expect(
      retriever.retrieve({ query: '"*()[]:-', strategy: "full_text" })
    ).resolves.toMatchObject({ results: [] });
  });

  it("returns real lexical BM25 scores without claiming a fusion score", async () => {
    const retriever = createRetriever();
    insert({ id: "a", content: "sqlite lexical retrieval" });

    const response = await retriever.retrieve({
      query: "lexical",
      strategy: "full_text",
    });

    expect(response.strategy).toBe("full_text");
    expect(response.results[0]).toMatchObject({
      id: "a",
      sources: ["lexical"],
      rank: 1,
    });
    expect(response.results[0].lexicalScore).toBeGreaterThan(0);
    expect(response.results[0].similarityScore).toBe(response.results[0].lexicalScore);
    expect(response.results[0].fusedScore).toBeUndefined();
  });

  it("generates lexical and dense lists independently and fuses them with RRF", async () => {
    insert({ id: "lexical-only", content: "alpha alpha alpha retrieval" });
    insert({ id: "both", content: "alpha memory" });
    insert({ id: "dense-only", content: "semantic neighbor" });
    const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
    const denseSearch = vi.fn().mockResolvedValue([
      { id: "both", score: 0.98 },
      { id: "dense-only", score: 0.92 },
      { id: "lexical-only", score: 0.7 },
    ]);
    const retriever = createRetriever({
      embeddingClient: { embed },
      hybridSearch: { denseSearch },
    });

    const response = await retriever.retrieve({
      query: "alpha",
      strategy: "hybrid",
      maxResults: 3,
    });

    expect(embed).toHaveBeenCalledWith("alpha");
    expect(denseSearch).toHaveBeenCalledTimes(1);
    expect(response.strategy).toBe("hybrid");
    expect(response.results.map((result) => result.id)).toContain("dense-only");
    const shared = response.results.find((result) => result.id === "both");
    expect(shared).toMatchObject({ sources: ["lexical", "dense"] });
    expect(shared?.denseScore).toBe(0.98);
    expect(shared?.lexicalScore).toBeGreaterThan(0);
    expect(shared?.fusedScore).toBeGreaterThan(1 / 61);
    expect(response.results.map((result) => result.rank)).toEqual([1, 2, 3]);
  });

  it("hydrates dense ids from SQLite and never returns stale vector payloads", async () => {
    insert({
      id: "canonical",
      content: "authoritative sqlite content",
      memoryType: "decision",
      metadata: { canonical: true },
    });
    const retriever = createRetriever({
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) },
      hybridSearch: {
        denseSearch: vi.fn().mockResolvedValue([
          {
            id: "canonical",
            score: 0.88,
            payload: {
              content: "stale vector content",
              memory_type: "episodic",
              namespace: "other",
            },
          },
        ]),
      },
    });

    const result = (await retriever.retrieve({ query: "anything", strategy: "semantic" }))
      .results[0];

    expect(result.content).toBe("authoritative sqlite content");
    expect(result.memoryType).toBe("decision");
    expect(result.metadata).toEqual({ canonical: true });
  });

  it("enforces namespace, type, agent, task, and exclusion filters after hydration", async () => {
    insert({
      id: "allowed",
      content: "filter candidate",
      memoryType: "decision",
      namespace: "team",
      agentId: "agent-a",
      taskId: "task-1",
    });
    insert({
      id: "wrong-namespace",
      content: "filter candidate",
      memoryType: "decision",
      namespace: "secret",
      agentId: "agent-a",
      taskId: "task-1",
    });
    insert({
      id: "wrong-type",
      content: "filter candidate",
      memoryType: "episodic",
      namespace: "team",
      agentId: "agent-a",
      taskId: "task-1",
    });
    insert({
      id: "excluded",
      content: "filter candidate",
      memoryType: "decision",
      namespace: "team",
      agentId: "agent-b",
      taskId: "task-1",
    });
    const denseSearch = vi.fn().mockResolvedValue([
      { id: "wrong-namespace", score: 0.99 },
      { id: "wrong-type", score: 0.98 },
      { id: "excluded", score: 0.97 },
      { id: "allowed", score: 0.96 },
    ]);
    const retriever = createRetriever({
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) },
      hybridSearch: { denseSearch },
    });

    const response = await retriever.retrieve({
      query: "filter",
      strategy: "semantic",
      namespace: "team",
      memoryTypes: ["decision"],
      taskId: "task-1",
      excludeAgent: "agent-b",
      maxResults: 10,
    });

    expect(response.results.map((result) => result.id)).toEqual(["allowed"]);
    expect(denseSearch.mock.calls[0][2]).toMatchObject({
      must: expect.arrayContaining([
        { key: "namespace", match: { value: "team" } },
        { key: "memory_type", match: { any: ["decision"] } },
        { key: "task_id", match: { value: "task-1" } },
      ]),
      must_not: [{ key: "agent_id", match: { value: "agent-b" } }],
    });
  });

  it("retries default-namespace dense search for legacy vectors but still filters canonical rows", async () => {
    insert({ id: "default-row", content: "legacy default", namespace: "default" });
    insert({ id: "private-row", content: "legacy private", namespace: "private" });
    const denseSearch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "private-row", score: 0.99 },
        { id: "default-row", score: 0.8 },
      ]);
    const retriever = createRetriever({
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) },
      hybridSearch: { denseSearch },
    });

    const response = await retriever.retrieve({
      query: "legacy",
      strategy: "semantic",
      explain: true,
    });

    expect(denseSearch).toHaveBeenCalledTimes(2);
    expect(denseSearch.mock.calls[1]).toHaveLength(2);
    expect(response.results.map((result) => result.id)).toEqual(["default-row"]);
    expect(response.trace?.stages.find((stage) => stage.stage === "dense")).toMatchObject({
      fallback: "unfiltered_legacy_vectors",
    });
  });

  it("merges legacy default-namespace vectors when modern filtered hits cannot fill the request", async () => {
    insert({ id: "modern", content: "mixed vector modern" });
    insert({ id: "legacy", content: "mixed vector legacy" });
    const denseSearch = vi.fn().mockImplementation(async (_vector, _limit, filter) =>
      filter
        ? [{ id: "modern", score: 0.9 }]
        : [
            { id: "modern", score: 0.9 },
            { id: "legacy", score: 0.95 },
          ]
    );
    const retriever = createRetriever({
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) },
      hybridSearch: { denseSearch },
    });

    const response = await retriever.retrieve({
      query: "mixed vector",
      strategy: "semantic",
      maxResults: 2,
      explain: true,
    });

    expect(denseSearch).toHaveBeenCalledTimes(2);
    expect(response.results.map((result) => result.id)).toEqual(["legacy", "modern"]);
    expect(response.trace?.stages.find((stage) => stage.stage === "dense")?.fallback).toBe(
      "unfiltered_legacy_vectors"
    );
  });

  it("keeps explicit strategies distinct and degrades auto/hybrid to FTS without dense services", async () => {
    insert({ id: "lex", content: "distinct strategy" });
    const lexicalOnly = createRetriever();

    expect(
      (await lexicalOnly.retrieve({ query: "distinct", strategy: "semantic" })).results
    ).toEqual([]);
    expect((await lexicalOnly.retrieve({ query: "distinct", strategy: "hybrid" })).strategy).toBe(
      "full_text"
    );
    expect((await lexicalOnly.retrieve({ query: "distinct" })).strategy).toBe("full_text");

    const denseSearch = vi.fn().mockResolvedValue([{ id: "lex", score: 0.9 }]);
    const denseRetriever = new MemoryRetriever({
      db,
      now: () => now,
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) },
      hybridSearch: { denseSearch },
    });
    denseRetriever.initialize();
    const semantic = await denseRetriever.retrieve({
      query: "unmatched dense query",
      strategy: "semantic",
    });
    expect(semantic.strategy).toBe("semantic");
    expect(semantic.results[0].sources).toEqual(["dense"]);
  });

  it("reports a lexical fallback instead of fabricated fusion when dense search fails", async () => {
    insert({ id: "lex", content: "graceful dense outage" });
    const retriever = createRetriever({
      embeddingClient: { embed: vi.fn().mockRejectedValue(new Error("offline")) },
      hybridSearch: { denseSearch: vi.fn() },
    });

    const response = await retriever.retrieve({
      query: "outage",
      strategy: "hybrid",
      explain: true,
    });

    expect(response.strategy).toBe("full_text");
    expect(response.results[0]).toMatchObject({ sources: ["lexical"] });
    expect(response.results[0].fusedScore).toBeUndefined();
    expect(response.trace?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "dense", status: "unavailable" }),
        expect.objectContaining({ stage: "fusion", status: "skipped" }),
      ])
    );
  });

  it("does not claim hybrid fusion when only one candidate channel has results", async () => {
    insert({ id: "lexical", content: "single lexical channel" });
    insert({ id: "dense", content: "semantic neighbor" });

    const lexicalResponse = await createRetriever({
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) },
      hybridSearch: { denseSearch: vi.fn().mockResolvedValue([]) },
    }).retrieve({ query: "lexical", strategy: "hybrid" });
    expect(lexicalResponse.strategy).toBe("full_text");
    expect(lexicalResponse.results[0]).toMatchObject({ sources: ["lexical"] });
    expect(lexicalResponse.results[0].fusedScore).toBeUndefined();

    const denseResponse = await createRetriever({
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) },
      hybridSearch: {
        denseSearch: vi.fn().mockResolvedValue([{ id: "dense", score: 0.91 }]),
      },
    }).retrieve({ query: "unmatched tokens", strategy: "hybrid" });
    expect(denseResponse.strategy).toBe("semantic");
    expect(denseResponse.results[0]).toMatchObject({
      sources: ["dense"],
      similarityScore: 0.91,
      denseScore: 0.91,
    });
    expect(denseResponse.results[0].fusedScore).toBeUndefined();
  });

  it("honors maxResults for every strategy and rejects invalid bounds", async () => {
    const denseRows = [];
    for (let index = 0; index < 12; index += 1) {
      const id = `m-${index}`;
      insert({ id, content: `bounded result common ${index}` });
      denseRows.push({ id, score: 1 - index / 100 });
    }
    const retriever = createRetriever({
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) },
      hybridSearch: { denseSearch: vi.fn().mockResolvedValue(denseRows) },
    });

    for (const strategy of ["full_text", "semantic", "hybrid"] as const) {
      const response = await retriever.retrieve({
        query: "common",
        strategy,
        maxResults: 3,
      });
      expect(response.results).toHaveLength(3);
    }
    await expect(retriever.retrieve({ query: "common", maxResults: 0 })).rejects.toThrow(
      "maxResults"
    );
    await expect(retriever.retrieve({ query: "common", maxResults: 101 })).rejects.toThrow(
      "maxResults"
    );
  });

  it("hides superseded decisions by default and reconstructs supersession as of a past time", async () => {
    const supersededAt = now - 5_000;
    insert({
      id: "old",
      content: "database choice postgres",
      memoryType: "decision",
      createdAt: now - 20_000,
      validUntil: supersededAt,
      metadata: { superseded_by: "new", superseded_at: supersededAt },
    });
    insert({
      id: "new",
      content: "database choice postgres updated",
      memoryType: "decision",
      createdAt: supersededAt,
    });
    const retriever = createRetriever();

    expect(
      (await retriever.retrieve({ query: "postgres", maxResults: 10 })).results.map(
        (result) => result.id
      )
    ).toEqual(["new"]);
    expect(
      (
        await retriever.retrieve({
          query: "postgres",
          maxResults: 10,
          includeSuperseded: true,
        })
      ).results.map((result) => result.id)
    ).toEqual(expect.arrayContaining(["old", "new"]));
    expect(
      (
        await retriever.retrieve({
          query: "postgres",
          maxResults: 10,
          asOf: supersededAt - 1,
        })
      ).results.map((result) => result.id)
    ).toEqual(["old"]);
  });

  it("keeps the old decision current until a future supersession becomes effective", async () => {
    const futureBoundary = now + 5_000;
    insert({
      id: "old-current",
      content: "future boundary decision",
      memoryType: "decision",
      createdAt: now - 20_000,
      validUntil: futureBoundary,
      metadata: { superseded_by: "future-new", superseded_at: futureBoundary },
    });
    insert({
      id: "future-new",
      content: "future boundary decision updated",
      memoryType: "decision",
      createdAt: now,
      validFrom: futureBoundary,
    });
    const retriever = createRetriever();

    expect(
      (await retriever.retrieve({ query: "future boundary" })).results.map((result) => result.id)
    ).toEqual(["old-current"]);
  });

  it("applies validity, archive, and explicit invalidation filters after hydration", async () => {
    insert({ id: "valid", content: "temporal marker", validFrom: now - 1000 });
    insert({
      id: "expired",
      content: "temporal marker",
      validUntil: now - 1,
    });
    insert({
      id: "future",
      content: "temporal marker",
      validFrom: now + 1,
    });
    insert({ id: "archived", content: "temporal marker", archivedAt: now - 1 });
    insert({ id: "expired-at", content: "temporal marker", expiredAt: now - 1 });
    insert({
      id: "invalid",
      content: "temporal marker",
      metadata: { is_valid: false },
    });
    const retriever = createRetriever();

    expect(
      (await retriever.retrieve({ query: "temporal", maxResults: 10 })).results.map(
        (result) => result.id
      )
    ).toEqual(["valid"]);
    expect(
      (
        await retriever.retrieve({
          query: "temporal",
          maxResults: 10,
          includeArchived: true,
        })
      ).results.map((result) => result.id)
    ).toEqual(expect.arrayContaining(["valid", "archived"]));
  });

  it("does not let expired FTS matches starve a valid row beyond the candidate multiplier", async () => {
    for (let index = 0; index < 12; index++) {
      insert({
        id: `a-expired-${String(index).padStart(2, "0")}`,
        content: "candidate starvation marker",
        expiredAt: now - 1,
      });
    }
    insert({ id: "z-valid", content: "candidate starvation marker" });
    const retriever = createRetriever({ candidateMultiplier: 2 });

    const response = await retriever.retrieve({
      query: "candidate starvation marker",
      strategy: "full_text",
      maxResults: 1,
    });

    expect(response.results.map((result) => result.id)).toEqual(["z-valid"]);
  });

  it("prefilters metadata-only legacy lifecycle timestamps before the FTS limit", async () => {
    for (let index = 0; index < 12; index++) {
      insert({
        id: `a-legacy-expired-${String(index).padStart(2, "0")}`,
        content: "legacy metadata lifecycle marker",
        metadata: { expired_at: now - 1 },
      });
    }
    insert({ id: "z-legacy-valid", content: "legacy metadata lifecycle marker" });
    const retriever = createRetriever({ candidateMultiplier: 2 });

    const response = await retriever.retrieve({
      query: "legacy metadata lifecycle marker",
      strategy: "full_text",
      maxResults: 1,
    });

    expect(response.results.map((result) => result.id)).toEqual(["z-legacy-valid"]);
  });

  it("gives canonical lifecycle columns precedence over stale metadata fallbacks", async () => {
    insert({
      id: "canonical-precedence",
      content: "canonical precedence lifecycle",
      validFrom: now - 1_000,
      validUntil: now + 10_000,
      expiredAt: now + 10_000,
      archivedAt: now + 10_000,
      metadata: {
        valid_from: now + 10_000,
        valid_until: now - 1,
        expired_at: now - 1,
        archived_at: now - 1,
      },
    });
    const retriever = createRetriever();

    expect(
      (await retriever.retrieve({ query: "canonical precedence" })).results.map(
        (result) => result.id
      )
    ).toEqual(["canonical-precedence"]);
  });

  it("keeps malformed legacy lifecycle timestamps for canonical postfilter parity", async () => {
    insert({
      id: "malformed-lifecycle",
      content: "malformed lifecycle parity",
      metadata: {
        valid_from: "unknown",
        valid_until: "unknown",
        expired_at: "unknown",
        archived_at: "unknown",
      },
    });
    db.prepare(
      `UPDATE memories
       SET valid_from = 'unknown', valid_until = 'unknown',
           expired_at = 'unknown', archived_at = 'unknown'
       WHERE id = 'malformed-lifecycle'`
    ).run();
    const retriever = createRetriever();

    expect(
      (await retriever.retrieve({ query: "malformed lifecycle" })).results.map(
        (result) => result.id
      )
    ).toEqual(["malformed-lifecycle"]);
  });

  it("overfetches dense candidates to a bounded canonical lifecycle filter", async () => {
    for (let index = 0; index < 12; index++) {
      insert({
        id: `dense-expired-${index}`,
        content: "dense candidate",
        expiredAt: now - 1,
      });
    }
    insert({ id: "dense-valid", content: "dense candidate" });
    const allDense = [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `dense-expired-${index}`,
        score: 1 - index / 100,
      })),
      { id: "dense-valid", score: 0.5 },
    ];
    const denseSearch = vi
      .fn()
      .mockImplementation(async (_vector, limit: number) => allDense.slice(0, limit));
    const retriever = createRetriever({
      candidateMultiplier: 1,
      embeddingClient: { embed: vi.fn().mockResolvedValue([1]) },
      hybridSearch: { denseSearch },
    });

    const response = await retriever.retrieve({
      query: "dense candidate",
      strategy: "semantic",
      maxResults: 1,
    });

    expect(denseSearch.mock.calls.map((call) => call[1])).toEqual([1, 2, 4, 8, 16]);
    expect(response.results.map((result) => result.id)).toEqual(["dense-valid"]);
  });

  it("increments access metadata only for final returned canonical rows", async () => {
    insert({ id: "returned", content: "access reinforcement" });
    insert({
      id: "filtered",
      content: "access reinforcement",
      namespace: "other",
    });
    const retriever = createRetriever();

    await retriever.retrieve({ query: "reinforcement" });

    expect(
      db.prepare("SELECT access_count, last_accessed FROM memories WHERE id = ?").get("returned")
    ).toEqual({ access_count: 1, last_accessed: now });
    expect(
      db.prepare("SELECT access_count, last_accessed FROM memories WHERE id = ?").get("filtered")
    ).toEqual({ access_count: 0, last_accessed: null });
  });

  it("emits an optional stage trace with no query, ids, payload, or content", async () => {
    insert({ id: "secret-id", content: "secret-content traceword" });
    const retriever = createRetriever();

    const withoutTrace = await retriever.retrieve({ query: "traceword" });
    const withTrace = await retriever.retrieve({
      query: "traceword",
      explain: true,
    });

    expect(withoutTrace.trace).toBeUndefined();
    expect(withTrace.trace).toBeDefined();
    expect(JSON.stringify(withTrace.trace)).not.toContain("traceword");
    expect(JSON.stringify(withTrace.trace)).not.toContain("secret-id");
    expect(JSON.stringify(withTrace.trace)).not.toContain("secret-content");
    expect(withTrace.trace?.returnedCount).toBe(1);
  });

  it("canonically hydrates fast-path ids in supplied order with filters and scores", () => {
    insert({ id: "first", content: "first canonical", namespace: "team" });
    insert({ id: "second", content: "second canonical", namespace: "team" });
    insert({ id: "leak", content: "must not leak", namespace: "private" });
    const retriever = createRetriever();

    const results = retriever.retrieveByIds(["second", "leak", "missing", "first", "second"], {
      namespace: "team",
      maxResults: 2,
      similarityScores: new Map([
        ["second", 0.95],
        ["first", 0.8],
      ]),
    });

    expect(results.map((result) => result.id)).toEqual(["second", "first"]);
    expect(results.map((result) => result.similarityScore)).toEqual([0.95, 0.8]);
    expect(results[0].sources).toEqual(["fast_path"]);
    expect(results.map((result) => result.rank)).toEqual([1, 2]);
  });

  it("tolerates invalid legacy metadata without weakening canonical filters", async () => {
    insert({ id: "legacy", content: "legacy malformed metadata", metadata: "{" });
    const retriever = createRetriever();

    const response = await retriever.retrieve({ query: "malformed" });

    expect(response.results[0].metadata).toEqual({});
    expect(response.results[0].namespace).toBe("default");
  });
});
