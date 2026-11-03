# Fresh Installation Scripts

Complete cleanup and fresh installation scripts for Vesper Memory System.

## Overview

These scripts remove **ALL** previous installations and start completely fresh, including:
- Docker containers, volumes, and networks
- Node modules and build artifacts
- All database files and data
- Logs and temporary files
- Generated certificates (keeps scripts)

**⚠️ WARNING: ALL DATA WILL BE PERMANENTLY DELETED**

## Usage

### Option 1: Interactive (Recommended)

**Via npm:**
```bash
npm run fresh-install
```

**Via make:**
```bash
make fresh-install
```

**Via script:**
```bash
./scripts/fresh-install.sh
```

**Features:**
- Safety prompts before deletion
- Interactive .env creation
- Colored output with progress
- Next steps guidance

### Option 2: Automated (CI/CD)

**Via npm:**
```bash
npm run fresh-install:auto
```

**Via make:**
```bash
make fresh-install-auto
```

**Via script:**
```bash
./scripts/fresh-install-auto.sh
```

**Features:**
- No prompts (fully automated)
- Auto-creates .env from .env.example
- Set `AUTO_START=true` to automatically start services
- Ideal for CI/CD pipelines

**Example with auto-start:**
```bash
AUTO_START=true npm run fresh-install:auto
```

## What Gets Deleted

### Docker Resources
- All containers (stopped and running)
- All volumes (all data lost)
- All networks
- Dangling images

### Application Files
- `node_modules/` - All installed dependencies
- `package-lock.json` - Lock file
- `dist/` - Build artifacts
- `.cache/` - Build cache
- `.turbo/` - Turbo cache
- `coverage/` - Test coverage

### Data Directories
- `data/` - SQLite database and application data
- `logs/` - All log files
- `.redis-data/` - Redis persistent data
- `.postgres-data/` - PostgreSQL data
- `.qdrant-data/` - Qdrant vector data

### Certificates
- `config/ssl/*` - All certificate files (keeps .sh scripts)

## What Gets Preserved

- Source code (`src/`)
- Tests (`tests/`)
- Configuration files (`config/`)
- Docker Compose configuration
- Scripts (`.sh` files)
- `.env.example` template
- Documentation

## Installation Steps

The scripts perform these steps automatically:

1. **Stop Docker** - Gracefully stop all running containers
2. **Remove Volumes** - Delete all Docker volumes (data loss)
3. **Remove Networks** - Clean up Docker networks
4. **Clean Images** - Remove dangling images
5. **Remove Dependencies** - Delete node_modules and lock files
6. **Clean Build** - Remove all build artifacts
7. **Clean Data** - Delete all database and log files
8. **Clean Certificates** - Remove old certificates
9. **Install** - Fresh npm install
10. **Build** - Build project from source

## Post-Installation Steps

After the fresh install completes:

### 1. Configure Environment
```bash
# Edit .env with your settings
nano .env
```

**Required changes for production:**
- Set strong passwords (use `openssl rand -base64 32`)
- Enable `AUTH_ENABLED=true`
- Enable `METRICS_AUTH_ENABLED=true`
- Configure proper domain names

### 2. Generate Certificates

**Development:**
```bash
./scripts/generate-dev-certs.sh
```

**Production:**
```bash
docker-compose run --rm certbot certonly \
  --webroot --webroot-path=/var/www/certbot \
  -d your-domain.com
```

### 3. Start Services
```bash
docker-compose up -d

# Or use make
make docker-up
```

### 4. Verify Installation
```bash
# Check service status
make status

# Run tests
npm test

# Check health
curl -I http://localhost:8080/health
```

### 5. Generate API Key (Optional)
```bash
npm run generate-api-key -- --tier unlimited --name 'Development'
```

## Troubleshooting

### Permission Denied

```bash
chmod +x scripts/fresh-install.sh
chmod +x scripts/fresh-install-auto.sh
```

### Docker Issues

```bash
# If Docker services won't stop
docker ps -a | grep vesper | awk '{print $1}' | xargs docker rm -f

# If volumes won't delete
docker volume prune -f
```

### Build Fails

```bash
# Clean npm cache
npm cache clean --force

# Try again
npm run fresh-install
```

### Services Won't Start

```bash
# Check Docker daemon
docker info

# Check logs
docker-compose logs -f

# Restart Docker daemon (macOS)
killall Docker && open -a Docker
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Fresh Install Vesper
  run: npm run fresh-install:auto
  env:
    AUTO_START: true
    AUTH_ENABLED: false  # Disable for testing
```

### Docker Compose Example

```yaml
version: '3.8'
services:
  vesper-install:
    image: node:20
    volumes:
      - .:/app
    working_dir: /app
    command: /app/scripts/fresh-install-auto.sh
```

## Safety Features

### Interactive Script
- Requires explicit "yes" confirmation
- Shows detailed warning of what will be deleted
- Prompts for .env creation
- Provides next steps guidance

### Automated Script
- Designed for trusted environments only
- No user interaction required
- Logs all actions
- Returns non-zero exit code on failure

## Performance

**Typical runtime:** 2-5 minutes (depending on network speed)

**Breakdown:**
- Cleanup: 10-30 seconds
- npm install: 1-3 minutes
- Build: 30-60 seconds

## Best Practices

1. **Backup First** - Always backup important data before running
2. **Use Interactive** - Use interactive version for manual operations
3. **Use Automated** - Use automated version only for CI/CD
4. **Review Output** - Check output for any errors
5. **Verify Installation** - Run tests after installation

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review logs: `docker-compose logs -f`
3. Check Docker status: `make status`
4. File an issue: https://github.com/fitz2882/vesper-memory/issues
