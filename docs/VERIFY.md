# Pre-Flight Checklist ✅

Before using the memory system, verify these items:

## Infrastructure

- [ ] **Docker running**: `docker --version` works
- [ ] **Services up**: `docker-compose ps` shows all "healthy"
- [ ] **Redis accessible**: `docker-compose exec redis redis-cli -a ${REDIS_PASSWORD} ping` returns PONG
- [ ] **PostgreSQL accessible**: `docker-compose exec postgres pg_isready` returns "accepting connections"

## Build & Configuration

- [ ] **Dependencies installed**: `ls node_modules` shows packages
- [ ] **Server built**: `ls dist/server.js` exists
- [ ] **Database exists**: `ls data/memory.db` exists
- [ ] **MCP config exists**: `cat ~/.claude/mcp_config.json | grep memory` shows configuration
- [ ] **Permissions set**: `cat ~/.claude/settings.json | grep Memory` shows "Memory" in allow list

## Quick Test Commands

```bash
# 1. Check all services
docker-compose ps

# 2. Verify build
ls -lh dist/server.js

# 3. Check database
ls -lh data/memory.db

# 4. Verify permissions
cat ~/.claude/settings.json | grep -A 3 "permissions"

# Expected output:
#   "permissions": {
#     "allow": [
#       "Memory"
#     ]
#   }
```

## Ready to Use!

If all checkboxes are ✅, you're ready!

**Next step**:
1. Quit Claude Code (Cmd+Q)
2. Restart Claude Code
3. Try: "Store this memory: I'm testing the memory system and it's working!"

## Status Summary

Run this for a quick health check:

```bash
echo "=== Memory System Status ==="
echo ""
echo "1. Docker Services:"
docker-compose ps --format "table {{.Name}}\t{{.Status}}"
echo ""
echo "2. Server Build:"
ls -lh dist/server.js 2>/dev/null && echo "✅ Built" || echo "❌ Not built - run: npm run build"
echo ""
echo "3. Database:"
ls -lh data/memory.db 2>/dev/null && echo "✅ Exists" || echo "❌ Missing"
echo ""
echo "4. MCP Config:"
cat ~/.claude/mcp_config.json | grep -q "memory" && echo "✅ Configured" || echo "❌ Missing - run: ./install.sh"
echo ""
echo "5. Permissions:"
cat ~/.claude/settings.json | grep -q "Memory" && echo "✅ Granted" || echo "❌ Missing - add 'Memory' to allow list"
echo ""
echo "=== If all show ✅, restart Claude Code to activate! ==="
```

Copy and paste this entire block to check everything at once.
