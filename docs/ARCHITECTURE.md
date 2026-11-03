# Vesper architecture

## Invariants

1. SQLite is the canonical source for memory content, identity, namespace,
   attribution, validity, and lifecycle state.
2. Redis and Qdrant are rebuildable projections. They may nominate candidate
   IDs, but their payloads never authorize or hydrate a returned memory.
3. Every retrieval path applies namespace, type, agent, task, exclusion,
   archive, validity, and supersession filters to canonical SQLite rows.
4. A canonical mutation and its `index_outbox` record commit in one SQLite
   transaction. Derived-index failure leaves a retryable mutation, not a failed
   canonical write.
5. Consolidation is incremental and idempotent. A source memory is checkpointed
   only after all derived work for that memory commits.

## Write path

`store_memory`, `store_decision`, context sharing, and deletion first update
SQLite and enqueue an upsert or tombstone in `index_outbox`. The server then
attempts a bounded inline drain. Qdrant and Redis acknowledge independently;
successful work is not repeated when only one projection is unavailable. A
startup drain repairs pending mutations after an outage. Desired projections
are tracked separately from live connections, so a startup outage preserves
repair work while an explicit optional-service disable creates no phantom
backlog.

User metadata is written before trusted projection fields so it cannot override
`content`, `memory_type`, `namespace`, attribution, or timestamps.

## Retrieval path

`MemoryRetriever` owns the memory retrieval contract:

- FTS5/BM25 nominates exact lexical matches.
- Qdrant nominates dense semantic matches when embeddings are available.
- Dense retrieval progressively doubles candidate depth only when canonical
  filtering leaves fewer than the requested results, capped at 800.
- Hybrid mode combines the two ranked lists with reciprocal-rank fusion.
- SQLite hydrates the IDs, applies all filters, and returns canonical fields.
- Redis fast-path results are also reduced to IDs and canonically hydrated.
- Successful retrieval reinforces `access_count` and `last_accessed`.

`auto` selects hybrid retrieval when dense dependencies are available and FTS5
otherwise. A runtime dense-search failure truthfully degrades to full-text
retrieval. The legacy `graph` option remains a compatibility alias because the
old implementation did not perform the advertised personalized PageRank and
returned graph entities rather than memory records.

## Temporal and versioned memory

Memories have `valid_from`, `valid_until`, `expired_at`, and `archived_at`
columns. `store_decision.supersedes` closes the previous decision and records
`superseded_by`/`superseded_at`; it does not delete history. Retrieval hides
closed or superseded rows by default, while `as_of` supports historical views.

## Three layers

- Episodic source: immutable canonical memory rows in SQLite.
- Semantic projection: entities, facts, and relationships derived by bounded
  consolidation batches.
- Procedural projection: reusable skills with namespace-scoped feedback and
  loading.

Consolidation reads unconsolidated SQLite rows directly, so Redis availability
cannot disable it. Relationship decay uses `last_decayed_at`, preventing the
same elapsed interval from being compounded on every run. Backups are real
SQLite files under the Vesper data directory, verified before completed
metadata is written. Expired backup files and metadata are removed only from
the verified backup directory according to the configured retention period.

## Operational posture

- SQLite enables foreign keys and a busy timeout.
- Docker development ports bind only to loopback.
- MCP diagnostics use stderr, preserving stdout for protocol messages.
- `get_stats(detailed=true)` reports observed latency, cache behavior, SQLite
  bytes, outbox backlog, lifecycle counts, scheduler state, and live optional
  service statistics. It does not return fabricated performance values.

## Deferred work

The following need evaluation evidence before becoming defaults: learned
reranking, BGE-M3 sparse/multi-vector indexes, LLM-authored consolidation,
approximate graph guides, and a real personalized PageRank graph route. Each
adds operational cost or failure modes and should ship behind an explicit
comparison against the retrieval baseline.
