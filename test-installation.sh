#!/bin/bash
# Memory MCP - Installation Test
# Verifies everything is working correctly

set -e

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║           Memory MCP - Installation Test                        ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

test_check() {
    local name="$1"
    local command="$2"

    echo -n "Testing $name... "
    if eval "$command" &> /dev/null; then
        echo -e "${GREEN}✓${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗${NC}"
        ((TESTS_FAILED++))
    fi
}

# Test Docker services
echo "Testing Docker Services:"
test_check "Redis running" "docker-compose ps redis | grep -q Up"
test_check "Qdrant running" "docker-compose ps qdrant | grep -q Up"
test_check "PostgreSQL running" "docker-compose ps postgres | grep -q Up"
echo ""

# Test service connectivity
echo "Testing Service Connectivity:"
test_check "Redis connection" "docker-compose exec -T redis redis-cli -a \$(grep REDIS_PASSWORD .env | cut -d= -f2) ping"
test_check "Qdrant HTTP" "curl -sf http://localhost:6333/healthz"
test_check "PostgreSQL ready" "docker-compose exec -T postgres pg_isready"
echo ""

# Test database
echo "Testing Database:"
test_check "SQLite database exists" "[ -f data/memory.db ]"
test_check "Tables created" "sqlite3 data/memory.db 'SELECT name FROM sqlite_master WHERE type=\"table\"' | grep -q entities"
echo ""

# Test build
echo "Testing Build:"
test_check "TypeScript compiled" "[ -f dist/server.js ]"
test_check "Dependencies installed" "[ -d node_modules ]"
echo ""

# Test Claude Code config
echo "Testing Claude Code Integration:"
test_check "MCP config exists" "[ -f ~/.claude/mcp_config.json ]"
test_check "Memory server configured" "grep -q memory ~/.claude/mcp_config.json"
echo ""

# Test auto-start service
echo "Testing Auto-Start Service:"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    test_check "Systemd service exists" "[ -f ~/.config/systemd/user/memory-mcp.service ]"
    test_check "Service enabled" "systemctl --user is-enabled memory-mcp"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    test_check "LaunchAgent exists" "[ -f ~/Library/LaunchAgents/com.memory-mcp.server.plist ]"
fi
echo ""

# Print summary
echo "═══════════════════════════════════════════════════════════════════"
echo "Test Results:"
echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
else
    echo -e "  ${GREEN}Failed: 0${NC}"
fi
echo "═══════════════════════════════════════════════════════════════════"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed! Installation is working correctly.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Restart Claude Code"
    echo "  2. Start a new conversation"
    echo "  3. Claude will automatically use the memory system!"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Please check the output above.${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  - Run: docker-compose logs"
    echo "  - Check: tail -f logs/memory-mcp.log"
    echo "  - Restart: ./install.sh"
    echo ""
    exit 1
fi
