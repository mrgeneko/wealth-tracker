# Docker MySQL Initialization Scripts

This directory contains SQL initialization scripts that are automatically executed by Docker on the **first container creation** (fresh database only).

## How It Works

When the MySQL container starts for the first time:
1. Docker detects the `/docker-entrypoint-initdb.d/` directory
2. All `.sql` files in this directory are executed in **alphabetical order**
3. The files are only run once - subsequent container restarts skip them

This is the **Docker-recommended approach** for initializing databases in containers.

## Files

- **000-base-schema.sql** - Creates core Wealth Tracker tables (REQUIRED - must run first)
  - `accounts` - Investment and bank accounts
  - `positions` - Holdings (stocks, bonds, cash) within accounts
  - `fixed_assets` - Real estate and vehicles
  - `latest_prices` - Current and historical pricing data
  - `securities_metadata` - Security metadata (names, sectors, metrics)
  - `securities_dividends` - Dividend information
  - `securities_earnings` - Earnings information
  - `security_splits` - Stock split information

- **001-symbol-registry.sql** - Creates symbol registry tables for autocomplete and metadata tracking
  - `symbol_registry` - Main symbol registry with permanent failure tracking
  - `symbol_registry_metrics` - Coverage and refresh metrics
  - `file_refresh_status` - File refresh status tracking

- **002-phase9-metrics.sql** - Creates WebSocket metrics tables for real-time dashboard
  - `scraper_page_performance` - Per-request metrics from scrapers
  - `scraper_daily_summary` - Aggregated daily metrics
  - `scheduler_metrics` - Scheduler execution metrics

## Relationship to Migration System

These files provide a **backup initialization path** for fresh containers. The primary initialization mechanism is:

**Application Level:** `scripts/run-migrations.js` (called by `dashboard/server.js` on startup)
- Runs `scripts/migrations/011_create_symbol_registry.js`
- Runs `scripts/migrations/012_create_phase9_metrics_tables.js`

**Dual-Path Approach:**
- Fresh containers: Get initialized by Docker init scripts (fast, automatic)
- Existing containers: Get updated by application migrations (flexible, graceful)
- Both paths use the same table schemas

## When to Update

If you modify table schemas in the migrations, you should also update these files to keep them in sync. However, these files only matter for **brand new containers** - existing containers already have the schema applied via the migration system.

## Testing Fresh Initialization

To test fresh container initialization:

```bash
# Remove existing MySQL volume to simulate fresh setup
docker compose down -v

# Start containers fresh - MySQL will auto-initialize with these scripts
docker compose up -d

# Verify tables were created
docker exec wealth-tracker-mysql mysql -u test -ptest testdb -e "SHOW TABLES;"
```
