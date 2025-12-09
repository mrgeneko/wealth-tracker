# Completed Migrations & Backfills

This document tracks one-time data migration and backfill scripts that have been executed. These scripts are archived here for reference and should not be re-run unless specifically documented.

---

## Archive Scripts

### Data Structure Migrations
- **`backfill_adjusted_eps.js`** - Backfilled adjusted EPS column
  - Date: Unknown
  - Purpose: Added adjusted_eps calculation for securities
  - Status: Completed, no re-run needed

- **`backfill_adjusted_dividends.js`** - Backfilled dividend adjustments
  - Date: Unknown
  - Purpose: Added dividend adjustment factors for split-adjusted calculations
  - Status: Completed, no re-run needed

### Data Normalization
- **`backfill_normalized_key.js`** - Normalized ticker symbols
  - Date: Unknown
  - Purpose: Standardized symbol format across database
  - Status: Completed, integrated into new data flows

- **`normalize_dividend_yield_backfill.js`** - Normalized dividend yield storage
  - Date: Unknown
  - Purpose: Standardized yield values to fractional format (0.0435 instead of 4.35)
  - Status: Completed, all new imports use standard format

- **`dedupe_dividends.js`** - Removed duplicate dividend records
  - Date: Unknown
  - Purpose: Cleaned up duplicate dividend events in database
  - Status: Completed, duplicates removed

---

## Recent Backfills (December 2025)

- **Sector Population Backfill** - December 8, 2025
  - Command: `node scripts/populate/populate_securities_metadata.js --all-metadata`
  - Result: 108 of 155 securities now have sector data (70% coverage)
  - Note: Remaining 47 are ETFs, funds, and instruments without sector classification
  - Status: Completed

---

## Migration Strategy

When adding new columns or data fields:
1. Create SQL migration in `migrations/sql/` (e.g., `009_add_new_field.sql`)
2. Run `scripts/migrations/run_migrations.sh`
3. If backfill is needed, create standalone script (e.g., `backfill_new_field.js`)
4. Run backfill script with appropriate flags
5. After backfill is complete and verified, document it here and move script to `archive/`

---

## Running Migrations

```bash
# Apply pending migrations
./scripts/migrations/run_migrations.sh

# Force apply all migrations (use with caution)
./scripts/migrations/run_all_migrations.sh
```

---

## Questions?

Refer to `scripts/README.md` for overview of all scripts, or `README.md` in project root for database schema documentation.
