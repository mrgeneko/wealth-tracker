# Ticker Terminology Standardization

## Overview

Standardize all security identifier references from `symbol` to `ticker` across the codebase.

**Status:** In Progress  
**Approach:** Clean init scripts (no incremental migration)

---

## Completed

### ✅ Database Schema (Init Scripts)
- `scripts/init-db/000-base-schema.sql` - All tables use `ticker` column
- `scripts/init-db/001-symbol-registry.sql` - Uses `ticker` column
- Removed legacy `scripts/sql/` migration files
- Removed `012_rename_symbol_to_ticker.sql` migration

**Tables updated:**
| Table | Column Change |
|-------|---------------|
| `positions` | `symbol` → `ticker` |
| `securities_metadata` | `symbol` → `ticker` |
| `securities_dividends` | `symbol` → `ticker` |
| `securities_earnings` | `symbol` → `ticker` |
| `symbol_registry` | `symbol` → `ticker` |
| `security_splits` | `symbol` → `ticker` |
| `latest_prices` | Already used `ticker` ✓ |

### ✅ Backend Services
- `services/symbol-registry/metadata_autocomplete_service.js`
  - `searchSymbols()` → `searchTickers()`
  - `getSymbolDetails()` → `getTickerDetails()`
  - `getSymbolsNeedingMetadata()` → `getTickersNeedingMetadata()`
  - `refreshSymbolMetadata()` → `refreshTickerMetadata()`
  - All SQL queries updated to `ticker` column

### ✅ API Endpoints
- `api/autocomplete.js`
  - `GET /details/:symbol` → `GET /details/:ticker`
  - `POST /refresh/:symbol` → `POST /refresh/:ticker`
  - Response fields: `symbol` → `ticker`
  - Error messages updated

### ✅ Unit Tests
- `tests/unit/api/autocomplete.test.js` - All mocks and assertions updated
- `tests/unit/services/symbol-registry/metadata_autocomplete_service.test.js` - Method calls updated

---

## Remaining Work

### Phase 1: Additional Backend Files
Files likely still using `symbol`:

```
api/metadata.js
api/cleanup.js
api/statistics.js
dashboard/server.js
dashboard/ticker_registry.js
services/symbol-registry/symbol_registry_service.js
services/symbol-registry/yahoo_metadata_populator.js
scrapers/*.js
```

**Action:** Search and update all `symbol` references to `ticker`

### Phase 2: Frontend Dashboard
```
dashboard/public/app.js
dashboard/public/index.html
```

**Changes needed:**
- Form field IDs (`position-symbol` → `position-ticker`)
- JavaScript variables
- Display labels
- API request/response handling

### Phase 3: Kafka Messages
Update message payloads from `data.key`/`data.symbol` to `data.ticker`:
- Producer scripts
- Consumer scripts
- Message handlers

### Phase 4: Configuration Files
```
config/source_priority.json
config/assets_liabilities.json
```

### Phase 5: Documentation
Update docs referencing old column names or API parameters.

### Phase 6: Integration Tests
Update any integration tests that interact with the database directly.

---

## Deployment Notes

**Fresh Container Deployment:**
1. Delete existing MySQL data volume
2. Start containers - init scripts create correct schema
3. All code uses `ticker` terminology

**No migration needed** - this is a clean-slate approach.

---

## Quick Reference

| Before | After |
|--------|-------|
| `pos.symbol` | `pos.ticker` |
| `req.params.symbol` | `req.params.ticker` |
| `searchSymbols()` | `searchTickers()` |
| `getSymbolDetails()` | `getTickerDetails()` |
| `WHERE symbol = ?` | `WHERE ticker = ?` |
| `/api/autocomplete/details/:symbol` | `/api/autocomplete/details/:ticker` |
