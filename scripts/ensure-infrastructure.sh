#!/bin/bash
# Ensures Docker services are running for enabled Vesper MCP servers
# Starts services for vesper-personal and/or vesper-dev based on MCP config

# Dynamically determine installation directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR" || exit 1

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "⚠️  Docker is not running. Please start Docker Desktop."
    exit 0  # Exit gracefully - don't block Claude startup
fi

# Detect which MCP servers are configured
# Check local project config first, then fall back to global config
LOCAL_MCP_CONFIG="$PROJECT_DIR/.claude/mcp_config.json"
GLOBAL_MCP_CONFIG="$HOME/.claude/mcp_config.json"

START_PERSONAL=false
START_DEV=false

# Use local config if it exists, otherwise use global
if [ -f "$LOCAL_MCP_CONFIG" ]; then
    MCP_CONFIG="$LOCAL_MCP_CONFIG"
    echo "Using local MCP config: $LOCAL_MCP_CONFIG"
elif [ -f "$GLOBAL_MCP_CONFIG" ]; then
    MCP_CONFIG="$GLOBAL_MCP_CONFIG"
    echo "Using global MCP config: $GLOBAL_MCP_CONFIG"
fi

if [ -f "$MCP_CONFIG" ]; then
    if grep -q '"vesper-personal"' "$MCP_CONFIG"; then
        START_PERSONAL=true
    fi
    if grep -q '"vesper-dev"' "$MCP_CONFIG"; then
        START_DEV=true
    fi
fi

# Function to start services for a specific instance
start_instance() {
    local PROJECT_NAME=$1
    local INSTANCE=$2
    local VESPER_HOME=$3
    local REDIS_PORT=$4
    local QDRANT_PORT=$5
    local EMBEDDING_PORT=$6

    # Create required directories
    mkdir -p "$VESPER_HOME/data"
    mkdir -p "$VESPER_HOME/docker-data/qdrant"
    mkdir -p "$VESPER_HOME/docker-data/redis"
    mkdir -p "$VESPER_HOME/logs"

    # Check if services are already healthy
    local REDIS_HEALTHY=$(docker ps --filter "name=${INSTANCE}-redis" --filter "health=healthy" --format "{{.Names}}" | wc -l | tr -d ' ')
    local QDRANT_HEALTHY=$(docker ps --filter "name=${INSTANCE}-qdrant" --filter "health=healthy" --format "{{.Names}}" | wc -l | tr -d ' ')
    local EMBEDDING_HEALTHY=$(docker ps --filter "name=${INSTANCE}-embedding" --filter "health=healthy" --format "{{.Names}}" | wc -l | tr -d ' ')

    if [ "$REDIS_HEALTHY" = "0" ] || [ "$QDRANT_HEALTHY" = "0" ] || [ "$EMBEDDING_HEALTHY" = "0" ]; then
        echo "🚀 Starting $INSTANCE infrastructure..."

        # Export environment variables for docker-compose
        export VESPER_PREFIX="$INSTANCE"
        export VESPER_HOME="$VESPER_HOME"
        export REDIS_PORT="$REDIS_PORT"
        export QDRANT_PORT="$QDRANT_PORT"
        export EMBEDDING_PORT="$EMBEDDING_PORT"

        # Try to start existing containers first (fast path)
        docker-compose -p "$PROJECT_NAME" start 2>/dev/null

        # If that failed (no containers exist), create them
        if [ $? -ne 0 ]; then
            docker-compose -p "$PROJECT_NAME" up -d 2>&1 | grep -v "is not set. Defaulting" | grep -v "level=warning" | grep -v "internal" || true
        fi

        echo "✅ $INSTANCE infrastructure started"
    else
        echo "✅ $INSTANCE infrastructure already running"
    fi
}

# Start vesper-personal if configured
if [ "$START_PERSONAL" = true ]; then
    start_instance "vesper-personal" "vesper" "$HOME/.vesper" "6379" "6333" "8000"
fi

# Start vesper-dev if configured
if [ "$START_DEV" = true ]; then
    start_instance "vesper-dev" "vesper-dev" "$HOME/.vesper-dev" "6380" "6334" "8001"
fi

# If neither configured, default to vesper-personal
if [ "$START_PERSONAL" = false ] && [ "$START_DEV" = false ]; then
    echo "ℹ️  No Vesper MCP servers found in config, starting vesper-personal by default"
    start_instance "vesper-personal" "vesper" "$HOME/.vesper" "6379" "6333" "8000"
fi

# Verify build artifacts exist
if [ ! -f "$PROJECT_DIR/dist/server.js" ]; then
    echo "🔨 Building MCP server..."
    npm run build
fi

echo "✅ Memory system infrastructure ready"
exit 0
