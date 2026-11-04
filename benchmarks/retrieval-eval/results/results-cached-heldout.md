# Retrieval Evaluation Results

Generated: 2026-11-04T19:44:01.365Z
Fixture: `fixtures.v1.json`: 115 memories, 30 queries
Retriever: production `MemoryRetriever`, top-5
Embeddings: BGE-large-en-v1.5 from cached file benchmarks/retrieval-eval/embeddings.bge-large-en-v1.5.json (latency excludes embedding)

These are retrieval metrics on a small hand-labelled fixture. They do not measure whether memory improves an agent's answers (end-task usefulness); see docs/RETRIEVAL_EVALUATION.md.

## Overall (queries with at least one relevant memory)

| Strategy | Recall@1 | Recall@3 | Recall@5 | MRR | nDCG@5 | Stale hits | Namespace leaks | Abstention: returned results | P50 / P95 ms |
|---|---|---|---|---|---|---|---|---|---|
| full_text | 67.9% | 71.4% | 78.6% | 0.708 | 0.727 | 0.0% of 2 | 0 | 1 of 2 | 1.5 / 1.9 |
| semantic | 82.1% | 89.3% | 96.4% | 0.869 | 0.893 | 0.0% of 2 | 0 | 2 of 2 | 0.7 / 2.2 |
| hybrid | 75.0% | 89.3% | 92.9% | 0.823 | 0.849 | 0.0% of 2 | 0 | 2 of 2 | 1.6 / 3.6 |

## Recall@5 by query family

| Family | n | full_text | semantic | hybrid |
|---|---|---|---|---|
| conversational | 8 | 50.0% (MRR 0.50) | 87.5% (MRR 0.64) | 75.0% (MRR 0.60) |
| paraphrase | 12 | 83.3% (MRR 0.72) | 100.0% (MRR 0.94) | 100.0% (MRR 0.89) |
| lexical | 5 | 100.0% (MRR 1.00) | 100.0% (MRR 1.00) | 100.0% (MRR 1.00) |
| distractor | 2 | 100.0% (MRR 0.63) | 100.0% (MRR 1.00) | 100.0% (MRR 0.75) |
| longitudinal | 1 | 100.0% (MRR 1.00) | 100.0% (MRR 1.00) | 100.0% (MRR 1.00) |

## Misses at top-5: full_text

| Query | Text | Expected | Returned |
|---|---|---|---|
| ho-01 | Which city am I based in? | d-name | d-fill-27, d-file-router, d-fill-31, d-fill-33, d-fill-47 |
| ho-02 | What company do I work for? | d-employer | d-fill-47, d-fill-19, d-fill-27, d-fill-03, d-fill-33 |
| ho-03 | Who do I report to? | d-manager | d-fill-47, d-pet, d-fill-14, d-observability, d-goal |
| ho-04 | What is my pet's name? | d-pet | d-name, d-manager, d-laptop, d-goal, d-cache-ttl |
| ho-12 | Where is the code that decides what kind of question was asked? | d-file-router | d-err-oom, d-manager, d-laptop, d-review-sla-v2, d-fill-02 |
| ho-18 | Which algorithm predicts delivery arrival times? | d-ml-model | d-fill-02, d-hiring |

## Misses at top-5: semantic

| Query | Text | Expected | Returned |
|---|---|---|---|
| ho-03 | Who do I report to? | d-manager | d-commit, d-fill-17, d-fill-08, d-review-sla-v2, d-fill-30 |

## Misses at top-5: hybrid

| Query | Text | Expected | Returned |
|---|---|---|---|
| ho-02 | What company do I work for? | d-employer | d-fill-27, d-fill-04, d-fill-19, d-k8s, d-review-sla-v2 |
| ho-03 | Who do I report to? | d-manager | d-commit, d-fill-17, d-fill-08, d-review-sla-v2, d-fill-30 |
