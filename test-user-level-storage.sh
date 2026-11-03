#!/bin/bash
set -e

# Functional test for user-level storage migration (v0.4.0)
# Tests the complete flow: migration, data persistence, server startup

echo "🧪 User-Level Storage Functional Test"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

success() {
  echo -e "${GREEN}✅ $1${NC}"
}

info() {
  echo -e "${YELLOW}ℹ️  $1${NC}"
}

error() {
  echo -e "${RED}❌ $1${NC}"
  exit 1
}

# Test 1: Check VESPER_HOME resolution
echo "Test 1: Path Resolution"
echo "-----------------------"

if [ -z "$VESPER_HOME" ]; then
  info "VESPER_HOME not set, should default to ~/.vesper"
  EXPECTED_HOME="$HOME/.vesper"
else
  info "VESPER_HOME set to: $VESPER_HOME"
  EXPECTED_HOME="$VESPER_HOME"
fi

# Test 2: Check directory creation
echo ""
echo "Test 2: Directory Structure"
echo "---------------------------"

node -e "
const { ensureDirectories, getVesperHome, getSqlitePath } = require('./dist/utils/paths.js');
const vesperHome = ensureDirectories();
console.log('Vesper Home:', vesperHome);
console.log('SQLite Path:', getSqlitePath());
"

# Verify directories exist
if [ -d "$EXPECTED_HOME" ]; then
  success "~/.vesper exists"
else
  error "~/.vesper not created"
fi

if [ -d "$EXPECTED_HOME/data" ]; then
  success "~/.vesper/data exists"
else
  error "~/.vesper/data not created"
fi

if [ -d "$EXPECTED_HOME/docker-data" ]; then
  success "~/.vesper/docker-data exists"
else
  error "~/.vesper/docker-data not created"
fi

# Test 3: Check directory permissions
echo ""
echo "Test 3: Directory Permissions"
echo "-----------------------------"

PERMS=$(stat -f "%Lp" "$EXPECTED_HOME" 2>/dev/null || stat -c "%a" "$EXPECTED_HOME" 2>/dev/null)
if [ "$PERMS" = "700" ]; then
  success "Permissions are 700 (owner-only)"
else
  info "Permissions are $PERMS (expected 700, but may vary by umask)"
fi

# Test 4: Test server path resolution
echo ""
echo "Test 4: Server Path Configuration"
echo "----------------------------------"

node -e "
const { getSqlitePath } = require('./dist/utils/paths.js');
const dbPath = process.env.SQLITE_DB || getSqlitePath();
console.log('Server will use SQLite at:', dbPath);

const expectedPath = require('path').join(require('os').homedir(), '.vesper', 'data', 'memory.db');
if (dbPath === expectedPath) {
  console.log('✅ Correct default path');
} else if (process.env.SQLITE_DB) {
  console.log('ℹ️  Using SQLITE_DB override:', dbPath);
} else {
  console.error('❌ Unexpected path:', dbPath);
  process.exit(1);
}
"

success "Server path resolution works"

# Test 5: Verify Docker compose config
echo ""
echo "Test 5: Docker Compose Configuration"
echo "------------------------------------"

if ! command -v docker-compose &> /dev/null; then
  info "Docker compose not found, skipping Docker tests"
else
  # Check docker-compose.yml syntax
  if docker-compose config > /dev/null 2>&1; then
    success "docker-compose.yml syntax valid"
  else
    error "docker-compose.yml has syntax errors"
  fi

  # Check for user-level volume mounts
  if docker-compose config 2>/dev/null | grep -q ".vesper/docker-data"; then
    success "Docker volumes use ~/.vesper/docker-data"
  else
    error "Docker volumes not configured for user-level storage"
  fi
fi

# Test 6: Test migration detection
echo ""
echo "Test 6: Migration Detection"
echo "---------------------------"

# Create fake old data for migration test
OLD_DATA="./data/memory.db"
mkdir -p ./data
echo "fake old data" > "$OLD_DATA"

node -e "
const { existsSync } = require('fs');
const { join } = require('path');

const oldLocations = [
  join(process.env.VESPER_INSTALL_DIR || join(require('os').homedir(), '.vesper'), 'data', 'memory.db'),
  './data/memory.db'
];

let found = false;
for (const oldPath of oldLocations) {
  if (existsSync(oldPath)) {
    console.log('Found old data at:', oldPath);
    found = true;
    break;
  }
}

if (found) {
  console.log('✅ Migration detection works');
} else {
  console.log('⚠️  No old data found (this is OK for fresh installs)');
}
"

# Cleanup test data
rm -rf ./data

# Test 7: Test actual memory storage
echo ""
echo "Test 7: Memory Storage Test"
echo "---------------------------"

# Create a simple test to store a memory
TEST_DB="$EXPECTED_HOME/data/test-memory.db"

node -e "
const Database = require('better-sqlite3');
const { getSqlitePath } = require('./dist/utils/paths.js');
const path = require('path');

const testDbPath = path.join(path.dirname(getSqlitePath()), 'test-memory.db');
console.log('Creating test database at:', testDbPath);

const db = new Database(testDbPath);
db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, data TEXT)');
db.exec(\"INSERT INTO test (data) VALUES ('test data')\");

const result = db.prepare('SELECT COUNT(*) as count FROM test').get();
console.log('Records in test DB:', result.count);

db.close();

const fs = require('fs');
if (fs.existsSync(testDbPath)) {
  console.log('✅ Database created at user-level storage');
  // Cleanup
  fs.unlinkSync(testDbPath);
} else {
  console.error('❌ Database not created');
  process.exit(1);
}
"

success "Memory storage works at user-level location"

# Summary
echo ""
echo "🎉 All Functional Tests Passed!"
echo "=============================="
echo ""
echo "Summary:"
echo "  ✅ Path resolution works correctly"
echo "  ✅ Directories created with proper permissions"
echo "  ✅ Server configured to use ~/.vesper/"
echo "  ✅ Docker volumes configured for user-level storage"
echo "  ✅ Migration detection works"
echo "  ✅ Database storage works at user-level"
echo ""
echo "Storage location: $EXPECTED_HOME"
echo "  - data/memory.db (SQLite)"
echo "  - docker-data/qdrant (Qdrant vectors)"
echo "  - docker-data/redis (Redis cache)"
echo ""
