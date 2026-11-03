# Automatic MCP Installation Setup

## Overview

The Vesper package now automatically configures the MCP server when installed via npm. This document explains the automatic installation system.

## Changes Made

### 1. Package.json - Postinstall Script

Added a `postinstall` script that runs automatically after `npm install`:

```json
"scripts": {
  "postinstall": "node scripts/postinstall.js",
  ...
}
```

### 2. Postinstall Script (`scripts/postinstall.js`)

Created an intelligent postinstall script that:

- **Detects development mode**: Skips auto-setup when running `npm install` in the source repository
- **Detects user installation**: Runs auto-setup when installed as a package (in `node_modules`)
- **Graceful error handling**: Never breaks `npm install` if setup fails
- **Helpful messages**: Guides users on next steps

**Behavior**:
- In development (source repo): Skips auto-setup, shows manual instructions
- When installed by users: Runs `vesper configure` automatically
- If not built: Skips gracefully with helpful message
- On error: Logs error but doesn't fail npm install

### 3. CLI - New `configure` Command

Added a `vesper configure` command that:

- **Configures MCP only**: Sets up Claude Code integration without Docker
- **Reads .env file**: Loads all environment variables from .env or .env.example
- **Creates full config**: Includes all required environment variables:
  - Redis connection (host, port, password)
  - Qdrant connection (URL, API key)
  - PostgreSQL connection (host, port, database, user, password)
  - SQLite database path (absolute path resolution)
  - Embedding service URL
  - Authentication settings (API key hash, tier, scopes)
  - Rate limiting configuration
  - Application settings (NODE_ENV, LOG_LEVEL)

- **Backs up existing config**: Creates timestamped backups before modifying
- **Provides next steps**: Clear instructions for Docker startup and testing

### 4. Enhanced `install` Command

The existing `vesper install` command remains for full installation:
- Copies files to `~/.vesper`
- Starts Docker services
- Configures MCP
- Full automated setup

## Installation Flow

### For End Users

When someone installs Vesper:

```bash
npm install vesper
```

**Automatic process**:
1. Package downloads and installs
2. Postinstall script runs automatically
3. Detects it's being installed as a package
4. Runs `vesper configure`
5. Reads .env file from package
6. Creates `~/.claude/mcp_config.json` with full configuration
7. User sees success message

**User next steps**:
```bash
# Start Docker services
cd ~/.vesper && docker-compose up -d

# Restart Claude Code
# Test: "What MCP servers are available?"
```

### For Developers

When working in the source repository:

```bash
npm install
```

**Automatic process**:
1. Dependencies install
2. Postinstall script runs
3. Detects development mode (has `src/` directory, not in `node_modules`)
4. Skips auto-setup
5. Shows manual setup instructions

**Developer next steps**:
```bash
# Build the project
npm run build

# Configure MCP manually
vesper configure

# Or run full install
vesper install
```

## CLI Commands

### `vesper configure`
Configure MCP server only (lightweight, no Docker setup)

**When to use**:
- After installing via npm
- When you already have Docker services running
- When you just need to update MCP configuration

**What it does**:
- Reads .env file
- Creates/updates `~/.claude/mcp_config.json`
- Adds full environment configuration
- Backs up existing config

### `vesper install`
Full installation with Docker services (complete setup)

**When to use**:
- First-time setup
- Want automated Docker startup
- Installing to `~/.vesper` location

**What it does**:
- Creates `~/.vesper` directory
- Copies all package files
- Installs dependencies
- Starts Docker services (Redis, Qdrant, embedding)
- Configures MCP
- Full automated setup

### `vesper status`
Check installation and service status

### `vesper uninstall`
Remove Vesper completely

## MCP Configuration Structure

The `configure` command creates this MCP configuration:

```json
{
  "mcpServers": {
    "vesper": {
      "command": "node",
      "args": ["/path/to/vesper/dist/server.js"],
      "env": {
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "REDIS_PASSWORD": "...",
        "QDRANT_URL": "http://localhost:6333",
        "QDRANT_API_KEY": "...",
        "SQLITE_DB": "/absolute/path/to/data/memory.db",
        "EMBEDDING_SERVICE_URL": "http://localhost:8000",
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "memory",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "...",
        "NODE_ENV": "production",
        "LOG_LEVEL": "info",
        "AUTH_ENABLED": "false",
        "MCP_API_KEY_HASH": "...",
        "MCP_API_KEY_USER_ID": "...",
        "MCP_API_KEY_TIER": "standard",
        "MCP_API_KEY_SCOPES": "*",
        "RATE_LIMIT_DEFAULT_TIER": "standard",
        "RATE_LIMIT_FAIL_OPEN": "false"
      }
    }
  }
}
```

## Environment Variable Resolution

The configure command:

1. Looks for `.env` in package root
2. Falls back to `.env.example` if `.env` not found
3. Uses sensible defaults if neither exists
4. Resolves relative paths (e.g., `./data/memory.db`) to absolute paths
5. Preserves all environment variables for proper server operation

## Testing

To test the automatic installation:

### Simulate User Installation

```bash
# In the source repo
npm run build

# Create a test directory
mkdir /tmp/test-vesper-install
cd /tmp/test-vesper-install

# Install locally
npm install /path/to/vesper

# Should see:
# "🌟 Vesper: Configuring MCP server..."
# "✅ Vesper MCP configuration complete!"

# Check config was created
cat ~/.claude/mcp_config.json
```

### Test Development Mode

```bash
# In the source repo
npm install

# Should see:
# "📦 Vesper: Running in development mode, skipping auto-setup"
# "💡 To manually install: npm run build && vesper install"
```

## Troubleshooting

### Config Not Created

If the MCP config wasn't created automatically:

```bash
# Manual configuration
npm run build
vesper configure
```

### Missing Environment Variables

If the MCP config is missing environment variables:

```bash
# Ensure .env exists
cp .env.example .env

# Reconfigure
vesper configure
```

### Docker Services Not Running

The `configure` command doesn't start Docker services. Start them manually:

```bash
# Find vesper installation
vesper status

# Start services
cd ~/.vesper  # or package location
docker-compose up -d
```

### MCP Server Not Connecting

1. Check Claude Code MCP config: `~/.claude/mcp_config.json`
2. Verify server path exists: `cat ~/.claude/mcp_config.json | grep args`
3. Check Docker services: `vesper status`
4. Restart Claude Code
5. Check logs: `docker-compose logs`

## Benefits

### For Users
- ✅ Zero manual configuration required
- ✅ Works immediately after `npm install`
- ✅ Clear next steps provided
- ✅ All environment variables configured automatically

### For Developers
- ✅ Smart detection of development vs user installation
- ✅ Doesn't interfere with development workflow
- ✅ Easy to test both modes
- ✅ Graceful error handling

### For Maintainers
- ✅ Standardized installation process
- ✅ Reduced support burden
- ✅ Better user experience
- ✅ Proper package distribution
