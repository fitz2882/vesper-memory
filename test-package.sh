#!/bin/bash
set -e

echo "🧪 Testing Vesper Package Locally"
echo ""

# Backup MCP config before testing
echo "💾 Backing up MCP config..."
if [ -f ~/.claude.json ]; then
  cp ~/.claude.json ~/.claude.json.test-backup
  echo "   ✅ Backed up ~/.claude.json"
fi

# Clean build
echo "1️⃣ Building..."
npm run build

# Create package
echo "2️⃣ Creating package..."
npm pack

# Install globally
echo "3️⃣ Installing globally..."
npm install -g ./vesper-0.1.0.tgz

# Test command
echo "4️⃣ Testing CLI..."
vesper --help

# Test installation to temp directory
echo "5️⃣ Testing install command..."
export VESPER_INSTALL_DIR=~/vesper-test-$(date +%s)

# Use different ports to avoid conflicts with existing installation
export REDIS_PORT=6380
export QDRANT_PORT=6334
export EMBEDDING_PORT=8001

echo "   Installing to: $VESPER_INSTALL_DIR"
echo "   Using ports: Redis=$REDIS_PORT, Qdrant=$QDRANT_PORT, Embedding=$EMBEDDING_PORT"
vesper install

# Check installation
echo "6️⃣ Verifying installation..."
if [ -d "$VESPER_INSTALL_DIR" ]; then
  echo "   ✅ Installation directory exists"
  ls -la "$VESPER_INSTALL_DIR"
else
  echo "   ❌ Installation directory missing!"
  exit 1
fi

# Check MCP config
echo "7️⃣ Checking MCP config..."
if grep -q "vesper" ~/.claude.json; then
  echo "   ✅ MCP config updated"
  cat ~/.claude.json | jq '.mcpServers.vesper'
else
  echo "   ❌ MCP config not updated!"
  exit 1
fi

# Check Docker services
echo "8️⃣ Checking Docker services..."
cd "$VESPER_INSTALL_DIR"
docker-compose ps

# Test status command
echo "9️⃣ Testing status command..."
vesper status

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All automated tests passed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔄 Manual tests needed:"
echo "   1. Restart Claude Code"
echo "   2. Ask: 'What MCP servers are available?'"
echo "   3. Test: 'Store a memory: Testing Vesper'"
echo "   4. Query: 'What did I just store?'"
echo ""
echo "🧹 Cleanup:"
echo "   vesper uninstall"
echo "   npm uninstall -g vesper"
echo "   rm vesper-0.1.0.tgz"
echo "   rm -rf $VESPER_INSTALL_DIR"
echo ""

# Restore MCP config
echo "🔄 Restoring MCP config..."
if [ -f ~/.claude.json.test-backup ]; then
  mv ~/.claude.json.test-backup ~/.claude.json
  echo "   ✅ Restored ~/.claude.json"
else
  echo "   ⚠️  No backup found to restore"
fi
echo ""
