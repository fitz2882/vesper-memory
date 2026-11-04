# Retrieval Evaluation Results

Generated: 2026-11-04T19:18:39.343Z
Fixture: `fixtures.v1.json`: 115 memories, 60 queries
Retriever: production `MemoryRetriever`, top-5
Embeddings: BGE-large-en-v1.5 via http://localhost:8000

These are retrieval metrics on a small hand-labelled fixture. They do not measure whether memory improves an agent's answers (end-task usefulness); see docs/RETRIEVAL_EVALUATION.md.

## Overall (queries with at least one relevant memory)

| Strategy | Recall@1 | Recall@3 | Recall@5 | MRR | nDCG@5 | Stale hits | Namespace leaks | Abstention: returned results | P50 / P95 ms |
|---|---|---|---|---|---|---|---|---|---|
| full_text | 67.9% | 77.4% | 77.4% | 0.720 | 0.736 | 0.0% of 8 | 0 | 6 of 7 | 0.6 / 1.0 |
| semantic | 81.1% | 94.3% | 96.2% | 0.876 | 0.890 | 0.0% of 8 | 0 | 6 of 7 | 228.5 / 299.6 |
| hybrid | 79.2% | 86.8% | 88.7% | 0.825 | 0.844 | 0.0% of 8 | 0 | 6 of 7 | 0.9 / 1.4 |

## Recall@5 by query family

| Family | n | full_text | semantic | hybrid |
|---|---|---|---|---|
| lexical | 12 | 100.0% (MRR 1.00) | 100.0% (MRR 0.96) | 100.0% (MRR 1.00) |
| conversational | 8 | 75.0% (MRR 0.67) | 87.5% (MRR 0.72) | 75.0% (MRR 0.75) |
| paraphrase | 18 | 44.4% (MRR 0.35) | 94.4% (MRR 0.79) | 77.8% (MRR 0.60) |
| distractor | 8 | 100.0% (MRR 1.00) | 100.0% (MRR 1.00) | 100.0% (MRR 1.00) |
| longitudinal | 7 | 100.0% (MRR 0.93) | 100.0% (MRR 1.00) | 100.0% (MRR 1.00) |

## Misses at top-5: full_text

| Query | Text | Expected | Returned |
|---|---|---|---|
| cv-02 | Where do I work? | d-employer | d-fill-47, d-fill-19 |
| cv-04 | What is my dog called? | d-pet | d-fill-22, d-employer, d-linter, d-fill-47, d-fill-07 |
| pp-02 | How should I format source files? | d-tabs | d-fill-39, d-commit |
| pp-04 | Minimum test coverage needed before merging | d-tests | d-skill-debug-flaky, d-ticket, d-fill-26, d-fill-01, d-tz |
| pp-05 | What hot drink should I bring her? | d-coffee | d-commit |
| pp-06 | Earliest time I can book a call with her | d-tz | d-fill-06, d-oncall, d-fill-35, d-fill-44, d-standup |
| pp-07 | Why did the vector database connection get refused locally? | d-err-econn | d-err-sqlite-busy, d-skill-db-migrate, d-fill-37, d-budget, d-fill-00 |
| pp-10 | How long are arrival time predictions kept before recomputing? | d-cache-ttl | d-tz, d-fill-26, d-docs-pref, d-fill-01, d-fill-06 |
| pp-11 | How do I ship a new version of the package? | d-skill-release | d-fill-47, d-fill-48, d-ml-model, d-laptop, d-retrain-fail |
| pp-15 | Which day has no meetings? | d-meeting-free | d-tz, d-review-sla-v2, d-deploy-friday, d-fill-20, d-tabs |
| pp-16 | What went wrong with last night's model training? | d-retrain-fail | d-ml-model, d-fill-44, d-laptop, d-manager, d-name |
| pp-18 | Who handles pages if I don't respond? | d-oncall | d-pet |

## Misses at top-5: semantic

| Query | Text | Expected | Returned |
|---|---|---|---|
| cv-02 | Where do I work? | d-employer | d-fill-49, d-k8s, d-review-sla-v2, d-fill-05, d-fill-08 |
| pp-18 | Who handles pages if I don't respond? | d-oncall | d-fill-03, d-commit, d-fill-14, d-fill-08, d-review-sla-v2 |

## Misses at top-5: hybrid

| Query | Text | Expected | Returned |
|---|---|---|---|
| cv-02 | Where do I work? | d-employer | d-fill-47, d-fill-19, d-fill-49, d-k8s, d-review-sla-v2 |
| cv-04 | What is my dog called? | d-pet | d-fill-22, d-fill-09, d-fill-13, d-fill-30, d-learning |
| pp-07 | Why did the vector database connection get refused locally? | d-err-econn | d-err-sqlite-busy, d-skill-db-migrate, d-port-qdrant, d-fill-00, d-port-embed |
| pp-15 | Which day has no meetings? | d-meeting-free | d-deploy-friday, d-tz, d-review-sla-v2, d-linter, d-tabs |
| pp-16 | What went wrong with last night's model training? | d-retrain-fail | d-ml-model, d-skill-debug-flaky, d-fill-06, d-err-sqlite-busy, d-fill-38 |
| pp-18 | Who handles pages if I don't respond? | d-oncall | d-fill-03, d-pet, d-commit, d-fill-14, d-fill-08 |
