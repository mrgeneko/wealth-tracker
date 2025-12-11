#!/bin/bash

# Fresh Container Startup Validation Script
# Run before: docker compose up
# Usage: ./scripts/validate-fresh-container.sh

set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Fresh Container Startup Validation${NC}"
echo -e "${BLUE}═════════════════════════════════════════════════════════════${NC}\n"

ERRORS=0
WARNINGS=0

# Check if .env exists
echo -e "${BLUE}1. Checking .env configuration...${NC}"
if [ ! -f .env ]; then
    echo -e "${RED}❌ ERROR: .env file not found${NC}"
    echo "   Please create .env from template:"
    echo "   cp .env.example .env"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✓${NC} .env file exists"
    
    # Check required env variables
    source .env
    
    if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
        echo -e "${RED}❌ ERROR: MYSQL_ROOT_PASSWORD not set in .env${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✓${NC} MYSQL_ROOT_PASSWORD set"
    fi
    
    if [ -z "$MYSQL_DATABASE" ]; then
        echo -e "${RED}❌ ERROR: MYSQL_DATABASE not set in .env${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✓${NC} MYSQL_DATABASE set"
    fi
    
    if [ -z "$MYSQL_USER" ]; then
        echo -e "${RED}❌ ERROR: MYSQL_USER not set in .env${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✓${NC} MYSQL_USER set"
    fi
    
    if [ -z "$BASIC_AUTH_USER" ]; then
        echo -e "${RED}❌ ERROR: BASIC_AUTH_USER not set in .env${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✓${NC} BASIC_AUTH_USER set"
    fi
fi

echo ""

# Check required files
echo -e "${BLUE}2. Checking required data files...${NC}"

REQUIRED_FILES=(
    "config/assets_liabilities.json:Account data"
    "config/nasdaq-listed.csv:NASDAQ symbols"
    "config/nyse-listed.csv:NYSE symbols"
    "config/other-listed.csv:Other exchange symbols"
    "config/us-treasury-auctions.csv:Treasury auction data"
)

for file_entry in "${REQUIRED_FILES[@]}"; do
    IFS=':' read -r file desc <<< "$file_entry"
    if [ ! -f "$file" ]; then
        echo -e "${YELLOW}⚠${NC}  WARNING: $file not found ($desc)"
        echo "     Autocomplete and symbol registry will be limited"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "${GREEN}✓${NC} $file exists"
    fi
done

echo ""

# Check port availability
echo -e "${BLUE}3. Checking port availability...${NC}"

PORTS=(
    "3001:Dashboard"
    "3306:MySQL"
    "9092:Kafka"
    "2181:Zookeeper"
)

for port_entry in "${PORTS[@]}"; do
    IFS=':' read -r port desc <<< "$port_entry"
    if command -v lsof &> /dev/null; then
        if lsof -i :$port > /dev/null 2>&1; then
            echo -e "${RED}❌ ERROR: Port $port ($desc) is already in use${NC}"
            echo "   Stop the service using this port or change docker-compose port mapping"
            ERRORS=$((ERRORS + 1))
        else
            echo -e "${GREEN}✓${NC} Port $port available ($desc)"
        fi
    else
        echo -e "${YELLOW}⚠${NC}  Cannot check port $port (lsof not available)"
    fi
done

echo ""

# Check Docker and Docker Compose
echo -e "${BLUE}4. Checking Docker setup...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ ERROR: Docker not installed${NC}"
    ERRORS=$((ERRORS + 1))
else
    DOCKER_VERSION=$(docker --version)
    echo -e "${GREEN}✓${NC} Docker installed: $DOCKER_VERSION"
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ ERROR: Docker Compose not installed${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✓${NC} Docker Compose available"
fi

echo ""

# Check existing containers/volumes
echo -e "${BLUE}5. Checking for existing instances...${NC}"

if docker ps -a --filter "name=wealth-tracker" | grep -q "wealth-tracker"; then
    echo -e "${YELLOW}⚠${NC}  Found existing wealth-tracker containers"
    echo "   These will be restarted/updated by 'docker compose up'"
else
    echo -e "${GREEN}✓${NC} No existing containers found"
fi

if docker volume ls | grep -q "wealth-tracker"; then
    echo -e "${YELLOW}⚠${NC}  Found existing wealth-tracker volumes"
    echo "   Data will be preserved. Run 'docker compose down -v' to reset"
fi

echo ""

# Summary
echo -e "${BLUE}═════════════════════════════════════════════════════════════${NC}"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Ready to start containers.${NC}"
    echo ""
    echo -e "Next steps:"
    echo -e "  1. ${BLUE}docker compose up${NC}"
    echo -e "  2. Wait 30 seconds for initialization"
    echo -e "  3. Open ${BLUE}http://localhost:3001${NC}"
    echo ""
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ ${WARNINGS} warnings found, but ready to proceed${NC}"
    echo ""
    echo -e "Next steps:"
    echo -e "  1. ${BLUE}docker compose up${NC}"
    echo -e "  2. Some features may be limited (autocomplete, symbol search)"
    echo ""
    exit 0
else
    echo -e "${RED}❌ ${ERRORS} critical errors found. Cannot proceed.${NC}"
    echo ""
    echo "Fix the errors above and try again:"
    echo -e "  ${BLUE}./scripts/validate-fresh-container.sh${NC}"
    echo ""
    exit 1
fi
