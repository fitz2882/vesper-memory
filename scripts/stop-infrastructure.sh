#!/bin/bash
# Stops Docker services for Vesper MCP servers when Claude Code quits

echo "🛑 Stopping Vesper infrastructure..."

# Stop vesper-personal containers (exclude vesper-dev)
PERSONAL_CONTAINERS=$(docker ps --filter "name=vesper-redis" --filter "name=vesper-qdrant" --filter "name=vesper-embedding" --format "{{.Names}}" | grep -v "vesper-dev")
if [ -n "$PERSONAL_CONTAINERS" ]; then
    echo "Stopping vesper-personal services..."
    echo "$PERSONAL_CONTAINERS" | xargs docker stop > /dev/null 2>&1
    echo "✅ vesper-personal services stopped"
fi

# Stop vesper-dev containers
DEV_CONTAINERS=$(docker ps --filter "name=vesper-dev" --format "{{.Names}}")
if [ -n "$DEV_CONTAINERS" ]; then
    echo "Stopping vesper-dev services..."
    echo "$DEV_CONTAINERS" | xargs docker stop > /dev/null 2>&1
    echo "✅ vesper-dev services stopped"
fi

echo "✅ Vesper infrastructure stopped"
exit 0
