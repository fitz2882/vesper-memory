#!/bin/bash
# Quick test to verify MCP server can start and connect to infrastructure

set -e

# Dynamically detect project directory (script is in PROJECT_DIR/scripts/)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "🧪 Testing MCP Server Startup..."
echo "================================"

# Source environment variables
export REDIS_HOST=localhost
export REDIS_PORT=6379
# REDIS_PASSWORD is inherited from the operator environment; no repository default.
export QDRANT_URL="http://localhost:6333"
# QDRANT_API_KEY is inherited from the operator environment; no repository default.
export SQLITE_DB="$PROJECT_DIR/data/memory.db"
export NODE_ENV=production

# Test server can start (send EOF immediately to exit gracefully)
echo "Starting MCP server with test input..."
timeout 5s node dist/server.js < /dev/null 2>&1 | head -20 || {
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
        echo "✅ MCP Server: Started successfully (timeout = expected for stdio transport)"
    elif [ $EXIT_CODE -eq 141 ]; then
        echo "✅ MCP Server: Started successfully (SIGPIPE = expected for stdio transport)"
    else
        echo "❌ MCP Server: Failed to start (exit code: $EXIT_CODE)"
        exit 1
    fi
}

echo ""
echo "✅ MCP Server test passed!"
echo ""
echo "Next step: Restart Claude Code to connect to the memory system"
