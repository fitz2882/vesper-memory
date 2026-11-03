# Memory-system research review (2026)

This implementation review combined the existing Vesper code and live memory
behavior with a review of the agent-memory literature and current primary research.

## Adopted now

- Three-layer memory: immutable episodes, semantic projections, and procedural
  skills.
- Bitemporal/version-aware records: preserve history by closing or superseding
  rows instead of deleting them.
- Multi-path retrieval: lexical and dense candidates with rank fusion, followed
  by canonical verification.
- Reinforcement on successful recall through access counters.
- Idempotent, checkpointed consolidation and durable projection repair.
- Falsifiable evaluation with held-out distractors and a scratch baseline.

These choices directly address observed Vesper failures: semantically plausible
but irrelevant hits, ignored retrieval strategies/filters, disconnected Redis
and graph layers, partial writes that could duplicate canonical memory, fake
backup metadata, and hard-coded operational metrics.

## Research that informed the design

- [Qdrant hybrid queries](https://qdrant.tech/documentation/search/hybrid-queries/)
  and [reranking](https://qdrant.tech/documentation/search-precision/reranking-semantic-search/)
  support staged candidate fusion and optional later reranking.
- [BGE-M3](https://arxiv.org/abs/2402.03216) and Qdrant
  [multivectors](https://qdrant.tech/documentation/tutorials-search-engineering/using-multivector-representations/)
  motivate future sparse and late-interaction experiments, not an immediate
  production migration.
- [LongMemEval](https://arxiv.org/abs/2410.10813) and
  [LoCoMo](https://arxiv.org/abs/2402.17753) motivate temporal, multi-session,
  abstention, and hard-distractor evaluation.
- [Graphiti/Zep](https://arxiv.org/abs/2501.13956),
  [A-MEM](https://arxiv.org/abs/2502.12110), and
  [HippoRAG 2](https://arxiv.org/abs/2502.14802) motivate versioned graph memory
  and graph-guided retrieval. Vesper does not claim those algorithms until it
  implements and measures them faithfully.

## Deferred hypotheses

Learned reranking, BGE-M3, multi-vector late interaction, LLM consolidation,
and personalized PageRank may improve recall or reasoning. They also increase
latency, model dependence, storage, and recovery complexity. They remain
experiments until they pass the frozen evaluation contract in
`RETRIEVAL_EVALUATION.md`.
