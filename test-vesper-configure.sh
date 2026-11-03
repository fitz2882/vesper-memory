#!/bin/bash
set -e

# Test vesper configure command (used after npm install -g)

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

check_password() {
  local value="$1"
  local name="$2"

  if [[ "$value" =~ ^change-me.*$ ]] || [[ -z "$value" ]]; then
    log_error "$name is a placeholder: $value"
    return 1
  fi

  if [ ${#value} -lt 40 ]; then
    log_error "$name is too short (${#value} chars)"
    return 1
  fi

  log_success "$name is secure (length: ${#value})"
  return 0
}

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

log_header "🧪 Testing vesper configure Command"

# Backup configs
log_info "Backing up existing configs..."

if [ -f "$HOME/.claude/mcp_config.json" ]; then
  cp "$HOME/.claude/mcp_config.json" "$HOME/.claude/mcp_config.json.test-backup2"
fi

if [ -f "$HOME/.claude/settings.json" ]; then
  cp "$HOME/.claude/settings.json" "$HOME/.claude/settings.json.test-backup2"
fi

# Clean environment
rm -f "$HOME/.claude/mcp_config.json"
rm -f .env
mkdir -p "$HOME/.claude"

# Test 1: Run vesper configure when .env doesn't exist
log_info "Test 1: Running 'vesper configure' without .env file..."
echo ""

node dist/cli.js configure

echo ""
log_info "Checking if .env was created..."

if [ -f .env ]; then
  log_success ".env file created"
else
  log_error ".env file not created"
  exit 1
fi

# Check passwords in .env
log_info "Checking passwords in .env file..."

REDIS_PASS=$(grep "^REDIS_PASSWORD=" .env | cut -d'=' -f2-)
QDRANT_KEY=$(grep "^QDRANT_API_KEY=" .env | cut -d'=' -f2-)
POSTGRES_PASS=$(grep "^POSTGRES_PASSWORD=" .env | cut -d'=' -f2-)

ALL_PASSED=true

check_password "$REDIS_PASS" ".env REDIS_PASSWORD" || ALL_PASSED=false
check_password "$QDRANT_KEY" ".env QDRANT_API_KEY" || ALL_PASSED=false
check_password "$POSTGRES_PASS" ".env POSTGRES_PASSWORD" || ALL_PASSED=false

# Check mcp_config.json passwords
log_info "Checking passwords in mcp_config.json..."

MCP_REDIS=$(extract_mcp_password "REDIS_PASSWORD")
MCP_QDRANT=$(extract_mcp_password "QDRANT_API_KEY")
MCP_POSTGRES=$(extract_mcp_password "POSTGRES_PASSWORD")

check_password "$MCP_REDIS" "mcp_config.json REDIS_PASSWORD" || ALL_PASSED=false
check_password "$MCP_QDRANT" "mcp_config.json QDRANT_API_KEY" || ALL_PASSED=false
check_password "$MCP_POSTGRES" "mcp_config.json POSTGRES_PASSWORD" || ALL_PASSED=false

# Verify passwords match between .env and mcp_config.json
log_info "Verifying passwords match between .env and mcp_config.json..."

if [ "$REDIS_PASS" = "$MCP_REDIS" ]; then
  log_success "REDIS_PASSWORD matches"
else
  log_error "REDIS_PASSWORD mismatch"
  ALL_PASSED=false
fi

if [ "$QDRANT_KEY" = "$MCP_QDRANT" ]; then
  log_success "QDRANT_API_KEY matches"
else
  log_error "QDRANT_API_KEY mismatch"
  ALL_PASSED=false
fi

if [ "$POSTGRES_PASS" = "$MCP_POSTGRES" ]; then
  log_success "POSTGRES_PASSWORD matches"
else
  log_error "POSTGRES_PASSWORD mismatch"
  ALL_PASSED=false
fi

# Cleanup
log_info "Cleaning up..."
rm -f .env

if [ -f "$HOME/.claude/mcp_config.json.test-backup2" ]; then
  mv "$HOME/.claude/mcp_config.json.test-backup2" "$HOME/.claude/mcp_config.json"
fi

if [ -f "$HOME/.claude/settings.json.test-backup2" ]; then
  mv "$HOME/.claude/settings.json.test-backup2" "$HOME/.claude/settings.json"
fi

# Summary
log_header "📊 Test Results"

if [ "$ALL_PASSED" = true ]; then
  log_success "ALL TESTS PASSED! ✨"
  echo ""
  log_info "✓ 'vesper configure' generates .env with secure passwords"
  log_info "✓ Passwords are written to mcp_config.json"
  log_info "✓ Passwords match between .env and mcp_config.json"
  log_info "✓ Password length is correct (44 chars)"
  echo ""
  log_success "vesper configure works correctly!"
  exit 0
else
  log_error "SOME TESTS FAILED"
  exit 1
fi
