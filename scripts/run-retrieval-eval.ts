#!/usr/bin/env tsx
/**
 * Retrieval evaluation against frozen relevance labels.
 *
 * Implements the contract in docs/RETRIEVAL_EVALUATION.md:
 * - Calls the production MemoryRetriever on a SQLite database built from the
 *   production schema (config/sqlite-schema.sql).
 * - Compares BM25-only (full_text), dense-only (semantic) and hybrid RRF.
 *   Dense and hybrid run only when an embedding service is reachable
 *   (EMBEDDING_SERVICE_URL, default http://localhost:8000).
 * - Reports Recall@k, MRR, nDCG@k, stale-hit rate, namespace leaks,
 *   abstention behaviour and in-process latency, overall and per family.
 *
 * Fixtures are frozen in benchmarks/retrieval-eval/fixtures.v1.json. Do not
 * edit labels after looking at results; add fixtures.v2.json instead.
 *
 * Usage:
 *   npm run benchmark:retrieval              # BM25 only if no embedding service
 *   EMBEDDING_SERVICE_URL=http://localhost:8000 npm run benchmark:retrieval
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { MemoryRetriever, type RetrievalStrategy } from "../src/retrieval/memory-retriever.js";
import { EmbeddingClient } from "../src/embeddings/client.js";
import type { DenseSearchResult } from "../src/retrieval/hybrid-search.js";

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

interface FixtureMemory {
  id: string;
  namespace: string;
  memory_type: string;
  content: string;
  created_days_ago: number;
  agent_id?: string;
  superseded_by?: string;
  valid_until_days_ago?: number;
  archived_days_ago?: number;
  expired_days_ago?: number;
}

interface FixtureQuery {
  id: string;
  family: string;
  query: string;
  namespace: string;
  relevant: string[];
  partially_relevant?: string[];
  stale?: string[];
  forbidden?: string[];
  as_of_days_ago?: number;
}

interface Fixtures {
  version: number;
  reference_time: string;
  memories: FixtureMemory[];
  queries: FixtureQuery[];
}

const K = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_PATH = join(process.cwd(), "benchmarks/retrieval-eval/fixtures.v1.json");
const OUTPUT_DIR = join(process.cwd(), "benchmarks/retrieval-eval/results");

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function buildDatabase(fixtures: Fixtures, now: number): Database.Database {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(process.cwd(), "config/sqlite-schema.sql"), "utf8"));

  const insert = db.prepare(`
    INSERT INTO memories (
      id, content, memory_type, created_at, updated_at, valid_from, valid_until,
      expired_at, archived_at, metadata, namespace, agent_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ago = (days: number | undefined) => (days === undefined ? null : now - days * DAY_MS);

  for (const memory of fixtures.memories) {
    const created = now - memory.created_days_ago * DAY_MS;
    const validUntil = ago(memory.valid_until_days_ago);
    const metadata: Record<string, unknown> = {};
    if (memory.superseded_by) {
      metadata.superseded_by = memory.superseded_by;
      metadata.superseded_at = validUntil;
    }
    insert.run(
      memory.id,
      memory.content,
      memory.memory_type,
      created,
      created,
      created,
      validUntil,
      ago(memory.expired_days_ago),
      ago(memory.archived_days_ago),
      JSON.stringify(metadata),
      memory.namespace,
      memory.agent_id ?? null
    );
  }
  return db;
}

// ---------------------------------------------------------------------------
// In-process dense index (stands in for Qdrant; applies the same payload filter)
// ---------------------------------------------------------------------------

class InMemoryDenseIndex {
  private readonly points: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }> = [];

  add(id: string, vector: number[], payload: Record<string, unknown>): void {
    this.points.push({ id, vector, payload });
  }

  async denseSearch(
    queryVector: number[],
    topK: number = 5,
    filter?: Record<string, unknown>
  ): Promise<DenseSearchResult[]> {
    const must = (filter?.must as Array<{ key: string; match: Record<string, unknown> }>) ?? [];
    return this.points
      .filter((point) =>
        must.every(({ key, match }) => {
          const value = point.payload[key];
          if ("value" in match) return value === match.value;
          if ("any" in match) return (match.any as unknown[]).includes(value);
          return true;
        })
      )
      .map((point) => ({
        id: point.id,
        score: cosine(queryVector, point.vector),
        payload: point.payload,
      }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, topK) as DenseSearchResult[];
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

interface QueryOutcome {
  query: FixtureQuery;
  returned: string[];
  returnedNamespaces: string[];
  latencyMs: number;
  effectiveStrategy: string;
}

interface Metrics {
  queries: number;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number;
  ndcgAt5: number;
}

function recallAt(outcome: QueryOutcome, k: number): number {
  const relevant = outcome.query.relevant;
  if (relevant.length === 0) return 0;
  const top = new Set(outcome.returned.slice(0, k));
  return relevant.filter((id) => top.has(id)).length / relevant.length;
}

function reciprocalRank(outcome: QueryOutcome): number {
  const relevant = new Set(outcome.query.relevant);
  const index = outcome.returned.findIndex((id) => relevant.has(id));
  return index >= 0 ? 1 / (index + 1) : 0;
}

function ndcgAt(outcome: QueryOutcome, k: number): number {
  const gain = (id: string) =>
    outcome.query.relevant.includes(id)
      ? 2
      : (outcome.query.partially_relevant ?? []).includes(id)
        ? 1
        : 0;
  const dcg = outcome.returned
    .slice(0, k)
    .reduce((sum, id, i) => sum + (2 ** gain(id) - 1) / Math.log2(i + 2), 0);
  const ideal = [
    ...outcome.query.relevant.map(() => 2),
    ...(outcome.query.partially_relevant ?? []).map(() => 1),
  ]
    .slice(0, k)
    .reduce((sum, g, i) => sum + (2 ** g - 1) / Math.log2(i + 2), 0);
  return ideal > 0 ? dcg / ideal : 0;
}

function rankingMetrics(outcomes: QueryOutcome[]): Metrics {
  const scored = outcomes.filter((o) => o.query.relevant.length > 0);
  const mean = (f: (o: QueryOutcome) => number) =>
    scored.length > 0 ? scored.reduce((sum, o) => sum + f(o), 0) / scored.length : 0;
  return {
    queries: scored.length,
    recallAt1: mean((o) => recallAt(o, 1)),
    recallAt3: mean((o) => recallAt(o, 3)),
    recallAt5: mean((o) => recallAt(o, 5)),
    mrr: mean(reciprocalRank),
    ndcgAt5: mean((o) => ndcgAt(o, K)),
  };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runStrategy(
  retriever: MemoryRetriever,
  fixtures: Fixtures,
  strategy: RetrievalStrategy,
  now: number
): Promise<QueryOutcome[]> {
  const outcomes: QueryOutcome[] = [];
  for (const query of fixtures.queries) {
    const start = performance.now();
    const response = await retriever.retrieve({
      query: query.query,
      namespace: query.namespace,
      strategy,
      maxResults: K,
      ...(query.as_of_days_ago !== undefined ? { asOf: now - query.as_of_days_ago * DAY_MS } : {}),
    });
    outcomes.push({
      query,
      returned: response.results.map((r) => r.id),
      returnedNamespaces: response.results.map((r) => r.namespace),
      latencyMs: performance.now() - start,
      effectiveStrategy: response.strategy,
    });
  }
  return outcomes;
}

interface StrategyReport {
  strategy: string;
  overall: Metrics;
  byFamily: Record<string, Metrics>;
  staleHitRate: number;
  staleQueries: number;
  namespaceLeaks: number;
  forbiddenHits: number;
  abstentionQueries: number;
  abstentionNonEmpty: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  misses: Array<{ id: string; query: string; expected: string[]; got: string[] }>;
}

function summarize(strategy: string, outcomes: QueryOutcome[]): StrategyReport {
  const families = [...new Set(outcomes.map((o) => o.query.family))];
  const byFamily: Record<string, Metrics> = {};
  for (const family of families) {
    byFamily[family] = rankingMetrics(outcomes.filter((o) => o.query.family === family));
  }

  const withStale = outcomes.filter((o) => (o.query.stale ?? []).length > 0);
  const staleHits = withStale.filter((o) =>
    o.returned.some((id) => (o.query.stale ?? []).includes(id))
  ).length;

  const namespaceLeaks = outcomes.reduce(
    (sum, o) => sum + o.returnedNamespaces.filter((ns) => ns !== o.query.namespace).length,
    0
  );
  const forbiddenHits = outcomes.reduce(
    (sum, o) => sum + o.returned.filter((id) => (o.query.forbidden ?? []).includes(id)).length,
    0
  );

  const abstention = outcomes.filter((o) => o.query.relevant.length === 0);
  const latencies = outcomes.map((o) => o.latencyMs);

  return {
    strategy,
    overall: rankingMetrics(outcomes),
    byFamily,
    staleHitRate: withStale.length > 0 ? staleHits / withStale.length : 0,
    staleQueries: withStale.length,
    namespaceLeaks,
    forbiddenHits,
    abstentionQueries: abstention.length,
    abstentionNonEmpty: abstention.filter((o) => o.returned.length > 0).length,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    misses: outcomes
      .filter((o) => o.query.relevant.length > 0 && recallAt(o, K) < 1)
      .map((o) => ({
        id: o.query.id,
        query: o.query.query,
        expected: o.query.relevant,
        got: o.returned,
      })),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function renderMarkdown(
  fixtures: Fixtures,
  reports: StrategyReport[],
  skipped: string[],
  embeddingNote: string
): string {
  const lines: string[] = [];
  lines.push("# Retrieval Evaluation Results", "");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(
    `Fixture: \`fixtures.v${fixtures.version}.json\`: ${fixtures.memories.length} memories, ${fixtures.queries.length} queries`
  );
  lines.push(`Retriever: production \`MemoryRetriever\`, top-${K}`);
  lines.push(`Embeddings: ${embeddingNote}`);
  if (skipped.length > 0) lines.push(`Not run: ${skipped.join(", ")} (no embedding service)`);
  lines.push("");
  lines.push(
    "These are retrieval metrics on a small hand-labelled fixture. They do not measure whether memory improves an agent's answers (end-task usefulness); see docs/RETRIEVAL_EVALUATION.md.",
    ""
  );

  lines.push("## Overall (queries with at least one relevant memory)", "");
  lines.push(
    "| Strategy | Recall@1 | Recall@3 | Recall@5 | MRR | nDCG@5 | Stale hits | Namespace leaks | Abstention: returned results | P50 / P95 ms |"
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of reports) {
    lines.push(
      `| ${r.strategy} | ${pct(r.overall.recallAt1)} | ${pct(r.overall.recallAt3)} | ${pct(r.overall.recallAt5)} | ${r.overall.mrr.toFixed(3)} | ${r.overall.ndcgAt5.toFixed(3)} | ${pct(r.staleHitRate)} of ${r.staleQueries} | ${r.namespaceLeaks} | ${r.abstentionNonEmpty} of ${r.abstentionQueries} | ${r.latencyP50Ms.toFixed(1)} / ${r.latencyP95Ms.toFixed(1)} |`
    );
  }
  lines.push("");

  lines.push("## Recall@5 by query family", "");
  const families = Object.keys(reports[0].byFamily).filter(
    (f) => reports[0].byFamily[f].queries > 0
  );
  lines.push(`| Family | n | ${reports.map((r) => r.strategy).join(" | ")} |`);
  lines.push(`|---|---|${reports.map(() => "---").join("|")}|`);
  for (const family of families) {
    lines.push(
      `| ${family} | ${reports[0].byFamily[family].queries} | ${reports
        .map(
          (r) => `${pct(r.byFamily[family].recallAt5)} (MRR ${r.byFamily[family].mrr.toFixed(2)})`
        )
        .join(" | ")} |`
    );
  }
  lines.push("");

  for (const r of reports) {
    lines.push(`## Misses at top-${K}: ${r.strategy}`, "");
    if (r.misses.length === 0) {
      lines.push("None.", "");
      continue;
    }
    lines.push("| Query | Text | Expected | Returned |", "|---|---|---|---|");
    for (const m of r.misses) {
      lines.push(
        `| ${m.id} | ${m.query} | ${m.expected.join(", ")} | ${m.got.join(", ") || "(none)"} |`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixtures;
  const now = Date.parse(fixtures.reference_time);

  // Dense channel is optional.
  const serviceUrl = process.env.EMBEDDING_SERVICE_URL || "http://localhost:8000";
  let embeddingClient: EmbeddingClient | undefined;
  let embeddingNote = "none (BM25 only)";
  try {
    const candidate = new EmbeddingClient({ serviceUrl, timeout: 5_000, maxRetries: 1 });
    const health = await candidate.health();
    embeddingClient = candidate;
    embeddingNote = `${(health as { model?: string }).model ?? "unknown model"} via ${serviceUrl}`;
  } catch {
    console.log(`Embedding service not reachable at ${serviceUrl}; running BM25 only.`);
  }

  const strategies: RetrievalStrategy[] = ["full_text"];
  const skipped: string[] = [];
  let denseIndex: InMemoryDenseIndex | undefined;
  if (embeddingClient) {
    denseIndex = new InMemoryDenseIndex();
    const vectors = await embeddingClient.embedLargeBatch(
      fixtures.memories.map((m) => m.content),
      32
    );
    fixtures.memories.forEach((m, i) =>
      denseIndex!.add(m.id, vectors[i], { namespace: m.namespace, memory_type: m.memory_type })
    );
    strategies.push("semantic", "hybrid");
  } else {
    skipped.push("semantic", "hybrid");
  }

  const reports: StrategyReport[] = [];
  for (const strategy of strategies) {
    // Fresh database per strategy so access reinforcement cannot leak between runs.
    const db = buildDatabase(fixtures, now);
    const retriever = new MemoryRetriever({
      db,
      now: () => now,
      ...(embeddingClient && denseIndex ? { embeddingClient, hybridSearch: denseIndex } : {}),
    });
    retriever.initialize();
    const outcomes = await runStrategy(retriever, fixtures, strategy, now);
    const mismatched = outcomes.filter((o) => o.effectiveStrategy !== strategy);
    if (mismatched.length > 0) {
      console.log(
        `Note: ${mismatched.length} ${strategy} queries fell back to another strategy (${[
          ...new Set(mismatched.map((o) => o.effectiveStrategy)),
        ].join(", ")}).`
      );
    }
    reports.push(summarize(strategy, outcomes));
    db.close();
  }

  const markdown = renderMarkdown(fixtures, reports, skipped, embeddingNote);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const suffix = embeddingClient ? "all" : "bm25";
  writeFileSync(join(OUTPUT_DIR, `results-${suffix}.md`), markdown);
  writeFileSync(
    join(OUTPUT_DIR, `results-${suffix}.json`),
    JSON.stringify({ fixtureVersion: fixtures.version, k: K, embeddingNote, reports }, null, 2)
  );
  console.log(markdown);

  const leaks = reports.reduce((sum, r) => sum + r.namespaceLeaks, 0);
  if (leaks > 0) {
    console.error(`FAIL: ${leaks} namespace leaks (zero-tolerance).`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Retrieval evaluation failed:", error);
  process.exit(1);
});
