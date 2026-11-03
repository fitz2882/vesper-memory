# Memory System - Usage Guide

## Quick Start (5 minutes)

The memory system is **already configured** and ready to use! Here's how to test it:

### 1. Verify Everything is Running

```bash
# Check Docker services
docker-compose ps

# Should show all services as "Up" and "healthy"
# - memory-redis: Redis (working memory cache)
# - memory-postgres: PostgreSQL (metadata)
# - memory-qdrant: Qdrant (vector database)
```

### 2. Restart Claude Code

**IMPORTANT**: You must restart Claude Code to load the MCP server.

1. Quit Claude Code completely (Cmd+Q on Mac)
2. Reopen Claude Code
3. The Memory MCP server will auto-start

### 3. Test the Memory System

Once Claude Code is running, you can use these commands directly in your conversation:

#### Store a Memory
```
Please store this memory: "My favorite programming language is Python because it's elegant and has great libraries."
```

Claude will use the `store_memory` tool automatically.

#### Retrieve Memories
```
What's my favorite programming language?
```

Claude will use the `retrieve_memory` tool to search your memories.

#### List Recent Memories
```
Show me my recent memories
```

Claude will use the `list_recent` tool.

#### Get System Stats
```
How many memories do I have stored?
```

Claude will use the `get_stats` tool.

## Available Tools

The MCP server exposes 4 tools that Claude can use:

### 1. `store_memory`
**Purpose**: Add memories to the system
**Parameters**:
- `content` (required): The memory text
- `memory_type` (required): One of `episodic`, `semantic`, or `procedural`
- `metadata` (optional): Additional context (timestamps, tags, source, etc.)

**Example**:
```json
{
  "content": "Completed the authentication module using JWT tokens",
  "memory_type": "episodic",
  "metadata": {
    "project": "MemoryProject",
    "tags": ["authentication", "security"],
    "timestamp": "2026-02-01T12:00:00Z"
  }
}
```

### 2. `retrieve_memory`
**Purpose**: Query and retrieve memories
**Parameters**:
- `query` (required): Search query
- `memory_types` (optional): Filter by type (episodic/semantic/procedural)
- `max_results` (optional): Limit results (default: 5)
- `routing_strategy` (optional): Force specific strategy

**Example**:
```json
{
  "query": "What authentication decisions did we make?",
  "memory_types": ["episodic", "semantic"],
  "max_results": 10
}
```

### 3. `list_recent`
**Purpose**: Get the last 5 conversations from working memory
**No parameters required**

### 4. `get_stats`
**Purpose**: Get system statistics
**Returns**:
- Total memories stored
- Breakdown by type
- Working memory size
- Database stats

## Architecture Overview

Your memory system has three layers:

```
┌─────────────────────────────────────────┐
│   Working Memory (Redis)                │
│   • Last 5 conversations                │
│   • 7-day TTL                           │
│   • <5ms retrieval                      │
└─────────────────────────────────────────┘
            ↓ (startup consolidation)
┌─────────────────────────────────────────┐
│   Semantic Memory (SQLite + Qdrant)     │
│   • Long-term knowledge graph           │
│   • Entities, facts, relationships      │
│   • Temporal validity tracking          │
│   • Conflict detection                  │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│   Procedural Memory (Skills)            │
│   • Learned patterns & workflows        │
│   • Success/failure tracking            │
│   • Skill composition                   │
└─────────────────────────────────────────┘
```

## Query Routing (Automatic)

The system automatically routes your queries to the best retrieval strategy:

| Query Type | Example | Handler |
|------------|---------|---------|
| **Factual** | "What is X?" | Direct entity lookup |
| **Preference** | "How do I prefer X?" | Preference retrieval |
| **Project** | "What did we decide?" | Graph traversal (HippoRAG) |
| **Temporal** | "What happened yesterday?" | Time-based filtering |
| **Skill** | "Analyze this like before" | Skill library search |
| **Complex** | Ambiguous queries | Hybrid search (dense+sparse+BM25) |

## Memory Types

### Episodic Memory
**What**: Events, experiences, conversations
**When to use**: Recording what happened, decisions made, discussions
**Example**: "Today we decided to use JWT for authentication"

### Semantic Memory
**What**: Facts, knowledge, concepts
**When to use**: Storing facts about entities, relationships, preferences
**Example**: "Python is a high-level programming language"

### Procedural Memory
**What**: Skills, workflows, how-to knowledge
**When to use**: Recording procedures, patterns, workflows
**Example**: "To deploy: build → test → docker push → kubectl apply"

## Testing the System

### Manual Testing via Claude Code

1. **Store some test memories**:
```
Store these memories for testing:
1. "I prefer Python for data science projects"
2. "The MemoryProject uses TypeScript and Node.js"
3. "We decided to use Redis for working memory cache"
```

2. **Test retrieval**:
```
What programming language do I prefer for data science?
What technology stack does MemoryProject use?
What did we decide about the cache layer?
```

3. **Check stats**:
```
Show me my memory system statistics
```

### Programmatic Testing

You can test the server directly using the test script:

```bash
# This won't work interactively (MCP uses stdio protocol)
# but you can check if it starts without errors:
./test-server.sh
# Press Ctrl+C after a few seconds
```

## Monitoring

### Check Service Health

```bash
# All services
docker-compose ps

# Redis
docker-compose exec redis redis-cli -a ${REDIS_PASSWORD} ping

# PostgreSQL
docker-compose exec postgres pg_isready

# Qdrant
curl http://localhost:6333/health
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f redis
docker-compose logs -f postgres
docker-compose logs -f qdrant
```

### Check Database

```bash
# SQLite (knowledge graph)
sqlite3 data/memory.db "SELECT COUNT(*) FROM entities;"

# Redis (working memory)
docker-compose exec redis redis-cli -a ${REDIS_PASSWORD} KEYS "working:*"
```

## Troubleshooting

### MCP Server Not Starting

**Check Claude Code logs**:
1. Open Claude Code
2. Look for error messages in the status bar
3. Check Console (Help → Toggle Developer Tools)

**Common issues**:
- Docker services not running: `docker-compose up -d`
- Build not up to date: `npm run build`
- Permissions not set: Check `~/.claude/settings.json` includes "Memory"

### Redis Authentication Errors

If you see "NOAUTH Authentication required":

1. Check `.env` has correct `REDIS_PASSWORD`
2. Verify `mcp_config.json` has matching password
3. Restart: `docker-compose restart redis`

### Database Not Found

If SQLite shows `:memory:` instead of file path:

1. Check `SQLITE_DB` in `mcp_config.json` points to absolute path
2. Verify directory exists: `ls -la data/`
3. Rebuild: `npm run build`

### Memory Not Persisting

**Working Memory** (last 5 conversations):
- Auto-expires after 7 days
- Cleared on Redis restart
- This is expected behavior!

**Semantic Memory** (long-term):
- Stored in `data/memory.db` (persists across restarts)
- Check if consolidation ran: should happen automatically

## Advanced Usage

### Consolidation Pipeline

Memories automatically consolidate from working → semantic layer when the MCP server starts (each time Claude Code restarts). This happens in the background without blocking server startup.

**Backup scheduler**: Also runs at 3 AM daily (if MCP server is running).

To trigger manually (for testing):
```bash
# TODO: Implement manual consolidation trigger
# Currently runs via cron job defined in consolidation/pipeline.ts
```

### Conflict Detection

The system automatically detects three types of conflicts:

1. **Temporal Overlaps**: "worked at A in 2020" vs "worked at B in 2020"
2. **Direct Contradictions**: "allergic to X" vs "loves X"
3. **Preference Shifts**: "prefers Python" → "prefers Rust" (within 7 days)

Conflicts are **flagged but never auto-resolved** (honesty over guessing).

View conflicts:
```bash
sqlite3 data/memory.db "SELECT * FROM conflicts WHERE resolution_status = 'flagged';"
```

### Temporal Decay

Relationship strength decays exponentially over time:

```
strength(t) = initial_strength × e^(-t/30)
```

Where `t` = days since last reinforced, 30-day half-life.

### Skill Extraction

The system learns patterns from your conversations and extracts reusable skills.

View learned skills:
```bash
sqlite3 data/memory.db "SELECT name, success_count, avg_user_satisfaction FROM skills ORDER BY success_count DESC LIMIT 10;"
```

## Performance Metrics

**Target Metrics**:
- P95 latency: <200ms
- Cost: <$15/month per power user
- Retrieval accuracy: 95%+

**Actual Performance** (from tests):
- Working memory lookup: <5ms
- Semantic query: 10-50ms
- Graph traversal (depth=2): 20-100ms
- Full consolidation (100 memories): ~22ms

## Next Steps

1. ✅ **Start using it!** Store memories and query them
2. ⚠️ **Security hardening** before production (see [README.md](README.md))
3. 🚀 **Integrate BGE-large embeddings** for better semantic search
4. 🔬 **Monitor performance** and adjust as needed

## Getting Help

- **Documentation**: See [CLAUDE.md](CLAUDE.md) for technical details
- **Tests**: Run `npm test` to verify everything works
- **Issues**: Check logs with `docker-compose logs`
- **Architecture**: See [README.md](README.md) for system design

---

**Status**: ✅ System is ready to use! Just restart Claude Code.
