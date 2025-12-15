# Complete Security Metadata System - Final Documentation

## System Overview

A comprehensive metadata management system for securities that:
- Stores detailed information about stocks, ETFs, bonds, and other securities
- Provides real-time API endpoints for dashboard integration
- Automatically populates metadata for popular securities in the background
- Includes comprehensive test coverage

---

## Quick Start

### 1. Run Migrations

```bash
# Run all migrations in order
for file in scripts/sql/00{2,3,4,5}_*.sql; do
  mysql -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < "$file"
done
```

### 2. Populate Your Portfolio

```bash
# Fetch metadata for all securities in your positions
node scripts/populate_securities_metadata.js --all
```

### 3. Run Tests

```bash
# Make test script executable
chmod +x scripts/run_tests.sh

# Run all tests
./scripts/run_tests.sh --all
```

### 4. Set Up Background Jobs

```bash
# Add to crontab
crontab -e

# Paste the contents of config/metadata_cron.conf
```

---

## Files Created

### Database Migrations
- `scripts/sql/002_create_securities_metadata.sql` - Main metadata table
- `scripts/sql/003_create_securities_earnings.sql` - Earnings calendar
- `scripts/sql/004_create_securities_dividends.sql` - Dividend history
- `scripts/sql/005_add_positions_metadata_link.sql` - Link positions to metadata

### Population Scripts
- `scripts/populate_securities_metadata.js` - Populate user's portfolio
- `scripts/populate_popular_securities.js` - Background job for S&P 500, ETFs, trending

### API Endpoints
- `api/metadata.js` - 5 REST endpoints for dashboard integration

### Tests
- `tests/metadata_api.test.js` - Unit tests (schema, queries, integrity)
- `tests/integration/metadata_population.test.js` - Integration tests
- `scripts/run_tests.sh` - Test runner

### Documentation
- `docs/SECURITY_METADATA.md` - Complete usage guide
- `docs/METADATA_API_INTEGRATION.md` - API integration guide
- `docs/frontend_metadata_integration.js` - Frontend examples
- `config/metadata_cron.conf` - Cron job configuration

---

## API Endpoints

### 1. Symbol Lookup
```
GET /api/metadata/lookup/:symbol
```
Quick check if metadata exists, triggers background fetch if not.

### 2. Prefetch Metadata
```
POST /api/metadata/prefetch
Body: { "symbol": "NVDA" }
```
Fetch metadata when user selects symbol (blocks 1-2 seconds).

### 3. Autocomplete
```
GET /api/metadata/autocomplete?q=APP
```
Search symbols as user types.

### 4. Batch Prefetch
```
POST /api/metadata/batch-prefetch
Body: { "symbols": ["AAPL", "NVDA", "TSLA"] }
```
Import positions from CSV/JSON.

### 5. Check Missing
```
GET /api/metadata/check-missing
```
Find positions without metadata.

---

## Background Population

### Popular Securities Lists

**S&P 500 Stocks** (100 included):
- Technology: AAPL, MSFT, NVDA, GOOGL, META, etc.
- Financials: JPM, V, MA, BAC, etc.
- Healthcare: UNH, LLY, JNJ, ABBV, etc.
- Consumer: WMT, HD, PG, COST, etc.

**Popular ETFs** (40 included):
- Broad market: SPY, QQQ, VTI, VOO
- Sector: XLF, XLE, XLV, XLK
- International: EEM, VWO, EFA
- Fixed income: AGG, BND, TLT

**Trending Tickers** (10 included):
- NVDA, TSLA, PLTR, SOFI, etc.

### Running Background Jobs

```bash
# Populate S&P 500 (throttled at 2s per symbol)
node scripts/populate_popular_securities.js --sp500

# Populate ETFs
node scripts/populate_popular_securities.js --etfs

# Populate trending
node scripts/populate_popular_securities.js --trending

# Populate all
node scripts/populate_popular_securities.js --all

# Force refresh (even if cached)
node scripts/populate_popular_securities.js --all --force
```

### Throttling Configuration

Set environment variables to control rate limiting:

```bash
# Delay between symbols (default: 2000ms)
export POPULAR_SECURITIES_DELAY_MS=2000

# Batch size (default: 50)
export POPULAR_SECURITIES_BATCH_SIZE=50
```

---

## Testing

### Run All Tests
```bash
./scripts/run_tests.sh --all
```

### Run Unit Tests Only
```bash
./scripts/run_tests.sh --unit
```

### Run Integration Tests Only
```bash
./scripts/run_tests.sh --integration
```

### Test Coverage

**Unit Tests:**
- Schema validation (tables, columns, indexes)
- Foreign key constraints
- Cascade deletes
- Data insertion and updates
- Query performance
- Data integrity (NULL handling, DECIMAL precision)

**Integration Tests:**
- Single symbol population
- Batch population
- Popular securities population
- Invalid symbol handling
- Data quality validation

---

## Dashboard Integration

### Add Position Modal

```javascript
// 1. Autocomplete as user types
<input onInput={(e) => handleAutocomplete(e.target.value)} />

// 2. Prefetch when symbol selected
async function onSymbolSelected(symbol) {
  const res = await fetch('/api/metadata/prefetch', {
    method: 'POST',
    body: JSON.stringify({ symbol })
  });
  const data = await res.json();
  autoFillForm(data.metadata);
}
```

### Import Positions

```javascript
async function importPositions(symbols) {
  // Batch prefetch all symbols
  const res = await fetch('/api/metadata/batch-prefetch', {
    method: 'POST',
    body: JSON.stringify({ symbols })
  });
  const data = await res.json();
  
  // Show summary: "25 cached, 3 fetched, 2 failed"
  showSummary(data.summary);
}
```

---

## Maintenance

### Daily Tasks (Automated via Cron)
- Refresh portfolio securities metadata
- Update trending tickers

### Weekly Tasks (Automated via Cron)
- Refresh S&P 500 stocks
- Refresh popular ETFs

### Monthly Tasks (Automated via Cron)
- Full refresh with --force flag

### Manual Tasks
```bash
# Check for missing metadata
curl http://localhost:3000/api/metadata/check-missing

# Manually refresh a symbol
node scripts/populate_securities_metadata.js --ticker AAPL
```

---

## Performance Metrics

### Population Speed
- Single symbol: ~1-2 seconds
- Batch (50 symbols): ~2-3 minutes (with 2s throttling)
- S&P 500 (100 symbols): ~3-4 minutes
- All popular (150 symbols): ~5-6 minutes

### Database Performance
- Autocomplete query: <10ms
- Portfolio query with metadata: <50ms
- Batch insert: <100ms

---

## Troubleshooting

### Symbol Not Found
```
Error: Symbol not found in Yahoo Finance
```
**Solution:** Symbol may be delisted, private, or not tracked by Yahoo. Position will be created with `metadata_symbol = NULL`.

### Rate Limiting
```
Error: 429 Too Many Requests
```
**Solution:** Increase `POPULAR_SECURITIES_DELAY_MS` or reduce `POPULAR_SECURITIES_BATCH_SIZE`.

### Foreign Key Error
```
Error: Cannot add or update a child row
```
**Solution:** Ensure metadata exists before linking positions. Use prefetch API endpoint.

---

## Next Steps

1. ✅ Run migrations
2. ✅ Run tests to verify setup
3. ✅ Populate your portfolio metadata
4. ✅ Set up cron jobs for background population
5. ✅ Integrate API endpoints into dashboard
6. ⏭️ Monitor logs and adjust throttling as needed
7. ⏭️ Expand popular securities lists as needed

---

## Support

For issues or questions:
- Check logs in `logs/metadata_*.log`
- Review test output for validation
- See `docs/SECURITY_METADATA.md` for detailed usage
- See `docs/METADATA_API_INTEGRATION.md` for API details
