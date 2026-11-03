#!/bin/bash

# Vesper Fresh Installation Script (Automated - No Prompts)
# For CI/CD or automated deployments
# WARNING: This will delete all data without confirmation

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    Vesper Fresh Installation (Automated)                  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Stop Docker
echo -e "${GREEN}[1/10]${NC} Stopping Docker containers..."
docker-compose down --remove-orphans 2>/dev/null || true
# Remove any orphaned vesper containers
docker ps -a | grep vesper | awk '{print $1}' | xargs -r docker rm -f 2>/dev/null || true

# Step 2: Remove volumes
echo -e "${GREEN}[2/10]${NC} Removing Docker volumes..."
docker volume ls --filter name=memoryproject 2>/dev/null | awk 'NR>1 {print $2}' | xargs -r docker volume rm 2>/dev/null || true

# Step 3: Remove networks
echo -e "${GREEN}[3/10]${NC} Removing Docker networks..."
docker network ls --filter name=memoryproject 2>/dev/null | awk 'NR>1 {print $2}' | xargs -r docker network rm 2>/dev/null || true

# Step 4: Remove Vesper images
echo -e "${GREEN}[4/10]${NC} Removing Vesper Docker images..."
docker images --filter reference="*vesper*" --filter reference="*memoryproject*" -q 2>/dev/null | xargs -r docker rmi -f 2>/dev/null || true

# Step 5: Remove node modules
echo -e "${GREEN}[5/10]${NC} Removing node_modules..."
rm -rf node_modules package-lock.json

# Step 6: Remove build artifacts
echo -e "${GREEN}[6/10]${NC} Removing build artifacts..."
rm -rf dist/ .cache/ .turbo/ coverage/

# Step 7: Clean data
echo -e "${GREEN}[7/10]${NC} Cleaning data directories..."
rm -rf data/ logs/ .redis-data/ .postgres-data/ .qdrant-data/
mkdir -p data logs

# Step 8: Clean certificates
echo -e "${GREEN}[8/10]${NC} Cleaning certificates..."
find config/ssl -type f ! -name "*.sh" -delete 2>/dev/null || true

# Step 9: Install
echo -e "${GREEN}[9/10]${NC} Installing dependencies..."
npm install

# Step 10: Build
echo -e "${GREEN}[10/10]${NC} Building project..."
npm run build

echo ""
echo -e "${GREEN}✓ Automated fresh installation complete!${NC}"
echo ""

# Auto-create .env if it doesn't exist
if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env from .env.example${NC}"
fi

# Auto-generate development certificates if they don't exist
if [ ! -f config/ssl/server.crt ] && [ -f scripts/generate-dev-certs.sh ]; then
    echo -e "${BLUE}Generating development certificates...${NC}"
    ./scripts/generate-dev-certs.sh
    echo -e "${GREEN}✓ Development certificates generated${NC}"
fi

# Start services if AUTO_START=true
if [ "${AUTO_START}" = "true" ]; then
    echo ""
    echo -e "${BLUE}Starting Docker services...${NC}"
    docker-compose up -d
    echo -e "${GREEN}✓ Services started${NC}"
    echo ""
    echo -e "${YELLOW}Check status:${NC} make status"
else
    echo ""
    echo -e "${YELLOW}To start services:${NC} docker-compose up -d"
    echo -e "${YELLOW}Or run with:${NC} AUTO_START=true npm run fresh-install:auto"
fi

echo ""
echo -e "${GREEN}Vesper is ready! 🚀${NC}"
