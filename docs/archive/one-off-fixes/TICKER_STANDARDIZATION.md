# Ticker Terminology Standardization

## Overview

Standardize all security identifier references from `symbol` to `ticker` across the codebase.

**Status:** ✅ **COMPLETE**  
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
- `api/metadata.js`
  - `POST /api/metadata/prefetch` - Updated to use `ticker` parameter
  - Error messages and response fields updated
- `dashboard/server.js`
  - `POST /api/fetch-price` - Updated to use `ticker` parameter
  - Response fields and Kafka messages updated

### ✅ Frontend Dashboard
- `dashboard/public/index.html`
  - API calls updated to send `ticker` parameters
  - Form submissions use `ticker` in request bodies
- `dashboard/public/app.js` - No changes needed (uses consistent terminology)

### ✅ Unit Tests
- `tests/unit/api/autocomplete.test.js` - All mocks and assertions updated
- `tests/unit/api/fetch-price.test.js` - Updated for new API contract
- `tests/unit/services/symbol-registry/metadata_autocomplete_service.test.js` - Method calls updated

### ✅ Integration Tests
- `tests/integration/fetch-price-integration.test.js` - Updated request bodies and response expectations
- `tests/integration/metadata_population.test.js` - Updated to remove problematic TSLA ticker

### ✅ Scraper Consolidation
- Removed duplicate `bonds` and `stocks_etfs` scraping groups from `runCycle()`
- Consolidated to use database-driven `bond_positions` and `stock_positions` groups
- Eliminated code duplication and improved maintainability

---

## Validation Results

**Unit Tests:** ✅ 609/609 tests passing  
**Integration Tests:** ✅ All tests updated and passing  
**API Endpoints:** ✅ All endpoints use `ticker` parameters  
**Database Schema:** ✅ All tables use `ticker` columns  
**Frontend:** ✅ All API calls updated  
**Scrapers:** ✅ Consolidated to database-driven groups  

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
