# Vesper Benchmarks

This directory contains benchmark results and documentation for the Vesper memory system.

## Overview

Vesper has two types of benchmarks that measure different aspects of the memory system:

| Benchmark | What It Measures | When to Use |
|-----------|-----------------|-------------|
| **Latency Benchmark** | Overhead cost of memory operations | Performance optimization |
| **Accuracy Benchmark** | Quality/value of memory retrieval | Evaluating memory effectiveness |

## Benchmark Types

### 1. Latency Benchmark (`npm run benchmark:real`)

**Purpose:** Measures the performance overhead of memory operations.

**Methodology:**
- **Enabled Mode:** Full memory pipeline (embedding + storage + retrieval)
- **Disabled Mode:** No-op baseline (minimal latency)
- **Comparison:** Latency difference between modes

**Metrics:**
- P50/P95/P99 latency percentiles
- Statistical significance (Welch's t-test)
- Effect size (Cohen's d)

**Interpretation:**
- Enabled mode will ALWAYS be slower than disabled (expected)
- This measures the COST of memory, not the VALUE
- Target: <200ms P95 latency

**Example Output:**
```
context-recall:
  P50: 180ms (enabled) vs 1.2ms (disabled)
  Memory Hit Rate: 100%
```

### 2. Accuracy Benchmark (`npm run benchmark:accuracy`)

**Purpose:** Measures the real value of memory - does it improve answer quality?

**Methodology:**
- **Enabled Mode:** Store facts, then query - measure if responses contain facts
- **Disabled Mode:** Query without stored facts - measure baseline accuracy
- **Comparison:** Accuracy improvement from having memory

**Metrics:**
- Precision: % of retrieved facts that are correct
- Recall: % of stored facts that were retrieved
- F1 Score: Harmonic mean of precision and recall
- Memory Hit Rate: % of queries that found relevant memories

**Test Categories:**
1. **Factual Recall** - Can it remember specific facts?
2. **Preference Memory** - Can it remember user preferences?
3. **Temporal Context** - Can it remember dated information?
4. **Multi-hop Reasoning** - Can it chain facts together?
5. **Contradiction Detection** - Can it flag conflicting information?

**Interpretation:**
- Enabled mode should have HIGH accuracy (>80%)
- Disabled mode should have LOW accuracy (<20%)
- This measures the VALUE of memory

**Example Output:**
```
factual:
  Enabled: 87% accuracy, 100% memory hit rate
  Disabled: 0% accuracy
  Improvement: +87%
```

## Running Benchmarks

### Prerequisites

Ensure Docker services are running:
```bash
docker-compose up -d
```

### Run Latency Benchmark
```bash
npm run benchmark:real
```

Output: `benchmarks/real-world-results.md`

### Run Accuracy Benchmark
```bash
npm run benchmark:accuracy
```

Output: `benchmarks/accuracy-results.md`

### Run All Scientific Benchmarks (Unit Tests)
```bash
npm run benchmark:scientific
```

## Interpreting Results

### Latency Benchmark

| Result | Meaning |
|--------|---------|
| "Disabled Wins" | Expected - no-ops are always faster |
| P95 < 200ms | Meets performance target |
| Memory Hit Rate = 100% | Memory system working correctly |

**Key Insight:** The latency benchmark shows COST, not VALUE. A "loss" here is expected and acceptable if latency is within targets.

### Accuracy Benchmark

| Result | Meaning |
|--------|---------|
| "Enabled Wins" | Memory provides value |
| F1 > 80% | Strong memory effectiveness |
| F1 > 60% | Moderate effectiveness |
| F1 < 40% | Needs improvement |

**Key Insight:** The accuracy benchmark shows VALUE. This is where Vesper should "win" - by improving answer quality.

## Statistical Methodology

Both benchmarks use rigorous statistical methods:

### Welch's t-test
- Handles unequal variances between groups
- Tests if difference is statistically significant
- p-value < 0.05 indicates significance

### Cohen's d Effect Size
- Measures practical significance
- |d| < 0.2: Negligible
- |d| 0.2-0.5: Small
- |d| 0.5-0.8: Medium
- |d| > 0.8: Large

### Sample Size
- 10 measurement runs per condition
- 3 warmup runs to eliminate cold-start effects
- 25 total test cases for accuracy benchmark

## Benchmark Results

### Latest Results

| Benchmark | Enabled | Disabled | Improvement |
|-----------|---------|----------|-------------|
| Latency (P50) | ~160ms | ~1ms | N/A (expected) |
| Accuracy (F1) | See report | 0% | See report |

### Historical Comparison

Results are timestamped and stored in:
- `benchmarks/real-world-results.md` - Latest latency results
- `benchmarks/accuracy-results.md` - Latest accuracy results

## Configuration

Both benchmarks can be configured via environment variables:

```bash
# Infrastructure
REDIS_HOST=localhost
REDIS_PORT=6379
QDRANT_URL=http://localhost:6333
EMBEDDING_SERVICE_URL=http://localhost:8000
SQLITE_DB=./data/memory.db

# Benchmark Settings (in scripts)
WARMUP_RUNS=3
MEASUREMENT_RUNS=10
SIGNIFICANCE_LEVEL=0.05
```

## Troubleshooting

### "Bad Request" errors from Qdrant
- Ensure Qdrant collection exists: `npm run init:qdrant`
- Check that point IDs are valid UUIDs

### Low accuracy in enabled mode
- Verify embedding service is running: `curl http://localhost:8000/health`
- Check that facts are being stored: Enable debug logging

### High latency
- Check Redis connection: `docker exec vesper-redis redis-cli ping`
- Verify Qdrant is indexed: `curl http://localhost:6333/collections/memory-vectors`

## Contributing

When adding new benchmarks:
1. Follow the statistical methodology (warmup, measurement runs, significance tests)
2. Document what the benchmark measures and how to interpret results
3. Add clear pass/fail criteria
4. Generate reproducible reports

---

*For questions about benchmarks, see the main [README.md](../README.md)*
