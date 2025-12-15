let exchangeCache = null;
let dbPool = null;

/**
 * Initialize the database connection pool used for exchange lookups.
 * @param {Object} pool - mysql2/promise pool
 */
function initializeDbPool(pool) {
    dbPool = pool;
    exchangeCache = null;
}

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

    let conn;
    try {
        conn = await dbPool.getConnection();
        const [rows] = await conn.query(
            `SELECT ticker, exchange
             FROM ticker_registry
             WHERE exchange IN ('NASDAQ', 'NYSE', 'OTHER')
               AND ticker IS NOT NULL`
        );

        for (const row of rows) {
            const ticker = row && row.ticker ? String(row.ticker).trim().toUpperCase() : '';
            const exchange = row && row.exchange ? String(row.exchange).trim().toUpperCase() : '';
            if (!ticker || !exchange) continue;

            if (exchange === 'NASDAQ') cache.NASDAQ.add(ticker);
            else if (exchange === 'NYSE') cache.NYSE.add(ticker);
            else if (exchange === 'OTHER') cache.OTHER.add(ticker);
        }
    } finally {
        if (conn && typeof conn.release === 'function') {
            conn.release();
        }
    }

    exchangeCache = cache;
    return cache;
}

/**
 * Determines the exchange for a given ticker.
 * @param {string} ticker - The stock ticker (e.g. 'AAPL', 'BRK.B')
 * @returns {string|null} - 'NASDAQ', 'NYSE', or null if not found
 */
async function getExchange(ticker) {
    if (!ticker) return null;
    const normalizedTicker = String(ticker).toUpperCase().replace(/-/g, '.');

    const data = await loadExchangeData();

    if (data.NASDAQ.has(normalizedTicker)) return 'NASDAQ';
    if (data.NYSE.has(normalizedTicker)) return 'NYSE';
    if (data.OTHER.has(normalizedTicker)) return 'OTHER';

    return null;
}

// Small helper: return a normalized representation of a ticker for
// any callers that wish to use the same percent-encoding naming used
// by scrapers and message keys. This is intentionally non-invasive and
// only provides a convenience wrapper for other modules/tests.
function normalizedTickerForLookup(ticker) {
    if (!ticker) return '';
    // Use encodeURIComponent directly to avoid circular dependency with scraper_utils
    return encodeURIComponent(String(ticker));
}

/**
 * Forces a reload of the exchange data from disk.
 * Useful if the files have been updated while the process is running.
 */
function reloadExchangeData() {
    exchangeCache = null;
}

module.exports = {
    getExchange,
    reloadExchangeData,
    loadExchangeData
    , normalizedTickerForLookup,
    initializeDbPool
};
