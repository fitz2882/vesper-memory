# Memory MCP - Installation Guide

## One-Command Installation

```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/memory-mcp/main/install.sh | bash
```

Or if you've already cloned the repository:

```bash
cd /path/to/MemoryProject
./install.sh
```

That's it! The installer will:
- ✅ Check prerequisites (Node.js, Docker)
- ✅ Generate secure credentials
- ✅ Install dependencies
- ✅ Build the project
- ✅ Start infrastructure services
- ✅ Configure Claude Code automatically
- ✅ Set up auto-start service
- ✅ Run health checks

**Time**: ~2-3 minutes

---

## What Gets Installed

### Services (Always Running)
- **Redis** (port 6379) - Working memory cache
- **Qdrant** (port 6333) - Vector database
- **PostgreSQL** (port 5432) - Metadata store
- **MCP Server** - Memory management

### Auto-Start Service
- **Linux**: systemd user service
- **macOS**: launchd agent
- **Windows**: Task Scheduler (coming soon)

### Claude Code Integration
- Automatically updates `~/.claude/mcp_config.json`
- Backs up existing configuration
- Server connects when Claude Code starts

---

## Prerequisites

### Required
- **Node.js 20+** - [Download](https://nodejs.org)
- **Docker** - [Download](https://www.docker.com/get-started)
- **Claude Code** - [Download](https://claude.ai/code)

### Recommended
- 8GB+ RAM
- 2GB free disk space
- macOS or Linux (Windows WSL2 works too)

---

## Installation Options

### Option 1: Automatic (Recommended)

```bash
./install.sh
```

**Pros:**
- Fully automated
- Handles everything
- Always-on memory
- Zero configuration

**Cons:**
- Installs auto-start service
- Uses ~200MB RAM continuously

---

### Option 2: Manual Setup

For more control:

```bash
# 1. Install dependencies
npm install

# 2. Generate credentials
cp .env.example .env
# Edit .env with secure passwords

# 3. Build project
npm run build

# 4. Start services
docker-compose up -d

# 5. Configure Claude Code
# Edit ~/.claude/mcp_config.json manually

# 6. Restart Claude Code
```

---

### Option 3: Docker Only

For minimal installation:

```bash
# Coming soon - Docker image with everything bundled
docker run -d -p 6333:6333 -p 6379:6379 memory-mcp
```

---

## Verification

After installation, verify everything works:

```bash
# Check service status
systemctl --user status memory-mcp  # Linux
launchctl list | grep memory-mcp    # macOS

# Check Docker services
docker-compose ps

# Check database
sqlite3 data/memory.db "SELECT COUNT(*) FROM entities;"

# Check logs
tail -f logs/memory-mcp.log
```

---

## Using with Claude Code

1. **Restart Claude Code** (if running)
2. Start a new conversation
3. I'll automatically use the memory system!

**You'll notice:**
- I remember conversations across sessions
- I recall your preferences automatically
- I detect when information conflicts
- I build context over time

**Example:**

```
Session 1:
You: "I prefer TypeScript over JavaScript"
Me: [Stores preference]

Session 2 (next day):
You: "Create a React component"
Me: "Creating a TypeScript component..."
    [Already know your preference!]
```

---

## Management

### Check Status

```bash
# Linux
systemctl --user status memory-mcp

# macOS
launchctl list | grep memory-mcp

# Check specific services
docker-compose ps
```

### View Logs

```bash
# Real-time logs
tail -f logs/memory-mcp.log

# Error logs
tail -f logs/memory-mcp-error.log

# Docker logs
docker-compose logs -f redis
docker-compose logs -f qdrant
```

### Stop/Start

```bash
# Linux
systemctl --user stop memory-mcp
systemctl --user start memory-mcp

# macOS
launchctl stop com.memory-mcp.server
launchctl start com.memory-mcp.server

# Or stop everything
docker-compose down
```

### Database Management

```bash
# View stats
sqlite3 data/memory.db "SELECT COUNT(*) FROM entities;"

# Browse interactively
sqlite3 data/memory.db
> .tables
> SELECT * FROM entities LIMIT 10;

# Export data
sqlite3 data/memory.db .dump > backup.sql

# Clear all data (nuclear option)
rm data/memory.db
sqlite3 data/memory.db < config/sqlite-schema.sql
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
journalctl --user -u memory-mcp -n 50  # Linux
cat logs/memory-mcp-error.log          # macOS

# Common fixes
docker-compose down
docker-compose up -d
systemctl --user restart memory-mcp
```

### Port Already in Use

```bash
# Find what's using the port
lsof -i :6379  # Redis
lsof -i :6333  # Qdrant
lsof -i :5432  # PostgreSQL

# Kill the process or change ports in docker-compose.yml
```

### Database Locked

```bash
# Kill any processes using the database
fuser data/memory.db
kill <PID>

# Or restart everything
docker-compose restart
```

### Claude Code Not Finding Server

```bash
# Verify config
cat ~/.claude/mcp_config.json

# Check server is running
ps aux | grep "dist/server.js"

# Restart Claude Code completely
pkill -9 claude
# Then relaunch
```

---

## Uninstallation

```bash
# Run the uninstaller
./uninstall.sh

# Or manually:
systemctl --user stop memory-mcp      # Linux
systemctl --user disable memory-mcp
launchctl stop com.memory-mcp.server  # macOS

docker-compose down -v

# Remove data (optional)
rm -rf data/ logs/ backups/
```

---

## Advanced Configuration

### Custom Ports

Edit `docker-compose.yml`:

```yaml
redis:
  ports:
    - "6380:6379"  # Custom port

# Update .env
REDIS_PORT=6380
```

### Memory Limits

Edit `docker-compose.yml`:

```yaml
redis:
  deploy:
    resources:
      limits:
        memory: 256M
```

### Consolidation Schedule

Edit `src/consolidation/pipeline.ts`:

```typescript
// Change from 3 AM to 2 AM
cron.schedule('0 2 * * *', runConsolidationCycle);
```

### Enable TLS (Production)

```bash
# Generate certificates
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/redis.key -out certs/redis.crt

# Update docker-compose.yml
redis:
  command: >
    redis-server
    --tls-port 6380
    --tls-cert-file /certs/redis.crt
    --tls-key-file /certs/redis.key
```

---

## Security Hardening

Before production use:

```bash
# 1. Update vulnerable SDK
npm install @modelcontextprotocol/sdk@^1.25.3

# 2. Verify strong passwords
cat .env | grep PASSWORD

# 3. Enable TLS (see above)

# 4. Run security audit
npm audit

# 5. Review security report
cat docs/SECURITY_REVIEW.md
```

---

## Getting Help

### Documentation
- [README.md](README.md) - Full project overview

### Logs
- `logs/memory-mcp.log` - Application logs
- `logs/memory-mcp-error.log` - Error logs
- `docker-compose logs` - Infrastructure logs

### Support
- GitHub Issues: [Report a bug](https://github.com/yourusername/memory-mcp/issues)
- Discussions: [Ask questions](https://github.com/yourusername/memory-mcp/discussions)

---

## What's Next?

After installation:

1. **Use Claude Code normally** - I'll build memory automatically
2. **Monitor growth** - Check `data/memory.db` periodically
3. **Review consolidation** - Check logs after 3 AM
4. **Address security** - See SECURITY_REVIEW.md for production hardening

**Your AI now has persistent memory!** 🧠✨
