# Vesper - Quick Start Guide

Get Vesper running in Claude Code in **2 commands**.

## Prerequisites

- **Node.js 20+** - [Download](https://nodejs.org)
- **Docker Desktop** - [Download](https://docker.com/get-started)
- **Claude Code** - Already installed if you're reading this!

## Installation

### One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/fitz2882/vesper-memory/main/install.sh | bash
```

This script:
1. ✅ Clones Vesper to `~/.vesper`
2. ✅ Installs dependencies
3. ✅ Starts infrastructure (Redis, Qdrant, embeddings)
4. ✅ Configures Claude Code automatically
5. ✅ Generates secure passwords

### Manual Installation

```bash
# 1. Install Vesper
git clone https://github.com/fitz2882/vesper-memory.git ~/.vesper
cd ~/.vesper
npm install
npm run build

# 2. Start infrastructure
cp .env.example .env
docker-compose up -d redis qdrant embedding

# 3. Configure Claude Code
cat >> ~/.claude/mcp_config.json << 'EOF'
{
  "mcpServers": {
    "vesper": {
      "command": "node",
      "args": ["/Users/YOUR_USER/.vesper/dist/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
EOF
```

## Verify Installation

1. **Restart Claude Code** (completely quit and reopen)

2. **Ask Claude**: "What MCP servers are available?"
   - You should see "vesper" listed

3. **Test it**: "Store a memory: I love TypeScript"
   - Vesper will save this to working memory

4. **Retrieve it**: "What do I love?"
   - Vesper should recall "TypeScript"

## What Just Happened?

```
┌─────────────┐
│ Claude Code │  You ask questions
└──────┬──────┘
       │
       │ MCP Protocol
       ▼
┌─────────────┐
│   Vesper    │  Intelligent routing
│   Router    │  (working → semantic → skills)
└──────┬──────┘
       │
       ├─────► Redis (last 5 conversations)
       ├─────► SQLite (knowledge graph)
       └─────► Qdrant (vector search)
```

## Tools Available

Once installed, these tools are automatically available in Claude Code:

### `store_memory`
```
Store information for later retrieval
Example: "Remember that I prefer dark mode"
```

### `retrieve_memory`
```
Query stored memories with smart routing
Example: "What are my preferences?"
```

### `list_recent`
```
View last 5 conversations
Example: "What did we discuss recently?"
```

### `get_stats`
```
View system statistics
Example: "Show memory stats"
```

## Configuration Files

### `~/.claude/mcp_config.json`
Tells Claude Code how to start Vesper:

```json
{
  "mcpServers": {
    "vesper": {
      "command": "node",
      "args": ["/Users/you/.vesper/dist/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### `~/.vesper/.env`
Configuration for Vesper (auto-generated):

```bash
# Redis (working memory)
REDIS_HOST=localhost
REDIS_PORT=6379

# Qdrant (vector search)
QDRANT_URL=http://localhost:6333

# Auth disabled by default (enable for production)
AUTH_ENABLED=false
```

## Troubleshooting

### Vesper not appearing in Claude Code?

1. **Check config exists**:
   ```bash
   cat ~/.claude/mcp_config.json
   ```

2. **Verify services running**:
   ```bash
   cd ~/.vesper
   docker-compose ps
   ```
   Should show `redis`, `qdrant`, and `embedding` as healthy.

3. **Check logs**:
   ```bash
   docker-compose logs
   ```

4. **Restart Claude Code** (quit completely, not just close window)

### "Connection refused" errors?

```bash
# Restart infrastructure
cd ~/.vesper
docker-compose restart
```

### Want to uninstall?

```bash
# Stop services
cd ~/.vesper
docker-compose down -v

# Remove installation
rm -rf ~/.vesper

# Remove from MCP config (edit manually)
# Remove the "vesper" section from ~/.claude/mcp_config.json
```

## Advanced Setup

### Enable Authentication (Production)

```bash
cd ~/.vesper

# Generate API key
npm run generate-api-key -- --tier unlimited

# Add to .env (copy the output)
echo "AUTH_ENABLED=true" >> .env
echo "MCP_API_KEY_HASH=..." >> .env  # From script output

# Restart
docker-compose restart
```

### Enable HTTPS

```bash
# Generate self-signed cert (development)
./scripts/generate-dev-certs.sh

# Update .env
echo "HTTPS_ENABLED=true" >> .env

# Restart with nginx
docker-compose up -d
```

### Custom Installation Directory

```bash
# Install to custom location
export VESPER_INSTALL_DIR=~/my-custom-path
curl -fsSL https://raw.githubusercontent.com/fitz2882/vesper/main/install.sh | bash
```

## Next Steps

- **Read the full docs**: `~/.vesper/README.md`
- **Configure for production**: See `CONTRIBUTING.md`
- **Join discussions**: [GitHub Discussions](https://github.com/fitz2882/vesper-memory/discussions)
- **Report issues**: [GitHub Issues](https://github.com/fitz2882/vesper-memory/issues)

## How It Works

Vesper implements a **3-layer memory architecture** inspired by neuroscience:

1. **Working Memory (Redis)** - Last 5 conversations, 7-day TTL, <5ms retrieval
2. **Semantic Memory (SQLite)** - Knowledge graph with entities, relationships, facts
3. **Procedural Memory (Skill Library)** - Reusable skills extracted from conversations

When you ask Claude a question:
1. Vesper checks **working memory** first (fast path)
2. Falls back to **semantic search** (knowledge graph + embeddings)
3. Extracts and stores **skills** for future reuse

**Result**: Claude remembers context across sessions, just like you do!

---

**Questions?** Ask in [GitHub Discussions](https://github.com/fitz2882/vesper-memory/discussions) or open an issue.
