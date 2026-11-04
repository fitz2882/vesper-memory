# Retrieval Evaluation

A frozen, hand-labelled retrieval benchmark that follows [`docs/RETRIEVAL_EVALUATION.md`](../../docs/RETRIEVAL_EVALUATION.md).

```bash
npm run benchmark:retrieval                                                      # BM25 only
EMBEDDINGS_FILE=benchmarks/retrieval-eval/embeddings.bge-large-en-v1.5.json \
  npm run benchmark:retrieval                                                    # all three, cached vectors
EMBEDDING_SERVICE_URL=http://localhost:8000 npm run benchmark:retrieval          # all three, live service
QUERY_SET=heldout ...                                                            # held-out queries
QUERY_SET=identifiers EMBEDDINGS_FILE=<main file>,benchmarks/retrieval-eval/embeddings-identifiers.bge-large-en-v1.5.json ...  # identifier stress set
RETRIEVER_OPTS='{"hybridDropsStopwords":false}' ...                              # try retriever settings
```

The cached embeddings file holds BGE-large-en-v1.5 vectors for every fixture memory and query, so dense and hybrid results are reproducible without the model. With cached vectors, latency excludes embedding. Regenerate the file with `WRITE_EMBEDDINGS_FILE=<path>` against a live service whenever fixtures change.

`heldout.v1.json` holds 30 queries over the same memories. They were written before any retriever change was tuned. Use them only to confirm a change chosen on the main set; see `EXPERIMENTS.md`.

`identifiers.v1.json` adds 17 near-miss memories (neighbouring ticket ids, exit codes, ports, commit SHAs, env vars) and 26 identifier queries. It has its own embeddings file; `EMBEDDINGS_FILE` takes a comma-separated list.

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

## Known issue in the first dense run

`results/results-all.*` (commit 065373f) reports hybrid latency of about 1 ms. That number is wrong: the semantic run and the hybrid run shared one `EmbeddingClient`, whose in-memory cache returned the query embeddings the semantic run had already computed. Rankings are unaffected (the vectors are identical), but hybrid's real latency is the same as semantic's, since both embed the query. The harness now uses a fresh client per strategy.
