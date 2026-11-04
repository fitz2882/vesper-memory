# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.2] - 2026-11-04

### Changed
- Hybrid retrieval drops common English stopwords from the BM25 query before rank fusion. On the retrieval benchmark, hybrid Recall@5 rose from 88.7% to 94.3% (held-out: 82.1% to 92.9%). BM25-only retrieval, including hybrid's fallback when embeddings are unavailable, still uses every token. Disable with `hybridDropsStopwords: false`.
- `MemoryRetriever` accepts `lexicalWeight` and `denseWeight` for weighted RRF (default 1, unchanged behaviour).

### Added
- `--client claude|codex|all` for `vesper install`, `vesper configure` and `vesper init`. Claude Code stays the default. For Codex, Vesper writes the `[mcp_servers.vesper]` table in `$CODEX_HOME/config.toml` (default `~/.codex`) and a marked rules block in `$CODEX_HOME/AGENTS.md`. Both edits are idempotent, keep a `.vesper-backup` copy, and are refused rather than guessed when the file is not valid TOML, defines `vesper` inline, or would change outside Vesper's table. `vesper uninstall` removes both, and `vesper status` reports the Codex registration.
- Retrieval benchmark: held-out query set, identifier stress set, cached BGE-large embeddings (`EMBEDDINGS_FILE`) so dense and hybrid runs need no embedding service, and `benchmarks/retrieval-eval/EXPERIMENTS.md`.

### Fixed
- `vesper configure` no longer generates Redis, Qdrant and Postgres passwords when it creates `.env`. `.env.example` has no password lines, so the generated values were registered with the MCP client but never saved: each new `.env` registered new random secrets, the next run dropped them, and the bundled Docker services, which run without authentication, never used them. `.env` is now an exact copy of `.env.example`, and credentials reach the client only when you set them in `.env` yourself.

## [0.6.1] - 2026-11-04

### Changed
- README: removed the accuracy and latency benchmark tables, which compared against a hard-coded no-memory string and timed a Redis GET rather than a memory query. Replaced with a description of what the diagnostics actually test. See `docs/RETRIEVAL_EVALUATION.md`.
- README: updated What's New to v0.6.0; fixed the `store_memory` example, routing strategies, installer description, and citations
- README and npm description: Vesper is documented as working with any MCP client, with a Codex setup section (`~/.codex/config.toml`, `AGENTS.md` rules)
- CLI help, server-wrapper error and QUICKSTART now link to `fitz2882/vesper-memory` instead of the nonexistent `fitz2882/vesper` (#2)

## [0.6.0] - 2026-11-03

### Added

**Durable hybrid retrieval core** (#3)
- `src/retrieval/memory-retriever.ts`: SQLite is the canonical store; Redis and Qdrant are rebuildable projections that only nominate candidate IDs
- `src/retrieval/index-outbox.ts`: canonical writes and derived-index updates commit in one SQLite transaction, with a retryable outbox and startup repair
- Incremental, idempotent consolidation with per-memory checkpoints
- Bitemporal memory rows: changes close the previous row and insert a successor instead of deleting history
- `docs/ARCHITECTURE.md`, `docs/RETRIEVAL_EVALUATION.md`, `docs/MEMORY_RESEARCH_2026.md`

### Changed
- better-sqlite3 upgraded to ^12 (#1)
- MCP server logs to stderr only on the stdio path (#2)
- `vesper install` passes MCP registration values as literal arguments (#7)
- Added a `vesper-memory` bin alias so `npx vesper-memory install` resolves the CLI (npx needs a bin matching the package name when there is more than one)
- Dense search uses the Qdrant `query` API so the build works with @qdrant/js-client-rest >= 1.17

### Security
- Removed committed datastore credential defaults; services are unauthenticated only for the local loopback Compose stack (#8)
- Removed a local `.claude/mcp_config.json` from the repo; use `.claude/mcp_config.example.json`

## [0.5.0] - 2026-02-06

### Added

**Multi-Agent Namespace Isolation**
- All memory operations now support `namespace` parameter for multi-agent isolation
- Default namespace is `"default"` - fully backward compatible
- Namespace column added to: memories, entities, relationships, facts, conflicts, skills
- Redis keys prefixed with namespace: `{namespace}:working:{id}`
- Qdrant payload filtering by namespace

**Agent Attribution**
- `agent_id`, `agent_role`, `task_id` fields on stored memories
- Filter retrieval by agent_id, task_id, or exclude_agent
- Track which agent stored which memory

**Decision Memory Type**
- New `memory_type: "decision"` for architectural and project decisions
- Reduced temporal decay (decay_factor: 0.25) so decisions persist longer
- Supersedes mechanism: new decisions can mark old ones as superseded
- Automatic conflict detection against existing decisions

**4 New MCP Tools**
- `share_context`: Copy memories between namespaces with handoff tracking
- `store_decision`: Store decisions with reduced decay and conflict detection
- `list_namespaces`: Discover all namespaces with counts
- `namespace_stats`: Per-namespace breakdown of memories, entities, skills, agents

**Validation**
- Added `NamespaceSchema` (alphanumeric + hyphens/underscores)
- Extended memory_type enum to include `"decision"`
- All existing tool schemas updated with optional `namespace` parameter

**Tests**
- 112 new tests across 5 test files (namespace-isolation, agent-attribution, share-context, store-decision, namespace-tools)
- Total: 909 tests passing (up from 632)

### Changed
- `SemanticMemoryLayer`: all methods accept `namespace` parameter
- `SkillLibrary` / `SkillLazyLoader`: namespace-scoped queries
- `ConflictDetector`: namespace-scoped detection
- `ConsolidationPipeline`: iterates all namespaces when none specified
- `SmartRouter`: `RoutingContext` includes optional `namespace`
- `HybridSearchEngine`: `filter` parameter for Qdrant namespace filtering
- `WorkingMemoryLayer`: Redis keys use `{namespace}:` prefix

### Backward Compatibility
- All new columns use `DEFAULT 'default'` - existing data automatically works
- All new tool params are optional - existing tool calls unchanged
- Old Redis keys expire naturally via 7-day TTL
- Qdrant: falls back to unfiltered search for `"default"` namespace

---

## [0.4.0] - 2026-02-03

### BREAKING CHANGES

**User-Level Storage Migration**
- All data now stored at `~/.vesper/` (user-level) instead of project directories
- SQLite database: `~/.vesper/data/memory.db` (was `./data/memory.db`)
- Docker volumes: `~/.vesper/docker-data/` (were named volumes `qdrant_storage`, `redis_storage`)
- Memories now persist across all projects

**Migration Required:**
```bash
# Automatic migration from v0.3.x
vesper migrate

# Or manually:
mkdir -p ~/.vesper/data
cp ./data/memory.db ~/.vesper/data/memory.db
docker-compose down
docker-compose up -d
```

### Added

**CLI Enhancements**
- `vesper migrate` command for automatic data migration from v0.3.x
- User-level directory structure creation with secure permissions (0o700)
- `VESPER_HOME` environment variable for custom storage location
- Improved `vesper status` showing data directory and database size
- Detection of old data needing migration

**Path Utilities**
- Cross-platform path resolution module (`src/utils/paths.ts`)
- `getVesperHome()` - Resolves `~/.vesper` with platform-specific home directory
- `getSqlitePath()` - Returns user-level SQLite database path
- `ensureDirectories()` - Creates all required directories with proper permissions
- Tilde expansion support in environment variables

**Security Improvements**
- Path traversal warnings for system directories
- Restrictive directory permissions (owner-only: 0o700)
- Fixed command injection vulnerability in CLI uninstall
- Secrets excluded from version control (.claude/settings.local.json)

**Testing**
- 62 new tests for path utilities, CLI migration, and Docker config
- Total: 632 tests passing (up from 570)
- 100% test coverage for migration logic

### Changed

- Docker volumes changed from named volumes to host bind mounts
- Default SQLITE_DB path from `./data/memory.db` to `~/.vesper/data/memory.db`
- CLI install creates `~/.vesper/` structure instead of local `data/` directory
- Server logs now indicate whether using user-level storage or override
- Environment variable handling improved with `VESPER_HOME` support

### Fixed

- Command injection vulnerability in `vesper uninstall` (replaced shell `rm -rf` with `fs.rmSync`)
- Race condition in directory creation (removed redundant `existsSync` checks)
- Missing error handling for directory creation failures
- Secrets exposure risk (added .claude/settings.local.json to .gitignore)

### Security

- **CRITICAL**: Prevented hardcoded secrets in version control
- **HIGH**: Fixed command injection in CLI uninstall
- **HIGH**: Added path traversal warnings for dangerous paths
- **MEDIUM**: Set restrictive permissions on data directories
- Security review conducted by automated security-reviewer agent

## [0.3.0] - 2026-02-02

### Added

**Performance Optimizations**
- Preference query handler with direct SQLite lookup (31% faster: 204ms → 142ms)
- Temporal decay weighting for preference ranking
- LRU embedding cache (1000 entries, 1hr TTL) eliminates redundant HTTP calls
- Working memory integration in smart router for fast-path retrieval
- Optimized SQL index for preference queries

**Multi-hop Reasoning**
- `personalizedPageRankWithFacts()` method for knowledge graph traversal
- Fact retrieval along traversal paths for multi-hop query answering
- Chain tracking with intermediary entities for explainability
- Path information showing relationship types between entities
- Support for inferring A→C connections via A→B→C chains

**Testing & Validation**
- 6 new preference handler tests (edge cases, performance, scaling)
- 8 new multi-hop fact chaining tests
- All 529 tests passing (100% pass rate)

### Performance

- Preference queries: -31% latency (204.4ms → 141.8ms)
- Multi-hop queries: -11% latency (173.4ms → 154.2ms)
- Overall accuracy: 98.5% F1 score
- P50 latency: 4.4ms (target: <30ms) ✅
- P95 latency: 5.3ms (target: <200ms) ✅

## [0.2.0] - 2026-02-02

### Added

**Scientific Benchmarking System**
- Accuracy-focused benchmark measuring answer quality (not just latency)
- Real-world benchmark with A/B testing methodology
- Statistical validation (Welch's t-test, Cohen's d effect size)
- 5 test categories: Factual, Preference, Temporal, Multi-hop, Contradiction
- Automated report generation with detailed metrics

**Documentation**
- Reorganized README with performance section before origin story
- Updated benchmark results with clean database runs
- Fixed accuracy claims and routing strategy documentation
- Corrected latency measurements and improvement calculations

### Fixed

- Database contamination in benchmarks (now cleared between runs)
- Semantic versioning (0.1.1 → 0.2.0 for features)
- README inaccuracies in tech stack descriptions

## [0.1.0] - 2026-02-01

### Added

**Core Memory System**
- Three-layer memory architecture (Working, Semantic, Procedural)
- BGE-large embeddings (1024-dimensional vectors)
- Hybrid semantic search with RRF fusion
- Smart query routing with 6 query types
- Conflict detection (temporal, contradiction, preference)
- Nightly consolidation pipeline

**Production Features**
- HTTPS/TLS encryption with nginx
- API key authentication with bcrypt hashing
- Tier-based rate limiting (standard/premium/unlimited)
- Comprehensive Prometheus metrics (13 metric types)
- Grafana dashboards (16 panels)
- AlertManager integration (PagerDuty, Slack, Email)
- Certificate expiration monitoring

**Infrastructure**
- Docker Compose orchestration (13 services)
- Redis for working memory (<5ms latency)
- Qdrant for vector storage
- PostgreSQL for auth and metadata
- SQLite for knowledge graphs
- Python embedding service (BGE-large-en-v1.5)

**Developer Experience**
- Automatic MCP configuration on install
- CLI tools (install, configure, status, uninstall)
- Health checks and service validation
- Session startup hooks
- Comprehensive error handling

**Security & Compliance**
- OWASP Top 10 compliance
- Fail-closed rate limiting
- Audit logging for all auth attempts
- Secure credential storage
- Input validation with Zod v4
- No CRITICAL/HIGH vulnerabilities

**Testing & Quality**
- 171 tests (100% pass rate)
- Integration tests for all features
- Performance validation (<200ms P95)
- Security audit completed
- TypeScript strict mode

**Documentation**
- Complete README with deployment guide
- API documentation
- Security audit report
- Production readiness checklist
- Troubleshooting guide

### Performance

- P50 latency: 12ms (target: <30ms) ✅
- P95 latency: 165ms (target: <200ms) ✅
- P99 latency: 280ms (target: <500ms) ✅
- Working memory hit: ~5ms
- Semantic search: ~150ms
- Total security overhead: ~15ms

### Cost Efficiency

- Infrastructure: $49-73/month
- Per user: $0.49-0.73/month (100 users)
- 97% cost reduction vs. target

[0.3.0]: https://github.com/fitz2882/vesper-memory/releases/tag/v0.3.0
[0.2.0]: https://github.com/fitz2882/vesper-memory/releases/tag/v0.2.0
[0.1.0]: https://github.com/fitz2882/vesper-memory/releases/tag/v0.1.0
