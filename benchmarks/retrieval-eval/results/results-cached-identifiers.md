# Retrieval Evaluation Results

Generated: 2026-11-04T19:59:01.584Z
Fixture: `fixtures.v1.json`: 132 memories, 26 queries
Retriever: production `MemoryRetriever`, top-5
Embeddings: BGE-large-en-v1.5 from cached file benchmarks/retrieval-eval/embeddings.bge-large-en-v1.5.json,benchmarks/retrieval-eval/embeddings-identifiers.bge-large-en-v1.5.json (latency excludes embedding)

These are retrieval metrics on a small hand-labelled fixture. They do not measure whether memory improves an agent's answers (end-task usefulness); see docs/RETRIEVAL_EVALUATION.md.

## Overall (queries with at least one relevant memory)

| Strategy | Recall@1 | Recall@3 | Recall@5 | MRR | nDCG@5 | Stale hits | Namespace leaks | Abstention: returned results | P50 / P95 ms |
|---|---|---|---|---|---|---|---|---|---|
| full_text | 92.3% | 100.0% | 100.0% | 0.955 | 0.969 | 0.0% of 0 | 0 | 0 of 0 | 1.3 / 1.8 |
| semantic | 78.8% | 100.0% | 100.0% | 0.904 | 0.926 | 0.0% of 0 | 0 | 0 of 0 | 0.7 / 6.8 |
| hybrid | 94.2% | 100.0% | 100.0% | 0.981 | 0.986 | 0.0% of 0 | 0 | 0 of 0 | 1.6 / 3.2 |

## Recall@5 by query family

| Family | n | full_text | semantic | hybrid |
|---|---|---|---|---|
| identifier-bare | 18 | 100.0% (MRR 1.00) | 100.0% (MRR 0.92) | 100.0% (MRR 0.97) |
| identifier-worded | 8 | 100.0% (MRR 0.85) | 100.0% (MRR 0.88) | 100.0% (MRR 1.00) |

## Misses at top-5: full_text

None.

## Misses at top-5: semantic

None.

## Misses at top-5: hybrid

None.
