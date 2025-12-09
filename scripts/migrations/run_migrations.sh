#!/bin/bash
# run_migrations.sh
# Helper script to run migrations with credentials from .env

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
else
  echo "Error: .env file not found"
  exit 1
fi

echo "Running migrations with credentials from .env..."
echo "Database: $MYSQL_DATABASE"
echo "User: $MYSQL_USER"
echo ""

# Run migrations
for file in scripts/sql/00{2,3,4,5}_*.sql; do
  echo "Running $(basename $file)..."
  if docker exec -i wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} < "$file" 2>&1 | grep -v "Warning"; then
    echo "✓ Success"
  else
    echo "✗ Failed"
    exit 1
  fi
  echo ""
done

echo "All migrations completed!"
echo ""
echo "Verifying tables..."
docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "SHOW TABLES;" 2>&1 | grep -v "Warning"
