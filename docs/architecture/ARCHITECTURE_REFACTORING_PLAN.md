# Wealth Tracker Architecture Refactoring Plan

## Status: ✅ COMPLETE - All 11 Phases Implemented

**Completion Date**: December 15, 2025  
**Last Updated**: December 15, 2025

> **Note**: This document outlines the comprehensive architectural refactoring plan for the wealth-tracker system. All 11 phases have been successfully implemented and are in production. See [ARCHITECTURE_IMPLEMENTATION_SUMMARY.md](ARCHITECTURE_IMPLEMENTATION_SUMMARY.md) for a detailed breakdown of what was built.

## Executive Summary

This document outlines a comprehensive architectural refactoring of the wealth-tracker system. The plan covered 11 phases transforming the system from fragmented CSV-based data sources to a unified database-driven architecture with improved scraping infrastructure, watchlist management, and operational tooling. **All phases are now complete and operational.**

### Key Objectives

1. **Database as Single Source of Truth** - Eliminate CSV file dependencies, use MySQL for all ticker/listing data
2. **Separated Concerns** - Dedicated services for listing sync, API scraping, and browser scraping  
3. **Parallel Scraping** - Page pool infrastructure for concurrent browser operations
4. **Watchlist Management** - Multi-provider watchlist add/delete/sync capabilities
5. **Operational Excellence** - Comprehensive error handling, monitoring, and rollback procedures

### Document Scope

| Section | Description |
|---------|-------------|
| Phases 1-2 | Listing Sync Service (CSV download, DB sync) |
| Phases 3-5 | Registry Refactoring (exchange, ticker, treasury) |
| Phase 6 | Scrape Daemon Cleanup |
| Phase 7 | Page Pool & Persistent Page Registry |
| Phases 8-9 | On-Demand Scrape API |
| Phase 10 | API Scraper Separation (Yahoo, Treasury) |
| Phase 11 | Watchlist Management & Scheduling |
| Appendices | Naming Conventions, File Structure, Implementation Patterns |

## Current State Analysis

### Problems with Current Architecture

1. **Fragmented Data Sources**: 5+ services independently read CSV files
2. **No DB Sync Trigger**: CSV downloads don't trigger database updates
3. **Duplicated Logic**: Same CSV parsing code in multiple files
4. **Memory Duplication**: Each service maintains its own cache
5. **Tight Coupling**: scrape_daemon handles both listings and price scraping

### Current Data Flow (Fragmented)

```
scrape_daemon.js (runs periodically)
    ↓
update_exchange_listings.js → Downloads CSVs (NASDAQ, NYSE, OTHER)
update_treasury_listings.js → Downloads CSVs (TREASURY)
    ↓
CSV Files (filesystem) ← No DB sync triggered!
    ↓
┌─ exchange_registry.js      (reads NASDAQ, NYSE)
├─ symbol_registry_sync.js   (reads all, writes to DB - but not triggered)
├─ ticker_registry.js        (reads all 4 CSVs)
├─ treasury_data_handler.js  (reads treasury)
└─ treasury_registry.js      (reads treasury)
```

## Target Architecture

### New Data Flow (Unified)

```
┌─────────────────────────────────────────────────────────────┐
│                listing_sync_service.js                       │
│  • Standalone service with HTTP API                          │
│  • Downloads CSVs from remote sources                        │
│  • Syncs to ticker_registry database                         │
│  • Provides on-demand ticker lookup                          │
│  • Tracks sync status and metrics                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ writes to
┌─────────────────────────────────────────────────────────────┐
│                    ticker_registry table                     │
│                   (Single Source of Truth)                   │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ reads from
┌─────────────────────────────────────────────────────────────┐
│  All Services Query Database Instead of CSVs                 │
│  • exchange_registry.js   → getExchange() queries DB         │
│  • ticker_registry.js     → loadAllTickers() queries DB      │
│  • treasury_registry.js   → isBondTicker() queries DB        │
│  • scrape_daemon.js       → gets ticker lists from DB        │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Create listing_sync_service.js (Foundation)
✅ **COMPLETE** - Commit: `c3d1dfd`

### Phase 2: Add HTTP API Endpoints
✅ **COMPLETE** - Commit: `c3d1dfd`

### Phase 3: Refactor exchange_registry.js to Use DB
✅ **COMPLETE** - Commit: `909914f`

### Phase 4: Refactor ticker_registry.js to Use DB
✅ **COMPLETE** - Commit: `69bd80f`

### Phase 5: Refactor treasury_registry.js to Use DB
✅ **COMPLETE** - Commit: `14248f5`

### Phase 6: Remove Listing Logic from scrape_daemon.js
✅ **COMPLETE** - Commit: `8009a45`

### Phase 7: Implement Page Pool for Parallel Scraping
✅ **COMPLETE** - Commit: `705aa4d`

### Phase 8: Add On-Demand Scrape Endpoint to scrape_daemon.js
✅ **COMPLETE** - Commit: `bb47579`

### Phase 9: Integration Testing & Documentation
✅ **COMPLETE** - Commit: `6791a98`

### Phase 10: Separate API Scrapers from Browser Scrapers
✅ **COMPLETE** - Commit: `3d8ecf9`

### Phase 11: Investing.com Watchlist Management API
✅ **COMPLETE** - Commits: `b1b4133`, `7066223`, `e6cb5b2`

---

## Phase 1: Create listing_sync_service.js (Foundation)

### Objective
Create a standalone service that consolidates CSV downloading and database syncing into a single, schedulable process.

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `services/listing-sync/listing_sync_service.js` | CREATE | Main service class |
| `services/listing-sync/csv_downloader.js` | CREATE | CSV download utilities |
| `services/listing-sync/index.js` | CREATE | Module exports |
| `tests/unit/services/listing-sync/listing_sync_service.test.js` | CREATE | Unit tests |
| `tests/unit/services/listing-sync/csv_downloader.test.js` | CREATE | Unit tests |

### Step 1.1: Create CSV Downloader Module

**File**: `services/listing-sync/csv_downloader.js`

```javascript
/**
 * CSV Downloader Module
 * 
 * Handles downloading CSV files from remote sources (GitHub repos, Treasury Direct)
 * with retry logic, validation, and backup functionality.
 * 
 * @module listing-sync/csv_downloader
 */

const https = require('https');
const fs = require('fs').promises;
const path = require('path');

/**
 * Configuration for CSV file sources
 * @constant {Object}
 */
const CSV_SOURCES = {
  NASDAQ: {
    url: 'https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed.csv',
    localPath: null, // Set at runtime from env
    repo: 'https://github.com/datasets/nasdaq-listings',
    columns: { ticker: 'Symbol', name: 'Security Name' }
  },
  NYSE: {
    url: 'https://raw.githubusercontent.com/datasets/nyse-other-listings/main/data/nyse-listed.csv',
    localPath: null,
    repo: 'https://github.com/datasets/nyse-other-listings',
    columns: { ticker: 'ACT Symbol', name: 'Company Name' }
  },
  OTHER: {
    url: 'https://raw.githubusercontent.com/datasets/nyse-other-listings/main/data/other-listed.csv',
    localPath: null,
    repo: 'https://github.com/datasets/nyse-other-listings',
    columns: { ticker: 'ACT Symbol', name: 'Company Name' }
  },
  TREASURY: {
    url: 'https://www.treasurydirect.gov/TA_WS/securities/auctioned',
    localPath: null,
    repo: 'Treasury Direct API',
    columns: { ticker: 'cusip', name: 'securityType' }
  }
};

class CsvDownloader {
  constructor(options = {}) {
    this.configDir = options.configDir || process.env.CONFIG_DIR || '/app/config';
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;
    this.timeoutMs = options.timeoutMs || 30000;
    
    // Initialize local paths
    this._initializePaths();
  }

  // ... implementation details
}

module.exports = { CsvDownloader, CSV_SOURCES };
```

**Tests Required**:
- `downloadFile()` - success, failure, retry logic
- `validateCsvContent()` - valid CSV, empty file, malformed
- `needsUpdate()` - file changed, file unchanged, file missing
- `backupFile()` - successful backup, disk full simulation

**Documentation**:
- JSDoc for all public methods
- README section on configuration
- Error codes and handling

---

### Step 1.2: Create Main Service Class

**File**: `services/listing-sync/listing_sync_service.js`

```javascript
/**
 * Listing Sync Service
 * 
 * Standalone service responsible for:
 * 1. Downloading CSV files from remote sources
 * 2. Parsing and validating ticker data
 * 3. Syncing to ticker_registry database
 * 4. Providing HTTP API for on-demand operations
 * 5. Tracking sync status and metrics
 * 
 * @module listing-sync/listing_sync_service
 */

const { CsvDownloader } = require('./csv_downloader');
const SymbolRegistrySyncService = require('../symbol-registry/symbol_registry_sync');

/**
 * Default configuration for the listing sync service
 * @constant {Object}
 */
const DEFAULT_CONFIG = {
  // Sync intervals in minutes
  syncInterval: 1440, // 24 hours
  
  // HTTP server settings
  httpPort: 3010,
  
  // Database connection
  dbHost: process.env.DB_HOST || 'mysql',
  dbPort: process.env.DB_PORT || 3306,
  dbName: process.env.DB_NAME || 'wealth_tracker',
  dbUser: process.env.DB_USER || 'root',
  dbPassword: process.env.DB_PASSWORD || '',
  
  // Feature flags
  enableAutoSync: true,
  enableHttpApi: true,
  
  // Paths
  configDir: process.env.CONFIG_DIR || '/app/config',
  logsDir: process.env.LOGS_DIR || '/app/logs'
};

class ListingSyncService {
  /**
   * Create a new ListingSyncService instance
   * @param {Object} options - Configuration options
   * @param {Object} options.dbPool - MySQL connection pool (optional, will create if not provided)
   * @param {number} options.syncInterval - Sync interval in minutes
   * @param {number} options.httpPort - HTTP API port
   * @param {boolean} options.enableAutoSync - Enable automatic periodic sync
   * @param {boolean} options.enableHttpApi - Enable HTTP API server
   */
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.dbPool = options.dbPool || null;
    this.downloader = new CsvDownloader({ configDir: this.config.configDir });
    this.syncService = null; // Initialized when DB pool is ready
    this.httpServer = null;
    this.syncTimer = null;
    this.isRunning = false;
    this.lastSyncAt = null;
    this.lastSyncStatus = null;
    this.stats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastSyncDurationMs: 0,
      tickersBySource: {}
    };
  }

  /**
   * Initialize the service
   * - Create database connection if not provided
   * - Initialize sync service
   * - Start HTTP API if enabled
   * - Start auto-sync timer if enabled
   * @returns {Promise<void>}
   */
  async initialize() {
    // Implementation
  }

  /**
   * Perform a full sync of all CSV sources
   * @returns {Promise<Object>} Sync results with statistics
   */
  async syncAll() {
    // Implementation
  }

  /**
   * Sync a specific file type
   * @param {string} fileType - One of: NASDAQ, NYSE, OTHER, TREASURY
   * @returns {Promise<Object>} Sync results
   */
  async syncFileType(fileType) {
    // Implementation
  }

  /**
   * Sync specific tickers (fetch metadata from Yahoo)
   * @param {string[]} tickers - Array of ticker symbols
   * @returns {Promise<Object>} Sync results for each ticker
   */
  async syncTickers(tickers) {
    // Implementation
  }

  /**
   * Get current service status
   * @returns {Object} Service status including sync state and stats
   */
  getStatus() {
    // Implementation
  }

  /**
   * Graceful shutdown
   * @returns {Promise<void>}
   */
  async shutdown() {
    // Implementation
  }
}

module.exports = ListingSyncService;
```

**Tests Required**:
- Constructor with default options
- Constructor with custom options
- `initialize()` - DB connection, HTTP server startup
- `syncAll()` - full sync success, partial failure, complete failure
- `syncFileType()` - each file type
- `syncTickers()` - valid tickers, invalid tickers, mixed
- `getStatus()` - various states
- `shutdown()` - graceful cleanup

**Documentation**:
- Class overview and responsibilities
- Configuration options table
- API endpoint documentation
- Error handling guide

---

### Step 1.2.1: Database Upsert Implementation

**File**: `services/listing-sync/db_sync.js`

The `syncAll()` and `syncFileType()` methods use this helper to upsert records into `ticker_registry`:

```javascript
/**
 * Database Sync Helper
 * 
 * Handles upsert operations for ticker_registry table.
 * Maps CSV columns to database columns for each source type.
 * 
 * @module listing-sync/db_sync
 */

/**
 * CSV column mappings by source type
 * Maps CSV header names to ticker_registry columns
 */
const CSV_COLUMN_MAPPINGS = {
  NASDAQ: {
    ticker: 'Symbol',
    name: 'Security Name',
    exchange: () => 'NASDAQ',
    security_type: () => 'EQUITY',
    source: () => 'NASDAQ_FILE'
  },
  NYSE: {
    ticker: 'ACT Symbol',
    name: 'Company Name',
    exchange: () => 'NYSE',
    security_type: () => 'EQUITY',
    source: () => 'NYSE_FILE'
  },
  OTHER: {
    ticker: 'ACT Symbol',
    name: 'Security Name',
    exchange: (row) => row['Exchange'] || 'OTHER',
    security_type: () => 'EQUITY',
    source: () => 'OTHER_LISTED_FILE'
  },
  TREASURY: {
    ticker: 'CUSIP',
    name: 'Security Description',
    exchange: () => 'OTC',
    security_type: () => 'US_TREASURY',
    source: () => 'TREASURY_FILE',
    issue_date: 'Issue Date',
    maturity_date: 'Maturity Date',
    security_term: 'Security Term'
  }
};

/**
 * Upsert ticker records from CSV data into ticker_registry
 * @param {Object} pool - MySQL connection pool
 * @param {string} sourceType - One of: NASDAQ, NYSE, OTHER, TREASURY
 * @param {Array<Object>} records - Parsed CSV records
 * @returns {Promise<Object>} Upsert statistics
 */
async function upsertTickers(pool, sourceType, records) {
  const mapping = CSV_COLUMN_MAPPINGS[sourceType];
  if (!mapping) {
    throw new Error(`Unknown source type: ${sourceType}`);
  }

  const stats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const conn = await pool.getConnection();
  
  try {
    // Use transaction for batch upsert
    await conn.beginTransaction();

    for (const record of records) {
      try {
        // Extract ticker (skip if missing)
        const ticker = record[mapping.ticker]?.trim().toUpperCase();
        if (!ticker) {
          stats.skipped++;
          continue;
        }

        // Build values object
        const values = {
          ticker,
          name: record[mapping.name] || null,
          exchange: typeof mapping.exchange === 'function' ? mapping.exchange(record) : mapping.exchange,
          security_type: typeof mapping.security_type === 'function' ? mapping.security_type(record) : mapping.security_type,
          source: typeof mapping.source === 'function' ? mapping.source(record) : mapping.source
        };

        // Add optional fields for Treasury
        if (mapping.issue_date && record[mapping.issue_date]) {
          values.issue_date = parseDate(record[mapping.issue_date]);
        }
        if (mapping.maturity_date && record[mapping.maturity_date]) {
          values.maturity_date = parseDate(record[mapping.maturity_date]);
        }
        if (mapping.security_term && record[mapping.security_term]) {
          values.security_term = record[mapping.security_term];
        }

        // Upsert query
        const [result] = await conn.execute(`
          INSERT INTO ticker_registry (ticker, name, exchange, security_type, source, issue_date, maturity_date, security_term)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            exchange = VALUES(exchange),
            security_type = VALUES(security_type),
            source = VALUES(source),
            issue_date = COALESCE(VALUES(issue_date), issue_date),
            maturity_date = COALESCE(VALUES(maturity_date), maturity_date),
            security_term = COALESCE(VALUES(security_term), security_term),
            updated_at = CURRENT_TIMESTAMP
        `, [
          values.ticker,
          values.name,
          values.exchange,
          values.security_type,
          values.source,
          values.issue_date || null,
          values.maturity_date || null,
          values.security_term || null
        ]);

        if (result.affectedRows === 1) {
          stats.inserted++;
        } else if (result.affectedRows === 2) {
          stats.updated++;
        }
      } catch (e) {
        stats.errors.push({ ticker: record[mapping.ticker], error: e.message });
      }
    }

    await conn.commit();
    console.log(`[DbSync] ${sourceType}: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.skipped} skipped`);
    
    return stats;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Parse date string to MySQL DATE format
 * @param {string} dateStr - Date string from CSV
 * @returns {string|null} MySQL DATE format or null
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

module.exports = { upsertTickers, CSV_COLUMN_MAPPINGS };
```

**Usage in ListingSyncService**:

```javascript
const { upsertTickers } = require('./db_sync');

class ListingSyncService {
  async syncFileType(fileType) {
    // 1. Download CSV
    const csvPath = await this.downloader.downloadFile(fileType);
    
    // 2. Parse CSV
    const records = await this.downloader.parseCsvFile(csvPath);
    
    // 3. Upsert to database
    const stats = await upsertTickers(this.dbPool, fileType, records);
    
    // 4. Update sync status
    await this.updateSyncStatus(fileType, stats);
    
    return stats;
  }
}
```

---

### Step 1.3: Create Module Index

**File**: `services/listing-sync/index.js`

```javascript
/**
 * Listing Sync Service Module
 * 
 * Exports all components of the listing sync service for use by other modules.
 * 
 * @module listing-sync
 * @example
 * const { ListingSyncService, CsvDownloader } = require('./services/listing-sync');
 * const service = new ListingSyncService({ httpPort: 3010 });
 * await service.initialize();
 */

const ListingSyncService = require('./listing_sync_service');
const { CsvDownloader, CSV_SOURCES } = require('./csv_downloader');

module.exports = {
  ListingSyncService,
  CsvDownloader,
  CSV_SOURCES
};
```

---

### Step 1.4: Unit Tests

**File**: `tests/unit/services/listing-sync/listing_sync_service.test.js`

```javascript
/**
 * Unit Tests for ListingSyncService
 * 
 * Test coverage:
 * - Service initialization and configuration
 * - Full sync operations
 * - File-specific sync operations
 * - Ticker-specific sync operations
 * - Status reporting
 * - Graceful shutdown
 * - Error handling and recovery
 */

const ListingSyncService = require('../../../../services/listing-sync/listing_sync_service');

describe('ListingSyncService', () => {
  describe('Configuration', () => {
    test('should initialize with default configuration', () => {
      // Test implementation
    });

    test('should accept custom configuration', () => {
      // Test implementation
    });

    test('should use environment variables for database config', () => {
      // Test implementation
    });
  });

  describe('initialize()', () => {
    test('should create database pool if not provided', async () => {
      // Test implementation
    });

    test('should start HTTP server when enabled', async () => {
      // Test implementation
    });

    test('should start auto-sync timer when enabled', async () => {
      // Test implementation
    });

    test('should handle initialization errors gracefully', async () => {
      // Test implementation
    });
  });

  describe('syncAll()', () => {
    test('should sync all file types successfully', async () => {
      // Test implementation
    });

    test('should continue syncing remaining files if one fails', async () => {
      // Test implementation
    });

    test('should update stats after sync', async () => {
      // Test implementation
    });

    test('should not allow concurrent syncs', async () => {
      // Test implementation
    });
  });

  // ... more test suites
});
```

**File**: `tests/unit/services/listing-sync/csv_downloader.test.js`

```javascript
/**
 * Unit Tests for CsvDownloader
 * 
 * Test coverage:
 * - File download operations
 * - Retry logic
 * - Content validation
 * - Backup functionality
 * - Error handling
 */

const { CsvDownloader, CSV_SOURCES } = require('../../../../services/listing-sync/csv_downloader');

describe('CsvDownloader', () => {
  describe('downloadFile()', () => {
    test('should download file successfully', async () => {
      // Mock HTTPS request
    });

    test('should retry on failure', async () => {
      // Mock failures then success
    });

    test('should throw after max retries', async () => {
      // Mock all failures
    });

    test('should respect timeout', async () => {
      // Mock slow response
    });
  });

  describe('validateCsvContent()', () => {
    test('should accept valid CSV with expected columns', () => {
      // Test implementation
    });

    test('should reject empty content', () => {
      // Test implementation
    });

    test('should reject CSV missing required columns', () => {
      // Test implementation
    });
  });

  // ... more test suites
});
```

---

### Step 1.5: CI Configuration Update

**File**: Update `.github/workflows/test.yml` (or create if not exists)

```yaml
# Add to existing CI workflow
jobs:
  test:
    # ... existing config
    steps:
      # ... existing steps
      
      - name: Run Listing Sync Service Tests
        run: npm run test:listing-sync
        
      - name: Run Integration Tests
        run: npm run test:integration
        env:
          TEST_DB_HOST: localhost
          TEST_DB_PORT: 3306
          TEST_DB_NAME: testdb
```

**File**: Update `package.json` scripts

```json
{
  "scripts": {
    "test:listing-sync": "jest tests/unit/services/listing-sync --coverage",
    "test:all": "jest --coverage"
  }
}
```

---

## Phase 2: Add HTTP API Endpoints

### Objective
Add HTTP API to listing_sync_service.js for dashboard integration and on-demand operations.

### API Specification

| Endpoint | Method | Description | Request Body | Response |
|----------|--------|-------------|--------------|----------|
| `/health` | GET | Health check | - | `{ status, uptime, lastSync }` |
| `/status` | GET | Detailed status | - | `{ isRunning, stats, lastSync }` |
| `/sync/all` | POST | Trigger full sync | - | `{ success, results }` |
| `/sync/file/:type` | POST | Sync specific file | - | `{ success, fileType, stats }` |
| `/sync/tickers` | POST | Sync specific tickers | `{ tickers: [] }` | `{ success, results }` |
| `/lookup/:ticker` | GET | Lookup ticker info | - | `{ ticker, exchange, ... }` |

### Step 2.1: Create HTTP API Handler

**File**: `services/listing-sync/http_api.js`

```javascript
/**
 * HTTP API Handler for Listing Sync Service
 * 
 * Provides REST API endpoints for:
 * - Health checks and status monitoring
 * - On-demand sync operations
 * - Ticker lookup and validation
 * 
 * @module listing-sync/http_api
 */

const http = require('http');
const url = require('url');

/**
 * Create HTTP API server for the listing sync service
 * @param {ListingSyncService} service - The listing sync service instance
 * @param {number} port - Port to listen on
 * @returns {http.Server} HTTP server instance
 */
function createHttpApi(service, port) {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // CORS headers for dashboard access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Route handling
      if (pathname === '/health' && method === 'GET') {
        await handleHealth(service, req, res);
      } else if (pathname === '/status' && method === 'GET') {
        await handleStatus(service, req, res);
      } else if (pathname === '/sync/all' && method === 'POST') {
        await handleSyncAll(service, req, res);
      } else if (pathname.startsWith('/sync/file/') && method === 'POST') {
        await handleSyncFile(service, req, res, pathname);
      } else if (pathname === '/sync/tickers' && method === 'POST') {
        await handleSyncTickers(service, req, res);
      } else if (pathname.startsWith('/lookup/') && method === 'GET') {
        await handleLookup(service, req, res, pathname);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      console.error('[ListingSyncAPI] Error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  return server;
}

// Handler implementations...

module.exports = { createHttpApi };
```

**Tests Required**:
- All endpoint handlers
- Error responses
- CORS handling
- Request body parsing
- Concurrent request handling

---

### Step 2.2: Integration Tests

**File**: `tests/integration/listing_sync_api.test.js`

```javascript
/**
 * Integration Tests for Listing Sync HTTP API
 * 
 * Tests the full HTTP API with actual HTTP requests,
 * database connections, and file operations.
 */

const http = require('http');
const ListingSyncService = require('../../services/listing-sync');

describe('Listing Sync API Integration Tests', () => {
  let service;
  let baseUrl;

  beforeAll(async () => {
    service = new ListingSyncService({
      httpPort: 0, // Random port
      enableAutoSync: false
    });
    await service.initialize();
    baseUrl = `http://localhost:${service.httpServer.address().port}`;
  });

  afterAll(async () => {
    await service.shutdown();
  });

  describe('GET /health', () => {
    test('should return healthy status', async () => {
      const response = await fetch(`${baseUrl}/health`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.uptime).toBeGreaterThan(0);
    });
  });

  describe('POST /sync/all', () => {
    test('should trigger full sync', async () => {
      const response = await fetch(`${baseUrl}/sync/all`, {
        method: 'POST'
      });
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.results).toBeDefined();
    });
  });

  // ... more tests
});
```

---

## Phase 3: Refactor exchange_registry.js to Use DB

### Objective
Replace CSV file reading with database queries. Database is the single source of truth.

### Step 3.1: Add Database Query Methods

**File**: Modify `scrapers/exchange_registry.js`

```javascript
/**
 * Exchange Registry
 * 
 * Provides exchange lookup functionality for tickers.
 * 
 * Data source: Database (ticker_registry table)
 * 
 * @module scrapers/exchange_registry
 */

// Cache
let exchangeCache = null;
let dbPool = null;

/**
 * Initialize database connection for exchange lookups
 * @param {Object} pool - MySQL connection pool
 */
function initializeDbPool(pool) {
  dbPool = pool;
  // Invalidate cache to force DB load on next request
  exchangeCache = null;
}

/**
 * Load exchange data from database
 * @returns {Promise<Object>} Object with NASDAQ, NYSE, OTHER Sets
 */
async function loadExchangeData() {
  if (exchangeCache) return exchangeCache;
  
  if (!dbPool) {
    throw new Error('Database pool not initialized. Call initializeDbPool() first.');
  }

  const cache = {
    NASDAQ: new Set(),
    NYSE: new Set(),
    OTHER: new Set()
  };

  const conn = await dbPool.getConnection();
  try {
    const [rows] = await conn.execute(`
      SELECT ticker, exchange 
      FROM ticker_registry 
      WHERE exchange IN ('NASDAQ', 'NYSE', 'OTHER')
        AND security_type IN ('EQUITY', 'ETF')
    `);

    for (const row of rows) {
      const ticker = row.ticker.toUpperCase();
      if (row.exchange === 'NASDAQ') {
        cache.NASDAQ.add(ticker);
      } else if (row.exchange === 'NYSE') {
        cache.NYSE.add(ticker);
      } else {
        cache.OTHER.add(ticker);
      }
    }

    exchangeCache = cache;
    console.log(`[ExchangeRegistry] Loaded ${cache.NASDAQ.size} NASDAQ, ${cache.NYSE.size} NYSE, ${cache.OTHER.size} OTHER tickers from DB`);
    return cache;
  } finally {
    conn.release();
  }
}

  // Async update from DB if available
  if (dbPool) {
    loadExchangeDataFromDb()
      .then(dbCache => {
        exchangeCache = dbCache;
/**
 * Get exchange for a ticker
 * @param {string} ticker - Stock ticker symbol
 * @returns {Promise<string|null>} Exchange name or null if not found
 */
async function getExchange(ticker) {
  if (!ticker) return null;
  
  const normalizedTicker = ticker.toUpperCase().replace(/-/g, '.');
  const data = await loadExchangeData();
  
  if (data.NASDAQ.has(ticker) || data.NASDAQ.has(normalizedTicker)) return 'NASDAQ';
  if (data.NYSE.has(ticker) || data.NYSE.has(normalizedTicker)) return 'NYSE';
  if (data.OTHER.has(ticker) || data.OTHER.has(normalizedTicker)) return 'OTHER';

  // Direct DB lookup for uncached tickers
  if (dbPool) {
    const conn = await dbPool.getConnection();
    try {
      const [rows] = await conn.execute(
        'SELECT exchange FROM ticker_registry WHERE ticker = ? LIMIT 1',
        [ticker.toUpperCase()]
      );
      if (rows.length > 0) {
        return rows[0].exchange;
      }
    } finally {
      conn.release();
    }
  }

  return null;
}

/**
 * Force reload of exchange data from database
 * @returns {Promise<void>}
 */
async function reloadExchangeData() {
  exchangeCache = null;
  await loadExchangeData();
}

/**
 * Get cache statistics
 * @returns {Promise<Object>} Cache stats
 */
async function getCacheStats() {
  const data = await loadExchangeData();
  return {
    nasdaqCount: data.NASDAQ.size,
    nyseCount: data.NYSE.size,
    otherCount: data.OTHER.size,
    hasDbConnection: !!dbPool
  };
}

module.exports = {
  getExchange,
  reloadExchangeData,
  loadExchangeData,
  initializeDbPool,
  getCacheStats,
  normalizedTickerForLookup: (ticker) => ticker ? encodeURIComponent(String(ticker)) : ''
};
```

**Tests Required**:
- `initializeDbPool()` - valid pool, null pool
- `loadExchangeData()` - success, DB not initialized error
- `getExchange()` - NASDAQ, NYSE, OTHER, unknown, direct DB lookup
- `reloadExchangeData()` - cache invalidation
- Error handling - DB connection failures

---

## Phase 4: Refactor ticker_registry.js to Use DB

### Objective
Replace CSV file reading in dashboard/ticker_registry.js with database queries.

### Step 4.1: Add Database Query Methods

**File**: Modify `dashboard/ticker_registry.js`

```javascript
/**
 * Ticker Registry
 * 
 * Provides ticker data for dashboard autocomplete and lookup.
 * 
 * Data source: Database (ticker_registry table)
 * 
 * @module dashboard/ticker_registry
 */

let dbPool = null;
let tickerCache = null;

/**
 * Initialize database connection
 * @param {Object} pool - MySQL connection pool
 */
function initializeDbPool(pool) {
  dbPool = pool;
  tickerCache = null;
}

/**
 * Load all tickers from database
 * @returns {Promise<Array>} Array of ticker objects
 */
async function loadAllTickers() {
  if (tickerCache) return tickerCache;
  
  if (!dbPool) {
    throw new Error('Database pool not initialized. Call initializeDbPool() first.');
  }

  const conn = await dbPool.getConnection();
  try {
    const [rows] = await conn.execute(`
      SELECT 
        ticker,
        name,
        exchange,
        security_type,
        maturity_date,
        issue_date,
        security_term
      FROM ticker_registry
      ORDER BY 
        CASE exchange 
          WHEN 'NASDAQ' THEN 1 
          WHEN 'NYSE' THEN 2 
          ELSE 3 
        END,
        sort_rank ASC,
        ticker ASC
    `);

    tickerCache = rows.map(row => ({
      ticker: row.ticker,
      symbol: row.ticker, // Alias for compatibility
      name: row.name || '',
      exchange: row.exchange,
      securityType: row.security_type,
      maturityDate: row.maturity_date,
      issueDate: row.issue_date,
      securityTerm: row.security_term
    }));

    console.log(`[TickerRegistry] Loaded ${tickerCache.length} tickers from database`);
    return tickerCache;
  } finally {
    conn.release();
  }
}

/**
 * Force reload of ticker data from database
 * @returns {Promise<Array>} Array of ticker objects
 */
async function reloadTickers() {
  tickerCache = null;
  return loadAllTickers();
}

/**
 * Search tickers by prefix (for autocomplete)
 * @param {string} prefix - Ticker prefix to search
 * @param {number} limit - Max results (default 20)
 * @returns {Promise<Array>} Matching tickers
 */
async function searchTickers(prefix, limit = 20) {
  if (!dbPool) {
    throw new Error('Database pool not initialized. Call initializeDbPool() first.');
  }

  const conn = await dbPool.getConnection();
  try {
    const [rows] = await conn.execute(`
      SELECT ticker, name, exchange, security_type
      FROM ticker_registry
      WHERE ticker LIKE ?
      ORDER BY sort_rank ASC, ticker ASC
      LIMIT ?
    `, [`${prefix.toUpperCase()}%`, limit]);
    
    return rows;
  } finally {
    conn.release();
  }
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
function getCacheStats() {
  return {
    count: tickerCache ? tickerCache.length : 0,
    hasDbConnection: !!dbPool
  };
}

module.exports = {
  loadAllTickers,
  reloadTickers,
  searchTickers,
  initializeDbPool,
  getCacheStats
};
```

**Tests Required**:
- `initializeDbPool()` - initialization
- `loadAllTickers()` - full load, empty table, DB not initialized error
- `searchTickers()` - prefix search, empty results
- `reloadTickers()` - cache invalidation
- `getCacheStats()` - with/without cache

---

## Phase 5: Refactor treasury_registry.js to Use DB

### Objective
Replace CSV file reading with database queries for treasury/bond lookup.

### Step 5.1: Add Database Query Methods

**File**: Modify `scrapers/treasury_registry.js`

```javascript
/**
 * Treasury Registry
 * 
 * Provides lookup functionality for treasury securities (bonds, bills, notes).
 * 
 * @module scrapers/treasury_registry
 */

let dbPool = null;
let treasuryCache = null;

/**
 * Initialize database connection
 * @param {Object} pool - MySQL connection pool
 */
function initializeDbPool(pool) {
  dbPool = pool;
  treasuryCache = null;
}

/**
 * Load treasury securities into cache
 * @returns {Promise<Set>} Set of treasury tickers/CUSIPs
 */
async function loadTreasuryCache() {
  if (treasuryCache) return treasuryCache;
  
  if (!dbPool) {
    throw new Error('Database pool not initialized. Call initializeDbPool() first.');
  }

  const conn = await dbPool.getConnection();
  try {
    const [rows] = await conn.execute(`
      SELECT ticker FROM ticker_registry 
      WHERE security_type = 'TREASURY'
    `);
    
    treasuryCache = new Set(rows.map(r => r.ticker.toUpperCase()));
    console.log(`[TreasuryRegistry] Loaded ${treasuryCache.size} treasury securities from database`);
    return treasuryCache;
  } finally {
    conn.release();
  }
}

/**
 * Check if a ticker is a treasury security
 * @param {string} ticker - Ticker/CUSIP to check
 * @returns {Promise<boolean>} True if treasury security
 */
async function isBondTicker(ticker) {
  if (!ticker) return false;
  
  const cache = await loadTreasuryCache();
  return cache.has(ticker.toUpperCase());
}

/**
 * Get treasury security details
 * @param {string} ticker - Ticker/CUSIP
 * @returns {Promise<Object|null>} Treasury details or null
 */
async function getTreasuryDetails(ticker) {
  if (!dbPool) {
    throw new Error('Database pool not initialized. Call initializeDbPool() first.');
  }

  const conn = await dbPool.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT ticker, name, issue_date, maturity_date, security_term
       FROM ticker_registry
       WHERE ticker = ? AND security_type = 'TREASURY'
       LIMIT 1`,
      [ticker.toUpperCase()]
    );
    
    if (rows.length > 0) {
      return {
        cusip: rows[0].ticker,
        name: rows[0].name,
        issueDate: rows[0].issue_date,
        maturityDate: rows[0].maturity_date,
        securityTerm: rows[0].security_term
      };
    }
    return null;
  } finally {
    conn.release();
  }
}

/**
 * Force reload of treasury data from database
 * @returns {Promise<void>}
 */
async function reloadTreasuryData() {
  treasuryCache = null;
  await loadTreasuryCache();
}

module.exports = {
  isBondTicker,
  getTreasuryDetails,
  reloadTreasuryData,
  initializeDbPool
};
```

**Tests Required**:
- `initializeDbPool()` - initialization
- `loadTreasuryCache()` - full load, DB not initialized error
- `isBondTicker()` - found, not found
- `getTreasuryDetails()` - found, not found
- CUSIP format (9-character alphanumeric)

---

## Phase 6: Remove Listing Logic from scrape_daemon.js

### Objective
Remove CSV download logic from scrape_daemon.js, making it focus solely on price scraping.

### Step 6.1: Remove US Listings Update Code

**File**: Modify `scrapers/scrape_daemon.js`

Remove these sections:
- US Listings Update (lines ~467-493)
- US Treasury Listings Update (lines ~496-520)

Replace with initialization of DB pool for exchange registry:

```javascript
// At startup, initialize exchange registry with DB pool
const { initializeDbPool: initExchangeDb } = require('./exchange_registry');
// ... after DB pool creation
initExchangeDb(pool);
```

**Tests Required**:
- Verify scrape_daemon starts without listing update code
- Verify exchange registry uses DB pool
- Verify price scraping still works

---

## Phase 7: Implement Page Pool for Parallel Scraping

### Objective
Enable parallel scraping of multiple tickers using a page pool within a single browser instance, maximizing throughput while minimizing memory overhead.

### Memory Analysis

| Strategy | Parallelism | Est. Memory | Notes |
|----------|-------------|-------------|-------|
| Current (1 browser, 1 page) | 1x | 500 MB | Sequential, slow |
| Page pool (1 browser, 4 pages) | 4x | 700 MB | **Recommended** |
| Page pool (1 browser, 8 pages) | 8x | 1.1 GB | Good for batch |
| Browser pool (4 browsers) | 4x | 1.6 GB | High overhead |

### Step 7.1: Create Page Pool Manager

**File**: `scrapers/page_pool.js`

```javascript
/**
 * Page Pool Manager
 * 
 * Manages a pool of browser pages for parallel scraping operations.
 * Uses a single browser instance to minimize memory overhead while
 * enabling concurrent page operations.
 * 
 * Memory estimates:
 * - Browser overhead: ~200 MB
 * - Per page (active): ~80-150 MB
 * - 4 pages total: ~500-800 MB
 * 
 * @module scrapers/page_pool
 */

const EventEmitter = require('events');

/**
 * Default configuration for page pool
 * @constant {Object}
 */
const DEFAULT_CONFIG = {
  // Number of pages in the pool
  poolSize: 4,
  
  // Timeout for acquiring a page (ms)
  acquireTimeout: 30000,
  
  // Max operations per page before recycling
  maxOperationsPerPage: 100,
  
  // Page navigation timeout (ms)
  navigationTimeout: 30000,
  
  // Idle page cleanup interval (ms)
  idleCleanupInterval: 60000,
  
  // Max idle time before page is recycled (ms)
  maxIdleTime: 300000, // 5 minutes
};

/**
 * Page wrapper that tracks usage statistics
 * @typedef {Object} PooledPage
 * @property {Page} page - Puppeteer page instance
 * @property {number} id - Unique page identifier
 * @property {boolean} inUse - Whether page is currently in use
 * @property {number} operationCount - Number of operations performed
 * @property {number} lastUsedAt - Timestamp of last use
 * @property {number} createdAt - Timestamp of creation
 * @property {string|null} currentTicker - Ticker currently being scraped
 */

class PagePool extends EventEmitter {
  /**
   * Create a new PagePool instance
   * @param {Browser} browser - Puppeteer browser instance
   * @param {Object} options - Configuration options
   * @param {number} options.poolSize - Number of pages in pool (default: 4)
   * @param {number} options.acquireTimeout - Max wait time for page (default: 30000ms)
   * @param {number} options.maxOperationsPerPage - Recycle after N operations (default: 100)
   */
  constructor(browser, options = {}) {
    super();
    this.browser = browser;
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.pages = [];
    this.waitQueue = [];
    this.nextPageId = 1;
    this.isInitialized = false;
    this.isShuttingDown = false;
    this.cleanupTimer = null;
    
    // Statistics
    this.stats = {
      totalAcquires: 0,
      totalReleases: 0,
      totalRecycles: 0,
      totalWaits: 0,
      maxWaitTime: 0,
      errors: 0
    };
  }

  /**
   * Initialize the page pool
   * Creates initial set of pages
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      throw new Error('PagePool already initialized');
    }

    console.log(`[PagePool] Initializing with ${this.config.poolSize} pages...`);
    
    const createPromises = [];
    for (let i = 0; i < this.config.poolSize; i++) {
      createPromises.push(this._createPage());
    }
    
    await Promise.all(createPromises);
    this.isInitialized = true;
    
    // Start idle cleanup timer
    this._startCleanupTimer();
    
    console.log(`[PagePool] Initialized successfully with ${this.pages.length} pages`);
    this.emit('initialized', { poolSize: this.pages.length });
  }

  /**
   * Create a new page and add to pool
   * @private
   * @returns {Promise<PooledPage>}
   */
  async _createPage() {
    const page = await this.browser.newPage();
    
    // Configure page defaults
    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultNavigationTimeout(this.config.navigationTimeout);
    
    // Block unnecessary resources to save memory
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      // Block images, fonts, stylesheets for scraping
      if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    const pooledPage = {
      page,
      id: this.nextPageId++,
      inUse: false,
      operationCount: 0,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      currentTicker: null
    };
    
    this.pages.push(pooledPage);
    console.log(`[PagePool] Created page #${pooledPage.id}`);
    
    return pooledPage;
  }

  /**
   * Acquire a page from the pool
   * @param {string} ticker - Ticker being scraped (for tracking)
   * @returns {Promise<{page: Page, release: Function}>} Page and release function
   * @throws {Error} If timeout waiting for page
   */
  async acquire(ticker = null) {
    if (!this.isInitialized) {
      throw new Error('PagePool not initialized');
    }
    
    if (this.isShuttingDown) {
      throw new Error('PagePool is shutting down');
    }

    const startTime = Date.now();
    
    // Try to find an available page
    let pooledPage = this.pages.find(p => !p.inUse);
    
    if (pooledPage) {
      return this._markAcquired(pooledPage, ticker);
    }
    
    // No page available, wait in queue
    this.stats.totalWaits++;
    console.log(`[PagePool] No pages available, waiting... (queue: ${this.waitQueue.length + 1})`);
    
    return new Promise((resolve, reject) => {
      const waiter = {
        ticker,
        startTime,
        resolve,
        reject,
        timer: setTimeout(() => {
          // Remove from queue
          const index = this.waitQueue.indexOf(waiter);
          if (index !== -1) {
            this.waitQueue.splice(index, 1);
          }
          reject(new Error(`Timeout waiting for page (${this.config.acquireTimeout}ms)`));
        }, this.config.acquireTimeout)
      };
      
      this.waitQueue.push(waiter);
    });
  }

  /**
   * Mark a page as acquired
   * @private
   */
  _markAcquired(pooledPage, ticker) {
    pooledPage.inUse = true;
    pooledPage.currentTicker = ticker;
    pooledPage.operationCount++;
    this.stats.totalAcquires++;
    
    console.log(`[PagePool] Acquired page #${pooledPage.id} for ${ticker || 'unknown'}`);
    
    // Return page with release function bound
    const release = () => this.release(pooledPage.id);
    return { page: pooledPage.page, release, pageId: pooledPage.id };
  }

  /**
   * Release a page back to the pool
   * @param {number} pageId - Page ID to release
   * @returns {Promise<void>}
   */
  async release(pageId) {
    const pooledPage = this.pages.find(p => p.id === pageId);
    
    if (!pooledPage) {
      console.warn(`[PagePool] Attempted to release unknown page #${pageId}`);
      return;
    }
    
    if (!pooledPage.inUse) {
      console.warn(`[PagePool] Page #${pageId} was not in use`);
      return;
    }

    // Check if page needs recycling
    if (pooledPage.operationCount >= this.config.maxOperationsPerPage) {
      console.log(`[PagePool] Page #${pageId} reached max operations, recycling...`);
      await this._recyclePage(pooledPage);
    } else {
      // Clear page state for next use
      try {
        // Navigate to blank to clear state
        await pooledPage.page.goto('about:blank', { waitUntil: 'domcontentloaded' });
      } catch (e) {
        console.warn(`[PagePool] Error clearing page #${pageId}: ${e.message}`);
        await this._recyclePage(pooledPage);
        return;
      }
    }

    pooledPage.inUse = false;
    pooledPage.currentTicker = null;
    pooledPage.lastUsedAt = Date.now();
    this.stats.totalReleases++;
    
    console.log(`[PagePool] Released page #${pooledPage.id}`);
    
    // Check if anyone is waiting
    this._processWaitQueue();
    
    this.emit('released', { pageId: pooledPage.id });
  }

  /**
   * Process waiting requests
   * @private
   */
  _processWaitQueue() {
    if (this.waitQueue.length === 0) return;
    
    const availablePage = this.pages.find(p => !p.inUse);
    if (!availablePage) return;
    
    const waiter = this.waitQueue.shift();
    clearTimeout(waiter.timer);
    
    const waitTime = Date.now() - waiter.startTime;
    this.stats.maxWaitTime = Math.max(this.stats.maxWaitTime, waitTime);
    
    console.log(`[PagePool] Fulfilled waiting request after ${waitTime}ms`);
    
    waiter.resolve(this._markAcquired(availablePage, waiter.ticker));
  }

  /**
   * Recycle a page (close and create new)
   * @private
   */
  async _recyclePage(pooledPage) {
    const index = this.pages.indexOf(pooledPage);
    
    try {
      await pooledPage.page.close();
    } catch (e) {
      console.warn(`[PagePool] Error closing page #${pooledPage.id}: ${e.message}`);
    }
    
    // Remove old page
    this.pages.splice(index, 1);
    this.stats.totalRecycles++;
    
    // Create replacement
    if (!this.isShuttingDown) {
      await this._createPage();
    }
  }

  /**
   * Start cleanup timer for idle pages
   * @private
   */
  _startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this._cleanupIdlePages();
    }, this.config.idleCleanupInterval);
  }

  /**
   * Clean up pages that have been idle too long
   * @private
   */
  async _cleanupIdlePages() {
    const now = Date.now();
    
    for (const pooledPage of this.pages) {
      if (!pooledPage.inUse && 
          (now - pooledPage.lastUsedAt) > this.config.maxIdleTime &&
          pooledPage.operationCount > 0) {
        console.log(`[PagePool] Recycling idle page #${pooledPage.id}`);
        await this._recyclePage(pooledPage);
      }
    }
  }

  /**
   * Get pool statistics
   * @returns {Object} Pool statistics
   */
  getStats() {
    const availablePages = this.pages.filter(p => !p.inUse).length;
    const busyPages = this.pages.filter(p => p.inUse);
    
    return {
      ...this.stats,
      poolSize: this.config.poolSize,
      currentSize: this.pages.length,
      availablePages,
      busyPages: busyPages.length,
      currentTickers: busyPages.map(p => p.currentTicker).filter(Boolean),
      waitQueueLength: this.waitQueue.length,
      pagesOperations: this.pages.map(p => ({
        id: p.id,
        operations: p.operationCount,
        inUse: p.inUse
      }))
    };
  }

  /**
   * Graceful shutdown
   * @returns {Promise<void>}
   */
  async shutdown() {
    console.log('[PagePool] Shutting down...');
    this.isShuttingDown = true;
    
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    // Reject all waiters
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('PagePool shutting down'));
    }
    this.waitQueue = [];
    
    // Close all pages
    const closePromises = this.pages.map(async (pooledPage) => {
      try {
        await pooledPage.page.close();
      } catch (e) {
        // Ignore close errors during shutdown
      }
    });
    
    await Promise.all(closePromises);
    this.pages = [];
    
    console.log('[PagePool] Shutdown complete');
    this.emit('shutdown');
  }
}

module.exports = PagePool;
```

**Tests Required**:
- `initialize()` - creates correct number of pages
- `acquire()` - returns page when available
- `acquire()` - queues when no pages available
- `acquire()` - times out after acquireTimeout
- `release()` - returns page to pool
- `release()` - recycles page after maxOperations
- `_processWaitQueue()` - fulfills waiting requests
- `shutdown()` - closes all pages, rejects waiters
- Concurrent acquire/release operations
- Memory leak detection (page count stable over time)

---

### Step 7.2: Handle Persistent Pages (Investing.com Pattern)

Some scrapers require **persistent pages** that maintain state across scrape cycles. These pages should NOT go through the page pool.

**Current Pattern**: `scrape_investingcom_watchlists.js` uses `reuseIfUrlMatches` to find and reuse an existing tab that remains open indefinitely.

#### Page Types Comparison

| Type | Examples | Lifecycle | Pool Compatible |
|------|----------|-----------|-----------------|
| **Stateless** | Google, MarketWatch | Create → Use → Close | ✅ Use PagePool |
| **Persistent** | Investing.com | Create once → Reuse indefinitely | ❌ Separate management |

#### When to Use Persistent Pages

The decision to use persistent pages is made **at development time** for each scrape source based on implementation requirements. This is NOT simply based on whether login is required.

**Configuration**: Each scraper source declares its page management strategy:

```javascript
// scrapers/source_config.js

const SOURCE_PAGE_CONFIG = {
  // Persistent page sources
  'investingcom': {
    usePersistentPage: true,
    urlPattern: /investing\.com/,
    reason: 'Maintains session state, tab selection'
  },
  
  // Pool page sources (default)
  'google': {
    usePersistentPage: false,
    reason: 'Stateless price lookup'
  },
  'marketwatch': {
    usePersistentPage: false,
    reason: 'Stateless, no login required'
  },
  'tradingview': {
    usePersistentPage: true,   // Even though login required, may need persistence
    urlPattern: /tradingview\.com/,
    reason: 'Maintains chart state and settings'
  }
};

/**
 * Get page management strategy for a source
 * @param {string} source - Source identifier
 * @returns {Object} Page configuration
 */
function getSourcePageConfig(source) {
  return SOURCE_PAGE_CONFIG[source] || { usePersistentPage: false };
}

module.exports = { SOURCE_PAGE_CONFIG, getSourcePageConfig };
```

#### Design Decision: Separate Persistent Page Registry

**File**: `scrapers/persistent_page_registry.js`

```javascript
/**
 * Persistent Page Registry
 * 
 * Manages long-lived browser pages that maintain state (login sessions,
 * cookies, etc.) across multiple scrape cycles. These pages are NOT
 * part of the page pool and should not be recycled.
 * 
 * Examples: Investing.com (requires login, session persistence)
 * 
 * @module scrapers/persistent_page_registry
 */

class PersistentPageRegistry {
  constructor(browser) {
    this.browser = browser;
    // Map of pattern -> { page, createdAt, lastUsedAt, urlPattern }
    this.pages = new Map();
  }

  /**
   * Get or create a persistent page matching a URL pattern
   * @param {RegExp|string} urlPattern - Pattern to match (e.g., /investing\.com/)
   * @param {Object} options - Page creation options
   * @returns {Promise<Page>} Puppeteer page
   */
  async getOrCreate(urlPattern, options = {}) {
    const patternKey = urlPattern.toString();
    
    // Check if we already have a valid page for this pattern
    if (this.pages.has(patternKey)) {
      const entry = this.pages.get(patternKey);
      
      // Verify page is still open
      try {
        if (!entry.page.isClosed || !entry.page.isClosed()) {
          entry.lastUsedAt = Date.now();
          return entry.page;
        }
      } catch (e) {
        // Page is dead, will create new one
      }
      
      this.pages.delete(patternKey);
    }

    // Search existing browser pages for a match
    const existingPages = await this.browser.pages();
    for (const p of existingPages) {
      try {
        const url = p.url();
        const matches = urlPattern instanceof RegExp 
          ? urlPattern.test(url) 
          : url.includes(urlPattern);
        
        if (matches && (!p.isClosed || !p.isClosed())) {
          this.pages.set(patternKey, {
            page: p,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            urlPattern
          });
          return p;
        }
      } catch (e) {
        // Skip problematic pages
      }
    }

    // Create new page
    const page = await this.browser.newPage();
    
    // Apply options
    if (options.viewport) {
      await page.setViewport(options.viewport);
    }
    if (options.userAgent) {
      await page.setUserAgent(options.userAgent);
    }
    if (options.url) {
      await page.goto(options.url, { 
        waitUntil: options.waitUntil || 'domcontentloaded',
        timeout: options.timeout || 30000
      });
    }

    this.pages.set(patternKey, {
      page,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      urlPattern
    });

    return page;
  }

  /**
   * Check if a persistent page exists for a pattern
   * @param {RegExp|string} urlPattern
   * @returns {boolean}
   */
  has(urlPattern) {
    return this.pages.has(urlPattern.toString());
  }

  /**
   * Get statistics about persistent pages
   * @returns {Object}
   */
  getStats() {
    const stats = {
      count: this.pages.size,
      pages: []
    };

    for (const [key, entry] of this.pages) {
      stats.pages.push({
        pattern: key,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
        ageMs: Date.now() - entry.createdAt,
        idleMs: Date.now() - entry.lastUsedAt
      });
    }

    return stats;
  }

  /**
   * Close all persistent pages (called on browser shutdown)
   */
  async closeAll() {
    for (const [, entry] of this.pages) {
      try {
        await entry.page.close();
      } catch (e) {
        // Ignore
      }
    }
    this.pages.clear();
  }
}

module.exports = PersistentPageRegistry;
```

#### Integration Strategy

```javascript
// In scrape_daemon.js

const PagePool = require('./page_pool');
const PersistentPageRegistry = require('./persistent_page_registry');

let pagePool = null;
let persistentPages = null;

async function initializeScraperInfrastructure(browser) {
  // Page pool for stateless scrapers (Google, MarketWatch, etc.)
  pagePool = new PagePool(browser, { poolSize: 4 });
  await pagePool.initialize();
  
  // Persistent page registry for stateful scrapers (Investing.com)
  persistentPages = new PersistentPageRegistry(browser);
  
  return { pagePool, persistentPages };
}

// Stateless scraper uses pool
async function scrapeGoogleWithPool(ticker) {
  const { page, release } = await pagePool.acquire(ticker);
  try {
    return await scrapeGoogle(null, ticker, page); // Modified to accept page
  } finally {
    await release();
  }
}

// Stateful scraper uses persistent registry (NO changes needed)
// scrape_investingcom_watchlists.js continues to use createPreparedPage
// with reuseIfUrlMatches - the existing pattern still works!
```

#### Key Insight

**The Investing.com scraper doesn't need changes!** 

The existing `createPreparedPage` with `reuseIfUrlMatches` effectively acts as its own persistent page manager. The PagePool is for *new* parallel scraping capabilities, not for replacing the existing Investing.com pattern.

**Scrapers will continue to work as follows**:

| Scraper | Current Approach | With PagePool |
|---------|------------------|---------------|
| `scrape_investingcom_watchlists.js` | `reuseIfUrlMatches` | **No change** - keep using existing pattern |
| `scrape_google.js` | New page each time | **Optionally** use PagePool for parallelism |
| Future parallel scrapers | N/A | Use PagePool |

---

### Step 7.3: Integrate Page Pool with Scrape Daemon

**File**: Modify `scrapers/scrape_daemon.js`

```javascript
// Add import at top
const PagePool = require('./page_pool');

// Add global page pool reference
let pagePool = null;

// Initialize page pool after browser launch
async function initializePagePool(browser) {
  pagePool = new PagePool(browser, {
    poolSize: parseInt(process.env.PAGE_POOL_SIZE || '4', 10),
    acquireTimeout: 30000,
    maxOperationsPerPage: 100
  });
  await pagePool.initialize();
  return pagePool;
}

// Modify scrape functions to use page pool
async function scrapeWithPagePool(scrapeFunction, ticker, ...args) {
  const { page, release, pageId } = await pagePool.acquire(ticker);
  
  try {
    const result = await scrapeFunction(page, ticker, ...args);
    return result;
  } finally {
    await release();
  }
}

// Example: Parallel scraping of multiple tickers
async function scrapeTickersParallel(tickers, scrapeFunction) {
  const results = {};
  const errors = {};
  
  // Process in batches matching pool size
  const batchSize = pagePool.config.poolSize;
  
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (ticker) => {
      try {
        const result = await scrapeWithPagePool(scrapeFunction, ticker);
        results[ticker] = result;
      } catch (error) {
        errors[ticker] = error.message;
      }
    });
    
    await Promise.all(batchPromises);
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < tickers.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  return { results, errors };
}

// Add to health endpoint
// GET /metrics includes page pool stats
function getHealthMetrics() {
  return {
    // ... existing metrics
    pagePool: pagePool ? pagePool.getStats() : null
  };
}

// Add to shutdown handler
async function gracefulShutdown() {
  if (pagePool) {
    await pagePool.shutdown();
  }
  // ... existing shutdown logic
}
```

---

### Step 7.4: Environment Configuration

**File**: Update `docker-compose.yml`

```yaml
services:
  scrapers:
    environment:
      # Page pool configuration
      PAGE_POOL_SIZE: "4"           # Number of concurrent pages
      PAGE_ACQUIRE_TIMEOUT: "30000" # Max wait for page (ms)
      PAGE_MAX_OPERATIONS: "100"    # Recycle page after N operations
```

**File**: Add to `config/config.example.json`

```json
{
  "pagePool": {
    "size": 4,
    "acquireTimeout": 30000,
    "maxOperationsPerPage": 100,
    "navigationTimeout": 30000
  }
}
```

---

### Step 7.5: Unit Tests

**File**: `tests/unit/scrapers/page_pool.test.js`

```javascript
/**
 * Unit Tests for PagePool
 * 
 * Test coverage:
 * - Pool initialization
 * - Page acquisition and release
 * - Wait queue handling
 * - Page recycling
 * - Concurrent operations
 * - Graceful shutdown
 */

const PagePool = require('../../../scrapers/page_pool');

// Mock Puppeteer browser and page
const createMockBrowser = () => ({
  newPage: jest.fn().mockResolvedValue(createMockPage())
});

const createMockPage = () => ({
  setViewport: jest.fn().mockResolvedValue(undefined),
  setDefaultNavigationTimeout: jest.fn(),
  setRequestInterception: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  goto: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined)
});

describe('PagePool', () => {
  let mockBrowser;
  let pool;

  beforeEach(() => {
    mockBrowser = createMockBrowser();
  });

  afterEach(async () => {
    if (pool && pool.isInitialized) {
      await pool.shutdown();
    }
  });

  describe('initialization', () => {
    test('should create configured number of pages', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 4 });
      await pool.initialize();

      expect(mockBrowser.newPage).toHaveBeenCalledTimes(4);
      expect(pool.pages).toHaveLength(4);
    });

    test('should throw if initialized twice', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 2 });
      await pool.initialize();

      await expect(pool.initialize()).rejects.toThrow('already initialized');
    });

    test('should emit initialized event', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 2 });
      const handler = jest.fn();
      pool.on('initialized', handler);

      await pool.initialize();

      expect(handler).toHaveBeenCalledWith({ poolSize: 2 });
    });
  });

  describe('acquire()', () => {
    test('should return page when available', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 2 });
      await pool.initialize();

      const { page, release, pageId } = await pool.acquire('AAPL');

      expect(page).toBeDefined();
      expect(typeof release).toBe('function');
      expect(pageId).toBe(1);
    });

    test('should track current ticker', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 2 });
      await pool.initialize();

      await pool.acquire('AAPL');
      const stats = pool.getStats();

      expect(stats.currentTickers).toContain('AAPL');
    });

    test('should queue when no pages available', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 1, acquireTimeout: 5000 });
      await pool.initialize();

      // Acquire the only page
      const first = await pool.acquire('AAPL');

      // Second acquire should wait
      const acquirePromise = pool.acquire('GOOGL');

      // Release first page
      setTimeout(() => first.release(), 100);

      const second = await acquirePromise;
      expect(second.page).toBeDefined();
    });

    test('should timeout if no page becomes available', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 1, acquireTimeout: 100 });
      await pool.initialize();

      await pool.acquire('AAPL'); // Take the only page

      await expect(pool.acquire('GOOGL')).rejects.toThrow('Timeout');
    });

    test('should throw if pool not initialized', async () => {
      pool = new PagePool(mockBrowser);

      await expect(pool.acquire('AAPL')).rejects.toThrow('not initialized');
    });
  });

  describe('release()', () => {
    test('should mark page as available', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 2 });
      await pool.initialize();

      const { release } = await pool.acquire('AAPL');
      await release();

      const stats = pool.getStats();
      expect(stats.availablePages).toBe(2);
    });

    test('should recycle page after max operations', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 1, maxOperationsPerPage: 2 });
      await pool.initialize();

      const initialPageId = pool.pages[0].id;

      // Use page twice
      let { release } = await pool.acquire('AAPL');
      await release();
      ({ release } = await pool.acquire('GOOGL'));
      await release(); // Should trigger recycle

      // Page should have been recycled (new ID)
      expect(pool.pages[0].id).not.toBe(initialPageId);
    });

    test('should fulfill waiting requests', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 1, acquireTimeout: 5000 });
      await pool.initialize();

      const first = await pool.acquire('AAPL');
      const waitingPromise = pool.acquire('GOOGL');

      await first.release();

      const second = await waitingPromise;
      expect(second.page).toBeDefined();
    });
  });

  describe('getStats()', () => {
    test('should return accurate statistics', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 3 });
      await pool.initialize();

      await pool.acquire('AAPL');
      await pool.acquire('GOOGL');

      const stats = pool.getStats();

      expect(stats.poolSize).toBe(3);
      expect(stats.currentSize).toBe(3);
      expect(stats.availablePages).toBe(1);
      expect(stats.busyPages).toBe(2);
      expect(stats.currentTickers).toEqual(['AAPL', 'GOOGL']);
    });
  });

  describe('shutdown()', () => {
    test('should close all pages', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 2 });
      await pool.initialize();

      const pages = pool.pages.map(p => p.page);
      await pool.shutdown();

      pages.forEach(page => {
        expect(page.close).toHaveBeenCalled();
      });
      expect(pool.pages).toHaveLength(0);
    });

    test('should reject waiting requests', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 1, acquireTimeout: 10000 });
      await pool.initialize();

      await pool.acquire('AAPL');
      const waitingPromise = pool.acquire('GOOGL');

      await pool.shutdown();

      await expect(waitingPromise).rejects.toThrow('shutting down');
    });

    test('should emit shutdown event', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 1 });
      await pool.initialize();

      const handler = jest.fn();
      pool.on('shutdown', handler);

      await pool.shutdown();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('concurrent operations', () => {
    test('should handle many concurrent acquires', async () => {
      pool = new PagePool(mockBrowser, { poolSize: 4, acquireTimeout: 5000 });
      await pool.initialize();

      const tickers = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'META', 'TSLA', 'NVDA', 'AMD'];
      
      const operations = tickers.map(async (ticker) => {
        const { page, release } = await pool.acquire(ticker);
        // Simulate some work
        await new Promise(r => setTimeout(r, 50));
        await release();
        return ticker;
      });

      const results = await Promise.all(operations);

      expect(results).toHaveLength(8);
      expect(pool.stats.totalAcquires).toBe(8);
      expect(pool.stats.totalReleases).toBe(8);
    });
  });
});
```

---

### Step 7.6: Integration Tests

**File**: `tests/integration/page_pool.test.js`

```javascript
/**
 * Integration Tests for PagePool with Real Puppeteer
 * 
 * These tests use real Puppeteer browser instances to verify
 * actual page management behavior.
 */

const puppeteer = require('puppeteer');
const PagePool = require('../../scrapers/page_pool');

describe('PagePool Integration Tests', () => {
  let browser;
  let pool;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  afterEach(async () => {
    if (pool && pool.isInitialized) {
      await pool.shutdown();
    }
  });

  test('should navigate pages concurrently', async () => {
    pool = new PagePool(browser, { poolSize: 3 });
    await pool.initialize();

    const urls = [
      'https://example.com',
      'https://example.org',
      'https://example.net'
    ];

    const results = await Promise.all(urls.map(async (url) => {
      const { page, release } = await pool.acquire(url);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const title = await page.title();
        return { url, title };
      } finally {
        await release();
      }
    }));

    expect(results).toHaveLength(3);
    results.forEach(r => {
      expect(r.title).toBeTruthy();
    });
  });

  test('should handle page crashes gracefully', async () => {
    pool = new PagePool(browser, { poolSize: 2 });
    await pool.initialize();

    const { page, release } = await pool.acquire('test');
    
    // Simulate page crash by navigating to chrome://crash
    // This should be handled gracefully on release
    try {
      await page.goto('chrome://crash');
    } catch (e) {
      // Expected to fail
    }

    // Release should recycle the crashed page
    await release();

    // Pool should still be functional
    const { page: newPage, release: newRelease } = await pool.acquire('test2');
    expect(newPage).toBeDefined();
    await newRelease();
  });
});
```

---

## Phase 8: Add On-Demand Scrape Endpoint

### Objective
Allow dashboard to request price scrape for specific tickers.

### Step 8.1: Add Scrape API Endpoint

**File**: Modify `scrapers/scrape_daemon.js` health server section

```javascript
// Add to health server routes
if (req.url.startsWith('/scrape') && req.method === 'POST') {
  // Parse request body
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { tickers, source } = JSON.parse(body);
      
      if (!tickers || !Array.isArray(tickers)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'tickers array required' }));
        return;
      }

      // Queue scrape request
      const results = await scrapeOnDemand(browser, tickers, source);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  return;
}

/**
 * Scrape specific tickers on demand
 * @param {Browser} browser - Puppeteer browser instance
 * @param {string[]} tickers - Array of ticker symbols
 * @param {string} source - Preferred source (optional)
 * @returns {Promise<Object>} Scrape results
 */
async function scrapeOnDemand(browser, tickers, source = 'yahoo') {
  // NOTE: On-demand scraping is intended for *browser* sources and MUST use
  // the PagePool from Phase 7 for parallel execution.
  // Phase 10 later moves Yahoo to the API-scraper container.
  const results = {};

  // Choose browser scraper by source (default: google)
  const sourceId = (source || 'google').toLowerCase();
  const scrapeBySource = {
    google: scrapeGoogle,
    marketwatch: scrapeMarketWatch,
    // yahoo: scrapeYahoo, // Phase 10 removes Yahoo from browser scraper
  };
  const scrapeFn = scrapeBySource[sourceId];
  if (!scrapeFn) {
    throw new Error(`Unsupported source for on-demand browser scrape: ${sourceId}`);
  }

  // Parallelize using the Phase 7 helper that acquires/releases pages.
  // Assumes scrapeFn signature is updated to: scrapeFn(page, ticker, ...)
  const { results: ok, errors } = await scrapeTickersParallel(
    tickers,
    async (page, ticker) => scrapeFn(page, ticker)
  );

  for (const [ticker, price] of Object.entries(ok)) {
    results[ticker] = { success: true, price, source: sourceId };
  }
  for (const [ticker, message] of Object.entries(errors)) {
    results[ticker] = { success: false, error: message, source: sourceId };
  }

  return results;
}
```

#### Step 8.1.1: Rate Limiting (Per Source)

Rate limiting MUST be enforced **per source** (e.g., `google` rate limits do not consume `marketwatch` limits).

**Scope**: rate limiting applies to `POST /scrape` only.

**Counting rule**: each requested ticker counts as 1 unit against the selected source.

**Recommended policy (defaults)**:

```js
// In scrapers/scrape_daemon.js (health server scope)
const ON_DEMAND_LIMITS = {
  google:      { maxTickersPerMinute: 60, maxConcurrent: 4 },
  marketwatch: { maxTickersPerMinute: 30, maxConcurrent: 2 }
};
```

**Enforcement semantics (must be deterministic):**

- If `tickers.length > maxTickersPerRequest` (optional safety cap, recommended 25) → respond `400` with `{ error: 'too_many_tickers' }`.
- If the source exceeds `maxTickersPerMinute` (by the counting rule) → respond `429`.
- If the source has `activeRequests >= maxConcurrent` → respond `429`.
- The server MUST NOT block/wait for rate limit; it should fail fast with `429`.

**429 response contract**:

```json
{
  "error": "rate_limited",
  "source": "google",
  "retryAfterMs": 12000,
  "limits": { "maxTickersPerMinute": 60, "maxConcurrent": 4 }
}
```

The response MUST also set `Retry-After` (seconds, rounded up).

#### POST /scrape Request/Response Schema (Canonical)

**Request** (`Content-Type: application/json`)

```json
{
  "tickers": ["AAPL", "MSFT"],
  "source": "google"
}
```

Rules:
- `tickers` is required and MUST be an array of strings.
- `source` is optional; defaults to `"google"`.

**Success (200)**

```json
{
  "success": true,
  "results": {
    "AAPL": { "success": true, "price": "187.12", "source": "google" },
    "MSFT": { "success": false, "error": "not found", "source": "google" }
  }
}
```

**Client Errors (400)**

```json
{ "error": "tickers array required" }
```

```json
{ "error": "too_many_tickers" }
```

**Rate Limited (429)**

```json
{
  "error": "rate_limited",
  "source": "google",
  "retryAfterMs": 12000,
  "limits": { "maxTickersPerMinute": 60, "maxConcurrent": 4 }
}
```

**Server Error (500)**

```json
{ "error": "<message>" }
```

**Tests Required**:
- POST /scrape with valid tickers
- POST /scrape with invalid body
- POST /scrape with empty tickers array
- Rate limiting tests (per source):
  - `google` limited does not affect `marketwatch`
  - `429` includes `Retry-After` and `retryAfterMs`
  - counts tickers (N tickers consumes N units)
- Concurrent request handling

---

## Phase 9: Integration Testing & Documentation

### Step 9.1: End-to-End Integration Tests

**File**: `tests/integration/listing_sync_e2e.test.js`

```javascript
/**
 * End-to-End Integration Tests for Listing Sync System
 * 
 * Tests the complete flow:
 * 1. Service starts and initializes
 * 2. CSV download and sync
 * 3. Database population
 * 4. Service queries (exchange_registry, ticker_registry)
 * 5. On-demand sync via API
 */

describe('Listing Sync E2E Tests', () => {
  describe('Full Sync Flow', () => {
    test('should download CSVs, sync to DB, and serve queries', async () => {
      // REQUIRED (non-negotiable) E2E steps:
      // 1) Start dependencies (MySQL required). In CI: docker compose up -d mysql
      // 2) Start listing_sync_service on a test port (or import the module and start in-process)
      // 3) Trigger sync via HTTP: POST /sync/all
      // 4) Assert HTTP: /health 200, /status shows last sync ok
      // 5) Assert DB: ticker_registry row count > 0; exchange registry tables row count > 0
    });
  });

  describe('Dashboard Integration', () => {
    test('should provide ticker autocomplete from DB', async () => {
      // Test autocomplete endpoint with DB-backed data
    });

    test('should handle on-demand ticker sync', async () => {
      // Test POST /sync/tickers endpoint
    });
  });

  describe('Scrape Daemon Integration', () => {
    test('should provide exchange info for scraper', async () => {
      // Test getExchange() with DB-backed data
    });

    test('should handle on-demand scrape requests', async () => {
      // Test POST /scrape endpoint
      // - 200 response contains per-ticker success/error
      // - respects per-source rate limiting (429) and includes Retry-After
    });
  });
});
```

### Step 9.2: Documentation Updates

**Files to Update/Create**:

1. `docs/LISTING_SYNC_SERVICE.md` - Full service documentation
2. `docs/API_REFERENCE.md` - API endpoint documentation
3. `README.md` - Update architecture section
4. Code comments throughout all new/modified files

### Step 9.3: PM2/Docker Configuration

**File**: Update `ecosystem.config.json`

```json
{
  "apps": [
    {
      "name": "listing-sync",
      "script": "services/listing-sync/listing_sync_service.js",
      "instances": 1,
      "autorestart": true,
      "watch": false,
      "env": {
        "NODE_ENV": "production",
        "HTTP_PORT": "3010",
        "ENABLE_AUTO_SYNC": "true",
        "SYNC_INTERVAL": "1440"
      }
    }
  ]
}
```

**File**: Update `docker-compose.yml`

```yaml
services:
  listing-sync:
    build:
      context: .
      dockerfile: docker/Dockerfile.listing-sync
    environment:
      - DB_HOST=mysql
      - HTTP_PORT=3010
      - CONFIG_DIR=/app/config
    volumes:
      - ./config:/app/config
    ports:
      - "3010:3010"
    depends_on:
      - mysql
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3010/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## Phase 10: Separate API Scrapers from Browser Scrapers

### Objective
Separate non-browser API-based scrapers (yahoo-finance2, Treasury Direct API) from browser-based scrapers (Google Finance, MarketWatch) to reduce resource usage and enable independent scaling.

### Current Problem Analysis

| Scraper | Browser Required | Current Container | Actual Need |
|---------|------------------|-------------------|-------------|
| `scrape_yahoo.js` | ❌ NO | 8GB (Chrome) | 256MB (Node only) |
| `scrape_google.js` | ✅ YES | 8GB (Chrome) | 8GB (Chrome) |
| `scrape_marketwatch.js` | ✅ YES | 8GB (Chrome) | 8GB (Chrome) |

**Problem**: `scrape_yahoo.js` uses the `yahoo-finance2` npm package which is a pure REST API client. It accepts a `browser` parameter but never uses it. This wastes resources and creates unnecessary coupling.

### Target Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│              BROWSER SCRAPER CONTAINER (8GB)                      │
│                   scrape_daemon.js                                │
│  ┌─────────────────┐  ┌─────────────────┐                        │
│  │ scrape_google.js │  │scrape_marketwatch│                       │
│  │   (Puppeteer)   │  │   (Puppeteer)    │                       │
│  └────────┬────────┘  └────────┬────────┘                        │
│           └────────┬───────────┘                                  │
│                    ▼                                              │
│              Page Pool (4-8 pages)                                │
│                    │                                              │
│                    ▼                                              │
│              Kafka: price_data                                    │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│              API SCRAPER CONTAINER (256MB)                        │
│                   api_scrape_daemon.js                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │  yahoo_api.js   │  │ treasury_api.js │  │  alpha_api.js   │   │
│  │ (yahoo-finance2)│  │(Treasury Direct)│  │ (Alpha Vantage) │   │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘   │
│           └────────────────────┴────────────────────┘             │
│                              │                                    │
│                    Concurrent HTTP Requests                       │
│                     (50+ parallel calls)                          │
│                              │                                    │
│                              ▼                                    │
│                    Kafka: price_data                              │
└──────────────────────────────────────────────────────────────────┘
```

### Step 10.1: Create API Scraper Service Directory

**File Structure**:
```
services/
  api-scraper/
    index.js                    # Main entry point / daemon
    yahoo_api_client.js         # Yahoo Finance API client
    treasury_api_client.js      # Treasury Direct API client
    base_api_client.js          # Base class for API clients
    rate_limiter.js             # Shared rate limiting logic
    config.js                   # Configuration
    package.json                # Minimal dependencies (no Puppeteer)
```

---

### Step 10.2: Create Base API Client Class

**File**: `services/api-scraper/base_api_client.js`

```javascript
/**
 * Base API Client
 * 
 * Abstract base class for all API-based price scrapers.
 * Provides common functionality for rate limiting, retries,
 * error handling, and Kafka publishing.
 * 
 * @module api-scraper/base_api_client
 */

const { publishToKafka } = require('../../scrapers/publish_to_kafka');

/**
 * Default configuration for API clients
 * @constant {Object}
 */
const DEFAULT_CONFIG = {
  // Rate limiting
  maxRequestsPerMinute: 60,
  maxConcurrent: 10,
  
  // Retry settings
  maxRetries: 3,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 2,
  
  // Timeout
  requestTimeoutMs: 30000,
  
  // Kafka
  kafkaTopic: 'price_data'
};

class BaseApiClient {
  /**
   * Create a new API client instance
   * @param {string} sourceName - Name of the data source (e.g., 'yahoo', 'treasury')
   * @param {Object} options - Configuration options
   */
  constructor(sourceName, options = {}) {
    this.sourceName = sourceName;
    this.config = { ...DEFAULT_CONFIG, ...options };
    
    // Rate limiting state
    this.requestQueue = [];
    this.activeRequests = 0;
    this.requestsThisMinute = 0;
    this.minuteResetTimer = null;
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalRetries: 0,
      avgResponseTimeMs: 0
    };
    
    this._startMinuteReset();
  }

  /**
   * Fetch quote for a single ticker
   * @abstract
   * @param {string} ticker - Ticker symbol
   * @returns {Promise<Object>} Quote data
   */
  async fetchQuote(ticker) {
    throw new Error('fetchQuote must be implemented by subclass');
  }

  /**
   * Fetch quotes for multiple tickers (batch)
   * @param {string[]} tickers - Array of ticker symbols
   * @returns {Promise<Object>} Map of ticker -> quote data
   */
  async fetchQuotes(tickers) {
    const results = {};
    const errors = {};

    // Process with concurrency limit
    const chunks = this._chunkArray(tickers, this.config.maxConcurrent);
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (ticker) => {
        try {
          const quote = await this._executeWithRateLimit(() => 
            this._executeWithRetry(() => this.fetchQuote(ticker))
          );
          results[ticker] = quote;
        } catch (error) {
          errors[ticker] = error.message;
          this.stats.failedRequests++;
        }
      });
      
      await Promise.all(promises);
    }

    return { results, errors };
  }

  /**
   * Fetch and publish quotes to Kafka
   * @param {Object[]} securities - Array of security objects with ticker info
   * @returns {Promise<Object>} Results summary
   */
  async fetchAndPublish(securities) {
    const startTime = Date.now();
    const results = { success: 0, failed: 0, errors: [] };

    for (const security of securities) {
      try {
        const ticker = this._getTickerFromSecurity(security);
        if (!ticker) continue;

        const quote = await this._executeWithRateLimit(() =>
          this._executeWithRetry(() => this.fetchQuote(ticker))
        );

        if (quote) {
          const data = this._mapQuoteToData(quote, security.key);
          await publishToKafka(data, this.config.kafkaTopic);
          results.success++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push({ ticker: security.key, error: error.message });
      }
    }

    results.durationMs = Date.now() - startTime;
    return results;
  }

  /**
   * Map API quote response to standardized data format
   * @abstract
   * @param {Object} quote - Raw quote from API
   * @param {string} securityKey - Security identifier
   * @returns {Object} Standardized price data
   */
  _mapQuoteToData(quote, securityKey) {
    throw new Error('_mapQuoteToData must be implemented by subclass');
  }

  /**
   * Get ticker from security object
   * @abstract
   * @param {Object} security - Security object
   * @returns {string|null} Ticker symbol
   */
  _getTickerFromSecurity(security) {
    throw new Error('_getTickerFromSecurity must be implemented by subclass');
  }

  /**
   * Execute function with rate limiting
   * @private
   */
  async _executeWithRateLimit(fn) {
    // Wait if at concurrent limit
    while (this.activeRequests >= this.config.maxConcurrent) {
      await new Promise(r => setTimeout(r, 100));
    }

    // Wait if at rate limit
    while (this.requestsThisMinute >= this.config.maxRequestsPerMinute) {
      await new Promise(r => setTimeout(r, 100));
    }

    this.activeRequests++;
    this.requestsThisMinute++;
    this.stats.totalRequests++;

    try {
      const startTime = Date.now();
      const result = await fn();
      
      // Update avg response time
      const responseTime = Date.now() - startTime;
      this.stats.avgResponseTimeMs = 
        (this.stats.avgResponseTimeMs * (this.stats.successfulRequests) + responseTime) / 
        (this.stats.successfulRequests + 1);
      this.stats.successfulRequests++;
      
      return result;
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Execute function with retry logic
   * @private
   */
  async _executeWithRetry(fn, attempt = 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= this.config.maxRetries) {
        throw error;
      }

      this.stats.totalRetries++;
      const delay = this.config.retryDelayMs * 
        Math.pow(this.config.retryBackoffMultiplier, attempt - 1);
      
      await new Promise(r => setTimeout(r, delay));
      return this._executeWithRetry(fn, attempt + 1);
    }
  }

  /**
   * Start minute reset timer for rate limiting
   * @private
   */
  _startMinuteReset() {
    this.minuteResetTimer = setInterval(() => {
      this.requestsThisMinute = 0;
    }, 60000);
  }

  /**
   * Chunk array into smaller arrays
   * @private
   */
  _chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get client statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      source: this.sourceName,
      activeRequests: this.activeRequests,
      requestsThisMinute: this.requestsThisMinute,
      config: {
        maxRequestsPerMinute: this.config.maxRequestsPerMinute,
        maxConcurrent: this.config.maxConcurrent
      }
    };
  }

  /**
   * Shutdown client
   */
  shutdown() {
    if (this.minuteResetTimer) {
      clearInterval(this.minuteResetTimer);
    }
  }
}

module.exports = BaseApiClient;
```

---

### Step 10.3: Create Yahoo API Client

**File**: `services/api-scraper/yahoo_api_client.js`

```javascript
/**
 * Yahoo Finance API Client
 * 
 * Fetches stock/ETF price data using the yahoo-finance2 npm package.
 * This is a pure API client - no browser required.
 * 
 * @module api-scraper/yahoo_api_client
 */

const BaseApiClient = require('./base_api_client');
const { sanitizeForFilename, normalizedKey, logDebug } = require('../../scrapers/scraper_utils');

// Yahoo module loader (handles ESM/CJS compatibility)
let _yahooModule = null;

/**
 * Initialize yahoo-finance2 module
 * @returns {Promise<Object>} Yahoo finance module
 */
async function ensureYahoo() {
  if (_yahooModule) return _yahooModule;

  function isClass(fn) {
    if (typeof fn !== 'function') return false;
    return /^class\s/.test(Function.prototype.toString.call(fn));
  }

  try {
    const req = require('yahoo-finance2');
    _yahooModule = (req && req.default) ? req.default : req;
    
    if (typeof _yahooModule === 'function' && isClass(_yahooModule)) {
      _yahooModule = new _yahooModule();
    }
    
    return _yahooModule;
  } catch (err) {
    const imported = await import('yahoo-finance2');
    _yahooModule = (imported && imported.default) ? imported.default : imported;
    
    if (typeof _yahooModule === 'function' && isClass(_yahooModule)) {
      _yahooModule = new _yahooModule();
    }
    
    return _yahooModule;
  }
}

/**
 * Convert epoch seconds to milliseconds
 * @param {number|Object} val - Epoch value or Date object
 * @returns {number|null} Milliseconds or null
 */
function epochToMs(val) {
  if (!val) return null;
  if (typeof val === 'object' && val.getTime) return val.getTime();
  if (typeof val === 'number') return val < 1e12 ? val * 1000 : val;
  return null;
}

class YahooApiClient extends BaseApiClient {
  /**
   * Create a new Yahoo API client
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    super('yahoo', {
      maxRequestsPerMinute: 100, // Yahoo is fairly generous
      maxConcurrent: 10,
      ...options
    });
    
    this.yahoo = null;
  }

  /**
   * Initialize the Yahoo module
   * @returns {Promise<void>}
   */
  async initialize() {
    this.yahoo = await ensureYahoo();
    logDebug('[YahooApiClient] Initialized yahoo-finance2 module');
  }

  /**
   * Fetch quote for a single ticker
   * @param {string} ticker - Ticker symbol
   * @returns {Promise<Object>} Quote data
   */
  async fetchQuote(ticker) {
    if (!this.yahoo) {
      await this.initialize();
    }

    const quote = await this.yahoo.quote(ticker);
    
    if (!quote) {
      throw new Error(`No quote data returned for ${ticker}`);
    }

    return quote;
  }

  /**
   * Fetch quotes for multiple tickers using batch API
   * @param {string[]} tickers - Array of ticker symbols
   * @returns {Promise<Object>} Map of ticker -> quote data
   */
  async fetchQuotesBatch(tickers) {
    if (!this.yahoo) {
      await this.initialize();
    }

    const results = {};
    const errors = {};

    // yahoo-finance2 quote() can accept an array
    try {
      const quotes = await this.yahoo.quote(tickers);
      
      // Handle array or single result
      const quotesArray = Array.isArray(quotes) ? quotes : [quotes];
      
      for (const quote of quotesArray) {
        if (quote && quote.symbol) {
          results[quote.symbol] = quote;
        }
      }
    } catch (error) {
      // Fall back to individual requests
      logDebug(`[YahooApiClient] Batch failed, falling back to individual: ${error.message}`);
      return super.fetchQuotes(tickers);
    }

    // Check for missing tickers
    for (const ticker of tickers) {
      if (!results[ticker] && !results[ticker.toUpperCase()]) {
        errors[ticker] = 'Not found in batch response';
      }
    }

    return { results, errors };
  }

  /**
   * Map Yahoo quote to standardized data format
   * @param {Object} quote - Raw quote from Yahoo API
   * @param {string} securityKey - Security identifier
   * @returns {Object} Standardized price data
   */
  _mapQuoteToData(quote, securityKey) {
    const p = quote.price || quote || {};
    const qm = epochToMs(p.regularMarketTime);
    const afterHoursQuoteTime = epochToMs(p.postMarketTime);
    const preMarketQuoteTime = epochToMs(p.preMarketTime);

    return {
      key: sanitizeForFilename(securityKey),
      normalized_key: normalizedKey(securityKey),
      regular_price: (p.regularMarketPrice != null) ? String(p.regularMarketPrice) : '',
      regular_change_decimal: (p.regularMarketChange != null) ? String(p.regularMarketChange) : '',
      regular_change_percent: (p.regularMarketChangePercent != null) ? (String(p.regularMarketChangePercent) + '%') : '',
      regular_time: qm ? new Date(qm).toISOString() : '',
      previous_close_price: (p.regularMarketPreviousClose != null) ? String(p.regularMarketPreviousClose) : '',
      after_hours_price: (p.postMarketPrice != null) ? String(p.postMarketPrice) : '',
      after_hours_change_decimal: (p.postMarketChange != null) ? String(p.postMarketChange) : '',
      after_hours_change_percent: (p.postMarketChangePercent != null) ? (String(p.postMarketChangePercent) + '%') : '',
      after_hours_time: afterHoursQuoteTime ? new Date(afterHoursQuoteTime).toISOString() : '',
      pre_market_price: (p.preMarketPrice != null) ? String(p.preMarketPrice) : '',
      pre_market_price_change_decimal: (p.preMarketChange != null) ? String(p.preMarketChange) : '',
      pre_market_price_change_percent: (p.preMarketChangePercent != null) ? (String(p.preMarketChangePercent) + '%') : '',
      pre_market_quote_time: preMarketQuoteTime ? new Date(preMarketQuoteTime).toISOString() : '',
      source: 'yahoo',
      capture_time: new Date().toISOString()
    };
  }

  /**
   * Get ticker from security object
   * @param {Object} security - Security object
   * @returns {string|null} Yahoo ticker
   */
  _getTickerFromSecurity(security) {
    return security.ticker_yahoo || security.ticker || null;
  }
}

module.exports = YahooApiClient;
```

---

### Step 10.4: Create Treasury API Client

**File**: `services/api-scraper/treasury_api_client.js`

```javascript
/**
 * Treasury Direct API Client
 * 
 * Fetches treasury security data from the Treasury Direct API.
 * This is a pure API client - no browser required.
 * 
 * @module api-scraper/treasury_api_client
 */

const BaseApiClient = require('./base_api_client');
const https = require('https');
const { sanitizeForFilename, normalizedKey, logDebug } = require('../../scrapers/scraper_utils');

/**
 * Treasury Direct API endpoints
 * @constant {Object}
 */
const TREASURY_ENDPOINTS = {
  auctioned: 'https://www.treasurydirect.gov/TA_WS/securities/auctioned',
  search: 'https://www.treasurydirect.gov/TA_WS/securities/search'
};

class TreasuryApiClient extends BaseApiClient {
  /**
   * Create a new Treasury API client
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    super('treasury', {
      maxRequestsPerMinute: 30, // Treasury has stricter limits
      maxConcurrent: 5,
      ...options
    });
  }

  /**
   * Fetch treasury security by CUSIP
   * @param {string} cusip - CUSIP identifier
   * @returns {Promise<Object>} Security data
   */
  async fetchQuote(cusip) {
    const url = `${TREASURY_ENDPOINTS.search}?cusip=${cusip}&format=json`;
    
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: this.config.requestTimeoutMs }, (res) => {
        let data = '';
        
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json && json.length > 0) {
              resolve(json[0]);
            } else {
              reject(new Error(`No treasury data for CUSIP ${cusip}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse treasury response: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Fetch all recently auctioned securities
   * @returns {Promise<Object[]>} Array of security data
   */
  async fetchAuctioned() {
    const url = `${TREASURY_ENDPOINTS.auctioned}?format=json`;
    
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: this.config.requestTimeoutMs }, (res) => {
        let data = '';
        
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(Array.isArray(json) ? json : []);
          } catch (e) {
            reject(new Error(`Failed to parse auctioned response: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Map Treasury quote to standardized data format
   * @param {Object} quote - Raw quote from Treasury API
   * @param {string} securityKey - Security identifier
   * @returns {Object} Standardized price data
   */
  _mapQuoteToData(quote, securityKey) {
    return {
      key: sanitizeForFilename(securityKey),
      normalized_key: normalizedKey(securityKey),
      regular_price: quote.pricePer100 ? String(quote.pricePer100) : '',
      regular_change_decimal: '',
      regular_change_percent: '',
      regular_time: quote.auctionDate ? new Date(quote.auctionDate).toISOString() : '',
      previous_close_price: '',
      yield: quote.highYield ? String(quote.highYield) : '',
      maturity_date: quote.maturityDate || '',
      issue_date: quote.issueDate || '',
      security_type: quote.securityType || '',
      security_term: quote.securityTerm || '',
      source: 'treasury',
      capture_time: new Date().toISOString()
    };
  }

  /**
   * Get ticker from security object
   * @param {Object} security - Security object
   * @returns {string|null} CUSIP
   */
  _getTickerFromSecurity(security) {
    return security.cusip || security.ticker || null;
  }
}

module.exports = TreasuryApiClient;
```

---

### Step 10.5: Create API Scraper Daemon

**File**: `services/api-scraper/index.js`

```javascript
/**
 * API Scraper Daemon
 * 
 * Lightweight service that fetches price data from REST APIs.
 * No browser required - runs in a small container.
 * 
 * @module api-scraper
 */

const http = require('http');
const mysql = require('mysql2/promise');
const YahooApiClient = require('./yahoo_api_client');
const TreasuryApiClient = require('./treasury_api_client');

/**
 * Default configuration
 * @constant {Object}
 */
const CONFIG = {
  httpPort: parseInt(process.env.API_SCRAPER_PORT || '3020', 10),
  
  // Scrape intervals (minutes)
  yahooInterval: parseInt(process.env.YAHOO_INTERVAL || '15', 10),
  treasuryInterval: parseInt(process.env.TREASURY_INTERVAL || '1440', 10), // Daily
  
  // Database
  dbHost: process.env.DB_HOST || 'mysql',
  dbPort: parseInt(process.env.DB_PORT || '3306', 10),
  dbName: process.env.DB_NAME || 'wealth_tracker',
  dbUser: process.env.DB_USER || 'root',
  dbPassword: process.env.DB_PASSWORD || ''
};

class ApiScraperDaemon {
  constructor() {
    this.yahooClient = new YahooApiClient();
    this.treasuryClient = new TreasuryApiClient();
    this.dbPool = null;
    this.httpServer = null;
    this.timers = {};
    this.isRunning = false;
    this.startTime = Date.now();
  }

  /**
   * Initialize the daemon
   * @returns {Promise<void>}
   */
  async initialize() {
    // Create database connection
    this.dbPool = await mysql.createPool({
      host: CONFIG.dbHost,
      port: CONFIG.dbPort,
      user: CONFIG.dbUser,
      password: CONFIG.dbPassword,
      database: CONFIG.dbName,
      waitForConnections: true,
      connectionLimit: 5
    });

    // Initialize API clients
    await this.yahooClient.initialize();

    // Start HTTP server
    this._startHttpServer();

    // Start scrape timers
    this._startScrapeCycles();

    this.isRunning = true;
    console.log(`[ApiScraperDaemon] Started on port ${CONFIG.httpPort}`);
  }

  /**
   * Start HTTP server for health checks and on-demand requests
   * @private
   */
  _startHttpServer() {
    this.httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${CONFIG.httpPort}`);
      
      res.setHeader('Content-Type', 'application/json');

      try {
        if (url.pathname === '/health') {
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            uptime: Date.now() - this.startTime,
            isRunning: this.isRunning
          }));
        } else if (url.pathname === '/metrics') {
          res.writeHead(200);
          res.end(JSON.stringify({
            yahoo: this.yahooClient.getStats(),
            treasury: this.treasuryClient.getStats()
          }));
        } else if (url.pathname === '/scrape/yahoo' && req.method === 'POST') {
          const body = await this._parseBody(req);
          const results = await this._scrapeYahooOnDemand(body.tickers);
          res.writeHead(200);
          res.end(JSON.stringify(results));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });

    this.httpServer.listen(CONFIG.httpPort);
  }

  /**
   * Start scheduled scrape cycles
   * @private
   */
  _startScrapeCycles() {
    // Yahoo scrape cycle
    this.timers.yahoo = setInterval(async () => {
      try {
        await this._runYahooCycle();
      } catch (error) {
        console.error('[ApiScraperDaemon] Yahoo cycle error:', error);
      }
    }, CONFIG.yahooInterval * 60 * 1000);

    // Treasury scrape cycle  
    this.timers.treasury = setInterval(async () => {
      try {
        await this._runTreasuryCycle();
      } catch (error) {
        console.error('[ApiScraperDaemon] Treasury cycle error:', error);
      }
    }, CONFIG.treasuryInterval * 60 * 1000);

    // Run initial cycles
    this._runYahooCycle().catch(console.error);
  }

  /**
   * Run Yahoo scrape cycle
   * @private
   */
  async _runYahooCycle() {
    console.log('[ApiScraperDaemon] Starting Yahoo cycle...');
    
    // Get positions from database
    const conn = await this.dbPool.getConnection();
    try {
      const [rows] = await conn.execute(`
        SELECT ticker, ticker_yahoo, key_name as \`key\`
        FROM positions
        WHERE asset_type IN ('stock', 'etf')
          AND ticker_yahoo IS NOT NULL
      `);

      if (rows.length === 0) {
        console.log('[ApiScraperDaemon] No positions to scrape');
        return;
      }

      const results = await this.yahooClient.fetchAndPublish(rows);
      console.log(`[ApiScraperDaemon] Yahoo cycle complete: ${results.success} success, ${results.failed} failed`);
    } finally {
      conn.release();
    }
  }

  /**
   * Scrape Yahoo on demand
   * @private
   */
  async _scrapeYahooOnDemand(tickers) {
    if (!tickers || !Array.isArray(tickers)) {
      throw new Error('tickers array required');
    }

    const securities = tickers.map(t => ({
      ticker: t,
      ticker_yahoo: t,
      key: t
    }));

    return this.yahooClient.fetchAndPublish(securities);
  }

  /**
   * Parse request body
   * @private
   */
  async _parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (e) {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Graceful shutdown
   * @returns {Promise<void>}
   */
  async shutdown() {
    console.log('[ApiScraperDaemon] Shutting down...');
    this.isRunning = false;

    // Clear timers
    for (const timer of Object.values(this.timers)) {
      clearInterval(timer);
    }

    // Shutdown clients
    this.yahooClient.shutdown();
    this.treasuryClient.shutdown();

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
    }

    // Close database pool
    if (this.dbPool) {
      await this.dbPool.end();
    }

    console.log('[ApiScraperDaemon] Shutdown complete');
  }
}

// Main entry point
if (require.main === module) {
  const daemon = new ApiScraperDaemon();
  
  process.on('SIGTERM', async () => {
    await daemon.shutdown();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    await daemon.shutdown();
    process.exit(0);
  });

  daemon.initialize().catch(error => {
    console.error('[ApiScraperDaemon] Failed to start:', error);
    process.exit(1);
  });
}

module.exports = ApiScraperDaemon;
```

---

### Step 10.6: Create Lightweight Dockerfile

**File**: `docker/Dockerfile.api-scraper`

```dockerfile
# API Scraper Dockerfile
# Lightweight container for REST API-based scrapers
# No Chrome/Puppeteer required

FROM node:18-alpine

# Install only essential build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies
# Exclude puppeteer and chrome-related packages
RUN npm ci --production --ignore-scripts \
    && npm prune --production \
    && rm -rf /root/.npm /tmp/*

# Copy source files
COPY services/api-scraper/ ./services/api-scraper/
COPY scrapers/publish_to_kafka.js ./scrapers/
COPY scrapers/scraper_utils.js ./scrapers/

# Create non-root user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 -G nodejs \
    && chown -R nodejs:nodejs /app

USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3020/health || exit 1

EXPOSE 3020

CMD ["node", "services/api-scraper/index.js"]
```

---

### Step 10.7: Update Docker Compose

**File**: Add to `docker-compose.yml`

```yaml
  api-scraper:
    build:
      context: .
      dockerfile: docker/Dockerfile.api-scraper
    container_name: api-scraper
    restart: unless-stopped
    depends_on:
      - kafka
      - mysql
    environment:
      KAFKA_BROKERS: kafka:9092
      KAFKA_TOPIC: price_data
      DB_HOST: mysql
      DB_PORT: 3306
      DB_NAME: ${MYSQL_DATABASE}
      DB_USER: ${MYSQL_USER}
      DB_PASSWORD: ${MYSQL_PASSWORD}
      API_SCRAPER_PORT: 3020
      YAHOO_INTERVAL: 15
    volumes:
      - ./logs:/app/logs
    ports:
      - "3020:3020"
    deploy:
      resources:
        limits:
          memory: 256m   # Much smaller than 8GB browser container!
```

---

### Step 10.8: Remove Yahoo from Browser Scraper

**File**: Modify `scrapers/scrape_daemon.js`

Remove the Yahoo batch section (lines ~626-680) and remove the import:

```javascript
// REMOVE: const { scrapeYahoo, scrapeYahooBatch } = require('./scrape_yahoo');

// REMOVE: yahoo_batch scrape group entirely
// The api-scraper container now handles Yahoo
```

---

### Step 10.9: Unit Tests

**File**: `tests/unit/services/api-scraper/yahoo_api_client.test.js`

```javascript
/**
 * Unit Tests for YahooApiClient
 */

const YahooApiClient = require('../../../../services/api-scraper/yahoo_api_client');

// Mock yahoo-finance2
jest.mock('yahoo-finance2', () => ({
  default: class MockYahoo {
    async quote(ticker) {
      if (ticker === 'INVALID') throw new Error('Not found');
      return {
        symbol: ticker,
        regularMarketPrice: 150.25,
        regularMarketChange: 2.50,
        regularMarketChangePercent: 1.69,
        regularMarketTime: new Date(),
        regularMarketPreviousClose: 147.75
      };
    }
  }
}));

describe('YahooApiClient', () => {
  let client;

  beforeEach(() => {
    client = new YahooApiClient();
  });

  afterEach(() => {
    client.shutdown();
  });

  describe('fetchQuote()', () => {
    test('should fetch quote for valid ticker', async () => {
      await client.initialize();
      const quote = await client.fetchQuote('AAPL');
      
      expect(quote.symbol).toBe('AAPL');
      expect(quote.regularMarketPrice).toBe(150.25);
    });

    test('should throw for invalid ticker', async () => {
      await client.initialize();
      await expect(client.fetchQuote('INVALID')).rejects.toThrow('Not found');
    });
  });

  describe('_mapQuoteToData()', () => {
    test('should map quote to standardized format', () => {
      const quote = {
        regularMarketPrice: 150.25,
        regularMarketChange: 2.50,
        regularMarketChangePercent: 1.69,
        regularMarketTime: new Date('2025-01-15T16:00:00Z'),
        regularMarketPreviousClose: 147.75
      };

      const data = client._mapQuoteToData(quote, 'AAPL');

      expect(data.key).toBe('AAPL');
      expect(data.regular_price).toBe('150.25');
      expect(data.regular_change_decimal).toBe('2.5');
      expect(data.source).toBe('yahoo');
    });
  });

  describe('rate limiting', () => {
    test('should track requests per minute', async () => {
      await client.initialize();
      
      await client.fetchQuote('AAPL');
      await client.fetchQuote('GOOGL');
      
      const stats = client.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.successfulRequests).toBe(2);
    });
  });
});
```

---

### Step 10.10: Integration Tests

**File**: `tests/integration/api_scraper.test.js`

```javascript
/**
 * Integration Tests for API Scraper
 */

const ApiScraperDaemon = require('../../services/api-scraper');

describe('ApiScraperDaemon Integration Tests', () => {
  let daemon;

  beforeAll(async () => {
    daemon = new ApiScraperDaemon();
    // Don't initialize - would require real DB
  });

  afterAll(async () => {
    if (daemon) {
      await daemon.shutdown();
    }
  });

  describe('HTTP API', () => {
    test('should respond to health check', async () => {
      // Mock test
    });

    test('should return metrics', async () => {
      // Mock test
    });

    test('should handle on-demand scrape', async () => {
      // Mock test
    });
  });
});
```

---

## Phase 11: Extensible Watchlist Management API

### Objective

Enable the dashboard to trigger add/delete operations on external website watchlists (starting with Investing.com) via persistent browser pages that maintain login state. The design supports future expansion to other watchlist providers.

### Supported Asset Types by Provider

| Provider | Stocks | ETFs | Bonds | Treasuries | Crypto | Notes |
|----------|--------|------|-------|------------|--------|-------|
| **Investing.com** | ✅ | ✅ | ❌ | ❌ | ❌ | Limited to equities |
| *Future: TradingView* | ✅ | ✅ | ✅ | ✅ | ✅ | Full support |

---

### Step 11.0: Watchlist Provider Configuration

#### Current Problem

The current `config.json` approach has several issues:

```json
// Current structure in config.json
{
  "investing_watchlists": {
    "url": "https://www.investing.com/portfolio/?portfolioID=...",  // User-specific!
    "watchlists": [
      { "key": "primary", "interval": 2 },
      { "key": "secondary", "interval": 5 }
    ]
  }
}
```

**Issues:**
1. **Single URL shared by all tabs** - But each watchlist tab may have its own unique URL
2. **User-specific portfolio IDs in config** - Should not be in version-controlled files
3. **Credentials split** - URL in config.json, email/password in .env
4. **No asset type mapping** - Can't specify which watchlists track stocks vs ETFs
5. **Mixed concerns** - Scraping intervals mixed with provider configuration

#### Recommended Solution: Database-Backed Configuration

Store watchlist provider configurations in the database with a dedicated table:

**Schema**: `watchlist_providers` table

```sql
CREATE TABLE watchlist_providers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_id VARCHAR(50) NOT NULL,           -- 'investingcom', 'tradingview', 'marketwatch'
    display_name VARCHAR(100) NOT NULL,         -- 'Investing.com', 'TradingView'
    enabled TINYINT(1) DEFAULT 1,
    
    -- Authentication (encrypted or reference to secrets manager)
    auth_method ENUM('credentials', 'cookie', 'oauth', 'none') DEFAULT 'credentials',
    
    -- Default scrape settings
    default_interval_seconds INT DEFAULT 300,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY idx_provider_id (provider_id)
);

CREATE TABLE watchlist_instances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_id INT NOT NULL,                   -- FK to watchlist_providers.id
    
    -- Watchlist identification
    watchlist_key VARCHAR(100) NOT NULL,        -- 'primary', 'tech-stocks', etc.
    watchlist_name VARCHAR(200),                -- Display name
    watchlist_url VARCHAR(500) NOT NULL,        -- Full URL including portfolio ID
    
    -- Asset type constraints for this watchlist
    allowed_asset_types JSON,                   -- ["stock", "etf"] or null for all
    
    -- Scrape settings (override provider defaults)
    interval_seconds INT,                       -- null = use provider default
    enabled TINYINT(1) DEFAULT 1,
    
    -- Metadata
    last_scraped_at TIMESTAMP NULL,
    ticker_count INT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY idx_provider_watchlist (provider_id, watchlist_key),
    INDEX idx_enabled (enabled),
    FOREIGN KEY (provider_id) REFERENCES watchlist_providers(id) ON DELETE CASCADE
);

-- Update windows for time-based scraping control
CREATE TABLE update_windows (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Scope: can apply to provider, watchlist instance, or specific ticker
    provider_id VARCHAR(50),                    -- null = applies to all providers
    watchlist_key VARCHAR(100),                 -- null = applies to all watchlists in provider
    ticker VARCHAR(20),                         -- null = applies to all tickers (use 'default' for fallback)
    
    -- Time window definition
    days JSON NOT NULL,                         -- ["mon", "tue", "wed", "thu", "fri"]
    start_time TIME NOT NULL,                   -- '09:30:00'
    end_time TIME NOT NULL,                     -- '16:00:00'
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    
    -- Control
    enabled TINYINT(1) DEFAULT 1,
    priority INT DEFAULT 0,                     -- Higher priority wins on conflict
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_provider (provider_id),
    INDEX idx_ticker (ticker)
);
```

#### Scheduling & Update Windows

The proposed plan preserves and extends the existing scheduling infrastructure:

##### Integration with Existing `scrape_groups` System

Watchlist scrapers **MUST** integrate with the existing `getScrapeGroupSettings()`/`shouldRunTask()` pattern:

```javascript
// In watchlist scraper initialization
const { getScrapeGroupSettings, shouldRunTask } = require('./scrape_daemon');

async function runWatchlistScrape(providerId, watchlistKey) {
  // 1. Check scrape_groups for global enable/disable and interval
  const groupSettings = getScrapeGroupSettings('investing_watchlists');
  const markerPath = `/usr/src/app/logs/last.watchlist.${providerId}.${watchlistKey}.txt`;
  
  if (!shouldRunTask(groupSettings, markerPath)) {
    console.log(`[Watchlist] Skipping ${providerId}/${watchlistKey} - interval not elapsed or disabled`);
    return;
  }
  
  // 2. Check per-instance enabled flag
  const config = await watchlistConfigLoader.getConfig();
  const instance = config[providerId]?.watchlists?.find(w => w.key === watchlistKey);
  if (!instance?.enabled) {
    console.log(`[Watchlist] Skipping ${providerId}/${watchlistKey} - instance disabled`);
    return;
  }
  
  // 3. Proceed with scrape
  await scrapeWatchlist(providerId, watchlistKey);
}
```

##### Update Windows (Time-Based Filtering)

The existing `update_windows` feature from `config.json` is preserved and enhanced:

**Current System** (`isWithinUpdateWindow()` in scrape_investingcom_watchlists.js):
- Per-ticker time windows (e.g., only scrape BKLC during market hours)
- Day-of-week filtering
- America/New_York timezone
- `default` key for fallback rules

**Proposed Enhancement**:

```javascript
// services/update_window_service.js

const { DateTime } = require('luxon');

/**
 * Update Window Service
 * 
 * Hierarchical time-based filtering for scrape operations.
 * Checks (in order of priority):
 * 1. Ticker-specific windows
 * 2. Watchlist-specific windows
 * 3. Provider-specific windows
 * 4. Global 'default' windows
 */
class UpdateWindowService {
  constructor(dbPool = null) {
    this.dbPool = dbPool;
    this.cache = null;
    this.cacheExpiry = 0;
    this.CACHE_TTL_MS = 60000; // 1 minute cache
  }

  /**
   * Check if a ticker should be updated based on time windows
   * @param {string} ticker - Ticker symbol
   * @param {string} providerId - Provider ID (e.g., 'investingcom')
   * @param {string} watchlistKey - Watchlist key (e.g., 'primary')
   * @returns {Promise<{allowed: boolean, reason: string}>}
   */
  async isWithinUpdateWindow(ticker, providerId = null, watchlistKey = null) {
    const windows = await this._getWindows();
    const now = DateTime.now();
    
    // Find applicable windows (most specific first)
    const candidates = this._findApplicableWindows(windows, ticker, providerId, watchlistKey);
    
    if (candidates.length === 0) {
      // No windows defined = always allowed
      return { allowed: true, reason: 'no_windows_defined' };
    }
    
    // Check each window
    for (const window of candidates) {
      const localNow = now.setZone(window.timezone || 'America/New_York');
      const dayNames = ['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const currentDay = dayNames[localNow.weekday];
      
      // Check day
      const days = typeof window.days === 'string' ? JSON.parse(window.days) : window.days;
      if (!days.includes(currentDay)) continue;
      
      // Check time (window properties are now camelCase)
      const currentMinutes = localNow.hour * 60 + localNow.minute;
      const [startH, startM] = window.startTime.split(':').map(Number);
      const [endH, endM] = window.endTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      
      if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
        return { 
          allowed: true, 
          reason: `within_window:${window.startTime}-${window.endTime}`,
          window
        };
      }
    }
    
    return { 
      allowed: false, 
      reason: `outside_all_windows:${now.toFormat('EEE HH:mm')}` 
    };
  }

  /**
   * Find windows applicable to this ticker (most specific first)
   * @private
   */
  _findApplicableWindows(windows, ticker, providerId, watchlistKey) {
    return windows
      .filter(w => w.enabled)
      .filter(w => {
        // Ticker-specific
        if (w.ticker && w.ticker !== ticker && w.ticker !== 'default') return false;
        // Provider-specific (camelCase property)
        if (w.providerId && w.providerId !== providerId) return false;
        // Watchlist-specific (camelCase property)
        if (w.watchlistKey && w.watchlistKey !== watchlistKey) return false;
        return true;
      })
      .sort((a, b) => {
        // Sort by specificity: ticker > watchlist > provider > default
        const score = (w) => {
          let s = w.priority || 0;
          if (w.ticker && w.ticker !== 'default') s += 1000;
          if (w.watchlistKey) s += 100;
          if (w.providerId) s += 10;
          return s;
        };
        return score(b) - score(a);
      });
  }

  /**
   * Get windows from DB or config.json
   * @private
   */
  async _getWindows() {
    if (this.cache && Date.now() < this.cacheExpiry) {
      return this.cache;
    }
    
    let windows = [];
    
    // Try database first
    if (this.dbPool) {
      try {
        const [rows] = await this.dbPool.query('SELECT * FROM update_windows WHERE enabled = 1');
        if (rows.length > 0) {
          // Convert snake_case DB columns to camelCase
          windows = rows.map(row => ({
            providerId: row.provider_id,
            watchlistKey: row.watchlist_key,
            ticker: row.ticker,
            days: typeof row.days === 'string' ? JSON.parse(row.days) : row.days,
            startTime: row.start_time,
            endTime: row.end_time,
            timezone: row.timezone,
            enabled: row.enabled,
            priority: row.priority
          }));
          this.cache = windows;
          this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
          return windows;
        }
        
        // No windows configured - return empty (use defaults elsewhere)
        this.cache = [];
        this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
        return [];
      } catch (e) {
        console.error('[UpdateWindowService] DB query failed:', e.message);
        throw e; // Fail fast, DB is required
      }
    }
    
    throw new Error('Database pool not initialized. Call initialize() first.');
  }
}

module.exports = { UpdateWindowService };
```

##### Scheduling Hierarchy Summary

| Level | Config Location | Controls |
|-------|-----------------|----------|
| **Global Group** | `config.json` → `scrape_groups.investing_watchlists` | Enable/disable entire group, base interval |
| **Provider** | DB `watchlist_providers` or `config.json` | Enable/disable provider, default interval |
| **Watchlist Instance** | DB `watchlist_instances` or `config.json` | Enable/disable instance, override interval |
| **Update Windows** | DB `update_windows` or `config.json` → `update_rules` | Time-of-day filtering per ticker/watchlist |
| **Marker Files** | `logs/last.*.txt` | Interval enforcement via `shouldRunTask()` |

##### Example: Complete Scheduling Flow

```
User clicks "Refresh" in Dashboard for AAPL on Investing.com Primary Watchlist
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. scrape_groups.investing_watchlists.enabled?                      │
│    └─ NO  → Skip (group disabled)                                   │
│    └─ YES → Continue                                                │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. watchlist_providers.investingcom.enabled?                        │
│    └─ NO  → Skip (provider disabled)                                │
│    └─ YES → Continue                                                │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. watchlist_instances.primary.enabled?                             │
│    └─ NO  → Skip (instance disabled)                                │
│    └─ YES → Continue                                                │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. shouldRunTask(interval, last.watchlist.investingcom.primary.txt)?│
│    └─ NO  → Skip (interval not elapsed)                             │
│    └─ YES → Continue                                                │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. isWithinUpdateWindow('AAPL', 'investingcom', 'primary')?         │
│    └─ NO  → Skip (outside trading hours)                            │
│    └─ YES → SCRAPE!                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

#### Migration Path

**Phase A**: Keep config.json as source of truth, but migrate structure
**Phase B**: Add database tables, read from DB with config.json fallback  
**Phase C**: Dashboard UI for managing watchlist instances

#### Interim Solution: Improved config.json Structure

For immediate implementation before database migration:

```json
{
  "scrape_groups": {
    "investing_watchlists": { "interval": 3, "enabled": true }
  },
  
  "watchlist_providers": {
    "investingcom": {
      "provider_id": "investingcom",
      "display_name": "Investing.com",
      "enabled": true,
      "supported_asset_types": ["stock", "etf"],
      "auth_method": "credentials",
      "watchlists": [
        {
          "key": "primary",
          "name": "Primary Watchlist",
          "url_env_var": "INVESTING_WATCHLIST_URL",
          "interval_seconds": 120,
          "allowed_asset_types": ["stock", "etf"]
        },
        {
          "key": "secondary", 
          "name": "Secondary Watchlist",
          "url_env_var": "INVESTING_WATCHLIST_SECONDARY_URL",
          "interval_seconds": 300,
          "allowed_asset_types": ["stock", "etf"]
        }
      ]
    },
    "tradingview": {
      "provider_id": "tradingview",
      "display_name": "TradingView",
      "enabled": false,
      "supported_asset_types": ["stock", "etf", "bond", "treasury", "crypto"],
      "auth_method": "credentials",
      "watchlists": [
        {
          "key": "main",
          "name": "Main Watchlist",
          "url_env_var": "TRADINGVIEW_WATCHLIST_URL",
          "interval_seconds": 300
        }
      ]
    }
  }
}
```

**Corresponding .env file:**
```bash
# Investing.com
INVESTING_EMAIL=user@example.com
INVESTING_PASSWORD=secret
# Investing.com uses tabs on a single URL for multiple watchlists
INVESTING_WATCHLIST_URL=https://www.investing.com/portfolio/?portfolioID=abc123

# TradingView
TRADINGVIEW_EMAIL=user@example.com
TRADINGVIEW_PASSWORD=secret
TRADINGVIEW_WATCHLIST_URL=https://www.tradingview.com/watchlists/189516536/
```

**Benefits:**
- URLs with user-specific IDs stay in .env (not version controlled)
- Config.json defines structure and defaults (version controlled)
- Per-watchlist asset type constraints
- Clear separation of provider vs instance configuration
- Database seeded via init script on fresh containers

#### Configuration Loader

**File**: `services/watchlist_config_loader.js`

```javascript
/**
 * Watchlist Configuration Loader
 * 
 * Loads watchlist provider configurations from database.
 * Database must be initialized and seeded (via init scripts).
 * 
 * @module services/watchlist_config_loader
 */

const { getConfig } = require('./config');

class WatchlistConfigLoader {
  constructor(dbPool = null) {
    this.dbPool = dbPool;
    this.cache = null;
    this.cacheExpiry = null;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get all watchlist provider configurations
   * @returns {Promise<Object>}
   */
  async getProviders() {
    // Try database first
    if (this.dbPool) {
      try {
        return await this._loadFromDatabase();
      } catch (e) {
        console.warn('Failed to load from database, falling back to config:', e.message);
      }
    }
    
    // Fallback to config.json
    return this._loadFromConfig();
  }

  /**
   * Get configuration for a specific provider
   * @param {string} providerId 
   * @returns {Promise<Object|null>}
   */
  async getProvider(providerId) {
    const providers = await this.getProviders();
    return providers[providerId] || null;
  }

  /**
   * Get all watchlist instances for a provider
   * @param {string} providerId 
   * @returns {Promise<Array>}
   */
  async getWatchlists(providerId) {
    const provider = await this.getProvider(providerId);
    return provider?.watchlists || [];
  }

  /**
   * Load from database
   * @private
   */
  async _loadFromDatabase() {
    const [providers] = await this.dbPool.query(`
      SELECT * FROM watchlist_providers WHERE enabled = 1
    `);
    
    const [instances] = await this.dbPool.query(`
      SELECT * FROM watchlist_instances WHERE enabled = 1
    `);

    const result = {};
    for (const provider of providers) {
      // Convert snake_case DB columns to camelCase JS properties
      result[provider.provider_id] = {
        providerId: provider.provider_id,
        displayName: provider.display_name,
        enabled: provider.enabled,
        authMethod: provider.auth_method,
        defaultIntervalSeconds: provider.default_interval_seconds,
        watchlists: instances
          .filter(i => i.provider_id === provider.provider_id)
          .map(i => ({
            key: i.watchlist_key,
            name: i.watchlist_name,
            url: i.watchlist_url,
            intervalSeconds: i.interval_seconds || provider.default_interval_seconds,
            allowedAssetTypes: i.allowed_asset_types ? JSON.parse(i.allowed_asset_types) : null
          }))
      };
    }
    
    return result;
  }

  /**
   * Load from config.json with .env URL resolution
   * @private
   * @throws {Error} If config not found
   */
  _loadFromConfig() {
    const config = getConfig('watchlist_providers');
    if (!config) {
      throw new Error('watchlist_providers config not found. Ensure config.json is configured or database is seeded.');
    }

    const result = {};
    for (const [providerId, providerConfig] of Object.entries(config)) {
      // Convert snake_case config keys to camelCase JS properties
      result[providerId] = {
        providerId: providerConfig.provider_id || providerId,
        displayName: providerConfig.display_name,
        enabled: providerConfig.enabled,
        supportedAssetTypes: providerConfig.supported_asset_types,
        authMethod: providerConfig.auth_method,
        defaultIntervalSeconds: providerConfig.default_interval_seconds,
        watchlists: (providerConfig.watchlists || []).map(w => ({
          key: w.key,
          name: w.name,
          // Resolve URL from environment variable
          url: w.url_env_var ? process.env[w.url_env_var] : w.url,
          intervalSeconds: w.interval_seconds,
          allowedAssetTypes: w.allowed_asset_types
        }))
      };
    }
    
    return result;
  }
}

module.exports = { WatchlistConfigLoader };
```

---

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dashboard                                 │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │  Add Ticker     │  │  Delete Ticker  │                       │
│  │  [AAPL] [+]     │  │  [TSLA] [🗑️]    │                       │
│  └────────┬────────┘  └────────┬────────┘                       │
│           │                    │                                 │
│           └────────┬───────────┘                                 │
│                    ▼                                             │
│     POST /api/watchlist/{provider}/add                           │
│     POST /api/watchlist/{provider}/delete                        │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ HTTP
┌─────────────────────────────────────────────────────────────────┐
│                   scrape_daemon.js                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           WatchlistManager (Provider Registry)               ││
│  │                                                              ││
│  │  providers: {                                                ││
│  │    'investingcom': InvestingComWatchlistController,          ││
│  │    'tradingview': TradingViewWatchlistController,  // future ││
│  │  }                                                           ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           BaseWatchlistController (Abstract)                 ││
│  │                                                              ││
│  │  • getSupportedAssetTypes(): string[]                       ││
│  │  • validateTicker(ticker, assetType): boolean               ││
│  │  • addTicker(watchlistKey, ticker): Promise<Result>         ││
│  │  • deleteTicker(watchlistKey, ticker): Promise<Result>      ││
│  │  • listTickers(watchlistKey): Promise<string[]>             ││
│  │  • syncWatchlist(watchlistKey): Promise<SyncResult>         ││
│  │  • getCapabilities(): ProviderCapabilities                  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   Investing.com                   TradingView
   (stocks, ETFs)                    (future)
```

### Step 11.1: Create Base Watchlist Controller Interface

**File**: `scrapers/watchlist/base_watchlist_controller.js`

```javascript
/**
 * Base Watchlist Controller
 * 
 * Abstract base class for all watchlist provider controllers.
 * Defines the interface that all provider implementations must follow.
 * 
 * @module scrapers/watchlist/base_watchlist_controller
 */

/**
 * Asset types that can be tracked in watchlists
 * @enum {string}
 */
const AssetType = {
  STOCK: 'stock',
  ETF: 'etf',
  BOND: 'bond',
  TREASURY: 'treasury',
  MUTUAL_FUND: 'mutual_fund',
  CRYPTO: 'crypto',
  INDEX: 'index',
  FOREX: 'forex',
  COMMODITY: 'commodity'
};

/**
 * Standard result structure for watchlist operations
 * @typedef {Object} WatchlistResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} message - Human-readable message
 * @property {string} [ticker] - The ticker involved
 * @property {string} [error] - Error code if failed
 */

/**
 * Provider capabilities description
 * @typedef {Object} ProviderCapabilities
 * @property {string} providerId - Unique provider identifier
 * @property {string} displayName - Human-readable provider name
 * @property {string[]} supportedAssetTypes - Asset types this provider supports
 * @property {boolean} supportsMultipleWatchlists - Can have multiple watchlist tabs
 * @property {boolean} requiresLogin - Requires authenticated session
 * @property {number} maxTickersPerWatchlist - Maximum tickers allowed (0 = unlimited)
 * @property {number} rateLimitMs - Minimum delay between operations
 */

/**
 * Abstract base class for watchlist controllers
 * @abstract
 */
class BaseWatchlistController {
  /**
   * Create a new watchlist controller
   * @param {Browser} browser - Puppeteer browser instance
   * @param {Object} options - Configuration options
   */
  constructor(browser, options = {}) {
    if (new.target === BaseWatchlistController) {
      throw new Error('BaseWatchlistController is abstract and cannot be instantiated directly');
    }
    
    this.browser = browser;
    this.options = options;
    this.page = null;
    this.isInitialized = false;
    this.currentWatchlist = null;
    
    // Operation queue to prevent concurrent modifications
    this.operationQueue = [];
    this.isProcessing = false;
  }

  /**
   * Get provider capabilities
   * @abstract
   * @returns {ProviderCapabilities}
   */
  getCapabilities() {
    throw new Error('getCapabilities() must be implemented by subclass');
  }

  /**
   * Get supported asset types for this provider
   * @returns {string[]}
   */
  getSupportedAssetTypes() {
    return this.getCapabilities().supportedAssetTypes;
  }

  /**
   * Validate if a ticker can be added to this provider's watchlist
   * @param {string} ticker - Ticker symbol
   * @param {string} assetType - Type of asset (from AssetType enum)
   * @returns {{valid: boolean, reason?: string}}
   */
  validateTicker(ticker, assetType) {
    if (!ticker || typeof ticker !== 'string') {
      return { valid: false, reason: 'Ticker is required' };
    }

    const supported = this.getSupportedAssetTypes();
    if (!supported.includes(assetType)) {
      return { 
        valid: false, 
        reason: `${this.getCapabilities().displayName} does not support ${assetType}. Supported: ${supported.join(', ')}` 
      };
    }

    return { valid: true };
  }

  /**
   * Initialize the controller and establish page connection
   * @abstract
   * @param {string} url - URL to navigate to
   * @returns {Promise<void>}
   */
  async initialize(url) {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Add a ticker to the watchlist
   * @abstract
   * @param {string} ticker - Ticker symbol
   * @param {Object} options - Additional options
   * @param {string} [options.watchlist] - Specific watchlist tab name
   * @param {string} [options.assetType] - Asset type for validation
   * @returns {Promise<WatchlistResult>}
   */
  async addTicker(ticker, options = {}) {
    throw new Error('addTicker() must be implemented by subclass');
  }

  /**
   * Delete a ticker from the watchlist
   * @abstract
   * @param {string} ticker - Ticker symbol
   * @param {Object} options - Additional options
   * @param {string} [options.watchlist] - Specific watchlist tab name
   * @returns {Promise<WatchlistResult>}
   */
  async deleteTicker(ticker, options = {}) {
    throw new Error('deleteTicker() must be implemented by subclass');
  }

  /**
   * List all tickers in the current watchlist
   * @abstract
   * @returns {Promise<string[]>}
   */
  async listTickers() {
    throw new Error('listTickers() must be implemented by subclass');
  }

  /**
   * Sync watchlist with database positions
   * 
   * Compares tickers in the web watchlist with positions in the database.
   * Returns drift information and optionally performs sync operations.
   * 
   * Source of truth: `positions` MySQL table
   * 
   * @abstract
   * @param {Object} options - Sync options
   * @param {boolean} [options.dryRun=true] - If true, only report drift without making changes
   * @param {boolean} [options.addMissing=false] - Add tickers missing from watchlist
   * @param {boolean} [options.removeExtra=false] - Remove tickers not in positions
   * @returns {Promise<SyncResult>}
   */
  async syncWatchlist(options = {}) {
    throw new Error('syncWatchlist() must be implemented by subclass');
  }

  /**
   * Get available watchlist names/tabs
   * @abstract
   * @returns {Promise<string[]>}
   */
  async getWatchlistTabs() {
    throw new Error('getWatchlistTabs() must be implemented by subclass');
  }

  /**
   * Switch to a different watchlist tab
   * @abstract
   * @param {string} tabName - Name of the watchlist tab
   * @returns {Promise<boolean>}
   */
  async switchToTab(tabName) {
    throw new Error('switchToTab() must be implemented by subclass');
  }

  /**
   * Get controller status
   * @returns {Object}
   */
  getStatus() {
    return {
      providerId: this.getCapabilities().providerId,
      isInitialized: this.isInitialized,
      currentWatchlist: this.currentWatchlist,
      queueLength: this.operationQueue.length,
      isProcessing: this.isProcessing
    };
  }

  /**
   * Queue an operation to prevent concurrent modifications
   * @protected
   * @param {Function} operation - Async operation to queue
   * @returns {Promise<any>}
   */
  async _queueOperation(operation) {
    return new Promise((resolve, reject) => {
      this.operationQueue.push({ operation, resolve, reject });
      this._processQueue();
    });
  }

  /**
   * Process queued operations sequentially
   * @protected
   */
  async _processQueue() {
    if (this.isProcessing || this.operationQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const { rateLimitMs } = this.getCapabilities();

    while (this.operationQueue.length > 0) {
      const { operation, resolve, reject } = this.operationQueue.shift();
      try {
        const result = await operation();
        resolve(result);
        
        // Rate limiting between operations
        if (rateLimitMs > 0 && this.operationQueue.length > 0) {
          await new Promise(r => setTimeout(r, rateLimitMs));
        }
      } catch (e) {
        reject(e);
      }
    }

    this.isProcessing = false;
  }
}

module.exports = { BaseWatchlistController, AssetType };
```

---

### Step 11.2: Create Investing.com Controller Implementation

**File**: `scrapers/watchlist/investingcom_watchlist_controller.js`

```javascript
/**
 * Investing.com Watchlist Controller
 * 
 * Provides programmatic control over Investing.com watchlists
 * using the persistent browser page that maintains login state.
 * 
 * IMPORTANT: Investing.com only supports stocks and ETFs.
 * Bonds, treasuries, and other asset types are NOT supported.
 * 
 * @module scrapers/watchlist/investingcom_watchlist_controller
 */

const { BaseWatchlistController, AssetType } = require('./base_watchlist_controller');
const { logDebug, createPreparedPage } = require('../scraper_utils');

/**
 * Default configuration for Investing.com
 * @constant {Object}
 */
const DEFAULT_CONFIG = {
  // Timeouts (ms)
  selectorTimeout: 10000,
  navigationTimeout: 15000,
  actionDelay: 1000,
  
  // Selectors (may need updates if Investing.com changes their UI)
  selectors: {
    // Add symbol button/input
    addSymbolButton: '[data-test="add-symbol-button"], .js-add-symbol, button:has-text("Add")',
    addSymbolInput: 'input[placeholder*="Symbol"], input[name="search"], .js-symbol-search',
    addSymbolSubmit: 'button[type="submit"], .js-add-symbol-submit',
    searchResultItem: '.js-search-result-item, [data-test="search-result"]',
    
    // Delete button (per row)
    deleteButton: '[data-test="delete-symbol"], .js-delete-symbol, button.delete, .deleteBtn',
    deleteConfirm: '.js-confirm-delete, button:has-text("Confirm"), button:has-text("Yes")',
    
    // Table and rows
    watchlistTable: '[id^="tbody_overview_"]',
    tickerRow: 'tr[data-row-id], tr[id*="row_"]',
    tickerSymbol: 'td[data-column-name="symbol"]',
    
    // Tabs
    watchlistTab: 'li[title="${tabName}"]',
    
    // Modal/popup close
    modalClose: '.js-modal-close, [data-test="modal-close"], button.close'
  }
};

/**
 * Investing.com Watchlist Controller
 * @extends BaseWatchlistController
 */
class InvestingComWatchlistController extends BaseWatchlistController {
  /**
   * Create a new Investing.com watchlist controller
   * @param {Browser} browser - Puppeteer browser instance
   * @param {Object} options - Configuration options
   */
  constructor(browser, options = {}) {
    super(browser, options);
    this.config = { ...DEFAULT_CONFIG, ...options };
  }

  /**
   * Get provider capabilities
   * @returns {ProviderCapabilities}
   */
  getCapabilities() {
    return {
      providerId: 'investingcom',
      displayName: 'Investing.com',
      supportedAssetTypes: [AssetType.STOCK, AssetType.ETF],
      supportsMultipleWatchlists: true,
      requiresLogin: true,
      maxTickersPerWatchlist: 100, // Investing.com limit
      rateLimitMs: 1000 // 1 second between operations
    };
  }

  /**
   * Initialize controller and get persistent page
   * @param {string} watchlistUrl - URL of the Investing.com watchlist
   * @returns {Promise<void>}
   */
  async initialize(watchlistUrl) {
    logDebug('[InvestingCom] Initializing...');
    
    // Get or create persistent page
    this.page = await createPreparedPage(this.browser, {
      reuseIfUrlMatches: /investing\.com/,
      url: watchlistUrl,
      waitUntil: 'domcontentloaded',
      timeout: this.config.navigationTimeout,
      reloadExisting: false
    });

    // Verify we're on the watchlist page
    await this.page.waitForSelector(
      this.config.selectors.watchlistTable,
      { timeout: this.config.selectorTimeout }
    );

    this.isInitialized = true;
    logDebug('[InvestingCom] Initialized successfully');
  }

  /**
   * Switch to a specific watchlist tab
   * @param {string} tabName - Name of the watchlist tab
   * @returns {Promise<boolean>} Success status
   */
  async switchToTab(tabName) {
    if (!this.isInitialized) {
      throw new Error('Controller not initialized');
    }

    const tabSelector = this.config.selectors.watchlistTab.replace('${tabName}', tabName);
    
    try {
      await this.page.waitForSelector(tabSelector, { 
        visible: true, 
        timeout: this.config.selectorTimeout 
      });
      await this.page.click(tabSelector);
      await new Promise(r => setTimeout(r, this.config.actionDelay));
      
      // Wait for table to reload
      await this.page.waitForSelector(this.config.selectors.watchlistTable, {
        timeout: this.config.selectorTimeout
      });
      
      this.currentWatchlist = tabName;
      logDebug(`[InvestingCom] Switched to tab: ${tabName}`);
      return true;
    } catch (e) {
      logDebug(`[InvestingCom] Failed to switch to tab ${tabName}: ${e.message}`);
      return false;
    }
  }

  /**
   * Add a ticker to the current watchlist
   * 
   * NOTE: Investing.com only supports stocks and ETFs.
   * Attempting to add bonds, treasuries, or other asset types will fail validation.
   * 
   * @param {string} ticker - Ticker symbol to add
   * @param {Object} options - Additional options
   * @param {string} [options.watchlist] - Specific watchlist tab name
   * @param {string} [options.assetType='stock'] - Asset type (must be 'stock' or 'etf')
   * @returns {Promise<WatchlistResult>}
   */
  async addTicker(ticker, options = {}) {
    const { assetType = AssetType.STOCK, watchlist } = options;

    // Validate asset type BEFORE queueing
    const validation = this.validateTicker(ticker, assetType);
    if (!validation.valid) {
      return { 
        success: false, 
        message: validation.reason,
        error: 'UNSUPPORTED_ASSET_TYPE',
        ticker 
      };
    }

    return this._queueOperation(async () => {
      if (!this.isInitialized) {
        return { success: false, message: 'Controller not initialized', ticker };
      }

      // Switch watchlist if specified
      if (watchlist && watchlist !== this.currentWatchlist) {
        const switched = await this.switchToTab(watchlist);
        if (!switched) {
          return { success: false, message: `Failed to switch to watchlist: ${watchlist}`, ticker };
        }
      }

      logDebug(`[InvestingCom] Adding ${assetType}: ${ticker}`);

      try {
        // Click add symbol button
        await this.page.waitForSelector(this.config.selectors.addSymbolButton, {
          visible: true,
          timeout: this.config.selectorTimeout
        });
        await this.page.click(this.config.selectors.addSymbolButton);
        await new Promise(r => setTimeout(r, 500));

        // Type ticker in search input
        await this.page.waitForSelector(this.config.selectors.addSymbolInput, {
          visible: true,
          timeout: this.config.selectorTimeout
        });
        await this.page.type(this.config.selectors.addSymbolInput, ticker, { delay: 50 });
        await new Promise(r => setTimeout(r, 1000)); // Wait for search results

        // Click first search result or submit
        try {
          const resultSelector = this.config.selectors.searchResultItem;
          await this.page.waitForSelector(resultSelector, { 
            visible: true, 
            timeout: 5000 
          });
          await this.page.click(resultSelector);
        } catch (e) {
          // Try submit button if no results dropdown
          await this.page.click(this.config.selectors.addSymbolSubmit);
        }

        await new Promise(r => setTimeout(r, this.config.actionDelay));

        // Close any modal
        try {
          await this.page.click(this.config.selectors.modalClose);
        } catch (e) {
          // Modal may not exist
        }

        // Verify ticker was added
        const tickers = await this.listTickers();
        const added = tickers.includes(ticker.toUpperCase());

        if (added) {
          logDebug(`[InvestingCom] Successfully added ${ticker}`);
          return { success: true, message: `Added ${ticker} to watchlist`, ticker };
        } else {
          return { success: false, message: `${ticker} may not have been added (not found in list)`, ticker };
        }
      } catch (e) {
        logDebug(`[InvestingCom] Error adding ${ticker}: ${e.message}`);
        return { success: false, message: e.message, ticker };
      }
    });
  }

  /**
   * Delete a ticker from the current watchlist
   * @param {string} ticker - Ticker symbol to delete
   * @param {Object} options - Additional options
   * @param {string} [options.watchlist] - Specific watchlist tab name
   * @returns {Promise<WatchlistResult>}
   */
  async deleteTicker(ticker, options = {}) {
    const { watchlist } = options;

    return this._queueOperation(async () => {
      if (!this.isInitialized) {
        return { success: false, message: 'Controller not initialized', ticker };
      }

      // Switch watchlist if specified
      if (watchlist && watchlist !== this.currentWatchlist) {
        const switched = await this.switchToTab(watchlist);
        if (!switched) {
          return { success: false, message: `Failed to switch to watchlist: ${watchlist}`, ticker };
        }
      }

      logDebug(`[InvestingCom] Deleting ticker: ${ticker}`);

      try {
        // Find the row containing the ticker
        const rows = await this.page.$$(this.config.selectors.tickerRow);
        let targetRow = null;

        for (const row of rows) {
          const symbolCell = await row.$(this.config.selectors.tickerSymbol);
          if (symbolCell) {
            const text = await this.page.evaluate(el => el.textContent, symbolCell);
            if (text && text.trim().toUpperCase() === ticker.toUpperCase()) {
              targetRow = row;
              break;
            }
          }
        }

        if (!targetRow) {
          return { success: false, message: `Ticker ${ticker} not found in watchlist` };
        }

        // Find and click delete button in that row
        const deleteBtn = await targetRow.$(this.config.selectors.deleteButton);
        if (!deleteBtn) {
          // Try hovering to reveal delete button
          await targetRow.hover();
          await new Promise(r => setTimeout(r, 500));
          const deleteBtnAfterHover = await targetRow.$(this.config.selectors.deleteButton);
          if (!deleteBtnAfterHover) {
            return { success: false, message: 'Delete button not found' };
          }
          await deleteBtnAfterHover.click();
        } else {
          await deleteBtn.click();
        }

        await new Promise(r => setTimeout(r, 500));

        // Handle confirmation dialog if present
        try {
          await this.page.waitForSelector(this.config.selectors.deleteConfirm, {
            visible: true,
            timeout: 3000
          });
          await this.page.click(this.config.selectors.deleteConfirm);
        } catch (e) {
          // No confirmation needed
        }

        await new Promise(r => setTimeout(r, this.config.actionDelay));

        // Verify ticker was removed
        const tickers = await this.listTickers();
        const removed = !tickers.includes(ticker.toUpperCase());

        if (removed) {
          logDebug(`[WatchlistController] Successfully deleted ${ticker}`);
          return { success: true, message: `Deleted ${ticker} from watchlist` };
        } else {
          return { success: false, message: `${ticker} may not have been deleted (still in list)` };
        }
      } catch (e) {
        logDebug(`[WatchlistController] Error deleting ${ticker}: ${e.message}`);
        return { success: false, message: e.message };
      }
    });
  }

  /**
   * List all tickers in the current watchlist
   * @returns {Promise<string[]>} Array of ticker symbols
   */
  async listTickers() {
    if (!this.isInitialized) {
      throw new Error('Controller not initialized');
    }

    const tickers = [];
    const rows = await this.page.$$(this.config.selectors.tickerRow);

    for (const row of rows) {
      const symbolCell = await row.$(this.config.selectors.tickerSymbol);
      if (symbolCell) {
        const text = await this.page.evaluate(el => el.textContent, symbolCell);
        if (text && text.trim()) {
          tickers.push(text.trim().toUpperCase());
        }
      }
    }

    return tickers;
  }

  /**
   * Get list of available watchlist tabs
   * @returns {Promise<string[]>} Array of tab names
   */
  async getWatchlistTabs() {
    if (!this.isInitialized) {
      throw new Error('Controller not initialized');
    }

    const tabs = await this.page.$$eval('li[title]', elements => 
      elements.map(el => el.getAttribute('title')).filter(Boolean)
    );

    return tabs;
  }

  /**
   * Sync watchlist with database positions
   * 
   * Compares tickers in the web watchlist with positions in the `positions` table.
   * Source of truth: `positions` MySQL table
   * 
   * @param {Object} dbPool - MySQL connection pool
   * @param {Object} options - Sync options
   * @param {boolean} [options.dryRun=true] - If true, only report drift without making changes
   * @param {boolean} [options.addMissing=false] - Add tickers missing from watchlist
   * @param {boolean} [options.removeExtra=false] - Remove tickers not in positions
   * @returns {Promise<SyncResult>}
   */
  async syncWatchlist(dbPool, options = {}) {
    const { dryRun = true, addMissing = false, removeExtra = false } = options;

    // 1. Get tickers from web watchlist
    const webTickers = new Set(await this.listTickers());

    // 2. Get tickers from positions table (source of truth)
    //    Filter to supported asset types for this provider
    const conn = await dbPool.getConnection();
    let dbTickers;
    try {
      const [rows] = await conn.execute(`
        SELECT DISTINCT ticker 
        FROM positions 
        WHERE ticker IS NOT NULL 
          AND type IN ('stock', 'etf')
      `);
      dbTickers = new Set(rows.map(r => r.ticker.toUpperCase()));
    } finally {
      conn.release();
    }

    // 3. Calculate drift
    const missingFromWeb = [...dbTickers].filter(t => !webTickers.has(t));
    const extraInWeb = [...webTickers].filter(t => !dbTickers.has(t));
    
    // 4. Some drift is expected (unsupported security types)
    const unsupportedTypes = await this._getUnsupportedTickers(dbPool);
    const legitimateMissing = missingFromWeb.filter(t => !unsupportedTypes.has(t));

    const result = {
      webTickerCount: webTickers.size,
      dbTickerCount: dbTickers.size,
      missingFromWeb: legitimateMissing,
      extraInWeb,
      unsupportedTickers: [...unsupportedTypes],
      actions: [],
      dryRun
    };

    // 5. Perform sync actions if not dry run
    if (!dryRun) {
      if (addMissing) {
        for (const ticker of legitimateMissing) {
          try {
            await this.addTicker(ticker);
            result.actions.push({ action: 'add', ticker, success: true });
          } catch (e) {
            result.actions.push({ action: 'add', ticker, success: false, error: e.message });
          }
        }
      }

      if (removeExtra) {
        for (const ticker of extraInWeb) {
          try {
            await this.deleteTicker(ticker);
            result.actions.push({ action: 'delete', ticker, success: true });
          } catch (e) {
            result.actions.push({ action: 'delete', ticker, success: false, error: e.message });
          }
        }
      }
    }

    console.log(`[InvestingComWatchlist] Sync complete: ${legitimateMissing.length} missing, ${extraInWeb.length} extra, ${unsupportedTypes.size} unsupported`);
    return result;
  }

  /**
   * Get tickers from positions that have unsupported asset types
   * @private
   */
  async _getUnsupportedTickers(dbPool) {
    const conn = await dbPool.getConnection();
    try {
      const [rows] = await conn.execute(`
        SELECT DISTINCT ticker 
        FROM positions 
        WHERE ticker IS NOT NULL 
          AND type NOT IN ('stock', 'etf')
      `);
      return new Set(rows.map(r => r.ticker.toUpperCase()));
    } finally {
      conn.release();
    }
  }

  /**
   * Queue an operation to prevent concurrent modifications
   * @private
   */
  async _queueOperation(operation) {
    return new Promise((resolve, reject) => {
      this.operationQueue.push({ operation, resolve, reject });
      this._processQueue();
    });
  }

  /**
   * Process queued operations sequentially
   * @private
   */
  async _processQueue() {
    if (this.isProcessing || this.operationQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.operationQueue.length > 0) {
      const { operation, resolve, reject } = this.operationQueue.shift();
      try {
        const result = await operation();
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }

    this.isProcessing = false;
  }
}

module.exports = { InvestingComWatchlistController };
```

---

### Step 11.2.1: Watchlist Sync Triggers

Watchlist sync should be triggered:

1. **After add/delete operations from dashboard** - Verify the change was applied:

```javascript
// In dashboard API handler
app.post('/api/watchlist/:provider/add', async (req, res) => {
  const { provider } = req.params;
  const { ticker } = req.body;
  
  try {
    // Add to watchlist
    const result = await watchlistManager.addTicker(provider, ticker);
    
    // Trigger sync to verify (dry run)
    const syncResult = await watchlistManager.syncWatchlist(provider, { dryRun: true });
    
    res.json({ 
      ...result, 
      syncStatus: {
        verified: !syncResult.missingFromWeb.includes(ticker)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

2. **Periodic scheduled sync** - Catch drift from external changes:

```javascript
// In scrape_daemon.js or separate scheduler
async function runWatchlistSync() {
  const providers = watchlistManager.getProviders();
  
  for (const providerId of providers) {
    const syncResult = await watchlistManager.syncWatchlist(providerId, { 
      dryRun: true 
    });
    
    // Log drift for monitoring
    if (syncResult.missingFromWeb.length > 0 || syncResult.extraInWeb.length > 0) {
      console.warn(`[WatchlistSync] Drift detected for ${providerId}:`, {
        missing: syncResult.missingFromWeb,
        extra: syncResult.extraInWeb
      });
    }
  }
}

// Schedule periodic sync (e.g., every 6 hours)
setInterval(runWatchlistSync, 6 * 60 * 60 * 1000);
```

---

### Step 11.3: Create WatchlistManager Registry

**File**: `scrapers/watchlist/watchlist_manager.js`

```javascript
/**
 * Watchlist Manager
 * 
 * Registry for multiple watchlist provider controllers.
 * Provides a unified interface for managing watchlists across different providers.
 * 
 * @module scrapers/watchlist/watchlist_manager
 */

const { BaseWatchlistController, AssetType } = require('./base_watchlist_controller');
const { InvestingComWatchlistController } = require('./investingcom_watchlist_controller');
const { logDebug } = require('../scraper_utils');

/**
 * Watchlist Manager - Provider Registry
 */
class WatchlistManager {
  constructor() {
    /**
     * Registered provider controllers
     * @type {Map<string, BaseWatchlistController>}
     */
    this.providers = new Map();
    
    /**
     * Provider configurations (for lazy initialization)
     * @type {Map<string, {ControllerClass: typeof BaseWatchlistController, options: Object}>}
     */
    this.providerConfigs = new Map();
  }

  /**
   * Register a provider controller class
   * @param {string} providerId - Unique provider identifier
   * @param {typeof BaseWatchlistController} ControllerClass - Controller class
   * @param {Object} options - Provider options (URLs, configs, etc.)
   */
  registerProvider(providerId, ControllerClass, options = {}) {
    this.providerConfigs.set(providerId, { ControllerClass, options });
    logDebug(`[WatchlistManager] Registered provider: ${providerId}`);
  }

  /**
   * Initialize a registered provider
   * @param {string} providerId - Provider to initialize
   * @param {Browser} browser - Puppeteer browser instance
   * @param {string} url - URL to navigate to
   * @returns {Promise<BaseWatchlistController>}
   */
  async initializeProvider(providerId, browser, url) {
    const config = this.providerConfigs.get(providerId);
    if (!config) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const { ControllerClass, options } = config;
    const controller = new ControllerClass(browser, options);
    await controller.initialize(url);
    
    this.providers.set(providerId, controller);
    logDebug(`[WatchlistManager] Initialized provider: ${providerId}`);
    
    return controller;
  }

  /**
   * Get an initialized provider controller
   * @param {string} providerId - Provider identifier
   * @returns {BaseWatchlistController|null}
   */
  getProvider(providerId) {
    return this.providers.get(providerId) || null;
  }

  /**
   * Get all registered provider IDs
   * @returns {string[]}
   */
  getRegisteredProviders() {
    return Array.from(this.providerConfigs.keys());
  }

  /**
   * Get all initialized provider IDs
   * @returns {string[]}
   */
  getInitializedProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * Get capabilities for all registered providers
   * @returns {Object<string, ProviderCapabilities>}
   */
  getAllCapabilities() {
    const capabilities = {};
    
    for (const [providerId, { ControllerClass }] of this.providerConfigs) {
      // Create temporary instance just to get capabilities
      const temp = Object.create(ControllerClass.prototype);
      if (typeof temp.getCapabilities === 'function') {
        capabilities[providerId] = temp.getCapabilities();
      }
    }
    
    return capabilities;
  }

  /**
   * Find providers that support a specific asset type
   * @param {string} assetType - Asset type from AssetType enum
   * @returns {string[]} - Provider IDs that support this asset type
   */
  getProvidersForAssetType(assetType) {
    const matching = [];
    const capabilities = this.getAllCapabilities();
    
    for (const [providerId, caps] of Object.entries(capabilities)) {
      if (caps.supportedAssetTypes.includes(assetType)) {
        matching.push(providerId);
      }
    }
    
    return matching;
  }

  /**
   * Get status of all initialized providers
   * @returns {Object<string, Object>}
   */
  getAllStatus() {
    const status = {};
    
    for (const [providerId, controller] of this.providers) {
      status[providerId] = controller.getStatus();
    }
    
    return status;
  }

  /**
   * Shutdown all providers
   */
  async shutdown() {
    for (const [providerId, controller] of this.providers) {
      logDebug(`[WatchlistManager] Shutting down: ${providerId}`);
      // Controllers don't own pages, just clear references
    }
    this.providers.clear();
  }
}

// Create singleton instance with default providers registered
const watchlistManager = new WatchlistManager();

// Register built-in providers
watchlistManager.registerProvider('investingcom', InvestingComWatchlistController, {});
// Future: watchlistManager.registerProvider('tradingview', TradingViewController, {});
// Future: watchlistManager.registerProvider('marketwatch', MarketWatchController, {});

module.exports = { WatchlistManager, watchlistManager, AssetType };
```

---

### Step 11.4: Update HTTP Endpoints for Multi-Provider Support

**File**: Modify `scrapers/scrape_daemon.js` health server section

```javascript
const { watchlistManager, AssetType } = require('./watchlist/watchlist_manager');

// Initialize after browser launch
async function initializeWatchlistProviders(browser) {
  // Initialize Investing.com watchlist controller
  try {
    await watchlistManager.initializeProvider(
      'investingcom', 
      browser, 
      'https://www.investing.com/portfolio/?portfolioID=...'
    );
    logDebug('[Daemon] Investing.com watchlist controller initialized');
  } catch (e) {
    logDebug(`[Daemon] Failed to initialize Investing.com watchlist: ${e.message}`);
  }
}

// Add to health server routes - Provider-agnostic endpoints

// GET /watchlist/providers - List all providers and their capabilities
if (req.url === '/watchlist/providers' && req.method === 'GET') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    registered: watchlistManager.getRegisteredProviders(),
    initialized: watchlistManager.getInitializedProviders(),
    capabilities: watchlistManager.getAllCapabilities()
  }));
  return;
}

// GET /watchlist/:provider/status
const statusMatch = req.url.match(/^\/watchlist\/([^/]+)\/status$/);
if (statusMatch && req.method === 'GET') {
  const providerId = statusMatch[1];
  const controller = watchlistManager.getProvider(providerId);
  
  if (!controller) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Provider not found or not initialized: ${providerId}` }));
    return;
  }
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(controller.getStatus()));
  return;
}

// GET /watchlist/:provider/tabs
const tabsMatch = req.url.match(/^\/watchlist\/([^/]+)\/tabs$/);
if (tabsMatch && req.method === 'GET') {
  const providerId = tabsMatch[1];
  const controller = watchlistManager.getProvider(providerId);
  
  if (!controller) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Provider not found: ${providerId}` }));
    return;
  }
  
  try {
    const tabs = await controller.getWatchlistTabs();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ provider: providerId, tabs }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}

// GET /watchlist/:provider/tickers
const tickersMatch = req.url.match(/^\/watchlist\/([^/]+)\/tickers$/);
if (tickersMatch && req.method === 'GET') {
  const providerId = tickersMatch[1];
  const controller = watchlistManager.getProvider(providerId);
  
  if (!controller) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Provider not found: ${providerId}` }));
    return;
  }
  
  try {
    const tickers = await controller.listTickers();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ provider: providerId, tickers, count: tickers.length }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}

// POST /watchlist/:provider/add
const addMatch = req.url.match(/^\/watchlist\/([^/]+)\/add$/);
if (addMatch && req.method === 'POST') {
  const providerId = addMatch[1];
  const controller = watchlistManager.getProvider(providerId);
  
  if (!controller) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Provider not found: ${providerId}` }));
    return;
  }
  
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { ticker, watchlist, assetType = 'stock' } = JSON.parse(body);
      
      if (!ticker) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ticker required' }));
        return;
      }

      const result = await controller.addTicker(ticker, { watchlist, assetType });
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ provider: providerId, ...result }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}

// POST /watchlist/:provider/delete
const deleteMatch = req.url.match(/^\/watchlist\/([^/]+)\/delete$/);
if (deleteMatch && req.method === 'POST') {
  const providerId = deleteMatch[1];
  const controller = watchlistManager.getProvider(providerId);
  
  if (!controller) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Provider not found: ${providerId}` }));
    return;
  }
  
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { ticker, watchlist } = JSON.parse(body);
      
      if (!ticker) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ticker required' }));
        return;
      }

      const result = await controller.deleteTicker(ticker, { watchlist });
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ provider: providerId, ...result }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}
```

---

### Step 11.5: Updated API Specification

| Endpoint | Method | Request Body | Response | Description |
|----------|--------|--------------|----------|-------------|
| `/watchlist/providers` | GET | - | `{registered, initialized, capabilities}` | List all providers |
| `/watchlist/{provider}/status` | GET | - | `{providerId, isInitialized, ...}` | Provider status |
| `/watchlist/{provider}/tabs` | GET | - | `{provider, tabs: [...]}` | List watchlist tabs |
| `/watchlist/{provider}/tickers` | GET | - | `{provider, tickers: [...], count}` | List tickers |
| `/watchlist/{provider}/add` | POST | `{ticker, watchlist?, assetType?}` | `{provider, success, message}` | Add ticker |
| `/watchlist/{provider}/delete` | POST | `{ticker, watchlist?}` | `{provider, success, message}` | Delete ticker |

**Asset Type Validation Example**:
```json
// Request
POST /watchlist/investingcom/add
{"ticker": "US912828ZT58", "assetType": "treasury"}

// Response (400 Bad Request)
{
  "provider": "investingcom",
  "success": false,
  "message": "Investing.com does not support treasury. Supported: stock, etf",
  "error": "UNSUPPORTED_ASSET_TYPE",
  "ticker": "US912828ZT58"
}
```

---

### Step 11.6: Dashboard Integration

**File**: Add to `dashboard/server.js`
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}

if (req.url === '/watchlist/add' && req.method === 'POST') {
  if (!watchlistController) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Controller not initialized' }));
    return;
  }
  
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { ticker, watchlist } = JSON.parse(body);
      
      if (!ticker) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ticker required' }));
        return;
      }

      // Switch to watchlist tab if specified
      if (watchlist) {
        await watchlistController.switchToTab(watchlist);
      }

      const result = await watchlistController.addTicker(ticker);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}

if (req.url === '/watchlist/delete' && req.method === 'POST') {
  if (!watchlistController) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Controller not initialized' }));
    return;
  }
  
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { ticker, watchlist } = JSON.parse(body);
      
      if (!ticker) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ticker required' }));
        return;
      }

      // Switch to watchlist tab if specified
      if (watchlist) {
        await watchlistController.switchToTab(watchlist);
      }

      const result = await watchlistController.deleteTicker(ticker);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}

if (req.url === '/watchlist/switch' && req.method === 'POST') {
  if (!watchlistController) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Controller not initialized' }));
    return;
  }
  
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { watchlist } = JSON.parse(body);
      
      if (!watchlist) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'watchlist name required' }));
        return;
      }

      const success = await watchlistController.switchToTab(watchlist);
      res.writeHead(success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success, watchlist }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}
```

---

### Step 11.3: API Specification

| Endpoint | Method | Request Body | Response | Description |
|----------|--------|--------------|----------|-------------|
| `/watchlist/status` | GET | - | `{isInitialized, currentWatchlist, queueLength}` | Controller status |
| `/watchlist/tabs` | GET | - | `{tabs: ["Main", "Tech", ...]}` | List watchlist tabs |
| `/watchlist/tickers` | GET | - | `{tickers: ["AAPL", ...], count: 5}` | List tickers in current watchlist |
| `/watchlist/add` | POST | `{ticker, watchlist?}` | `{success, message}` | Add ticker to watchlist |
| `/watchlist/delete` | POST | `{ticker, watchlist?}` | `{success, message}` | Delete ticker from watchlist |
---

### Step 11.6: Dashboard Integration

**File**: Add to `dashboard/server.js`

```javascript
// Proxy endpoints to scrape daemon for watchlist management (multi-provider)

const SCRAPER_HOST = process.env.SCRAPER_HOST || 'scrapers';
const SCRAPER_PORT = process.env.SCRAPER_PORT || '3002';

// GET /api/watchlist/providers - List all providers
app.get('/api/watchlist/providers', async (req, res) => {
  try {
    const response = await fetch(`http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/providers`);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to contact scraper' });
  }
});

// GET /api/watchlist/:provider/status
app.get('/api/watchlist/:provider/status', async (req, res) => {
  try {
    const response = await fetch(`http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/status`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to contact scraper' });
  }
});

// GET /api/watchlist/:provider/tabs
app.get('/api/watchlist/:provider/tabs', async (req, res) => {
  try {
    const response = await fetch(`http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/tabs`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to contact scraper' });
  }
});

// GET /api/watchlist/:provider/tickers
app.get('/api/watchlist/:provider/tickers', async (req, res) => {
  try {
    const response = await fetch(`http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/tickers`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to contact scraper' });
  }
});

// POST /api/watchlist/:provider/add
app.post('/api/watchlist/:provider/add', async (req, res) => {
  try {
    const response = await fetch(`http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to contact scraper' });
  }
});

// POST /api/watchlist/:provider/delete
app.post('/api/watchlist/:provider/delete', async (req, res) => {
  try {
    const response = await fetch(`http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to contact scraper' });
  }
});
```

---

### Step 11.7: Dashboard UI Components (Multi-Provider)

**File**: `dashboard/public/js/watchlist-manager.js`

```javascript
/**
 * Watchlist Manager UI Component
 * 
 * Provides UI for managing watchlist tickers across multiple providers.
 * Supports Investing.com (stocks/ETFs only) with extensibility for future providers.
 */

class WatchlistManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.providers = {};
    this.currentProvider = null;
    this.currentWatchlist = null;
    this.tickers = [];
    this.init();
  }

  async init() {
    await this.loadProviders();
    this.render();
  }

  async loadProviders() {
    try {
      const response = await fetch('/api/watchlist/providers');
      const data = await response.json();
      this.providers = data.capabilities || {};
      this.currentProvider = data.initialized?.[0] || null;
    } catch (e) {
      console.error('Failed to load providers:', e);
    }
  }

  render() {
    const providerOptions = Object.entries(this.providers)
      .map(([id, caps]) => `<option value="${id}">${caps.displayName}</option>`)
      .join('');

    const currentCaps = this.providers[this.currentProvider] || {};
    const supportedTypes = currentCaps.supportedAssetTypes || [];
    const typeWarning = supportedTypes.length > 0 
      ? `<small class="asset-type-warning">Supports: ${supportedTypes.join(', ')} only</small>`
      : '';

    this.container.innerHTML = `
      <div class="watchlist-manager">
        <h3>Watchlist Manager</h3>
        
        <div class="provider-select">
          <label>Provider:</label>
          <select id="provider-select">
            ${providerOptions}
          </select>
          ${typeWarning}
        </div>
        
        <div class="watchlist-tabs">
          <label>Watchlist:</label>
          <select id="watchlist-select">
            <option value="">Loading...</option>
          </select>
        </div>
        
        <div class="add-ticker-form">
          <input type="text" id="add-ticker-input" placeholder="Enter ticker (e.g., AAPL)" />
          <select id="asset-type-select">
            ${supportedTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
          <button id="add-ticker-btn">+ Add</button>
        </div>
        
        <div class="ticker-list" id="ticker-list">
          <p>Loading tickers...</p>
        </div>
        
        <div class="status" id="watchlist-status"></div>
      </div>
    `;

    this.bindEvents();
    if (this.currentProvider) {
      this.loadTabs();
      this.loadTickers();
    }
  }

  bindEvents() {
    document.getElementById('provider-select').addEventListener('change', async (e) => {
      this.currentProvider = e.target.value;
      this.render();
    });

    document.getElementById('watchlist-select').addEventListener('change', async (e) => {
      await this.switchWatchlist(e.target.value);
    });

    document.getElementById('add-ticker-btn').addEventListener('click', async () => {
      const input = document.getElementById('add-ticker-input');
      const typeSelect = document.getElementById('asset-type-select');
      const ticker = input.value.trim().toUpperCase();
      const assetType = typeSelect.value;
      
      if (ticker) {
        await this.addTicker(ticker, assetType);
        input.value = '';
      }
    });

    document.getElementById('add-ticker-input').addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        document.getElementById('add-ticker-btn').click();
      }
    });
  }

  async loadTabs() {
    if (!this.currentProvider) return;
    
    try {
      const response = await fetch(`/api/watchlist/${this.currentProvider}/tabs`);
      const data = await response.json();
      
      const select = document.getElementById('watchlist-select');
      select.innerHTML = (data.tabs || []).map(tab => 
        `<option value="${tab}">${tab}</option>`
      ).join('');
      
      this.currentWatchlist = data.tabs?.[0] || null;
    } catch (e) {
      this.showStatus('Failed to load watchlist tabs', 'error');
    }
  }

  async loadTickers() {
    if (!this.currentProvider) return;
    
    try {
      const response = await fetch(`/api/watchlist/${this.currentProvider}/tickers`);
      const data = await response.json();
      
      this.tickers = data.tickers || [];
      this.renderTickerList();
    } catch (e) {
      this.showStatus('Failed to load tickers', 'error');
    }
  }

  renderTickerList() {
    const list = document.getElementById('ticker-list');
    
    if (this.tickers.length === 0) {
      list.innerHTML = '<p>No tickers in this watchlist</p>';
      return;
    }

    list.innerHTML = `
      <table class="ticker-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${this.tickers.map(ticker => `
            <tr>
              <td>${ticker}</td>
              <td>
                <button class="delete-btn" data-ticker="${ticker}">🗑️ Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Bind delete buttons
    list.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ticker = btn.dataset.ticker;
        if (confirm(`Delete ${ticker} from watchlist?`)) {
          await this.deleteTicker(ticker);
        }
      });
    });
  }

  async switchWatchlist(watchlist) {
    if (!this.currentProvider) return;
    
    try {
      this.showStatus('Switching watchlist...', 'info');
      this.currentWatchlist = watchlist;
      await this.loadTickers();
      this.showStatus(`Switched to ${watchlist}`, 'success');
    } catch (e) {
      this.showStatus('Error switching watchlist', 'error');
    }
  }

  async addTicker(ticker, assetType = 'stock') {
    if (!this.currentProvider) return;
    
    try {
      this.showStatus(`Adding ${ticker}...`, 'info');
      
      const response = await fetch(`/api/watchlist/${this.currentProvider}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, watchlist: this.currentWatchlist, assetType })
      });
      
      const data = await response.json();
      
      if (data.success) {
        await this.loadTickers();
        this.showStatus(`Added ${ticker}`, 'success');
      } else {
        // Show detailed error for unsupported asset types
        const errorMsg = data.error === 'UNSUPPORTED_ASSET_TYPE' 
          ? data.message 
          : (data.message || 'Failed to add ticker');
        this.showStatus(errorMsg, 'error');
      }
    } catch (e) {
      this.showStatus('Error adding ticker', 'error');
    }
  }

  async deleteTicker(ticker) {
    if (!this.currentProvider) return;
    
    try {
      this.showStatus(`Deleting ${ticker}...`, 'info');
      
      const response = await fetch(`/api/watchlist/${this.currentProvider}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, watchlist: this.currentWatchlist })
      });
      
      const data = await response.json();
      
      if (data.success) {
        await this.loadTickers();
        this.showStatus(`Deleted ${ticker}`, 'success');
      } else {
        this.showStatus(data.message || 'Failed to delete ticker', 'error');
      }
    } catch (e) {
      this.showStatus('Error deleting ticker', 'error');
    }
  }

  showStatus(message, type = 'info') {
    const status = document.getElementById('watchlist-status');
    status.className = `status ${type}`;
    status.textContent = message;
    
    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        status.textContent = '';
      }, 3000);
    }
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('watchlist-manager')) {
    new WatchlistManager('watchlist-manager');
  }
});
```

---

### Step 11.8: Unit Tests

**File**: `tests/unit/scrapers/watchlist/base_watchlist_controller.test.js`

```javascript
/**
 * Unit Tests for BaseWatchlistController
 */

const { BaseWatchlistController, AssetType } = require('../../../../scrapers/watchlist/base_watchlist_controller');

describe('BaseWatchlistController', () => {
  test('should not allow direct instantiation', () => {
    expect(() => new BaseWatchlistController({})).toThrow('abstract');
  });

  test('AssetType enum should have expected values', () => {
    expect(AssetType.STOCK).toBe('stock');
    expect(AssetType.ETF).toBe('etf');
    expect(AssetType.BOND).toBe('bond');
    expect(AssetType.TREASURY).toBe('treasury');
  });
});
```

**File**: `tests/unit/scrapers/watchlist/investingcom_watchlist_controller.test.js`

```javascript
/**
 * Unit Tests for InvestingComWatchlistController
 */

const { InvestingComWatchlistController } = require('../../../../scrapers/watchlist/investingcom_watchlist_controller');
const { AssetType } = require('../../../../scrapers/watchlist/base_watchlist_controller');

describe('InvestingComWatchlistController', () => {
  let mockBrowser;
  let mockPage;
  let controller;

  beforeEach(() => {
    mockPage = {
      waitForSelector: jest.fn().mockResolvedValue(true),
      click: jest.fn().mockResolvedValue(undefined),
      type: jest.fn().mockResolvedValue(undefined),
      $$: jest.fn().mockResolvedValue([]),
      $: jest.fn().mockResolvedValue(null),
      $$eval: jest.fn().mockResolvedValue([]),
      evaluate: jest.fn().mockResolvedValue('AAPL'),
      hover: jest.fn().mockResolvedValue(undefined),
      isClosed: jest.fn().mockReturnValue(false)
    };

    mockBrowser = {
      pages: jest.fn().mockResolvedValue([mockPage]),
      newPage: jest.fn().mockResolvedValue(mockPage)
    };
  });

  describe('initialization', () => {
    test('should initialize with browser', async () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      expect(controller.isInitialized).toBe(false);
    });
  });

  describe('addTicker()', () => {
    test('should queue add operations', async () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      controller.isInitialized = true;
      controller.page = mockPage;
      
      mockPage.$$.mockResolvedValue([{
        $: jest.fn().mockResolvedValue({ textContent: 'AAPL' })
      }]);

      const result = await controller.addTicker('AAPL');
      
      expect(result).toBeDefined();
      expect(mockPage.waitForSelector).toHaveBeenCalled();
    });
  });

  describe('deleteTicker()', () => {
    test('should find and delete ticker row', async () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      controller.isInitialized = true;
      controller.page = mockPage;
      
      // Mock finding the ticker row
      const mockRow = {
        $: jest.fn().mockResolvedValue({
          textContent: 'TSLA'
        }),
        hover: jest.fn().mockResolvedValue(undefined)
      };
      
      mockPage.$$.mockResolvedValue([mockRow]);
      mockPage.evaluate.mockResolvedValue('TSLA');

      const result = await controller.deleteTicker('TSLA');
      
      expect(result).toBeDefined();
    });
  });

  describe('operation queue', () => {
    test('should process operations sequentially', async () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      controller.isInitialized = true;
      controller.page = mockPage;
      
      const order = [];
      
      const op1 = controller._queueOperation(async () => {
        order.push(1);
        await new Promise(r => setTimeout(r, 50));
        return 1;
      });
      
      const op2 = controller._queueOperation(async () => {
        order.push(2);
        return 2;
      });
      
      await Promise.all([op1, op2]);
      
      expect(order).toEqual([1, 2]);
    });
  });

  describe('getCapabilities()', () => {
    test('should return Investing.com capabilities', () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      const caps = controller.getCapabilities();
      
      expect(caps.providerId).toBe('investingcom');
      expect(caps.displayName).toBe('Investing.com');
      expect(caps.supportedAssetTypes).toContain('stock');
      expect(caps.supportedAssetTypes).toContain('etf');
      expect(caps.supportedAssetTypes).not.toContain('treasury');
      expect(caps.supportedAssetTypes).not.toContain('bond');
    });
  });

  describe('validateTicker()', () => {
    test('should accept stocks', () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      const result = controller.validateTicker('AAPL', 'stock');
      expect(result.valid).toBe(true);
    });

    test('should accept ETFs', () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      const result = controller.validateTicker('SPY', 'etf');
      expect(result.valid).toBe(true);
    });

    test('should reject treasuries', () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      const result = controller.validateTicker('US912828ZT58', 'treasury');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not support treasury');
    });

    test('should reject bonds', () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      const result = controller.validateTicker('IBM-BOND', 'bond');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not support bond');
    });
  });

  describe('addTicker() with asset type validation', () => {
    test('should reject unsupported asset type before queueing', async () => {
      controller = new InvestingComWatchlistController(mockBrowser);
      controller.isInitialized = true;
      controller.page = mockPage;

      const result = await controller.addTicker('US912828ZT58', { assetType: 'treasury' });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('UNSUPPORTED_ASSET_TYPE');
      // Should NOT have tried to interact with page
      expect(mockPage.waitForSelector).not.toHaveBeenCalled();
    });
  });
});
```

**File**: `tests/unit/scrapers/watchlist/watchlist_manager.test.js`

```javascript
/**
 * Unit Tests for WatchlistManager
 */

const { WatchlistManager, AssetType } = require('../../../../scrapers/watchlist/watchlist_manager');
const { InvestingComWatchlistController } = require('../../../../scrapers/watchlist/investingcom_watchlist_controller');

describe('WatchlistManager', () => {
  let manager;

  beforeEach(() => {
    manager = new WatchlistManager();
  });

  describe('registerProvider()', () => {
    test('should register a provider', () => {
      manager.registerProvider('test', InvestingComWatchlistController, {});
      expect(manager.getRegisteredProviders()).toContain('test');
    });
  });

  describe('getProvidersForAssetType()', () => {
    test('should find providers that support stocks', () => {
      manager.registerProvider('investingcom', InvestingComWatchlistController, {});
      const providers = manager.getProvidersForAssetType(AssetType.STOCK);
      expect(providers).toContain('investingcom');
    });

    test('should not find providers for unsupported types', () => {
      manager.registerProvider('investingcom', InvestingComWatchlistController, {});
      const providers = manager.getProvidersForAssetType(AssetType.TREASURY);
      expect(providers).not.toContain('investingcom');
    });
  });

  describe('getAllCapabilities()', () => {
    test('should return capabilities for all registered providers', () => {
      manager.registerProvider('investingcom', InvestingComWatchlistController, {});
      const caps = manager.getAllCapabilities();
      
      expect(caps.investingcom).toBeDefined();
      expect(caps.investingcom.displayName).toBe('Investing.com');
    });
  });
});
```

---

### Step 11.9: Considerations & Risks

| Risk | Mitigation |
|------|------------|
| **Investing.com UI changes** | Configurable selectors, fallback patterns, selector versioning |
| **Rate limiting by Investing.com** | Queue operations, add delays, respect site limits |
| **Session expiration** | Re-login detection and auto-reconnect |
| **Concurrent operations** | Operation queue prevents race conditions |
| **Page crash during operation** | Error handling, page health checks |
| **Selector changes** | Abstract selectors to config, easy updates |
| **Unsupported asset types** | Pre-validation before queuing, clear error messages |
| **Provider-specific behaviors** | Abstract interface with provider-specific implementations |

### Important Notes

1. **Asset Type Validation**: Always validate asset type BEFORE attempting to add. Investing.com only supports stocks and ETFs.

2. **Selector Maintenance**: The CSS selectors in the controller will likely need adjustment based on actual Investing.com page structure. Inspect the page manually to get accurate selectors.

3. **Login State**: The controller relies on the persistent page already being logged in. If login expires, the scraper's existing login flow should re-authenticate.

4. **Rate Limiting**: Investing.com may block automated actions if done too quickly. The operation queue and delays help mitigate this.

5. **Terms of Service**: Automated interaction with websites may violate their ToS. Use responsibly and consider rate limits.

6. **Future Providers**: To add a new provider (e.g., TradingView, MarketWatch):
   - Create new controller extending `BaseWatchlistController`
   - Implement all abstract methods
   - Define `getCapabilities()` with supported asset types
   - Register with `watchlistManager.registerProvider()`

---

## Implementation Order & Dependencies

```
Phase 1 ─────────────────────────────────────────────────────►
  │ listing_sync_service.js foundation
  │
  └─► Phase 2 ───────────────────────────────────────────────►
       │ HTTP API endpoints
       │
       └─► Phase 3 ──────────────────────────────────────────►
            │ exchange_registry.js refactor
            │
            ├─► Phase 4 ─────────────────────────────────────►
            │    │ ticker_registry.js refactor
            │    │
            │    └─► Phase 5 ────────────────────────────────►
            │         │ treasury_registry.js refactor
            │         │
            └─────────┴─► Phase 6 ───────────────────────────►
                          │ Remove listing logic from scrape_daemon
                          │
                          ├─► Phase 7 ───────────────────────►
                          │    │ Page pool for parallel scraping
                          │    │ (includes Step 7.2: Persistent pages)
                          │    │
                          │    └─► Phase 8 ──────────────────►
                          │    │    │ On-demand scrape endpoint
                          │    │    │
                          │    │    └─► Phase 9 ─────────────►
                          │    │         Integration testing & docs
                          │    │
                          │    └─► Phase 11 ─────────────────►
                          │         │ Extensible Watchlist Management API
                          │         │ (depends on persistent page registry)
                          │         └────────────────────────────►
                          │
                          └─► Phase 10 ──────────────────────►
                               │ Separate API scrapers (parallel track)
                               │ Can run independently after Phase 6
                               └─────────────────────────────────►
```

**Notes**: 
- Phase 10 can be developed in parallel with Phases 7-9 since it's independent after Phase 6 (removing listing logic from scrape_daemon).
- Phase 11 depends on Step 7.2 (Persistent Page Registry) for managing stateful pages with login sessions.

---

## Success Criteria

### Phase 1 Complete When:
- [ ] CsvDownloader class created and tested
- [ ] ListingSyncService class created and tested
- [ ] Unit tests passing (>90% coverage)
- [ ] CI pipeline updated

### Phase 2 Complete When:
- [ ] All HTTP endpoints implemented
- [ ] Integration tests passing
- [ ] API documentation complete

### Phase 3-5 Complete When:
- [ ] All services query DB
- [ ] DB pool initialization required at startup
- [ ] Existing tests still pass
- [ ] No regression in functionality

### Phase 6 Complete When:
- [ ] scrape_daemon no longer handles listing downloads
- [ ] scrape_daemon initializes exchange registry with DB pool
- [ ] Price scraping unaffected

### Phase 7 Complete When:
- [ ] PagePool class created and tested
- [ ] Configurable pool size via environment
- [ ] Resource blocking (images, fonts) for memory savings
- [ ] Page recycling after max operations
- [ ] Wait queue for page acquisition
- [ ] Graceful shutdown handling
- [ ] PersistentPageRegistry for stateful pages (Step 7.2)
- [ ] Integration with `reuseIfUrlMatches` pattern

### Phase 8 Complete When:
- [ ] On-demand scrape endpoint functional
- [ ] Dashboard can request specific ticker prices
- [ ] Uses page pool for parallel execution
- [ ] Rate limiting in place

### Phase 9 Complete When:
- [ ] All E2E tests passing
- [ ] Documentation complete
- [ ] Docker/PM2 configs updated
- [ ] README updated

### Phase 10 Complete When:
- [ ] BaseApiClient abstract class created
- [ ] YahooApiClient created and tested
- [ ] TreasuryApiClient created and tested
- [ ] ApiScraperDaemon orchestrator created
- [ ] Lightweight Dockerfile.api-scraper created (256MB limit)
- [ ] docker-compose.yml updated with api-scraper service
- [ ] Yahoo batch removed from scrape_daemon.js
- [ ] API scraper runs independently of browser scraper
- [ ] Unit tests passing (>90% coverage)
- [ ] Integration tests with mock APIs passing

### Phase 11 Complete When:

**Configuration (Step 11.0):**
- [x] Database schema created (watchlist_providers, watchlist_instances tables)
- [x] WatchlistConfigLoader service created
- [x] Database seeded via init script (001-listing-sync-watchlist.sql)
- [x] Per-watchlist URLs stored in DB (watchlist_instances.url) with config fallback
- [x] Per-watchlist asset type constraints supported

**Base Infrastructure:**
- [x] BaseWatchlistController abstract class created
- [x] AssetType enum defined (stock, etf, bond, treasury, etc.)
- [x] WatchlistManager provider registry created

**Provider Implementation:**
- [x] InvestingComWatchlistController extends BaseWatchlistController
- [x] Asset type validation rejects unsupported types (only stock/etf for Investing.com)
- [x] Operation queue prevents concurrent modifications

**API & Dashboard:**
- [x] HTTP endpoints use provider-based routing (/watchlist/{provider}/*)
- [x] Dashboard proxy endpoints support multiple providers
- [x] Dashboard UI shows supported asset types per provider
- [x] Add ticker functionality with asset type validation
- [x] Delete ticker functionality working
- [x] Switch watchlist tab functionality working

**Testing & Documentation:**
- [x] Unit tests passing (>80% coverage)
- [x] Tests cover asset type validation rejection
- [x] Tests cover config loading from DB
- [x] Documentation for adding new providers

**Scheduling Integration:**
- [x] Integrates with existing `getScrapeGroupSettings()`/`shouldRunTask()` pattern
- [x] Marker files created per watchlist instance (`last.watchlist.{provider}.{key}.txt`)
- [x] UpdateWindowService created with DB support
- [x] Per-ticker and per-watchlist update windows working
- [x] Scheduling hierarchy documented (group → provider → instance → windows)

---

## Error Handling & Logging Standards

### Core Principle: No Silent Errors

**Every error MUST be logged.** Silent failures make debugging impossible and mask systemic issues.

### Error Logging Requirements

```javascript
// ❌ FORBIDDEN - Silent catch
try {
  await doSomething();
} catch (e) {
  // Silent - NO!
}

// ❌ FORBIDDEN - Swallowed error
try {
  await doSomething();
} catch (e) {
  return null; // Error lost - NO!
}

// ✅ REQUIRED - Always log with context
try {
  await doSomething();
} catch (e) {
  console.error(`[ServiceName] Operation failed: ${e.message}`, {
    operation: 'doSomething',
    context: { ticker, source },
    stack: e.stack
  });
  throw e; // Re-throw or return error indicator
}

// ✅ REQUIRED - If recovering, still log
try {
  await doSomething();
} catch (e) {
  console.warn(`[ServiceName] Operation failed, using fallback: ${e.message}`, {
    operation: 'doSomething',
    fallback: 'defaultValue'
  });
  return defaultValue; // Recovery is OK if logged
}
```

### Logging Levels

| Level | Usage | Example |
|-------|-------|---------|
| `console.error()` | Unrecoverable errors, failures | DB connection failed, scraper crashed |
| `console.warn()` | Recoverable errors, fallbacks | Using cached value, retry succeeded |
| `console.log()` | Normal operations | Sync completed, page acquired |
| `console.debug()` | Verbose debugging (controlled by env) | SQL queries, HTTP responses |

### Standard Log Format

All log messages MUST include:

```javascript
console.error(`[${SERVICE_NAME}] ${ACTION} failed: ${error.message}`, {
  // REQUIRED fields
  timestamp: new Date().toISOString(),
  service: SERVICE_NAME,
  action: 'methodName',
  error: error.message,
  
  // CONTEXTUAL fields (include what's relevant)
  ticker: ticker,
  source: sourceName,
  url: url,
  attempt: attemptNumber,
  
  // OPTIONAL but helpful
  stack: error.stack,
  duration: `${Date.now() - startTime}ms`
});
```

### Error Categories & Handling

| Category | Log Level | Action | Re-throw? |
|----------|-----------|--------|-----------|
| **Fatal** (DB down, no browser) | `error` | Exit process | N/A |
| **Operational** (scrape failed) | `error` | Log + continue to next | No |
| **Transient** (timeout, retry) | `warn` | Log + retry | After max retries |
| **Validation** (bad input) | `warn` | Log + reject request | No |
| **Expected** (ticker not found) | `debug` | Log + return null | No |

### Per-Service Error Handling

#### ListingSyncService
```javascript
class ListingSyncService {
  async syncAll() {
    const results = { success: [], failed: [] };
    
    for (const source of SOURCES) {
      try {
        await this.syncSource(source);
        results.success.push(source);
      } catch (e) {
        // ALWAYS log, never silent
        console.error(`[ListingSyncService] Sync failed for ${source}: ${e.message}`, {
          source,
          stack: e.stack
        });
        results.failed.push({ source, error: e.message });
        // Continue to next source, don't abort entire sync
      }
    }
    
    // Log summary
    console.log(`[ListingSyncService] Sync complete: ${results.success.length} succeeded, ${results.failed.length} failed`);
    
    if (results.failed.length > 0) {
      console.warn(`[ListingSyncService] Failed sources: ${results.failed.map(f => f.source).join(', ')}`);
    }
    
    return results;
  }
}
```

#### PagePool
```javascript
class PagePool {
  async acquirePage(ticker, timeout = 30000) {
    const startTime = Date.now();
    
    try {
      const page = await this._acquireWithTimeout(timeout);
      console.log(`[PagePool] Acquired page #${page.id} for ${ticker} in ${Date.now() - startTime}ms`);
      return page;
    } catch (e) {
      console.error(`[PagePool] Failed to acquire page for ${ticker}: ${e.message}`, {
        ticker,
        timeout,
        availablePages: this.getAvailableCount(),
        queueLength: this.waitQueue.length,
        stack: e.stack
      });
      throw e; // Re-throw - caller must handle
    }
  }
  
  async releasePage(pageId) {
    try {
      await this._releaseInternal(pageId);
      console.log(`[PagePool] Released page #${pageId}`);
    } catch (e) {
      // Release errors are serious - log but don't throw
      console.error(`[PagePool] Failed to release page #${pageId}: ${e.message}`, {
        pageId,
        stack: e.stack
      });
      // Attempt recovery
      await this._forceRecyclePage(pageId);
    }
  }
}
```

#### HTTP API Endpoints
```javascript
app.get('/api/scrape/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const requestId = crypto.randomUUID();
  
  console.log(`[API] Request ${requestId}: Scrape ${ticker}`);
  
  try {
    const result = await scrapeService.scrapeTicker(ticker);
    console.log(`[API] Request ${requestId}: Success for ${ticker}`);
    res.json({ success: true, data: result });
  } catch (e) {
    // ALWAYS log API errors
    console.error(`[API] Request ${requestId}: Failed for ${ticker}: ${e.message}`, {
      requestId,
      ticker,
      method: 'GET',
      path: `/api/scrape/${ticker}`,
      stack: e.stack
    });
    
    // Return error to client (don't expose stack in production)
    res.status(500).json({
      success: false,
      error: e.message,
      requestId // Include for support correlation
    });
  }
});
```

#### Database Operations
```javascript
async function executeQuery(sql, params, context = {}) {
  const startTime = Date.now();
  
  try {
    const result = await pool.execute(sql, params);
    console.debug(`[DB] Query succeeded in ${Date.now() - startTime}ms`, {
      ...context,
      rowCount: result[0]?.length || result.affectedRows
    });
    return result;
  } catch (e) {
    console.error(`[DB] Query failed: ${e.message}`, {
      sql: sql.substring(0, 200), // Truncate for logs
      params: params?.length,
      context,
      errorCode: e.code,
      stack: e.stack
    });
    throw e; // Re-throw for caller to handle
  }
}
```

### Async Error Handling

```javascript
// ❌ FORBIDDEN - Unhandled promise rejection
someAsyncFunction(); // Fire and forget - NO!

// ✅ REQUIRED - Always handle async errors
someAsyncFunction().catch(e => {
  console.error(`[Service] Async operation failed: ${e.message}`, { stack: e.stack });
});

// ✅ REQUIRED - Or use try/catch in async context
try {
  await someAsyncFunction();
} catch (e) {
  console.error(`[Service] Async operation failed: ${e.message}`, { stack: e.stack });
}
```

### Global Error Handlers

```javascript
// services/error_handler.js

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString()
  });
  // Don't exit - log and continue
});

// Catch uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', {
    error: error.message,
    stack: error.stack
  });
  // Exit after logging - state may be corrupted
  process.exit(1);
});

// Graceful shutdown logging
process.on('SIGTERM', () => {
  console.log('[Service] Received SIGTERM, shutting down gracefully...');
});

process.on('SIGINT', () => {
  console.log('[Service] Received SIGINT, shutting down gracefully...');
});
```

### Error Aggregation for Batch Operations

```javascript
class BatchProcessor {
  async processBatch(items) {
    const errors = [];
    const results = [];
    
    for (const item of items) {
      try {
        const result = await this.processItem(item);
        results.push(result);
      } catch (e) {
        // Log each error individually
        console.error(`[BatchProcessor] Item failed: ${e.message}`, {
          item: item.id,
          error: e.message
        });
        errors.push({ item: item.id, error: e.message });
      }
    }
    
    // Log batch summary
    if (errors.length > 0) {
      console.error(`[BatchProcessor] Batch completed with ${errors.length}/${items.length} failures`, {
        totalItems: items.length,
        successes: results.length,
        failures: errors.length,
        failedItems: errors.map(e => e.item)
      });
    } else {
      console.log(`[BatchProcessor] Batch completed: ${results.length} items processed`);
    }
    
    return { results, errors };
  }
}
```

### Checklist: No Silent Errors

Before merging any phase, verify:

- [ ] Every `catch` block has a `console.error()` or `console.warn()`
- [ ] Every async function has error handling
- [ ] API endpoints return error details to clients
- [ ] Database errors include query context
- [ ] Batch operations log per-item AND summary errors
- [ ] Global handlers catch unhandled rejections
- [ ] Log messages include service name in brackets `[ServiceName]`
- [ ] Stack traces logged for unexpected errors
- [ ] No empty catch blocks `catch (e) {}`
- [ ] No catch blocks with only `return null`

---

## Implementation Considerations

This section documents known issues and patterns to address during implementation.

### Database Startup Race Condition

**Problem**: Services may start before Docker init scripts complete on fresh containers.

**Solution**: Implement graceful startup with exponential backoff:

```javascript
// services/db_startup.js

/**
 * Wait for database to be ready with exponential backoff
 * @param {Object} pool - MySQL connection pool
 * @param {number} maxRetries - Maximum retry attempts (default: 10)
 * @returns {Promise<void>}
 * @throws {Error} If database unavailable after all retries
 */
async function waitForDatabase(pool, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const conn = await pool.getConnection();
      // Verify init scripts have run by checking for required table
      const [rows] = await conn.execute(
        'SELECT 1 FROM ticker_registry LIMIT 1'
      );
      conn.release();
      console.log('[Startup] Database ready');
      return;
    } catch (e) {
      const delay = Math.min(1000 * Math.pow(2, i), 30000); // Max 30s
      console.log(`[Startup] DB not ready (${e.code}), retry ${i + 1}/${maxRetries} in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Database unavailable after retries - init scripts may not have completed');
}

module.exports = { waitForDatabase };
```

**Usage in scrape_daemon.js**:

```javascript
const { waitForDatabase } = require('../services/db_startup');
const { initializeDbPool: initExchangeDb } = require('./exchange_registry');
const { initializeDbPool: initTickerDb } = require('../dashboard/ticker_registry');
const { initializeDbPool: initTreasuryDb } = require('./treasury_registry');

async function startup() {
  const pool = await createPool();
  
  // Wait for DB and init scripts
  await waitForDatabase(pool);
  
  // Initialize all registries (order doesn't matter, all need pool)
  initExchangeDb(pool);
  initTickerDb(pool);
  initTreasuryDb(pool);
  
  console.log('[Startup] All registries initialized');
  
  // Now safe to start scraping
  startScrapeDaemon();
}
```

### Sync-to-Async Migration Checklist

**Problem**: All registry functions changed from sync to async. Missing `await` returns Promise objects instead of values.

**Files requiring audit for async migration**:

| File | Functions to Update |
|------|---------------------|
| `scrapers/scrape_daemon.js` | All calls to `getExchange()`, `isBondTicker()` |
| `dashboard/server.js` | Autocomplete handlers calling `loadAllTickers()` |
| `api/autocomplete.js` | Ticker lookup calls |
| `api/statistics.js` | Exchange categorization |
| `services/price_service.js` | Ticker validation |

**Search pattern to find affected code**:

```bash
# Find sync calls that need await
grep -rn "getExchange\|loadAllTickers\|isBondTicker" --include="*.js" \
  | grep -v "async\|await\|test\|spec"
```

**Breaking change example**:

```javascript
// BEFORE (sync) - worked
function processTickerSync(ticker) {
  const exchange = getExchange(ticker);
  if (exchange === 'NASDAQ') { /* ... */ }
}

// AFTER (async) - BROKEN without await
function processTickerBroken(ticker) {
  const exchange = getExchange(ticker); // Returns Promise, not string!
  if (exchange === 'NASDAQ') { /* never true */ }
}

// AFTER (async) - CORRECT
async function processTickerFixed(ticker) {
  const exchange = await getExchange(ticker);
  if (exchange === 'NASDAQ') { /* works */ }
}
```

### Connection Pool Configuration

**Problem**: Multiple registry modules each acquire connections. Parallel operations can exhaust pool.

**Recommended pool settings**:

```javascript
// services/db_pool.js

const poolConfig = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  
  // Connection limits
  connectionLimit: 20,        // Increased from default 10
  queueLimit: 50,             // Queue requests when pool exhausted
  waitForConnections: true,   // Wait rather than error immediately
  
  // Timeouts
  connectTimeout: 10000,      // 10s to establish connection
  acquireTimeout: 10000,      // 10s to acquire from pool
  
  // Keep-alive
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000
};
```

**Connection usage pattern** (always release):

```javascript
async function queryWithRelease(pool, sql, params) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(sql, params);
    return rows;
  } finally {
    conn.release(); // ALWAYS release, even on error
  }
}
```

### Test Database Setup

**Problem**: Tests need database access but shouldn't pollute production data.

**Recommended test setup**:

```javascript
// tests/setup/test_db.js

const mysql = require('mysql2/promise');

let testPool = null;

/**
 * Create test database pool
 * Uses separate test database or transaction isolation
 */
async function setupTestDb() {
  testPool = await mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'test',
    database: process.env.MYSQL_TEST_DATABASE || 'wealth_tracker_test',
    connectionLimit: 5
  });
  
  // Initialize registries with test pool
  const { initializeDbPool: initExchange } = require('../../scrapers/exchange_registry');
  const { initializeDbPool: initTicker } = require('../../dashboard/ticker_registry');
  const { initializeDbPool: initTreasury } = require('../../scrapers/treasury_registry');
  
  initExchange(testPool);
  initTicker(testPool);
  initTreasury(testPool);
  
  return testPool;
}

/**
 * Clean up test data after each test
 * Uses prefix convention: test data uses 'TEST-' prefix
 */
async function cleanupTestData() {
  if (!testPool) return;
  
  await testPool.execute("DELETE FROM watchlist_instances WHERE watchlist_key LIKE 'test-%'");
  await testPool.execute("DELETE FROM update_windows WHERE ticker LIKE 'TEST-%'");
  await testPool.execute("DELETE FROM ticker_registry WHERE ticker LIKE 'TEST-%'");
}

/**
 * Close test pool
 */
async function teardownTestDb() {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

module.exports = {
  setupTestDb,
  cleanupTestData,
  teardownTestDb,
  getTestPool: () => testPool
};
```

**Jest configuration**:

```javascript
// tests/setup/jest.setup.js

const { setupTestDb, cleanupTestData, teardownTestDb } = require('./test_db');

beforeAll(async () => {
  await setupTestDb();
});

afterEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await teardownTestDb();
});
```

### Init Script Dependencies

**Problem**: `001-listing-sync-watchlist.sql` may reference tables from other init scripts.

**Verification checklist**:

- [ ] `000-base-schema.sql` creates `ticker_registry` table
- [ ] Scripts are numbered to ensure execution order (000, 001, 002, 003...)
- [ ] Each script uses `CREATE TABLE IF NOT EXISTS` for idempotency
- [ ] Foreign keys reference existing tables only

**Add dependency check to init script**:

```sql
-- 001-listing-sync-watchlist.sql (add at top)

-- Verify dependencies exist
SELECT 'Checking dependencies...' AS status;

-- This will fail if ticker_registry doesn't exist, 
-- indicating init script ordering issue
SELECT COUNT(*) INTO @ticker_count FROM ticker_registry;
SELECT CONCAT('ticker_registry exists with ', @ticker_count, ' rows') AS status;

-- Continue with table creation...
```

### Test Database Init Scripts

**Problem**: Test database needs same schema as production but isolated data.

**Solution**: Run init scripts against test database during test setup:

```javascript
// tests/setup/init_test_db.js

const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

/**
 * Initialize test database with production schema
 * Runs all init scripts in order against test database
 */
async function initTestDbSchema() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'test',
    database: process.env.MYSQL_TEST_DATABASE || 'wealth_tracker_test',
    multipleStatements: true  // Required for running full SQL scripts
  });

  try {
    const initDir = path.join(__dirname, '../../scripts/init-db');
    
    // Get all init scripts in order
    const files = await fs.readdir(initDir);
    const sqlFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort(); // 000-, 001-, 002- ensures correct order
    
    for (const file of sqlFiles) {
      console.log(`[TestDB] Running ${file}...`);
      const sql = await fs.readFile(path.join(initDir, file), 'utf8');
      await conn.query(sql);
      console.log(`[TestDB] Completed ${file}`);
    }
    
    console.log('[TestDB] Schema initialization complete');
  } finally {
    await conn.end();
  }
}

module.exports = { initTestDbSchema };
```

**CI/CD pipeline integration**:

```yaml
# .github/workflows/test.yml
jobs:
  test:
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
      - uses: actions/checkout@v4
      
      - name: Initialize test database schema
        run: |
          npm run test:init-db
        env:
          MYSQL_HOST: 127.0.0.1
          MYSQL_USER: root
          MYSQL_PASSWORD: test
          MYSQL_TEST_DATABASE: wealth_tracker_test
      
      - name: Run tests
        run: npm test
```

**package.json script**:

```json
{
  "scripts": {
    "test:init-db": "node tests/setup/init_test_db.js",
    "test": "jest",
    "test:ci": "npm run test:init-db && npm test"
  }
}
```

### Health Check Graceful Handling

**Problem**: Health endpoints may be called before DB initialization completes.

**Solution**: Health checks should handle uninitialized state:

```javascript
// api/health.js

/**
 * Health check endpoint that handles startup state
 */
async function healthCheck(req, res) {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  // Database check
  try {
    const stats = await getCacheStats();
    health.checks.database = {
      status: 'ok',
      tickerCount: stats.count,
      hasConnection: stats.hasDbConnection
    };
  } catch (e) {
    // DB not initialized yet - report as degraded, not failed
    health.checks.database = {
      status: 'degraded',
      error: 'Database initializing',
      message: e.message
    };
    health.status = 'degraded';
  }

  // Return 200 even if degraded (let load balancer decide)
  // Return 503 only if completely down
  const httpStatus = health.status === 'ok' ? 200 : 
                     health.status === 'degraded' ? 200 : 503;
  
  res.status(httpStatus).json(health);
}
```

### Cache Invalidation Safety

**Problem**: Module-level caches (`exchangeCache`, `tickerCache`) can have race conditions during reload.

**Solution**: Use cache versioning or lock pattern:

```javascript
// Pattern: Cache with version token

let exchangeCache = null;
let cacheVersion = 0;

async function loadExchangeData() {
  if (exchangeCache) return exchangeCache;
  
  const myVersion = ++cacheVersion;
  const newCache = await loadFromDb();
  
  // Only update if no newer load started
  if (myVersion === cacheVersion) {
    exchangeCache = newCache;
  }
  
  return exchangeCache || newCache;
}

async function reloadExchangeData() {
  cacheVersion++; // Invalidate any in-flight loads
  exchangeCache = null;
  return loadExchangeData();
}
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| DB unavailable during startup | Graceful startup with exponential backoff (see Implementation Considerations) |
| Init script race condition | `waitForDatabase()` verifies tables exist before proceeding |
| Sync-to-async breaking changes | Audit checklist, grep search pattern (see Implementation Considerations) |
| Connection pool exhaustion | Increased pool size (20), queue limit (50), always-release pattern |
| Cache race conditions | Cache versioning pattern to handle concurrent reloads |
| High API request volume | Rate limiting, request queuing |
| Test database state pollution | Test isolation with cleanup, prefix convention (`test-*`, `TEST-*`) |
| Page pool memory leaks | Page recycling after N operations |
| Parallel scrape race conditions | Page acquisition queue with timeouts |
| API rate limits exceeded | Per-client rate limiting with configurable thresholds |
| User-specific URLs in version control | URLs stored in .env, only structure in config.json |
| Yahoo API changes | Version pinning, response validation |
| Unsupported asset types | Pre-validation before page interaction, clear error codes |
| Health check during startup | Graceful degraded state, return 200 with status info |
| **Silent errors masking failures** | **Mandatory logging in all catch blocks, code review checklist** |

---

## Security Considerations

### Input Validation

All external inputs MUST be validated before processing. This prevents injection attacks, crashes from malformed data, and unexpected behavior.

#### Ticker Symbol Validation

```javascript
// services/validators.js

/**
 * Ticker validation patterns by asset type.
 * 
 * CURRENT SCOPE: stock, etf, bond, treasury, crypto
 * 
 * NOT YET SUPPORTED (add when needed):
 * - options: Complex format like AAPL230120C00150000 (underlying + expiry + type + strike)
 * - futures: /ES, ES2312, CLZ24
 * - forex: EUR/USD, EURUSD
 * 
 * When adding new asset types:
 * 1. Add pattern to TICKER_PATTERNS
 * 2. Add any normalizations to TICKER_NORMALIZATIONS
 * 3. Update AssetType enum in watchlist_manager.js
 * 4. Update provider capabilities if applicable
 */
const TICKER_PATTERNS = {
  // Stocks: 1-5 uppercase letters, may include hyphen (BRK-B)
  stock: /^[A-Z]{1,5}(-[A-Z])?$/,           // AAPL, NVDA, BRK-B
  
  // ETFs: Same as stocks
  etf: /^[A-Z]{1,5}$/,                      // QQQ, VOO, TQQQ
  
  // Bonds/Treasuries: 9-character CUSIP
  bond: /^[A-Z0-9]{9}$/,                    // CUSIP: 91282CGA3 (may have letters)
  treasury: /^[A-Z0-9]{9}$/,                // CUSIP format
  
  // Crypto: Symbol or Symbol-Currency pair
  crypto: /^[A-Z]{2,10}(-[A-Z]{3,4})?$/,    // BTC, ETH, BTC-USD, ETH-USDT
  
  // Index: Typically prefixed with ^ or $
  index: /^[\^$]?[A-Z]{2,10}$/,             // ^GSPC, $SPX, SPX, DJI
  
  // Mutual funds: 5 letters ending in X
  mutual_fund: /^[A-Z]{5}$/,                // VFINX, FXAIX
  
  // Generic fallback for unknown types
  unknown: /^[A-Z0-9\-\.\/]{1,20}$/         // Permissive fallback
};

/**
 * Normalizations for common ticker variants
 */
const TICKER_NORMALIZATIONS = {
  // Berkshire Hathaway variants
  'BRK.B': 'BRK-B',
  'BRK/B': 'BRK-B',
  'BRKB': 'BRK-B',
  'BRK.A': 'BRK-A',
  'BRK/A': 'BRK-A',
  'BRKA': 'BRK-A',
  
  // Crypto common variants
  'BTCUSD': 'BTC-USD',
  'ETHUSD': 'ETH-USD'
};

/**
 * Validate and normalize a ticker symbol
 * @param {string} ticker - Raw ticker input
 * @param {string} assetType - Expected asset type
 * @returns {{ valid: boolean, ticker: string, error?: string }}
 */
function validateTicker(ticker, assetType = 'stock') {
  if (!ticker || typeof ticker !== 'string') {
    return { valid: false, ticker: null, error: 'Ticker is required' };
  }
  
  // Normalize
  let normalized = ticker.trim().toUpperCase();
  normalized = TICKER_NORMALIZATIONS[normalized] || normalized;
  
  // Length check (increased for potential future asset types)
  if (normalized.length > 20) {
    return { valid: false, ticker: null, error: 'Ticker too long (max 20 chars)' };
  }
  
  // Pattern check - use 'unknown' as fallback for unsupported asset types
  const pattern = TICKER_PATTERNS[assetType] || TICKER_PATTERNS.unknown;
  if (!pattern.test(normalized)) {
    return { valid: false, ticker: null, error: `Invalid ${assetType} ticker format` };
  }
  
  // Blocklist check (prevent SQL injection attempts)
  const blocklist = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'SELECT', '--', ';', '/*', '*/'];
  if (blocklist.some(word => normalized.includes(word))) {
    console.warn(`[Validator] Blocked suspicious ticker: ${ticker}`);
    return { valid: false, ticker: null, error: 'Invalid ticker' };
  }
  
  return { valid: true, ticker: normalized, error: null };
}

/**
 * Check if an asset type is currently supported
 * @param {string} assetType - Asset type to check
 * @returns {boolean}
 */
function isSupportedAssetType(assetType) {
  const supported = ['stock', 'etf', 'bond', 'treasury', 'crypto', 'index', 'mutual_fund'];
  return supported.includes(assetType);
}

module.exports = { validateTicker, TICKER_PATTERNS, TICKER_NORMALIZATIONS, isSupportedAssetType };
```

#### URL Validation

```javascript
/**
 * Validate URL for scraping (prevent SSRF)
 * @param {string} url - URL to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateScrapingUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }
  
  try {
    const parsed = new URL(url);
    
    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'Only HTTPS URLs allowed' };
    }
    
    // Whitelist allowed domains
    const allowedDomains = [
      'investing.com', 'www.investing.com',
      'finance.google.com', 'www.google.com',
      'webull.com', 'www.webull.com',
      'cnbc.com', 'www.cnbc.com',
      'nasdaq.com', 'www.nasdaq.com',
      'robinhood.com',
      'stockanalysis.com',
      'tradingview.com', 'www.tradingview.com',
      'marketwatch.com', 'www.marketwatch.com',
      'yahoo.com', 'finance.yahoo.com',
      'treasurydirect.gov', 'www.treasurydirect.gov'
    ];
    
    if (!allowedDomains.some(domain => parsed.hostname.endsWith(domain))) {
      return { valid: false, error: `Domain not allowed: ${parsed.hostname}` };
    }
    
    // Block internal/private IPs
    const privatePatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^0\./
    ];
    
    if (privatePatterns.some(p => p.test(parsed.hostname))) {
      return { valid: false, error: 'Private/internal URLs not allowed' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, error: 'Invalid URL format' };
  }
}
```

#### Request Parameter Validation

```javascript
// middleware/validate.js

/**
 * Express middleware for validating request parameters
 */
function validateRequest(schema) {
  return (req, res, next) => {
    const errors = [];
    
    // Validate path params
    if (schema.params) {
      for (const [key, validator] of Object.entries(schema.params)) {
        const result = validator(req.params[key]);
        if (!result.valid) {
          errors.push({ field: `params.${key}`, error: result.error });
        } else if (result.normalized) {
          req.params[key] = result.normalized;
        }
      }
    }
    
    // Validate query params
    if (schema.query) {
      for (const [key, validator] of Object.entries(schema.query)) {
        const result = validator(req.query[key]);
        if (!result.valid) {
          errors.push({ field: `query.${key}`, error: result.error });
        }
      }
    }
    
    // Validate body
    if (schema.body) {
      for (const [key, validator] of Object.entries(schema.body)) {
        const result = validator(req.body?.[key]);
        if (!result.valid) {
          errors.push({ field: `body.${key}`, error: result.error });
        }
      }
    }
    
    if (errors.length > 0) {
      console.warn(`[Validator] Request validation failed:`, { errors, path: req.path });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }
    
    next();
  };
}

// Usage example
app.get('/api/v1/scrape/:ticker', 
  validateRequest({
    params: {
      ticker: (val) => validateTicker(val, 'stock')
    },
    query: {
      source: (val) => val ? validateSource(val) : { valid: true }
    }
  }),
  scrapeHandler
);
```

#### SQL Injection Prevention

```javascript
// ✅ ALWAYS use parameterized queries
const [rows] = await pool.execute(
  'SELECT * FROM ticker_registry WHERE ticker = ? AND exchange = ?',
  [ticker, exchange]
);

// ❌ NEVER concatenate user input into SQL
const [rows] = await pool.execute(
  `SELECT * FROM ticker_registry WHERE ticker = '${ticker}'` // DANGEROUS!
);
```

### Rate Limiting

```javascript
// middleware/rate_limit.js
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { success: false, error: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    console.warn(`[RateLimit] Rate limit exceeded for ${req.ip}`, {
      path: req.path,
      limit: options.max
    });
    res.status(429).json(options.message);
  }
});

// Apply to all API routes
app.use('/api/', apiLimiter);
```

### Security Checklist

- [ ] All ticker inputs validated and normalized
- [ ] URLs validated against domain whitelist
- [ ] SQL queries use parameterized statements
- [ ] Rate limiting on all API endpoints
- [ ] No sensitive data in logs (passwords, tokens)
- [ ] Environment variables for secrets (not config files)
- [ ] HTTPS enforced for external connections

---

## Rollback Procedures

Each phase is designed for safe rollback. If issues occur after deployment, follow these procedures.

### General Rollback Principles

1. **Feature flags first** - Disable new code paths before reverting
2. **Database migrations are forward-only** - New columns/tables don't break old code
3. **Keep old code paths** - Don't delete until next major release
4. **Test rollback in staging** - Verify rollback works before production deploy

### Phase-by-Phase Rollback

#### Phase 1-2: Listing Sync Service

**Symptoms requiring rollback:**
- ListingSyncService crashes repeatedly
- CSV downloads failing
- Database sync errors

**Rollback steps:**
```bash
# 1. Stop new service
pm2 stop listing-sync-service

# 2. Restore old scrape_daemon.js from git (if listing logic was removed)
git checkout HEAD~1 -- scrapers/scrape_daemon.js

# 3. Restart
pm2 restart scrapers

# 4. Verify old code works
tail -f logs/scrape_daemon.log | grep "listings"
```

**Data safety:** New tables (`listing_sync_status`) can remain; old code ignores them.

#### Phase 3-5: Registry Refactoring

**Symptoms requiring rollback:**
- `getExchange()` returning wrong values
- Ticker lookups failing
- "Ticker not found" errors for valid tickers

**Rollback steps:**
```bash
# 1. Check database connectivity
mysql -h ${MYSQL_HOST} -u ${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "SELECT COUNT(*) FROM ticker_registry"

# 2. If DB issue, fix DB connectivity (this is required, no CSV fallback)

# 3. If data corruption, reload from init script
mysql -h ${MYSQL_HOST} -u ${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} < scripts/init-db/001-listing-sync-watchlist.sql

# 4. Restart services
pm2 restart all
```

**Data safety:** Init scripts can be re-run safely (uses INSERT ... ON DUPLICATE KEY UPDATE).

#### Phase 6: Remove Listing Logic from scrape_daemon

**Symptoms requiring rollback:**
- Price scraping broken
- Missing listings in scrape queue

**Rollback steps:**
```bash
# 1. Restore old scrape_daemon.js from git
git checkout HEAD~1 -- scrapers/scrape_daemon.js

# 2. Restart
pm2 restart scrapers

# 3. Old listing logic now active again
```

#### Phase 7: Page Pool

**Symptoms requiring rollback:**
- Memory leaks
- Page acquisition timeouts
- Browser crashes

**Rollback steps:**
```bash
# 1. Disable page pool
export USE_PAGE_POOL=false
pm2 restart scrapers

# 2. Falls back to single-page-per-scrape model
```

**Monitoring during rollback:**
```bash
# Watch memory usage
watch -n 5 'docker stats scrapers --no-stream'
```

#### Phase 8-9: On-Demand Scrape API

**Symptoms requiring rollback:**
- API timeouts
- Dashboard scrape button broken

**Rollback steps:**
```bash
# 1. Disable on-demand endpoint
export ENABLE_ONDEMAND_SCRAPE=false
pm2 restart scrapers

# 2. Dashboard falls back to periodic updates only
```

#### Phase 10: API Scraper Separation

**Symptoms requiring rollback:**
- Yahoo API container failing
- Treasury API not updating

**Rollback steps:**
```bash
# 1. Stop API scraper container
docker-compose stop api-scraper

# 2. Re-enable Yahoo in main scraper
export ENABLE_YAHOO_IN_MAIN=true
pm2 restart scrapers

# 3. Yahoo batch runs in main container again
```

#### Phase 11: Watchlist Management

**Symptoms requiring rollback:**
- Watchlist adds/deletes failing
- Investing.com automation broken

**Rollback steps:**
```bash
# 1. Disable watchlist management API
export ENABLE_WATCHLIST_MANAGEMENT=false
pm2 restart scrapers

# 2. Manual watchlist edits only (via Investing.com website)
```

### Emergency Full Rollback

If multiple phases fail simultaneously:

```bash
# 1. Stop all new services
docker-compose down

# 2. Checkout last known good commit
git checkout <last-good-tag>

# 3. Rebuild and restart
docker-compose up -d --build

# 4. Verify health
curl http://localhost:3001/api/health
```

### Rollback Verification Checklist

After any rollback, verify:

- [ ] Health endpoints return 200
- [ ] Price scraping continues (check `last.*.txt` markers)
- [ ] No error spikes in logs
- [ ] Database connections stable
- [ ] Memory usage within bounds
- [ ] Dashboard loads and shows data

---

## Architecture Decision Records (ADRs)

### ADR-001: Database as Single Source of Truth for Tickers

**Status:** Accepted

**Context:**
Currently, 5+ services independently read CSV files for ticker data. This causes:
- Memory duplication across services
- Race conditions during CSV updates
- No transactional consistency
- Difficult to track sync status

**Decision:**
Use MySQL `ticker_registry` table as the single source of truth. All services query the database instead of reading CSV files directly. Schema changes are managed via Docker init scripts (`scripts/init-db/001-listing-sync-watchlist.sql`).

**Consequences:**
- ✅ Single source of truth eliminates data inconsistencies
- ✅ Transactional updates ensure atomicity
- ✅ Easy to track sync status and audit changes
- ✅ Enables API-driven ticker management
- ✅ Init scripts ensure schema exists on fresh containers
- ⚠️ Requires database to be available at startup (fail fast)

**Alternatives Considered:**
1. **Shared CSV file with file locking** - Rejected: Complex locking, no transaction support
2. **Redis cache** - Rejected: Adds infrastructure, data loss on restart
3. **In-memory cache with pub/sub sync** - Rejected: Complex, eventual consistency issues
4. **CSV fallback when DB unavailable** - Rejected: Adds complexity, DB should be required dependency

---

### ADR-002: Page Pool vs Page-Per-Scrape

**Status:** Accepted

**Context:**
Creating a new Puppeteer page for each scrape operation is expensive:
- ~200MB memory per page
- ~500ms startup time
- Browser process overhead

**Decision:**
Implement a page pool that reuses browser pages across scrape operations, with configurable pool size and page recycling after N operations.

**Consequences:**
- ✅ 60-75% memory reduction for parallel scrapes
- ✅ Faster scrape startup (page already exists)
- ✅ Configurable parallelism via pool size
- ⚠️ Must handle page state cleanup between uses
- ⚠️ Potential for state leakage if cleanup incomplete
- ⚠️ Pool exhaustion requires wait queue

**Alternatives Considered:**
1. **Single page, sequential scraping** - Rejected: Too slow for many tickers
2. **Browser-per-scrape** - Rejected: 500MB+ per browser, not scalable
3. **Headless browser farm (Browserless)** - Rejected: External dependency, cost

---

### ADR-003: Separate Persistent Page Registry

**Status:** Accepted

**Context:**
Some scrapers (Investing.com) require persistent login state and should never have their pages closed or reused by other scrapers. The page pool model (acquire/release) doesn't fit this use case.

**Decision:**
Create a separate `PersistentPageRegistry` for stateful pages that:
- Never releases pages to pool
- Uses URL pattern matching to reuse existing pages
- Handles login state preservation

**Consequences:**
- ✅ Clean separation of stateless vs stateful page management
- ✅ Persistent pages maintain login across scrapes
- ✅ No interference with page pool operations
- ⚠️ Two systems to maintain (pool + registry)
- ⚠️ Must ensure scraper uses correct system

---

### ADR-004: Separate API Scrapers into Lightweight Container

**Status:** Accepted

**Context:**
API-based scrapers (Yahoo Finance, Treasury Direct) currently run in the 8GB browser container despite not needing Puppeteer. This wastes resources and couples their lifecycle to browser scraper issues.

**Decision:**
Create a separate `api-scraper` container (256MB) that runs only API-based scrapers. Browser scrapers remain in the main `scrapers` container.

**Consequences:**
- ✅ Resource efficiency (256MB vs 8GB for API work)
- ✅ Independent scaling and failure isolation
- ✅ Faster container startup for API scraper
- ✅ Can run on smaller/cheaper infrastructure
- ⚠️ Two containers to deploy and monitor
- ⚠️ Shared database access requires connection pooling

**Alternatives Considered:**
1. **Keep everything in one container** - Rejected: Wasteful, coupled failures
2. **Serverless functions** - Rejected: Cold start latency, infrastructure change
3. **Separate process, same container** - Rejected: Still shares memory limits

---

### ADR-005: Config Separation Strategy

**Status:** Accepted

**Context:**
`config.json` mixes multiple concerns:
- User-specific URLs (watchlist portfolios)
- Static source capabilities (has_realtime, has_bond_prices)
- Operational settings (intervals, enabled flags)

User-specific data in version control is a security/privacy concern.

**Decision:**
Separate configuration by concern:
- **Database**: User-specific URLs, watchlist instances
- **Code**: Static source capabilities (SourceRegistry)
- **config.json**: Operational settings only
- **.env**: Sensitive URLs via environment variables

**Consequences:**
- ✅ No user-specific data in version control
- ✅ Source capabilities co-located with scraper code
- ✅ Clear separation of concerns
- ⚠️ Migration required from current config.json
- ⚠️ Multiple places to check for configuration

---

### ADR-006: API Versioning Strategy

**Status:** Accepted

**Context:**
HTTP APIs may need breaking changes in the future. Without versioning, changes break existing clients (dashboard, external integrations).

**Decision:**
Use URL path versioning with `/v1/` prefix for all API endpoints.

**Consequences:**
- ✅ Clear version identification in URLs
- ✅ Can run multiple versions simultaneously
- ✅ Easy to deprecate old versions
- ⚠️ Longer URLs
- ⚠️ Must maintain multiple versions during transitions

See [API Versioning](#api-versioning) section for implementation details.

---

## Monitoring & Alerting

### Current Metrics Architecture

The existing codebase uses a **custom metrics system** (not `prom-client`):

| Component | Current Implementation |
|-----------|----------------------|
| `/metrics` endpoint | Manual Prometheus text format in [scrape_daemon.js](../scrapers/scrape_daemon.js#L965) |
| Metrics collection | `ScraperMetricsCollector` class with in-memory batching |
| Storage | MySQL tables (`scraper_page_performance`, `scraper_daily_summary`) |
| Real-time | WebSocket broadcasting via `WebSocketServer` |
| API | `/api/metrics/*` endpoints for dashboard queries |

**Current `/metrics` output** (scrape_daemon.js):
```
# HELP scrape_uptime_seconds Daemon uptime in seconds
# TYPE scrape_uptime_seconds gauge
scrape_uptime_seconds 3600

# HELP scrape_total_navigations Total navigation attempts this cycle
# TYPE scrape_total_navigations counter
scrape_total_navigations 150
```

### Metrics Strategy: Extend Current System

Rather than introducing `prom-client` as a new dependency, **extend the existing pattern**:

1. Keep manual Prometheus text format for `/metrics` endpoint
2. Use existing `ScraperMetricsCollector` pattern for new services
3. Add new metrics to MySQL for historical storage
4. WebSocket for real-time dashboard updates

### Prometheus-Compatible Metrics (Manual Format)

#### Adding New Metrics to Existing `/metrics` Endpoint

```javascript
// scrapers/scrape_daemon.js - extend existing /metrics handler

if (req.url === '/metrics') {
  const m = getMetrics ? getMetrics() : { /* defaults */ };
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const lines = [];
  
  // Existing metrics
  lines.push('# HELP scrape_uptime_seconds Daemon uptime in seconds');
  lines.push('# TYPE scrape_uptime_seconds gauge');
  lines.push(`scrape_uptime_seconds ${uptime}`);
  
  // ... existing metrics ...
  
  // NEW: Page pool metrics (Phase 7)
  if (pagePool) {
    lines.push('# HELP page_pool_available Available pages in pool');
    lines.push('# TYPE page_pool_available gauge');
    lines.push(`page_pool_available ${pagePool.getAvailableCount()}`);
    
    lines.push('# HELP page_pool_in_use Pages currently in use');
    lines.push('# TYPE page_pool_in_use gauge');
    lines.push(`page_pool_in_use ${pagePool.getInUseCount()}`);
    
    lines.push('# HELP page_pool_acquisitions_total Total page acquisitions');
    lines.push('# TYPE page_pool_acquisitions_total counter');
    lines.push(`page_pool_acquisitions_total{status="success"} ${pagePool.stats.successfulAcquisitions}`);
    lines.push(`page_pool_acquisitions_total{status="timeout"} ${pagePool.stats.timeouts}`);
  }
  
  // NEW: Listing sync metrics (Phase 1-2)
  if (listingSyncStatus) {
    lines.push('# HELP listing_last_sync_timestamp Unix timestamp of last sync');
    lines.push('# TYPE listing_last_sync_timestamp gauge');
    for (const [source, status] of Object.entries(listingSyncStatus)) {
      lines.push(`listing_last_sync_timestamp{source="${source}"} ${status.lastSyncTime || 0}`);
    }
  }
  
  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
  res.end(lines.join('\n') + '\n');
}
```

#### Listing Sync Service Metrics

```javascript
// services/listing-sync/listing_sync_service.js

class ListingSyncService {
  constructor(options = {}) {
    // ... existing code ...
    
    // Metrics tracking (compatible with existing pattern)
    this.metrics = {
      syncTotal: { success: 0, failure: 0 },
      syncDurations: [], // Keep last N for percentile calculation
      tickerCounts: {},
      lastSyncTimestamps: {}
    };
  }
  
  /**
   * Get metrics in format compatible with Prometheus text output
   */
  getMetrics() {
    return {
      syncSuccessTotal: this.metrics.syncTotal.success,
      syncFailureTotal: this.metrics.syncTotal.failure,
      tickerCounts: this.metrics.tickerCounts,
      lastSyncTimestamps: this.metrics.lastSyncTimestamps,
      avgSyncDurationMs: this._calculateAvgDuration()
    };
  }
  
  /**
   * Generate Prometheus-format lines for /metrics endpoint
   */
  getPrometheusLines() {
    const lines = [];
    
    lines.push('# HELP listing_sync_total Total listing sync operations');
    lines.push('# TYPE listing_sync_total counter');
    lines.push(`listing_sync_total{status="success"} ${this.metrics.syncTotal.success}`);
    lines.push(`listing_sync_total{status="failure"} ${this.metrics.syncTotal.failure}`);
    
    lines.push('# HELP listing_ticker_count Number of tickers per exchange');
    lines.push('# TYPE listing_ticker_count gauge');
    for (const [exchange, count] of Object.entries(this.metrics.tickerCounts)) {
      lines.push(`listing_ticker_count{exchange="${exchange}"} ${count}`);
    }
    
    lines.push('# HELP listing_last_sync_timestamp Unix timestamp of last successful sync');
    lines.push('# TYPE listing_last_sync_timestamp gauge');
    for (const [source, ts] of Object.entries(this.metrics.lastSyncTimestamps)) {
      lines.push(`listing_last_sync_timestamp{source="${source}"} ${ts}`);
    }
    
    return lines;
  }
  
  async syncSource(source) {
    const startTime = Date.now();
    try {
      await this._doSync(source);
      this.metrics.syncTotal.success++;
      this.metrics.lastSyncTimestamps[source] = Math.floor(Date.now() / 1000);
      this.metrics.syncDurations.push(Date.now() - startTime);
      if (this.metrics.syncDurations.length > 100) {
        this.metrics.syncDurations.shift();
      }
    } catch (e) {
      this.metrics.syncTotal.failure++;
      throw e;
    }
  }
}
```

#### Page Pool Metrics

```javascript
// scrapers/page_pool.js

class PagePool {
  constructor(browser, options = {}) {
    // ... existing code ...
    
    // Metrics tracking
    this.stats = {
      successfulAcquisitions: 0,
      timeouts: 0,
      errors: 0,
      recycled: 0,
      waitTimes: [] // For percentile calculation
    };
  }
  
  getAvailableCount() {
    return this.pages.filter(p => !p.inUse).length;
  }
  
  getInUseCount() {
    return this.pages.filter(p => p.inUse).length;
  }
  
  /**
   * Generate Prometheus-format lines
   */
  getPrometheusLines() {
    const lines = [];
    
    lines.push('# HELP page_pool_available Available pages in pool');
    lines.push('# TYPE page_pool_available gauge');
    lines.push(`page_pool_available ${this.getAvailableCount()}`);
    
    lines.push('# HELP page_pool_in_use Pages currently in use');
    lines.push('# TYPE page_pool_in_use gauge');
    lines.push(`page_pool_in_use ${this.getInUseCount()}`);
    
    lines.push('# HELP page_pool_acquisitions_total Total page acquisitions');
    lines.push('# TYPE page_pool_acquisitions_total counter');
    lines.push(`page_pool_acquisitions_total{status="success"} ${this.stats.successfulAcquisitions}`);
    lines.push(`page_pool_acquisitions_total{status="timeout"} ${this.stats.timeouts}`);
    lines.push(`page_pool_acquisitions_total{status="error"} ${this.stats.errors}`);
    
    lines.push('# HELP page_pool_recycles_total Total pages recycled');
    lines.push('# TYPE page_pool_recycles_total counter');
    lines.push(`page_pool_recycles_total ${this.stats.recycled}`);
    
    return lines;
  }
  
  async acquirePage(ticker, timeout = 30000) {
    const startTime = Date.now();
    try {
      const page = await this._acquireWithTimeout(timeout);
      this.stats.successfulAcquisitions++;
      this.stats.waitTimes.push(Date.now() - startTime);
      return page;
    } catch (e) {
      if (e.message.includes('timeout')) {
        this.stats.timeouts++;
      } else {
        this.stats.errors++;
      }
      throw e;
    }
  }
}
```

### Extending ScraperMetricsCollector

Use the existing pattern for new metrics:

```javascript
// services/scraper-metrics-collector.js - extend for new phases

class ScraperMetricsCollector {
  // ... existing methods ...
  
  /**
   * Record listing sync operation (Phase 1-2)
   */
  recordListingSync(source, syncData) {
    const metric = {
      source,
      durationMs: syncData.durationMs,
      tickersUpdated: syncData.tickersUpdated,
      tickersAdded: syncData.tickersAdded,
      success: syncData.success !== false,
      error: syncData.error || null,
      timestamp: new Date()
    };
    
    // Broadcast to WebSocket subscribers
    if (this.wsServer) {
      this.wsServer.broadcastMetric('listing_sync', metric);
    }
    
    return metric;
  }
  
  /**
   * Record page pool metrics (Phase 7)
   */
  recordPagePoolSnapshot(poolStats) {
    if (this.wsServer) {
      this.wsServer.broadcastMetric('page_pool', {
        available: poolStats.available,
        inUse: poolStats.inUse,
        waitQueueLength: poolStats.waitQueueLength,
        timestamp: new Date()
      });
    }
  }
}
```

### Database Tables for New Metrics

```sql
-- Add to existing migrations

-- Phase 1-2: Listing sync metrics
CREATE TABLE IF NOT EXISTS listing_sync_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  sync_started_at DATETIME NOT NULL,
  sync_completed_at DATETIME,
  duration_ms INT,
  tickers_processed INT DEFAULT 0,
  tickers_added INT DEFAULT 0,
  tickers_updated INT DEFAULT 0,
  success TINYINT(1) DEFAULT 1,
  error_message TEXT,
  INDEX idx_source_started (source, sync_started_at DESC)
);

-- Phase 7: Page pool metrics (snapshot every minute)
CREATE TABLE IF NOT EXISTS page_pool_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recorded_at DATETIME NOT NULL,
  pool_size INT NOT NULL,
  available INT NOT NULL,
  in_use INT NOT NULL,
  wait_queue_length INT DEFAULT 0,
  acquisitions_since_last INT DEFAULT 0,
  timeouts_since_last INT DEFAULT 0,
  INDEX idx_recorded (recorded_at DESC)
);
```

### Alert Rules (Works with Manual Prometheus Format)

The alert rules in the [Alert Rules](#alert-rules) section below work with any Prometheus-compatible format, whether from `prom-client` or manual text output.

### Grafana Dashboard Queries

```promql
# Sync success rate (last hour)
sum(rate(listing_sync_total{status="success"}[1h])) / 
sum(rate(listing_sync_total[1h])) * 100

# Average scrape duration by source
histogram_quantile(0.95, sum(rate(scraper_duration_seconds_bucket[5m])) by (source, le))

# Page pool utilization
page_pool_in_use / (page_pool_in_use + page_pool_available) * 100

# Error rate by source
sum(rate(scraper_errors_total[5m])) by (source)

# Time since last successful sync
time() - listing_last_sync_timestamp
```

### Alert Rules

```yaml
# alerts/listing_sync_alerts.yml
groups:
  - name: listing_sync
    rules:
      - alert: ListingSyncFailed
        expr: increase(listing_sync_total{status="failure"}[1h]) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Listing sync failures detected"
          description: "{{ $labels.source }} has failed {{ $value }} times in the last hour"

      - alert: ListingSyncStale
        expr: (time() - listing_last_sync_timestamp) > 86400
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Listing sync is stale"
          description: "{{ $labels.source }} hasn't synced in over 24 hours"

  - name: page_pool
    rules:
      - alert: PagePoolExhausted
        expr: page_pool_available == 0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Page pool exhausted"
          description: "No pages available in pool for 2+ minutes"

      - alert: PageAcquisitionSlow
        expr: histogram_quantile(0.95, rate(page_pool_acquisition_wait_seconds_bucket[5m])) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Page acquisition is slow"
          description: "95th percentile wait time is {{ $value }}s"

  - name: scrapers
    rules:
      - alert: ScraperHighErrorRate
        expr: sum(rate(scraper_errors_total[5m])) by (source) > 0.1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High scraper error rate"
          description: "{{ $labels.source }} error rate is {{ $value }}/s"

      - alert: ScraperDown
        expr: (time() - scraper_last_timestamp) > 600
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Scraper appears down"
          description: "{{ $labels.source }} hasn't scraped in 10+ minutes"

  - name: api
    rules:
      - alert: APIHighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "API latency is high"
          description: "95th percentile latency is {{ $value }}s"

      - alert: APIHighErrorRate
        expr: sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "API error rate is high"
          description: "5xx error rate is {{ $value | humanizePercentage }}"
```

### Health Endpoints

```javascript
// api/health.js
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/health/detailed', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    pagePool: checkPagePool(),
    lastSync: await getLastSyncStatus()
  };
  
  const allHealthy = Object.values(checks).every(c => c.healthy);
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks
  });
});
```

---

## Performance SLAs

### Service Level Objectives (SLOs)

| Operation | Target (p50) | Target (p95) | Max (p99) | Error Budget |
|-----------|--------------|--------------|-----------|--------------|
| Ticker lookup | 5ms | 20ms | 50ms | 0.1% errors |
| Exchange lookup | 5ms | 20ms | 50ms | 0.1% errors |
| CSV sync (per source) | 10s | 30s | 120s | 1% failures |
| On-demand scrape | 2s | 5s | 15s | 5% failures |
| Page acquisition | 100ms | 500ms | 2s | 1% timeouts |
| API response | 50ms | 200ms | 1s | 0.5% errors |

### Throughput Targets

| Service | Min Throughput | Target | Burst |
|---------|----------------|--------|-------|
| Ticker lookups | 100/s | 500/s | 1000/s |
| On-demand scrapes | 1/s | 5/s | 10/s |
| API requests | 50/s | 200/s | 500/s |
| Parallel scrapes | 3 | 5 | 8 |

### Resource Limits

| Container | Memory Min | Memory Target | Memory Max | CPU |
|-----------|------------|---------------|------------|-----|
| scrapers | 2 GB | 4 GB | 8 GB | 2 |
| api-scraper | 128 MB | 192 MB | 256 MB | 0.5 |
| listing-sync | 128 MB | 192 MB | 256 MB | 0.5 |
| dashboard | 256 MB | 384 MB | 512 MB | 0.5 |

### Database Connection Limits

| Pool | Min Connections | Max Connections | Idle Timeout |
|------|-----------------|-----------------|--------------|
| scraper | 2 | 10 | 30s |
| api-scraper | 1 | 5 | 60s |
| listing-sync | 2 | 5 | 60s |
| dashboard | 2 | 10 | 30s |

### Performance Testing

```javascript
// tests/performance/ticker_lookup.perf.js

describe('Ticker Lookup Performance', () => {
  it('should meet p95 latency SLO', async () => {
    const iterations = 1000;
    const latencies = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await exchangeRegistry.getExchange('AAPL');
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start) / 1e6); // ms
    }
    
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(iterations * 0.95)];
    
    expect(p95).toBeLessThan(20); // 20ms p95 SLO
  });
});
```

### Benchmark Commands

```bash
# Ticker lookup benchmark
npm run benchmark:ticker-lookup

# API load test
npm run benchmark:api -- --duration 60s --rate 100

# Page pool stress test
npm run benchmark:page-pool -- --parallel 10
```

---

## API Versioning

### Strategy: URL Path Versioning

All HTTP API endpoints use `/v1/` prefix to enable future breaking changes without disrupting existing clients.

### URL Structure

```
/api/v1/listings/sync          # Trigger sync
/api/v1/listings/status        # Get sync status
/api/v1/listings/search        # Search tickers
/api/v1/scrape/:ticker         # On-demand scrape
/api/v1/watchlist/:provider/*  # Watchlist management
/api/v1/health                 # Health check
```

### Implementation

```javascript
// api/routes/v1/index.js
const express = require('express');
const router = express.Router();

// Version 1 routes
router.use('/listings', require('./listings'));
router.use('/scrape', require('./scrape'));
router.use('/watchlist', require('./watchlist'));
router.use('/health', require('./health'));

module.exports = router;

// api/index.js
const v1Routes = require('./routes/v1');

// Mount versioned routes
app.use('/api/v1', v1Routes);

// Redirect unversioned to latest (optional, for convenience)
app.use('/api/listings', (req, res) => {
  res.redirect(307, `/api/v1/listings${req.url}`);
});
```

### Version Headers

```javascript
// middleware/version.js
function addVersionHeaders(req, res, next) {
  res.set('X-API-Version', '1.0.0');
  res.set('X-API-Deprecated', 'false');
  next();
}

// For deprecated versions
function deprecationWarning(req, res, next) {
  res.set('X-API-Deprecated', 'true');
  res.set('X-API-Sunset', '2025-06-01');
  console.warn(`[API] Deprecated endpoint called: ${req.path}`);
  next();
}
```

### Version Lifecycle

| Version | Status | Sunset Date | Notes |
|---------|--------|-------------|-------|
| v1 | Current | - | Active development |

### Breaking vs Non-Breaking Changes

**Non-breaking (no version bump):**
- Adding new optional fields to responses
- Adding new endpoints
- Adding new optional query parameters
- Improving error messages

**Breaking (requires new version):**
- Removing or renaming fields
- Changing field types
- Removing endpoints
- Changing required parameters
- Changing error response structure

### Deprecation Process

1. **Announce**: Add `X-API-Deprecated: true` header
2. **Document**: Update docs with sunset date
3. **Log**: Warn on deprecated endpoint usage
4. **Migrate**: Provide migration guide to new version
5. **Sunset**: Remove after sunset date (minimum 3 months)

```javascript
// Example: Deprecated endpoint
app.get('/api/v1/old-endpoint', 
  deprecationWarning,
  (req, res) => {
    // Still functional, but warns
    res.json({ /* ... */ });
  }
);
```

---

## Step 11.1: Source Capability Metadata Architecture

### Current State Analysis

The `config.json` mixes several distinct concerns:

| Concern | Example | User-Specific? | Changes Often? |
|---------|---------|----------------|----------------|
| Watchlist URLs | `investing_watchlists.url` | ✅ Yes | Rarely |
| Operational settings | `scrape_groups.interval` | ❌ No | Sometimes |
| Source capabilities | `cnbc.has_realtime` | ❌ No | Rarely |
| Update rules | `investing.update_rules` | ❌ No | Rarely |
| Ticker definitions | `single_securities[].key` | ⚠️ Partial | Sometimes |

### Source Metadata Characteristics

The source capability metadata (`has_realtime`, `has_pre_market`, `has_after_hours`, `has_bond_prices`, `has_stock_prices`, `has_previous_close`) is:

1. **Static** - Describes inherent capabilities of data sources
2. **Universal** - Same for all users/deployments
3. **Code-coupled** - Directly tied to scraper implementations
4. **Rarely changing** - Only updates when sources add/remove features

### Recommended Approach: Code-Defined Metadata

**Best Practice**: Move source capabilities to code alongside scrapers.

#### Option A: Per-Scraper Metadata Export (Recommended)

```javascript
// scrapers/sources/cnbc.js
module.exports = {
  name: 'cnbc',
  
  // Source capability metadata
  capabilities: {
    has_realtime: true,
    has_pre_market: true,
    has_after_hours: true,
    has_bond_prices: false,
    has_stock_prices: true,
    has_previous_close: false
  },
  
  // URL construction pattern
  urlPattern: {
    stock: 'https://www.cnbc.com/quotes/{ticker}',
    etf: 'https://www.cnbc.com/quotes/{ticker}'
  },
  
  // Scraper functions
  scrape: async (browser, security, outputDir) => { /* ... */ },
  scrapeStock: async (browser, security, outputDir) => { /* ... */ }
};
```

#### Option B: Centralized Source Registry

```javascript
// services/source_registry.js
const SourceRegistry = {
  sources: {
    cnbc: {
      name: 'cnbc',
      capabilities: {
        has_realtime: true,
        has_pre_market: true,
        has_after_hours: true,
        has_bond_prices: false,
        has_stock_prices: true,
        has_previous_close: false
      },
      urlPatterns: {
        stock: 'https://www.cnbc.com/quotes/{ticker}',
        etf: 'https://www.cnbc.com/quotes/{ticker}'
      }
    },
    webull: {
      name: 'webull',
      capabilities: {
        has_realtime: true,
        has_pre_market: true,
        has_after_hours: true,
        has_bond_prices: true,
        has_stock_prices: true,
        has_previous_close: false
      },
      urlPatterns: {
        stock: 'https://www.webull.com/quote/{exchange}-{ticker}',
        bond: 'https://www.webull.com/quote/bond-{ticker}',
        etf: 'https://www.webull.com/quote/{exchange}-{ticker}'
      }
    }
    // ... other sources
  },
  
  getCapabilities(sourceName) {
    return this.sources[sourceName]?.capabilities || {};
  },
  
  hasCapability(sourceName, capability) {
    return this.sources[sourceName]?.capabilities?.[capability] === true;
  },
  
  getSourcesWithCapability(capability) {
    return Object.entries(this.sources)
      .filter(([_, config]) => config.capabilities?.[capability] === true)
      .map(([name]) => name);
  },
  
  buildUrl(sourceName, assetType, ticker, exchange = null) {
    const pattern = this.sources[sourceName]?.urlPatterns?.[assetType];
    if (!pattern) return null;
    return pattern
      .replace('{ticker}', ticker.toLowerCase())
      .replace('{exchange}', exchange?.toLowerCase() || 'unknown');
  }
};

module.exports = SourceRegistry;
```

### What Stays in config.json

After refactoring, `config.json` should only contain:

```json
{
  "scrape_groups": {
    "stock_positions": { "interval": 30, "enabled": true },
    "bond_positions": { "interval": 30, "enabled": true }
  },
  
  "source_overrides": {
    "marketwatch": { "enabled": false },
    "stockevents": { "enabled": false }
  },
  
  "update_rules": {
    "investing": {
      "BKLC": [{ "start": "09:31", "end": "16:00", "days": ["mon","tue","wed","thu","fri"] }],
      "default": [{ "start": "09:31", "end": "23:59", "days": ["mon","tue","wed","thu","fri"] }]
    }
  },
  
  "single_security_mode": "round_robin"
}
```

### What Stays in Database

- Watchlist provider configuration (Step 11.0)
- Ticker positions (stocks, bonds)
- User-specific URL overrides (if needed)

### What Moves to Code

1. **Source capabilities** → `services/source_registry.js`
2. **URL patterns** → Per-source or centralized registry
3. **Scraper implementations** → `scrapers/sources/*.js`

### Migration Path

#### Phase A: Create Source Registry (Non-Breaking)
```javascript
// services/source_registry.js - Load from config.json initially
const config = require('../config/config.json');

const SourceRegistry = {
  // Dynamically build from existing config.json
  sources: Object.entries(config)
    .filter(([key, val]) => val?.has_stock_prices !== undefined)
    .reduce((acc, [key, val]) => {
      acc[key] = {
        name: val.name || key,
        capabilities: {
          has_realtime: val.has_realtime || false,
          has_pre_market: val.has_pre_market || false,
          has_after_hours: val.has_after_hours || false,
          has_bond_prices: val.has_bond_prices || false,
          has_stock_prices: val.has_stock_prices || false,
          has_previous_close: val.has_previous_close || false
        }
      };
      return acc;
    }, {})
};
```

#### Phase B: Update Consumers
```javascript
// Before
const sourceConfig = getConfig(sourceName);
if (sourceConfig.has_bond_prices !== false) { ... }

// After
const SourceRegistry = require('./services/source_registry');
if (SourceRegistry.hasCapability(sourceName, 'has_bond_prices')) { ... }
```

#### Phase C: Move Metadata to Code
```javascript
// services/source_registry.js - Hardcode metadata
const SourceRegistry = {
  sources: {
    cnbc: {
      name: 'cnbc',
      capabilities: {
        has_realtime: true,
        has_pre_market: true,
        has_after_hours: true,
        has_bond_prices: false,
        has_stock_prices: true,
        has_previous_close: false
      }
    },
    // ... all sources defined in code
  }
};
```

#### Phase D: Clean config.json
- Remove all `cnbc`, `google`, `investing`, etc. blocks
- Keep only operational settings

### Integration with source_priority.json

The existing [config/source_priority.json](../config/source_priority.json) already separates priority/weight metadata. This pattern should be followed:

```
config/
├── source_priority.json    # Priority/weights for merging (exists)
└── config.json             # Operational settings only (cleaned)

services/
└── source_registry.js      # Source capabilities (new)
```

### Benefits of Code-Defined Metadata

| Benefit | Description |
|---------|-------------|
| **Type Safety** | IDE autocomplete, compile-time validation |
| **Co-location** | Capabilities defined near scraper code |
| **Versioning** | Changes tracked with code changes |
| **Testing** | Unit tests can validate capabilities |
| **No Duplication** | Single source of truth |
| **Deployment Safety** | No config drift between environments |

### Updated Config Separation Summary

| Data Type | Storage Location | Reason |
|-----------|------------------|--------|
| Source capabilities | Code (`source_registry.js`) | Static, code-coupled |
| Source priority/weights | JSON (`source_priority.json`) | Tunable without code changes |
| Scrape intervals | JSON (`config.json`) | Operational tuning |
| Enable/disable flags | JSON (`config.json`) | Runtime control |
| Update windows | JSON (`config.json`) | Business rules |
| Watchlist URLs | Database + `.env` | User-specific |
| Ticker URLs | Database (constructed) | Dynamic |

---

## Resource Comparison

### Before (Single Container)
| Container | Memory | CPU | Purpose |
|-----------|--------|-----|---------|
| scrapers | 8 GB | 2 | All scraping (browser + API) |

### After (Split Containers)
| Container | Memory | CPU | Purpose |
|-----------|--------|-----|---------|
| scrapers | 8 GB | 2 | Browser scrapers (Google, MarketWatch) |
| api-scraper | 256 MB | 0.5 | API scrapers (Yahoo, Treasury) |
| listing-sync | 256 MB | 0.5 | CSV sync and ticker registry |

**Savings**: Enables independent scaling, better failure isolation, faster startup for API container.

---

## Estimated Timeline

| Phase | Duration | Dependencies | Parallel? |
|-------|----------|--------------|-----------|
| Phase 1 | 2-3 days | None | - |
| Phase 2 | 1-2 days | Phase 1 | - |
| Phase 3 | 1 day | Phase 2 | - |
| Phase 4 | 1 day | Phase 2 | with Phase 3 |
| Phase 5 | 0.5 day | Phase 2 | with Phase 3-4 |
| Phase 6 | 0.5 day | Phase 3-5 | - |
| Phase 7 | 1-2 days | Phase 6 | - |
| Phase 8 | 1 day | Phase 7 | - |
| Phase 9 | 1-2 days | Phase 8 | - |
| Phase 10 | 2-3 days | Phase 6 | with Phases 7-9 |
| Phase 11 | 1-2 days | Step 7.2 | after Phase 7 |

**Total: ~13-19 days** (with parallelization of Phases 3-5 and Phase 10)

---

## Next Steps

1. Review and approve this design document
2. Create feature branch: `feature/listing-sync-service`
3. Begin Phase 1 implementation
4. Code review after each phase
5. After Phase 6, split into parallel tracks:
   - Track A: Phases 7-9 (Browser improvements)
   - Track B: Phase 10 (API scraper separation)
6. After Phase 7 Step 7.2, begin Phase 11 (Watchlist Management)
7. Merge to main after all phases complete

---

## Appendix A: Naming Conventions & Consistency Guide

This section ensures all implementers use consistent naming across the codebase.

### General Rules

| Context | Convention | Example |
|---------|------------|---------|
| **JavaScript variables** | camelCase | `providerId`, `watchlistKey`, `intervalSeconds` |
| **JavaScript functions** | camelCase | `getCapabilities()`, `validateTicker()` |
| **JavaScript classes** | PascalCase | `WatchlistConfigLoader`, `UpdateWindowService` |
| **JavaScript constants** | UPPER_SNAKE_CASE | `DEFAULT_CONFIG`, `CACHE_TTL_MS` |
| **Database columns** | snake_case | `provider_id`, `interval_seconds`, `watchlist_key` |
| **Database tables** | snake_case | `watchlist_providers`, `update_windows` |
| **JSON config keys** | snake_case | `"interval_seconds"`, `"url_env_var"` |
| **Environment variables** | UPPER_SNAKE_CASE | `YAHOO_INTERVAL`, `DB_HOST` |
| **File names** | snake_case | `watchlist_config_loader.js`, `update_window_service.js` |
| **CSS classes** | kebab-case | `watchlist-manager`, `provider-select` |

### Key Variable Mappings

When reading from database/config and using in JavaScript code:

| Database/Config | JavaScript Variable | Notes |
|-----------------|---------------------|-------|
| `provider_id` | `providerId` | Convert on read |
| `watchlist_key` | `watchlistKey` | Convert on read |
| `interval_seconds` | `intervalSeconds` | Convert on read |
| `display_name` | `displayName` | Convert on read |
| `allowed_asset_types` | `allowedAssetTypes` | Convert on read, parse JSON |
| `default_interval_seconds` | `defaultIntervalSeconds` | Convert on read |
| `start_time` | `startTime` | Convert on read |
| `end_time` | `endTime` | Convert on read |
| `url_env_var` | `urlEnvVar` | Convert on read |
| `supported_asset_types` | `supportedAssetTypes` | In code/capabilities |

### Canonical Names

These names MUST be used consistently:

| Concept | Canonical Name | Wrong Names |
|---------|---------------|-------------|
| Watchlist provider ID | `providerId` (JS) / `provider_id` (DB) | `providerID`, `provider` |
| Watchlist key | `watchlistKey` (JS) / `watchlist_key` (DB) | `watchlist`, `key`, `watchlistId` |
| Scrape interval | `intervalSeconds` (JS) / `interval_seconds` (DB) | `interval`, `intervalMinutes`, `scrapeInterval` |
| Asset type | `assetType` (JS) | `type`, `asset_type`, `tickerType` |
| Display name | `displayName` (JS) / `display_name` (DB) | `name`, `label`, `title` |

### Service/Class Names

| Service | Class Name | File Name |
|---------|------------|-----------|
| Listing sync orchestrator | `ListingSyncService` | `listing_sync_service.js` |
| CSV downloader | `CsvDownloader` | `csv_downloader.js` |
| Exchange registry | N/A (module pattern) | `exchange_registry.js` |
| Page pool | `PagePool` | `page_pool.js` |
| Persistent page registry | `PersistentPageRegistry` | `persistent_page_registry.js` |
| Watchlist config loader | `WatchlistConfigLoader` | `watchlist_config_loader.js` |
| Update window service | `UpdateWindowService` | `update_window_service.js` |
| Watchlist manager | `WatchlistManager` | `watchlist_manager.js` |
| Base watchlist controller | `BaseWatchlistController` | `base_watchlist_controller.js` |
| Investing.com controller | `InvestingComWatchlistController` | `investingcom_watchlist_controller.js` |
| API scraper daemon | `ApiScraperDaemon` | `api_scraper_daemon.js` |
| Yahoo API client | `YahooApiClient` | `yahoo_api_client.js` |
| Treasury API client | `TreasuryApiClient` | `treasury_api_client.js` |

### Method Name Patterns

| Pattern | Usage | Examples |
|---------|-------|----------|
| `get*()` | Retrieve data (sync) | `getCapabilities()`, `getExchange()` |
| `fetch*()` | Retrieve data (async, may involve I/O) | `fetchTickers()`, `fetchConfig()` |
| `load*()` | Initialize/load data | `loadFromDatabase()`, `loadConfig()` |
| `is*()` / `has*()` | Boolean checks | `isWithinUpdateWindow()`, `hasDbConnection()` |
| `validate*()` | Validation | `validateTicker()`, `validateRequest()` |
| `initialize()` | Setup/bootstrap | (standard for all controllers) |
| `shutdown()` | Cleanup/teardown | (standard for services) |
| `add*()` / `delete*()` | CRUD operations | `addTicker()`, `deleteTicker()` |
| `_*()` | Private methods | `_loadFromConfig()`, `_findApplicableWindows()` |

### Data Structure Shapes

#### WatchlistConfig (returned from WatchlistConfigLoader)

```javascript
{
  [providerId: string]: {
    providerId: string,           // 'investingcom'
    displayName: string,          // 'Investing.com'
    enabled: boolean,
    supportedAssetTypes: string[],// ['stock', 'etf']
    authMethod: string,           // 'credentials' | 'cookie' | 'oauth' | 'none'
    defaultIntervalSeconds: number,
    watchlists: [{
      key: string,                // 'primary'
      name: string,               // 'Primary Watchlist'
      url: string,                // Resolved URL (not env var reference)
      intervalSeconds: number,    // 120
      allowedAssetTypes: string[] | null
    }]
  }
}
```

#### ProviderCapabilities (returned from getCapabilities())

```javascript
{
  providerId: string,             // 'investingcom'
  displayName: string,            // 'Investing.com'
  supportedAssetTypes: string[],  // [AssetType.STOCK, AssetType.ETF]
  supportsMultipleWatchlists: boolean,
  requiresLogin: boolean,
  maxTickersPerWatchlist: number, // 0 = unlimited
  rateLimitMs: number             // Minimum ms between operations
}
```

#### UpdateWindow (from database or config)

```javascript
// From database
{
  id: number,
  provider_id: string | null,
  watchlist_key: string | null,
  ticker: string | null,          // 'AAPL' or 'default'
  days: string[],                 // ['mon', 'tue', 'wed', 'thu', 'fri']
  start_time: string,             // '09:30'
  end_time: string,               // '16:00'
  timezone: string,               // 'America/New_York'
  enabled: boolean,
  priority: number
}

// In JavaScript (after conversion)
{
  providerId: string | null,
  watchlistKey: string | null,
  ticker: string | null,
  days: string[],
  startTime: string,
  endTime: string,
  timezone: string,
  enabled: boolean,
  priority: number
}
```

### Common Mistakes to Avoid

| ❌ Wrong | ✅ Correct | Reason |
|----------|------------|--------|
| `interval: 120` | `intervalSeconds: 120` | Ambiguous units |
| `provider` | `providerId` | Ambiguous (object vs ID?) |
| `watchlist` | `watchlistKey` | Ambiguous (object vs key?) |
| `type` | `assetType` | Too generic |
| `getConfig()` | `loadConfig()` | `load` implies async/I/O |
| `cap` | `capabilities` | Use full words |
| `displayname` | `displayName` | camelCase |
| `interval_seconds` in JS | `intervalSeconds` in JS | JS uses camelCase |

### Database to JavaScript Conversion Pattern

```javascript
// Standard pattern for converting DB rows to JS objects
function dbRowToJsObject(row) {
  return {
    providerId: row.provider_id,
    displayName: row.display_name,
    intervalSeconds: row.interval_seconds,
    watchlistKey: row.watchlist_key,
    allowedAssetTypes: row.allowed_asset_types 
      ? JSON.parse(row.allowed_asset_types) 
      : null,
    startTime: row.start_time,
    endTime: row.end_time,
    // ... etc
  };
}
```

---

## Appendix B: Complete File Structure & Cleanup

### New Files to Create

All paths are relative to workspace root (`/Users/gene/wealth-tracker/`).

#### Services (New Directory: `services/`)

```
services/
├── listing-sync/
│   ├── index.js                              # Main entry point & HTTP server
│   ├── listing_sync_service.js               # Core sync orchestrator
│   ├── csv_downloader.js                     # CSV download utilities
│   └── http_api.js                           # HTTP endpoint handlers
│
├── api-scraper/
│   ├── index.js                              # API scraper daemon entry point
│   ├── base_api_client.js                    # Abstract base class for API clients
│   ├── yahoo_api_client.js                   # Yahoo Finance API client
│   ├── treasury_api_client.js                # Treasury Direct API client
│   ├── rate_limiter.js                       # Shared rate limiting
│   ├── config.js                             # Configuration
│   └── package.json                          # Minimal dependencies (no Puppeteer)
│
├── watchlist_config_loader.js                # Watchlist configuration loader
├── update_window_service.js                  # Time-based scraping control
└── validators.js                             # Input validation utilities
```

#### Scrapers (Additions to existing `scrapers/`)

```
scrapers/
├── page_pool.js                              # NEW: Browser page pool
├── persistent_page_registry.js               # NEW: Stateful page management
│
└── watchlist/                                # NEW: Watchlist management
    ├── base_watchlist_controller.js          # Abstract base controller
    ├── investingcom_watchlist_controller.js  # Investing.com implementation
    └── watchlist_manager.js                  # Provider registry & orchestration
```

#### Tests (New)

```
tests/
├── unit/
│   ├── services/
│   │   ├── listing-sync/
│   │   │   ├── listing_sync_service.test.js
│   │   │   └── csv_downloader.test.js
│   │   └── api-scraper/
│   │       └── yahoo_api_client.test.js
│   │
│   └── scrapers/
│       ├── page_pool.test.js
│       └── watchlist/
│           ├── base_watchlist_controller.test.js
│           ├── investingcom_watchlist_controller.test.js
│           └── watchlist_manager.test.js
│
└── integration/
    ├── listing_sync_api.test.js
    ├── listing_sync_e2e.test.js
    ├── page_pool.test.js
    └── api_scraper.test.js
```

#### Docker (Additions)

```
docker/
└── Dockerfile.api-scraper                    # NEW: Lightweight API scraper container
```

#### Database Init Scripts (Additions)

```
scripts/
└── init-db/
    └── 001-listing-sync-watchlist.sql        # NEW: Schema for listing sync & watchlist management
```

#### Dashboard (Additions)

```
dashboard/
└── public/
    └── js/
        └── watchlist-manager.js              # NEW: Watchlist UI component
```

### Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `scrapers/exchange_registry.js` | 3 | Add DB support, `initializeDbPool()` |
| `scrapers/treasury_registry.js` | 5 | Add DB support, `initializeDbPool()` |
| `dashboard/ticker_registry.js` | 4 | Add DB support, `initializeDbPool()` |
| `scrapers/scrape_daemon.js` | 6, 7, 8, 10 | Remove listing logic, add page pool, on-demand API, remove Yahoo batch |
| `docker-compose.yml` | 7, 9, 10 | Add page pool config, listing-sync service, api-scraper service |
| `ecosystem.config.json` | 9 | Add listing-sync-service process |
| `config/config.example.json` | 7, 11 | Add page pool settings, watchlist providers |
| `dashboard/server.js` | 11 | Add watchlist proxy endpoints |
| `package.json` | 1 | Add test scripts |
| `.github/workflows/test.yml` | 1 | Add CI pipeline (create if not exists) |

### Files to Delete

After the ListingSyncService absorbs the functionality from the following files, they should be deleted:

| File | Phase | Reason |
|------|-------|--------|
| `scrapers/update_exchange_listings.js` | 3 | Functionality moved to ListingSyncService |
| `scrapers/update_treasury_listings.js` | 5 | Functionality moved to ListingSyncService |

**Verification before deletion**: Ensure ListingSyncService is successfully:
1. Downloading CSV files from NASDAQ FTP and Treasury auctions API
2. Parsing and upserting data to `ticker_registry` table
3. Running on schedule via cron/PM2
4. Passing integration tests

### Database Schema Changes

All schema changes go into a new Docker init script that runs on fresh container creation.

**File**: `scripts/init-db/001-listing-sync-watchlist.sql`

```sql
-- Init Script: Listing Sync and Watchlist Management Tables
-- 
-- This script is automatically executed by Docker MySQL on container initialization
-- (first time only, placed in /docker-entrypoint-initdb.d/)
--
-- Creates tables for:
-- - Listing sync service status tracking
-- - Watchlist provider and instance management
-- - Time-based update windows

-- ============================================================================
-- LISTING SYNC TABLES
-- ============================================================================

-- Track listing sync status per source
CREATE TABLE IF NOT EXISTS listing_sync_status (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source VARCHAR(50) NOT NULL,                -- 'nasdaq', 'nyse', 'other', 'treasury'
    last_sync_at TIMESTAMP NULL,
    last_success_at TIMESTAMP NULL,
    records_synced INT DEFAULT 0,
    status ENUM('pending', 'running', 'success', 'failed') DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================================
-- WATCHLIST MANAGEMENT TABLES
-- ============================================================================

-- Watchlist providers (Investing.com, TradingView, etc.)
CREATE TABLE IF NOT EXISTS watchlist_providers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_id VARCHAR(50) NOT NULL,           -- 'investingcom', 'tradingview', 'marketwatch'
    display_name VARCHAR(100) NOT NULL,         -- 'Investing.com', 'TradingView'
    enabled TINYINT(1) DEFAULT 1,
    
    -- Authentication method
    auth_method ENUM('credentials', 'cookie', 'oauth', 'none') DEFAULT 'credentials',
    
    -- Default scrape settings
    default_interval_seconds INT DEFAULT 300,
    
    -- Supported asset types (JSON array)
    supported_asset_types JSON,                 -- ["stock", "etf"]
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY idx_provider_id (provider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Individual watchlist instances within providers
CREATE TABLE IF NOT EXISTS watchlist_instances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_id INT NOT NULL,                   -- FK to watchlist_providers.id
    
    -- Watchlist identification
    watchlist_key VARCHAR(100) NOT NULL,        -- 'primary', 'tech-stocks', etc.
    watchlist_name VARCHAR(200),                -- Display name
    watchlist_url VARCHAR(500) NOT NULL,        -- Full URL including portfolio ID
    
    -- Asset type constraints for this watchlist
    allowed_asset_types JSON,                   -- ["stock", "etf"] or null for all
    
    -- Scrape settings (override provider defaults)
    interval_seconds INT,                       -- null = use provider default
    enabled TINYINT(1) DEFAULT 1,
    
    -- Metadata
    last_scraped_at TIMESTAMP NULL,
    ticker_count INT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY idx_provider_watchlist (provider_id, watchlist_key),
    INDEX idx_enabled (enabled),
    FOREIGN KEY (provider_id) REFERENCES watchlist_providers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Time-based update windows for scraping control
CREATE TABLE IF NOT EXISTS update_windows (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Scope: can apply to provider, watchlist instance, or specific ticker
    provider_id VARCHAR(50),                    -- null = applies to all providers
    watchlist_key VARCHAR(100),                 -- null = applies to all watchlists in provider
    ticker VARCHAR(20),                         -- null = applies to all tickers (use 'default' for fallback)
    
    -- Time window definition
    days JSON NOT NULL,                         -- ["mon", "tue", "wed", "thu", "fri"]
    start_time TIME NOT NULL,                   -- '09:30:00'
    end_time TIME NOT NULL,                     -- '16:00:00'
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    
    -- Control
    enabled TINYINT(1) DEFAULT 1,
    priority INT DEFAULT 0,                     -- Higher priority wins on conflict
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_provider (provider_id),
    INDEX idx_ticker (ticker)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================================
-- METRICS TABLES (for monitoring)
-- ============================================================================

-- Listing sync metrics history
CREATE TABLE IF NOT EXISTS listing_sync_metrics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source VARCHAR(50) NOT NULL,
    sync_started_at TIMESTAMP NOT NULL,
    sync_completed_at TIMESTAMP NULL,
    duration_ms INT,
    records_processed INT DEFAULT 0,
    records_inserted INT DEFAULT 0,
    records_updated INT DEFAULT 0,
    records_failed INT DEFAULT 0,
    status ENUM('success', 'partial', 'failed') DEFAULT 'success',
    error_details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_source_time (source, sync_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Page pool usage snapshots
CREATE TABLE IF NOT EXISTS page_pool_snapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pool_size INT,
    active_pages INT,
    available_pages INT,
    waiting_requests INT,
    total_acquisitions BIGINT,
    total_releases BIGINT,
    avg_wait_time_ms INT,
    memory_usage_mb INT,
    INDEX idx_snapshot_time (snapshot_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Insert default watchlist providers
INSERT INTO watchlist_providers (provider_id, display_name, enabled, auth_method, default_interval_seconds, supported_asset_types) VALUES
('investingcom', 'Investing.com', 1, 'credentials', 300, '["stock", "etf"]'),
('tradingview', 'TradingView', 0, 'credentials', 300, '["stock", "etf", "bond", "treasury", "crypto"]')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- Insert default update windows (market hours for stocks)
INSERT INTO update_windows (provider_id, ticker, days, start_time, end_time, timezone, priority) VALUES
(NULL, 'default', '["mon", "tue", "wed", "thu", "fri"]', '09:30:00', '16:00:00', 'America/New_York', 0),
(NULL, 'default', '["mon", "tue", "wed", "thu", "fri"]', '16:00:00', '20:00:00', 'America/New_York', 0)
ON DUPLICATE KEY UPDATE days = VALUES(days);
```

**Note**: For existing databases, run this SQL manually or via migration. For fresh containers, Docker executes it automatically.

### Files/Code to Remove (Cleanup)

After all phases complete, these sections become obsolete:

| Phase | File | What to Remove | Reason |
|-------|------|----------------|--------|
| 6 | `scrapers/scrape_daemon.js` | `updateUSListings()` function | Moved to listing-sync service |
| 6 | `scrapers/scrape_daemon.js` | `downloadNasdaqListings()` function | Moved to listing-sync service |
| 6 | `scrapers/scrape_daemon.js` | `downloadNYSEListings()` function | Moved to listing-sync service |
| 6 | `scrapers/scrape_daemon.js` | `downloadOtherListings()` function | Moved to listing-sync service |
| 6 | `scrapers/scrape_daemon.js` | US listings cron schedule block | Handled by listing-sync service |
| 10 | `scrapers/scrape_daemon.js` | Yahoo batch scraping code | Moved to api-scraper service |
| 10 | `scrapers/scrape_daemon.js` | `fetchYahooBatch()` function | Moved to api-scraper service |
| 10 | `scrapers/scrape_daemon.js` | Yahoo-related imports | No longer needed in main scraper |

### Marker Files Created at Runtime

These files are created/updated during operation (not in repo):

```
logs/
├── last.listings.txt                         # Listing sync marker
├── last.yahoo.txt                            # Yahoo API scrape marker
├── last.treasury.txt                         # Treasury API scrape marker
├── last.watchlist.investingcom.primary.txt   # Per-watchlist markers
├── last.watchlist.investingcom.secondary.txt
└── last.watchlist.tradingview.main.txt
```

### Environment Variables (New)

Add to `.env`:

```bash
# Listing Sync Service
LISTING_SYNC_PORT=3010
SYNC_INTERVAL=1440

# API Scraper Service
API_SCRAPER_PORT=3020
YAHOO_INTERVAL=15
TREASURY_INTERVAL=1440

# Page Pool
PAGE_POOL_SIZE=3
PAGE_POOL_MAX_OPS=50
PAGE_POOL_IDLE_TIMEOUT=300000

# Watchlist Configuration
# Investing.com uses tabs on a single URL for multiple watchlists
INVESTING_WATCHLIST_URL=https://www.investing.com/portfolio/?portfolioID=xxxxx
TRADINGVIEW_WATCHLIST_URL=https://www.tradingview.com/watchlists/xxxxx

# Feature Flags (for rollback)
USE_PAGE_POOL=true
ENABLE_ONDEMAND_SCRAPE=true
ENABLE_WATCHLIST_MANAGEMENT=true
```

### Cleanup Checklist (Post-Implementation)

Run after all phases complete and stable:

- [ ] Remove `updateUSListings()` and related functions from `scrape_daemon.js`
- [ ] Remove Yahoo batch code from `scrape_daemon.js`
- [ ] Remove unused imports in `scrape_daemon.js`
- [ ] Delete any temporary migration files
- [ ] Update README.md to reflect new architecture
- [ ] Archive old documentation referencing removed code
- [ ] Run full test suite to verify no regressions
- [ ] Clean up any test fixtures referencing removed code
