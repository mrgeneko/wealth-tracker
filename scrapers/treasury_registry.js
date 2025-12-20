const { normalizedKey } = require('./scraper_utils');

/**
 * Treasury Registry
 *
 * Provides lookup functionality for treasury securities (bonds, bills, notes).
 *
 * Data source: Database (ticker_registry table)
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
 * Load treasury tickers/CUSIPs into cache
 * @returns {Promise<Set<string>>} Set of treasury tickers/CUSIPs
 */
async function loadTreasuryCache() {
    if (treasuryCache) return treasuryCache;

    if (!dbPool) {
        throw new Error('Database pool not initialized. Call initializeDbPool() first.');
    }

    const conn = await dbPool.getConnection();
    try {
        const [rows] = await conn.execute(
            "SELECT ticker FROM ticker_registry WHERE security_type = 'US_TREASURY'"
        );
        treasuryCache = new Set((rows || []).map(r => String(r.ticker || '').toUpperCase()).filter(Boolean));
        console.log(`[TreasuryRegistry] Loaded ${treasuryCache.size} treasury securities from database`);
        return treasuryCache;
    } finally {
        conn.release();
    }
}

/**
 * Determines if a ticker (CUSIP) is a US Treasury security.
 * @param {string} ticker - The CUSIP or identifier
 * @returns {Promise<boolean>} true if found in treasury listings
 */
async function isTreasury(ticker) {
    if (!ticker) return false;
    const normalized = String(ticker).trim().toUpperCase();
    const cache = await loadTreasuryCache();
    return cache.has(normalized);
}

/**
 * Get treasury security details
 * @param {string} ticker - Ticker/CUSIP
 * @returns {Promise<Object|null>} Treasury details or null
 */
async function getTreasuryDetails(ticker) {
    if (!ticker) return null;

    if (!dbPool) {
        throw new Error('Database pool not initialized. Call initializeDbPool() first.');
    }

    const conn = await dbPool.getConnection();
    try {
        const [rows] = await conn.execute(
            `SELECT ticker, name, issue_date, maturity_date, security_term
       FROM ticker_registry
       WHERE ticker = ? AND security_type = 'US_TREASURY'
       LIMIT 1`,
            [String(ticker).toUpperCase()]
        );

        if (rows && rows.length > 0) {
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

// Utility: return a normalized identifier for a treasury ticker/CUSIP.
// This is provided mainly for tests and external callers that want
// to match the encoding used by scrapers/publishers.
function normalizedIdentifier(ticker) {
    if (!ticker) return '';
    return normalizedKey(ticker);
}

async function reloadTreasuryData() {
    treasuryCache = null;
    await loadTreasuryCache();
}

module.exports = {
    isTreasury,
    reloadTreasuryData,
    loadTreasuryCache,
    getTreasuryDetails,
    initializeDbPool,
    normalizedIdentifier
};
