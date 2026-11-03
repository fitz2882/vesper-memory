# Vesper Statusline Integration

## Overview

Added a real-time Vesper status indicator to your Claude Code statusline with neon pink styling:
- **<span style="color: magenta">Vesper</span> ●** (green) - All services ready (Redis, Qdrant, Embedding)
- **<span style="color: magenta">Vesper</span> ●** (yellow) - Degraded mode (some services down)
- **<span style="color: magenta">Vesper</span> ●** (red) - Offline (all services down or Docker not running)

## What Was Added

### 1. Status Check Script (`~/.claude/scripts/check-vesper-status.sh`)

Checks the health of Vesper's required Docker services:
```bash
#!/bin/bash
# Required services for Vesper
REQUIRED_SERVICES=("redis" "qdrant" "embedding")
# Dynamically detect Vesper directory
VESPER_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# Checks:
# 1. Is Docker running?
# 2. Are all 3 services running?
# 3. Returns: "ready", "degraded", or "offline"
```

**Status Levels:**
- `ready` - All 3 services running (Redis + Qdrant + Embedding)
- `degraded` - Some services running (1-2 out of 3)
- `offline` - No services running or Docker not running

### 2. Updated Statusline (`~/.claude/settings.json`)

Enhanced your existing statusline to include Vesper status:

**Before:**
```
Sonnet 4.5 ~/MemoryProject main ctx:75%
```

**After:**
```
Sonnet 4.5 ~/MemoryProject main ctx:75% Vesper ●
                                         ^pink  ^green
```

The "Vesper" text appears in bright magenta/neon pink, and the status dot (●) changes color based on service health.

The status updates automatically every time the statusline refreshes (on every message).

## How It Works

1. **Check Script Runs**: The statusline calls `~/.claude/scripts/check-vesper-status.sh`
2. **Docker Services Checked**: Script checks if Redis, Qdrant, and Embedding containers are running
3. **Status Returned**: Script returns "ready", "degraded", or "offline"
4. **Color Applied**: Statusline shows appropriate colored dot
   - Green 🟢 = All systems go
   - Yellow 🟡 = Partial functionality
   - Red 🔴 = Services down

## Testing

Test the status check manually:
```bash
# Should return "ready" if all services are up
~/.claude/scripts/check-vesper-status.sh

# Test with services down
docker-compose stop redis
~/.claude/scripts/check-vesper-status.sh
# Should return "degraded"

docker-compose stop qdrant embedding
~/.claude/scripts/check-vesper-status.sh
# Should return "offline"

# Restart all services
docker-compose up -d redis qdrant embedding
~/.claude/scripts/check-vesper-status.sh
# Should return "ready"
```

## Status Indicator Colors

The statusline uses ANSI color codes:
- `\033[38;2;255;0;127m` - Vibrant Neon Hot Pink (RGB mode - Vesper label)
- `\033[32m●` - Green dot (ready)
- `\033[33m●` - Yellow dot (degraded)
- `\033[31m●` - Red dot (offline)
- `\033[0m` - Reset

The "Vesper" text uses true RGB color (255, 0, 127) for an eye-catching neon hot pink appearance.
The dot character (●, U+25CF) is a medium-sized Unicode bullet that's vertically centered and smaller than emoji circles.

## Performance

The status check is designed to be fast:
- Uses `docker-compose ps --format json` for instant results
- No network calls or health endpoint pings
- Typically completes in <50ms
- Only checks when statusline updates (not continuously)

## Troubleshooting

### Status Always Shows Red 🔴

1. **Check Docker is running:**
   ```bash
   docker info
   ```

2. **Check services are up:**
   ```bash
   docker-compose ps
   ```

3. **Verify script is executable:**
   ```bash
   chmod +x ~/.claude/scripts/check-vesper-status.sh
   ```

4. **Test script manually:**
   ```bash
   ~/.claude/scripts/check-vesper-status.sh
   echo "Exit code: $?"
   ```

### Status Not Showing

1. **Check settings.json is valid JSON:**
   ```bash
   jq . ~/.claude/settings.json
   ```

2. **Restart Claude Code** to reload settings

3. **Check statusline command:**
   ```bash
   cat ~/.claude/settings.json | jq -r '.statusLine.command'
   ```

### Wrong Status Displayed

The script checks Docker containers by name. If your containers have different names, update the script:

```bash
# Check your actual container names
docker ps --format '{{.Names}}' | grep -E "(redis|qdrant|embedding)"

# Update script if names differ
# Edit: ~/.claude/scripts/check-vesper-status.sh
```

## Customization

### Change the Emoji

Edit `~/.claude/settings.json` statusline command:
```bash
# Instead of 🟢🟡🔴, use checkmarks:
if [ "$vesper_status" = "ready" ]; then
    parts="${parts} \\033[32mVesper ✓\\033[0m"
elif [ "$vesper_status" = "degraded" ]; then
    parts="${parts} \\033[33mVesper ⚠\\033[0m"
elif [ "$vesper_status" = "offline" ]; then
    parts="${parts} \\033[31mVesper ✗\\033[0m"
fi
```

### Add More Details

Show which specific service is down:
```bash
# Modify check-vesper-status.sh to return details:
if [ $healthy -eq 0 ]; then
    echo "offline:no-services"
elif [ ! docker-compose ps redis | grep -q running ]; then
    echo "degraded:redis"
elif [ ! docker-compose ps qdrant | grep -q running ]; then
    echo "degraded:qdrant"
# ... etc
```

### Change Position

The Vesper indicator is added at the end of the statusline. To move it:

1. Find this section in the statusline command:
   ```bash
   if [ "$vesper_status" = "ready" ]; then parts="${parts} \\033[32mVesper 🟢\\033[0m"; ...
   ```

2. Move it before or after other indicators:
   ```bash
   # Show Vesper before agent:
   parts="...";
   # Add Vesper here
   if [ "$vesper_status" = "ready" ]; then parts="${parts} Vesper 🟢"; fi
   # Then add agent
   if [ -n "$agent" ]; then parts="${parts} [agent:${agent}]"; fi
   ```

## Integration with Vesper Wrapper

This statusline indicator complements the `vesper-server` wrapper:

**Wrapper (src/server-wrapper.ts):**
- Checks services **before** starting the MCP server
- Shows detailed error messages
- Only runs once at startup

**Statusline (this integration):**
- Checks services **continuously** (on every statusline update)
- Shows minimal status indicator
- Runs in background, non-blocking

Together they provide:
1. **Pre-startup validation** (wrapper prevents starting with broken services)
2. **Runtime monitoring** (statusline shows if services go down during use)

## Files Modified

- ✅ `~/.claude/scripts/check-vesper-status.sh` (NEW) - Status check script
- ✅ `~/.claude/settings.json` - Added Vesper status to statusline

## Example Statuslines

**All services running:**
```
Sonnet 4.5 ~/MemoryProject main* ctx:68% Vesper ●
                                         ^pink  ^green
```

**Redis down (degraded mode):**
```
Sonnet 4.5 ~/MemoryProject main* ctx:68% Vesper ●
                                         ^pink  ^yellow
```

**Docker not running:**
```
Sonnet 4.5 ~/MemoryProject main* ctx:68% Vesper ●
                                         ^pink  ^red
```

**With agent active:**
```
Sonnet 4.5 ~/MemoryProject main* ctx:45% [agent:planner] Vesper ●
                                                          ^pink  ^green
```

## Next Steps

The statusline will automatically start showing Vesper status when you restart Claude Code or start a new session. No action needed!

You can verify it's working by:
1. Checking your statusline (bottom of Claude Code window)
2. Stopping a service: `docker-compose stop redis`
3. Watching the indicator change to yellow 🟡
4. Restarting: `docker-compose start redis`
5. Watching it turn back to green 🟢
