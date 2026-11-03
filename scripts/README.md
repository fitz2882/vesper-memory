# Memory System Scripts

This directory contains automation scripts for managing the Memory MCP server infrastructure.

## Scripts

### `ensure-infrastructure.sh`
**Purpose**: Automatically starts Docker services (Redis, PostgreSQL, Qdrant) if they're not running.

**When it runs**:
- On every Claude Code session start (via SessionStart hook)
- Can be run manually anytime

**Usage**:
```bash
./scripts/ensure-infrastructure.sh
```

### `health-check.sh`
**Purpose**: Comprehensive health check of all Memory system components.

**Usage**:
```bash
./scripts/health-check.sh
```

**Checks**:
- Docker daemon status
- Redis connectivity
- PostgreSQL connectivity
- Qdrant API responsiveness
- MCP server build artifacts
- MCP configuration

## Auto-Start Configuration

The Memory system is configured to start automatically when Claude Code launches:

1. **SessionStart Hook** (`~/.claude/settings.json`):
   - Runs `ensure-infrastructure.sh` on every Claude Code session
   - Ensures Docker services are running before MCP server starts

2. **MCP Server** (`~/.claude/mcp_config.json`):
   - Claude Code automatically launches `dist/server.js` as a subprocess
   - Server connects to running Docker infrastructure

3. **Optional: Boot-time Auto-Start** (`~/Library/LaunchAgents/com.memory.infrastructure.plist`):
   - launchd service to start infrastructure on macOS login
   - Currently created but not loaded (load with `launchctl load`)

## Manual Operations

### Start infrastructure
```bash
cd /path/to/vesper-memory
docker-compose up -d
```

### Stop infrastructure
```bash
docker-compose down
```

### View logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f redis
```

### Restart after changes
```bash
npm run build                # Rebuild TypeScript
docker-compose restart       # Restart services
# Then restart Claude Code to reconnect MCP server
```

## Troubleshooting

### MCP server not connecting
1. Run `./scripts/health-check.sh` to diagnose
2. Check `docker-compose ps` - all services should show "Up"
3. Verify build: `ls -la dist/server.js`
4. Check logs: `tail -f logs/infrastructure.log`

### Docker services won't start
1. Ensure Docker Desktop is running
2. Check ports 6379, 5432, 6333 are not in use:
   ```bash
   lsof -i :6379  # Redis
   lsof -i :5432  # PostgreSQL
   lsof -i :6333  # Qdrant
   ```

### Changes to server.ts not taking effect
```bash
npm run build  # Must rebuild TypeScript
# Restart Claude Code to reload MCP server
```
