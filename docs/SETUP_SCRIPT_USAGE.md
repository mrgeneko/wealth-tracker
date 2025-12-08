# Setup Script Usage Guide

## Quick Start

```bash
# Run complete setup (migrations + populate existing positions)
./scripts/setup_metadata_system.sh

# Run with popular securities (takes longer)
./scripts/setup_metadata_system.sh --populate-popular
```

---

## Options

```bash
--skip-migrations     Skip database migrations (if already run)
--skip-population     Skip metadata population
--populate-popular    Also populate S&P 500, ETFs, and trending tickers
```

---

## What the Script Does

### 1. **Prerequisite Checks**
- ✓ Docker is running
- ✓ MySQL container is running
- ✓ Node.js is installed
- ✓ All required files exist

### 2. **Run Migrations**
- Creates `securities_metadata` table
- Creates `securities_earnings` table
- Creates `securities_dividends` table
- Adds `metadata_symbol` to `positions` table

### 3. **Verify Schema**
- Confirms all tables exist
- Confirms columns were added
- Checks for any errors

### 4. **Check Existing Data**
- Counts positions in database
- Lists unique symbols
- Shows sample symbols

### 5. **Populate Metadata**
- Fetches metadata from Yahoo Finance
- Stores in database
- Links to positions

### 6. **Optional: Popular Securities**
- S&P 500 stocks (100)
- Popular ETFs (40)
- Trending tickers (10)

### 7. **Final Verification**
- Shows record counts
- Displays sample data
- Confirms success

---

## Logs

All output is logged to timestamped files:

```
logs/metadata_setup_YYYYMMDD_HHMMSS.log        # Complete log
logs/metadata_setup_errors_YYYYMMDD_HHMMSS.log # Errors only
```

---

## Example Output

```
================================================================
Security Metadata System Setup
================================================================
Started: 2025-12-07 21:00:00
Log file: logs/metadata_setup_20251207_210000.log

Step 1: Checking prerequisites...
✓ Docker is running
✓ MySQL container is running
✓ Node.js is installed (v18.17.0)
✓ All required scripts found

Step 2: Running database migrations...
  Running 002_create_securities_metadata.sql...
  ✓ 002_create_securities_metadata.sql completed
  Running 003_create_securities_earnings.sql...
  ✓ 003_create_securities_earnings.sql completed
  ...
✓ All migrations completed successfully

Step 3: Verifying database schema...
  ✓ Table 'securities_metadata' exists
  ✓ Table 'securities_earnings' exists
  ✓ Table 'securities_dividends' exists
  ✓ Column 'metadata_symbol' added to positions table
✓ Database schema verified

Step 4: Checking existing data...
  Positions in database: 15
  Unique symbols: 12
  Sample symbols:
    - AAPL
    - NVDA
    - VTI
    - QQQ
    - TSLA

Step 5: Populating metadata for existing positions...
  This may take a few minutes...
  [1/12] AAPL - ✓ Success
  [2/12] NVDA - ✓ Success
  ...
✓ Metadata population completed
  Securities in metadata table: 12

Step 7: Final verification...
  Database record counts:
  +----------------------+-------+
  | table_name           | count |
  +----------------------+-------+
  | positions            |    15 |
  | securities_metadata  |    12 |
  | securities_earnings  |     8 |
  | securities_dividends |     5 |
  +----------------------+-------+

  Positions linked to metadata: 12

  Sample metadata records:
  +--------+------------------+------------+----------+----------+
  | symbol | short_name       | quote_type | exchange | currency |
  +--------+------------------+------------+----------+----------+
  | AAPL   | Apple Inc.       | EQUITY     | NASDAQ   | USD      |
  | NVDA   | NVIDIA Corp      | EQUITY     | NASDAQ   | USD      |
  | VTI    | Vanguard Total   | ETF        | PCX      | USD      |
  +--------+------------------+------------+----------+----------+

================================================================
Setup Complete!
================================================================
✓ Database migrations applied
✓ Schema verified
✓ Metadata populated for existing positions

Next steps:
  1. Set up cron jobs: ./scripts/install_cron_jobs.sh
  2. Integrate API endpoints into your dashboard
  3. Run tests: ./scripts/run_tests.sh --all
```

---

## Troubleshooting

### Docker Not Running
```
✗ Docker is not running
Please start Docker and try again
```
**Solution:** Start Docker Desktop

### MySQL Container Not Running
```
✗ MySQL container is not running
Please run: docker compose up -d
```
**Solution:** `docker compose up -d`

### Migration Failed
```
✗ 002_create_securities_metadata.sql failed
Check error log: logs/metadata_setup_errors_*.log
```
**Solution:** Check error log for details, may need to drop existing tables

### No Positions Found
```
No positions found in database
```
**Solution:** This is normal if you haven't imported positions yet. The metadata tables are still created.

### Metadata Population Failed
```
✗ Metadata population failed
```
**Solution:** 
- Check internet connection
- Verify Yahoo Finance is accessible
- Check error log for specific symbols that failed

---

## Re-running the Script

The script is **idempotent** for migrations (safe to re-run):

```bash
# Re-run with migrations (will skip if tables exist)
./scripts/setup_metadata_system.sh

# Re-run without migrations
./scripts/setup_metadata_system.sh --skip-migrations

# Just populate new data
./scripts/setup_metadata_system.sh --skip-migrations
```

---

## Advanced Usage

### Populate Only Specific Securities

```bash
# Skip automatic population
./scripts/setup_metadata_system.sh --skip-population

# Then manually populate specific symbols
node scripts/populate_securities_metadata.js --symbol AAPL
node scripts/populate_securities_metadata.js --symbol NVDA
```

### Populate Popular Securities Later

```bash
# Run basic setup first
./scripts/setup_metadata_system.sh

# Later, populate popular securities
node scripts/populate_popular_securities.js --sp500
node scripts/populate_popular_securities.js --etfs
node scripts/populate_popular_securities.js --trending
```

---

## Logs Location

```
logs/
├── metadata_setup_20251207_210000.log          # Full setup log
├── metadata_setup_errors_20251207_210000.log   # Errors only
├── metadata_daily.log                          # Daily cron job
├── metadata_sp500.log                          # S&P 500 cron job
└── metadata_etfs.log                           # ETF cron job
```

---

## Quick Reference

```bash
# Complete setup
./scripts/setup_metadata_system.sh

# Setup with popular securities
./scripts/setup_metadata_system.sh --populate-popular

# Re-run (skip migrations)
./scripts/setup_metadata_system.sh --skip-migrations

# Check status
./scripts/check_db_status.sh

# View logs
tail -f logs/metadata_setup_*.log
```
