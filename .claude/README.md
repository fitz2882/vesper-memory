# Local MCP Configuration

This directory contains project-specific MCP server configuration that overrides the global config.

## How It Works

**Global Config** (`~/.claude/mcp_config.json`):
- Contains `vesper-personal`
- Used for all projects by default
- Connects to ports: 6379 (Redis), 6333 (Qdrant), 8000 (Embedding)

**Local Config** (`.claude/mcp_config.json` in this project):
- Contains `vesper-dev`
- Used only when working in the Vesper project
- Connects to ports: 6380 (Redis), 6334 (Qdrant), 8001 (Embedding)

## Docker Lifecycle

When you open the Vesper project in Claude Code:
1. Startup hook detects local config
2. Starts vesper-dev Docker containers only
3. On exit, stops vesper-dev containers

When you open any other project:
1. Startup hook uses global config
2. Starts vesper-personal Docker containers
3. On exit, stops vesper-personal containers

**Result**: Only one instance runs at a time, no conflicts!

## Files

- `mcp_config.json` - Local MCP server configuration (gitignored; copy `mcp_config.example.json` and set your paths)
- This directory is gitignored to keep configs project-specific
