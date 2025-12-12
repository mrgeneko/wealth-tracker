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

- **001-symbol-registry.sql** - Creates ticker registry tables for autocomplete and metadata tracking
  - `ticker_registry` - Main ticker registry with permanent failure tracking
  - `ticker_registry_metrics` - Coverage and refresh metrics
  - `file_refresh_status` - File refresh status tracking
  - `symbol_yahoo_metrics` - Extended Yahoo Finance metrics storage

- **002-phase9-metrics.sql** - Creates WebSocket metrics tables for real-time dashboard
  - `scraper_page_performance` - Per-request metrics from scrapers
  - `scraper_daily_summary` - Aggregated daily metrics
  - `scheduler_metrics` - Scheduler execution metrics

## Single Source of Truth

These init scripts are the **authoritative database schema**. All tables are created here and executed automatically when a fresh Docker container is initialized.

For existing databases that need schema updates, use manual ALTER TABLE commands or create specific update scripts as needed.

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
