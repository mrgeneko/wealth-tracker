const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const { Kafka } = require('kafkajs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const mysql = require('mysql2/promise');

// Support running in multiple layouts:
// - Local dev:   repoRoot/dashboard/server.js with repoRoot/api and repoRoot/config
// - Docker image: /app/server.js with /app/api and /app/config
const apiBaseDir = fs.existsSync(path.join(__dirname, 'api'))
    ? path.join(__dirname, 'api')
    : path.join(__dirname, '..', 'api');
const configBaseDir = fs.existsSync(path.join(__dirname, 'config'))
    ? path.join(__dirname, 'config')
    : path.join(__dirname, '..', 'config');
const scriptsBaseDir = fs.existsSync(path.join(__dirname, 'scripts'))
    ? path.join(__dirname, 'scripts')
    : path.join(__dirname, '..', 'scripts');

function requireApi(moduleName) {
    return require(path.join(apiBaseDir, moduleName));
}
let basicAuth;
try {
    basicAuth = require('express-basic-auth');
} catch (e) {
    // Fallback stub for environments where express-basic-auth is not installed
    basicAuth = () => (req, res, next) => next();
}
const { loadAllTickers, initializeDbPool: initializeTickerRegistryDbPool } = require('./ticker_registry');

// Phase 9.2: WebSocket Real-time Metrics
let MetricsWebSocketServer;
let ScraperMetricsCollector;
try {
    MetricsWebSocketServer = require('./services/websocket-server');
    ScraperMetricsCollector = require('./services/scraper-metrics-collector');
} catch (e) {
    // Provide lightweight stubs when services are not available (test environments)
    MetricsWebSocketServer = class { constructor(s) { this.server = s; } };
    ScraperMetricsCollector = class { constructor() { } };
}

const app = express();

// Load SSL Certificates if available
const keyPath = path.join(__dirname, 'certs', 'server.key');
const certPath = path.join(__dirname, 'certs', 'server.crt');
let server;
let protocol = 'http';

// Default to HTTP for local/dev compatibility; enable HTTPS explicitly.
const enableHttps = String(process.env.ENABLE_HTTPS || '').toLowerCase() === 'true';

if (enableHttps && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    try {
        const privateKey = fs.readFileSync(keyPath, 'utf8');
        const certificate = fs.readFileSync(certPath, 'utf8');
        const credentials = { key: privateKey, cert: certificate };
        server = https.createServer(credentials, app);
        protocol = 'https';
        console.log('SSL certificates found. Starting HTTPS server.');
    } catch (e) {
        console.error('Error loading SSL certificates:', e);
        console.log('Falling back to HTTP.');
        server = http.createServer(app);
    }
} else {
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        if (!enableHttps) {
            console.log('SSL certificates found, but HTTPS is disabled. Set ENABLE_HTTPS=true to enable HTTPS.');
        }
    } else {
        console.log('SSL certificates not found.');
    }
    console.log('Starting HTTP server.');
    server = http.createServer(app);
}
const io = socketIo(server);

// Phase 9.2: Initialize WebSocket Real-time Metrics System
let metricsWebSocketServer;
let metricsCollector;

try {
    // Pool will be created below and passed to the collector
    metricsWebSocketServer = new MetricsWebSocketServer(server);
    // Pool will be assigned after creation
    metricsCollector = null; // Will be initialized after pool creation
    
    console.log('[Phase 9.2] WebSocket metrics system initialized');
} catch (err) {
    console.error('[Phase 9.2] Failed to initialize WebSocket metrics system:', err.message);
    console.warn('[Phase 9.2] Continuing without real-time metrics. Metrics will not be recorded.');
}

const PORT = process.env.PORT || 3001;

// Basic Auth Configuration
const AUTH_USER = process.env.BASIC_AUTH_USER || 'admin';
const AUTH_PASS = process.env.BASIC_AUTH_PASSWORD || 'admin';

// Apply Basic Auth middleware
app.use(basicAuth({
    users: { [AUTH_USER]: AUTH_PASS },
    challenge: true,
    realm: 'Wealth Tracker Dashboard'
}));

app.use(cors());
app.use(express.json());

// Kafka Configuration
// Kafka Configuration
const config = require('./config');
const KAFKA_BROKERS = config.KAFKA_BROKERS;
const KAFKA_TOPIC = config.KAFKA_TOPIC;
const KAFKA_GROUP_ID = config.KAFKA_GROUP_ID;

// Source priority configuration for previous_close_price merging
// Lower index in priority array = higher priority source
let sourcePriorityConfig = {
    priority: ['yahoo', 'nasdaq', 'google', 'cnbc', 'wsj', 'ycharts', 'marketbeat', 'stockanalysis', 'moomoo', 'robinhood', 'investingcom', 'stockmarketwatch', 'stocktwits'],
    weights: { yahoo: 1.0, nasdaq: 0.95, google: .93, cnbc: 0.9, wsj: 0.9, ycharts: 0.8, marketbeat: 0.75, stockanalysis: 0.75, moomoo: 0.7, robinhood: 0.7, investingcom: 0.65, stockmarketwatch: 0.6, stocktwits: 0.5 },
    default_weight: 0.5,
    recency_threshold_minutes: 60
};

// Try to load source priority config from file
const sourcePriorityPath = path.join(configBaseDir, 'source_priority.json');
try {
    if (fs.existsSync(sourcePriorityPath)) {
        const loaded = JSON.parse(fs.readFileSync(sourcePriorityPath, 'utf8'));
        sourcePriorityConfig = { ...sourcePriorityConfig, ...loaded };
        console.log('Loaded source priority config from file');
    }
} catch (e) {
    console.warn('Could not load source_priority.json, using defaults:', e.message);
}

/**
 * Get the priority rank of a source (lower = higher priority).
 * Returns a high number (999) for unknown sources.
 */
function getSourcePriorityRank(source) {
    if (!source) return 999;
    // Extract base source name (e.g., "google" from "google (after-hours)")
    const baseSource = source.toLowerCase().split(' ')[0].split('(')[0].trim();
    const idx = sourcePriorityConfig.priority.indexOf(baseSource);
    return idx >= 0 ? idx : 999;
}

/**
 * Determine whether to accept an incoming prev-close over the cached one.
 * Uses source priority and recency to decide.
 */
function shouldAcceptIncomingPrevClose(incoming, cached) {
    // If no cached prev-close, accept any valid incoming
    if (!cached || !cached.previous_close_price) return true;
    // If no valid incoming prev-close, reject
    if (!incoming.previousClosePrice) return false;

    const incomingRank = getSourcePriorityRank(incoming.source);
    const cachedRank = getSourcePriorityRank(cached.prev_close_source);

    // If incoming has strictly higher priority (lower rank), accept
    if (incomingRank < cachedRank) {
        console.log(`[PrevClose] Accepting ${incoming.source} (rank ${incomingRank}) over ${cached.prev_close_source} (rank ${cachedRank})`);
        return true;
    }

    // If incoming has lower priority (higher rank), reject unless significantly fresher
    if (incomingRank > cachedRank) {
        // Check recency: if incoming is much fresher, consider accepting anyway
        const cachedTime = cached.prev_close_time ? new Date(cached.prev_close_time) : null;
        const incomingTime = incoming.time ? new Date(incoming.time) : new Date();
        if (cachedTime && incomingTime) {
            const diffMinutes = (incomingTime - cachedTime) / (1000 * 60);
            if (diffMinutes > sourcePriorityConfig.recency_threshold_minutes) {
                console.log(`[PrevClose] Accepting fresher ${incoming.source} despite lower priority (${diffMinutes.toFixed(0)} min newer)`);
                return true;
            }
        }
        return false;
    }

    // Same priority: use recency (newer wins)
    const cachedTime = cached.prev_close_time ? new Date(cached.prev_close_time) : null;
    const incomingTime = incoming.time ? new Date(incoming.time) : new Date();
    if (cachedTime && incomingTime && incomingTime > cachedTime) {
        return true;
    }

    return false;
}

// MySQL Configuration
const MYSQL_HOST = process.env.MYSQL_HOST || 'mysql';
const MYSQL_PORT = process.env.MYSQL_PORT || 3306;
const MYSQL_USER = process.env.MYSQL_USER || 'test';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'test';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'testdb';

// Mount Metadata API
const metadataRouter = requireApi('metadata');
app.use('/api/metadata', metadataRouter);

// Mount Autocomplete API (will be initialized after pool is created)
const { router: autocompleteRouter } = requireApi('autocomplete');
app.use('/api/autocomplete', autocompleteRouter);

// Mount Cleanup API (will be initialized after pool is created)
const { router: cleanupRouter } = requireApi('cleanup');
app.use('/api/cleanup', cleanupRouter);

// Phase 11: Watchlist Management Proxy (multi-provider)
const SCRAPER_HOST = process.env.SCRAPER_HOST || 'scrapers';
const SCRAPER_PORT = process.env.SCRAPER_PORT || '3002';

async function proxyScraperJson(res, url, options = {}) {
    try {
        const response = await fetch(url, options);
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text || 'Invalid JSON from scraper' }; }
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ error: 'Failed to contact scraper' });
    }
}

app.get('/api/watchlist/providers', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/providers`);
});

app.get('/api/watchlist/:provider/status', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/status`);
});

app.get('/api/watchlist/:provider/tabs', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/tabs`);
});

app.get('/api/watchlist/:provider/tickers', async (req, res) => {
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/tickers${queryString}`);
});

app.post('/api/watchlist/:provider/switch', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {})
    });
});

app.post('/api/watchlist/:provider/add', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {})
    });
});

app.post('/api/watchlist/:provider/delete', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {})
    });
});

// Watchlist instance management endpoints
app.get('/api/watchlist/:provider/instances', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/instances`);
});

app.post('/api/watchlist/:provider/instances', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {})
    });
});

app.put('/api/watchlist/:provider/instances/:key', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/instances/${encodeURIComponent(req.params.key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {})
    });
});

app.delete('/api/watchlist/:provider/instances/:key', async (req, res) => {
    await proxyScraperJson(res, `http://${SCRAPER_HOST}:${SCRAPER_PORT}/watchlist/${req.params.provider}/instances/${encodeURIComponent(req.params.key)}`, {
        method: 'DELETE'
    });
});

// Phase 9.3: Analytics Dashboard Route
app.get('/analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

app.use(cors());
// Disable caching for static files (Debugging purposes)
app.use(express.static(path.join(__dirname, 'public'), {
    etl: false,
    maxAge: 0,
    setHeaders: function (res, path, stat) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
    }
}));

// In-memory cache for latest prices: { "AAPL": { price: 150.00, currency: "USD", time: "..." } }
const priceCache = {};
let assetsCache = null;

async function fetchInitialPrices() {
    let retries = 5;
    while (retries > 0) {
        try {
            console.log(`Connecting to MySQL at ${MYSQL_HOST}:${MYSQL_PORT} (Attempt ${6 - retries}/5)...`);
            const connection = await mysql.createConnection({
                host: MYSQL_HOST,
                port: MYSQL_PORT,
                user: MYSQL_USER,
                password: MYSQL_PASSWORD,
                database: MYSQL_DATABASE
            });

            const [rows] = await connection.execute('SELECT * FROM latest_prices');
            console.log(`Loaded ${rows.length} prices from MySQL`);

            rows.forEach(row => {
                // row.price is likely a string or number depending on driver config, ensure float
                const priceVal = parseFloat(row.price);
                if (!isNaN(priceVal)) {
                    priceCache[row.ticker] = {
                        price: priceVal,
                        previous_close_price: row.previous_close_price ? parseFloat(row.previous_close_price) : null,
                        // If the DB has prev-close metadata columns, use them; otherwise
                        // record null so updatePriceCache may add metadata later.
                        prev_close_source: row.prev_close_source || row.source || null,
                        prev_close_time: row.prev_close_time || row.capture_time || null,
                        currency: 'USD',
                        time: row.capture_time,
                        source: row.source
                    };
                } else {
                    console.warn(`Invalid price for ${row.ticker}: ${row.price}`);
                }
            });

            await connection.end();
            return; // Success
        } catch (err) {
            console.error(`Error fetching initial prices from MySQL: ${err.message}`);
            retries--;
            if (retries > 0) {
                console.log('Retrying in 5 seconds...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    console.error('Failed to fetch initial prices after multiple attempts. Continuing with empty cache.');
}

// Run database migrations on startup
async function runDatabaseMigrations() {
    try {
        console.log('\n🔄 Running database migrations...');
        const { runAllMigrations } = require(path.join(scriptsBaseDir, 'run-migrations'));
        const success = await runAllMigrations();
        
        if (!success) {
            console.warn('⚠️  Some migrations failed, but continuing startup');
        } else {
            console.log('✅ All migrations completed successfully');
        }
    } catch (err) {
        console.error('❌ Failed to run migrations:', err.message);
        console.warn('⚠️  Continuing startup without migrations. Database schema may be incomplete.');
    }
}

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

// Initialize dashboard ticker registry to query DB instead of CSV files
try {
    initializeTickerRegistryDbPool(pool);
} catch (err) {
    console.warn('[TickerRegistry] Failed to initialize DB pool:', err.message);
}

// Now that pool is created, initialize the metrics collector
try {
    if (metricsWebSocketServer) {
        metricsCollector = new ScraperMetricsCollector(metricsWebSocketServer, pool);
        // Make metricsCollector available globally for scrapers
        global.metricsCollector = metricsCollector;
        console.log('[Phase 9.2] Metrics collector initialized with database pool');
    }
} catch (err) {
    console.error('[Phase 9.2] Failed to initialize metrics collector:', err.message);
    console.warn('[Phase 9.2] Continuing without metrics persistence.');
}

// Initialize the autocomplete API with the pool
const { initializePool } = requireApi('autocomplete');
initializePool(pool);

// Initialize the cleanup API with the pool
const { initializePool: initializeCleanupPool } = requireApi('cleanup');
initializeCleanupPool(pool);

// Initialize the statistics API with the pool
const { router: statisticsRouter, initializePool: initializeStatisticsPool } = requireApi('statistics');
app.use('/api/statistics', statisticsRouter);
initializeStatisticsPool(pool);

// Initialize the metrics API with the pool
const { router: metricsRouter, initializePool: initializeMetricsPool } = requireApi('metrics');
app.use('/api/metrics', metricsRouter);
initializeMetricsPool(pool);

// Initialize symbol registry sync service to load CSV data on startup
async function initializeSymbolRegistry() {
    try {
        // Wait for MySQL to accept connections. `depends_on` does not guarantee readiness.
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const maxAttempts = parseInt(process.env.SYMBOL_REGISTRY_SYNC_DB_RETRIES || '30', 10);
        const delayMs = parseInt(process.env.SYMBOL_REGISTRY_SYNC_DB_DELAY_MS || '1000', 10);
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await pool.query('SELECT 1');
                break;
            } catch (e) {
                const msg = (e && e.message) ? e.message : String(e);
                console.warn(`[Symbol Registry] Waiting for MySQL (${attempt}/${maxAttempts})... ${msg}`);
                if (attempt === maxAttempts) throw e;
                await sleep(delayMs);
            }
        }

        const { SymbolRegistrySyncService, SymbolRegistryService } = require('./services/symbol-registry');
        const symbolService = new SymbolRegistryService(pool);
        const syncService = new SymbolRegistrySyncService(pool, symbolService);

        // If already populated, avoid doing heavy sync work on every restart.
        try {
            const [existing] = await pool.query('SELECT COUNT(*) as count FROM ticker_registry');
            const count = (existing && existing[0] && typeof existing[0].count === 'number') ? existing[0].count : 0;
            if (count > 0) {
                console.log('[Symbol Registry] ticker_registry already populated; skipping initial sync (count=' + count + ')');
                return;
            }
        } catch (e) {
            // If table is missing or query fails, proceed to sync attempt below (migrations may create it).
            console.warn('[Symbol Registry] Could not check ticker_registry count before sync:', e.message);
        }
        
        console.log('[Symbol Registry] Starting initial sync of CSV files...');
        const stats = await syncService.syncAll();
        console.log('[Symbol Registry] Full sync results:', JSON.stringify(stats, null, 2));
        
        // Verify data was inserted
        const [checkResult] = await pool.query('SELECT COUNT(*) as count FROM ticker_registry');
        console.log('[Symbol Registry] Verification - records in database:', checkResult[0].count);
    } catch (err) {
        console.error('[Symbol Registry] Sync error:', err.message);
        console.error('[Symbol Registry] Stack:', err.stack);
    }
}

// Self-healing: Ensure new columns exist
async function ensureSchema() {
    try {
        console.log('[Schema] Checking for sector/industry columns...');
        await pool.query("ALTER TABLE securities_metadata ADD COLUMN sector VARCHAR(100) AFTER long_name");
        console.log('[Schema] Added sector column');
    } catch (e) {
        // Ignore duplicate column error
        if (e.code !== 'ER_DUP_FIELDNAME') console.warn('[Schema] Sector column check:', e.message);
    }

    try {
        await pool.query("ALTER TABLE securities_metadata ADD COLUMN industry VARCHAR(100) AFTER sector");
        console.log('[Schema] Added industry column');
    } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') console.warn('[Schema] Industry column check:', e.message);
    }
}

async function fetchAssetsFromDB() {
    try {
        const [accounts] = await pool.query(`
            SELECT a.*, at.display_name as account_type_display_name, at.category as account_type_category, at.` + "`key`" + ` as account_type_key
            FROM accounts a
            LEFT JOIN account_types at ON a.account_type_id = at.id
            ORDER BY a.display_order
        `);

        // Fetch positions with metadata
        // Use COLLATE to ensure compatibility between tables
        const [positions] = await pool.query(`
            SELECT p.*,
                   sm.short_name, sm.sector, sm.market_cap,
                   sm.dividend_yield, sm.trailing_pe,
                   sm.ttm_dividend_amount, sm.ttm_eps,
                   sm.quote_type, sm.exchange as meta_exchange,
                   p.security_type as type
            FROM positions p
            LEFT JOIN securities_metadata sm ON p.ticker = sm.ticker COLLATE utf8mb4_unicode_ci
        `);

        const [fixedAssets] = await pool.query('SELECT * FROM fixed_assets ORDER BY display_order');

        const result = {
            real_estate: [],
            vehicles: [],
            accounts: []
        };

        // Process Fixed Assets
        for (const asset of fixedAssets) {
            const item = {
                id: asset.id,
                description: asset.name,
                value: parseFloat(asset.value),
                currency: asset.currency
            };
            if (asset.type === 'real_estate') {
                result.real_estate.push(item);
            } else if (asset.type === 'vehicle') {
                result.vehicles.push(item);
            }
        }

        // Process Accounts
        for (const acc of accounts) {
            const accountObj = {
                id: acc.id,
                name: acc.name,
                // Expose the account type display name (e.g., "Individual Brokerage") as `type`
                type: acc.account_type_display_name || acc.account_type_key || null,
                // Expose canonical category from account_types (investment, bank, debt)
                category: acc.account_type_category || null,
                holdings: {
                    cash: null,
                    stocks: [],
                    bonds: []
                }
            };

            const accPositions = positions.filter(p => p.account_id === acc.id);

            for (const pos of accPositions) {
                // Determine display type
                // Type-driven only: cash is determined strictly by pos.type === 'cash'.
                const displayType = pos.type; // Default to stored type

                // Common position object
                const positionData = {
                    id: pos.id,
                    ticker: pos.ticker,
                    quantity: parseFloat(pos.quantity),
                    cost_basis: pos.cost_basis ? parseFloat(pos.cost_basis) : 0,
                    // Source tracking fields
                    source: pos.source || null,
                    pricing_provider: pos.pricing_provider || null,
                    // Metadata fields (from JOIN)
                    short_name: pos.short_name || null,
                    sector: pos.sector || null,
                    market_cap: pos.market_cap ? parseFloat(pos.market_cap) : null,
                    dividend_yield: pos.dividend_yield ? parseFloat(pos.dividend_yield) : null,
                    ttm_dividend_amount: pos.ttm_dividend_amount ? parseFloat(pos.ttm_dividend_amount) : null,
                    ttm_eps: pos.ttm_eps ? parseFloat(pos.ttm_eps) : null,
                    trailing_pe: pos.trailing_pe ? parseFloat(pos.trailing_pe) : null,
                    quote_type: pos.quote_type || null,
                    exchange: pos.exchange || pos.meta_exchange || null
                };

                if (displayType === 'cash') {
                    const cashValue = parseFloat(pos.quantity);
                    if (!accountObj.holdings.cash) {
                        accountObj.holdings.cash = {
                            id: pos.id,
                            value: isNaN(cashValue) ? 0 : cashValue,
                            currency: pos.currency
                        };
                    } else {
                        // If multiple cash rows exist for an account, show them as one value in the UI.
                        accountObj.holdings.cash.value += (isNaN(cashValue) ? 0 : cashValue);
                    }
                } else if (displayType === 'bond') {
                    accountObj.holdings.bonds.push(positionData);
                } else {
                    // Stocks, ETFs, Crypto, etc.
                    accountObj.holdings.stocks.push(positionData);
                }
            }

            result.accounts.push(accountObj);
        }

        return result;

    } catch (err) {
        console.error('Error fetching assets from DB:', err);
        try {
            const fs = require('fs');
            const path = require('path');
            fs.writeFileSync(path.join(__dirname, 'logs/db_error.txt'), err.message + '\n' + err.stack);
        } catch (e) {
            console.error('Failed to write error log:', e);
        }
        return null;
    }
}

async function loadAssets() {
    const data = await fetchAssetsFromDB();
    if (data) {
        if (JSON.stringify(data) !== JSON.stringify(assetsCache)) {
            console.log('Assets updated from DB, broadcasting to clients');
            assetsCache = data;
            io.emit('assets_update', assetsCache);
        }
    }
}

// Poll assets every 30 seconds (skip in test mode)
let assetsPollingInterval = null;
if (process.env.NODE_ENV !== 'test') {
    assetsPollingInterval = setInterval(loadAssets, 30000);
    // Initial load
    loadAssets();
}

// Helper to update cache from price data object
// Supports extended hours pricing (pre-market, after-hours)
function updatePriceCache(item) {
    // Determine a normalized key for this incoming item.
    // Priority: item.normalized_key -> item.key -> encodeURIComponent(item.ticker)
    const normalizedKey = item.normalized_key || item.key || (item.ticker ? encodeURIComponent(String(item.ticker)) : null);
    if (!normalizedKey) return false;

    // Determine the best price to use
    // Prefer extended hours prices during pre/post market
    let price = 0;
    let priceSource = 'regular';

    // Helper to check if a time is within regular market hours (Mon-Fri 9:30-16:00 ET)
    const isRegularHours = (dateObj) => {
        try {
            const nyString = dateObj.toLocaleString("en-US", { timeZone: "America/New_York" });
            const nyDate = new Date(nyString);
            const day = nyDate.getDay();
            const hour = nyDate.getHours();
            const minute = nyDate.getMinutes();
            const timeInMinutes = hour * 60 + minute;
            // Mon (1) to Fri (5), 9:30 (570) to 16:00 (960)
            return (day >= 1 && day <= 5) && (timeInMinutes >= 570 && timeInMinutes < 960);
        } catch (e) {
            return false;
        }
    };

    const now = new Date();
    const quoteTime = item.regular_quote_time ? new Date(item.regular_quote_time) : null;
    const preferRegular = isRegularHours(now) && quoteTime && isRegularHours(quoteTime);
    let foundPrice = false;

    // If in regular session, try regular price first
    if (preferRegular && item.regular_price && parseFloat(String(item.regular_price).replace(/[$,]/g, '')) > 0) {
        price = parseFloat(String(item.regular_price).replace(/[$,]/g, ''));
        priceSource = 'regular';
        foundPrice = true;
    }

    if (!foundPrice) {
        // Check for pre-market price first
        if (item.pre_market_price && parseFloat(String(item.pre_market_price).replace(/[$,]/g, '')) > 0) {
            price = parseFloat(String(item.pre_market_price).replace(/[$,]/g, ''));
            priceSource = 'pre-market';
        }
        // Then check for after-hours price
        else if (item.after_hours_price && parseFloat(String(item.after_hours_price).replace(/[$,]/g, '')) > 0) {
            price = parseFloat(String(item.after_hours_price).replace(/[$,]/g, ''));
            priceSource = 'after-hours';
        }
        // Then check for extended hours (generic)
        else if (item.extended_hours_price && parseFloat(String(item.extended_hours_price).replace(/[$,]/g, '')) > 0) {
            price = parseFloat(String(item.extended_hours_price).replace(/[$,]/g, ''));
            priceSource = 'extended';
        }
        // Fall back to regular last price
        else if (item.regular_price) {
            price = parseFloat(String(item.regular_price).replace(/[$,]/g, ''));
            priceSource = 'regular';
        }
    }

    if (isNaN(price) || price === 0) return false;

    // Get previous close price.
    // IMPORTANT: Some data sources/scrapers do not include a previous_close_price
    // (or return an empty string / zero) on every update. If we blindly accept a
    // missing/empty/zero previous_close_price we'd overwrite a previously-known
    // valid value in our in-memory cache with null/0 and cause the dashboard to
    // display an incorrect "Prev Close" (e.g. 0). To avoid this, the code below
    // attempts to parse a valid prev-close from the incoming item. If the parsed
    // value is invalid, we preserve any previously-cached previous_close_price.
    // This keeps the canonical prev-close value available until a new valid one
    // is supplied by a later update.
    //
    // SOURCE-PRIORITY MERGING: When an incoming update has a valid prev-close,
    // we use source priority ranking to decide whether to accept it over the
    // cached value. Higher-priority sources (e.g., Google, NASDAQ) are preferred
    // over lower-priority sources (e.g., Stocktwits). This prevents low-quality
    // sources from overwriting good prev-close data.

    // Parse any incoming prev-close and capture its source/time metadata if present
    let incomingPrevClosePrice = null;
    let incomingPrevSource = null;
    let incomingPrevTime = null;

    if (item.previous_close_price) {
        const parsed = parseFloat(String(item.previous_close_price).replace(/[$,]/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
            incomingPrevClosePrice = parsed;
            // Prefer prev-specific metadata fields if scrapers include them, otherwise
            // fall back to the generic item-level metadata.
            incomingPrevSource = item.previous_close_source || item.source || null;
            incomingPrevTime = item.previous_close_time || item.capture_time || new Date().toISOString();
        }
    }

    // Prepare final prev-close values (will be set based on merge logic)
    let previousClosePrice = null;
    let prevCloseSource = null;
    let prevCloseTime = null;

    // Get cached prev-close data (if any)
    const cached = priceCache[normalizedKey] || null;

    // Use source-priority merge logic to decide whether to accept incoming prev-close
    const incomingData = {
        previousClosePrice: incomingPrevClosePrice,
        source: incomingPrevSource,
        time: incomingPrevTime
    };

    if (shouldAcceptIncomingPrevClose(incomingData, cached)) {
        // Accept incoming prev-close
        if (incomingPrevClosePrice !== null) {
            previousClosePrice = incomingPrevClosePrice;
            prevCloseSource = incomingPrevSource;
            prevCloseTime = incomingPrevTime;
            if (cached && cached.previous_close_price && cached.previous_close_price !== incomingPrevClosePrice) {
                console.log(`[PrevClose] ${normalizedKey}: Updated from ${cached.previous_close_price} (${cached.prev_close_source}) to ${previousClosePrice} (${prevCloseSource})`);
            }
        }
    } else {
        // Preserve cached prev-close
        if (cached && cached.previous_close_price) {
            previousClosePrice = cached.previous_close_price;
            prevCloseSource = cached.prev_close_source || null;
            prevCloseTime = cached.prev_close_time || null;
            if (incomingPrevClosePrice !== null) {
                console.log(`[PrevClose] ${normalizedKey}: Rejected ${incomingPrevClosePrice} from ${incomingPrevSource}, keeping ${previousClosePrice} from ${prevCloseSource}`);
            } else {
                console.warn(`Preserving existing previous_close_price for ${normalizedKey} (incoming update had none)`);
            }
        }
    }

    priceCache[normalizedKey] = {
        price: price,
        previous_close_price: previousClosePrice,
        // prev_close_source and prev_close_time record where and when the
        // prev-close value was obtained. These fields help with future
        // source-priority merging and debugging.
        prev_close_source: prevCloseSource,
        prev_close_time: prevCloseTime,
        currency: 'USD',
        time: item.capture_time || new Date().toISOString(),
        // Keep both the original symbol and the normalized key for consumers
        ticker: item.ticker || null,
        normalized_key: normalizedKey,
        source: item.source ? `${item.source} (${priceSource})` : priceSource
    };

    return true;
}

// Kafka Consumer Setup
const kafka = new Kafka({
    clientId: 'dashboard',
    brokers: KAFKA_BROKERS
});

const consumer = kafka.consumer({ groupId: KAFKA_GROUP_ID });

async function startKafkaConsumer() {
    try {
        console.log(`Connecting to Kafka brokers: ${KAFKA_BROKERS.join(',')}`);
        await consumer.connect();
        console.log('Connected to Kafka');

        await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });
        console.log(`Subscribed to topic: ${KAFKA_TOPIC}`);

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const value = message.value.toString();
                    const data = JSON.parse(value);
                    const displayKey = data.normalized_key || data.key || (data.ticker ? encodeURIComponent(String(data.ticker)) : '<no-key>');
                    console.log(`Received update for ${displayKey}`);

                    if (updatePriceCache(data)) {
                        // Broadcast updated prices to all connected clients
                        io.emit('price_update', priceCache);
                    }
                } catch (err) {
                    console.error('Error processing Kafka message:', err.message);
                }
            },
        });
    } catch (err) {
        console.error('Error starting Kafka consumer:', err);
        // Retry logic could go here
        setTimeout(startKafkaConsumer, 5000);
    }
}

// API to get assets
app.get('/api/assets', async (req, res) => {
    if (assetsCache) {
        res.json(assetsCache);
        return;
    }
    const data = await fetchAssetsFromDB();
    if (data) {
        assetsCache = data;
        res.json(data);
    } else {
        res.status(500).json({ error: 'Failed to fetch assets' });
    }
});

const LOGS_DIR = '/usr/src/app/logs';

// API to get all tickers for autocomplete
app.get('/api/tickers', async (req, res) => {
    try {
        const tickers = await loadAllTickers();
        res.json(tickers);
    } catch (err) {
        console.error('Error loading tickers:', err);
        res.status(500).json({ error: 'Failed to load tickers' });
    }
});

// Helper: Detect if a ticker is a bond by looking it up in the DB-backed registry
// Returns true if the ticker exists in the treasury registry (exchange === 'TREASURY')
async function isBondTicker(ticker) {
    if (!ticker) return false;
    const clean = ticker.trim().toUpperCase();

    const allTickers = await loadAllTickers();
    const tickerObj = allTickers.find(t => t.ticker === clean);
    
    // Treat anything in the registry with TREASURY/BOND security type as a bond.
    // (Historically some treasury records used exchange='OTC', so exchange alone is not reliable.)
    const securityType = tickerObj ? (tickerObj.securityType || tickerObj.security_type) : null;
    if (tickerObj && (tickerObj.exchange === 'TREASURY' || securityType === 'TREASURY' || securityType === 'BOND')) {
        return true;
    }
    
    return false;
}

// Helper: Resolve an account type id from various inputs (id, key, or legacy type string)
async function resolveAccountTypeId(accountInput) {
    if (!accountInput) return null;
    // If already provided as an id, use it
    if (accountInput.account_type_id && Number.isFinite(Number(accountInput.account_type_id))) {
        return Number(accountInput.account_type_id);
    }

    // If provided directly as id in request body (flat), accept it
    if (accountInput.account_type_id && typeof accountInput.account_type_id === 'string' && accountInput.account_type_id.match(/^\d+$/)) {
        return Number(accountInput.account_type_id);
    }

    // Try account_type_key first
    let rawType = accountInput.account_type_key || null;
    if (!rawType && accountInput.type) rawType = String(accountInput.type).trim();
    if (rawType) {
        const normalizedKey = String(rawType).toLowerCase().replace(/[^a-z0-9]+/g, '_');
        try {
            // 1) direct key match
            const [rows1] = await pool.query('SELECT id FROM account_types WHERE `key`=? LIMIT 1', [normalizedKey]);
            if (rows1 && rows1[0] && rows1[0].id) return rows1[0].id;
            // 2) exact display_name match
            const [rows2] = await pool.query('SELECT id FROM account_types WHERE LOWER(display_name)=? LIMIT 1', [rawType.toLowerCase()]);
            if (rows2 && rows2[0] && rows2[0].id) return rows2[0].id;
            // 3) partial display_name match
            const likePattern = '%' + rawType.toLowerCase().replace(/[^a-z0-9]+/g, '%') + '%';
            const [rows3] = await pool.query('SELECT id FROM account_types WHERE LOWER(display_name) LIKE ? LIMIT 1', [likePattern]);
            if (rows3 && rows3[0] && rows3[0].id) return rows3[0].id;
            // 4) key contains normalized substring
            const [rows4] = await pool.query('SELECT id FROM account_types WHERE `key` LIKE ? LIMIT 1', ['%' + normalizedKey + '%']);
            if (rows4 && rows4[0] && rows4[0].id) return rows4[0].id;
        } catch (e) {
            console.warn('resolveAccountTypeId lookup error:', e.message);
        }
    }

    // Heuristic synonyms / regex-based mapping for common legacy free-text values
    if (accountInput.type) {
        const t = String(accountInput.type).toLowerCase();
        const heuristics = [
            {re: /\b(roth)\b.*401/, key: 'roth_401k'},
            {re: /\b(roth).*ira|\broth\s*ira\b/, key: 'roth_ira'},
            {re: /\b401\s*\(?k\)?\b/, key: 'traditional_401k'},
            {re: /solo\s*401/, key: 'solo_401k'},
            {re: /simple\s*ira/, key: 'simple_ira'},
            {re: /traditional\s*ira|\bira\b/, key: 'traditional_ira'},
            {re: /529/, key: '529_plan'},
            {re: /savings?/, key: 'savings'},
            {re: /checking|checkings?/, key: 'checking'},
            {re: /hsa\b/, key: 'hsa'},
            {re: /cd\b/, key: 'cd'},
            {re: /money\s*market/, key: 'money_market'},
            {re: /ugma|utma/, key: 'ugma_utma'},
            {re: /sep\s*ira/, key: 'sep_ira'},
            {re: /credit\s*card|cc\b/, key: 'credit_card'},
            {re: /mortgage|loan/, key: 'loan'}
        ];
        for (const h of heuristics) {
            try {
                if (h.re.test(t)) {
                    const [rowsH] = await pool.query('SELECT id FROM account_types WHERE `key`=? LIMIT 1', [h.key]);
                    if (rowsH && rowsH[0] && rowsH[0].id) return rowsH[0].id;
                }
            } catch (e) { /* ignore */ }
        }
    }

    // Fallback to a sensible default if available
    try {
        const [rows] = await pool.query('SELECT id FROM account_types WHERE `key`=? LIMIT 1', ['individual_brokerage']);
        if (rows && rows[0] && rows[0].id) return rows[0].id;
        const [any] = await pool.query('SELECT id FROM account_types LIMIT 1');
        if (any && any[0] && any[0].id) return any[0].id;
    } catch (e) {
        console.warn('resolveAccountTypeId fallback error:', e.message);
    }

    return null;
}

// Helper: Trigger bond scrape by touching the marker file
// This forces the scrape daemon to run bond_positions on its next cycle
function triggerBondScrape() {
    // Use same path as scrape_daemon.js: /usr/src/app/logs/last.bond_positions.txt
    const markerPath = process.env.BOND_MARKER_PATH || '/usr/src/app/logs/last.bond_positions.txt';
    try {
        // Write timestamp 0 to force the daemon to think the task hasn't run
        fs.writeFileSync(markerPath, '0\nTriggered by dashboard\n');
        console.log(`[FetchPrice] Touched bond marker file: ${markerPath}`);
        return true;
    } catch (err) {
        console.error(`[FetchPrice] Failed to touch bond marker file: ${err.message}`);
        return false;
    }
}

// API to fetch current price for a ticker and inject into price cache
// Used when adding a new ticker to ensure immediate price display
// Also publishes to Kafka so the price persists to MySQL via the consumer
app.post('/api/fetch-price', async (req, res) => {
    const { ticker, type, security_type, pricing_provider } = req.body;

    if (!ticker || !ticker.trim()) {
        return res.status(400).json({ error: 'Ticker is required' });
    }

    const cleanTicker = ticker.trim().toUpperCase();

    // Determine security type (prefer security_type, fallback to type for compatibility)
    let securityType = security_type || type || 'stock';

    // Detect if this is a bond (by type parameter or treasury registry lookup)
    const isBond = securityType === 'bond' || await isBondTicker(cleanTicker);

    if (isBond) {
        securityType = 'bond';
        // For bonds, trigger the scrape daemon to fetch prices on its next cycle
        // This avoids duplicating the Webull scraping code
        console.log(`[FetchPrice] Detected bond ${cleanTicker}, triggering scrape daemon...`);
        const triggered = triggerBondScrape();

        return res.json({
            ticker: cleanTicker,
            security_type: securityType,
            isBond: true,
            triggered: triggered,
            message: triggered
                ? 'Bond price will be fetched by scrape daemon on next cycle'
                : 'Failed to trigger scrape daemon, check logs',
            note: 'Bond prices are scraped asynchronously via Webull'
        });
    }

    // Use PriceRouter for intelligent routing
    try {
        const PriceRouter = require('../services/price-router');
        const priceRouter = new PriceRouter({ pool });

        console.log(`[FetchPrice] Fetching price for ${cleanTicker} (${securityType})...`);

        // Fetch price using router (handles provider selection and fallback)
        const priceData = await priceRouter.fetchPrice(cleanTicker, securityType, {
            pricingProvider: pricing_provider,
            allowFallback: true
        });

        if (!priceData || !priceData.price) {
            return res.status(404).json({
                error: 'No price data returned',
                ticker: cleanTicker,
                security_type: securityType
            });
        }

        const { price, previous_close_price, currency, time, source, pricing_provider: usedProvider } = priceData;

        // Build cache key with security type to support multiple prices per ticker
        const cacheKey = `${cleanTicker}:${securityType}`;

        // Update the in-memory price cache for immediate display
        priceCache[cacheKey] = {
            ticker: cleanTicker,
            security_type: securityType,
            price: price,
            previous_close_price: previous_close_price,
            prev_close_source: source,
            prev_close_time: time,
            currency: currency || 'USD',
            time: time,
            source: source,
            pricing_provider: usedProvider
        };

        // Also update legacy cache key (ticker only) for backward compatibility
        if (!priceCache[cleanTicker] || securityType === 'stock') {
            priceCache[cleanTicker] = priceCache[cacheKey];
        }

        // Broadcast to all connected clients for immediate UI update
        io.emit('price_update', priceCache);

        console.log(`[FetchPrice] Updated price cache for ${cleanTicker} (${securityType}): $${price} via ${usedProvider}`);

        // Save to database with security_type
        let dbSaved = false;
        try {
            await priceRouter.savePriceToDatabase(priceData);
            dbSaved = true;
        } catch (dbErr) {
            console.error(`[FetchPrice] Database save failed:`, dbErr.message);
        }

        // Publish to Kafka so the consumer persists to MySQL (legacy flow)
        let kafkaPublished = false;
        try {
            const { Kafka } = require('kafkajs');
            const kafka = new Kafka({
                clientId: 'dashboard-fetch-price',
                brokers: (process.env.KAFKA_BROKERS || 'kafka:9092').split(',')
            });
            const producer = kafka.producer();
            await producer.connect();

            // Format message to match what the Kafka consumer expects
            const kafkaMessage = {
                key: cleanTicker,
                ticker: cleanTicker,
                security_type: securityType,
                normalized_key: cleanTicker,
                regular_price: price,
                previous_close_price: previous_close_price,
                currency: currency || 'USD',
                time: time,
                source: source,
                pricing_provider: usedProvider,
                scraper: 'dashboard-fetch'
            };

            await producer.send({
                topic: process.env.KAFKA_TOPIC || 'price_data',
                messages: [{
                    key: cleanTicker,
                    value: JSON.stringify(kafkaMessage)
                }]
            });

            await producer.disconnect();
            kafkaPublished = true;
            console.log(`[FetchPrice] Published ${cleanTicker} to Kafka for persistence`);
        } catch (kafkaErr) {
            console.error(`[FetchPrice] Kafka publish failed for ${cleanTicker}:`, kafkaErr.message);
            // Don't fail the request - price is already in cache and database
        }

        res.json({
            ticker: cleanTicker,
            security_type: securityType,
            price: price,
            previousClose: previous_close_price,
            currency: currency || 'USD',
            timestamp: time,
            pricing_provider: usedProvider,
            cached: true,
            persisted_db: dbSaved,
            persisted_kafka: kafkaPublished
        });

    } catch (error) {
        console.error(`[FetchPrice] Error fetching price for ${cleanTicker}:`, error.message);
        res.status(500).json({
            error: error.message,
            ticker: cleanTicker,
            security_type: securityType
        });
    }
});

app.get('/api/logs', async (req, res) => {
    try {
        if (!fs.existsSync(LOGS_DIR)) {
            return res.json([]);
        }
        const files = await fs.promises.readdir(LOGS_DIR);
        const fileStats = await Promise.all(files.map(async (file) => {
            const filePath = path.join(LOGS_DIR, file);
            const stats = await fs.promises.stat(filePath);
            return {
                name: file,
                timestamp: stats.mtime,
                size: stats.size
            };
        }));

        // Sort by timestamp descending (most recent first)
        fileStats.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json(fileStats);
    } catch (error) {
        console.error('Error reading logs directory:', error);
        res.status(500).json({ error: 'Failed to list logs' });
    }
});

app.get('/api/logs/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        // Basic security check to prevent directory traversal
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const filePath = path.join(LOGS_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (filename.endsWith('.gz')) {
            res.download(filePath);
        } else {
            res.sendFile(filePath);
        }
    } catch (error) {
        console.error('Error reading log file:', error);
        res.status(500).json({ error: 'Failed to read log file' });
    }
});

// Helper function to export raw database rows for import compatibility
async function fetchRawDataForExport() {
    try {
        // Fetch raw accounts with all fields needed for import
        const [accounts] = await pool.query(`
            SELECT id, name, account_type_id, currency, display_order
            FROM accounts
            ORDER BY display_order
        `);

        // Fetch raw positions with all fields from schema
        const [positions] = await pool.query(`
            SELECT id, account_id, ticker, description, quantity, type,
                   exchange, currency, maturity_date, coupon, normalized_key
            FROM positions
        `);

        // Fetch raw fixed_assets
        const [fixedAssets] = await pool.query(`
            SELECT id, name, type, value, currency, display_order
            FROM fixed_assets
            ORDER BY display_order
        `);

        return {
            accounts: accounts,
            positions: positions,
            fixed_assets: fixedAssets
        };
    } catch (error) {
        console.error('Error fetching raw export data:', error);
        throw error;
    }
}

// API to export all data
app.get('/api/export', async (req, res) => {
    try {
        const data = await fetchRawDataForExport();
        const exportData = {
            exportDate: new Date().toISOString(),
            version: '2.0',  // Updated version to indicate new format
            data: data
        };
        res.json(exportData);
    } catch (error) {
        console.error('Error exporting data:', error);
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// API to import data
app.post('/api/import', async (req, res) => {
    try {
        const importData = req.body;

        // Validate the data structure
        if (!importData.data || !importData.data.accounts || !importData.data.positions) {
            return res.status(400).json({ error: 'Invalid data format' });
        }

        const { accounts, positions, fixed_assets } = importData.data;

        // Start transaction (use query for transaction control statements)
        await pool.query('START TRANSACTION');

        try {
            // Clear existing data
            await pool.execute('DELETE FROM positions');
            await pool.execute('DELETE FROM accounts');
            if (fixed_assets && fixed_assets.length > 0) {
                await pool.execute('DELETE FROM fixed_assets');
            }

            // Insert accounts (resolve account_type_id)
            for (const account of accounts) {
                const accountTypeId = await resolveAccountTypeId(account);
                await pool.execute(
                    'INSERT INTO accounts (id, name, account_type_id, currency, display_order) VALUES (?, ?, ?, ?, ?)',
                    [account.id, account.name, accountTypeId, account.currency || 'USD', account.display_order || 0]
                );
            }

            // Insert positions
            for (const position of positions) {
                await pool.execute(
                    'INSERT INTO positions (account_id, ticker, description, quantity, type, exchange, currency, maturity_date, coupon, normalized_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        position.account_id,
                        position.ticker || null,
                        position.description || null,
                        position.quantity,
                        position.type,
                        position.exchange || null,
                        position.currency || 'USD',
                        position.maturity_date || null,
                        position.coupon || null,
                        position.normalized_key || null
                    ]
                );
            }

            // Insert fixed assets if present
            if (fixed_assets && fixed_assets.length > 0) {
                for (const asset of fixed_assets) {
                    await pool.execute(
                        'INSERT INTO fixed_assets (name, type, value, currency, display_order) VALUES (?, ?, ?, ?, ?)',
                        [asset.name, asset.type, asset.value, asset.currency || 'USD', asset.display_order || 0]
                    );
                }
            }

            // Commit transaction (use query for transaction control statements)
            await pool.query('COMMIT');

            // Clear cache so dashboard refreshes with new data
            assetsCache = null;

            res.json({ success: true, message: 'Data imported successfully' });

        } catch (error) {
            // Rollback on error (use query for transaction control statements)
            await pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Error importing data:', error);
        res.status(500).json({ error: 'Failed to import data: ' + error.message });
    }
});

// CRUD Endpoints

// Accounts
app.post('/api/accounts', async (req, res) => {
    const { name, account_type_id, account_type_key, type, currency, display_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    try {
        const accountTypeId = account_type_id || await resolveAccountTypeId({ account_type_key, type });
        if (!accountTypeId) return res.status(400).json({ error: 'Unable to resolve account_type_id' });

        const [result] = await pool.execute(
            'INSERT INTO accounts (name, account_type_id, currency, display_order) VALUES (?, ?, ?, ?)',
            [name, accountTypeId, currency || 'USD', display_order || 0]
        );
        assetsCache = null;
        loadAssets();
        res.json({ id: result.insertId, name, account_type_id: accountTypeId, currency: currency || 'USD', display_order: display_order || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/accounts/:id', async (req, res) => {
    const { name, account_type_id, account_type_key, type, currency, display_order } = req.body;
    try {
        const updates = [];
        const params = [];
        if (name !== undefined) { updates.push('name=?'); params.push(name); }
        if (account_type_id !== undefined || account_type_key !== undefined || type !== undefined) {
            const accountTypeId = account_type_id || await resolveAccountTypeId({ account_type_key, type });
            if (!accountTypeId) return res.status(400).json({ error: 'Unable to resolve account_type_id' });
            updates.push('account_type_id=?'); params.push(accountTypeId);
        }
        if (currency !== undefined) { updates.push('currency=?'); params.push(currency); }
        if (display_order !== undefined) { updates.push('display_order=?'); params.push(display_order); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(req.params.id);
        await pool.execute(
            `UPDATE accounts SET ${updates.join(', ')} WHERE id=?`,
            params
        );
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Account Types CRUD
app.get('/api/account-types', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, `key`, display_name, category, tax_treatment, custodial, requires_ssn, active, sort_order FROM account_types WHERE active=1 ORDER BY sort_order');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/account-types', async (req, res) => {
    const { key, display_name, category, tax_treatment, custodial, requires_ssn, sort_order } = req.body;
    if (!key || !display_name || !category) return res.status(400).json({ error: 'key, display_name and category are required' });
    try {
        const [result] = await pool.execute('INSERT INTO account_types (`key`, display_name, category, tax_treatment, custodial, requires_ssn, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', [key, display_name, category, tax_treatment || 'unknown', custodial ? 1 : 0, requires_ssn ? 1 : 0, sort_order || 1000]);
        res.json({ id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/account-types/:id', async (req, res) => {
    const { display_name, category, tax_treatment, custodial, requires_ssn, active, sort_order } = req.body;
    try {
        const updates = [];
        const params = [];
        if (display_name !== undefined) { updates.push('display_name=?'); params.push(display_name); }
        if (category !== undefined) { updates.push('category=?'); params.push(category); }
        if (tax_treatment !== undefined) { updates.push('tax_treatment=?'); params.push(tax_treatment); }
        if (custodial !== undefined) { updates.push('custodial=?'); params.push(custodial ? 1 : 0); }
        if (requires_ssn !== undefined) { updates.push('requires_ssn=?'); params.push(requires_ssn ? 1 : 0); }
        if (active !== undefined) { updates.push('active=?'); params.push(active ? 1 : 0); }
        if (sort_order !== undefined) { updates.push('sort_order=?'); params.push(sort_order); }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
        params.push(req.params.id);
        await pool.execute(`UPDATE account_types SET ${updates.join(', ')} WHERE id=?`, params);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/account-types/:id', async (req, res) => {
    try {
        // Soft-delete
        await pool.execute('UPDATE account_types SET active=0 WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/accounts/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM positions WHERE account_id=?', [req.params.id]);
        await pool.execute('DELETE FROM accounts WHERE id=?', [req.params.id]);
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Positions
// Type is auto-detected from treasury registry based on ticker
app.post('/api/positions', async (req, res) => {
    const { normalizePositionBody } = require('./position_body');
    const normalized = normalizePositionBody(req.body);
    const { account_id, ticker, quantity, currency, type, source, pricing_provider } = normalized;

    if (!ticker) {
        return res.status(400).json({ error: 'ticker is required' });
    }
    if (!Number.isFinite(quantity)) {
        return res.status(400).json({ error: 'quantity must be a valid number' });
    }

    try {
        // Valid position types based on VARCHAR definition
        const validTypes = ['stock', 'etf', 'bond', 'cash', 'crypto', 'other'];

        // Type-driven only: respect incoming type when provided.
        // If type is not provided, fall back to bond auto-detection (else stock).
        let detectedType = (type && String(type).trim()) ? String(type).trim().toLowerCase() : null;

        // Validate type against allowed values
        if (detectedType && !validTypes.includes(detectedType)) {
            return res.status(400).json({
                error: `Invalid type '${detectedType}'. Must be one of: ${validTypes.join(', ')}`
            });
        }

        if (!detectedType) {
            detectedType = await isBondTicker(ticker) ? 'bond' : 'stock';
        }

        const [result] = await pool.execute(
            'INSERT INTO positions (account_id, ticker, security_type, quantity, currency, source, pricing_provider) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [account_id, ticker, detectedType, quantity, currency || 'USD', source || null, pricing_provider || null]
        );
        assetsCache = null;
        loadAssets();
        res.json({
            id: result.insertId,
            account_id,
            ticker,
            type: detectedType,
            quantity,
            currency: currency || 'USD',
            source: source || null,
            pricing_provider: pricing_provider || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/positions/:id', async (req, res) => {
    const { normalizePositionBody } = require('./position_body');
    const normalized = normalizePositionBody(req.body);
    const { ticker, quantity, currency, type, source, pricing_provider } = normalized;

    if (!ticker) {
        return res.status(400).json({ error: 'ticker is required' });
    }
    if (!Number.isFinite(quantity)) {
        return res.status(400).json({ error: 'quantity must be a valid number' });
    }

    try {
        // Valid position types based on VARCHAR definition
        const validTypes = ['stock', 'etf', 'bond', 'cash', 'crypto', 'other'];

        // Type-driven only: respect incoming type when provided.
        // If type is not provided, fall back to bond auto-detection (else stock).
        let detectedType = (type && String(type).trim()) ? String(type).trim().toLowerCase() : null;

        // Validate type against allowed values
        if (detectedType && !validTypes.includes(detectedType)) {
            return res.status(400).json({
                error: `Invalid type '${detectedType}'. Must be one of: ${validTypes.join(', ')}`
            });
        }

        if (!detectedType) {
            detectedType = await isBondTicker(ticker) ? 'bond' : 'stock';
        }

        await pool.execute(
            'UPDATE positions SET ticker=?, security_type=?, quantity=?, currency=?, source=?, pricing_provider=? WHERE id=?',
            [ticker, detectedType, quantity, currency || 'USD', source || null, pricing_provider || null, req.params.id]
        );
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/positions/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM positions WHERE id=?', [req.params.id]);
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fixed Assets
app.post('/api/fixed_assets', async (req, res) => {
    const { name, type, value, currency, display_order } = req.body;
    try {
        const [result] = await pool.execute(
            'INSERT INTO fixed_assets (name, type, value, currency, display_order) VALUES (?, ?, ?, ?, ?)',
            [name, type, value, currency || 'USD', display_order || 0]
        );
        assetsCache = null;
        loadAssets();
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/fixed_assets/:id', async (req, res) => {
    const { name, type, value, currency, display_order } = req.body;
    try {
        await pool.execute(
            'UPDATE fixed_assets SET name=?, type=?, value=?, currency=?, display_order=? WHERE id=?',
            [name, type, value, currency, display_order, req.params.id]
        );
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/fixed_assets/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM fixed_assets WHERE id=?', [req.params.id]);
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected');
    // Send current prices immediately
    socket.emit('price_update', priceCache);

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Start logic with debug logging
const isMainModule = require.main === module;
const isTestEnv = process.env.NODE_ENV === 'test';

console.log(`[Startup] Checks: require.main===module? ${isMainModule}, NODE_ENV=${process.env.NODE_ENV}`);

// Start if running directly OR if not in test environment (fallback for Docker)
if (isMainModule || !isTestEnv) {
    if (!isMainModule) {
        console.log('[Startup] require.main !== module, but starting because not in test env.');
    }
    // Self-execute async start wrapper
    (async () => {
        try {
            await runDatabaseMigrations();
            await ensureSchema();
            await initializeSymbolRegistry();
            server.listen(PORT, async () => {
                console.log(`Dashboard server running on ${protocol}://localhost:${PORT}`);
                await fetchInitialPrices();
                startKafkaConsumer();
            });
        } catch (e) {
            console.error('Startup failed:', e);
        }
    })();
}

module.exports = { app, server, pool, assetsPollingInterval };
