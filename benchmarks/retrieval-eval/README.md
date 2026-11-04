# Retrieval Evaluation

A frozen, hand-labelled retrieval benchmark that follows [`docs/RETRIEVAL_EVALUATION.md`](../../docs/RETRIEVAL_EVALUATION.md).

```bash
npm run benchmark:retrieval                                        # BM25 only
EMBEDDING_SERVICE_URL=http://localhost:8000 npm run benchmark:retrieval  # BM25, dense, hybrid
```

## What it does

- Builds an in-memory SQLite database from the production schema (`config/sqlite-schema.sql`) and loads `fixtures.v1.json`.
- Calls the production `MemoryRetriever` with `full_text` (BM25), `semantic` (dense) and `hybrid` (RRF) strategies, top-5.
- Dense search uses the real embedding service, with an in-process index that applies the same namespace and type payload filter as Qdrant. Dense and hybrid are skipped when no embedding service is reachable.
- Writes `results/results-bm25.*` or `results/results-all.*`, and exits non-zero on any namespace leak.

## Fixture (v1)

115 memories for a fictional engineer, across three namespaces (`default`, `researcher`, `reviewer`) and all four memory types, plus 60 queries in six families:

| Family | n | Tests |
|---|---|---|
| lexical | 12 | Exact identifiers, error strings, filenames, ticket ids |
| conversational | 8 | "What is my name?"-style questions full of stopwords |
| paraphrase | 18 | Relevant memory shares few or no tokens with the query |
| distractor | 8 | Near-duplicate memories exist in another namespace and must not leak |
| longitudinal | 8 | Superseded decisions, archived and expired rows, and `as_of` queries before a change |
| abstention | 6 | Nothing relevant exists; the correct answer is no result |

Metrics: Recall@1/3/5, MRR and nDCG@5 (relevant = gain 2, partially relevant = gain 1) on answerable queries; stale-hit rate on queries with a superseded or expired version; namespace leaks; how many unanswerable queries still return results; and in-process P50/P95 latency (excluding embedding when BM25 only).

## Rules

- Labels were written before any results were seen. Do not edit `fixtures.v1.json` after looking at results. Add `fixtures.v2.json` (via a new generator) instead, and keep v1 results for comparison.
- The fixture is small and synthetic. It catches regressions and shows relative strengths of strategies; it does not measure end-task usefulness, which needs a matched no-memory answer study.
