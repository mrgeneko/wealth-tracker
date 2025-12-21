# Wealth Tracker Codebase Structure

**Document Version**: 1.0
**Last Updated**: 2025-12-21
**Purpose**: Foundation document for implementing source tracking feature

This document provides a comprehensive map of the wealth-tracker codebase structure, patterns, and integration points. It serves as the reference guide for AI agents implementing the source tracking feature.

---

## Directory Layout

```
wealth-tracker/
├── api/                      # Backend API endpoints (Express routers)
│   ├── autocomplete.js       # Ticker search/autocomplete endpoints
│   ├── metadata.js           # Security metadata endpoints
│   ├── statistics.js         # Statistics/metrics endpoints
│   ├── metrics.js            # Performance metrics
│   └── cleanup.js            # Data cleanup endpoints
├── dashboard/                # Frontend dashboard (vanilla JS + Express server)
│   ├── server.js             # Main Express server (positions, accounts, prices)
│   ├── ticker_registry.js    # Ticker registry database loader
│   ├── position_body.js      # Position request body normalization
│   ├── config.js             # Configuration constants
│   └── public/               # Static frontend assets
│       ├── index.html        # Main dashboard UI (vanilla JS)
│       ├── app.js            # Frontend JavaScript logic
│       ├── style.css         # Styling
│       └── js/               # Additional frontend modules
├── services/                 # Backend services (business logic)
│   ├── symbol-registry/      # Ticker/symbol registry services
│   │   ├── index.js          # Main exports
│   │   ├── ticker_registry_service.js     # Ticker registry operations
│   │   ├── metadata_autocomplete_service.js # Autocomplete service
│   │   ├── symbol_registry_sync.js        # Registry sync logic
│   │   ├── yahoo_metadata_populator.js    # Yahoo Finance metadata
│   │   └── treasury_data_handler.js       # US Treasury data
│   ├── listing-sync/         # Exchange listing synchronization
│   ├── api-scraper/          # API scraping daemon
│   └── websocket-server.js   # WebSocket real-time metrics
├── scrapers/                 # Web scraping services
│   ├── scrape_daemon.js      # Main scraping daemon
│   ├── publish_to_kafka.js   # Kafka producer for scraped data
│   └── watchlist/            # Watchlist-specific scrapers
├── scripts/                  # Utility and maintenance scripts
│   ├── init-db/              # Database initialization
│   │   └── 000-base-schema.sql  # Base schema (MAIN SCHEMA FILE)
│   ├── setup/                # Setup scripts
│   │   └── update_crypto_listings.js  # Crypto listings scraper
│   ├── populate/             # Data population scripts
│   ├── maintenance/          # Maintenance scripts
│   ├── utilities/            # Ad-hoc utility scripts
│   └── migrations/           # Database migrations
├── tests/                    # Test suites
│   ├── unit/                 # Unit tests
│   ├── integration/          # Integration tests
│   ├── fixtures/             # Test data fixtures
│   └── setup.js              # Jest test configuration
├── config/                   # Configuration files and data
│   ├── investing-crypto.csv  # Crypto ticker list (investing.com)
│   ├── source_priority.json  # Price source priority config
│   └── [various CSV files]   # Exchange listings, etc.
├── docs/                     # Documentation
│   ├── architecture/         # Architecture docs
│   ├── api/                  # API documentation
│   ├── services/             # Service documentation
│   └── operations/           # Operations/runbooks
├── docker/                   # Docker configuration
│   ├── Dockerfile.consumer   # Kafka consumer container
│   └── [other Dockerfiles]
├── .github/workflows/        # CI/CD pipelines
│   ├── unit-tests.yml
│   ├── backend-ticker-standardization.yml
│   ├── frontend-ticker-standardization.yml
│   └── [other workflows]
├── package.json              # Node.js dependencies and scripts
├── jest.config.js            # Jest test configuration
└── docker-compose.yml        # Docker Compose services
```

---

## Key Technologies

### Backend
- **Framework**: Express.js 5.1.0
- **Language**: Node.js (JavaScript)
- **Database**: MySQL 8.0 (via mysql2 v3.15.3)
- **Message Queue**: Kafka (kafkajs v2.2.4)
- **External APIs**: Yahoo Finance (yahoo-finance2 v3.10.2)
- **Web Scraping**: Puppeteer v24.15.0

### Frontend
- **Framework**: Vanilla JavaScript (no React/Vue)
- **UI Library**: Awesomplete (autocomplete)
- **Real-time**: Socket.io v4.8.1, WebSockets (ws v8.18.3)
- **Styling**: Custom CSS

### Testing
- **Framework**: Jest v29.7.0
- **HTTP Testing**: Supertest v6.3.3
- **Test Types**: Unit, Integration, E2E
- **Coverage**: Target currently low (~2-5%), no enforced minimums

### DevOps
- **Containerization**: Docker
- **Orchestration**: Docker Compose
- **CI/CD**: GitHub Actions
- **Process Management**: PM2 (ecosystem.config.json)

---

## Database Integration

### Connection Pattern

**File**: [dashboard/server.js:394-403](dashboard/server.js#L394-L403)

```javascript
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
```

**Usage Pattern**:
```javascript
// Execute query with parameters
const [results] = await pool.execute('SELECT * FROM positions WHERE id = ?', [id]);

// Simple query
const [rows] = await pool.query('SELECT * FROM accounts ORDER BY display_order');
```

### Environment Variables
```bash
MYSQL_HOST=mysql        # Default: 'mysql' (Docker service name)
MYSQL_PORT=3306         # Default: 3306
MYSQL_USER=test         # Default: 'test'
MYSQL_PASSWORD=test     # Default: 'test'
MYSQL_DATABASE=testdb   # Default: 'testdb'
```

### Current Schema Highlights

**File**: [scripts/init-db/000-base-schema.sql](scripts/init-db/000-base-schema.sql)

#### `positions` Table (Lines 74-93)
```sql
CREATE TABLE IF NOT EXISTS positions (
  id INT NOT NULL AUTO_INCREMENT,
  account_id INT NOT NULL,
  ticker VARCHAR(50) DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  quantity DECIMAL(20,8) DEFAULT NULL,
  type ENUM('stock','etf','bond','cash','crypto','other') NOT NULL,  -- TARGET FOR RENAME
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
  CONSTRAINT positions_ibfk_1 FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

**Key Points**:
- `type` column uses ENUM → Will rename to `security_type` and change to VARCHAR(20)
- Currently has `ticker` index → Will add composite index on (ticker, security_type)
- No `source` or `pricing_provider` columns yet

#### `ticker_registry` Table (Lines 291-327)
```sql
CREATE TABLE IF NOT EXISTS ticker_registry (
  id INT NOT NULL AUTO_INCREMENT,
  ticker VARCHAR(50) NOT NULL,
  name VARCHAR(500) DEFAULT NULL,
  exchange VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
  security_type ENUM('NOT_SET','EQUITY','ETF','BOND','US_TREASURY','MUTUAL_FUND','OPTION','CRYPTO','FX','FUTURES','INDEX','OTHER') NOT NULL DEFAULT 'NOT_SET',
  source ENUM('NASDAQ_FILE','NYSE_FILE','OTHER_LISTED_FILE','TREASURY_FILE','TREASURY_HISTORICAL','YAHOO','USER_ADDED','CRYPTO_INVESTING_FILE') NOT NULL,
  has_yahoo_metadata TINYINT(1) DEFAULT 0,
  permanently_failed TINYINT(1) DEFAULT 0,
  permanent_failure_reason VARCHAR(255) DEFAULT NULL,
  permanent_failure_at TIMESTAMP NULL DEFAULT NULL,
  usd_trading_volume DECIMAL(20,2) DEFAULT NULL,
  market_cap DECIMAL(20, 2) DEFAULT NULL,
  sort_rank INT DEFAULT 1000,
  -- ... additional columns ...
  PRIMARY KEY (id),
  UNIQUE KEY unique_ticker_context (ticker, exchange, security_type),
  KEY idx_ticker (ticker),
  KEY idx_security_type (security_type),
  KEY idx_sort_rank (sort_rank),
  -- ... additional keys ...
) ENGINE=InnoDB;
```

**Key Points**:
- Already has `security_type` and `source` columns
- Missing `pricing_provider` column (NEW)
- Missing `display_name` column for autocomplete (NEW)
- `source` enum includes 'CRYPTO_INVESTING_FILE' for crypto tickers

#### `latest_prices` Table (Lines 108-120)
```sql
CREATE TABLE IF NOT EXISTS latest_prices (
  ticker VARCHAR(50) NOT NULL,
  price DECIMAL(18,4) DEFAULT NULL,
  previous_close_price DECIMAL(18,4) DEFAULT NULL,
  prev_close_source VARCHAR(50) DEFAULT NULL,
  prev_close_time DATETIME DEFAULT NULL,
  source VARCHAR(50) DEFAULT NULL,
  quote_time DATETIME DEFAULT NULL,
  capture_time DATETIME DEFAULT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker)  -- WILL CHANGE TO COMPOSITE KEY (ticker, security_type)
) ENGINE=InnoDB;
```

**Key Points**:
- Single-column primary key → Will change to composite (ticker, security_type)
- Already has `source` for price source tracking

### Migration Approach
- **Direct schema modification** in `000-base-schema.sql`
- **No migration scripts** needed (per user requirement)
- Changes are applied on fresh database initialization

---

## API Endpoints

### Autocomplete

**File**: [api/autocomplete.js](api/autocomplete.js)

#### GET /api/autocomplete/search

**Request**:
```
GET /api/autocomplete/search?q=BTC&limit=20&metadata=true
```

**Query Parameters**:
- `q` (required): Search query
- `limit` (optional): Max results (default 20, max 100)
- `metadata` (optional): Include metadata (true/false)

**Current Response** (Lines 78-85):
```json
{
  "query": "BTC",
  "results": [
    {
      "ticker": "BTC",
      "name": "Bitcoin USD",
      "type": "CRYPTO",
      "verified": true,
      "score": 145.7,
      "metadata": { ... }
    }
  ],
  "count": 1,
  "timestamp": "2025-12-21T10:00:00.000Z"
}
```

**Service Used**: `MetadataAutocompleteService` from `services/symbol-registry/metadata_autocomplete_service.js`

**Database Query Pattern**:
```javascript
const service = new MetadataAutocompleteService(connectionPool);
const results = await service.searchTickers(q, options);
```

#### GET /api/autocomplete/details/:ticker

**Request**:
```
GET /api/autocomplete/details/AAPL
```

**Response**: Detailed ticker information including metadata

**Frontend Integration** (dashboard/public/index.html:1456):
```javascript
const res = await fetch(`/api/autocomplete/search?q=${encodeURIComponent(query)}`);
const data = await res.json();
symbolAutocomplete.list = data.results;
```

### Positions

**File**: [dashboard/server.js](dashboard/server.js)

#### POST /api/positions

**Endpoint**: Lines 1420-1461

**Request Body**:
```json
{
  "account_id": 1,
  "ticker": "AAPL",
  "quantity": 10,
  "type": "stock",
  "currency": "USD",
  "exchange": "NASDAQ"
}
```

**Processing** (Lines 1421-1423):
```javascript
const { normalizePositionBody } = require('./position_body');
const normalized = normalizePositionBody(req.body);
const { account_id, ticker, quantity, currency, type } = normalized;
```

**Database Insert**:
```javascript
await pool.execute(
  'INSERT INTO positions (account_id, ticker, quantity, type, currency, exchange, normalized_key) VALUES (?,?,?,?,?,?,?)',
  [account_id, ticker, quantity, type, currency, exchange, normalized_key]
);
```

#### PUT /api/positions/:id

**Endpoint**: Lines 1463-1504

**Request Body**: Same as POST

**Database Update**:
```javascript
await pool.execute(
  'UPDATE positions SET ticker=?, quantity=?, type=?, currency=?, exchange=?, normalized_key=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
  [ticker, quantity, type, currency, exchange, normalized_key, req.params.id]
);
```

#### DELETE /api/positions/:id

**Endpoint**: Lines 1506-1515

**Database Delete**:
```javascript
await pool.execute('DELETE FROM positions WHERE id=?', [req.params.id]);
```

#### GET /assets (Positions Retrieval)

**Endpoint**: Lines 511-549

**Query** (Lines 522-530):
```javascript
const [positions] = await pool.query(`
    SELECT p.*,
           sm.short_name, sm.sector, sm.market_cap,
           sm.dividend_yield, sm.trailing_pe,
           sm.ttm_dividend_amount, sm.ttm_eps,
           sm.quote_type, sm.exchange as meta_exchange
    FROM positions p
    LEFT JOIN securities_metadata sm ON p.ticker = sm.ticker COLLATE utf8mb4_unicode_ci
`);
```

---

## Frontend Components

### Framework: Vanilla JavaScript (No React/Vue)

The frontend is built with vanilla JavaScript, using Awesomplete for autocomplete functionality.

### Autocomplete Component

**File**: [dashboard/public/index.html](dashboard/public/index.html)

**Implementation** (Lines 1367-1470):

```javascript
// Ticker autocomplete setup
let symbolAutocomplete = null;
let autocompleteTimeout = null;

if (!symbolAutocomplete) {
    symbolAutocomplete = new Awesomplete(input, {
        minChars: 1,
        maxItems: 20,
        autoFirst: false,
        sort: false,  // Already sorted by API
        filter: () => true,  // No client-side filtering
        item: (suggestion) => {
            // Custom rendering for each suggestion
            const li = document.createElement('li');
            li.innerHTML = `<strong>${suggestion.ticker}</strong> - ${suggestion.name}`;
            return li;
        }
    });
}

// Debounced search on input
input.addEventListener('input', function() {
    const query = this.value.trim().toUpperCase();
    if (query.length < 1) return;

    if (autocompleteTimeout) clearTimeout(autocompleteTimeout);
    autocompleteTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`/api/autocomplete/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            symbolAutocomplete.list = data.results;
        } catch (err) {
            console.error('Autocomplete error:', err);
        }
    }, 300);  // 300ms debounce
});
```

**Styling** (Lines 188-210):
```css
/* Awesomplete Autocomplete Styles (Dark Theme) */
.awesomplete > ul {
    position: absolute;
    z-index: 2000;
    left: 0;
    background: #2d2d2d;
    border: 1px solid #555;
    border-radius: 4px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    max-height: 350px;
    overflow-y: auto;
}
```

### Position Form

**File**: [dashboard/public/index.html](dashboard/public/index.html)

**HTML Structure** (Lines 1290-1350):
```html
<div id="positionModal" class="modal">
    <div class="modal-content">
        <form id="positionForm">
            <div class="form-group">
                <label>Account:</label>
                <select id="positionAccount" required>
                    <!-- Populated dynamically -->
                </select>
            </div>
            <div class="form-group">
                <label>Ticker/Symbol:</label>
                <input type="text" id="positionTicker"
                       style="text-transform:uppercase; flex: 1;"
                       class="awesomplete" autocomplete="off">
            </div>
            <div class="form-group">
                <label>Quantity:</label>
                <input type="number" id="positionQuantity" step="any">
            </div>
            <button type="submit">Save</button>
        </form>
    </div>
</div>
```

**Form Submission Logic** (approximate location):
```javascript
positionForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = {
        account_id: document.getElementById('positionAccount').value,
        ticker: document.getElementById('positionTicker').value.toUpperCase(),
        quantity: parseFloat(document.getElementById('positionQuantity').value),
        type: 'stock'  // Currently hardcoded or detected
    };

    const response = await fetch('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    });

    if (response.ok) {
        // Refresh positions list
        loadPositions();
        closeModal();
    }
});
```

### Dashboard Display

**File**: [dashboard/public/index.html](dashboard/public/index.html)

**Position Rendering**: Positions are rendered in a table showing:
- Ticker symbol
- Description/Name
- Quantity
- Current price
- Total value
- Gain/Loss

**Current Format**:
- Ticker displayed as plain text (e.g., "BTC")
- No source/provider information displayed yet

**Target Format** (per plan):
- Display: `"BTC (Crypto - investing.com)"`
- Tooltip with pricing_provider information

---

## Services

### Price Fetching

**Current Implementation**: Price fetching is handled through:

1. **Yahoo Finance** (primary source for stocks/ETFs)
   - File: `services/symbol-registry/yahoo_metadata_populator.js`
   - Uses `yahoo-finance2` NPM package

2. **Web Scrapers** (secondary sources)
   - Files: `scrapers/scrape_daemon.js`, `scrapers/watchlist/*`
   - Scrape various financial websites
   - Publish to Kafka topics

3. **Kafka Consumers**
   - Files: `dashboard/server.js` (has Kafka consumer logic embedded)
   - Consume price updates from scrapers
   - Update `latest_prices` table

**Price Update Flow**:
```
Scraper → Kafka Topic → Consumer → latest_prices table → Dashboard
```

**Source Priority Configuration** (dashboard/server.js:124-143):
```javascript
let sourcePriorityConfig = {
    priority: ['yahoo', 'nasdaq', 'google', 'cnbc', 'wsj', ...],
    weights: {
        yahoo: 1.0,
        nasdaq: 0.95,
        google: .93,
        // ... more sources
    },
    default_weight: 0.5,
    recency_threshold_minutes: 60
};
```

**Price Merging Logic** (dashboard/server.js:161-199):
```javascript
function shouldAcceptIncomingPrevClose(incoming, cached) {
    // Priority-based merging with recency fallback
    const incomingRank = getSourcePriorityRank(incoming.source);
    const cachedRank = getSourcePriorityRank(cached.prev_close_source);

    if (incomingRank < cachedRank) return true;  // Higher priority
    if (incomingRank > cachedRank) {
        // Check recency for lower priority sources
        const diffMinutes = (incomingTime - cachedTime) / (1000 * 60);
        return diffMinutes > sourcePriorityConfig.recency_threshold_minutes;
    }

    return incomingTime > cachedTime;  // Same priority, use recency
}
```

### Kafka Integration

**Configuration** (dashboard/server.js:117-122):
```javascript
const { Kafka } = require('kafkajs');

const KAFKA_BROKERS = config.KAFKA_BROKERS;  // From config.js
const KAFKA_TOPIC = config.KAFKA_TOPIC;
const KAFKA_GROUP_ID = config.KAFKA_GROUP_ID;
```

**Consumer Pattern** (embedded in dashboard/server.js):
```javascript
const kafka = new Kafka({
    clientId: 'wealth-tracker-dashboard',
    brokers: KAFKA_BROKERS
});

const consumer = kafka.consumer({ groupId: KAFKA_GROUP_ID });

await consumer.connect();
await consumer.subscribe({ topic: KAFKA_TOPIC });

await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
        const data = JSON.parse(message.value.toString());
        // Process price update
        await updatePrice(data);
    }
});
```

**Producer** (scrapers/publish_to_kafka.js):
```javascript
const producer = kafka.producer();
await producer.connect();

await producer.send({
    topic: KAFKA_TOPIC,
    messages: [{
        key: ticker,
        value: JSON.stringify(priceData)
    }]
});
```

### Service Layer Organization

**Pattern**: Service classes in `services/` directory

**Example**: `services/symbol-registry/metadata_autocomplete_service.js`

```javascript
class MetadataAutocompleteService {
    constructor(pool) {
        this.pool = pool;
    }

    async searchTickers(query, options = {}) {
        const { limit = 20, includeMetadata = false } = options;

        const sql = `
            SELECT ticker, name, security_type, exchange, source, sort_rank
            FROM ticker_registry
            WHERE ticker LIKE ? OR name LIKE ?
            ORDER BY sort_rank ASC, ticker ASC
            LIMIT ?
        `;

        const [rows] = await this.pool.execute(sql, [
            `${query}%`, `%${query}%`, limit
        ]);

        return rows;
    }
}

module.exports = { MetadataAutocompleteService };
```

**Usage Pattern**:
```javascript
const { MetadataAutocompleteService } = require('../services/symbol-registry');

const service = new MetadataAutocompleteService(pool);
const results = await service.searchTickers('AAPL');
```

---

## Testing

### Test Framework

**Framework**: Jest 29.7.0
**Config File**: [jest.config.js](jest.config.js)

### Test Environment Configuration

**Setup File**: [tests/setup.js](tests/setup.js)

```javascript
// Environment variables for tests
process.env.NODE_ENV = 'test';
process.env.MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
process.env.MYSQL_PORT = process.env.MYSQL_PORT || '3306';
process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'testdb';
process.env.MYSQL_USER = process.env.MYSQL_USER || 'test';
process.env.MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'test';

// Custom matchers
expect.extend({
  toBeValidSymbol(received) {
    const pass = /^[A-Z]{1,5}(\.[A-Z])?$/.test(received);
    return { pass, message: () => `expected ${received} to be a valid stock symbol` };
  }
});
```

### Test Patterns

**Test Structure**:
```
tests/
├── unit/                      # Unit tests
│   ├── api/                   # API endpoint tests
│   ├── dashboard/             # Dashboard logic tests
│   ├── services/              # Service layer tests
│   └── scrapers/              # Scraper tests
├── integration/               # Integration tests
│   ├── ticker-standardization-e2e.test.js
│   ├── listing_sync_e2e.test.js
│   └── accounts.integration.test.js
├── fixtures/                  # Test data fixtures
└── setup.js                   # Jest configuration
```

**Unit Test Example** (tests/unit/api pattern):
```javascript
const { MetadataAutocompleteService } = require('../../services/symbol-registry');

describe('Autocomplete Service', () => {
    let mockPool;
    let service;

    beforeEach(() => {
        mockPool = {
            execute: jest.fn()
        };
        service = new MetadataAutocompleteService(mockPool);
    });

    test('should search tickers by prefix', async () => {
        mockPool.execute.mockResolvedValue([[
            { ticker: 'AAPL', name: 'Apple Inc.', security_type: 'EQUITY' }
        ]]);

        const results = await service.searchTickers('AAP');

        expect(results).toHaveLength(1);
        expect(results[0].ticker).toBe('AAPL');
    });
});
```

**Integration Test Example**:
```javascript
const mysql = require('mysql2/promise');
const supertest = require('supertest');

describe('Position Creation E2E', () => {
    let pool;
    let app;

    beforeAll(async () => {
        pool = await mysql.createPool({
            host: 'localhost',
            database: 'testdb',
            user: 'test',
            password: 'test'
        });
        app = require('../../dashboard/server');  // Import Express app
    });

    afterAll(async () => {
        await pool.end();
    });

    test('should create position with valid data', async () => {
        const response = await supertest(app)
            .post('/api/positions')
            .send({
                account_id: 1,
                ticker: 'AAPL',
                quantity: 10,
                type: 'stock'
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        // Verify in database
        const [rows] = await pool.query(
            'SELECT * FROM positions WHERE ticker = ?',
            ['AAPL']
        );
        expect(rows).toHaveLength(1);
    });
});
```

### Test Commands

**package.json scripts**:
```json
{
  "test": "jest",
  "test:unit": "jest --testPathPattern=tests/unit",
  "test:integration": "TEST_TYPE=integration jest --testTimeout=120000",
  "test:coverage": "jest --coverage",
  "test:watch": "jest --watch",
  "test:ci": "jest --ci --coverage --maxWorkers=2"
}
```

**Running Tests**:
```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### CI/CD

**GitHub Actions Workflows**: `.github/workflows/`

**Example Workflow**: `.github/workflows/unit-tests.yml`

```yaml
name: Unit Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit
```

**Existing Workflows**:
- `unit-tests.yml` - Unit test execution
- `backend-ticker-standardization.yml` - Backend API tests
- `frontend-ticker-standardization.yml` - Frontend tests
- `ticker-standardization-complete.yml` - Full E2E tests
- `migration-validation.yml` - Database migration tests
- `ttm-integration-tests.yml` - TTM calculation tests
- `db-init-tests.yml` - Database initialization tests

### Coverage Configuration

**Current Thresholds** (jest.config.js:57-64):
```javascript
coverageThreshold: {
    global: {
        statements: 2,
        branches: 1,
        functions: 5,
        lines: 2
    }
}
```

**Note**: Coverage thresholds are currently very low. Source tracking implementation should target **80% coverage** for new code.

---

## Code Conventions

### Style

**Linter**: No project-wide ESLint configuration found
**Style**: Informal JavaScript conventions observed in codebase

**Common Patterns**:
- Use `const` for immutable values, `let` for mutable
- Async/await preferred over raw promises
- Arrow functions for callbacks
- Template literals for string interpolation

**Example**:
```javascript
const fetchData = async (ticker) => {
    const query = `SELECT * FROM positions WHERE ticker = ?`;
    const [rows] = await pool.execute(query, [ticker]);
    return rows;
};
```

### Error Handling

**Pattern**: Try/catch with logging and HTTP error responses

**Example** (api/autocomplete.js:87-93):
```javascript
try {
    const service = new MetadataAutocompleteService(connectionPool);
    const results = await service.searchTickers(q, options);
    res.json({ query: q.trim(), results, count: results.length });
} catch (error) {
    console.error('Autocomplete search error:', error);
    res.status(500).json({
        error: 'Search failed',
        message: error.message
    });
}
```

**Database Error Handling** (dashboard/server.js:500-508):
```javascript
try {
    await pool.query("ALTER TABLE securities_metadata ADD COLUMN sector VARCHAR(100)");
    console.log('[Schema] Added sector column');
} catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') {
        console.warn('[Schema] Sector column check:', e.message);
    }
}
```

### Logging

**Library**: Built-in `console` (no winston/pino)

**Patterns**:
- `console.log()` - General info messages
- `console.error()` - Errors
- `console.warn()` - Warnings
- `console.debug()` - Debug info (rarely used)

**Prefixes for Context**:
```javascript
console.log('[Phase 9.2] WebSocket metrics system initialized');
console.error('[TickerRegistry] Failed to initialize DB pool:', err.message);
console.warn('[Schema] Could not add column:', e.message);
```

### Naming Conventions

**Variables**:
- camelCase: `connectionPool`, `autocompleteTimeout`
- Descriptive names preferred over abbreviations

**Functions**:
- Async functions use `async` keyword
- Service methods are descriptive: `searchTickers()`, `getSourcePriorityRank()`

**Files**:
- snake_case: `ticker_registry_service.js`, `metadata_autocomplete_service.js`
- kebab-case for config: `source-priority.json`

**Database**:
- snake_case tables: `ticker_registry`, `latest_prices`, `positions`
- snake_case columns: `security_type`, `pricing_provider`, `created_at`

---

## Source Tracking Integration Points

### Data Flow

```
1. Ticker Registry (DB) → Autocomplete API → Frontend Autocomplete
   ticker_registry table
   └─> api/autocomplete.js (/api/autocomplete/search)
       └─> services/symbol-registry/metadata_autocomplete_service.js
           └─> dashboard/public/index.html (Awesomplete)

2. Frontend Form → Position API → positions table (DB)
   dashboard/public/index.html (form submission)
   └─> dashboard/server.js (/api/positions POST)
       └─> dashboard/position_body.js (normalization)
           └─> positions table INSERT

3. positions table → Price Fetcher → Pricing Provider → latest_prices table
   positions table (query for unique tickers)
   └─> scrapers/scrape_daemon.js OR yahoo_metadata_populator.js
       └─> External API (Yahoo Finance / Web scraping)
           └─> scrapers/publish_to_kafka.js
               └─> dashboard/server.js (Kafka consumer)
                   └─> latest_prices table UPDATE
```

### Files to Modify

#### Phase 1: Database Schema
- **scripts/init-db/000-base-schema.sql**
  - Modify `positions` table (rename `type` → `security_type`, add `source`, `pricing_provider`)
  - Add columns to `ticker_registry` (`pricing_provider`, `display_name`)
  - Update `latest_prices` primary key to composite (ticker, security_type)
  - Add new indices

#### Phase 2: Backend API Updates
- **api/autocomplete.js**
  - Update search query to return `source`, `pricing_provider`, `display_name`
  - Modify response format

- **services/symbol-registry/metadata_autocomplete_service.js**
  - Add new fields to SELECT query
  - Map results to include metadata object

#### Phase 3: Position Management
- **dashboard/server.js**
  - POST /api/positions: Add `security_type`, `source`, `pricing_provider` validation
  - PUT /api/positions/:id: Update to include new fields
  - GET /assets: Join with ticker_registry to get source metadata

- **dashboard/position_body.js**
  - Update normalization to handle `security_type`, `source`, `pricing_provider`

#### Phase 4: Frontend Updates
- **dashboard/public/index.html**
  - Update autocomplete item renderer to show source domain
  - Modify position form to capture and submit source metadata
  - Update dashboard ticker display to show "(Crypto - investing.com)" format
  - Add tooltips for pricing_provider

#### Phase 5: Price Routing (NEW SERVICE)
- **services/price-router.js** (NEW FILE)
  - Implement PriceRouter service class
  - Route to correct provider based on pricing_provider
  - Implement fallback logic

- **scrapers/scrape_daemon.js**
  - Update to use PriceRouter
  - Pass security_type to routing logic

- **services/symbol-registry/yahoo_metadata_populator.js**
  - Integrate with PriceRouter
  - Include security_type in all operations

#### Phase 6: Kafka Consumer Updates
- **dashboard/server.js** (Kafka consumer section)
  - Update message schema to include `security_type`, `pricing_provider`
  - Route price updates with security_type
  - Update latest_prices with composite key

#### Phase 7: Tests
- **tests/unit/price-router.test.js** (NEW)
- **tests/unit/autocomplete.test.js** (UPDATE)
- **tests/unit/positions.test.js** (UPDATE)
- **tests/integration/source-tracking-e2e.test.js** (NEW)
- **tests/integration/multiple-securities.test.js** (NEW)

#### Phase 8: Documentation
- **docs/api/** - Update API documentation
- **docs/architecture/** - Add source tracking architecture diagram
- **README.md** - Update setup instructions

### Integration Challenges

1. **Awesomplete Library Customization**
   - Vanilla JS library may require custom rendering logic for complex display format
   - Need to ensure metadata is properly attached to selection events

2. **Kafka Message Schema Changes**
   - Existing consumers may be running in production
   - Need to ensure backward compatibility or coordinated deployment

3. **Position Type Migration**
   - Existing `positions.type` ENUM needs clean migration
   - Database changes applied to base schema (no migration scripts)
   - Testing required to ensure no data loss

4. **Price Routing Complexity**
   - Multiple sources with different APIs and rate limits
   - Need robust error handling and fallback mechanisms
   - CoinGecko ticker mapping (BTC → bitcoin) requires maintenance

5. **Frontend State Management**
   - No framework (React/Vue) means manual state management
   - Need careful event handling for autocomplete selection persistence

6. **Latest Prices Composite Key**
   - Changing PRIMARY KEY from (ticker) to (ticker, security_type)
   - May affect existing queries - needs careful review

---

## Next Steps

With this codebase structure document complete, the following implementation phases can proceed:

1. ✅ **Phase 0: Codebase Discovery** - COMPLETE (this document)
2. **Phase 1: Database Schema Updates** - Ready to start
3. **Phase 2: Backend API Updates** - Blocked on Phase 1
4. **Phase 3: Price Router Service** - Blocked on Phase 1
5. **Phase 4: Kafka Consumer Updates** - Blocked on Phase 3
6. **Phase 5: Frontend Updates** - Blocked on Phase 2
7. **Phase 6: Comprehensive Testing** - Blocked on Phases 2-5
8. **Phase 7: Documentation** - Ongoing throughout

---

**Document Prepared By**: Claude Sonnet 4.5
**For Project**: wealth-tracker source tracking feature implementation
**Reference Plan**: [docs/PLAN_source_tracking_implementation.md](PLAN_source_tracking_implementation.md)
