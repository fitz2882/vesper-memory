# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Vesper** is a neuroscience-inspired memory system for Claude Code agents, implemented as an MCP (Model Context Protocol) server. Simple, local memory system with three-layer architecture and intelligent semantic retrieval using BGE-large embeddings.

**Key Features**:
- Three-layer memory: Working (Redis), Semantic (SQLite + HippoRAG + Qdrant), Procedural (Skill Library)
- Smart query routing with BGE-large embeddings
- HippoRAG knowledge graph with multi-hop reasoning
- Simple local setup (3 Docker services)

**Performance target**: <200ms P95 retrieval latency (not yet measured end to end; see README benchmarks section)

**Test Coverage**: 1007/1007 tests passing (100%)

---

## Quick Start

```bash
# Install and build
npm install
npm run build

# Install globally (required for MCP server to work)
npm run build:global

# Docker starts automatically when Claude Code opens this project
# (Uses vesper-dev instance via local .claude/mcp_config.json)

# Run tests
npm test                    # 1007 tests should pass

# Run MCP server (development mode)
npm run dev
```

### MCP Configuration

**Two instances available:**
- **vesper-personal**: Global config (`~/.claude/mcp_config.json`) - for all projects
- **vesper-dev**: Local config (`.claude/mcp_config.json`) - for Vesper development only

**Automatic Docker management:**
- Opening Vesper project → Starts vesper-dev containers
- Opening other projects → Starts vesper-personal containers
- Closing Claude Code → Stops running containers
- Only one instance runs at a time

**⚠️ Important startup note:**
When Claude Code first starts, you may need to manually reconnect to the active MCP server using `/mcp` → "Reconnect". This is because Docker containers start before the MCP connects, which can cause improper initialization until reconnection. This is a known timing issue and the reconnect step ensures proper configuration.

### User-Level Storage

All data is stored at `~/.vesper/` (user-level) instead of project directories:
- **SQLite database**: `~/.vesper/data/memory.db`
- **Docker volumes**: `~/.vesper/docker-data/`
- **Logs**: `~/.vesper/logs/`

**Benefits**:
- Memories persist across all projects
- No data in git repositories
- Simple backup: just copy `~/.vesper/`

**Migrating from v0.3.x**:
```bash
vesper migrate  # Automatic migration from old locations
```

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────┐
│  MCP Server (Node.js/TypeScript)        │
│  - 14 MCP tools (namespace-aware)       │
│  - Smart query routing                  │
│  - Local stdio transport                │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  Three-Layer Memory System              │
│                                          │
│  Layer 1: Working Memory (Redis)        │
│  └─ Last 5 conversations, <5ms          │
│                                          │
│  Layer 2: Semantic Memory (SQLite)      │
│  ├─ Knowledge graph (HippoRAG)          │
│  ├─ BGE-large embeddings (Qdrant)       │
│  └─ Conflict detection                  │
│                                          │
│  Layer 3: Procedural Memory (SQLite)    │
│  └─ Skill extraction & tracking         │
└─────────────────────────────────────────┘
```

### File Organization

```
src/
├── server.ts                    # Main MCP server
├── embeddings/
│   └── client.ts                # BGE-large client
├── retrieval/
│   └── hybrid-search.ts         # Qdrant + RRF fusion
├── router/
│   └── smart-router.ts          # Query classification
├── memory-layers/
│   ├── working-memory.ts        # Redis cache
│   ├── semantic-memory.ts       # SQLite + HippoRAG
│   └── skill-library.ts         # Procedural memory
├── consolidation/
│   └── pipeline.ts              # Startup consolidation
├── scheduler/
│   └── consolidation-scheduler.ts  # 3 AM backup scheduler
├── synthesis/
│   └── conflict-detector.ts     # Conflict detection
└── utils/
    └── validation.ts            # Zod schemas
```

### Consolidation Pipeline

**When it runs**: Automatically on MCP server startup (non-blocking)

**What it does**:
1. Extract entities and relationships from working memory
2. Build knowledge graph (HippoRAG)
3. Apply temporal decay to old memories
4. Detect conflicts (never auto-resolves)
5. Prune weak relationships
6. Extract skills from conversations
7. Create backup metadata

**Performance**: < 1 second for typical sessions (5-20 memories)

**Backup scheduler**: Also runs at 3 AM daily (if MCP server is running)

---

## MCP Tools

### 14 Tools Available

All tools accept an optional `namespace` parameter (default: `"default"`) for multi-agent isolation.

**Core Memory Tools**:
1. **store_memory**: Store memories with automatic embedding generation (supports `agent_id`, `agent_role`, `task_id`)
2. **retrieve_memory**: Query with smart routing and semantic search (supports `agent_id`, `task_id`, `exclude_agent` filters)
3. **list_recent**: Get recent conversations from working memory
4. **get_stats**: System metrics and health status
5. **delete_memory**: Delete a memory by ID across all layers (SQLite, Qdrant, Redis)

**Multi-Agent Tools** (v0.5.0):
6. **share_context**: Copy memories between namespaces with handoff tracking
7. **store_decision**: Store decisions with reduced temporal decay and conflict detection
8. **list_namespaces**: Discover all namespaces with memory counts
9. **namespace_stats**: Per-namespace breakdown of memories, entities, skills, agents

**System Control Tools**:
10. **vesper_enable**: Enable memory system
11. **vesper_disable**: Disable memory system (pass-through mode)
12. **vesper_status**: Check system state

**Skill Tools**:
13. **load_skill**: Load full skill description on-demand
14. **record_skill_outcome**: Track skill execution success/failure

### Query Routing

Smart router classifies queries into 6 types:
- `skill`: Procedural queries ("like before", "same as", "how you")
- `factual`: Factual queries ("what is", "who is", "where is")
- `temporal`: Time-based queries ("last week", "yesterday", "recently")
- `preference`: Preference queries ("prefer", "want", "favorite")
- `project`: Project queries ("project", "working on", "building")
- `complex`: Complex queries (fallback to hybrid search)

**Performance**:
- Working memory hit: ~5ms (fast path)
- Semantic search: ~150ms (BGE-large + Qdrant)
- Complex hybrid: ~200ms (RRF fusion)

---

## Development Commands

### Building & Installation

```bash
# Build TypeScript
npm run build

# Build and reinstall globally (use after code changes)
npm run build:global

# Reinstall global command (fixes broken symlinks)
npm run reinstall
```

**Important**: After modifying source code, run `npm run build:global` to ensure the global `vesper-server` command stays in sync with your changes.

### Testing

```bash
# Run all tests
npm test                    # 1007 tests

# Run specific test suites
npm test tests/router.test.ts
npm test tests/semantic-memory.test.ts
npm test tests/skill-library.test.ts
npm test tests/conflict-detector.test.ts

# Run with UI
npm run test:ui

# Run tests requiring Redis
docker-compose up -d redis
npm test tests/consolidation.test.ts
```

### Code Quality

```bash
npm run lint            # ESLint validation
npm run format          # Prettier formatting
npm run build           # TypeScript compilation (zero errors)
```

### Docker Operations

```bash
# Start all services
docker-compose up -d

# Start specific services
docker-compose up -d redis qdrant embedding

# Check service status
docker-compose ps

# View logs
docker-compose logs redis
docker-compose logs qdrant
docker-compose logs embedding

# Restart all services
docker-compose restart
```

---

## Environment Variables

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

**Note**: No passwords required for local development. All services run without authentication.

---

## Test Architecture

**Overall**: 1007/1007 tests passing (100%)

### Test Coverage

| Category | Tests | File |
|----------|-------|------|
| Query Classification | 45 | `tests/router.test.ts` |
| Namespace Isolation | 32 | `tests/namespace-isolation.test.ts` |
| Semantic Memory | 30 | `tests/semantic-memory.test.ts` |
| Share Context | 25 | `tests/share-context.test.ts` |
| Skill Library | 26 | `tests/skill-library.test.ts` |
| Agent Attribution | 20 | `tests/agent-attribution.test.ts` |
| Store Decision | 20 | `tests/store-decision.test.ts` |
| Conflict Detection | 19 | `tests/conflict-detector.test.ts` |
| Consolidation | 21 | `tests/consolidation.test.ts` |
| Namespace Tools | 15 | `tests/namespace-tools.test.ts` |
| Working Memory | 14 | `tests/working-memory.test.ts` |

**Key Features Tested**:
- Query classification accuracy
- Memory storage and retrieval
- Namespace isolation across all layers
- Agent attribution and filtering
- Context sharing between namespaces
- Decision storage with reduced decay
- Skill extraction and tracking
- Conflict detection (never auto-resolves)
- Working memory caching
- Consolidation pipeline

---

## Performance Targets

### Targets

| Metric | Target |
|--------|--------|
| P50 retrieval latency (incl. embedding) | <30ms |
| P95 retrieval latency (incl. embedding) | <200ms |
| P99 retrieval latency (incl. embedding) | <500ms |

The sub-millisecond figures in older docs came from a Redis GET plus a SQLite read with no embedding or search; do not cite them as query latency. Any accuracy or usefulness claim must follow `docs/RETRIEVAL_EVALUATION.md`.

---

## Design Principles

### v0.5.4 Pragmatic Approach

**Core Philosophy**:
1. **Simple > Complex** - Pragmatic solutions over theoretical perfection
2. **Honest > Smart** - Flag conflicts, never auto-resolve
3. **Fast Local Operation** - <200ms P95 latency
4. **Comprehensive Testing** - 958 tests, 100% coverage

**What We Built**:
- ✅ Three-layer memory architecture
- ✅ BGE-large semantic search
- ✅ HippoRAG knowledge graph
- ✅ Smart query routing
- ✅ Conflict detection
- ✅ Simple local setup

**What We're NOT Building**:
- ❌ Authentication/authorization (local use only)
- ❌ HTTPS/TLS (stdio transport)
- ❌ Rate limiting (single user)
- ❌ Monitoring dashboards (simple metrics only)
- ❌ CH-HNN Spiking Neural Networks (too complex)
- ❌ FSRS Scheduling (simple decay works)
- ❌ D2CL Causal Discovery (not MVP critical)

---

## Troubleshooting

### Common Issues

**Build Errors**:
```bash
# Clean and rebuild
rm -rf dist/ node_modules/
npm install
npm run build
```

**Test Failures**:
```bash
# Ensure Docker services are running
docker-compose up -d redis qdrant embedding

# Check service status
docker-compose ps

# Run specific failing test
npm test tests/path/to/test.ts
```

**Service Health**:
```bash
# Check Redis
docker-compose exec redis redis-cli ping

# Check Qdrant
curl http://localhost:6333/collections

# Check Embedding service
curl http://localhost:8000/health
```

---

## Additional Resources

**Core Documentation**:
- [README.md](./README.md) - Complete project overview
- [config/sqlite-schema.sql](./config/sqlite-schema.sql) - Database schema
- [embedding-service/](./embedding-service/) - BGE-large service

**Key Implementation Files**:
- [src/server.ts](./src/server.ts) - Main MCP server
- [src/router/smart-router.ts](./src/router/smart-router.ts) - Query classification
- [src/memory-layers/semantic-memory.ts](./src/memory-layers/semantic-memory.ts) - HippoRAG implementation
- [src/embeddings/client.ts](./src/embeddings/client.ts) - BGE-large integration

---

## Research Foundations

Vesper is built on peer-reviewed research in neuroscience and NLP:

**Core Architecture**:
- [HippoRAG](https://arxiv.org/abs/2405.14831) - Knowledge graph with Personalized PageRank (NeurIPS 2024)
- [Hippocampal Indexing Theory](https://onlinelibrary.wiley.com/doi/10.1002/hipo.20350) - Three-layer memory inspiration
- [Voyager](https://arxiv.org/abs/2305.16291) - Skill library design

**Retrieval & Embeddings**:
- [BGE-large-en-v1.5](https://huggingface.co/BAAI/bge-large-en-v1.5) - 1024-dim semantic embeddings
- [Reciprocal Rank Fusion](https://dl.acm.org/doi/10.1145/1571941.1572114) - Hybrid search fusion (SIGIR 2009)
- [Word2Vec](https://arxiv.org/abs/1301.3781) - Vector space semantic relationships

See [README.md](./README.md#research--credits) for full citations and acknowledgments.

---

**Status**: Simple, Local, Ready to Use

**For Claude Agents**: This memory system helps you learn user preferences, maintain context across conversations, and get better over time. Use the four MCP tools to store and retrieve memories intelligently.
