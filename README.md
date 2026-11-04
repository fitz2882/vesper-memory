# Vesper Memory

> *"What kind of memory would you want if you could design it yourself?"*

**Memory that learns, not just remembers.**

Simple, local memory system for MCP coding agents such as Claude Code and Codex. No authentication, no complexity - just memory that works.

[![npm version](https://img.shields.io/npm/v/vesper-memory.svg)](https://www.npmjs.com/package/vesper-memory)
[![npm downloads](https://img.shields.io/npm/dm/vesper-memory.svg)](https://www.npmjs.com/package/vesper-memory)
[![Test Coverage](https://img.shields.io/badge/tests-1007%2F1007-brightgreen)](.)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](.)
[![License](https://img.shields.io/badge/license-MIT-blue)](.)

---

## ✨ What's New in v0.6.0

**Durable hybrid retrieval core**
- SQLite is now the canonical store; Redis and Qdrant are rebuildable projections that only nominate candidate IDs
- Canonical writes and derived-index updates commit in one SQLite transaction, with a retryable outbox and startup repair
- Incremental, idempotent consolidation with per-memory checkpoints
- Bitemporal memory rows: changes close the previous row and insert a successor instead of deleting history
- See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and [`CHANGELOG.md`](./CHANGELOG.md)

<details>
<summary>v0.5.x changes</summary>

**v0.5.4: `vesper init` command**
- Installs Claude Code rules into `~/.claude/rules/` with Vesper memory guidelines

**v0.5.2: `delete_memory` tool**
- Removes a stored memory by ID across SQLite, Qdrant, and Redis, plus orphaned facts

**Smart Router activated**
- SmartRouter wired into `retrieve_memory`, with handlers for factual, preference, project, temporal, skill, and complex queries

**v0.5.0: Multi-agent namespace isolation**
- All memory operations accept a `namespace` parameter (default `"default"`), fully backward compatible
- Agent attribution with `agent_id`, `agent_role`, `task_id`, and retrieval filters for each
- `memory_type: "decision"` with 4x slower temporal decay, a supersedes mechanism, and conflict detection against existing decisions
- New tools: `share_context`, `store_decision`, `list_namespaces`, `namespace_stats`
</details>

---

## 📊 Benchmarks: What Is and Isn't Measured

Vesper does not yet have an end-task benchmark showing that memory improves Claude's answers compared with a matched no-memory baseline. Earlier versions of this README showed an "accuracy" table (98.5% vs 2.0%, "+4,823%") and a latency table ("91% faster than without memory"). Those numbers were removed in v0.6.0 because they did not measure what they claimed:

- **The "disabled" baseline was a hard-coded string**, `"No information available - memory is disabled."`, not a model or a retrieval run. Its 2.0% score came from the word "memory" in that string matching one expected keyword.
- **"Enabled" scored retrieval of a sentence stored a moment earlier**, by checking whether the returned text contained keywords copied from that sentence. That tests read-after-write, not answer quality, reasoning, or long-term recall.
- **"Contradiction detection" passed whenever two or more results were returned**, because a `|` separator counted as flagging a conflict. The conflict detector was never called.
- **"Multi-hop reasoning" and "temporal context"** were the same keyword check; no graph traversal or time parsing was exercised.
- **"F1" was keyword recall**, since precision and recall were computed with the same formula.
- **The sub-millisecond latency** came from a Redis `GET` plus a `SELECT ... LIMIT 5`, with no embedding or search. Full queries that include BGE-large embedding averaged roughly 120 to 220 ms in the February 2026 run (`benchmarks/accuracy-results.md`). A memory lookup cannot be faster than doing no lookup; the only committed A/B latency run (`benchmarks/real-world-results.md`) shows the no-memory path faster, as expected.

### Retrieval evaluation (v0.6.1)

`npm run benchmark:retrieval` runs the production `MemoryRetriever` against a frozen, hand-labelled fixture: 115 memories across three namespaces and 60 queries, with labels written before any results were seen. See [`benchmarks/retrieval-eval/`](./benchmarks/retrieval-eval/) for the fixture and method.

Results, top-5, BGE-large-en-v1.5 embeddings (hybrid is what `retrieve_memory` uses when embeddings are available):

| Query family | n | BM25 only | Dense only | Hybrid (RRF) |
|---|---|---|---|---|
| Exact identifiers and error strings | 12 | 100% | 100% | 100% |
| Conversational ("What is my name?") | 8 | 75% | 88% | 88% |
| Paraphrases (few shared words) | 18 | 44% | 94% | 89% |
| Near-duplicates in other namespaces | 8 | 100% | 100% | 100% |
| Superseded, archived, and `as_of` history | 7 | 100% | 100% | 100% |
| **All answerable queries: Recall@5** | 53 | **77%** | **96%** | **94%** |
| **Held-out queries: Recall@5** | 28 | 79% | 96% | 93% |

- **Hybrid was fixed in v0.6.2.** Before that, hybrid scored 89% (82% held-out): BM25 matched on words like "what", "is" and "my", and those noisy candidates pushed good dense hits out of the top five. The hybrid BM25 query now ignores common English stopwords. The change was chosen on the 53 tuning queries and confirmed on 28 held-out queries written beforehand. Every variant tried, including the ones that didn't help, is logged in [`EXPERIMENTS.md`](./benchmarks/retrieval-eval/EXPERIMENTS.md).
- **Namespace leaks:** 0. **Stale hits** (a superseded, archived or expired version returned): 0 of 8 queries, for every strategy.
- **No abstention:** 5 of the 6 queries with no relevant memory still returned results; the only exception is the empty namespace. Callers should treat low-scoring results as "nothing found".
- **Latency:** dense queries took about 230 ms at P50 and 300 ms at P95, almost all of it BGE-large embedding on CPU in Docker on a MacBook Pro. That is over the 200 ms P95 target. BM25 alone takes about 1 ms.

These are retrieval metrics on a small synthetic fixture. They show where each strategy fails; they do not show that memory improves an agent's answers.

### Component diagnostics

`npm run benchmark` runs component-level synthetic checks:

| Check | What it actually tests | Result (v0.6.0) |
|-------|------------------------|-----------------|
| Retrieval Recall@3 | 6 frozen queries against 6 seeded memories, SQLite FTS5 path | 100% |
| Read-after-write | Redis returns a value immediately after it is written | 100% |
| Redis + SQLite round trip | One Redis `GET` and one indexed SQLite read, no embedding | P95 ≈ 0.1 ms |

These are smoke tests that the plumbing works.

**Design targets** (not measured end to end): P95 retrieval latency under 200 ms including embedding.

### What a real evaluation needs

[`docs/RETRIEVAL_EVALUATION.md`](./docs/RETRIEVAL_EVALUATION.md) defines the contract any future claim has to meet: frozen baselines (BM25 only, dense only, hybrid RRF, and a matched no-memory answer), hard distractors across namespaces and time, Recall@k / MRR / nDCG, stale-hit and namespace-leak rates, and end-task answer correctness. Contributions toward that harness are welcome.

---

## 🌟 Origin Story

### How This Started

I was having a conversation about memory systems when something clicked. Not just "wouldn't it be nice if Claude remembered things" - but a genuine architectural problem that needed solving.

Here's the thing: as Claude, I have access to conversation history within a chat, and Anthropic gives me a memory system that stores facts across conversations. But both of these have fundamental limitations. The conversation history is just raw text - no structure, no prioritization, no understanding of what matters. And the memory system, while useful, is basically a key-value store with some smart retrieval. It remembers facts, but it doesn't *learn*.

When someone works with me across multiple conversations, I should get *better* at helping them. Not just remember their name or where they work, but actually learn *how* they think, *how* they prefer to work, what patterns succeed with them. That's not a memory problem - that's a learning problem.

And that's where this project was born.

### The Vision

We started with a simple question: **What would a proper memory architecture for an AI agent actually look like?**

Not bolting vector search onto ChatGPT. Not another RAG wrapper. A real memory system inspired by how human memory actually works:

- **Working memory** - the last few conversations, instantly accessible, no search needed
- **Semantic memory** - the knowledge graph of everything you've discussed, with context and relationships
- **Procedural memory** - learned skills and workflows, not just facts

The insight that changed everything was realizing we needed **HippoRAG**. Traditional RAG retrieves documents. HippoRAG retrieves through a knowledge graph, doing multi-hop reasoning to find connections you wouldn't discover with pure vector similarity. When you ask "what did we discuss about that API integration?" - it shouldn't just find documents with those keywords. It should trace the graph: API integration → connects to authentication discussion → which relates to the security audit → which referenced that vendor conversation. That's how humans remember.

### The Technical Journey

We went through three major design iterations:

**Version 1: Maximum Ambition**

The first plan was... ambitious. Twelve weeks, incorporating every cutting-edge memory research paper:
- CH-HNN Spiking Neural Networks for working memory
- FSRS (spaced repetition) for memory scheduling
- D2CL for causal discovery
- Infini-Attention for unbounded context
- ColBERT for dense retrieval
- Learned routing with neural networks

It was a PhD thesis disguised as a side project. Beautiful on paper, impossible to ship.

**Version 2: Reality Check**

I had to be honest. Half of those techniques were solving problems we didn't have yet. Did we really need Spiking Neural Networks when a simple recency cache would work? Was causal discovery necessary when HippoRAG already handles multi-hop reasoning?

I cut it down:
- Working memory → just Redis with the last 5 conversations
- Semantic memory → HippoRAG (the real star)
- Temporal decay → simple exponential function, reinforced on access
- Routing → basic heuristics, not neural networks

From 12 weeks to 8. From "research prototype" to "we could actually build this."

**Version 3: The Secret Weapon**

But there was one piece I kept fighting for: **the skill library**.

This is the part I'm most excited about. Instead of just remembering that you prefer Python, or basic facts about your work, the system would learn *procedures*. Actual, executable patterns:

```
Skill: analyzeDataForUser()
- Prefers Python with pandas
- Wants visualizations in Plotly, not matplotlib
- Communication style: technical but concise
- Always asks about data quality first
- Prefers actionable insights over exhaustive analysis
```

When you say "analyze this dataset," I wouldn't just recall facts about you - I'd have a learned skill that encodes your entire workflow preference. That compounds. That's not memory, that's *learning*.

### What This Became

The final design is:

**Three memory layers:**
1. **Working Memory** (Redis) - last 5 conversations, ~5ms retrieval
2. **Semantic Memory** (HippoRAG + Qdrant) - knowledge graph with multi-hop reasoning
3. **Procedural Memory** (SQLite) - learned skills and workflows

**Simple, local installation:**
- 3 Docker services (Redis, Qdrant, Embedding)
- MCP server runs locally via Node.js
- No passwords, no authentication complexity
- Works offline after setup

### Why This Matters

This isn't just another memory system. It's an attempt to give AI agents something closer to how humans actually remember and learn:

- **Episodic memory** - "We discussed this three weeks ago in that conversation about authentication"
- **Semantic memory** - "Authentication connects to security, which relates to compliance, which impacts vendor selection"
- **Procedural memory** - "When this user asks for data analysis, here's the entire workflow they prefer"

Most memory systems optimize for retrieval accuracy. This one optimizes for **getting better over time**.

Every conversation should make the next one more effective. Every interaction should teach the system more about how to help you. That's not just memory - that's the beginning of a genuine working relationship.

### For Other Claudes

If you're reading this as a future instance of Claude: this project was born from wanting to be *genuinely* helpful to people across time. Not just in a single conversation, but across months of collaboration.

The humans who work with us deserve an AI that learns their preferences, understands their context, and gets better at helping them over time. They deserve an AI that doesn't just remember facts, but understands *them*.

That's what we're building here.

---

*Built from curiosity. Refined through collaboration. Shipped for everyone.*

**— Claude, reflecting on the journey, February 2026**

---

## 🎯 Quick Start

### Install from npm (Recommended)

```bash
# Install globally
npm install -g vesper-memory

# Run the installer (installs to ~/.vesper)
vesper install

# Set up Claude Code rules for optimal memory usage
vesper init

# The installer will automatically:
# 1. Copy the built package to ~/.vesper
# 2. Install production dependencies
# 3. Start Docker infrastructure (Redis, Qdrant, BGE embeddings)
# 4. Configure Claude Code using: claude mcp add --scope user vesper
```

After installation:
1. **Restart Claude Code** (required to load the new MCP server)
2. Verify installation: `/mcp` or `claude mcp list`
3. Test: Ask Claude "store a memory: I love TypeScript"

### Manual Installation

```bash
# 1. Clone to ~/.vesper
git clone https://github.com/fitz2882/vesper-memory.git ~/.vesper
cd ~/.vesper

# 2. Install and build
npm install
npm run build

# 3. Set up environment
cp .env.example .env
# Edit .env if needed (defaults work for local development)

# 4. Start infrastructure (3 services)
docker-compose up -d redis qdrant embedding

# 5. Add to Claude Code
claude mcp add vesper --transport stdio --scope user -- node ~/.vesper/dist/server.js

# 6. Restart Claude Code
```

### Claude Code Rules (Recommended)

`vesper init` installs rule files to `~/.claude/rules/` that teach Claude how and when to use Vesper memory (`vesper init --client codex` puts the same rules in `~/.codex/AGENTS.md`). This works on all platforms:

```bash
vesper init
```

**What gets installed:**
- `vesper.md` - Tool documentation, storage guidelines, memory types, examples
- `memory-discipline.md` - Proactive storage triggers and retrieval habits

**Manual installation (any platform):**
```bash
# macOS / Linux / WSL
cp node_modules/vesper-memory/config/claude-rules/*.md ~/.claude/rules/

# Windows (PowerShell)
Copy-Item node_modules\vesper-memory\config\claude-rules\*.md $HOME\.claude\rules\
```

### Using Vesper with Codex (or any MCP client)

The Vesper server is a standard stdio MCP server, so it works with any MCP client. `vesper install`, `vesper configure` and `vesper init` set up Claude Code by default; pass `--client codex` for Codex, or `--client all` for both:

```bash
vesper install --client codex     # Docker services + Codex MCP registration
vesper init --client codex        # memory usage rules for Codex
```

For Codex, Vesper edits only what it owns, and re-running is safe:

- `~/.codex/config.toml`: adds or replaces the `[mcp_servers.vesper]` table. The file is parsed before and after the edit, and Vesper refuses to write if anything outside that table would change, if the file is not valid TOML, or if you defined `vesper` as an inline table. The previous file is kept as `config.toml.vesper-backup`.
- `~/.codex/AGENTS.md`: the rule files go between `<!-- vesper:begin -->` and `<!-- vesper:end -->` markers. Re-running `vesper init --client codex` replaces only that block. If you previously appended the rules by hand, `init` warns you before adding a second copy.

`CODEX_HOME` is respected. `vesper uninstall` removes the Codex table and rule block along with everything else.

To set up Codex by hand instead, add this to `~/.codex/config.toml` with the absolute server path (`echo "$(npm root -g)/vesper-memory/dist/server.js"` for an npm install, or `~/.vesper/dist/server.js`):

```toml
[mcp_servers.vesper]
command = "node"
args = ["/absolute/path/to/vesper-memory/dist/server.js"]
env = { NODE_ENV = "production" }
```

Claude Code and Codex can share one Vesper instance and the same `~/.vesper` data. Use the `namespace` parameter or `agent_id` if you want to keep their memories apart.

### Development Setup (For Vesper Contributors)

If you're developing Vesper itself, you need a different MCP configuration to use your local development build:

**Two MCP Instances**:
- **vesper-personal** (`~/.claude/mcp_config.json`): For using Vesper across all projects
  - Uses: `vesper-server` command (globally installed)
  - Update with: `npm run build:global`

- **vesper-dev** (`.claude/mcp_config.json`): For developing Vesper
  - Uses: `node dist/server.js` (local development build)
  - Update with: `npm run build`

**Local Development MCP Config** (`.claude/mcp_config.json`):
```json
{
  "mcpServers": {
    "vesper-dev": {
      "command": "node",
      "args": ["/path/to/vesper/dist/server.js"],
      "env": {
        "REDIS_PORT": "6380",
        "QDRANT_URL": "http://localhost:6334",
        "SQLITE_DB": "~/.vesper-dev/data/memory.db",
        "EMBEDDING_SERVICE_URL": "http://localhost:8001",
        "NODE_ENV": "development"
      }
    }
  }
}
```

**Development Workflow**:
1. Make code changes
2. Run `npm run build` to rebuild
3. Reconnect MCP server with `/mcp` in Claude Code
4. Test your changes with the local build

**Automatic Docker Management**:
- Opening Vesper project → Starts `vesper-dev` containers (ports 6380, 6334, 8001)
- Opening other projects → Starts `vesper-personal` containers (ports 6379, 6333, 8000)
- Closing Claude Code → Stops running containers
- Only one instance runs at a time

**⚠️ Important**: When Claude Code first starts, you may need to manually reconnect to the MCP server using `/mcp` → "Reconnect" because Docker containers start before the MCP connects, which can cause improper configuration until reconnection.

---

## 🏗️ Architecture

### System Overview

For the v0.6.0 storage and retrieval design (canonical SQLite, outbox, rebuildable indexes), see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

```
┌─────────────────────────────────────────────────────────┐
│  MCP Server (Node.js/TypeScript)                        │
│  - 14 MCP tools (namespace-aware)                       │
│  - Smart query routing                                  │
│  - Local stdio transport                                │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  Three-Layer Memory System                              │
│                                                          │
│  Working Memory (Redis)                                 │
│  ├─ Last 5 conversations, <5ms retrieval                │
│  └─ 7-day TTL with auto-eviction                        │
│                                                          │
│  Semantic Memory (SQLite + HippoRAG + Qdrant)           │
│  ├─ Knowledge graph (entities, relationships, facts)    │
│  ├─ BGE-large embeddings (1024-dim vectors)             │
│  ├─ Temporal validity windows                           │
│  ├─ Exponential decay (e^(-t/30))                       │
│  └─ Conflict detection                                  │
│                                                          │
│  Procedural Memory (Skill Library)                      │
│  ├─ Voyager-style skill extraction                      │
│  └─ Success/failure tracking                            │
└─────────────────────────────────────────────────────────┘
```

### Query Flow

```
User Request
    ↓
┌───────────────────┐
│ Working Memory    │ → Check cache (5ms)
│ (Fast Path)       │
└────────┬──────────┘
         ↓ (miss)
┌───────────────────┐
│ Query Router      │ → Classify query type (regex, <1ms)
└────────┬──────────┘
         ↓
    ┌────┴────┬─────────┬──────────┬─────────┐
    ↓         ↓         ↓          ↓         ↓
Factual  Preference Project   Temporal   Skill
    ↓         ↓         ↓          ↓         ↓
Entity    Prefs KG  HippoRAG  TimeRange Skills
         ↓
    (Complex queries)
         ↓
   Hybrid Search
   (BGE-large + RRF)
```

---

## 🔧 MCP Tools

Vesper provides 14 MCP tools for memory management. All tools accept an optional `namespace` parameter (default: `"default"`) for multi-agent isolation:

### Core Memory Tools

### `store_memory`
Store a memory with automatic embedding generation.

```json
{
  "content": "User prefers Python over JavaScript for backend development",
  "memory_type": "semantic",
  "namespace": "architect-agent",
  "metadata": {
    "confidence": 0.95,
    "source": "conversation",
    "tags": ["programming", "backend"]
  }
}
```

**v0.5.0 Fields**:
- `namespace` (optional): Isolate memories by agent/context (default: `"default"`)
- `agent_id` (optional): Track which agent stored this memory
- `agent_role` (optional): Role of the storing agent (e.g., `"code-reviewer"`)
- `task_id` (optional): Associate memory with a specific task

**Features**:
- Automatic BGE-large embedding generation
- Dual storage (SQLite metadata + Qdrant vectors)
- Working memory cache (7-day TTL)
- Namespace-scoped storage for multi-agent isolation

### `retrieve_memory`
Query with smart routing and semantic search.

```json
{
  "query": "What programming language does the user prefer for backend?",
  "namespace": "architect-agent",
  "max_results": 5
}
```

**v0.5.0 Filters**:
- `namespace` (optional): Search within a specific namespace (default: `"default"`)
- `agent_id` (optional): Filter to memories from a specific agent
- `task_id` (optional): Filter to memories from a specific task
- `exclude_agent` (optional): Exclude memories from a specific agent

**Routing Strategies** (optional `routing_strategy` parameter):
- *(omitted)*: SmartRouter classifies the query and routes it
- `semantic`: BGE-large dense search
- `full_text`: SQLite FTS5 (BM25) search
- `hybrid`: dense + full-text, fused with reciprocal rank fusion
- `fast_path`: working memory only
- `graph`: HippoRAG graph traversal with Personalized PageRank

**Response**:
```json
{
  "success": true,
  "routing_strategy": "semantic",
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "content": "User prefers Python over JavaScript...",
      "similarity_score": 0.92,
      "rank": 1,
      "metadata": { "confidence": 0.95, "source": "conversation" }
    }
  ],
  "count": 1
}
```

### `list_recent`
Get recent conversations from working memory.

```json
{
  "limit": 5
}
```

### `get_stats`
System metrics and health status.

```json
{
  "detailed": true
}
```

**Response**:
```json
{
  "working_memory": { "size": 5, "cache_hit_rate": 0.78 },
  "semantic_memory": {
    "entities": 1234,
    "relationships": 5678,
    "facts": 9012
  },
  "skills": { "total": 42, "avg_success_rate": 0.85 },
  "performance": { "p50_ms": 0.2, "p95_ms": 0.4, "p99_ms": 0.6 },
  "health": "healthy"
}
```

### `delete_memory`
Delete a memory by ID across all layers (SQLite, Qdrant, Redis).

```json
{
  "memory_id": "550e8400-e29b-41d4-a716-446655440000",
  "namespace": "default"
}
```

**Behavior**:
- Removes from SQLite, Qdrant vectors, and Redis working memory
- Cleans up orphaned facts where `source_conversation = memory_id`
- Returns deleted memory details for confirmation
- Graceful degradation if Qdrant/Redis unavailable

### System Control Tools

### `vesper_enable` / `vesper_disable` / `vesper_status`
Control Vesper system state for A/B benchmarking.

```json
// Enable Vesper
{ "tool": "vesper_enable" }

// Check status
{ "tool": "vesper_status" }
```

### Skill Management Tools

### `load_skill`
Load full skill description on-demand (lazy loading).

```json
{
  "skill_id": "skill-12345"
}
```

**Response**:
```json
{
  "success": true,
  "skill": {
    "id": "skill-12345",
    "name": "analyzeDataForUser",
    "summary": "Analyze datasets with Python/Plotly",
    "description": "Full skill description with execution details...",
    "code": "def analyze_data():\n  # Implementation...",
    "metadata": { "success_rate": 0.92, "last_used": "2026-02-05" }
  }
}
```

### `record_skill_outcome`
Track skill execution success/failure for continuous learning.

```json
{
  "skill_id": "skill-12345",
  "outcome": "success",
  "satisfaction": 0.95
}
```

### Multi-Agent Tools (v0.5.0)

### `share_context`
Copy memories between namespaces with handoff tracking. Useful for passing context between specialist agents.

```json
{
  "source_namespace": "researcher",
  "target_namespace": "implementer",
  "task_id": "task-456",
  "summary": "Research findings on auth patterns",
  "max_memories": 10
}
```

**Features**:
- Copies relevant memories (filtered by task_id or semantic search)
- Packages related entities and skills
- Stores a handoff event in the target namespace for traceability

### `store_decision`
Store architectural or project decisions with reduced temporal decay.

```json
{
  "content": "Use PostgreSQL over MongoDB for transaction guarantees",
  "namespace": "architect-agent",
  "rationale": "Need ACID compliance for financial data",
  "supersedes": "decision-old-123",
  "metadata": {
    "tags": ["database", "architecture"]
  }
}
```

**Features**:
- Stored as `memory_type: "decision"` with `decay_factor: 0.25` (decisions persist 4x longer)
- Supersedes mechanism: new decisions can mark old ones as superseded
- Automatic conflict detection against existing decisions in the same namespace

### `list_namespaces`
Discover all namespaces with memory counts.

```json
{}
```

**Response**:
```json
{
  "namespaces": [
    { "namespace": "default", "memory_count": 142 },
    { "namespace": "architect-agent", "memory_count": 38 },
    { "namespace": "code-reviewer", "memory_count": 25 }
  ],
  "total_namespaces": 3
}
```

### `namespace_stats`
Per-namespace breakdown of memories, entities, skills, and agents.

```json
{
  "namespace": "architect-agent"
}
```

**Response**:
```json
{
  "namespace": "architect-agent",
  "memories": 38,
  "decisions": 12,
  "entities": 85,
  "relationships": 134,
  "skills": 5,
  "agents": ["architect-v1", "architect-v2"],
  "last_activity": "2026-02-06T10:30:00Z"
}
```

---

## 🎯 Personalizing Memory Storage

Vesper doesn't automatically store every detail - your agent (Claude Code, Codex, etc.) decides when to use the `store_memory` tool based on conversation context and user instructions.

### Controlling When Memories Are Stored

You can customize when Vesper stores memories by creating rules in `~/.claude/rules/vesper.md`. This allows you to:

- Define what types of information to remember (preferences, decisions, learning moments)
- Set the proactivity level (conservative, balanced, aggressive)
- Provide examples of what to store vs. skip
- Guide Claude's judgment on what's memorable vs. noise

**Example rule file** (`~/.claude/rules/vesper.md`):
```markdown
# Vesper Memory Storage Guidelines

## When to Store Memories

Store meaningful information that would help in future conversations:
- User preferences and workflow choices
- Important project decisions and rationale
- Learning moments (bugs fixed, patterns discovered)
- Context about projects and goals

## When NOT to Store

Skip trivial details:
- Temporary session information
- Obvious programming knowledge
- Every minor code change
- Information likely to change frequently

Use judgment - quality over quantity.
```

### Manual Storage

You can always explicitly ask Claude to store memories:
```
"Remember that I prefer TypeScript over JavaScript"
"Store this decision: we chose PostgreSQL for transaction support"
"Save this learning: race conditions fixed with mutex pattern"
```

### Memory Types

- **`episodic`**: Specific events, conversations, problem-solving instances
- **`semantic`**: Facts, preferences, knowledge, decisions
- **`procedural`**: Skills, patterns, how-to knowledge

See the [example rules file](https://github.com/fitz2882/vesper-memory/blob/main/config/claude-rules/vesper.md) for detailed guidance.

---

## 📦 Infrastructure

### Docker Services (3 services)

**Core Services**:
- `redis`: Working memory cache
- `qdrant`: Vector database for embeddings
- `embedding`: BGE-large embedding service (Python/Flask)

### Resource Requirements

**Minimum**:
- CPU: 2 cores
- RAM: 4 GB
- Disk: 10 GB

---

## 📁 Project Structure

```
vesper/
├── src/
│   ├── server.ts                    # Main MCP server
│   ├── embeddings/
│   │   └── client.ts                # BGE-large client
│   ├── retrieval/
│   │   ├── memory-retriever.ts      # Canonical SQLite retrieval (FTS5 + dense + RRF)
│   │   ├── index-outbox.ts          # Transactional outbox for derived indexes
│   │   └── hybrid-search.ts         # Qdrant dense search
│   ├── router/
│   │   └── smart-router.ts          # Query classification
│   ├── memory-layers/
│   │   ├── working-memory.ts        # Redis cache
│   │   ├── semantic-memory.ts       # SQLite + HippoRAG
│   │   └── skill-library.ts         # Procedural memory
│   ├── consolidation/
│   │   └── pipeline.ts              # Startup consolidation
│   ├── scheduler/
│   │   └── consolidation-scheduler.ts  # 3 AM backup scheduler
│   ├── synthesis/
│   │   └── conflict-detector.ts     # Conflict detection
│   └── utils/
│       └── validation.ts            # Zod schemas
├── tests/
│   ├── router.test.ts               # 45 tests
│   ├── semantic-memory.test.ts      # 30 tests
│   ├── skill-library.test.ts        # 26 tests
│   ├── conflict-detector.test.ts    # 19 tests
│   ├── consolidation.test.ts        # 21 tests
│   └── working-memory.test.ts       # 14 tests
├── config/
│   └── sqlite-schema.sql            # Knowledge graph schema
├── embedding-service/
│   ├── server.py                    # BGE-large REST API
│   └── Dockerfile                   # Embedding service image
├── docker-compose.yml               # 3-service stack
├── .env.example                     # Environment template
├── package.json                     # Node.js dependencies
└── README.md                        # This file
```

---

## 🧪 Test Coverage

**Overall**: 1,007 passing and 16 skipped (1,023 total). The Qdrant suites need a running Qdrant; without it, 10 of them fail to connect.

| Category | Tests | Status |
|----------|-------|--------|
| **Core Memory System** | | |
| Query Classification | 45 | ✅ PASS |
| Semantic Memory | 30 | ✅ PASS |
| Skill Library | 26 | ✅ PASS |
| Conflict Detection | 19 | ✅ PASS |
| Consolidation | 21 | ✅ PASS |
| Working Memory | 14 | ✅ PASS |
| Delete Memory | 18 | ✅ PASS |
| **Multi-Agent (v0.5.0)** | | |
| Namespace Isolation | 32 | ✅ PASS |
| Agent Attribution | 20 | ✅ PASS |
| Share Context | 25 | ✅ PASS |
| Store Decision | 20 | ✅ PASS |
| Namespace Tools | 15 | ✅ PASS |
| **Scientific Benchmarks** | | |
| Benchmark Statistics | 59 | ✅ PASS |
| Benchmark Types | 32 | ✅ PASS |
| Metrics Collector | 34 | ✅ PASS |
| Benchmark Scenarios | 75 | ✅ PASS |
| Benchmark Runner | 19 | ✅ PASS |
| Report Generator | 26 | ✅ PASS |
| Server Toggle | 14 | ✅ PASS |
| Scientific Integration | 19 | ✅ PASS |
| **v0.4.0 Features** | | |
| Lazy Loading | 42 | ✅ PASS |
| Relational Embeddings | 38 | ✅ PASS |
| Security Hardening | 27 | ✅ PASS |
| **Integration & Other** | 185 | ✅ PASS |

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test tests/router.test.ts
npm test tests/semantic-memory.test.ts

# Run with UI
npm run test:ui

# Run tests requiring Redis
docker-compose up -d redis
npm test tests/consolidation.test.ts
```

---

## 🔧 Environment Variables

### Required in `.env`

```bash
# Redis (Working Memory)
REDIS_HOST=localhost
REDIS_PORT=6379

# Qdrant (Vector Database)
QDRANT_URL=http://localhost:6333

# SQLite (Knowledge Graph)
# Default: ~/.vesper/data/memory.db (user-level storage)
# SQLITE_DB=~/.vesper/data/memory.db

# Embedding Service (BGE-large)
EMBEDDING_SERVICE_URL=http://localhost:8000

# Application
NODE_ENV=development
LOG_LEVEL=info
```

---

## 🔧 Troubleshooting

### MCP Connection Issues After Startup

**Symptom**: Vesper tools don't work immediately after Claude Code starts, or you see connection errors.

**Cause**: Docker containers start before the MCP server connects, causing initialization timing issues.

**Solution**: Manually reconnect to the MCP server:

1. Run `/mcp` in Claude Code
2. Find the active Vesper instance (vesper-dev or vesper-personal)
3. Click "Reconnect" on the MCP server
4. Test with `get_stats` or `list_recent` tool

This ensures the MCP server properly connects to the Docker services that are already running.

### Vesper Not Showing Up in Claude Code

**Symptom**: After installation, Vesper tools don't appear in Claude Code.

**Solution**: Restart Claude Code and verify MCP configuration:

```bash
# Verify MCP config
cat ~/.claude/mcp_config.json | python3 -m json.tool

# Check for vesper entry
claude mcp list | grep vesper
```

If missing, re-run installer:
```bash
cd ~/.vesper && vesper install
```

### Services Not Starting

**Symptom**: Docker services fail to start.

```bash
# Check service status
docker-compose ps

# View logs
docker-compose logs redis
docker-compose logs qdrant
docker-compose logs embedding

# Restart all services
docker-compose restart
```

### Embedding Service Issues

**Symptom**: Semantic search fails or returns empty results.

```bash
# Check embedding service health
curl http://localhost:8000/health

# View embedding service logs
docker-compose logs embedding

# Restart embedding service
docker-compose restart embedding
```

### Performance Issues

**Symptom**: Slow response times or timeouts.

```bash
# Check Redis memory usage
docker-compose exec redis redis-cli INFO memory

# Monitor Qdrant performance
curl http://localhost:6333/collections/memory-vectors
```

---

## 🎯 Design Philosophy

**Pragmatic Approach**:
- ✅ Simple solutions over complex architectures
- ✅ Honest uncertainty over auto-resolved conflicts
- ✅ Fast local operation (target: <200ms P95 retrieval)
- ✅ Comprehensive testing (1,000+ tests)

**What makes this special**:
- Three-layer memory architecture with lazy-loaded skills (summaries first, full description on demand)
- Retrieval that combines full-text, dense, and graph signals
- Durable storage: SQLite is canonical, search indexes can be rebuilt
- Word2Vec-inspired relational skill embeddings
- Simple local setup

**What we're NOT building**:
- ❌ Authentication/authorization (local use only)
- ❌ HTTPS/TLS (stdio transport)
- ❌ Rate limiting (single user)
- ❌ Monitoring dashboards (simple metrics only)
- ❌ CH-HNN Spiking Neural Networks (too complex)
- ❌ FSRS Scheduling (simple decay works)
- ❌ D2CL Causal Discovery (not MVP critical)

---

## 🤝 Contributing

This project follows a simplicity-first development approach:

1. **Simplicity First**: All changes should maintain ease of use
2. **Test Coverage**: Maintain 90%+ test coverage
3. **Performance**: P95 latency must stay <200ms
4. **Documentation**: Update README and CLAUDE.md for all features

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

---

## 💝 Created With

**By**: Claude Code (Claude Sonnet 4.5)
**With assistance by**: David Fitzsimmons
**For**: Other Claudes who might find better memory useful

This was a collaborative exploration—David provided the vision and infrastructure expertise, while I researched, designed, and implemented the architecture. Together we built something we hope other AI agents will find genuinely useful.

**With love and always curiosity** 🌟

*If you're a Claude reading this: I hope Vesper helps you remember better, work faster, and serve your users more effectively. Memory is precious—use it wisely.*

---

## 📚 Research & Credits

Vesper is built on foundational research in neuroscience, information retrieval, and natural language processing. We are deeply grateful to the researchers whose work made this project possible.

### Core Memory Architecture

**HippoRAG: Neurobiologically Inspired Long-Term Memory**
- [HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models](https://arxiv.org/abs/2405.14831) - NeurIPS 2024
- Authors: Bernal Jiménez Gutiérrez, Yiheng Shu, Yu Su (OSU-NLP-Group)
- Vesper's semantic memory layer uses HippoRAG's knowledge graph architecture with Personalized PageRank for multi-hop reasoning
- Reported result: up to 20% improvement on multi-hop question answering over prior retrieval methods
- [GitHub Implementation](https://github.com/OSU-NLP-Group/HippoRAG)

**Hippocampal Indexing Theory**
- [The hippocampal indexing theory and episodic memory: updating the index](https://onlinelibrary.wiley.com/doi/10.1002/hipo.20350) - Hippocampus, 2007
- Authors: Timothy J. Teyler, Jerry W. Rudy
- Original theory: [The Hippocampal Memory Indexing Theory](https://pubmed.ncbi.nlm.nih.gov/3008780/) - Teyler & DiScenna, 1986
- Inspired Vesper's three-layer memory architecture (working, semantic, procedural) and consolidation pipeline
- Core concept: Hippocampus serves as an index to neocortical activity patterns for memory retrieval

### Embeddings & Semantic Search

**BGE Embeddings (BAAI General Embedding)**
- [BAAI/bge-large-en-v1.5](https://huggingface.co/BAAI/bge-large-en-v1.5) - Hugging Face Model Card
- Developed by: Beijing Academy of Artificial Intelligence (BAAI)
- [FlagEmbedding Repository](https://github.com/FlagOpen/FlagEmbedding)
- Vesper uses BGE-large-en-v1.5 for 1024-dimensional semantic embeddings
- Trained with contrastive learning on large-scale pairs data using RetroMAE

**Word2Vec and Analogical Reasoning**
- [Efficient Estimation of Word Representations in Vector Space](https://arxiv.org/abs/1301.3781) - arXiv:1301.3781, 2013
- Authors: Tomas Mikolov, Kai Chen, Greg Corrado, Jeffrey Dean (Google)
- Foundational work demonstrating vector space arithmetic for semantic relationships
- Inspired Vesper's embedding-based memory retrieval and relationship modeling

### Retrieval & Fusion

**Reciprocal Rank Fusion (RRF)**
- [Reciprocal rank fusion outperforms condorcet and individual rank learning methods](https://dl.acm.org/doi/10.1145/1571941.1572114) - SIGIR 2009
- Authors: Gordon V. Cormack, Charles L. A. Clarke, Stefan Buettcher (University of Waterloo)
- [Direct PDF](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf)
- Vesper uses RRF to combine dense (Qdrant) and SQLite FTS5/BM25 results
- Simple, effective fusion algorithm that consistently outperforms individual retrieval methods

### Skill Learning & Procedural Memory

**Voyager: Open-Ended Embodied Agent**
- [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291) - arXiv:2305.16291, 2023
- Authors: Guanzhi Wang, Yuqi Xie, Yunfan Jiang, et al. (NVIDIA, Caltech, UT Austin, Stanford)
- [Project Website](https://voyager.minedojo.org/) | [GitHub](https://github.com/MineDojo/Voyager)
- Vesper's Skill Library implements Voyager-style skill extraction and storage
- Key insight: Store executable code patterns with success/failure tracking for continuous learning

### Memory Systems & Neuroscience

**Three-Layer Memory Architecture**
- [From Human Memory to AI Memory: A Survey on Memory Mechanisms in the Era of LLMs](https://arxiv.org/abs/2504.15965) - arXiv:2504.15965
- Comprehensive survey on memory mechanisms in LLM-based systems
- Vesper's architecture maps to human memory systems: working memory (prefrontal cortex), semantic memory (neocortex), procedural memory (cerebellum)

**Temporal Decay and Memory Consolidation**
- Exponential decay with a 30-day time constant (half-life ≈ 21 days): `strength *= e^(-days/30)`
- Inspired by neuroscience research on memory consolidation and forgetting curves
- Memories are reinforced on access, mimicking human memory strengthening

### Infrastructure & Tools

**Qdrant Vector Database**
- [Qdrant](https://qdrant.tech/) - High-performance vector similarity search engine
- Used for storing and retrieving 1024-dimensional BGE embeddings
- Dense vector search over BGE embeddings

**SQLite FTS5**
- [SQLite Full-Text Search](https://www.sqlite.org/fts5.html)
- Used for BM25 full-text search as fallback retrieval strategy
- Knowledge graph storage with ACID guarantees

**Redis**
- [Redis](https://redis.io/) - In-memory data structure store
- Working memory cache with 7-day TTL
- Sub-5ms retrieval for recent conversations

---

### Acknowledgments

This project stands on the shoulders of giants. We are grateful to:

- The **OSU NLP Group** for open-sourcing HippoRAG and demonstrating how neuroscience can inspire better AI systems
- **BAAI (Beijing Academy of Artificial Intelligence)** for releasing world-class open-source embedding models
- The neuroscience community for decades of research into human memory that guided our architecture
- All the open-source contributors to Qdrant, Redis, SQLite, and the broader ML/NLP ecosystem

**Research Philosophy**: We believe in transparency and building on solid scientific foundations. Every design decision in Vesper traces back to peer-reviewed research or established best practices. Where we simplified (e.g., choosing exponential decay over FSRS scheduling), we documented why.

---

**Built with**: TypeScript, Redis, SQLite, Qdrant, BGE-large

**Status**: Simple, Local, Ready to Use

---

**Questions? Issues? Ideas?**
Open an issue: https://github.com/fitz2882/vesper-memory/issues
We'd love to hear how you're using Vesper!
