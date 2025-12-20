# Autocomplete Enhancement Design Document

## Overview

This document outlines the design, implementation, and testing plan for improving the coverage and quality of the autocomplete feature and associated metadata in the wealth-tracker application.

## Current State Analysis

### Existing Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ticker_registry.js` | `dashboard/` | Loads symbols from CSV files (NASDAQ, NYSE, OTHER, Treasury) |
| `populate_securities_metadata.js` | `scripts/populate/` | Populates `securities_metadata` table from Yahoo Finance |
| `populate_popular_securities.js` | `scripts/populate/` | Populates metadata for hardcoded popular symbols |
| `/api/metadata/autocomplete` | `api/metadata.js` | Autocomplete endpoint (only searches `securities_metadata`) |
| `/api/tickers` | `dashboard/server.js` | Unused endpoint that loads from CSV files |
| `update_exchange_listings.js` | `scripts/setup/` | Downloads NASDAQ/NYSE/OTHER listings from GitHub |
| `update_treasury_listings.js` | `scripts/setup/` | Downloads Treasury auction data via Puppeteer |
| `metadata_cron.conf` | `config/` | Cron configuration (only refreshes hardcoded symbols) |

### Data Sources & Counts

| File | Records | Format |
|------|---------|--------|
| `nasdaq-listed.csv` | ~5,225 | Symbol, Security Name |
| `nyse-listed.csv` | ~2,892 | ACT Symbol, Company Name |
| `other-listed.csv` | ~6,837 | ACT Symbol, Company Name, Exchange, ETF flag, etc. |
| `us-treasury-auctions.csv` | ~2,149 | CUSIP, Security Type, Security Term, Auction/Issue/Maturity Dates |
| `Auctions_Query_19791115_20251215.csv` | ~10,780 | Same format as above (historical data since 1979) |

### Current Limitations

1. **Autocomplete only searches `securities_metadata`** - Symbols must have Yahoo metadata to appear
2. **No Treasury support** - Treasuries don't exist in Yahoo Finance
3. **Cron jobs only refresh hardcoded lists** - Exchange/Treasury files not refreshed automatically
4. **Missed updates** - Cron misses updates if system is down during scheduled time
5. **No metrics** - No visibility into metadata population coverage

---

## Proposed Architecture

### New Database Schema

#### `ticker_registry` Table

```sql
CREATE TABLE ticker_registry (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticker VARCHAR(50) NOT NULL,
    name VARCHAR(500),
    exchange VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
    security_type ENUM('NOT_SET','EQUITY','ETF','BOND','US_TREASURY','MUTUAL_FUND','OPTION','CRYPTO','FX','FUTURES','INDEX','OTHER') NOT NULL DEFAULT 'NOT_SET',
    source ENUM('NASDAQ_FILE','NYSE_FILE','OTHER_LISTED_FILE','TREASURY_FILE','TREASURY_HISTORICAL','YAHOO','USER_ADDED') NOT NULL,
    has_yahoo_metadata TINYINT(1) DEFAULT 0,
    permanently_failed TINYINT(1) DEFAULT 0,
    permanent_failure_reason VARCHAR(255) DEFAULT NULL,
    permanent_failure_at TIMESTAMP NULL DEFAULT NULL,
    usd_trading_volume DECIMAL(20, 2) NULL,
    sort_rank INT DEFAULT 1000,  -- Lower = higher priority in autocomplete
    
    -- Treasury-specific fields
    issue_date DATE NULL,
    maturity_date DATE NULL,     -- Also used for bonds
    security_term VARCHAR(50) NULL, -- e.g., "4-Week", "10-Year"
    
    -- Option/Context-specific fields
    underlying_ticker VARCHAR(50) DEFAULT NULL,
    underlying_exchange VARCHAR(50) DEFAULT NULL,
    underlying_security_type ENUM('NOT_SET','EQUITY','ETF','BOND','US_TREASURY','MUTUAL_FUND','OPTION','CRYPTO','FX','FUTURES','INDEX','OTHER') DEFAULT NULL,
    strike_price DECIMAL(18, 4) NULL,
    option_type ENUM('CALL', 'PUT') NULL,
    expiration_date DATE NULL,   -- For options and futures
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    UNIQUE KEY unique_ticker_context (ticker, exchange, security_type),
    INDEX idx_ticker (ticker),
    INDEX idx_security_type (security_type),
    INDEX idx_sort_rank (sort_rank),
    INDEX idx_maturity_date (maturity_date),
    INDEX idx_expiration_date (expiration_date),
    INDEX idx_underlying (underlying_ticker, underlying_exchange, underlying_security_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### `ticker_registry_metrics` Table

```sql
CREATE TABLE ticker_registry_metrics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    metric_date DATE NOT NULL,
    source VARCHAR(50) NOT NULL,
    total_tickers INT NOT NULL,
    tickers_with_yahoo_metadata INT NOT NULL,
    tickers_without_yahoo_metadata INT NOT NULL,
    last_file_refresh_at TIMESTAMP NULL,
    file_download_duration_ms INT NULL,
    avg_yahoo_fetch_duration_ms INT NULL,
    errors_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_date_source (metric_date, source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### `file_refresh_status` Table

```sql
CREATE TABLE file_refresh_status (
    id INT AUTO_INCREMENT PRIMARY KEY,
    file_type ENUM('NASDAQ', 'NYSE', 'OTHER', 'TREASURY') NOT NULL UNIQUE,
    last_refresh_at TIMESTAMP NULL,
    last_refresh_duration_ms INT NULL,
    last_refresh_status ENUM('SUCCESS', 'FAILED', 'IN_PROGRESS') DEFAULT 'SUCCESS',
    last_error_message TEXT NULL,
    tickers_added INT DEFAULT 0,
    tickers_updated INT DEFAULT 0,
    next_refresh_due_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Source Priority Rules

When a symbol exists in multiple sources, `source` is determined by priority:

1. **File sources take precedence over USER_ADDED** - If a user adds a symbol that later appears in a file, update source to the file
2. **More authoritative files win** - Priority: NASDAQ_FILE > NYSE_FILE > OTHER_LISTED_FILE > TREASURY_FILE > TREASURY_HISTORICAL > YAHOO > USER_ADDED
3. **`has_yahoo_metadata`** - Set to TRUE if metadata exists in `securities_metadata`, regardless of source

### Sort Rank Calculation

The `sort_rank` field determines autocomplete ordering:


```javascript
function calculateSortRank(securityType, hasYahooMetadata, usdTradingVolume) {
    let rank = 1000;
    
    // Security type ranking (lower = better)
    // Priority: Equities > ETFs > Crypto > Indices > FX > Futures > Options > Treasuries
    const typeRanks = {
      'NOT_SET': 9999,
      'EQUITY': 100,
      'ETF': 200,
      'CRYPTO': 300,
      'INDEX': 400,
      'FX': 500,
      'FUTURES': 600,
      'OPTION': 700,
      'US_TREASURY': 800,
      'BOND': 850,
      'MUTUAL_FUND': 900,
      'OTHER': 1000
    };
    rank = typeRanks[securityType] || 1000;
    
    // Bonus for having Yahoo metadata
    if (hasYahooMetadata) rank -= 50;
    
    // Volume-based adjustment (if available)
    if (usdTradingVolume) {
        if (usdTradingVolume > 1000000000) rank -= 40;      // > $1B
        else if (usdTradingVolume > 100000000) rank -= 30;  // > $100M
        else if (usdTradingVolume > 10000000) rank -= 20;   // > $10M
        else if (usdTradingVolume > 1000000) rank -= 10;    // > $1M
    }
    
    return rank;
}
```

---

## Component Design

### 1. Symbol Registry Service

**Location:** `services/symbol-registry/symbol_registry_service.js`

```javascript
class SymbolRegistryService {
    // Configuration (environment variables with defaults)
    static CONFIG = {
        FILE_REFRESH_INTERVAL_HOURS: process.env.FILE_REFRESH_INTERVAL_HOURS || 24,
        YAHOO_BATCH_SIZE: process.env.YAHOO_BATCH_SIZE || 50,
        YAHOO_DELAY_MS: process.env.YAHOO_DELAY_MS || 2000,
        YAHOO_MAX_SYMBOLS_PER_RUN: process.env.YAHOO_MAX_SYMBOLS_PER_RUN || 500,
        TREASURY_EXPIRY_CUTOFF_DAYS: process.env.TREASURY_EXPIRY_CUTOFF_DAYS || 59,
        OPTION_EXPIRY_CUTOFF_DAYS: process.env.OPTION_EXPIRY_CUTOFF_DAYS || 59,
        FUTURES_EXPIRY_CUTOFF_DAYS: process.env.FUTURES_EXPIRY_CUTOFF_DAYS || 59,
        AUTOCOMPLETE_MAX_RESULTS: process.env.AUTOCOMPLETE_MAX_RESULTS || 20
    };
    
    // Core methods
    async refreshAllFiles();
    async refreshExchangeListings();
    async refreshTreasuryListings();
    async syncSymbolRegistry();
    async populateYahooMetadataBatch();
    async lookupSymbol(symbol);  // For Add Symbol modal
    async autocomplete(query, limit);
    async getMetrics();
    async checkAndRefreshIfDue();
}
```

### 2. File Refresh Manager

**Location:** `services/symbol-registry/file_refresh_manager.js`

Responsibilities:
- Track last refresh time for each file
- Determine if refresh is due (configurable interval, default 24 hours)
- Handle refresh on container startup
- Run independently (not tied to scrape daemon's runCycle)

```javascript
class FileRefreshManager {
    async checkRefreshNeeded(fileType);
    async performRefresh(fileType);
    async refreshAllIfDue();
    async onContainerStartup();  // Called on startup to check all files
}
```

### 3. Treasury Data Handler

**Location:** `services/symbol-registry/treasury_data_handler.js`

Special handling for Treasury securities:
- Merge `us-treasury-auctions.csv` (recent) with `Auctions_Query_19791115_20251215.csv` (historical)
- Filter out treasuries matured > 59 days ago (configurable via `TREASURY_EXPIRY_CUTOFF_DAYS`)
- Format name: `{SecurityType} {SecurityTerm} | Issue: {IssueDate} | Maturity: {MaturityDate}`
- Set exchange to "OTC"

```javascript
class TreasuryDataHandler {
    async loadAndMergeTreasuryData();
    filterMaturedTreasuries(records, cutoffDays = 59);
    formatTreasuryName(record);
    async syncToRegistry();
}
```

### 4. Expiration Cleanup Service

**Location:** `services/symbol-registry/expiration_cleanup_service.js`

Handles cleanup of expired securities from the registry:
- Removes treasuries that matured > N days ago (configurable, default 59)
- Removes options that expired > N days ago (configurable, default 59)
- Removes futures contracts that expired > N days ago (configurable, default 59)
- Can be triggered manually or run on schedule
- Logs cleanup metrics

```javascript
class ExpirationCleanupService {
    // Configuration
    static CONFIG = {
        TREASURY_EXPIRY_CUTOFF_DAYS: process.env.TREASURY_EXPIRY_CUTOFF_DAYS || 59,
        OPTION_EXPIRY_CUTOFF_DAYS: process.env.OPTION_EXPIRY_CUTOFF_DAYS || 59,
        FUTURES_EXPIRY_CUTOFF_DAYS: process.env.FUTURES_EXPIRY_CUTOFF_DAYS || 59
    };
    
    // Core methods
    async cleanupExpiredTreasuries();
    async cleanupExpiredOptions();
    async cleanupExpiredFutures();
    async cleanupAll();  // Run all cleanup
    async getExpiredCounts();  // Preview what would be deleted
}
```

### 5. Yahoo Metadata Populator (Background Job)

**Location:** `services/symbol-registry/yahoo_metadata_populator.js`

Runs as background job, never blocks startup:
- Processes symbols without Yahoo metadata
- Respects throttling configuration
- Tracks timing metrics per symbol
- Updates `has_yahoo_metadata` and `sort_rank` after population

```javascript
class YahooMetadataPopulator {
    async runBatch();
    async populateSymbol(symbol);
    async getNextBatch(batchSize);
    isRunning();  // Prevent concurrent runs
}
```

### 6. Enhanced Autocomplete Endpoint

**Location:** `api/metadata.js` (modify existing)

New autocomplete query that searches `symbol_registry`:

```sql
SELECT 
    sr.ticker,
    COALESCE(sm.long_name, sm.short_name, sr.name) as name,
    sr.security_type,
    COALESCE(sm.exchange, sr.exchange) as exchange,
    sr.has_yahoo_metadata,
    sr.maturity_date,
    sr.issue_date,
    sr.security_term
FROM ticker_registry sr
LEFT JOIN securities_metadata sm ON sr.symbol = sm.symbol
WHERE 
    sr.ticker LIKE ? 
    OR sr.name LIKE ?
    OR sm.short_name LIKE ?
    OR sm.long_name LIKE ?
ORDER BY 
    CASE WHEN sr.ticker = ? THEN 1
         WHEN sr.ticker LIKE ? THEN 2
         ELSE 3 END,
    sr.sort_rank ASC,
    sr.symbol ASC
LIMIT ?
```

### 6. Dashboard Settings Integration

**Location:** `dashboard/public/index.html` (settings modal)

Add to settings modal:
- "Refresh Exchange Listings" button
- "Refresh Treasury Listings" button
- "Refresh Yahoo Metadata" button (triggers background job)
- Metrics display:
  - Total symbols by source
  - Symbols with/without Yahoo metadata
  - Last refresh times
  - Average Yahoo fetch duration

### 7. Add Symbol Modal Enhancement

**Location:** `dashboard/public/index.html`

When user enters unknown symbol:
1. Show "Checking symbol..." message
2. Call new endpoint: `POST /api/metadata/lookup`
3. If found: Add to `symbol_registry` and `securities_metadata`, show success
4. If not found: Show warning, allow adding as stock (default type)
5. Security type field becomes read-only display after lookup

---

## API Endpoints

### New Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/metadata/lookup` | Lookup single symbol (for Add Symbol modal) |
| POST | `/api/admin/refresh-files` | Trigger file refresh (for settings) |
| POST | `/api/admin/refresh-metadata` | Trigger Yahoo metadata batch (for settings) |
| POST | `/api/admin/cleanup-expired` | Trigger cleanup of expired securities |
| GET | `/api/admin/metrics` | Get registry metrics |
| GET | `/api/admin/refresh-status` | Get file refresh status |
| GET | `/api/admin/expired-preview` | Preview expired securities before cleanup |

### Modified Endpoints

| Endpoint | Change |
|----------|--------|
| `/api/metadata/autocomplete` | Query `symbol_registry` instead of just `securities_metadata` |

---

## Configuration

### Environment Variables

```bash
# File refresh settings
FILE_REFRESH_INTERVAL_HOURS=24
FILE_REFRESH_ON_STARTUP=true

# Yahoo metadata population settings
YAHOO_BATCH_SIZE=50
YAHOO_DELAY_MS=2000
YAHOO_MAX_SYMBOLS_PER_RUN=500
YAHOO_POPULATE_ON_STARTUP=true

# Autocomplete settings
AUTOCOMPLETE_MAX_RESULTS=20

# Expiration cleanup settings (in days)
TREASURY_EXPIRY_CUTOFF_DAYS=59
OPTION_EXPIRY_CUTOFF_DAYS=59
FUTURES_EXPIRY_CUTOFF_DAYS=59

# Metrics
METRICS_LOG_FILE=/app/logs/registry_metrics.log
```

---

## Implementation Phases

### Phase 1: Database Schema & Core Service (Est. 2-3 hours)

1. Create migration script for new tables
2. Create `SymbolRegistryService` base class
3. Create `TreasuryDataHandler` with merge/filter logic
4. Write unit tests for treasury filtering and name formatting

**Files to create:**
- `scripts/migrations/create_symbol_registry.js`
- `services/symbol-registry/index.js`
- `services/symbol-registry/symbol_registry_service.js`
- `services/symbol-registry/treasury_data_handler.js`
- `tests/unit/services/symbol-registry/treasury_data_handler.test.js`
- `tests/unit/services/symbol-registry/symbol_registry_service.test.js`

**CI Tests for Phase 1 PR:**
- Unit tests for `TreasuryDataHandler`:
  - Treasury file loading and merging
  - Maturity date filtering (59-day cutoff)
  - Treasury name formatting
  - Handling malformed records
- Unit tests for `SymbolRegistryService`:
  - Sort rank calculation for all security types
  - Source priority logic
  - Database connection handling
- Migration script execution (integration test with test DB)

### Phase 2: File Refresh Manager (Est. 2 hours)

1. Create `FileRefreshManager` class
2. Implement refresh tracking in database
3. Add startup check logic
4. Integrate with container startup (not daemon runCycle)
5. Write unit tests

**Files to create:**
- `services/symbol-registry/file_refresh_manager.js`
- `tests/unit/services/symbol-registry/file_refresh_manager.test.js`

**Files to modify:**
- `dashboard/server.js` - Add startup hook
- `docker/entrypoint_unified.sh` - Optional startup script

**CI Tests for Phase 2 PR:**
- Unit tests for `FileRefreshManager`:
  - Refresh interval calculation
  - Refresh due detection
  - Status tracking (SUCCESS, FAILED, IN_PROGRESS)
  - Error handling and retry logic
- Integration tests:
  - `file_refresh_status` table updates
  - Startup hook execution
  - Concurrent refresh prevention

### Phase 3: Symbol Registry Sync (Est. 2-3 hours)

1. Implement `syncSymbolRegistry()` to load all CSV files into `symbol_registry`
2. Handle source priority and deduplication
3. Calculate sort ranks
4. Handle treasury special cases
5. Write unit tests

**Files to modify:**
- `services/symbol-registry/symbol_registry_service.js`

**Tests to add:**
- `tests/unit/services/symbol-registry/symbol_registry_sync.test.js`

**CI Tests for Phase 3 PR:**
- Unit tests for `syncSymbolRegistry()`:
  - NASDAQ file parsing and loading
  - NYSE file parsing and loading
  - OTHER file parsing and loading
  - Treasury file merging (recent + historical)
  - Deduplication across sources
  - Source priority handling (file source updates USER_ADDED)
  - Sort rank assignment by security type
  - ETF detection from OTHER file
- Integration tests:
  - Full sync with test CSV files
  - Incremental sync (new symbols detection)
  - Database record validation

### Phase 4: Yahoo Metadata Populator (Est. 2 hours)

1. Create background job class
2. Implement batch processing with throttling
3. Track metrics per symbol
4. Update `has_yahoo_metadata` and `sort_rank`
5. Write unit tests (with mocks)

**Files to create:**
- `services/symbol-registry/yahoo_metadata_populator.js`
- `tests/unit/services/symbol-registry/yahoo_metadata_populator.test.js`

**CI Tests for Phase 4 PR:**
- Unit tests for `YahooMetadataPopulator` (with mocked Yahoo API):
  - Batch size configuration
  - Delay between requests (throttling)
  - Max symbols per run limit
  - `has_yahoo_metadata` flag update
  - `sort_rank` adjustment after metadata fetch
  - Timing metrics collection
  - Error handling (429, timeouts, invalid symbols)
  - Concurrent run prevention (`isRunning()`)
- Integration tests:
  - Background job execution
  - Progress tracking
  - Resume after interruption

### Phase 5: Enhanced Autocomplete (Est. 1-2 hours)

1. Modify `/api/metadata/autocomplete` to query `symbol_registry`
2. Implement new sorting logic
3. Add configurable result limit
4. Write integration tests

**Files to modify:**
- `api/metadata.js`

**Tests to add:**
- `tests/unit/api/autocomplete.test.js`
- `tests/integration/autocomplete_integration.test.js`

**CI Tests for Phase 5 PR:**
- Unit tests for autocomplete:
  - Exact symbol match ranking
  - Prefix match ranking
  - Contains match ranking
  - Security type priority (Equity > ETF > Crypto > ... > Treasury)
  - Result limit configuration
  - Empty query handling
  - Special character handling
- Integration tests:
  - Full autocomplete with `symbol_registry` data
  - JOIN with `securities_metadata` for enriched results
  - Treasury results with OTC exchange
  - Performance test (response time < threshold)

### Phase 6: Admin API Endpoints (Est. 1-2 hours)

1. Create refresh trigger endpoints
2. Create metrics endpoint
3. Create cleanup trigger endpoint
4. Add authentication/authorization
5. Write tests

**Files to modify:**
- `api/metadata.js` or create `api/admin.js`

**CI Tests for Phase 6 PR:**
- Unit tests for admin endpoints:
  - `POST /api/admin/refresh-files` - trigger validation
  - `POST /api/admin/refresh-metadata` - trigger validation
  - `POST /api/admin/cleanup-expired` - cleanup execution
  - `GET /api/admin/metrics` - response format
  - `GET /api/admin/refresh-status` - status retrieval
  - `GET /api/admin/expired-preview` - preview counts
- Authentication tests:
  - Unauthorized access rejection
  - Valid auth acceptance
- Integration tests:
  - End-to-end refresh trigger
  - Metrics accuracy validation

### Phase 7: Dashboard Integration (Est. 2-3 hours)

1. Add buttons to settings modal:
   - "Refresh Exchange Listings"
   - "Refresh Treasury Listings"
   - "Refresh Yahoo Metadata"
   - "Cleanup Expired Securities"
2. Add metrics display
3. Enhance Add Symbol modal with lookup
4. Handle loading states and error messages
5. Do NOT change dashboard layout/appearance

**Files to modify:**
- `dashboard/public/index.html`
- `dashboard/public/app.js` (if exists)
- `dashboard/public/style.css` (minimal, only for new elements)

**CI Tests for Phase 7 PR:**
- Unit tests for Add Symbol modal:
  - Symbol lookup API call
  - Loading state display ("Checking symbol...")
  - Success state (metadata found)
  - Warning state (symbol not recognized)
  - Security type display (read-only after lookup)
  - Default to stock when lookup fails
- Integration tests:
  - Settings modal button functionality
  - Metrics display accuracy
  - API endpoint integration from UI

### Phase 8: Metrics & Logging (Est. 1-2 hours)

1. Implement metrics collection
2. Create metrics log file
3. Add scheduled metrics generation
4. Write tests

**Files to create:**
- `services/symbol-registry/metrics_collector.js`
- `tests/unit/services/symbol-registry/metrics_collector.test.js`

**CI Tests for Phase 8 PR:**
- Unit tests for `MetricsCollector`:
  - Total symbols per source count
  - Symbols with/without Yahoo metadata count
  - Last refresh timestamps
  - File download duration tracking
  - Average Yahoo fetch duration calculation
  - Error rate calculation
  - Log file writing
- Integration tests:
  - Metrics persistence in database
  - Log file format validation
  - Scheduled generation timing

### Phase 9: CI Integration (Est. 1-2 hours)

1. Add unit tests to CI workflow
2. Add integration tests with mocked Yahoo API
3. Update test documentation

**Files to modify:**
- `.github/workflows/ttm-integration-tests.yml`
- `jest.config.js`

**CI Tests for Phase 9 PR:**
- Verify all previous phase tests run in CI
- Mock configuration for Yahoo API in CI environment
- Test isolation (no external dependencies)
- Coverage report generation
- Test timing validation

### Phase 10: Expiration Cleanup Service (Est. 1-2 hours)

1. Create `ExpirationCleanupService` class
2. Implement cleanup for treasuries, options, futures
3. Add preview method (show what would be deleted)
4. Add manual trigger via admin endpoint
5. Write unit tests

**Files to create:**
- `services/symbol-registry/expiration_cleanup_service.js`
- `tests/unit/services/symbol-registry/expiration_cleanup_service.test.js`

**CI Tests for Phase 10 PR:**
- Unit tests for `ExpirationCleanupService`:
  - Treasury cleanup (maturity_date > 59 days ago)
  - Option cleanup (expiration_date > 59 days ago)
  - Futures cleanup (expiration_date > 59 days ago)
  - Configurable cutoff days
  - Preview method (dry run)
  - Cleanup metrics logging
  - Batch deletion for large datasets
- Integration tests:
  - Full cleanup cycle
  - Database record removal verification
  - Admin endpoint trigger
  - Preview vs actual cleanup consistency

### Phase 11: Documentation & Cleanup (Est. 1-2 hours)

1. Create `docs/AUTOCOMPLETE_SYSTEM.md`
2. Update `README.md`
3. Update `docs/METADATA_SYSTEM_COMPLETE.md`
4. Identify and remove obsolete code (see Cleanup Candidates below)
5. Add inline code documentation

---

## File Structure (New/Modified Files)

```
wealth-tracker/
├── services/                              # NEW DIRECTORY (project root)
│   ├── symbol-registry/                   # Symbol registry services
│   │   ├── index.js                       # Service exports
│   │   ├── symbol_registry_service.js     # Core service
│   │   ├── file_refresh_manager.js        # File refresh logic
│   │   ├── treasury_data_handler.js       # Treasury-specific logic
│   │   ├── yahoo_metadata_populator.js    # Background Yahoo populator
│   │   ├── expiration_cleanup_service.js  # Cleanup expired securities
│   │   └── metrics_collector.js           # Metrics collection
│   └── [future services]/                 # Other services can be added here
├── scripts/
│   └── migrations/
│       └── create_symbol_registry.js      # Database migration
├── api/
│   └── metadata.js                        # MODIFIED - enhanced autocomplete
├── dashboard/
│   ├── server.js                          # MODIFIED - startup hooks, admin endpoints
│   ├── ticker_registry.js                 # TO BE DEPRECATED (see cleanup)
│   └── public/
│       └── index.html                     # MODIFIED - settings modal, Add Symbol modal
├── config/
│   └── metadata_cron.conf                 # MODIFIED - remove obsolete cron jobs
├── tests/
│   └── unit/
│       └── services/
│           └── symbol-registry/
│               ├── symbol_registry_service.test.js
│               ├── treasury_data_handler.test.js
│               ├── file_refresh_manager.test.js
│               ├── yahoo_metadata_populator.test.js
│               ├── expiration_cleanup_service.test.js
│               └── metrics_collector.test.js
├── docs/
│   ├── design/
│   │   └── AUTOCOMPLETE_ENHANCEMENT_DESIGN.md  # This document
│   ├── AUTOCOMPLETE_SYSTEM.md             # NEW - user-facing documentation
│   └── METADATA_SYSTEM_COMPLETE.md        # MODIFIED - reference new system
└── logs/
    └── registry_metrics.log               # NEW - metrics log file
```

---

## Cleanup Candidates (Post-Implementation)

After the new symbol registry system is implemented, the following files/code should be reviewed for removal or deprecation:

### Files to Remove/Deprecate

| File | Reason | Action |
|------|--------|--------|
| `dashboard/ticker_registry.js` | Replaced by `symbol_registry_service.js` | Remove after migration |
| `/api/tickers` endpoint in `dashboard/server.js` | Unused, replaced by `/api/metadata/autocomplete` | Remove |
| `scripts/populate/populate_popular_securities.js` | Hardcoded list no longer needed | Remove or archive |

### Cron Jobs to Remove (in `config/metadata_cron.conf`)

| Cron Job | Reason |
|----------|--------|
| Daily refresh of user's portfolio securities | Replaced by on-demand refresh |
| Weekly refresh of S&P 500 stocks | Hardcoded list no longer needed |
| Weekly refresh of popular ETFs | Hardcoded list no longer needed |
| Daily refresh of trending tickers | Hardcoded list no longer needed |
| Monthly full refresh | Replaced by file-based refresh system |

### Code to Clean Up

1. Remove `loadAllTickers()` and `reloadTickers()` exports from `ticker_registry.js`
2. Remove import of `ticker_registry` from `dashboard/server.js`
3. Clean up any references to the old autocomplete system
4. Archive or remove `scripts/populate/populate_popular_securities.js`

---

## Testing Strategy

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| `treasury_data_handler.test.js` | Merge logic, maturity filtering, name formatting |
| `symbol_registry_service.test.js` | Sort rank calculation, source priority, deduplication |
| `file_refresh_manager.test.js` | Refresh due calculation, status tracking |
| `yahoo_metadata_populator.test.js` | Batch processing, throttling (with mocks) |
| `metrics_collector.test.js` | Metrics calculation, logging |
| `autocomplete.test.js` | Query building, result sorting, limit handling |

### Integration Tests

| Test File | Coverage |
|-----------|----------|
| `autocomplete_integration.test.js` | End-to-end autocomplete with database |
| `symbol_lookup_integration.test.js` | Add Symbol modal lookup flow |

### Mock Strategy

- Mock Yahoo Finance API calls in all tests
- Use test database with seeded data
- Mock file system for CSV loading tests

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Yahoo API rate limiting | Configurable throttling, exponential backoff |
| Large initial population time | Background job, don't block startup |
| Database growth | Prune matured treasuries, archive old metrics |
| File download failures | Retry logic, preserve last good copy |
| Container restart loses progress | Track progress in database |

---

## Success Criteria

1. ✅ All symbols from CSV files appear in autocomplete
2. ✅ Treasuries appear with proper formatting and "OTC" exchange
3. ✅ Matured treasuries (>3 months) excluded
4. ✅ Files refresh automatically (configurable interval)
5. ✅ Refresh happens on container startup if due
6. ✅ Yahoo metadata population runs in background
7. ✅ Add Symbol modal handles unknown symbols gracefully
8. ✅ Metrics visible in dashboard settings
9. ✅ All new code has unit tests
10. ✅ CI passes with new tests
11. ✅ Documentation complete

---

## Open Questions Resolved

1. **Treasury file formats** - Both files have identical columns ✅
2. **Source determination** - File sources take precedence; priority order defined ✅
3. **Trading volume** - Added `usd_trading_volume` field and `sort_rank` for flexible sorting ✅
4. **Refresh mechanism** - Startup check + manual trigger (not cron) ✅
5. **Unknown symbol handling** - Synchronous lookup with loading indicator ✅

---

## Next Steps

1. Review this design document
2. Approve or request changes
3. Begin Phase 1 implementation
