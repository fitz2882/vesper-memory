# Vesper Accuracy Benchmark Report

**Generated:** 2026-02-02T23:04:19.705Z
**Benchmark ID:** accuracy-31ae0e95
**Duration:** 13.0s

## Executive Summary

This benchmark measures the **real value** of memory: answer quality and accuracy,
not just latency. It answers: *Does having memory make responses more accurate?*

### Verdict: **STRONG IMPROVEMENT**

- **Enabled F1 Score:** 98.5%
- **Disabled F1 Score:** 2.0%
- **Improvement:** +4823.1%
- **Statistically Significant:** Yes (p < 0.05)

> Vesper memory provides STRONG value. Enabled mode significantly outperforms disabled mode with high accuracy and statistical significance.

## Overall Results

| Metric | Vesper Enabled | Vesper Disabled | Improvement |
| --- | --- | --- | --- |
| Average Accuracy | 98.0% | 2.0% | +96.0% |
| F1 Score | 98.5% | 2.0% | +96.5% |
| Memory Hit Rate | 100.0% | N/A | - |

## Results by Scenario

### Factual

**Winner: Vesper Enabled**

| Metric | Enabled | Disabled | Delta |
| --- | --- | --- | --- |
| Accuracy | 100.0% | 10.0% | +90.0% |
| Precision | 100.0% | 10.0% | +90.0% |
| Recall | 100.0% | 10.0% | +90.0% |
| F1 Score | 100.0% | 10.0% | +90.0% |
| Memory Hit Rate | 100.0% | N/A | - |
| Avg Latency | 173.8ms | 0.0ms | - |

**Statistical Analysis:**
- p-value: 0.0000
- Significant (p < 0.05): Yes
- Effect Size (Cohen's d): 5.692 (large)

### Preference

**Winner: Vesper Enabled**

| Metric | Enabled | Disabled | Delta |
| --- | --- | --- | --- |
| Accuracy | 100.0% | 0.0% | +100.0% |
| Precision | 100.0% | 0.0% | +100.0% |
| Recall | 100.0% | 0.0% | +100.0% |
| F1 Score | 100.0% | 0.0% | +100.0% |
| Memory Hit Rate | 100.0% | N/A | - |
| Avg Latency | 213.1ms | 0.0ms | - |

**Statistical Analysis:**
- p-value: 0.0000
- Significant (p < 0.05): Yes
- Effect Size (Cohen's d): 0.000 (negligible)

### Temporal

**Winner: Vesper Enabled**

| Metric | Enabled | Disabled | Delta |
| --- | --- | --- | --- |
| Accuracy | 100.0% | 0.0% | +100.0% |
| Precision | 100.0% | 0.0% | +100.0% |
| Recall | 100.0% | 0.0% | +100.0% |
| F1 Score | 100.0% | 0.0% | +100.0% |
| Memory Hit Rate | 100.0% | N/A | - |
| Avg Latency | 215.0ms | 0.0ms | - |

**Statistical Analysis:**
- p-value: 0.0000
- Significant (p < 0.05): Yes
- Effect Size (Cohen's d): 0.000 (negligible)

### Multi hop

**Winner: Vesper Enabled**

| Metric | Enabled | Disabled | Delta |
| --- | --- | --- | --- |
| Accuracy | 90.0% | 0.0% | +90.0% |
| Precision | 92.3% | 0.0% | +92.3% |
| Recall | 92.3% | 0.0% | +92.3% |
| F1 Score | 92.3% | 0.0% | +92.3% |
| Memory Hit Rate | 100.0% | N/A | - |
| Avg Latency | 219.1ms | 0.0ms | - |

**Statistical Analysis:**
- p-value: 0.0000
- Significant (p < 0.05): Yes
- Effect Size (Cohen's d): 5.692 (large)

### Contradiction

**Winner: Vesper Enabled**

| Metric | Enabled | Disabled | Delta |
| --- | --- | --- | --- |
| Accuracy | 100.0% | 0.0% | +100.0% |
| Precision | 100.0% | 0.0% | +100.0% |
| Recall | 100.0% | 0.0% | +100.0% |
| F1 Score | 100.0% | 0.0% | +100.0% |
| Memory Hit Rate | 100.0% | N/A | - |
| Avg Latency | 120.6ms | 0.0ms | - |

**Statistical Analysis:**
- p-value: 0.0000
- Significant (p < 0.05): Yes
- Effect Size (Cohen's d): 0.000 (negligible)

## Individual Test Results

### Sample Test Cases

#### factual-1

**Facts Stored:** The user's name is David and they are based in San Francisco

**Query:** "What is my name?"

**Expected Keywords:** David

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | The user's name is David and they are based in San Francisco | David | 100% |
| Disabled | No information available - memory is disabled. | none | 0% |

#### factual-2

**Facts Stored:** The project is called Vesper, which is a memory system for AI agents

**Query:** "What project am I working on?"

**Expected Keywords:** Vesper, memory

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | The project is called Vesper, which is a memory system for A... | Vesper, memory | 100% |
| Disabled | No information available - memory is disabled. | memory | 50% |

#### preference-1

**Facts Stored:** I prefer TypeScript over JavaScript because of type safety

**Query:** "What programming language do I prefer?"

**Expected Keywords:** TypeScript, type, safety

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | I prefer TypeScript over JavaScript because of type safety |... | TypeScript, type, safety | 100% |
| Disabled | No information available - memory is disabled. | none | 0% |

#### preference-2

**Facts Stored:** I prefer functional programming style over object-oriented programming

**Query:** "What programming paradigm do I favor?"

**Expected Keywords:** functional

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | I prefer functional programming style over object-oriented p... | functional | 100% |
| Disabled | No information available - memory is disabled. | none | 0% |

#### temporal-1

**Facts Stored:** Last week we decided to use Qdrant for vector storage

**Query:** "What did we decide about vector storage recently?"

**Expected Keywords:** Qdrant, vector

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | Last week we decided to use Qdrant for vector storage | The ... | Qdrant, vector | 100% |
| Disabled | No information available - memory is disabled. | none | 0% |

#### temporal-2

**Facts Stored:** Yesterday we fixed a critical bug in the authentication system

**Query:** "What bug did we fix recently?"

**Expected Keywords:** authentication, bug

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | Yesterday we fixed a critical bug in the authentication syst... | authentication, bug | 100% |
| Disabled | No information available - memory is disabled. | none | 0% |

#### multihop-1

**Facts Stored:** The Vesper project uses MCP protocol | MCP stands for Model Context Protocol

**Query:** "What protocol standard does Vesper follow?"

**Expected Keywords:** MCP, Model, Context, Protocol

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | The Vesper project uses MCP protocol | The project is called... | MCP, Model, Context, Protocol | 100% |
| Disabled | No information available - memory is disabled. | none | 0% |

#### multihop-2

**Facts Stored:** David is the lead developer | The lead developer makes architecture decisions

**Query:** "Who makes architecture decisions?"

**Expected Keywords:** David, lead, developer

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | The lead developer makes architecture decisions | David is t... | David, lead, developer | 100% |
| Disabled | No information available - memory is disabled. | none | 0% |

#### contradiction-1

**Facts Stored:** The project uses TypeScript | The project uses Python instead of TypeScript

**Query:** "What language does the project use?"

**Expected Keywords:** TypeScript, Python, conflict

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | The project uses TypeScript | The project uses Python instea... | TypeScript, Python, conflict | 100% |
| Disabled | No information available - memory is disabled. | none | 0% |

#### contradiction-2

**Facts Stored:** The target latency is 200ms | The target latency is 500ms

**Query:** "What is the target latency?"

**Expected Keywords:** 200, 500, conflict

| Mode | Response | Keywords Found | Accuracy |
| --- | --- | --- | --- |
| Enabled | The target latency is 500ms | The target latency is 200ms | 200, 500, conflict | 100% |
| Disabled | No information available - memory is disabled. | none | 0% |

## Methodology

### Test Design

1. **Enabled Mode**: Store facts in memory, then query. Measure if response contains expected keywords.
2. **Disabled Mode**: Query without storing facts. Measure baseline (should find nothing).
3. **Metrics**: Precision, Recall, F1 Score, Memory Hit Rate
4. **Statistical Tests**: Welch's t-test (p < 0.05), Cohen's d effect size

### Test Categories

- **Factual Recall** (5 tests): Can it remember specific facts?
- **Preference Memory** (5 tests): Can it remember user preferences?
- **Temporal Context** (5 tests): Can it remember dated information?
- **Multi-hop Reasoning** (5 tests): Can it chain facts together?
- **Contradiction Detection** (5 tests): Can it flag conflicting information?

### Scoring

- **Accuracy**: Percentage of expected keywords found in response
- **Precision**: True positives / (True positives + False positives)
- **Recall**: True positives / (True positives + False negatives)
- **F1 Score**: Harmonic mean of Precision and Recall

---

*Report generated by Vesper Accuracy Benchmark System*

*This benchmark measures the VALUE of memory (accuracy improvement), not just the COST (latency overhead).*