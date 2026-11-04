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
