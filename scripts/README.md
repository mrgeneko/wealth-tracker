# Scripts Guide

This directory contains operational, setup, maintenance, and development scripts for wealth-tracker.

---

## Organization

### `migrations/` - Database Migrations
- **`sql/`** - Raw SQL migration files (001_initial.sql, 002_ttm_fields.sql, etc.)
- **`run_migrations.sh`** - Apply all pending database migrations in order
- **`run_all_migrations.sh`** - Force run all migrations (idempotent)

### `setup/` - Initial Setup & Configuration
- **`setup_metadata_system.sh`** - Complete metadata system initialization (runs migrations + population)
- **`install_cron_jobs.sh`** - Install recurring metadata refresh cron jobs
- **`uninstall_cron_jobs.sh`** - Remove installed cron jobs
- **`update_exchange_listings.js`** - Download and update NASDAQ, NYSE, and other exchange listings
- **`update_treasury_listings.js`** - Update US Treasury auction data

### `populate/` - Data Population Scripts
- **`populate_securities_metadata.js`** - **CANONICAL**: Fetch and populate security metadata from Yahoo Finance
  - Usage: `node scripts/populate/populate_securities_metadata.js [--ticker AAPL] [--all] [--all-metadata]`
  - `--ticker AAPL` - Single ticker
  - `--all` - All symbols from positions table (positions only)
  - `--all-metadata` - All symbols from securities_metadata table (recommended for backfill)
  - Populates: sector, industry, dividend yield, P/E ratio, TTM dividend, TTM EPS
  
- **`populate_popular_securities.js`** - Populate a curated list of popular stocks/ETFs/bonds

### `maintenance/` - Operational & Maintenance Tasks
- **`check_db_status.sh`** - Verify database connectivity and table structure
- **`recompute_ttm.js`** - Recalculate TTM (trailing twelve months) metrics
- **`repair_and_republish_logged_prices.js`** - Fix corrupted price logs and republish to Kafka
- **`rotate-logs.sh`** - Rotate and compress log files
- **`health_check.sh`** - Check scraper daemon health and connectivity

### `ci/` - Continuous Integration
- **`run_tests_with_junit.js`** - Run integration tests and generate JUnit XML reports for GitHub Actions

### `utilities/` - Development & Debugging
- **`debug_schema.js`** - Inspect database schema and table structure
- **`debug_schema_root.js`** - Root-level schema debugging
- **`debug_autocomplete_local.js`** - Test symbol autocomplete logic locally
- **`test_yahoo_sector.js`** - Verify Yahoo Finance API sector extraction
- **`test_exchange_lookup.js`** - Test symbol-to-exchange mapping
- **`test_db_output.js`** - Inspect database output format
- **`test_edge_case.js`** - Single edge case scenario testing
- **`test_size_validation.js`** - Data size validation
- **`test_fetch_history.js`** - Test historical data fetching
- **`test_prev_close_preserve.js`** - Verify previous close data preservation
- **`test_constructible_urls.js`** - Test URL construction logic
- **`test_webull_watchlists.js`** - Test Webull watchlist scraping
- **`verify_api_response.js`** - Ad-hoc API response verification
- **`inspect_yf_api.js`** - Inspect Yahoo Finance API response structure
- **`dump_schema_node.js`** - Export database schema as JSON
- **`publish_one_log.js`** - Manually republish a single price log file
- **`debug_abbv.js`** - Debug ABBV sector extraction (legacy, for reference)
- **`test_abbv_sector.js`** - Test ABBV sector API response (legacy, for reference)
- **`test_google.js`** - Test Google Finance integration (legacy, for reference)

### Root Level Scripts (Bash)
- **`common.sh`** - Common utility functions used by other scripts
- **`check_scrapers_normalized_key.js`** - Verify scrapers use normalized keys
- **`consume_kafka_test.sh`** - Test Kafka consumer
- **`publish_test_message.sh`** - Publish test message to Kafka
- **`show_sample_records.sh`** - Display sample database records
- **`verify_and_populate.sh`** - Verify migrations and populate data

---

## Common Tasks

### First Time Setup
```bash
# Complete initialization
./scripts/setup/setup_metadata_system.sh

# Or manual steps:
./scripts/migrations/run_migrations.sh
node scripts/populate/populate_securities_metadata.js --all-metadata
./scripts/setup/install_cron_jobs.sh
```

### Backfill Missing Sector Data
```bash
node scripts/populate/populate_securities_metadata.js --all-metadata
```

### Update Exchange Listings
```bash
node scripts/update_exchange_listings.js
```

### Check Database Status
```bash
./scripts/check_db_status.sh
```

### Run Integration Tests
```bash
node scripts/ci/run_tests_with_junit.js
```

### Recompute TTM Metrics
```bash
node scripts/recompute_ttm.js
```

### Debug Database Schema
```bash
node scripts/utilities/debug_schema.js
```

---

## Notes

- **Python Files**: `pyproject.toml` and `requirements.txt` are legacy from Python prototyping. The project is now Node.js-based.
- **Migration Archives**: One-time backfill scripts have been moved to `archive/` with detailed documentation in `archive/MIGRATIONS_COMPLETED.md`.
- **Archive Structure**: 
  - `archive/` - Completed migrations and historical backfills
  - `archive/experimental/` - Incomplete experimental features (do not use)
  - See `archive/ARCHIVE_README.md` for detailed context
- **Development Scripts**: Scripts in `utilities/` are for local debugging and development. They are not part of production workflows.
- **Canonical Populate Script**: Always use `scripts/populate/populate_securities_metadata.js` for metadata population. Other populate variants are experimental/incomplete.

---

## Contributing

When adding new scripts:
1. Place in appropriate subdirectory (setup, populate, maintenance, ci, or utilities)
2. Add detailed comments to the script explaining its purpose
3. Update this README with usage instructions
4. Document any breaking changes or data mutations
