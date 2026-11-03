#!/bin/bash
set -e

# Vesper Installation Script
# Automated setup for Claude Code integration

echo "🌟 Installing Vesper - AI Memory System for Claude Code"
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js 20+ required. Install from https://nodejs.org"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker required. Install from https://docker.com"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || command -v docker compose >/dev/null 2>&1 || { echo "❌ Docker Compose required"; exit 1; }

# Get installation directory
INSTALL_DIR="${VESPER_INSTALL_DIR:-$HOME/.vesper}"

echo "📁 Installation directory: $INSTALL_DIR"
echo ""

# Clone or update repository
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "📦 Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull
elif [ -d "$INSTALL_DIR" ]; then
  echo "📦 Existing directory found (not a git repo), removing and cloning fresh..."
  rm -rf "$INSTALL_DIR"
  git clone https://github.com/fitz2882/vesper-memory.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
else
  echo "📦 Cloning Vesper repository..."
  git clone https://github.com/fitz2882/vesper-memory.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
echo "📚 Installing dependencies..."
npm install --silent

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo "⚙️  Creating .env configuration..."
  cp .env.example .env
  echo "✅ No passwords needed for local use"
fi

# Stop and remove any existing Vesper containers
echo "🐳 Stopping any existing Vesper containers..."
docker stop vesper-redis vesper-qdrant vesper-embedding 2>/dev/null || true
docker rm vesper-redis vesper-qdrant vesper-embedding 2>/dev/null || true

echo "🐳 Starting infrastructure (3 services: redis, qdrant, embedding)..."
docker-compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to start..."
sleep 10

# Initialize Qdrant collection
echo "🔧 Initializing Qdrant collection..."
npm run init:qdrant 2>/dev/null || echo "⚠️  Qdrant already initialized"

# Configure Claude Code MCP using the official CLI command
echo ""
echo "🤖 Configuring Claude Code MCP integration..."

# Check if claude CLI is available
if ! command -v claude >/dev/null 2>&1; then
  echo "❌ Claude Code CLI not found in PATH"
  echo "   Please install Claude Code from: https://claude.ai/download"
  exit 1
fi

# Remove old MCP server if it exists (to ensure clean install)
claude mcp remove vesper 2>/dev/null || true

# Add Vesper using the proper claude mcp add command
# Note: server name must come FIRST, then options
echo "📝 Adding Vesper MCP server..."
if claude mcp add vesper --transport stdio --scope user -e NODE_ENV=production -- node "$INSTALL_DIR/dist/server.js"; then
  echo "✅ Vesper MCP server configured successfully"
else
  echo "❌ Failed to configure Vesper MCP server"
  echo "   You can manually configure it later with:"
  echo "   claude mcp add vesper --transport stdio --scope user -e NODE_ENV=production -- node $INSTALL_DIR/dist/server.js"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Vesper installation complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎯 Next steps:"
echo "   1. Restart Claude Code to load Vesper"
echo "   2. Vesper tools will appear automatically:"
echo "      • store_memory - Save information"
echo "      • retrieve_memory - Query memories"
echo "      • list_recent - View recent conversations"
echo "      • get_stats - System statistics"
echo ""
echo "📖 Documentation:"
echo "   • README: $INSTALL_DIR/README.md"
echo "   • Config: $CLAUDE_MCP_CONFIG"
echo "   • Logs: cd $INSTALL_DIR && docker-compose logs"
echo ""
echo "💡 Test it: Ask Claude to 'store a memory about this project'"
echo ""
