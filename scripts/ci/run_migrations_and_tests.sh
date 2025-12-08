#!/usr/bin/env bash
# Helper for CI-runner: apply migrations and run integration tests locally (for dev/debug)
set -euo pipefail
cd "$(dirname "$0")/.."

# Load DB env from .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

MYSQL_HOST=${MYSQL_HOST:-127.0.0.1}
MYSQL_PORT=${MYSQL_PORT:-3306}
MYSQL_DATABASE=${MYSQL_DATABASE:-testdb}
MYSQL_USER=${MYSQL_USER:-root}
MYSQL_PASSWORD=${MYSQL_PASSWORD:-root}

# Wait until mysql is responding
for i in {1..30}; do
  if mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" -e 'SELECT 1' >/dev/null 2>&1; then
    echo "MySQL is up"
    break
  fi
  echo "Waiting for MySQL... ($i)"
  sleep 2
done

# Apply all migrations non-destructively
for f in scripts/sql/*.sql; do
  echo "Applying $f"
  mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < "$f" || true
done

# Run tests
node tests/integration/ttm_migration.test.js
node tests/integration/ttm_weekly_monthly.test.js
node tests/integration/ttm_eps_adjusted.test.js

echo "CI run complete"