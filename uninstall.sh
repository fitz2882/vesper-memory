#!/bin/bash
# Memory MCP - Uninstaller

set -e

echo "Uninstalling Memory MCP..."

# Stop and remove service
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    systemctl --user stop memory-mcp || true
    systemctl --user disable memory-mcp || true
    rm -f "$HOME/.config/systemd/user/memory-mcp.service"
    systemctl --user daemon-reload
elif [[ "$OSTYPE" == "darwin"* ]]; then
    launchctl stop com.memory-mcp.server || true
    launchctl unload "$HOME/Library/LaunchAgents/com.memory-mcp.server.plist" || true
    rm -f "$HOME/Library/LaunchAgents/com.memory-mcp.server.plist"
fi

# Stop Docker services
docker-compose down -v

# Remove MCP config
if [ -f "$HOME/.claude/mcp_config.json.backup"* ]; then
    echo "Restoring backup MCP config..."
    LATEST_BACKUP=$(ls -t "$HOME/.claude/mcp_config.json.backup"* | head -1)
    cp "$LATEST_BACKUP" "$HOME/.claude/mcp_config.json"
else
    rm -f "$HOME/.claude/mcp_config.json"
fi

echo "✓ Memory MCP uninstalled"
echo "Note: Data files in data/ and logs/ were preserved"
echo "To completely remove: rm -rf data/ logs/ backups/"
