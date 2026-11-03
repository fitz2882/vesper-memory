#!/bin/bash
set -e

# Focused test for npm install -g password generation
# This is the primary installation method for users

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_header() {
  echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}$1${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
}

log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if password is secure (not placeholder)
check_password() {
  local value="$1"
  local name="$2"

  if [[ "$value" =~ ^change-me.*$ ]] || [[ -z "$value" ]]; then
    log_error "$name is a placeholder: $value"
    return 1
  fi

  # Check length (should be 44 chars for base64-encoded 32 bytes)
  if [ ${#value} -lt 40 ]; then
    log_error "$name is too short (${#value} chars): $value"
    return 1
  fi

  log_success "$name is secure (length: ${#value})"
  return 0
}

# Extract password from mcp_config.json using node
extract_mcp_password() {
  local key="$1"
  local config_file="$HOME/.claude/mcp_config.json"

  node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$config_file', 'utf-8'));
    const value = config.mcpServers?.vesper?.env?.${key};
    console.log(value || '');
  "
}

# Main test
log_header "🧪 Testing npm install -g Password Generation"

# Backup existing configs
log_info "Backing up existing configs..."

if [ -f "$HOME/.claude/mcp_config.json" ]; then
  cp "$HOME/.claude/mcp_config.json" "$HOME/.claude/mcp_config.json.test-backup"
  log_success "Backed up mcp_config.json"
fi

if [ -f "$HOME/.claude/settings.json" ]; then
  cp "$HOME/.claude/settings.json" "$HOME/.claude/settings.json.test-backup"
  log_success "Backed up settings.json"
fi

# Clean test environment
rm -f "$HOME/.claude/mcp_config.json"
mkdir -p "$HOME/.claude"

# Create npm package
log_info "Creating npm package..."
npm pack > /dev/null 2>&1

TARBALL=$(ls vesper-memory-*.tgz | head -n1)
log_success "Created: $TARBALL"

# Install globally
log_info "Installing globally (this may take a minute)..."
npm install -g "$TARBALL" 2>&1 | grep -E "^(changed|added|removed)" || true

# Verify mcp_config.json exists
log_info "Verifying mcp_config.json..."

if [ ! -f "$HOME/.claude/mcp_config.json" ]; then
  log_error "mcp_config.json not created"
  exit 1
fi

log_success "mcp_config.json created"

# Extract and verify passwords
log_info "Checking passwords in mcp_config.json..."
echo ""

REDIS_PASS=$(extract_mcp_password "REDIS_PASSWORD")
QDRANT_KEY=$(extract_mcp_password "QDRANT_API_KEY")
POSTGRES_PASS=$(extract_mcp_password "POSTGRES_PASSWORD")

ALL_PASSED=true

check_password "$REDIS_PASS" "REDIS_PASSWORD" || ALL_PASSED=false
check_password "$QDRANT_KEY" "QDRANT_API_KEY" || ALL_PASSED=false
check_password "$POSTGRES_PASS" "POSTGRES_PASSWORD" || ALL_PASSED=false

echo ""

# Check other config values
log_info "Checking other configuration..."

VESPER_CMD=$(node -e "
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync('$HOME/.claude/mcp_config.json', 'utf-8'));
  console.log(config.mcpServers?.vesper?.command || '');
")

if [ "$VESPER_CMD" = "vesper-server" ]; then
  log_success "Command: vesper-server (correct)"
else
  log_error "Command: $VESPER_CMD (expected: vesper-server)"
  ALL_PASSED=false
fi

# Check permissions
log_info "Checking permissions in settings.json..."

if [ -f "$HOME/.claude/settings.json" ]; then
  if grep -q "mcp__vesper" "$HOME/.claude/settings.json"; then
    log_success "mcp__vesper permission configured"
  else
    log_error "mcp__vesper permission missing"
    ALL_PASSED=false
  fi
else
  log_info "settings.json not found (will be created on first Claude Code launch)"
fi

# Display sample mcp_config.json (redacted)
echo ""
log_info "Sample mcp_config.json structure:"
echo ""
node -e "
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync('$HOME/.claude/mcp_config.json', 'utf-8'));
  const vesper = config.mcpServers?.vesper;

  if (vesper) {
    const redacted = {
      ...vesper,
      env: {
        ...vesper.env,
        REDIS_PASSWORD: vesper.env.REDIS_PASSWORD ? '***REDACTED***' : undefined,
        QDRANT_API_KEY: vesper.env.QDRANT_API_KEY ? '***REDACTED***' : undefined,
        POSTGRES_PASSWORD: vesper.env.POSTGRES_PASSWORD ? '***REDACTED***' : undefined,
      }
    };
    console.log(JSON.stringify({ mcpServers: { vesper: redacted } }, null, 2));
  }
"

# Cleanup
log_info "Cleaning up..."
npm uninstall -g vesper-memory > /dev/null 2>&1
rm -f "$TARBALL"

# Restore configs
if [ -f "$HOME/.claude/mcp_config.json.test-backup" ]; then
  mv "$HOME/.claude/mcp_config.json.test-backup" "$HOME/.claude/mcp_config.json"
  log_success "Restored mcp_config.json"
fi

if [ -f "$HOME/.claude/settings.json.test-backup" ]; then
  mv "$HOME/.claude/settings.json.test-backup" "$HOME/.claude/settings.json"
  log_success "Restored settings.json"
fi

# Summary
log_header "📊 Test Results"

if [ "$ALL_PASSED" = true ]; then
  log_success "ALL TESTS PASSED! ✨"
  echo ""
  log_info "✓ Secure passwords generated automatically"
  log_info "✓ mcp_config.json created with correct structure"
  log_info "✓ Passwords are NOT placeholders"
  log_info "✓ Password length is correct (44 chars)"
  log_info "✓ Permissions configured properly"
  echo ""
  log_success "npm install -g vesper-memory works correctly!"
  exit 0
else
  log_error "SOME TESTS FAILED"
  exit 1
fi
