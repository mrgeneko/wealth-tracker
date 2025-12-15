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
        security_term,
        sort_rank
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
        const normalizedPrefix = (prefix || '').toString().toUpperCase();
        const [rows] = await conn.execute(`
      SELECT ticker, name, exchange, security_type
      FROM ticker_registry
      WHERE ticker LIKE ?
      ORDER BY sort_rank ASC, ticker ASC
      LIMIT ?
    `, [`${normalizedPrefix}%`, limit]);

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
