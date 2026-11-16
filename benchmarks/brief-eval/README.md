# Brief-mode evaluation

`retrieve_memory` with `format: "brief"` retrieves a wide candidate pool, then packs the most relevant parts of many memories into one numbered text within `brief_token_budget` (default 600). This harness measures whether that puts more of the needed evidence in front of the model than today's default of five whole memories.

The idea comes from Memorilla ([arXiv 2610.21375](https://arxiv.org/abs/2610.21375)), which compresses a whole memory collection into 16 query-specific soft tokens for one open-weight model. Memorilla can't feed Claude or Codex, which only take text, so brief mode is a text version: no LLM call, deterministic, a few milliseconds.

```bash
git clone --depth 1 https://github.com/snap-research/locomo /tmp/locomo   # CC BY-NC 4.0, not committed here
LOCOMO_PATH=/tmp/locomo/data/locomo10.json npx tsx scripts/run-brief-eval.ts                      # BM25
LOCOMO_PATH=... EMBEDDING_SERVICE_URL=http://localhost:8000 npx tsx scripts/run-brief-eval.ts     # + dense, hybrid
SAMPLES=0-4 ...   # a subset of conversations, for tune/held-out splits
```

## Method

- **Data:** LoCoMo-10, 10 long conversations. Each of the 5,882 dialogue turns is stored as one memory, dated by its session; each conversation is its own namespace.
- **Questions:** 1,535 questions with labelled evidence turns, in four categories: single-hop (841), temporal (320), multi-hop (282) and open-domain (92). Adversarial questions (category 5) have no evidence and are excluded; 5 questions whose evidence ids are missing from the data are skipped.
- **Arms:** `top5` (today's default), `whole@B` (whole memories in rank order until B tokens), `brief@B` (`buildMemoryBrief`: trimming, de-duplication, first-fit packing), for B = 300, 600 and 1,200.
- **Metrics:** evidence recall (labelled turns present), all-evidence (every labelled turn present), answer present (all normalised answer words appear, for answers of 6 words or fewer), and estimated tokens.

## Results (BM25, all conversations)

| Arm | Evidence recall | Multi-hop evidence recall | Multi-hop, all evidence | Answer present | Avg tokens |
|---|---|---|---|---|---|
| top5 (today) | 34.7% | 13.6% | 3.9% | 28.6% | 199 |
| brief@300 | 38.5% | 16.9% | 5.3% | 31.7% | 286 |
| brief@600 (default) | 45.3% | 24.5% | 8.2% | 37.6% | 577 |
| brief@1200 | 53.1% | 33.8% | 14.2% | 42.6% | 1,160 |

Full per-category tables: [`results/results-bm25.md`](./results/results-bm25.md). The gain held on both halves of the data: conversations 0–4 went from 37.8% to 48.3% evidence recall at 600 tokens, and conversations 5–9 from 33.7% to 42.9%.

## What this does and doesn't show

- **The gain comes from filling a token budget, not from compression.** `brief@B` and `whole@B` score identically here because LoCoMo turns are short (about 20 to 40 tokens), so nothing is trimmed and nothing is a near-duplicate. Trimming and de-duplication only matter for long or repeated memories; they are covered by unit tests, not by this benchmark.
- **More tokens, more evidence.** The default brief spends about 3 times the tokens of `top5`. The fair comparison is against raising `max_results`, and `whole@B` is that comparison; brief mode's value is that the budget is in tokens rather than a count, so one long memory can't crowd out the rest.
- **BM25 only.** No embedding service was available in the environment where these numbers were produced, so dense and hybrid were not run. Hybrid should raise every arm; re-run with `EMBEDDING_SERVICE_URL` before relying on absolute numbers.
- **Retrieval, not answers.** This counts evidence handed to the model, not whether Claude then answers correctly. Temporal "answer present" is low because LoCoMo answers are written as dates ("7 May 2023") while the brief shows ISO dates and the turns say "yesterday"; a model has to do the arithmetic.
- **Multi-hop stays hard.** Even at 1,200 tokens, only 14% of multi-hop questions get every evidence turn. Memorilla's largest gains are on this kind of question; an extractive brief does not reproduce them.

## Tried and rejected

- **Query-term coverage re-ranking (MMR-style)**, tuned on conversations 0–4 with weights 0.2, 0.4 and 0.6: overall evidence recall moved by at most 0.2 points, and multi-hop got worse at 0.4 and 0.6 (25.1% to 24.6% and 24.9%; all-evidence 11.3% to 10.6% and 9.9%). Removed rather than shipped behind a flag.
