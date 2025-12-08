#!/bin/bash
# check_db_status.sh
# Check the status of the metadata system database

echo "=================================="
echo "Database Status Check"
echo "=================================="
echo ""

# Check if tables exist
echo "Checking tables..."
TABLES=$(docker exec wealth-tracker-mysql mysql -uroot -proot wealth_tracker -e "SHOW TABLES;" 2>/dev/null | grep -E "securities_metadata|securities_earnings|securities_dividends")

if [ -z "$TABLES" ]; then
  echo "❌ Metadata tables NOT found"
  echo ""
  echo "Next step: Run migrations"
  echo "  for file in scripts/sql/00{2,3,4,5}_*.sql; do"
  echo "    docker exec -i wealth-tracker-mysql mysql -uroot -proot wealth_tracker < \"\$file\""
  echo "  done"
else
  echo "✓ Metadata tables found:"
  echo "$TABLES"
  echo ""
  
  # Check record counts
  echo "Record counts:"
  docker exec wealth-tracker-mysql mysql -uroot -proot wealth_tracker -e "
    SELECT 'securities_metadata' as table_name, COUNT(*) as count FROM securities_metadata
    UNION ALL
    SELECT 'securities_earnings', COUNT(*) FROM securities_earnings
    UNION ALL
    SELECT 'securities_dividends', COUNT(*) FROM securities_dividends
    UNION ALL
    SELECT 'positions', COUNT(*) FROM positions;
  " 2>/dev/null
  
  echo ""
  
  # Check positions with metadata
  LINKED=$(docker exec wealth-tracker-mysql mysql -uroot -proot wealth_tracker -e "
    SELECT COUNT(*) FROM positions WHERE metadata_symbol IS NOT NULL;
  " 2>/dev/null | tail -1)
  
  echo "Positions linked to metadata: $LINKED"
  
  if [ "$LINKED" = "0" ]; then
    echo ""
    echo "Next step: Populate metadata"
    echo "  node scripts/populate_securities_metadata.js --all"
  fi
fi

echo ""
echo "=================================="
