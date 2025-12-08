#!/bin/bash
# run_all_migrations.sh
# Runs all security metadata migrations inside the Docker MySQL container
# This script properly handles .env credentials and executes migrations

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load environment variables from .env file
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(cat "$PROJECT_DIR/.env" | grep -v '^#' | grep -E '^MYSQL_' | xargs)
else
    echo -e "${RED}Error: .env file not found at $PROJECT_DIR/.env${NC}"
    exit 1
fi

echo "=========================================="
echo "Security Metadata Migrations"
echo "=========================================="
echo "Database: $MYSQL_DATABASE"
echo "User: $MYSQL_USER"
echo "Container: wealth-tracker-mysql"
echo ""

# Check if container is running
if ! docker ps | grep -q "wealth-tracker-mysql"; then
    echo -e "${RED}Error: MySQL container is not running${NC}"
    echo "Please run: docker compose up -d"
    exit 1
fi

echo -e "${YELLOW}Step 1: Verifying existing tables...${NC}"
EXISTING_TABLES=$(docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "SHOW TABLES;" 2>/dev/null | tail -n +2 || echo "")
echo "Current tables: $EXISTING_TABLES"
echo ""

# Run migrations in order
MIGRATIONS=(
    "002_create_securities_metadata.sql"
    "003_create_securities_earnings.sql"
    "004_create_securities_dividends.sql"
    "005_add_positions_metadata_link.sql"
)

echo -e "${YELLOW}Step 2: Running migrations...${NC}"
echo ""

for migration in "${MIGRATIONS[@]}"; do
    MIGRATION_FILE="$PROJECT_DIR/scripts/sql/$migration"
    
    if [ ! -f "$MIGRATION_FILE" ]; then
        echo -e "${RED}✗ File not found: $migration${NC}"
        continue
    fi
    
    echo -n "Running $migration... "
    
    # Execute migration inside Docker container and capture exit code
    OUTPUT=$(docker exec -i wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} < "$MIGRATION_FILE" 2>&1)
    EXIT_CODE=$?
    
    # Filter out password warning
    CLEAN_OUTPUT=$(echo "$OUTPUT" | grep -v "Warning.*password")
    
    if [ $EXIT_CODE -eq 0 ]; then
        if [ -z "$CLEAN_OUTPUT" ]; then
            echo -e "${GREEN}✓ Success${NC}"
        else
            echo -e "${GREEN}✓ Success${NC}"
            echo "  $CLEAN_OUTPUT"
        fi
    else
        # Check if it's just "already exists" 
        if echo "$OUTPUT" | grep -q "already exists"; then
            echo -e "${YELLOW}⊘ Already exists (skipped)${NC}"
        else
            echo -e "${RED}✗ Failed:${NC}"
            echo "$CLEAN_OUTPUT" | head -3
        fi
    fi
done

echo ""
echo -e "${YELLOW}Step 3: Verifying new tables...${NC}"
docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "SHOW TABLES;" 2>&1 | grep -v "Warning"

echo ""
echo -e "${YELLOW}Step 4: Checking table structure...${NC}"
for table in "securities_metadata" "securities_earnings" "securities_dividends"; do
    echo ""
    echo "=== $table ==="
    docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "DESCRIBE $table;" 2>&1 | grep -v "Warning" | head -5
    echo "..."
done

echo ""
echo "=========================================="
echo -e "${GREEN}Migrations Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Populate metadata: node scripts/populate_securities_metadata.js --all"
echo "  2. View sample data: bash scripts/show_sample_records.sh"
