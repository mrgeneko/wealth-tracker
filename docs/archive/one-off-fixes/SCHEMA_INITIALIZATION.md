# Schema Initialization Architecture

## Overview

The wealth-tracker system uses a **dual-path schema initialization** approach to ensure databases are properly initialized in all scenarios:

1. **Fresh containers** - Initialized by Docker MySQL init scripts on first startup
2. **Existing containers** - Updated by Node.js-based migration system on app startup

## Paths

### Path 1: Docker Initialization (Fresh Containers)

**Location:** `scripts/init-db/`

**Trigger:** Automatic on first MySQL container creation

**Files:**
- `001-symbol-registry.sql` - Symbol registry tables (symbol_registry, symbol_registry_metrics, file_refresh_status)
- `002-phase9-metrics.sql` - WebSocket metrics tables (scraper_page_performance, scraper_daily_summary, scheduler_metrics)

**Pros:**
- ✅ Fast - runs before app starts
- ✅ Automatic - no code execution required
- ✅ Reliable - Docker-native mechanism
- ✅ Tested - runs only on fresh containers

**Cons:**
- ❌ Only runs on first container creation
- ❌ Can't be re-run without volume deletion
- ❌ Requires mysql:/var/lib/mysql volume

### Path 2: Application Migration System (Existing Containers)

**Location:** `scripts/migrations/` and `scripts/run-migrations.js`

**Trigger:** Automatic on dashboard startup via `dashboard/server.js`

**Files:**
- `011_create_symbol_registry.js` - Symbol registry migration
- `012_create_phase9_metrics_tables.js` - Phase 9 metrics migration
- `run-migrations.js` - Migration orchestrator

**Pros:**
- ✅ Flexible - can run multiple times
- ✅ Gradual - idempotent (CREATE TABLE IF NOT EXISTS)
- ✅ Debuggable - detailed logging
- ✅ Manual - can be run standalone: `node scripts/run-migrations.js`

**Cons:**
- ❌ Slower - runs after app startup begins
- ❌ Requires Node.js + mysql2 module
- ❌ Depends on dashboard initialization

## Schema Consistency

Both paths create **identical schemas**. This is ensured by:

1. **Migration files as source of truth** - Define the actual schema in JavaScript
2. **Init scripts as copies** - Manually kept in sync with migration definitions
3. **Verification** - Both paths tested and confirmed to create same tables

### Table Schemas

**Symbol Registry Tables:**
```
symbol_registry
  - id, symbol, name, exchange, security_type, source
  - has_yahoo_metadata, permanently_failed, permanent_failure_reason, permanent_failure_at
  - Treasury and Option specific fields
  - Indexes on symbol, security_type, maturity_date, expiration_date, permanently_failed
  - Foreign key to itself for underlying_symbol (options)

symbol_registry_metrics
  - Tracks counts: total, nasdaq, nyse, other, with/without metadata, permanently_failed

file_refresh_status
  - Tracks when CSV files were last loaded
  - Files: NASDAQ, NYSE, OTHER, TREASURY_AUCTIONS, TREASURY_HISTORICAL
```

**Phase 9 Metrics Tables:**
```
scraper_page_performance
  - Per-request metrics from scrapers
  - Indexed by source and time

scraper_daily_summary
  - Aggregated daily metrics
  - Primary key on (scraper_source, metric_date, metric_type)

scheduler_metrics
  - Scheduler execution metrics
  - Indexed by source and time
```

## Testing Schema Initialization

### Fresh Container Setup
```bash
docker compose down -v              # Remove existing volume
docker compose up -d                # Start fresh - Docker initializes schema
docker compose exec mysql mysql -u test -ptest testdb -e "SHOW TABLES;"
```

### Application Migration (Testing)
```bash
MYSQL_HOST=localhost \
MYSQL_PORT=3306 \
MYSQL_USER=test \
MYSQL_PASSWORD=test \
MYSQL_DATABASE=testdb \
node scripts/run-migrations.js
```

### Both Paths Together
```bash
# Start fresh container (Docker init runs)
docker compose up -d

# Watch app startup logs (Application migrations also run)
docker compose logs -f dashboard | grep -i migration
```

## Adding New Migrations

When adding new tables/columns:

1. **Create migration file** in `scripts/migrations/` following pattern `NNN_description.js`
2. **Define schema** using migration.runMigration() pattern with mysql2/promise
3. **Sync init script** - if core table, copy to `scripts/init-db/NNN-description.sql`
4. **Test** - run migration manually and via application startup
5. **Verify** - confirm identical schema in both paths

## Migration Files

### 011_create_symbol_registry.js
- Creates symbol registry system for autocomplete
- Runs at app startup
- Tables created:
  - symbol_registry (165,772+ records in production)
  - symbol_registry_metrics
  - file_refresh_status

### 012_create_phase9_metrics_tables.js
- Creates WebSocket real-time metrics tables
- Runs at app startup
- Tables created:
  - scraper_page_performance
  - scraper_daily_summary
  - scheduler_metrics

## Implementation Notes

- Both paths use `CREATE TABLE IF NOT EXISTS` for safety
- Init scripts use `IF NOT EXISTS` clause for clarity
- Collation: `utf8mb4_unicode_ci` for UTF-8 support
- Engine: InnoDB for transactions and foreign keys
- Charset: utf8mb4 for emoji/international characters
- Indexes created on frequently queried columns

## Troubleshooting

**Tables not created on fresh container:**
- Verify `scripts/init-db/` directory exists in docker-compose.yml volumes
- Check MySQL container logs: `docker compose logs mysql`
- Ensure files are `.sql` (lowercase extension)

**Tables not created at app startup:**
- Check dashboard logs: `docker compose logs dashboard`
- Look for "DATABASE INITIALIZATION" messages
- Verify `run-migrations.js` is being called from `server.js`
- Check MYSQL_* environment variables are set

**Schema mismatch between paths:**
- Run tests: `npm test`
- Run migration manually: `node scripts/run-migrations.js`
- Compare table schemas: `SHOW CREATE TABLE table_name\G`
- Update init scripts to match migration definitions
