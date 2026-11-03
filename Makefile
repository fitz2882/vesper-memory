.PHONY: help docker-up docker-down docker-logs docker-ps docker-clean docker-reset \
         db-shell redis-cli qdrant-health redis-health postgres-health \
         backup restore fresh-install fresh-install-auto

help:
	@echo "Memory System Docker Commands"
	@echo ""
	@echo "Installation:"
	@echo "  make fresh-install          Complete fresh install (with prompts)"
	@echo "  make fresh-install-auto     Automated fresh install (no prompts)"
	@echo ""
	@echo "Infrastructure:"
	@echo "  make docker-up              Start all services"
	@echo "  make docker-down            Stop all services"
	@echo "  make docker-restart         Restart all services"
	@echo "  make docker-logs            Show logs (add SERVICE=name for specific)"
	@echo "  make docker-ps              Show service status"
	@echo "  make docker-clean           Remove stopped containers"
	@echo "  make docker-reset           Stop and remove all volumes (⚠️ data loss)"
	@echo ""
	@echo "Services:"
	@echo "  make qdrant-health          Check Qdrant health"
	@echo "  make redis-health           Check Redis health"
	@echo "  make postgres-health        Check PostgreSQL health"
	@echo ""
	@echo "Interactive:"
	@echo "  make db-shell               Connect to PostgreSQL"
	@echo "  make redis-cli              Connect to Redis CLI"
	@echo ""
	@echo "Data:"
	@echo "  make backup                 Backup PostgreSQL database"
	@echo "  make restore BACKUP=file    Restore from backup"

# Fresh installation
fresh-install:
	@./scripts/fresh-install.sh

fresh-install-auto:
	@./scripts/fresh-install-auto.sh

# Docker Compose operations
docker-up:
	docker-compose up -d
	@echo "Services starting... waiting for health checks"
	@sleep 3
	@$(MAKE) docker-ps

docker-down:
	docker-compose down

docker-restart:
	docker-compose restart

docker-logs:
	docker-compose logs -f $(SERVICE)

docker-ps:
	docker-compose ps

docker-clean:
	docker-compose down --remove-orphans
	docker system prune -f

docker-reset:
	@echo "⚠️  WARNING: This will delete ALL data in volumes"
	@echo "Proceeding in 3 seconds... (Ctrl+C to cancel)"
	@sleep 3
	docker-compose down -v
	@echo "All services and volumes removed"

# Health checks
qdrant-health:
	curl -s -H "api-key: $${QDRANT_API_KEY:-}" \
		http://localhost:6333/health | jq . || echo "Qdrant unreachable"

redis-health:
	@if [ -n "$${REDIS_PASSWORD:-}" ]; then export REDISCLI_AUTH="$$REDIS_PASSWORD"; else unset REDISCLI_AUTH; fi; redis-cli ping || echo "Redis unreachable"

postgres-health:
	psql -h localhost -U $${POSTGRES_USER:-memory_user} -d $${POSTGRES_DB:-memory} \
		-c "SELECT 'PostgreSQL is healthy' AS status;" || echo "PostgreSQL unreachable"

# Interactive shells
db-shell:
	psql -h localhost -U $${POSTGRES_USER:-memory_user} -d $${POSTGRES_DB:-memory}

redis-cli:
	@if [ -n "$${REDIS_PASSWORD:-}" ]; then export REDISCLI_AUTH="$$REDIS_PASSWORD"; else unset REDISCLI_AUTH; fi; redis-cli

# Backup and restore
backup:
	@mkdir -p backups
	@BACKUP_FILE="backups/memory_db_$$(date +%Y%m%d_%H%M%S).sql.gz" && \
	pg_dump -h localhost -U $${POSTGRES_USER:-memory_user} -d $${POSTGRES_DB:-memory} | gzip > $$BACKUP_FILE && \
	echo "Backup created: $$BACKUP_FILE"

restore:
	@if [ -z "$(BACKUP)" ]; then \
		echo "Usage: make restore BACKUP=path/to/backup.sql.gz"; \
		exit 1; \
	fi
	@echo "Restoring from $(BACKUP)..."
	gunzip -c $(BACKUP) | psql -h localhost -U $${POSTGRES_USER:-memory_user} -d $${POSTGRES_DB:-memory}
	@echo "Restore complete"

# Development utilities
env-setup:
	@if [ ! -f .env ]; then \
		cp .env.example .env && \
		echo ".env created from .env.example"; \
		echo "Edit .env and set secure values for production"; \
	else \
		echo ".env already exists"; \
	fi

logs-qdrant:
	docker-compose logs -f qdrant

logs-redis:
	docker-compose logs -f redis

logs-postgres:
	docker-compose logs -f postgres

# Status summary
status:
	@echo "=== Docker Services Status ==="
	@docker-compose ps
	@echo ""
	@echo "=== Health Checks ==="
	@echo -n "Qdrant: "
	@$(MAKE) -s qdrant-health 2>/dev/null | head -1 || echo "❌ Unreachable"
	@echo -n "Redis: "
	@$(MAKE) -s redis-health 2>/dev/null || echo "❌ Unreachable"
	@echo -n "PostgreSQL: "
	@$(MAKE) -s postgres-health 2>/dev/null | head -1 || echo "❌ Unreachable"

# Docker system information
docker-info:
	docker system df
	@echo ""
	@echo "Memory Network:"
	docker network inspect memory-network | grep -A 20 "Containers"
	@echo ""
	@echo "Volumes:"
	docker volume ls | grep memory
