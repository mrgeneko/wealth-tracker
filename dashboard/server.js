const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const { Kafka } = require('kafkajs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const mysql = require('mysql2/promise');
const basicAuth = require('express-basic-auth');
const { loadAllTickers } = require('./ticker_registry');

// Phase 9.2: WebSocket Real-time Metrics
const MetricsWebSocketServer = require('./services/websocket-server');
const ScraperMetricsCollector = require('./services/scraper-metrics-collector');

const app = express();

// Load SSL Certificates if available
const keyPath = path.join(__dirname, 'certs', 'server.key');
const certPath = path.join(__dirname, 'certs', 'server.crt');
let server;
let protocol = 'http';

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
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
    console.log('SSL certificates not found. Starting HTTP server.');
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
const sourcePriorityPath = path.join(__dirname, '../config/source_priority.json');
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
const metadataRouter = require('./api/metadata');
app.use('/api/metadata', metadataRouter);

// Mount Autocomplete API (will be initialized after pool is created)
const { router: autocompleteRouter } = require('./api/autocomplete');
app.use('/api/autocomplete', autocompleteRouter);

// Mount Cleanup API (will be initialized after pool is created)
const { router: cleanupRouter } = require('./api/cleanup');
app.use('/api/cleanup', cleanupRouter);

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
        const { runAllMigrations } = require('../scripts/run-migrations');
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
const { initializePool } = require('./api/autocomplete');
initializePool(pool);

// Initialize the cleanup API with the pool
const { initializePool: initializeCleanupPool } = require('./api/cleanup');
initializeCleanupPool(pool);

// Initialize the statistics API with the pool
const { router: statisticsRouter, initializePool: initializeStatisticsPool } = require('./api/statistics');
app.use('/api/statistics', statisticsRouter);
initializeStatisticsPool(pool);

// Initialize the metrics API with the pool
const { router: metricsRouter, initializePool: initializeMetricsPool } = require('./api/metrics');
app.use('/api/metrics', metricsRouter);
initializeMetricsPool(pool);

// Initialize symbol registry sync service to load CSV data on startup
async function initializeSymbolRegistry() {
    try {
        const { SymbolRegistrySyncService, SymbolRegistryService } = require('./services/symbol-registry');
        const symbolService = new SymbolRegistryService(pool);
        const syncService = new SymbolRegistrySyncService(pool, symbolService);
        
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
        const [accounts] = await pool.query('SELECT * FROM accounts ORDER BY display_order');

        // Fetch positions with metadata
        // Use COLLATE to ensure compatibility between tables
        const [positions] = await pool.query(`
            SELECT p.*, 
                   sm.short_name, sm.sector, sm.market_cap, 
                   sm.dividend_yield, sm.trailing_pe, 
                   sm.ttm_dividend_amount, sm.ttm_eps,
                   sm.quote_type, sm.exchange as meta_exchange
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
                type: acc.type,
                category: acc.category,
                holdings: {
                    cash: null,
                    stocks: [],
                    bonds: []
                }
            };

            const accPositions = positions.filter(p => p.account_id === acc.id);

            for (const pos of accPositions) {
                // Determine display type
                const displayType = pos.type; // Default to stored type

                // Common position object
                const positionData = {
                    id: pos.id,
                    ticker: pos.ticker,
                    quantity: parseFloat(pos.quantity),
                    cost_basis: pos.cost_basis ? parseFloat(pos.cost_basis) : 0,
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

                if (pos.type === 'cash') {
                    accountObj.holdings.cash = {
                        id: pos.id,
                        value: parseFloat(pos.quantity),
                        currency: pos.currency
                    };
                } else if (pos.type === 'bond') {
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
    clientId: 'wealth-tracker-dashboard',
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
app.get('/api/tickers', (req, res) => {
    try {
        const tickers = loadAllTickers();
        res.json(tickers);
    } catch (err) {
        console.error('Error loading tickers:', err);
        res.status(500).json({ error: 'Failed to load tickers' });
    }
});

// Helper: Detect if a ticker is a bond by looking it up in the treasury file
// Returns true if the ticker exists in the treasury registry (exchange === 'TREASURY')
function isBondTicker(ticker) {
    if (!ticker) return false;
    const clean = ticker.trim().toUpperCase();
    
    // Look up in ticker registry which loads from us-treasury-auctions.csv
    const allTickers = loadAllTickers();
    const tickerObj = allTickers.find(t => t.ticker === clean);
    
    // If found and exchange is TREASURY, it's a bond
    if (tickerObj && tickerObj.exchange === 'TREASURY') {
        return true;
    }
    
    return false;
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
    const { ticker, type } = req.body;

    if (!ticker || !ticker.trim()) {
        return res.status(400).json({ error: 'Ticker is required' });
    }

    const cleanTicker = ticker.trim().toUpperCase();
    
    // Detect if this is a bond (by type parameter or treasury registry lookup)
    const isBond = type === 'bond' || isBondTicker(cleanTicker);
    
    if (isBond) {
        // For bonds, trigger the scrape daemon to fetch prices on its next cycle
        // This avoids duplicating the Webull scraping code
        console.log(`[FetchPrice] Detected bond ${cleanTicker}, triggering scrape daemon...`);
        const triggered = triggerBondScrape();
        
        return res.json({
            ticker: cleanTicker,
            isBond: true,
            triggered: triggered,
            message: triggered 
                ? 'Bond price will be fetched by scrape daemon on next cycle'
                : 'Failed to trigger scrape daemon, check logs',
            note: 'Bond prices are scraped asynchronously via Webull'
        });
    }
    
    // Stock/ETF: Use Yahoo Finance
    try {
        // Load yahoo-finance2 v3 (requires instantiation)
        const YahooFinanceClass = require('yahoo-finance2').default || require('yahoo-finance2');
        const yahooFinance = new YahooFinanceClass({
            suppressNotices: ['yahooSurvey', 'rippieTip']
        });
        
        console.log(`[FetchPrice] Fetching current price for ${cleanTicker}...`);
        const quote = await yahooFinance.quote(cleanTicker);

        if (!quote || !quote.regularMarketPrice) {
            return res.status(404).json({
                error: 'No price data returned',
                ticker: cleanTicker
            });
        }

        const price = quote.regularMarketPrice;
        const previousClose = quote.regularMarketPreviousClose || null;
        const now = new Date().toISOString();

        // Update the in-memory price cache for immediate display
        priceCache[cleanTicker] = {
            price: price,
            previous_close_price: previousClose,
            prev_close_source: 'yahoo',
            prev_close_time: now,
            currency: quote.currency || 'USD',
            time: now,
            source: 'yahoo'
        };

        // Broadcast to all connected clients for immediate UI update
        io.emit('price_update', priceCache);

        console.log(`[FetchPrice] Updated price cache for ${cleanTicker}: $${price}`);

        // Publish to Kafka so the consumer persists to MySQL
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
            // Consumer uses data.get('key') for the ticker
            const kafkaMessage = {
                key: cleanTicker,                    // Required by consumer
                ticker: cleanTicker,
                normalized_key: cleanTicker,
                regular_price: price,
                previous_close_price: previousClose,
                currency: quote.currency || 'USD',
                time: now,
                source: 'yahoo',
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
            // Don't fail the request - price is already in cache for immediate display
        }

        res.json({
            ticker: cleanTicker,
            price: price,
            previousClose: previousClose,
            currency: quote.currency || 'USD',
            timestamp: now,
            cached: true,
            persisted: kafkaPublished
        });

    } catch (error) {
        console.error(`[FetchPrice] Error fetching price for ${cleanTicker}:`, error.message);
        res.status(500).json({
            error: error.message,
            ticker: cleanTicker
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

// API to export all data
app.get('/api/export', async (req, res) => {
    try {
        const data = await fetchAssetsFromDB();
        const exportData = {
            exportDate: new Date().toISOString(),
            version: '1.0',
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

        // Start transaction
        await pool.execute('START TRANSACTION');

        try {
            // Clear existing data
            await pool.execute('DELETE FROM positions');
            await pool.execute('DELETE FROM accounts');
            if (fixed_assets && fixed_assets.length > 0) {
                await pool.execute('DELETE FROM fixed_assets');
            }

            // Insert accounts
            for (const account of accounts) {
                await pool.execute(
                    'INSERT INTO accounts (id, name, type, category, currency, display_order) VALUES (?, ?, ?, ?, ?, ?)',
                    [account.id, account.name, account.type, account.category || 'investment', account.currency || 'USD', account.display_order || 0]
                );
            }

            // Insert positions
            for (const position of positions) {
                await pool.execute(
                    'INSERT INTO positions (account_id, ticker, quantity, type, exchange, currency, maturity_date, coupon, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        position.account_id,
                        position.ticker,
                        position.quantity,
                        position.type,
                        position.exchange || null,
                        position.currency || 'USD',
                        position.maturity_date || null,
                        position.coupon || null,
                        position.display_order || 0
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

            // Commit transaction
            await pool.execute('COMMIT');

            // Clear cache so dashboard refreshes with new data
            assetsCache = null;

            res.json({ success: true, message: 'Data imported successfully' });

        } catch (error) {
            // Rollback on error
            await pool.execute('ROLLBACK');
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
    const { name, type, category, currency, display_order } = req.body;
    try {
        const [result] = await pool.execute(
            'INSERT INTO accounts (name, type, category, currency, display_order) VALUES (?, ?, ?, ?, ?)',
            [name, type, category, currency || 'USD', display_order || 0]
        );
        assetsCache = null;
        loadAssets();
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/accounts/:id', async (req, res) => {
    const { name, type, category, currency, display_order } = req.body;
    try {
        // Build dynamic update query to only update provided fields
        const updates = [];
        const params = [];
        if (name !== undefined) { updates.push('name=?'); params.push(name); }
        if (type !== undefined) { updates.push('type=?'); params.push(type); }
        if (category !== undefined) { updates.push('category=?'); params.push(category); }
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
app.post('/api/positions', async (req, res) => {
    const { account_id, ticker, type, quantity, currency } = req.body;
    try {
        const [result] = await pool.execute(
            'INSERT INTO positions (account_id, ticker, type, quantity, currency) VALUES (?, ?, ?, ?, ?)',
            [account_id, ticker, type, quantity, currency || 'USD']
        );
        assetsCache = null;
        loadAssets();
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/positions/:id', async (req, res) => {
    const { ticker, type, quantity, currency } = req.body;
    try {
        await pool.execute(
            'UPDATE positions SET ticker=?, type=?, quantity=?, currency=? WHERE id=?',
            [ticker, type, quantity, currency || 'USD', req.params.id]
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
