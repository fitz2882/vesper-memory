#!/bin/bash
# Test script for MCP server with proper environment variables
#
# SECURITY: Loads credentials from .env file instead of hardcoding them
# This prevents accidental credential exposure in version control

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found at $ENV_FILE"
    echo ""
    echo "Please create .env file with required credentials:"
    echo "  cp .env.example .env"
    echo "  # Then edit .env with your actual credentials"
    exit 1
fi

# Load environment variables from .env
echo "Loading environment variables from $ENV_FILE..."
set -a  # Auto-export all variables
source "$ENV_FILE"
set +a

# Verify required credentials are set
if [ -z "$REDIS_PASSWORD" ]; then
    echo "Error: REDIS_PASSWORD not set in .env"
    exit 1
fi

if [ -z "$QDRANT_API_KEY" ]; then
    echo "Error: QDRANT_API_KEY not set in .env"
    exit 1
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "Error: POSTGRES_PASSWORD not set in .env"
    exit 1
fi

# Set SQLite path if not already set
export SQLITE_DB="${SQLITE_DB:-$SCRIPT_DIR/data/memory.db}"

echo ""
echo "Environment configured:"
echo "  REDIS_HOST: ${REDIS_HOST:-localhost}"
echo "  REDIS_PORT: ${REDIS_PORT:-6379}"
echo "  REDIS_PASSWORD: [SET]"
echo "  QDRANT_URL: ${QDRANT_URL:-http://localhost:6333}"
echo "  QDRANT_API_KEY: [SET]"
echo "  POSTGRES_PASSWORD: [SET]"
echo "  SQLITE_DB: $SQLITE_DB"
echo "  NODE_ENV: ${NODE_ENV:-production}"
echo ""

echo "Starting MCP server..."
node "$SCRIPT_DIR/dist/server.js"
