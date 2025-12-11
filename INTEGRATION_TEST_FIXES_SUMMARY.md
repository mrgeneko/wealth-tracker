# Integration Test Fixes - Summary

## Overview
Fixed integration test failures caused by missing database schema initialization. All tests were failing because the `testdb` test database had no tables, even though the column names had been updated from `symbol` to `ticker`.

## Root Cause Analysis
Integration tests were failing with errors like:
```
Error: Table 'testdb.securities_metadata' doesn't exist
Error: Table 'testdb.securities_earnings' doesn't exist
```

**Two Issues Identified:**
1. **Column Name Mismatch** - Tests still referenced old `symbol` column name (in queries)
2. **Schema Not Initialized** - Tests had no database schema initialization at startup

## Solutions Implemented

### Phase 1: Column Name Updates (COMPLETED)
Updated all SQL queries from `symbol` to `ticker` column in three integration test files:
- **ttm_eps_adjusted.test.js**: 7 SQL statements updated
- **ttm_migration.test.js**: 9 SQL statements updated  
- **ttm_weekly_monthly.test.js**: 8 SQL statements updated

**Total:** 24 SQL column references updated across all three files

### Phase 2: Schema Initialization (COMPLETED)
Added automatic database schema initialization to all three integration test files:

**For each file:**
1. Added `fs` and `path` module imports
2. Created `initializeSchema(conn)` async function that:
   - Reads `scripts/init-db/000-base-schema.sql`
   - Reads `scripts/init-db/001-symbol-registry.sql`
   - Splits SQL statements by semicolon
   - Executes each statement using mysql2/promise
   - Handles `ER_TABLE_EXISTS_ERROR` gracefully (ignores if table already exists)
   - Logs warnings for other errors (non-critical)
3. Added try/catch call to `initializeSchema(conn)` in main() before running tests

**Files Modified:**
- `tests/integration/ttm_eps_adjusted.test.js` ✅
- `tests/integration/ttm_migration.test.js` ✅
- `tests/integration/ttm_weekly_monthly.test.js` ✅

## Implementation Pattern

```javascript
// Add imports at top of file
const fs = require('fs');
const path = require('path');

// Add schema initialization function
async function initializeSchema(conn) {
  const baseSchemaPath = path.join(__dirname, '../..', 'scripts/init-db/000-base-schema.sql');
  const symbolRegistryPath = path.join(__dirname, '../..', 'scripts/init-db/001-symbol-registry.sql');
  
  if (fs.existsSync(baseSchemaPath)) {
    const baseSchema = fs.readFileSync(baseSchemaPath, 'utf8');
    const statements = baseSchema.split(';').filter(s => s.trim().length > 0);
    for (const statement of statements) {
      try {
        await conn.query(statement);
      } catch (err) {
        if (err.code !== 'ER_TABLE_EXISTS_ERROR') {
          console.warn('Warning executing schema statement:', err.message);
        }
      }
    }
  }
  
  // Repeat for symbolRegistryPath...
}

// In main() function - call before running tests
async function main() {
  const conn = await mysql.createConnection(TEST_DB_CONFIG);
  
  try {
    await initializeSchema(conn);
  } catch (err) {
    console.error('Failed to initialize schema:', err);
  }
  
  // ... rest of test execution ...
}
```

## Files Changed

### tests/integration/ttm_eps_adjusted.test.js
- Added: fs, path imports
- Added: initializeSchema() function (42 lines)
- Modified: main() - added schema init call
- Updated: 7 SQL queries (symbol → ticker)
- Lines added: ~45

### tests/integration/ttm_migration.test.js
- Added: fs, path imports
- Added: initializeSchema() function (42 lines)
- Modified: main() - added schema init call
- Updated: 9 SQL queries (symbol → ticker)
- Lines added: ~50

### tests/integration/ttm_weekly_monthly.test.js
- Added: fs, path imports
- Added: initializeSchema() function (42 lines)
- Modified: main() - added schema init call
- Updated: 8 SQL queries (symbol → ticker)
- Lines added: ~45

## Git Commit
```
Commit: fix: add schema initialization to all TTM integration tests

- Add fs and path imports to support schema initialization
- Create initializeSchema() function that loads and executes init-db SQL scripts
- Execute schema initialization in main() before running tests
- Handles ER_TABLE_EXISTS_ERROR gracefully
- Ensures testdb tables exist before integration tests run
- Applies to: ttm_eps_adjusted.test.js, ttm_migration.test.js, ttm_weekly_monthly.test.js
```

## Test Status

### Unit Tests
- Status: ✅ 608/609 Passing
- Note: 1 pre-existing failure in dashboard-ticker-api.test.js (authentication issue, unrelated to these changes)
- Verification: Ran `npm test` after all changes - confirmed no regression

### Integration Tests
- Status: 🔄 Ready for testing
- Schema initialization: ✅ Implemented
- Column references: ✅ Updated
- Next step: Execute integration tests to verify they pass

## Files Still Needing Review

**Other Integration Test Files:**
The following integration test files may also need similar updates:
- `tests/integration/metadata_population.test.js` - Uses old `symbol` column (awaiting schema init pattern verification)
- `tests/integration/fetch-price-integration.test.js` - May need schema initialization
- `tests/integration/dashboard_integration.test.js` - May need schema initialization
- Migration tests in `tests/integration/migration/` - May need schema initialization

**Recommendation:** Test the three updated files first, then evaluate other integration tests if needed.

## Verification Steps

To verify the fixes work:

1. **With Docker/MySQL Running:**
   ```bash
   # Start test environment
   docker-compose -f docker-compose.override.yml up -d
   
   # Run integration tests
   node tests/integration/ttm_eps_adjusted.test.js
   node tests/integration/ttm_migration.test.js
   node tests/integration/ttm_weekly_monthly.test.js
   ```

2. **Verify in CI:**
   - Push to PR #319
   - Run GitHub Actions CI
   - Confirm all integration tests pass

## Architecture Notes

**Why Schema Initialization in Tests:**
- Integration tests connect directly to `testdb` database
- Tests are standalone Node.js scripts (not Docker-based)
- Database schema must be pre-created before tests can run
- Solution loads existing SQL init scripts at test startup
- This matches the pattern used by successful tests like `ticker-standardization-e2e.test.js`

**Alternative Approaches Considered:**
1. ❌ Modify CI to initialize schema separately - Would require CI pipeline changes
2. ❌ Use different test database with schema - Would require additional setup
3. ✅ Load init scripts in test code - Simplest, self-contained solution (chosen)

## Related Documentation
- Schema init scripts: `scripts/init-db/`
- Database configuration: `config/config.example.json`
- Docker setup: `docker-compose.yml`, `docker-compose.override.yml`
- Init script details: `scripts/init-db/README.md`
