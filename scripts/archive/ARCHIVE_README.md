# Archive Directory

This directory contains one-time migration scripts, completed backfills, and experimental code that is no longer actively used but is preserved for reference and historical context.

## Directory Structure

### Root Level (Completed Migrations)
Scripts that have been successfully executed and completed:
- `backfill_adjusted_eps.js` - Added adjusted EPS calculations
- `backfill_adjusted_dividends.js` - Added dividend adjustment factors
- `backfill_normalized_key.js` - Normalized symbol format
- `normalize_dividend_yield_backfill.js` - Standardized yield storage
- `dedupe_dividends.js` - Removed duplicate records

### `experimental/` (Do Not Use)
Experimental features that are incomplete or not production-ready:
- `populate_securities_metadata_smart.js` - Experimental symbol linking wrapper
  - **Status:** Incomplete - references helper functions that aren't included
  - **Issue:** Would need significant refactoring to work standalone
  - **Decision:** If symbol linking is needed, add directly to main populate script

---

## Important Notes

### Before Running Any Archived Script
1. **These scripts have already been run** - They modified data that won't benefit from re-running
2. **Data is already updated** - Running them again could cause duplicates or inconsistencies
3. **For reference only** - Use them to understand what was done historically

### When to Use Archive Scripts
- **Never:** To re-run the migration (data is already modified)
- **Sometimes:** To understand the logic for similar future migrations
- **Rarely:** To inspect code patterns for inspiration on new scripts

### If You Need Similar Functionality
**DO NOT copy/paste from archive scripts.** Instead:
1. Look at the logic to understand what was needed
2. Create a new, properly tested script in `scripts/` directory
3. Add comprehensive error handling
4. Document the purpose clearly

---

## Historical Context

### Symbol Normalization (2024)
The `backfill_normalized_key.js` script was used to standardize symbol format. This is now integrated into:
- Data import processes
- The main populate script
- API responses

### Dividend Deduplication (Unknown Date)
The `dedupe_dividends.js` script removed duplicate entries. The system now prevents duplicates through:
- `ON DUPLICATE KEY UPDATE` in SQL
- Proper unique constraints

### Adjusted Values (Unknown Date)
The adjusted EPS and dividend backfills were run when those features were added to the system. Now they're updated automatically through:
- `populate_securities_metadata.js`
- Regular scheduled updates

---

## Maintenance

This directory should be reviewed periodically:
- Remove scripts that are no longer useful
- Add new completed migrations with documentation
- Keep MIGRATIONS_COMPLETED.md up to date with dates and outcomes

---

## Questions?

Refer to:
- `MIGRATIONS_COMPLETED.md` - Detailed migration history
- `../README.md` - Script overview and usage
