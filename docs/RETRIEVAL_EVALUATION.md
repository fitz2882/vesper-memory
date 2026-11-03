# Retrieval evaluation contract

This contract prevents retrieval changes from being accepted on anecdotal
examples or latency alone.

## Frozen baseline

Compare every candidate against:

1. FTS5/BM25 only.
2. Dense retrieval only, when embeddings are available.
3. Current hybrid reciprocal-rank fusion.
4. A matched scratch/no-memory answer for end-task usefulness studies.

Do not change prompts, candidate depth, fixtures, relevance labels, or success
thresholds after examining candidate results.

## Required fixture families

- Lexical needles: identifiers, error strings, filenames, and exact decisions.
- Paraphrases: relevant content with little token overlap.
- Hard distractors: high semantic similarity but wrong namespace, agent, task,
  type, time window, or supersession state.
- Outage/recovery: missing Redis, embedding, or Qdrant services plus replay of a
  partially acknowledged outbox mutation.
- Longitudinal decisions: original, superseding, archived, invalidated, and
  `as_of` queries before and after the transition.

## Metrics

Report Recall@k, MRR, nDCG@k, stale-hit rate, cross-namespace leak count,
abstention/empty-result correctness, p50/p95 latency, and index-repair backlog.
Namespace leaks and canonical-field mismatches are zero-tolerance failures.

For end-task studies, separately report answer correctness, unsupported-claim
rate, tool/token cost, and performance relative to the matched scratch
baseline. A retrieval AUC or similarity improvement alone is not proof that
memory helps the task.

The lightweight diagnostic benchmark calls the production `MemoryRetriever`
against frozen relevance IDs and reports Recall@3/MRR. Arithmetic token-size
models are labelled separately and are not empirical performance evidence.

## Promotion gates

A candidate can replace the baseline only when:

- it has no namespace or canonical-hydration violations;
- it improves a preregistered usefulness metric on held-out fixtures;
- the improvement survives hard distractors and historical queries;
- latency and dependency cost remain within the declared budget; and
- rollback consists of disabling the candidate without migrating canonical
  SQLite data.

Preserve negative results. A candidate that fails a gate is evidence about the
design space, not a reason to rewrite the gate.
