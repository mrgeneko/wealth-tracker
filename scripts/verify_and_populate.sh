#!/bin/bash
# verify_and_populate.sh
# Verify migrations and populate metadata

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
else
  echo "Error: .env file not found"
  exit 1
fi

echo "========================================="
echo "Verifying Database Setup"
echo "========================================="
echo ""

# Check tables
echo "Tables in database:"
docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "SHOW TABLES;" 2>&1 | grep -v "Warning"
echo ""

# Check positions
echo "Sample positions:"
docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "SELECT DISTINCT symbol FROM positions WHERE symbol IS NOT NULL AND symbol != 'CASH' LIMIT 10;" 2>&1 | grep -v "Warning"
echo ""

# Count positions
POSITION_COUNT=$(docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "SELECT COUNT(DISTINCT symbol) FROM positions WHERE symbol IS NOT NULL AND symbol != 'CASH';" 2>&1 | grep -v "Warning" | tail -1)
echo "Unique symbols in positions: $POSITION_COUNT"
echo ""

if [ "$POSITION_COUNT" -gt 0 ]; then
  echo "========================================="
  echo "Populating Metadata"
  echo "========================================="
  echo "This will fetch metadata for $POSITION_COUNT symbols from Yahoo Finance..."
  echo ""
  
  node scripts/populate/populate_securities_metadata.js --all
  
  echo ""
  echo "========================================="
  echo "Verification"
  echo "========================================="
  echo ""
  
  # Check metadata count
  echo "Metadata records:"
  docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "SELECT COUNT(*) as count FROM securities_metadata;" 2>&1 | grep -v "Warning"
  echo ""
  
  # Show sample
  echo "Sample metadata:"
  docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "SELECT symbol, short_name, quote_type, exchange FROM securities_metadata LIMIT 5;" 2>&1 | grep -v "Warning"
else
  echo "No positions found. Skipping metadata population."
fi
