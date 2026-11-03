# Vesper Development Setup

This document explains the two-instance Vesper configuration for development.

## Overview

You now have **two separate Vesper instances** running:

### 1. Personal Vesper (Stable)
- **Location**: `~/.vesper/`
- **MCP Name**: `vesper-personal`
- **Use Case**: General use across all projects
- **Ports**:
  - Redis: `6379`
  - Qdrant: `6333`
  - Embedding: `8000`
- **Database**: `~/.vesper/data/memory.db`
- **Docker Containers**:
  - `vesper-redis`
  - `vesper-qdrant`
  - `vesper-embedding`

### 2. Development Vesper (Testing)
- **Location**: `~/.vesper-dev/`
- **MCP Name**: `vesper-dev`
- **Use Case**: Testing changes while working on Vesper
- **Ports** (custom to avoid conflicts):
  - Redis: `6380`
  - Qdrant: `6334`
  - Embedding: `8001`
- **Database**: `~/.vesper-dev/data/memory.db`
- **Docker Containers**:
  - `vesper-dev-redis`
  - `vesper-dev-qdrant`
  - `vesper-dev-embedding`

## How This Works (For Developers)

The `docker-compose.yml` uses environment variables with defaults:

```yaml
container_name: ${VESPER_PREFIX:-vesper}-redis
ports:
  - "${REDIS_PORT:-6379}:6379"
```

This means:
- **Fresh users**: No env vars set → get `vesper-*` containers on default ports
- **Developers**: Set `VESPER_PREFIX=vesper-dev` in `.env` → get `vesper-dev-*` containers on custom ports

**The `.env` file is gitignored**, so:
- Your dev settings don't affect other users
- Fresh installs use `.env.example` (default values)
- Everyone can customize for their needs

## Switching Between Instances

**Important**: Only enable one MCP server at a time to avoid confusion about where memories are stored.

### Via Claude Code UI

Use the MCP settings UI to toggle servers:

1. Open MCP settings (command palette: "MCP: Configure Servers" or similar)
2. **When working on other projects**: Enable `vesper-personal`, disable `vesper-dev`
3. **When developing Vesper**: Enable `vesper-dev`, disable `vesper-personal`
4. Restart Claude Code after toggling

### Why Toggle?

Both servers provide the same tools (`store_memory`, `retrieve_memory`, etc.), so having both enabled can be confusing. By enabling only one at a time, you have explicit control over where your memories are stored.

## Development Workflow

**When working on Vesper code:**
1. Connect to `vesper-dev`
2. Make your changes
3. Run `npm run build` to rebuild
4. Test immediately (no restart needed for most changes)
5. Verify tests pass: `npm test`

**When working on other projects:**
1. Connect to `vesper-personal`
2. Your stable Vesper installation remains unaffected by dev changes

## Managing Services

### Development Instance
```bash
# Start dev services (uses ports from .env: 6380, 6334, 8001)
docker-compose up -d

# Stop dev services
docker-compose down

# View logs
docker-compose logs -f

# Rebuild after code changes
npm run build
```

### Personal Instance
```bash
# Start personal services (uses default ports: 6379, 6333, 8000)
cd ~/.vesper
docker-compose up -d

# Stop personal services
cd ~/.vesper
docker-compose down
```

## Data Separation

Each instance has completely separate data:
- **Personal**: `~/.vesper/data/memory.db`
- **Development**: `~/.vesper-dev/data/memory.db`

This means:
- Dev testing won't pollute your personal memories
- You can experiment freely in dev without risk
- Personal Vesper remains stable during development
- Both use user-level storage (not in project directories)

## Port Reference

| Service   | Personal | Development |
|-----------|----------|-------------|
| Redis     | 6379     | 6380        |
| Qdrant    | 6333     | 6334        |
| Embedding | 8000     | 8001        |

## Configuration Files

### Development `.env` (gitignored)
```bash
# Custom settings for dev instance
VESPER_PREFIX=vesper-dev
REDIS_PORT=6380
QDRANT_PORT=6334
EMBEDDING_PORT=8001
```

### Fresh Install `.env.example` (in git)
```bash
# Default settings for normal users
# No VESPER_PREFIX → defaults to "vesper"
REDIS_PORT=6379
QDRANT_PORT=6333
EMBEDDING_PORT=8000
```

## Testing the Setup

Run the comprehensive test:

```bash
# Test both instances
./test-vesper-setup.sh

# Expected output:
# - 6 containers running
# - vesper-personal: Connected
# - vesper-dev: Connected
# - All services healthy
```

## Troubleshooting

**Both instances running?**
```bash
docker ps | grep vesper
# Should show 6 containers (3 personal + 3 dev)
```

**Check MCP connections:**
```bash
claude mcp list | grep vesper
# Should show both vesper-personal and vesper-dev as Connected
```

**Ports in use:**
```bash
docker ps --format "{{.Names}}: {{.Ports}}" | grep vesper
```

**Verify test script doesn't modify MCP config:**
```bash
# test-package.sh now backs up and restores ~/.claude.json
# No more accidental test pollution!
```

## Benefits of This Setup

✅ **Safe Development**: Break things in dev without affecting personal use
✅ **Immediate Testing**: Test changes while using the tool
✅ **Data Isolation**: Personal memories stay separate from test data
✅ **Easy Switching**: One command to switch between instances
✅ **Dog-fooding**: Use the tool while building it
✅ **No Impact on Others**: Your dev setup doesn't affect fresh installs
