# Completed Migrations & Backfills

This document tracks one-time data migration and backfill scripts that have been executed. These scripts are archived here for reference and should not be re-run unless specifically documented.

---

## Archive Scripts

### Data Structure Migrations
- **`backfill_adjusted_eps.js`** - Backfilled adjusted EPS column
  - Purpose: Added adjusted_eps calculation for securities
  - Status: Completed, no re-run needed
  - Notes: Applied when adjusted EPS column was introduced

- **`backfill_adjusted_dividends.js`** - Backfilled dividend adjustments
  - Purpose: Added dividend adjustment factors for split-adjusted calculations
  - Status: Completed, no re-run needed
  - Notes: Critical for accurate dividend tracking

### Data Normalization
- **`backfill_normalized_key.js`** - Normalized ticker symbols
  - Purpose: Standardized symbol format across database
  - Status: Completed, integrated into new data flows
  - Notes: Ensures consistency in symbol representation

- **`normalize_dividend_yield_backfill.js`** - Normalized dividend yield storage
  - Purpose: Standardized yield values to fractional format (0.0435 instead of 4.35)
  - Status: Completed, all new imports use standard format
  - Notes: All future imports follow this standardization

- **`dedupe_dividends.js`** - Removed duplicate dividend records
  - Purpose: Cleaned up duplicate dividend events in database
  - Status: Completed, duplicates removed
  - Notes: Run after major bulk imports to ensure data integrity

---

## Recent Backfills (December 2025)

- **Sector Population Backfill** - December 8, 2025
  - Command: `node scripts/populate/populate_securities_metadata.js --all-metadata`
  - Result: 108 of 155 securities now have sector data (70% coverage)
  - Note: Remaining 47 are ETFs, funds, and instruments without sector classification
  - Status: Completed
  - Reason: Initial populate run only captured symbols from positions table, not all metadata records

---

## Canonical Populate Script

**Primary Script:** `scripts/populate/populate_securities_metadata.js`
- **Status:** Production-ready, actively maintained
- **Purpose:** Fetch and populate security metadata from Yahoo Finance
- **Flags Supported:**
  - `--symbol AAPL` - Single symbol
  - `--all` - All symbols from positions table
  - `--all-metadata` - All symbols from securities_metadata table (recommended for backfill)
- **Populated Fields:** sector, industry, dividend yield, P/E ratio, TTM dividend, TTM EPS, market cap, etc.
- **Recommendation:** Use this script for all metadata population tasks

**Experimental Script:** `scripts/populate/populate_securities_metadata_smart.js` (DO NOT USE IN PRODUCTION)
- **Status:** Incomplete/experimental - do not use
- **Differences:** Adds position-to-metadata linking capability
- **Issue:** Code references functions from main script but doesn't include them; needs refactoring
- **Action:** Archive or remove this script; features should be added to main script if needed

---

## Migration Strategy

When adding new columns or data fields:

1. **Create SQL migration** in `scripts/migrations/sql/` (e.g., `009_add_new_field.sql`)
   ```bash
   # Example migration file
   ALTER TABLE securities_metadata ADD COLUMN new_field VARCHAR(255);
   ```

2. **Run migration** to apply changes
   ```bash
   ./scripts/migrations/run_migrations.sh
   ```

3. **Create backfill script** if data needs to be populated
   ```bash
   # Create scripts/backfill_new_field.js
   node scripts/backfill_new_field.js
   ```

4. **Run backfill** with appropriate flags
   ```bash
   node scripts/backfill_new_field.js --all
   ```

5. **Verify data** integrity
   ```bash
  docker compose exec mysql mysql -u$MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE \
    -e "SELECT COUNT(*), COUNT(new_field) FROM securities_metadata;"
   ```

6. **Document completion** 
   - Add entry to this file with date and details
   - Move script to `archive/` directory after verification

---

## Running Migrations

```bash
# Apply pending migrations
./scripts/migrations/run_migrations.sh

# Force apply all migrations (use with caution)
./scripts/migrations/run_all_migrations.sh

# Run specific migration
docker compose exec -T mysql mysql -uroot -proot wealth_tracker < scripts/migrations/sql/009_add_new_field.sql
```

---

## Troubleshooting

**Migration fails with "ER_DUP_FIELDNAME"**
- Field already exists; safe to ignore if migration is idempotent
- Use stored procedures for safe conditionals (MySQL 8.0 compatible)

**Backfill script times out**
- Add `--symbol` flag to test single symbol first
- Check rate limiting (500ms delay between requests)
- Verify MySQL connection

**Data inconsistencies after backfill**
- Run deduplication: `node scripts/archive/dedupe_dividends.js`
- Check for NULL values: `SELECT COUNT(*) FROM securities_metadata WHERE sector IS NULL`

---

## Questions?

Refer to:
- `scripts/README.md` - Overview of all scripts
- `README.md` - Database schema and system architecture
- `scripts/populate/populate_securities_metadata.js` - Inline documentation
