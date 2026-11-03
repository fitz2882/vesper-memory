# Docker Infrastructure Setup

This directory contains a production-ready Docker Compose configuration for the Memory System infrastructure.

## Services

### Qdrant (Vector Database)
- **Purpose**: Dense vector storage for embeddings and hybrid search
- **Port**: 6333
- **Storage**: Persistent volume at `qdrant_storage`
- **API Key**: Secured via environment variable

### Redis (Cache Layer)
- **Purpose**: Working memory cache and semantic caching
- **Port**: 6379
- **Storage**: AOF persistence at `redis_storage`
- **Password**: Secured via environment variable

### PostgreSQL (Metadata Store)
- **Purpose**: Metadata, relationships, temporal events, and conflict detection
- **Port**: 5432
- **Database**: `memory` (configurable)
- **Storage**: Persistent volume at `postgres_storage`
- **Initialization**: Automatic schema setup via `config/postgres-init.sql`

## Quick Start

### 1. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and update the following security-critical values:
- `QDRANT_API_KEY`
- `REDIS_PASSWORD`
- `POSTGRES_PASSWORD`

For development, defaults are acceptable. **For production, use strong random values.**

### 2. Start Services

```bash
docker-compose up -d
```

Wait for all services to be healthy:

```bash
docker-compose ps
```

All services should show `healthy` status.

### 3. Verify Connectivity

**Qdrant**:
```bash
curl -H "api-key: your-qdrant-api-key" http://localhost:6333/health
```

**Redis**:
```bash
redis-cli -a your-redis-password ping
```

**PostgreSQL**:
```bash
psql -h localhost -U memory_user -d memory -c "SELECT version();"
```

## Docker Compose Commands

### View logs
```bash
docker-compose logs -f [service-name]  # e.g., qdrant, redis, postgres
```

### Restart a service
```bash
docker-compose restart [service-name]
```

### Stop all services
```bash
docker-compose down
```

### Stop and remove volumes (clean reset)
```bash
docker-compose down -v
```

## Health Checks

Each service includes health checks with:
- **Interval**: 10 seconds
- **Timeout**: 5 seconds
- **Retries**: 5 attempts before marking unhealthy
- **Start Period**: 10 seconds (grace period for startup)

View health status:
```bash
docker-compose ps
docker-compose exec [service-name] [health-check-command]
```

## Network Configuration

All services are connected via the `memory-network` bridge network:
- Enables service-to-service communication by container name
- Isolated from other Docker networks
- Services can reference each other (e.g., `redis:6379` from Node.js)

## Volume Management

Three persistent volumes ensure data survives container restarts:
- `qdrant_storage`: Vector database indices
- `redis_storage`: Cached data and working memory
- `postgres_storage`: All metadata and relationships

To inspect volumes:
```bash
docker volume ls | grep memory
docker volume inspect memory_postgres_storage
```

## PostgreSQL Schema

The initialization script (`config/postgres-init.sql`) creates:

### Core Tables
- `memory_nodes`: Individual memories with metadata
- `memory_relationships`: Connections between memories
- `temporal_events`: Audit log of all changes
- `conflicts`: Detected contradictions
- `consolidation_sessions`: Sleep-phase operations

### Indexes
- Optimized for common queries (user_id, memory_type, timestamps)
- Full-text search support on content
- Composite indexes for multi-column queries

### Triggers
- Automatic `updated_at` timestamp updates

### Extensions
- UUID generation (`uuid-ossp`)
- Full-text search (`pg_trgm`)
- GIN indexes for performance (`btree_gin`)

## Security Considerations

### Development
- Default credentials are acceptable for local development
- Services bound to `localhost` (127.0.0.1)
- No authentication required for local development

### Production
1. **Strong Secrets**: Generate 32+ character random strings for all passwords
2. **Network Isolation**: Use private networks, not exposed to internet
3. **API Keys**: Rotate regularly; Qdrant API key should be changed monthly
4. **Database Backups**: Regular backups of `postgres_storage` volume
5. **Redis**: Consider requiring authentication; disable dangerous commands
6. **Qdrant**: Enable read-only replicas for high-availability setups
7. **Secrets Management**: Use Docker Secrets or external secret management (Vault, AWS Secrets Manager)

## Troubleshooting

### Service won't start
```bash
docker-compose logs [service-name]
```

### Health check failing
- Wait 15-20 seconds for startup
- Check resource constraints (memory, CPU)
- Verify port conflicts: `lsof -i :[port]`

### Connection refused errors
- Ensure all services are running: `docker-compose ps`
- Verify correct hostnames (use container names, not localhost, from other containers)
- Check network: `docker network inspect memory-network`

### Data persistence issues
- Verify volumes exist: `docker volume ls | grep memory`
- Check volume mounts: `docker inspect [container-id]`
- Ensure write permissions on host machine

## Integration with Application

When the Node.js application is ready, connect using:

**Qdrant**:
```typescript
const qdrant = new QdrantClient({
  url: "http://qdrant:6333",
  apiKey: process.env.QDRANT_API_KEY,
});
```

**Redis**:
```typescript
const redis = new Redis({
  host: "redis",
  port: 6379,
  password: process.env.REDIS_PASSWORD,
});
```

**PostgreSQL**:
```typescript
const pool = new Pool({
  host: "postgres",
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});
```

## Resource Recommendations

### Development
- RAM: 4GB total (Qdrant: 1GB, Redis: 512MB, PostgreSQL: 1GB, buffer: 1.5GB)
- CPU: 2 cores
- Storage: 20GB

### Production
- RAM: 16GB+ (Qdrant: 8GB, Redis: 2GB, PostgreSQL: 4GB, buffer: 2GB)
- CPU: 4+ cores
- Storage: 100GB+ (scale with memory node count)

Adjust resource limits in `docker-compose.yml` if needed:
```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
```

## Maintenance

### Regular Tasks
- **Weekly**: Check disk space on volumes
- **Monthly**: Review and optimize slow queries in PostgreSQL
- **Monthly**: Rotate API keys and passwords
- **Quarterly**: Full backup of all data volumes

### Upgrade Services
```bash
# Pull latest images
docker-compose pull

# Restart services with new images
docker-compose up -d
```

## Cleanup

Remove all containers, networks, and volumes:
```bash
docker-compose down -v
```

This is useful for testing and development but **irreversible for production**.
