#!/bin/bash

# Vesper Fresh Installation Script
# This script removes all previous installations and starts completely fresh
# WARNING: This will delete all data, containers, volumes, and build artifacts

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print banner
echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║         Vesper Memory System - Fresh Installation         ║"
echo "║                     Complete Cleanup                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Warning prompt
echo -e "${YELLOW}⚠️  WARNING: This script will:${NC}"
echo "   • Stop and remove ALL Docker containers for Vesper"
echo "   • Delete ALL Docker volumes (all data will be lost)"
echo "   • Remove Docker networks"
echo "   • Delete node_modules and package-lock.json"
echo "   • Delete build artifacts (dist/)"
echo "   • Delete all database files"
echo "   • Delete all logs and temporary files"
echo ""
echo -e "${RED}   ALL DATA WILL BE PERMANENTLY DELETED!${NC}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
echo
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]
then
    echo -e "${YELLOW}Installation cancelled.${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}Starting fresh installation...${NC}"
echo ""

# Step 1: Stop and remove Docker containers
echo -e "${GREEN}[1/10]${NC} Stopping Docker containers..."
if [ -f docker-compose.yml ]; then
    docker-compose down --remove-orphans 2>/dev/null || true
fi
# Remove any orphaned vesper containers not in docker-compose
docker ps -a | grep vesper | awk '{print $1}' | xargs -r docker rm -f 2>/dev/null || true
echo "   ✓ Docker containers stopped"

# Step 2: Remove Docker volumes
echo -e "${GREEN}[2/10]${NC} Removing Docker volumes..."
docker volume ls --filter name=memoryproject 2>/dev/null | awk 'NR>1 {print $2}' | xargs -r docker volume rm 2>/dev/null || true
echo "   ✓ Docker volumes removed"

# Step 3: Remove Docker networks
echo -e "${GREEN}[3/10]${NC} Removing Docker networks..."
docker network ls --filter name=memoryproject 2>/dev/null | awk 'NR>1 {print $2}' | xargs -r docker network rm 2>/dev/null || true
echo "   ✓ Docker networks removed"

# Step 4: Remove Vesper Docker images
echo -e "${GREEN}[4/10]${NC} Removing Vesper Docker images..."
docker images --filter reference="*vesper*" --filter reference="*memoryproject*" -q 2>/dev/null | xargs -r docker rmi -f 2>/dev/null || true
echo "   ✓ Vesper images removed"

# Step 5: Remove node_modules and package-lock.json
echo -e "${GREEN}[5/10]${NC} Removing node_modules and lock files..."
rm -rf node_modules
rm -f package-lock.json
echo "   ✓ Node dependencies removed"

# Step 6: Remove build artifacts
echo -e "${GREEN}[6/10]${NC} Removing build artifacts..."
rm -rf dist/
rm -rf .cache/
rm -rf .turbo/
rm -rf coverage/
echo "   ✓ Build artifacts removed"

# Step 7: Remove data directories
echo -e "${GREEN}[7/10]${NC} Removing data directories..."
rm -rf data/
mkdir -p data
rm -rf logs/
mkdir -p logs
rm -rf .redis-data/
rm -rf .postgres-data/
rm -rf .qdrant-data/
echo "   ✓ Data directories cleaned"

# Step 8: Remove certificate files (except scripts)
echo -e "${GREEN}[8/10]${NC} Cleaning certificate directories..."
find config/ssl -type f ! -name "*.sh" -delete 2>/dev/null || true
echo "   ✓ Old certificates removed"

# Step 9: Fresh npm install
echo -e "${GREEN}[9/10]${NC} Installing dependencies (this may take a few minutes)..."
npm install
echo "   ✓ Dependencies installed"

# Step 10: Build the project
echo -e "${GREEN}[10/10]${NC} Building project..."
npm run build
echo "   ✓ Project built successfully"

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Fresh installation complete!${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# Auto-create .env if it doesn't exist
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found${NC}"
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}✓ Created .env from .env.example${NC}"
    else
        echo -e "${RED}✗ .env.example not found${NC}"
    fi
fi

# Auto-generate development certificates if they don't exist
if [ ! -f config/ssl/server.crt ] && [ -f scripts/generate-dev-certs.sh ]; then
    echo ""
    echo -e "${BLUE}Generating development certificates...${NC}"
    ./scripts/generate-dev-certs.sh
    echo -e "${GREEN}✓ Development certificates generated${NC}"
fi

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Installation complete!${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# Ask if user wants to start services now
read -p "Would you like to start Docker services now? (yes/no): " -r
echo
if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo -e "${BLUE}Starting Docker services...${NC}"
    docker-compose up -d
    echo ""
    echo -e "${GREEN}✓ Services started!${NC}"
    echo ""
    echo -e "${YELLOW}Check status with:${NC} ${BLUE}make status${NC}"
    echo -e "${YELLOW}View logs with:${NC} ${BLUE}docker-compose logs -f${NC}"
else
    echo ""
    echo -e "${YELLOW}To start services later, run:${NC}"
    echo -e "  ${BLUE}docker-compose up -d${NC}"
fi

echo ""
echo -e "${YELLOW}Optional next steps:${NC}"
echo -e "  • Run tests: ${BLUE}npm test${NC}"
echo -e "  • Generate API key: ${BLUE}npm run generate-api-key -- --tier unlimited --name 'Development'${NC}"
echo -e "  • Edit .env: ${BLUE}nano .env${NC}"
echo ""
echo -e "${GREEN}Vesper is ready! 🚀${NC}"
echo ""
