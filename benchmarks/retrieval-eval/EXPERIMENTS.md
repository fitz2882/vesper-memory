# Retrieval Experiments

The contract in `docs/RETRIEVAL_EVALUATION.md` asks for negative results to be kept. This file logs every variant tried, in order.

Setup for every row:
- **Data:** `fixtures.v1.json` memories with cached BGE-large-en-v1.5 embeddings (`embeddings.bge-large-en-v1.5.json`), top-5.
- **Tuning set:** the 53 answerable `fixtures.v1.json` queries.
- **Held-out set:** the 28 answerable `heldout.v1.json` queries. They were written before any variant was tried and were used once, to confirm the chosen variant.

## 2026-11-04: hybrid fusion is worse than dense alone

Baseline: hybrid RRF (k=60, equal weights, BM25 query = OR of every token) reaches 88.7% Recall@5, against 96.2% for dense alone.

| Variant (tuning set) | Hybrid R@1 | R@3 | R@5 | MRR |
|---|---|---|---|---|
| Baseline | 79.2% | 86.8% | 88.7% | 0.825 |
| Drop stopwords from the BM25 query | 77.4% | 90.6% | **94.3%** | 0.840 |
| Dense weight 2 | 79.2% | 86.8% | 88.7% | 0.829 |
| Dense weight 3 | 81.1% | 86.8% | 88.7% | 0.838 |
| Lexical weight 0.5 | 79.2% | 86.8% | 88.7% | 0.829 |
| RRF k=20 | 79.2% | 86.8% | 88.7% | 0.825 |
| Stopwords + dense weight 2 | 77.4% | 90.6% | 94.3% | 0.843 |
| Stopwords + k=20 + dense weight 2 | 77.4% | 90.6% | 96.2% | 0.850 |

Reweighting the fusion does not help on its own: the noisy BM25 candidates are in the list either way. Dropping stopwords is the only change that moves Recall@5. The three-knob combination scores slightly higher, but it was tuned on 53 queries and was not adopted.

Stopword removal also hurts BM25-only retrieval (77.4% to 73.6%), because some answers were found only through words like "she" or "a". So it is applied only to the lexical channel of hybrid retrieval. When hybrid falls back to BM25 alone, the full query is used.

**Adopted:** `hybridDropsStopwords` (default on). Held-out confirmation:

| Held-out (28 queries) | Hybrid R@1 | R@3 | R@5 | MRR |
|---|---|---|---|---|
| Before | 78.6% | 82.1% | 82.1% | 0.804 |
| After | 75.0% | 89.3% | **92.9%** | 0.823 |
| Dense alone, for reference | 82.1% | 89.3% | 96.4% | 0.869 |

The gain holds on the held-out set. Two caveats:
- **Recall@1 dips** slightly on both sets: the right answer reaches the top five more often but is sometimes no longer first.
- **Dense alone is still ahead.** Candidates for closing the gap are a porter-stemmed FTS index and a score threshold on BM25 candidates. Each needs a fresh held-out set, because this one has now been used.

## 2026-11-04: should semantic replace hybrid as the default?

Dense alone led hybrid by one query on each of the main and held-out sets, so the question was whether to make semantic the default. The main set's 12 lexical queries scored 100% for every strategy, so they could not show what keyword search adds. `identifiers.v1.json` was written and committed (0812d19) before any run. It adds 17 near-miss memories to the corpus (CARGO-4412 vs CARGO-4413, exit 137 vs 139, :6380 vs :5432, 3f9c2ab vs 3f9e2ab, `ROUTING_MAX_STOPS` vs `ROUTING_MAX_DRIVERS`) and asks 26 bare or lightly worded identifier queries.

| Identifier set (26 queries, 132 memories) | R@1 | R@3 | R@5 | MRR |
|---|---|---|---|---|
| BM25 | 92.3% | 100% | 100% | 0.955 |
| Dense | 78.8% | 100% | 100% | 0.904 |
| Hybrid | **94.2%** | 100% | 100% | **0.981** |

- BGE-large handled identifiers better than expected: every strategy put the right memory in the top five every time.
- Hybrid puts it first far more often (94% vs 79%). Dense tends to rank a near-miss (the neighbouring ticket, the other exit code) above the exact match.
- Latency is the same either way (P50 237 ms dense vs 231 ms hybrid on Dave's Mac, live embedding), since both embed the query.

**Decision:** keep hybrid as the default. Across all three sets, dense leads by one query on Recall@5 in paraphrase-heavy sets, and hybrid leads clearly on rank-1 for identifiers. Neither gap is large on 26–53 queries. The corpus is also small: with thousands of memories, near-miss identifiers multiply, which is the case where rank order matters most. Revisit with a larger corpus or real usage logs.
