# Implementation Plan: Source and Pricing Provider Tracking

## Executive Summary

Implement end-to-end tracking of ticker sources and pricing providers to prevent price confusion when the same ticker exists across multiple security types (e.g., BTC as crypto vs BTC as ETF vs BTC as stock).

**Problem**: External pricing APIs (Yahoo, Alpha Vantage) cannot distinguish between BTC (crypto) vs BTC (ETF) when given just the ticker symbol, leading to incorrect pricing data.

**Solution**: Track `security_type`, `source`, and `pricing_provider` throughout the entire data pipeline from ticker_registry → autocomplete → positions → dashboard → price fetching.

**AI Implementation Ready**: This plan now includes Phase 0 (Codebase Discovery), which provides a systematic checklist for AI agents to explore and document the existing codebase before implementation. This ensures the AI has all necessary context about file locations, code patterns, and integration points.

---

## Phase 0: Codebase Discovery (AI Prerequisite)

**Purpose**: Before implementing changes, an AI agent must understand the existing codebase structure, patterns, and conventions. This phase provides a systematic exploration checklist.

**Objective**: Document current implementation patterns, file locations, and integration points to inform all subsequent phases.

### 0.1 Project Structure Discovery

**Tasks**:
- [ ] Map directory structure
  - [ ] Locate backend source directory (likely `backend/`, `src/`, or `server/`)
  - [ ] Locate frontend source directory (likely `frontend/`, `public/`, or `client/`)
  - [ ] Locate database scripts directory (`scripts/init-db/`)
  - [ ] Locate test directories (`tests/`, `__tests__/`, or `test/`)
  - [ ] Locate documentation directory (`docs/`)
- [ ] Identify package manager and dependencies
  - [ ] Read `package.json` to understand dependencies
  - [ ] Check for frontend framework (React, Vue, vanilla JS)
  - [ ] Identify test framework (Jest, Mocha, Playwright, Cypress)
  - [ ] Check for backend framework (Express, Fastify, etc.)
- [ ] Locate configuration files
  - [ ] Database configuration
  - [ ] Environment configuration (.env pattern)
  - [ ] CI/CD configuration (.github/workflows/)

**Deliverable**: Create `docs/CODEBASE_STRUCTURE.md` documenting:
```markdown
# Codebase Structure

## Directory Layout
```
wealth-tracker/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   └── db/
├── frontend/
├── scripts/
└── tests/
```

## Key Technologies
- Backend: [Express/Fastify/etc]
- Frontend: [React/Vue/vanilla]
- Database: MySQL 8.0
- Testing: [Jest/Mocha/etc]
```

### 0.2 Database Integration Discovery

**Tasks**:
- [ ] Locate database connection module
  - [ ] Find where database connections are established
  - [ ] Document connection pool configuration
  - [ ] Identify query execution pattern (e.g., `db.query()`, `db.execute()`)
- [ ] Review existing schema
  - [ ] Read `scripts/init-db/000-base-schema.sql`
  - [ ] Document current `positions` table structure
  - [ ] Document current `ticker_registry` table structure
  - [ ] Document current `latest_prices` table structure
  - [ ] Identify existing indices
- [ ] Find database migration patterns
  - [ ] Check if migrations exist or if changes go directly in base schema
  - [ ] Document current migration approach

**Deliverable**: Add to `docs/CODEBASE_STRUCTURE.md`:
```markdown
## Database Integration

### Connection Pattern
File: `[path to db connection file]`
Usage:
```javascript
const db = require('./db');
const results = await db.query('SELECT * FROM positions WHERE id = ?', [id]);
```

### Current Schema Highlights
- positions table: [current columns]
- ticker_registry table: [current columns]
- latest_prices table: [current columns]
```

### 0.3 API Endpoint Discovery

**Tasks**:
- [ ] Locate autocomplete endpoint
  - [ ] Find file implementing ticker autocomplete
  - [ ] Document current request/response format
  - [ ] Document current SQL query
  - [ ] Identify URL pattern (e.g., `/api/autocomplete?q=BTC`)
- [ ] Locate position endpoints
  - [ ] Find position creation endpoint (POST)
  - [ ] Find position retrieval endpoint (GET)
  - [ ] Find position update endpoint (PUT/PATCH)
  - [ ] Document current request/response formats
- [ ] Locate price-related endpoints
  - [ ] Find endpoints that fetch or return prices
  - [ ] Document integration with price fetching services

**Deliverable**: Add to `docs/CODEBASE_STRUCTURE.md`:
```markdown
## API Endpoints

### Autocomplete
File: `[path]`
Endpoint: `GET /api/autocomplete?q={query}`
Current Response:
```json
{
  "suggestions": [
    { "ticker": "AAPL", "name": "Apple Inc.", ... }
  ]
}
```

### Positions
File: `[path]`
Endpoints:
- POST /api/positions - Create position
- GET /api/positions - List positions
- PUT /api/positions/:id - Update position

Current request format:
```json
{
  "account_id": 1,
  "ticker": "AAPL",
  "quantity": 10,
  "type": "stock"
}
```
```

### 0.4 Frontend Component Discovery

**Tasks**:
- [ ] Locate autocomplete component
  - [ ] Find file implementing ticker autocomplete UI
  - [ ] Document how suggestions are rendered
  - [ ] Document how selection is handled
- [ ] Locate position form component
  - [ ] Find file for adding/editing positions
  - [ ] Document form submission logic
  - [ ] Document validation patterns
- [ ] Locate dashboard component
  - [ ] Find file rendering positions list
  - [ ] Document how tickers are displayed
  - [ ] Check for existing tooltips or metadata display

**Deliverable**: Add to `docs/CODEBASE_STRUCTURE.md`:
```markdown
## Frontend Components

### Autocomplete
File: `[path]`
Framework: [React/Vue/vanilla]
Current implementation: [description]

### Position Form
File: `[path]`
Form library: [if any]
Submission pattern: [description]

### Dashboard
File: `[path]`
Rendering pattern: [description]
```

### 0.5 Service Layer Discovery

**Tasks**:
- [ ] Locate price fetching service
  - [ ] Find files responsible for fetching prices
  - [ ] Document providers currently used (Yahoo, etc.)
  - [ ] Document how prices are stored
- [ ] Check for existing service patterns
  - [ ] Look for service layer organization
  - [ ] Document common patterns (classes vs functions)
- [ ] Locate Kafka integration (if exists)
  - [ ] Find Kafka consumer files
  - [ ] Document message schemas
  - [ ] Find Kafka producer usage

**Deliverable**: Add to `docs/CODEBASE_STRUCTURE.md`:
```markdown
## Services

### Price Fetching
File: `[path]`
Current providers: [Yahoo Finance, etc.]
Pattern: [description]

### Kafka Integration
Consumer files: `[paths]`
Producer files: `[paths]`
Topics: [list]
```

### 0.6 Testing Pattern Discovery

**Tasks**:
- [ ] Examine existing test files
  - [ ] Find unit test examples
  - [ ] Find integration test examples
  - [ ] Document test file naming conventions
  - [ ] Document test setup patterns
- [ ] Check test configuration
  - [ ] Review Jest/Mocha configuration
  - [ ] Check for test database setup
  - [ ] Identify coverage reporting setup
- [ ] Review CI/CD pipeline
  - [ ] Read GitHub Actions workflows
  - [ ] Document test execution commands
  - [ ] Check coverage requirements

**Deliverable**: Add to `docs/CODEBASE_STRUCTURE.md`:
```markdown
## Testing

### Test Framework
Framework: [Jest/Mocha]
Config file: `[path]`

### Test Patterns
Unit tests: `tests/unit/[module].test.js`
Integration tests: `tests/integration/[feature].test.js`
E2E tests: `tests/e2e/[scenario].spec.js`

### Test Commands
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`

### CI/CD
File: `.github/workflows/[name].yml`
Current stages: [lint, unit, integration, e2e, build]
```

### 0.7 Code Pattern Analysis

**Tasks**:
- [ ] Review coding conventions
  - [ ] Check ESLint/Prettier configuration
  - [ ] Document variable naming patterns
  - [ ] Document function structure (async/await vs promises)
- [ ] Analyze error handling patterns
  - [ ] Document how errors are caught and handled
  - [ ] Check for centralized error handling
- [ ] Review logging patterns
  - [ ] Identify logging library (console, winston, etc.)
  - [ ] Document logging levels used

**Deliverable**: Add to `docs/CODEBASE_STRUCTURE.md`:
```markdown
## Code Conventions

### Style
Linter: ESLint
Config: `[path]`
Key rules: [highlights]

### Error Handling
Pattern: [try/catch, error middleware, etc.]
Example:
```javascript
try {
  const result = await db.query(...);
} catch (error) {
  logger.error('Query failed', error);
  throw error;
}
```

### Logging
Library: [console/winston/etc.]
Pattern: [description]
```

### 0.8 Document Findings

**Tasks**:
- [ ] Consolidate all discoveries into `docs/CODEBASE_STRUCTURE.md`
- [ ] Create cross-reference mapping
  - [ ] Map data flow: ticker_registry → autocomplete → positions → prices
  - [ ] Document all touchpoints for the source tracking feature
- [ ] Identify potential integration challenges
  - [ ] Note any deprecated patterns
  - [ ] Flag areas with technical debt
  - [ ] Highlight areas requiring careful refactoring

**Deliverable**: Complete `docs/CODEBASE_STRUCTURE.md` with:
```markdown
## Source Tracking Integration Points

### Data Flow
1. Ticker Registry (DB) → Autocomplete API → Frontend Autocomplete
2. Frontend Form → Position API → positions table (DB)
3. positions table → Price Fetcher → Pricing Provider → latest_prices table

### Files to Modify
- Database: `scripts/init-db/000-base-schema.sql`
- Backend API: `[list specific files]`
- Services: `[list specific files]`
- Frontend: `[list specific files]`
- Tests: `[list test files to update]`

### Integration Challenges
- [List any identified challenges]
```

---

**Phase 0 Completion Criteria**:
- [ ] All key files and directories located and documented
- [ ] Current database schema fully understood
- [ ] API endpoint patterns documented with examples
- [ ] Frontend component structure mapped
- [ ] Service layer patterns identified
- [ ] Testing approach and patterns documented
- [ ] `docs/CODEBASE_STRUCTURE.md` created with all findings
- [ ] Ready to proceed with Phase 1 implementation

**Estimated Time**: 2-4 hours for thorough exploration

---

## Phase 1: Database Schema Updates

### 1.1 Update `positions` Table

**File**: `scripts/init-db/000-base-schema.sql`

**Changes**:
```sql
-- Replace existing positions table definition
CREATE TABLE IF NOT EXISTS positions (
  id INT NOT NULL AUTO_INCREMENT,
  account_id INT NOT NULL,
  ticker VARCHAR(50) DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  quantity DECIMAL(20,8) DEFAULT NULL,
  security_type VARCHAR(20) NOT NULL,           -- CHANGED: renamed from 'type', now VARCHAR
  source VARCHAR(50) DEFAULT NULL,               -- NEW: track data source
  pricing_provider VARCHAR(50) DEFAULT NULL,     -- NEW: track pricing provider
  exchange VARCHAR(50) DEFAULT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  maturity_date DATE DEFAULT NULL,
  coupon DECIMAL(10,4) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  normalized_key VARCHAR(128) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY account_id (account_id),
  KEY idx_positions_ticker (ticker),
  KEY idx_positions_normalized_key (normalized_key),
  KEY idx_positions_ticker_security_type (ticker, security_type),    -- NEW
  KEY idx_positions_pricing_provider (pricing_provider),             -- NEW
  CONSTRAINT positions_ibfk_1 FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

**Rationale**:
- Changed `type` → `security_type` for consistency with ticker_registry
- Using VARCHAR(20) instead of ENUM for flexibility
- Added `source` to track where ticker came from
- Added `pricing_provider` to route price requests correctly

### 1.2 Update `ticker_registry` Table

**File**: `scripts/init-db/000-base-schema.sql`

**Changes**:
```sql
CREATE TABLE IF NOT EXISTS ticker_registry (
  id INT NOT NULL AUTO_INCREMENT,
  ticker VARCHAR(50) NOT NULL,
  name VARCHAR(500) DEFAULT NULL,
  exchange VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
  security_type ENUM('NOT_SET','EQUITY','ETF','BOND','US_TREASURY','MUTUAL_FUND','OPTION','CRYPTO','FX','FUTURES','INDEX','OTHER') NOT NULL DEFAULT 'NOT_SET',
  source ENUM('NASDAQ_FILE','NYSE_FILE','OTHER_LISTED_FILE','TREASURY_FILE','TREASURY_HISTORICAL','YAHOO','USER_ADDED','CRYPTO_INVESTING_FILE') NOT NULL,
  pricing_provider VARCHAR(50) DEFAULT NULL,     -- NEW
  display_name VARCHAR(200) DEFAULT NULL,        -- NEW: for autocomplete display
  has_yahoo_metadata TINYINT(1) DEFAULT 0,
  permanently_failed TINYINT(1) DEFAULT 0,
  permanent_failure_reason VARCHAR(255) DEFAULT NULL,
  permanent_failure_at TIMESTAMP NULL DEFAULT NULL,
  usd_trading_volume DECIMAL(20,2) DEFAULT NULL,
  market_cap DECIMAL(20, 2) DEFAULT NULL,
  sort_rank INT DEFAULT 1000,
  issue_date DATE DEFAULT NULL,
  maturity_date DATE DEFAULT NULL,
  security_term VARCHAR(50) DEFAULT NULL,
  underlying_ticker VARCHAR(50) DEFAULT NULL,
  underlying_exchange VARCHAR(50) DEFAULT NULL,
  underlying_security_type ENUM('NOT_SET','EQUITY','ETF','BOND','US_TREASURY','MUTUAL_FUND','OPTION','CRYPTO','FX','FUTURES','INDEX','OTHER') DEFAULT NULL,
  strike_price DECIMAL(18,4) DEFAULT NULL,
  option_type ENUM('CALL','PUT') DEFAULT NULL,
  expiration_date DATE DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_ticker_context (ticker, exchange, security_type),
  KEY idx_ticker (ticker),
  KEY idx_security_type (security_type),
  KEY idx_sort_rank (sort_rank),
  KEY idx_maturity_date (maturity_date),
  KEY idx_expiration_date (expiration_date),
  KEY idx_underlying (underlying_ticker, underlying_exchange, underlying_security_type),
  KEY idx_permanently_failed (permanently_failed),
  KEY idx_pricing_provider (pricing_provider),   -- NEW
  CONSTRAINT fk_underlying_ticker FOREIGN KEY (underlying_ticker, underlying_exchange, underlying_security_type)
    REFERENCES ticker_registry (ticker, exchange, security_type) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

### 1.3 Update `latest_prices` Table

**File**: `scripts/init-db/000-base-schema.sql`

**Changes**:
```sql
-- Support multiple prices per ticker (one per security_type)
CREATE TABLE IF NOT EXISTS latest_prices (
  ticker VARCHAR(50) NOT NULL,
  security_type VARCHAR(20) NOT NULL DEFAULT 'EQUITY',  -- NEW
  price DECIMAL(18,4) DEFAULT NULL,
  previous_close_price DECIMAL(18,4) DEFAULT NULL,
  prev_close_source VARCHAR(50) DEFAULT NULL,
  prev_close_time DATETIME DEFAULT NULL,
  source VARCHAR(50) DEFAULT NULL,
  quote_time DATETIME DEFAULT NULL,
  capture_time DATETIME DEFAULT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker, security_type),           -- CHANGED: composite key
  KEY idx_latest_prices_ticker (ticker)          -- NEW: for ticker-only lookups
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

---

## Phase 2: Seed Data Population

### 2.1 Populate `ticker_registry` with Default Pricing Providers

**File**: `scripts/init-db/000-base-schema.sql` (add at end)

```sql
-- Populate pricing_provider for existing sources
UPDATE ticker_registry
SET pricing_provider = 'YAHOO'
WHERE source IN ('NASDAQ_FILE', 'NYSE_FILE', 'OTHER_LISTED_FILE')
  AND security_type IN ('EQUITY', 'ETF')
  AND pricing_provider IS NULL;

UPDATE ticker_registry
SET pricing_provider = 'TREASURY_GOV'
WHERE security_type = 'US_TREASURY'
  AND pricing_provider IS NULL;

UPDATE ticker_registry
SET pricing_provider = 'INVESTING_COM'
WHERE source = 'CRYPTO_INVESTING_FILE'
  AND security_type = 'CRYPTO'
  AND pricing_provider IS NULL;

-- Generate display names for autocomplete
UPDATE ticker_registry
SET display_name = CONCAT(
  ticker, ' - ',
  COALESCE(name, 'Unknown'),
  ' (',
  security_type, ', ',
  CASE source
    WHEN 'CRYPTO_INVESTING_FILE' THEN 'investing.com'
    WHEN 'NASDAQ_FILE' THEN 'NASDAQ'
    WHEN 'NYSE_FILE' THEN 'NYSE'
    WHEN 'TREASURY_FILE' THEN 'treasury.gov'
    ELSE source
  END,
  ')'
)
WHERE display_name IS NULL;

-- Examples of generated display_name:
-- "BTC - Bitcoin (CRYPTO, investing.com)"
-- "AAPL - Apple Inc. (EQUITY, NASDAQ)"
```

---

## Phase 3: Autocomplete API Updates

### 3.1 Update Autocomplete Query

**File**: `backend/src/routes/ticker-autocomplete.js` (or equivalent)

**Changes**:
```javascript
// Return source and pricing_provider metadata
const query = `
  SELECT
    ticker,
    name,
    security_type,
    exchange,
    source,
    pricing_provider,
    display_name
  FROM ticker_registry
  WHERE ticker LIKE ?
  ORDER BY sort_rank
  LIMIT 20
`;

const suggestions = results.map(row => ({
  ticker: row.ticker,
  name: row.name,
  security_type: row.security_type,
  exchange: row.exchange,
  source: row.source,
  pricing_provider: row.pricing_provider,
  display: row.display_name || `${row.ticker} - ${row.name}`,
  metadata: {
    security_type: row.security_type,
    source: row.source,
    pricing_provider: row.pricing_provider
  }
}));
```

**Example Response**:
```json
{
  "suggestions": [
    {
      "ticker": "BTC",
      "name": "Bitcoin",
      "security_type": "CRYPTO",
      "exchange": "CRYPTO",
      "source": "CRYPTO_INVESTING_FILE",
      "pricing_provider": "INVESTING_COM",
      "display": "BTC - Bitcoin (CRYPTO, investing.com)",
      "metadata": {
        "security_type": "CRYPTO",
        "source": "CRYPTO_INVESTING_FILE",
        "pricing_provider": "INVESTING_COM"
      }
    }
  ]
}
```

---

## Phase 4: Frontend Updates

### 4.1 Update Position Creation

**File**: Frontend position form component

**Changes**:
```javascript
// When user selects from autocomplete
function handleTickerSelect(suggestion) {
  selectedPosition = {
    ticker: suggestion.ticker,
    name: suggestion.name,
    security_type: suggestion.metadata.security_type,
    source: suggestion.metadata.source,
    pricing_provider: suggestion.metadata.pricing_provider,
    exchange: suggestion.exchange
  };

  displaySelectedTicker(suggestion.display);
}

// When saving position
function savePosition(accountId, ticker, quantity) {
  fetch('/api/positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account_id: accountId,
      ticker: selectedPosition.ticker,
      description: selectedPosition.name,
      quantity: quantity,
      security_type: selectedPosition.security_type,
      source: selectedPosition.source,
      pricing_provider: selectedPosition.pricing_provider,
      exchange: selectedPosition.exchange
    })
  });
}
```

### 4.2 Update Dashboard Display

**Format**: `"BTC (Crypto - investing.com)"`

```javascript
function renderPositionTicker(position) {
  const sourceDisplay = getSourceDomain(position.source);
  const displayText = `${position.ticker} (${position.security_type} - ${sourceDisplay})`;
  const tooltipText = `Priced via ${position.pricing_provider}`;

  return `<span title="${tooltipText}">${displayText}</span>`;
}

function getSourceDomain(source) {
  const domainMap = {
    'CRYPTO_INVESTING_FILE': 'investing.com',
    'NASDAQ_FILE': 'NASDAQ',
    'NYSE_FILE': 'NYSE',
    'TREASURY_FILE': 'treasury.gov'
  };
  return domainMap[source] || source;
}
```

---

## Phase 5: Backend Position API Updates

### 5.1 Update Position Creation Endpoint

**File**: `backend/src/routes/positions.js`

```javascript
router.post('/positions', async (req, res) => {
  const {
    account_id,
    ticker,
    description,
    quantity,
    security_type,     // REQUIRED
    source,            // REQUIRED
    pricing_provider,  // REQUIRED
    exchange,
    currency = 'USD'
  } = req.body;

  if (!ticker || !security_type || !pricing_provider) {
    return res.status(400).json({
      error: 'ticker, security_type, and pricing_provider are required'
    });
  }

  const query = `
    INSERT INTO positions (
      account_id, ticker, description, quantity,
      security_type, source, pricing_provider,
      exchange, currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await db.query(query, [
    account_id, ticker, description, quantity,
    security_type, source, pricing_provider,
    exchange, currency
  ]);

  res.json({ success: true });
});
```

### 5.2 Update Position Fetch Endpoint

```javascript
router.get('/positions', async (req, res) => {
  const query = `
    SELECT
      p.id,
      p.ticker,
      p.description,
      p.quantity,
      p.security_type,
      p.source,
      p.pricing_provider,
      p.exchange,
      p.currency,
      a.name as account_name
    FROM positions p
    JOIN accounts a ON p.account_id = a.id
    ORDER BY a.display_order, p.ticker
  `;

  const positions = await db.query(query);
  res.json({ positions });
});
```

---

## Phase 6: Price Routing System

### 6.1 Create Price Router Service

**File**: `backend/src/services/price-router.js` (new file)

```javascript
const yahooFinance = require('./integrations/yahoo-finance');
const investingComScraper = require('./integrations/investing-scraper');
const coinGeckoAPI = require('./integrations/coingecko-api');

class PriceRouter {
  async getPrice(position) {
    const { ticker, security_type, pricing_provider } = position;

    console.log(`Fetching price for ${ticker} (${security_type}) via ${pricing_provider}`);

    switch (pricing_provider) {
      case 'YAHOO':
        return await this.fetchFromYahoo(ticker, security_type);

      case 'INVESTING_COM':
        return await this.fetchFromInvesting(ticker, security_type);

      case 'COINGECKO':
        return await this.fetchFromCoinGecko(ticker);

      case 'TREASURY_GOV':
        return await this.fetchFromTreasuryGov(ticker);

      default:
        return await this.fetchWithFallback(ticker, security_type);
    }
  }

  async fetchFromYahoo(ticker, security_type) {
    const quote = await yahooFinance.getQuote(ticker);
    return {
      ticker,
      security_type,
      price: quote.regularMarketPrice,
      previous_close_price: quote.regularMarketPreviousClose,
      source: 'YAHOO',
      quote_time: new Date(quote.regularMarketTime * 1000)
    };
  }

  async fetchFromInvesting(ticker, security_type) {
    const price = await investingComScraper.getPrice(ticker, security_type);
    return {
      ticker,
      security_type,
      price: price.current,
      previous_close_price: price.previousClose,
      source: 'INVESTING_COM',
      quote_time: new Date()
    };
  }

  async fetchFromCoinGecko(ticker) {
    const coinId = this.mapTickerToCoinGeckoId(ticker);
    const data = await coinGeckoAPI.getPrice(coinId);
    return {
      ticker,
      security_type: 'CRYPTO',
      price: data.usd,
      previous_close_price: data.usd_24h_ago,
      source: 'COINGECKO',
      quote_time: new Date()
    };
  }

  mapTickerToCoinGeckoId(ticker) {
    const map = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'SOL': 'solana'
    };
    return map[ticker] || ticker.toLowerCase();
  }

  async fetchWithFallback(ticker, security_type) {
    const providerMap = {
      'EQUITY': 'YAHOO',
      'ETF': 'YAHOO',
      'CRYPTO': 'COINGECKO'
    };

    const provider = providerMap[security_type] || 'YAHOO';
    console.warn(`No pricing_provider for ${ticker}, using ${provider}`);

    return await this.getPrice({ ticker, security_type, pricing_provider: provider });
  }
}

module.exports = new PriceRouter();
```

### 6.2 Update Price Fetcher Service

**File**: `backend/src/services/price-fetcher.js`

```javascript
const priceRouter = require('./price-router');
const db = require('../db');

class PriceFetcher {
  async updateAllPrices() {
    const query = `
      SELECT DISTINCT
        ticker,
        security_type,
        pricing_provider,
        source
      FROM positions
      WHERE pricing_provider IS NOT NULL
    `;

    const positions = await db.query(query);

    for (const position of positions) {
      try {
        const priceData = await priceRouter.getPrice(position);
        await this.savePriceData(priceData);
      } catch (error) {
        console.error(`Failed to fetch price for ${position.ticker}:`, error.message);
      }
    }
  }

  async savePriceData(priceData) {
    const query = `
      INSERT INTO latest_prices (
        ticker, security_type, price, previous_close_price,
        source, quote_time, capture_time
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        price = VALUES(price),
        previous_close_price = VALUES(previous_close_price),
        source = VALUES(source),
        quote_time = VALUES(quote_time),
        capture_time = NOW()
    `;

    await db.query(query, [
      priceData.ticker,
      priceData.security_type,
      priceData.price,
      priceData.previous_close_price,
      priceData.source,
      priceData.quote_time
    ]);
  }
}

module.exports = new PriceFetcher();
```

---

## Phase 7: Kafka Consumer Updates

### 7.1 Update Price Consumer

**File**: `backend/src/kafka/consumers/price-consumer.js`

```javascript
const priceRouter = require('../../services/price-router');

async function handlePriceMessage(message) {
  const { ticker, security_type, pricing_provider, requestId } = message;

  try {
    const priceData = await priceRouter.getPrice({
      ticker,
      security_type,
      pricing_provider
    });

    await savePriceToDatabase(priceData);

    await publishPriceUpdateEvent({
      requestId,
      ticker,
      security_type,
      price: priceData.price,
      source: priceData.source,
      status: 'success'
    });

  } catch (error) {
    console.error(`Price fetch failed for ${ticker}:`, error);

    await publishPriceUpdateEvent({
      requestId,
      ticker,
      security_type,
      status: 'failed',
      error: error.message
    });
  }
}
```

---

## Phase 8: Testing

### 8.1 Unit Tests

```javascript
// tests/unit/price-router.test.js
describe('PriceRouter', () => {
  test('prevents BTC crypto from getting BTC stock price', async () => {
    const cryptoPrice = await priceRouter.getPrice({
      ticker: 'BTC',
      security_type: 'CRYPTO',
      pricing_provider: 'COINGECKO'
    });

    const stockPrice = await priceRouter.getPrice({
      ticker: 'BTC',
      security_type: 'ETF',
      pricing_provider: 'YAHOO'
    });

    expect(cryptoPrice.price).not.toEqual(stockPrice.price);
    expect(cryptoPrice.source).toBe('COINGECKO');
    expect(stockPrice.source).toBe('YAHOO');
  });
});
```

### 8.2 Integration Tests

```javascript
// tests/integration/source-tracking.test.js
test('end-to-end: position stores and uses correct pricing provider', async () => {
  await createPosition({
    ticker: 'BTC',
    security_type: 'CRYPTO',
    pricing_provider: 'COINGECKO'
  });

  await priceFetcher.updateAllPrices();

  const price = await db.query(
    'SELECT * FROM latest_prices WHERE ticker = ? AND security_type = ?',
    ['BTC', 'CRYPTO']
  );

  expect(price[0].source).toBe('COINGECKO');
});
```

---

## Git Workflow

### Branch Strategy

**Main branch protection**: Never commit directly to `main`. All changes must go through pull requests.

**Branch naming convention**:
- Feature branches: `feature/source-tracking-{component}`
- Bug fix branches: `bugfix/{description}`
- Documentation branches: `docs/{description}`

### Implementation Branches

0. `feature/source-tracking-discovery` - Codebase structure documentation
1. `feature/source-tracking-database` - Database schema changes
2. `feature/source-tracking-backend-api` - Backend API updates
3. `feature/source-tracking-price-router` - Price routing service
4. `feature/source-tracking-frontend` - Frontend updates
5. `feature/source-tracking-kafka` - Kafka consumer updates
6. `feature/source-tracking-tests` - Test suite
7. `docs/source-tracking-documentation` - Documentation updates

---

## Implementation Order

### Phase 0: Codebase Discovery (Day 0)
**Branch**: `feature/source-tracking-discovery`

**Tasks**:
- [ ] Create feature branch from main
- [ ] Execute all discovery tasks from Phase 0
- [ ] Create `docs/CODEBASE_STRUCTURE.md` with findings
- [ ] Document all integration points
- [ ] Identify all files that will need modification
- [ ] Commit documentation
- [ ] Create pull request for review
- [ ] Merge after approval

**Commit message**:
```
docs: add codebase structure documentation for source tracking

- Map project directory structure and key files
- Document database connection patterns and current schema
- Identify API endpoints and their current formats
- Document frontend component structure
- Map service layer and Kafka integration
- Document testing patterns and CI/CD setup
- Identify all files requiring modification for source tracking

This documentation provides the foundation for implementing
the source tracking feature across the application.
```

**Deliverable**: `docs/CODEBASE_STRUCTURE.md` containing complete codebase map

---

### Phase 1: Database Schema (Days 1-2)
**Branch**: `feature/source-tracking-database`

**Tasks**:
- [ ] Create feature branch from main
- [ ] Update `000-base-schema.sql`:
  - [ ] Modify `positions` table (rename type, add columns)
  - [ ] Add columns to `ticker_registry`
  - [ ] Update `latest_prices` table with composite key
  - [ ] Add new indices
- [ ] Add SQL seed data:
  - [ ] Populate pricing_provider
  - [ ] Generate display_name values
- [ ] Write database tests:
  - [ ] Test schema creation
  - [ ] Test seed data population
  - [ ] Test indices work correctly
- [ ] Update database documentation:
  - [ ] Add schema diagram showing new columns
  - [ ] Document new indices
  - [ ] Add data dictionary entries
- [ ] Commit changes with descriptive message
- [ ] Create pull request
- [ ] Get code review
- [ ] Merge to main after approval

**Commit messages**:
```
feat(db): add source tracking columns to positions table

- Rename positions.type to security_type for consistency
- Add source and pricing_provider columns
- Add composite indices for efficient lookups
- Update latest_prices with security_type composite key

BREAKING CHANGE: positions.type renamed to security_type
```

```
feat(db): add pricing metadata to ticker_registry

- Add pricing_provider column for routing
- Add display_name for autocomplete display
- Populate pricing_provider based on source
- Generate display_name with source domain
```

### Phase 2: Backend API Updates (Days 3-5)
**Branch**: `feature/source-tracking-backend-api`

**Tasks**:
- [ ] Create feature branch from main
- [ ] Update autocomplete endpoint:
  - [ ] Modify query to return new fields
  - [ ] Update response format with metadata
  - [ ] Add unit tests for autocomplete
- [ ] Update position creation endpoint:
  - [ ] Add validation for new required fields
  - [ ] Update INSERT query
  - [ ] Add unit tests for position creation
- [ ] Update position fetch endpoint:
  - [ ] Update SELECT query
  - [ ] Modify response format
  - [ ] Add unit tests for position retrieval
- [ ] Write integration tests:
  - [ ] Test end-to-end position creation flow
  - [ ] Test autocomplete returns correct metadata
  - [ ] Test position fetch includes source data
- [ ] Update API documentation:
  - [ ] Document new request/response formats
  - [ ] Add example requests and responses
  - [ ] Update OpenAPI/Swagger specs (if applicable)
- [ ] Commit changes
- [ ] Create pull request
- [ ] Code review and merge

**Unit Tests Required**:
```javascript
// tests/unit/autocomplete.test.js
describe('Autocomplete API', () => {
  test('returns source and pricing_provider metadata');
  test('generates correct display_name format');
  test('handles multiple same-ticker securities');
});

// tests/unit/positions.test.js
describe('Position Creation API', () => {
  test('requires security_type field');
  test('requires pricing_provider field');
  test('stores source correctly');
  test('rejects position without pricing_provider');
});
```

### Phase 3: Price Router Service (Days 6-8)
**Branch**: `feature/source-tracking-price-router`

**Tasks**:
- [ ] Create feature branch from main
- [ ] Implement PriceRouter service:
  - [ ] Create `backend/src/services/price-router.js`
  - [ ] Implement provider routing logic
  - [ ] Add fallback mechanism
  - [ ] Implement ticker-to-CoinGecko ID mapping
- [ ] Add provider integrations:
  - [ ] Stub/mock CoinGecko integration
  - [ ] Stub/mock Investing.com scraper
  - [ ] Ensure Yahoo integration works
- [ ] Update price-fetcher service:
  - [ ] Integrate PriceRouter
  - [ ] Update database save logic
- [ ] Write comprehensive unit tests:
  - [ ] Test routing to correct provider
  - [ ] Test fallback logic
  - [ ] Test error handling
  - [ ] Mock all external API calls
- [ ] Write integration tests:
  - [ ] Test fetching BTC crypto vs BTC ETF
  - [ ] Test multiple security types
  - [ ] Test price storage with security_type
- [ ] Add service documentation:
  - [ ] Document PriceRouter API
  - [ ] Add provider integration guide
- [ ] Commit and create PR

**Unit Tests Required**:
```javascript
// tests/unit/price-router.test.js
describe('PriceRouter', () => {
  test('routes EQUITY to Yahoo');
  test('routes CRYPTO to CoinGecko');
  test('routes CRYPTO from INVESTING_COM source to Investing scraper');
  test('prevents BTC crypto from getting BTC stock price');
  test('uses fallback when pricing_provider is null');
  test('throws error for unknown provider');
  test('handles API failures gracefully');
});

// tests/unit/price-fetcher.test.js
describe('PriceFetcher with PriceRouter', () => {
  test('fetches prices for all unique ticker+security_type combinations');
  test('saves prices with security_type');
  test('handles partial failures');
});
```

### Phase 4: Kafka Consumer Updates (Days 9-10)
**Branch**: `feature/source-tracking-kafka`

**Tasks**:
- [ ] Create feature branch from main
- [ ] Update price consumer:
  - [ ] Include security_type in message handling
  - [ ] Route through PriceRouter
  - [ ] Update event publishing
- [ ] Update message schemas:
  - [ ] Add security_type to price request schema
  - [ ] Add pricing_provider to price request schema
  - [ ] Update price response schema
- [ ] Write unit tests:
  - [ ] Test message parsing
  - [ ] Test price routing
  - [ ] Test event publishing
- [ ] Write integration tests:
  - [ ] Test end-to-end Kafka flow
  - [ ] Test consumer handles source metadata
- [ ] Update Kafka documentation:
  - [ ] Document new message schemas
  - [ ] Add examples
- [ ] Commit and create PR

**Unit Tests Required**:
```javascript
// tests/unit/kafka/price-consumer.test.js
describe('Price Consumer', () => {
  test('parses security_type from message');
  test('routes to correct provider via PriceRouter');
  test('publishes success event with source');
  test('publishes failure event on error');
  test('saves price with security_type');
});
```

### Phase 5: Frontend Updates (Days 11-13)
**Branch**: `feature/source-tracking-frontend`

**Tasks**:
- [ ] Create feature branch from main
- [ ] Update autocomplete component:
  - [ ] Display source domain in suggestions
  - [ ] Store full metadata on selection
  - [ ] Update styling for readability
- [ ] Update position form:
  - [ ] Include security_type, source, pricing_provider in submission
  - [ ] Add validation
  - [ ] Show selected ticker with source
- [ ] Update dashboard:
  - [ ] Display ticker with source domain
  - [ ] Add tooltip with pricing_provider
  - [ ] Format as "BTC (Crypto - investing.com)"
- [ ] Write frontend unit tests:
  - [ ] Test autocomplete displays correctly
  - [ ] Test position form includes metadata
  - [ ] Test dashboard renders source info
- [ ] Write E2E tests:
  - [ ] Test user can select ticker from autocomplete
  - [ ] Test position creation includes source
  - [ ] Test dashboard shows source correctly
- [ ] Update UI documentation:
  - [ ] Document new display formats
  - [ ] Add screenshots
- [ ] Commit and create PR

**Frontend Tests Required**:
```javascript
// tests/frontend/autocomplete.test.js
describe('Autocomplete Component', () => {
  test('displays source domain for each suggestion');
  test('stores metadata when ticker is selected');
  test('shows "BTC - Bitcoin (CRYPTO, investing.com)" format');
  test('distinguishes BTC crypto from BTC ETF');
});

// tests/frontend/position-form.test.js
describe('Position Form', () => {
  test('includes security_type in submission');
  test('includes pricing_provider in submission');
  test('validates required fields');
});

// tests/frontend/dashboard.test.js
describe('Dashboard', () => {
  test('displays ticker with source domain');
  test('shows tooltip with pricing provider');
  test('formats as "BTC (Crypto - investing.com)"');
});
```

### Phase 6: Comprehensive Testing (Days 14-16) [COMPLETED]
**Branch**: `feature/source-tracking-tests`

**Tasks**:
- [x] Create feature branch from main
- [x] Write missing unit tests (PriceRouter)
- [x] Write integration tests (Positions, Fetch Price, Assets)
- [x] Add E2E test scenarios:
  - [x] Complete user journey: search → select → save → view
  - [x] Test price fetching uses correct provider
  - [x] Test BTC crypto vs BTC ETF pricing
- [ ] Set up CI/CD pipeline updates:
- [ ] Performance testing:
- [x] Create test data fixtures:
  - [x] Sample tickers with multiple security types
  - [x] Mock API responses
- [x] Document testing strategy
- [x] Commit and create PR

**CI Configuration Required**:
```yaml
# .github/workflows/source-tracking-tests.yml
name: Source Tracking Tests

on:
  pull_request:
    branches: [main]
  push:
    branches: [feature/source-tracking-*]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run unit tests
        run: npm run test:unit
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
    steps:
      - uses: actions/checkout@v3
      - name: Setup database
        run: npm run db:setup
      - name: Run integration tests
        run: npm run test:integration

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run E2E tests
        run: npm run test:e2e
```

### Phase 7: Documentation (Days 17-18)
**Branch**: `docs/source-tracking-documentation`

**Tasks**:
- [ ] Create documentation branch from main
- [ ] Update README.md:
  - [ ] Add section on source tracking
  - [ ] Update setup instructions
- [ ] Update API documentation:
  - [ ] Document all endpoint changes
  - [ ] Add request/response examples
  - [ ] Update Postman collection
- [ ] Create developer guide:
  - [ ] How source tracking works
  - [ ] How to add new pricing providers
  - [ ] Troubleshooting guide
- [ ] Update database documentation:
  - [ ] Schema diagram with new columns
  - [ ] Data dictionary
  - [ ] Index documentation
- [ ] Create operations runbook:
  - [ ] How to monitor pricing providers
  - [ ] How to handle provider failures
  - [ ] How to add new tickers
- [ ] Add inline code documentation:
  - [ ] JSDoc comments for PriceRouter
  - [ ] JSDoc comments for all new functions
- [ ] Create architecture diagram:
  - [ ] Data flow diagram
  - [ ] Component interaction diagram
- [ ] Commit and create PR

**Documentation Files to Create/Update**:
```
docs/
├── architecture/
│   ├── source-tracking-overview.md
│   └── data-flow-diagram.png
├── api/
│   ├── autocomplete.md
│   ├── positions.md
│   └── examples/
│       └── source-tracking-examples.md
├── database/
│   ├── schema.md
│   ├── indices.md
│   └── migrations.md (if needed)
├── development/
│   ├── adding-pricing-providers.md
│   ├── testing-guide.md
│   └── troubleshooting.md
└── operations/
    ├── monitoring.md
    ├── runbook.md
    └── disaster-recovery.md
```

---

## Testing Strategy

### Unit Test Coverage Requirements

**Minimum Coverage**: 80% for all new code

**Required Unit Tests**:

1. **PriceRouter Service** (`tests/unit/price-router.test.js`)
   - [ ] Test routing for each provider (YAHOO, COINGECKO, INVESTING_COM, TREASURY_GOV)
   - [ ] Test fallback logic when pricing_provider is null
   - [ ] Test error handling for API failures
   - [ ] Test ticker-to-CoinGecko ID mapping
   - [ ] Test prevention of cross-contamination (BTC crypto vs BTC ETF)

2. **Autocomplete API** (`tests/unit/autocomplete.test.js`)
   - [ ] Test query returns all required fields
   - [ ] Test display_name generation
   - [ ] Test handling of multiple same-ticker securities
   - [ ] Test LIKE query performance

3. **Position APIs** (`tests/unit/positions.test.js`)
   - [ ] Test position creation with new fields
   - [ ] Test validation of required fields
   - [ ] Test position retrieval includes source data
   - [ ] Test UPDATE operations preserve source data

4. **Price Fetcher** (`tests/unit/price-fetcher.test.js`)
   - [ ] Test integration with PriceRouter
   - [ ] Test price storage with security_type
   - [ ] Test handling of multiple prices per ticker
   - [ ] Test error recovery

5. **Kafka Consumers** (`tests/unit/kafka/price-consumer.test.js`)
   - [ ] Test message parsing
   - [ ] Test routing through PriceRouter
   - [ ] Test event publishing
   - [ ] Test error scenarios

### Integration Test Coverage

**Integration Tests** (`tests/integration/`)

1. **End-to-End Position Flow** (`source-tracking-e2e.test.js`)
   ```javascript
   test('complete flow: autocomplete → create position → fetch price', async () => {
     // 1. Search autocomplete for BTC
     const suggestions = await request(app).get('/api/autocomplete?q=BTC');

     // 2. Find crypto BTC
     const btcCrypto = suggestions.body.suggestions.find(
       s => s.ticker === 'BTC' && s.security_type === 'CRYPTO'
     );

     // 3. Create position
     const position = await request(app)
       .post('/api/positions')
       .send({
         account_id: 1,
         ticker: btcCrypto.ticker,
         quantity: 0.5,
         security_type: btcCrypto.security_type,
         source: btcCrypto.source,
         pricing_provider: btcCrypto.pricing_provider
       });

     // 4. Fetch price
     await priceFetcher.updateAllPrices();

     // 5. Verify correct provider was used
     const price = await db.query(
       'SELECT * FROM latest_prices WHERE ticker = ? AND security_type = ?',
       ['BTC', 'CRYPTO']
     );

     expect(price[0].source).toBe('COINGECKO');
   });
   ```

2. **Multiple Same-Ticker Securities** (`multiple-securities.test.js`)
   ```javascript
   test('handles BTC crypto and BTC ETF separately', async () => {
     // Create both positions
     await createPosition({ ticker: 'BTC', security_type: 'CRYPTO', pricing_provider: 'COINGECKO' });
     await createPosition({ ticker: 'BTC', security_type: 'ETF', pricing_provider: 'YAHOO' });

     // Fetch prices
     await priceFetcher.updateAllPrices();

     // Verify separate prices
     const prices = await db.query('SELECT * FROM latest_prices WHERE ticker = ?', ['BTC']);
     expect(prices.length).toBe(2);

     const cryptoPrice = prices.find(p => p.security_type === 'CRYPTO');
     const etfPrice = prices.find(p => p.security_type === 'ETF');

     expect(cryptoPrice.source).toBe('COINGECKO');
     expect(etfPrice.source).toBe('YAHOO');
     expect(cryptoPrice.price).not.toEqual(etfPrice.price);
   });
   ```

3. **Database Performance** (`performance.test.js`)
   ```javascript
   test('composite index improves query performance', async () => {
     // Insert 10,000 test positions
     await seedTestPositions(10000);

     // Query with security_type
     const start = Date.now();
     await db.query(
       'SELECT * FROM positions WHERE ticker = ? AND security_type = ?',
       ['AAPL', 'EQUITY']
     );
     const duration = Date.now() - start;

     // Should complete in <10ms with index
     expect(duration).toBeLessThan(10);
   });
   ```

### E2E Test Coverage

**E2E Tests** (`tests/e2e/`)

Use Playwright or Cypress for browser-based testing:

```javascript
// tests/e2e/position-creation.spec.js
test('user can create position with correct source', async ({ page }) => {
  // 1. Navigate to dashboard
  await page.goto('http://localhost:3000');

  // 2. Click add position
  await page.click('[data-testid="add-position-btn"]');

  // 3. Type BTC in autocomplete
  await page.fill('[data-testid="ticker-search"]', 'BTC');

  // 4. Verify multiple BTC options appear
  const suggestions = await page.$$('[data-testid="autocomplete-suggestion"]');
  expect(suggestions.length).toBeGreaterThan(1);

  // 5. Select crypto BTC
  await page.click('text=BTC - Bitcoin (CRYPTO, investing.com)');

  // 6. Enter quantity
  await page.fill('[data-testid="quantity-input"]', '0.5');

  // 7. Submit
  await page.click('[data-testid="save-position-btn"]');

  // 8. Verify position appears in dashboard
  await expect(page.locator('text=BTC (Crypto - investing.com)')).toBeVisible();
});
```

### CI/CD Pipeline Configuration

**File**: `.github/workflows/ci.yml`

```yaml
name: CI Pipeline

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run lint

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:unit
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true
          flags: unit
      - name: Check coverage threshold
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 80% threshold"
            exit 1
          fi

  integration-tests:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test
          MYSQL_DATABASE: wealth_tracker_test
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3

    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - name: Setup test database
        run: |
          mysql -h 127.0.0.1 -u root -ptest < scripts/init-db/000-base-schema.sql
        env:
          MYSQL_HOST: 127.0.0.1
          MYSQL_PORT: 3306
          MYSQL_USER: root
          MYSQL_PASSWORD: test
          MYSQL_DATABASE: wealth_tracker_test
      - run: npm run test:integration
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true
          flags: integration

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - name: Check build size
        run: |
          SIZE=$(du -sb dist | cut -f1)
          if [ $SIZE -gt 10485760 ]; then  # 10MB
            echo "Build size ${SIZE} bytes exceeds 10MB limit"
            exit 1
          fi
```

---

## Pull Request Checklist

For each PR, ensure:

- [ ] All tests pass locally
- [ ] Code coverage meets 80% threshold
- [ ] Linting passes with no errors
- [ ] Commit messages follow conventional commits format
- [ ] PR description explains what and why
- [ ] Related issue is linked
- [ ] Documentation is updated
- [ ] Breaking changes are clearly marked
- [ ] Migration guide provided (if applicable)
- [ ] Screenshots included (for UI changes)
- [ ] Performance impact assessed
- [ ] Security implications reviewed

**PR Template**:
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issue
Fixes #(issue number)

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing completed

## Documentation
- [ ] README updated
- [ ] API docs updated
- [ ] Code comments added
- [ ] Architecture docs updated

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] No console.log() or debugging code
- [ ] Tests pass locally
- [ ] Coverage threshold met

## Screenshots (if applicable)

## Performance Impact

## Security Considerations
```

---

## Success Criteria

- [ ] All positions track security_type, source, and pricing_provider
- [ ] Autocomplete shows source domain (e.g., "investing.com")
- [ ] Dashboard displays: "BTC (Crypto - investing.com)"
- [ ] BTC crypto fetches from CoinGecko, BTC ETF from Yahoo
- [ ] No price confusion between same-ticker securities
- [ ] All tests pass
- [ ] Zero errors in production

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Missing pricing_provider for some tickers | Implement fallback logic based on security_type |
| CoinGecko API rate limits | Add caching, request throttling |
| Investing.com scraper breaks | Robust error handling, have backup provider |

---

## Future Enhancements

1. Provider health monitoring and auto-failover
2. User-selectable preferred providers
3. Multi-source price comparison
4. Historical price tracking with security_type

---

**Document Version**: 2.0
**Last Updated**: 2025-12-21
**Changes in v2.0**: Added Phase 0 (Codebase Discovery) to make plan AI-implementation ready
