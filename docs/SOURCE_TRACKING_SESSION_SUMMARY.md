# Source Tracking Implementation - Session Summary

**Date**: 2025-12-21
**Session Duration**: Phases 1-4 Complete
**Status**: Backend implementation complete, ready for frontend integration

---

## Executive Summary

Successfully implemented the backend infrastructure for source tracking across the wealth-tracker application. The implementation prevents price confusion when the same ticker exists across multiple security types (e.g., BTC as crypto vs BTC as ETF vs BTC as stock) or sources (e.g., BTC.X vs BTC-USD).

**Key Innovation**: Composite PRIMARY KEY `(ticker, security_type, source)` in `latest_prices` table to handle:
- Multi-type tickers: BTC crypto vs BTC ETF vs BTC stock
- Crypto ticker variations: BTC.X vs BTC-USD from different sources
- Multi-exchange tickers: BP on NYSE vs BP on LSE

---

## Completed Phases

### Phase 1: Database Schema Updates ✅

**Branch**: `feature/source-tracking-database`
**Commit**: 7f3c445
**PR**: https://github.com/mrgeneko/wealth-tracker/pull/new/feature/source-tracking-database

#### Changes Made:

**1. positions table** (lines 73-97):
```sql
-- Renamed: type → security_type (ENUM → VARCHAR(20))
-- Added: source VARCHAR(50)
-- Added: pricing_provider VARCHAR(50)
-- Added indices for new columns
```

**2. ticker_registry table** (lines 294-334):
```sql
-- Added: pricing_provider VARCHAR(50)
-- Added: display_name VARCHAR(200)
-- Added index: idx_pricing_provider
```

**3. latest_prices table** (lines 112-125):
```sql
CREATE TABLE latest_prices (
  ticker VARCHAR(50) NOT NULL,
  security_type VARCHAR(20) NOT NULL DEFAULT 'NOT_SET',
  source VARCHAR(50) NOT NULL DEFAULT 'unknown',
  price DECIMAL(18,4),
  previous_close_price DECIMAL(18,4),
  prev_close_source VARCHAR(50),
  prev_close_time DATETIME,
  quote_time DATETIME,
  capture_time DATETIME,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker, security_type, source),
  KEY idx_latest_prices_ticker (ticker)
);
```

**4. Seed Data** (lines 435-484):
```sql
-- Auto-populate pricing_provider based on source
UPDATE ticker_registry SET pricing_provider = 'YAHOO'
WHERE source IN ('NASDAQ_FILE', 'NYSE_FILE', 'OTHER_LISTED_FILE');

UPDATE ticker_registry SET pricing_provider = 'TREASURY_GOV'
WHERE security_type = 'US_TREASURY';

UPDATE ticker_registry SET pricing_provider = 'INVESTING_COM'
WHERE source = 'CRYPTO_INVESTING_FILE';

-- Auto-generate display_name for autocomplete
UPDATE ticker_registry SET display_name =
  CONCAT(ticker, ' - ', name, ' (', security_type, ', ', source_domain, ')');
```

**Breaking Changes**:
- `positions.type` → `positions.security_type` (column renamed)
- `latest_prices` PRIMARY KEY changed from `(ticker)` to `(ticker, security_type, source)`

---

### Phase 2: Backend API Updates ✅

**Branch**: `feature/source-tracking-backend-api`
**Commit**: b0faa5b
**PR**: https://github.com/mrgeneko/wealth-tracker/pull/new/feature/source-tracking-backend-api

#### Files Modified:

**1. services/symbol-registry/metadata_autocomplete_service.js**

Updated `_searchWithRanking()` SQL query (lines 77-98):
```javascript
SELECT
  sr.ticker,
  sr.name,
  sr.security_type,
  sr.exchange,
  sr.source,
  sr.pricing_provider,  // NEW
  sr.display_name,      // NEW
  sr.id
FROM ticker_registry sr
```

Updated `_formatResult()` (lines 136-147):
```javascript
const base = {
  id: row.id,
  ticker: row.ticker,
  name: row.name || row.ticker,
  type: row.security_type || 'UNKNOWN',
  exchange: row.exchange,
  source: row.source,              // NEW
  pricing_provider: row.pricing_provider,  // NEW
  display_name: row.display_name,  // NEW
  verified: true
};
```

**2. dashboard/server.js**

Updated POST `/api/positions` (lines 1420-1470):
```javascript
// Accept new fields
const { account_id, ticker, quantity, currency, type, source, pricing_provider } = normalized;

// Insert with new fields
await pool.execute(
  'INSERT INTO positions (account_id, ticker, security_type, quantity, currency, source, pricing_provider) VALUES (?, ?, ?, ?, ?, ?, ?)',
  [account_id, ticker, detectedType, quantity, currency || 'USD', source || null, pricing_provider || null]
);
```

Updated PUT `/api/positions/:id` (lines 1472-1513):
```javascript
// Update with new fields
await pool.execute(
  'UPDATE positions SET ticker=?, security_type=?, quantity=?, currency=?, source=?, pricing_provider=? WHERE id=?',
  [ticker, detectedType, quantity, currency || 'USD', source || null, pricing_provider || null, req.params.id]
);
```

Updated `loadAssets()` query (lines 522-531):
```javascript
SELECT p.*,
       sm.short_name, sm.sector, sm.market_cap,
       sm.dividend_yield, sm.trailing_pe,
       sm.ttm_dividend_amount, sm.ttm_eps,
       sm.quote_type, sm.exchange as meta_exchange,
       p.security_type as type  // Alias for backward compatibility
FROM positions p
LEFT JOIN securities_metadata sm ON p.ticker = sm.ticker
```

Updated position data object (lines 580-598):
```javascript
const positionData = {
  id: pos.id,
  ticker: pos.ticker,
  quantity: parseFloat(pos.quantity),
  cost_basis: pos.cost_basis ? parseFloat(pos.cost_basis) : 0,
  source: pos.source || null,              // NEW
  pricing_provider: pos.pricing_provider || null,  // NEW
  // ... metadata fields
};
```

---

### Phase 3: Price Router Service ✅

**Branch**: `feature/source-tracking-price-router`
**Commit**: da97227
**PR**: https://github.com/mrgeneko/wealth-tracker/pull/new/feature/source-tracking-price-router

#### New Files:

**services/price-router.js** (356 lines):

Key Methods:
```javascript
class PriceRouter {
  async fetchPrice(ticker, securityType, options)
  async _lookupPricingProvider(ticker, securityType)
  _getDefaultProvider(securityType)
  async _attemptFallback(ticker, securityType, failedProvider, options)
  async _fetchFromYahoo(ticker, securityType, options)
  async _fetchFromTreasury(ticker, securityType, options)
  async _fetchFromInvesting(ticker, securityType, options)
  async savePriceToDatabase(priceData)
  async getPriceFromDatabase(ticker, securityType)
}
```

Provider Routing Logic:
```javascript
_getDefaultProvider(securityType) {
  const typeMap = {
    'stock': 'YAHOO',
    'etf': 'YAHOO',
    'bond': 'TREASURY_GOV',
    'us_treasury': 'TREASURY_GOV',
    'crypto': 'INVESTING_COM',
    'cash': null,
    'other': 'YAHOO'
  };
  return typeMap[securityType] || 'YAHOO';
}
```

Fallback Chains:
```javascript
const fallbackChains = {
  'YAHOO': ['INVESTING_COM'],
  'INVESTING_COM': ['YAHOO'],
  'TREASURY_GOV': []  // No fallback
};
```

#### Updated Files:

**dashboard/server.js** - Updated `/api/fetch-price` endpoint (lines 998-1154):

```javascript
app.post('/api/fetch-price', async (req, res) => {
  const { ticker, type, security_type, pricing_provider } = req.body;
  let securityType = security_type || type || 'stock';

  // Use PriceRouter for intelligent routing
  const PriceRouter = require('../services/price-router');
  const priceRouter = new PriceRouter({ pool });

  const priceData = await priceRouter.fetchPrice(cleanTicker, securityType, {
    pricingProvider: pricing_provider,
    allowFallback: true
  });

  // Build composite cache key
  const cacheKey = `${cleanTicker}:${securityType}`;
  priceCache[cacheKey] = { ...priceData };

  // Legacy compatibility
  if (!priceCache[cleanTicker] || securityType === 'stock') {
    priceCache[cleanTicker] = priceCache[cacheKey];
  }

  // Save to database with composite key
  await priceRouter.savePriceToDatabase(priceData);
});
```

Cache Structure:
```javascript
priceCache = {
  "AAPL": { price: 150, ... },              // Legacy key
  "BTC:crypto": { price: 45000, ... },      // Composite key
  "BTC:etf": { price: 44, ... },            // Different type
  "BP:EQUITY:NYSE": { price: 35.50, ... },  // With source
  "BP:EQUITY:LSE": { price: 28.40, ... }    // Different exchange
}
```

---

### Phase 4: Kafka Consumer Updates ✅

**Branch**: `feature/source-tracking-kafka`
**Commits**: b99dcd7, cabf77f
**PR**: https://github.com/mrgeneko/wealth-tracker/pull/new/feature/source-tracking-kafka

#### Files Modified:

**1. wealth_tracker/scripts/consume_kafka_ck.py**

Updated CREATE TABLE (lines 68-82):
```python
cursor.execute("""
    CREATE TABLE IF NOT EXISTS latest_prices (
        ticker VARCHAR(50) NOT NULL,
        security_type VARCHAR(20) NOT NULL DEFAULT 'NOT_SET',
        source VARCHAR(50) NOT NULL DEFAULT 'unknown',
        price DECIMAL(18, 4),
        previous_close_price DECIMAL(18, 4),
        prev_close_source VARCHAR(50),
        prev_close_time DATETIME,
        quote_time DATETIME,
        capture_time DATETIME,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (ticker, security_type, source)
    )
""")
```

Updated message processing (lines 99-111):
```python
# Extract security_type (default to NOT_SET to be explicit about missing data)
security_type = data.get('security_type', 'NOT_SET')
if isinstance(security_type, str):
    security_type = security_type.upper()
else:
    security_type = 'NOT_SET'

# Extract source for composite key
base_source = data.get('source', 'unknown')
if not base_source or not isinstance(base_source, str):
    base_source = 'unknown'
```

Updated INSERT query (lines 186-216):
```python
sql = """
    INSERT INTO latest_prices (ticker, security_type, source, price,
                               previous_close_price, prev_close_source,
                               prev_close_time, quote_time, capture_time)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON DUPLICATE KEY UPDATE
        price = VALUES(price),
        previous_close_price = CASE
            WHEN VALUES(previous_close_price) IS NOT NULL
            THEN VALUES(previous_close_price)
            ELSE previous_close_price
        END,
        prev_close_source = CASE
            WHEN VALUES(previous_close_price) IS NOT NULL
            THEN VALUES(prev_close_source)
            ELSE prev_close_source
        END,
        prev_close_time = CASE
            WHEN VALUES(previous_close_price) IS NOT NULL
            THEN VALUES(prev_close_time)
            ELSE prev_close_time
        END,
        quote_time = VALUES(quote_time),
        capture_time = VALUES(capture_time)
"""
vals = (ticker, security_type, base_source, price_val,
        previous_close_price, prev_close_source, prev_close_time,
        quote_time, capture_time)
```

**2. scripts/init-db/000-base-schema.sql**

Updated to match Kafka consumer schema (lines 112-125) - see Phase 1 above.

---

## Key Architectural Decisions

### 1. Composite PRIMARY KEY Design

**Decision**: Use `(ticker, security_type, source)` instead of just `(ticker, security_type)`

**Rationale**:
- **Crypto variations**: Different sources use different ticker formats (BTC.X vs BTC-USD vs BTC-USDT)
- **Multi-exchange**: Same ticker traded on multiple exchanges (BP on NYSE vs LSE)
- **Source reliability**: Different sources may have different data quality/latency

**Example Scenarios**:
```sql
-- BTC traded as crypto on different sources
INSERT INTO latest_prices VALUES ('BTC', 'CRYPTO', 'yahoo', 45000, ...);
INSERT INTO latest_prices VALUES ('BTC', 'CRYPTO', 'investing', 45100, ...);

-- BTC as different security types
INSERT INTO latest_prices VALUES ('BTC', 'ETF', 'yahoo', 44, ...);
INSERT INTO latest_prices VALUES ('BTC', 'EQUITY', 'nasdaq', 350, ...);

-- BP on different exchanges
INSERT INTO latest_prices VALUES ('BP', 'EQUITY', 'NYSE', 35.50, ...);
INSERT INTO latest_prices VALUES ('BP', 'EQUITY', 'LSE', 28.40, ...);
```

### 2. DEFAULT 'NOT_SET' vs 'EQUITY'

**Decision**: Use `DEFAULT 'NOT_SET'` for `security_type`

**Rationale**:
- **Explicit over implicit**: Makes it obvious when data is incomplete
- **Data integrity**: Prevents false assumptions about security type
- **Debugging**: Easy to identify records needing enrichment

**Before**: `DEFAULT 'EQUITY'` would incorrectly categorize all unknown tickers as equities
**After**: `DEFAULT 'NOT_SET'` clearly indicates missing information

### 3. Backward Compatibility Strategy

**Decision**: Maintain legacy interfaces while adding new fields

**Implementation**:
- SQL alias: `p.security_type as type` in queries
- Cache keys: Both `"BTC"` (legacy) and `"BTC:crypto"` (new) populated
- API fields: Accept both `type` and `security_type` in requests
- Default values: Safe fallbacks for missing fields

**Example**:
```javascript
// Frontend can still use legacy format
POST /api/positions { ticker: "AAPL", type: "stock" }

// Backend normalizes to new format
INSERT INTO positions (ticker, security_type) VALUES ('AAPL', 'stock')

// Response includes both formats
{ ticker: "AAPL", type: "stock", security_type: "stock" }
```

### 4. Price Cache Architecture

**Decision**: Hybrid cache with composite and legacy keys

**Structure**:
```javascript
priceCache = {
  // Composite keys (new - precise)
  "BTC:crypto": { ticker: "BTC", security_type: "crypto", price: 45000, source: "yahoo" },
  "BTC:etf": { ticker: "BTC", security_type: "etf", price: 44, source: "yahoo" },

  // Legacy keys (backward compatible)
  "BTC": <reference to BTC:crypto or BTC:stock>,  // Defaults to stock or first found

  // With source (future enhancement)
  "BTC:crypto:yahoo": { ... },
  "BTC:crypto:investing": { ... }
}
```

**Benefits**:
- New code can use precise composite keys
- Legacy code continues to work with ticker-only lookups
- Gradual migration path for frontend

---

## Database Schema Evolution

### Before (Original):
```sql
CREATE TABLE latest_prices (
  ticker VARCHAR(50) PRIMARY KEY,
  price DECIMAL(18,4),
  source VARCHAR(50),
  ...
);
```

**Problem**: BTC crypto price overwrites BTC ETF price

### After Phase 1 (First Iteration):
```sql
CREATE TABLE latest_prices (
  ticker VARCHAR(50) NOT NULL,
  security_type VARCHAR(20) NOT NULL DEFAULT 'EQUITY',
  price DECIMAL(18,4),
  source VARCHAR(50),
  PRIMARY KEY (ticker, security_type)
);
```

**Problem**: BTC.X from Yahoo overwrites BTC-USD from Investing.com (same ticker, same type, different source)

### After Phase 4 (Final):
```sql
CREATE TABLE latest_prices (
  ticker VARCHAR(50) NOT NULL,
  security_type VARCHAR(20) NOT NULL DEFAULT 'NOT_SET',
  source VARCHAR(50) NOT NULL DEFAULT 'unknown',
  price DECIMAL(18,4),
  ...
  PRIMARY KEY (ticker, security_type, source)
);
```

**Solution**: Complete uniqueness across all dimensions

---

## Testing Strategy

### Unit Tests Required:
- [ ] PriceRouter provider selection logic
- [ ] PriceRouter fallback chain execution
- [ ] Autocomplete service field mapping
- [ ] Position endpoint validation
- [ ] Kafka consumer message parsing

### Integration Tests Required:
- [ ] End-to-end: Autocomplete → Position → Price → Database
- [ ] Multi-type ticker scenarios (BTC crypto vs ETF)
- [ ] Multi-source scenarios (BTC.X vs BTC-USD)
- [ ] Fallback provider switching
- [ ] Cache invalidation and updates

### Test Scenarios:

**Scenario 1: Multi-Type Ticker**
```javascript
// Add BTC as crypto
POST /api/positions { ticker: "BTC", security_type: "crypto", quantity: 1 }

// Add BTC as ETF
POST /api/positions { ticker: "BTC", security_type: "etf", quantity: 100 }

// Fetch prices - should return different values
POST /api/fetch-price { ticker: "BTC", security_type: "crypto" }
// → { price: 45000, pricing_provider: "INVESTING_COM" }

POST /api/fetch-price { ticker: "BTC", security_type: "etf" }
// → { price: 44, pricing_provider: "YAHOO" }

// Verify database has 2+ separate records
SELECT * FROM latest_prices WHERE ticker = 'BTC';
// → Returns 2+ rows with different security_type and/or source
```

**Scenario 2: Provider Fallback**
```javascript
// INVESTING_COM fails, fallback to YAHOO
POST /api/fetch-price { ticker: "BTC", security_type: "crypto" }
// → PriceRouter tries INVESTING_COM → fails
// → PriceRouter tries YAHOO → success
// → { price: 44500, pricing_provider: "YAHOO", fallback_from: "INVESTING_COM" }
```

**Scenario 3: Multi-Exchange**
```javascript
// BP on NYSE
POST /api/positions {
  ticker: "BP",
  security_type: "equity",
  source: "NYSE",
  quantity: 100
}

// BP on LSE (London Stock Exchange)
POST /api/positions {
  ticker: "BP",
  security_type: "equity",
  source: "LSE",
  quantity: 50
}

// Prices should not interfere
SELECT * FROM latest_prices WHERE ticker = 'BP';
// → BP, EQUITY, NYSE, 35.50 USD
// → BP, EQUITY, LSE, 28.40 GBP
```

---

## Migration Path

### For Existing Data:

**Step 1**: Add columns with DEFAULT values (Phase 1 complete ✅)
```sql
ALTER TABLE positions ADD COLUMN source VARCHAR(50);
ALTER TABLE positions ADD COLUMN pricing_provider VARCHAR(50);
```

**Step 2**: Backfill from ticker_registry (Not yet done ⚠️)
```sql
UPDATE positions p
JOIN ticker_registry tr ON p.ticker = tr.ticker
SET p.source = tr.source,
    p.pricing_provider = tr.pricing_provider
WHERE p.source IS NULL;
```

**Step 3**: Drop and recreate latest_prices (Requires downtime ⚠️)
```sql
-- Current data will be lost, need to refetch prices
DROP TABLE latest_prices;
-- Recreate with new schema (Phase 1 SQL)
-- Scraper daemon will repopulate
```

**Alternative Step 3**: Manual migration (Zero downtime)
```sql
-- Create new table
CREATE TABLE latest_prices_new ( ... composite PK ... );

-- Copy data with default source='unknown'
INSERT INTO latest_prices_new
SELECT ticker, 'NOT_SET', 'unknown', price, ... FROM latest_prices;

-- Atomic swap
RENAME TABLE latest_prices TO latest_prices_old,
             latest_prices_new TO latest_prices;
```

---

## Next Steps

### Phase 5: Frontend Updates (Not Started)

**Branch**: `feature/source-tracking-frontend`

**Required Changes**:

1. **Autocomplete Component**:
   - Display `display_name` field instead of just `ticker`
   - Show source badge/icon for clarity
   - Example: "BTC - Bitcoin (CRYPTO, investing.com)"

2. **Position Form**:
   - Capture `source` and `pricing_provider` when adding positions
   - Auto-populate from autocomplete selection
   - Allow manual override if needed

3. **Dashboard Display**:
   - Show source tracking info in position details
   - Add tooltips explaining source/provider
   - Visual indicators for multi-type tickers

4. **Position Table**:
   ```html
   <td>
     BTC
     <span class="badge badge-crypto">Crypto</span>
     <span class="badge badge-source">investing.com</span>
   </td>
   ```

### Phase 6: Comprehensive Testing (Not Started)

**Branch**: `feature/source-tracking-tests`

- Unit tests for all components
- Integration tests for full workflows
- E2E tests for user scenarios
- Performance tests for large datasets

### Phase 7: Documentation (Not Started)

**Branch**: `docs/source-tracking-documentation`

- Update README with source tracking features
- API documentation updates
- Architecture diagrams
- Migration guide for existing deployments

---

## Open Questions / Future Enhancements

1. **Price Aggregation**: Should we aggregate prices from multiple sources?
   - Average of yahoo + investing for BTC crypto?
   - Pick most recent?
   - Pick most reliable source?

2. **Source Priority**: Implement source ranking/priority?
   - NYSE > NASDAQ for US stocks?
   - Yahoo > Investing for general equities?
   - Configurable per user?

3. **Historical Data**: How to handle historical prices with source tracking?
   - Need security_type + source in historical tables?
   - Migration strategy for existing historical data?

4. **UI/UX**: How to present source info without overwhelming users?
   - Tooltips?
   - Collapsible sections?
   - Advanced mode toggle?

5. **Performance**: Index strategy for composite key queries?
   ```sql
   -- Current index
   KEY idx_latest_prices_ticker (ticker)

   -- Additional indices needed?
   KEY idx_latest_prices_type_source (security_type, source)
   KEY idx_latest_prices_ticker_type (ticker, security_type)
   ```

---

## Risks & Mitigations

### Risk 1: Data Migration Complexity
**Risk**: Existing data lacks source/provider information
**Mitigation**:
- Use DEFAULT values ('NOT_SET', 'unknown')
- Backfill script from ticker_registry
- Gradual enrichment as data is updated

### Risk 2: Breaking Changes
**Risk**: Frontend expects old schema
**Mitigation**:
- Backward compatibility layer (type alias)
- Phased rollout
- Feature flags

### Risk 3: Performance Degradation
**Risk**: Composite key queries slower than simple key
**Mitigation**:
- Proper indexing strategy
- Query optimization
- Caching layer

### Risk 4: Source Consistency
**Risk**: Same ticker from different sources may have different formats
**Mitigation**:
- Ticker normalization layer
- Source-specific parsing rules
- Validation at ingestion

---

## Metrics & Monitoring

### Success Metrics:
- [ ] Zero price collision incidents (BTC crypto != BTC ETF)
- [ ] 100% source attribution (no 'unknown' sources in production)
- [ ] <100ms query performance for composite key lookups
- [ ] Zero data loss during migration

### Monitoring:
```sql
-- Records with missing source tracking
SELECT COUNT(*) FROM positions WHERE source IS NULL;
SELECT COUNT(*) FROM latest_prices WHERE source = 'unknown';

-- Multi-type ticker detection
SELECT ticker, COUNT(DISTINCT security_type) as types
FROM latest_prices
GROUP BY ticker
HAVING types > 1;

-- Source distribution
SELECT source, security_type, COUNT(*)
FROM latest_prices
GROUP BY source, security_type;
```

---

## Conclusion

The backend infrastructure for source tracking is now complete and ready for frontend integration. The implementation successfully addresses the core problem of price confusion for multi-type tickers while maintaining backward compatibility with existing code.

**Key Achievements**:
- ✅ Composite PRIMARY KEY prevents all known collision scenarios
- ✅ Backward compatibility ensures smooth transition
- ✅ Provider routing enables intelligent price fetching
- ✅ Kafka consumer supports full source tracking pipeline

**Next Priority**: Phase 5 (Frontend Updates) to surface this functionality to users.

---

**Document Version**: 1.0
**Last Updated**: 2025-12-21
**Author**: AI Implementation (Claude Sonnet 4.5)
