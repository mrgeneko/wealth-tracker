# Git Commit Message

## feat: Add real-time price fetching with Kafka persistence on symbol addition

### Summary
This commit adds synchronous price fetching when adding new symbols to the dashboard,
ensuring prices display immediately without waiting for scheduled scrapers. Prices are
fetched from Yahoo Finance, cached locally, broadcast via Socket.io, and persisted to
MySQL through Kafka for consistency with the existing data pipeline.

### Changes

#### 1. Symbol Registry Initialization - Database Retry Logic
**File:** `dashboard/server.js`

- **Problem:** On fresh container startup, the symbol registry wasn't initializing because
  the database connection wasn't ready when `initializeSymbolRegistry()` was called.
- **Solution:** Added retry logic that waits for the database to be ready before syncing CSV
  files. Makes up to 10 attempts with 2-second delays between retries.
- **Impact:** Symbol autocomplete now works reliably on fresh container startup.

#### 2. New `/api/fetch-price` Endpoint
**File:** `dashboard/server.js` (lines 706-817)

- **Purpose:** Fetch current price for a symbol on-demand and inject into the system.
- **Features:**
  - Fetches real-time price from Yahoo Finance using `yahoo-finance2` v3
  - Updates the in-memory `priceCache` for immediate UI display
  - Broadcasts price update to all connected clients via Socket.io
  - Publishes to Kafka topic `price_data` for MySQL persistence via existing consumer
  - Non-blocking Kafka - failures don't prevent price from displaying
  
- **API Details:**
  - Method: POST
  - Path: `/api/fetch-price`
  - Body: `{ "symbol": "AAPL" }`
  - Response: `{ symbol, price, previousClose, currency, timestamp, cached, persisted }`

#### 3. Kafka Message Format Fix
**File:** `dashboard/server.js`

- **Problem:** Kafka consumer expects a `key` field in the message body to identify the ticker.
- **Solution:** Added `key: cleanSymbol` to the Kafka message alongside `symbol` and `normalized_key`.
- **Message Format:**
  ```json
  {
    "key": "AAPL",
    "symbol": "AAPL",
    "normalized_key": "AAPL",
    "regular_price": 150.25,
    "previous_close_price": 149.50,
    "currency": "USD",
    "time": "2025-01-15T12:00:00.000Z",
    "source": "yahoo",
    "scraper": "dashboard-fetch"
  }
  ```

#### 4. Frontend Integration
**File:** `dashboard/public/index.html`

- **Symbol Lookup Button:** When clicking "Lookup", now fetches and displays current price
  immediately with status: "✅ Found! Current price: $XXX.XX"
  
- **Form Submission:** Before creating a position, fetches the current price so it displays
  immediately in the investment grid without waiting for Kafka consumer lag or scheduled scrapers.

- **Changes to `lookupSymbolMetadata()`:**
  - Added call to `/api/fetch-price` after metadata lookup
  - Shows loading state: "⏳ Fetching current price..."
  - Displays fetched price or graceful fallback on failure

#### 5. Dotenv Optional Loading
**File:** `scripts/populate/populate_securities_metadata.js`

- **Problem:** Script failed in Docker containers where `dotenv` isn't installed because
  environment variables are provided directly by Docker Compose.
- **Solution:** Wrapped `require('dotenv').config()` in try/catch to make it optional.
- **Before:** `require('dotenv').config();`
- **After:** `try { require('dotenv').config(); } catch (e) { /* dotenv not available */ }`

### New Test Files

#### Unit Tests
- `tests/unit/api/fetch-price.test.js` (14 tests)
  - Symbol validation (missing, empty, uppercase)
  - Yahoo Finance response handling
  - Price cache updates
  - Socket.io broadcast verification
  - Kafka message format validation (including `key` field requirement)
  - Error handling (Yahoo errors, Kafka failures, missing data)
  - Currency defaults and null previousClose handling

- `tests/unit/dashboard/symbol-registry-init.test.js` (9 tests)
  - Database retry logic (waiting, max retries, immediate success)
  - CSV sync process (all file types, error handling)
  - Verification after sync
  - Dotenv optional loading

#### Integration Tests
- `tests/integration/fetch-price-integration.test.js`
  - End-to-end tests for running dashboard (skipped in CI unless services available)
  - Tests actual Yahoo Finance calls and Kafka persistence

### Test Results
```
Test Suites: 2 passed, 2 total
Tests:       23 passed, 23 total
```

### Technical Details

#### yahoo-finance2 v3 Instantiation
The v3 version of `yahoo-finance2` requires instantiation:
```javascript
const YahooFinanceClass = require('yahoo-finance2').default || require('yahoo-finance2');
const yahooFinance = new YahooFinanceClass({
    suppressNotices: ['yahooSurvey', 'rippieTip']
});
```

#### Data Flow
```
User adds symbol → lookupSymbolMetadata() 
    → POST /api/fetch-price
    → Yahoo Finance API (quote)
    → priceCache[symbol] updated
    → io.emit('price_update', priceCache)
    → Kafka producer → price_data topic → Consumer → MySQL latest_prices
```

### Breaking Changes
None - all changes are backward compatible.

### Migration Notes
- No database migrations required
- New tests automatically included in CI via existing jest configuration
- Integration tests skipped by default (set `SKIP_INTEGRATION_TESTS=false` to run)

---

**Commit command:**
```bash
git add dashboard/server.js dashboard/public/index.html \
        scripts/populate/populate_securities_metadata.js \
        tests/unit/api/fetch-price.test.js \
        tests/unit/dashboard/symbol-registry-init.test.js \
        tests/integration/fetch-price-integration.test.js

git commit -m "feat: Add real-time price fetching with Kafka persistence on symbol addition

- Add database retry logic to symbol registry initialization
- Add POST /api/fetch-price endpoint for on-demand Yahoo Finance quotes
- Update priceCache and broadcast via Socket.io for immediate display
- Publish to Kafka with correct message format (key field) for MySQL persistence
- Integrate price fetch into symbol lookup and form submission
- Make dotenv optional in metadata script for Docker compatibility
- Add 23 unit tests covering all new functionality"
```
