const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const CONFIG_DIR = path.join(__dirname, '../config');
const NASDAQ_FILE = path.join(CONFIG_DIR, 'nasdaq-listed.csv');
const NYSE_FILE = path.join(CONFIG_DIR, 'nyse-listed.csv');

let exchangeCache = null;

function loadExchangeData() {
    if (exchangeCache) return exchangeCache;

    const cache = {
        NASDAQ: new Set(),
        NYSE: new Set()
    };

    try {
        if (fs.existsSync(NASDAQ_FILE)) {
            const content = fs.readFileSync(NASDAQ_FILE);
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true
            });
            // NASDAQ CSV header: Symbol,Security Name,...
            records.forEach(record => {
                if (record.Symbol) {
                    cache.NASDAQ.add(record.Symbol.trim().toUpperCase());
                }
            });
        }

        if (fs.existsSync(NYSE_FILE)) {
            const content = fs.readFileSync(NYSE_FILE);
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true
            });
            // NYSE CSV header: ACT Symbol,Company Name,...
            records.forEach(record => {
                if (record['ACT Symbol']) {
                    cache.NYSE.add(record['ACT Symbol'].trim().toUpperCase());
                }
            });
        }
    } catch (e) {
        console.error('Error loading exchange data:', e.message);
    }

    exchangeCache = cache;
    return cache;
}

/**
 * Determines the exchange for a given ticker.
 * @param {string} ticker - The stock ticker (e.g. 'AAPL', 'BRK.B')
 * @returns {string|null} - 'NASDAQ', 'NYSE', or null if not found
 */
function getExchange(ticker) {
    if (!ticker) return null;
    const normalizedTicker = ticker.toUpperCase().replace(/-/g, '.'); // Normalize BRK-B to BRK.B for lookup if needed, though CSVs might use different formats.
    // The CSVs seem to use dots for classes (e.g. BRK.B).
    // Let's try exact match first, then normalized.
    
    const data = loadExchangeData();
    
    // Check NASDAQ
    if (data.NASDAQ.has(ticker) || data.NASDAQ.has(normalizedTicker)) return 'NASDAQ';
    
    // Check NYSE
    if (data.NYSE.has(ticker) || data.NYSE.has(normalizedTicker)) return 'NYSE';

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
    loadExchangeData();
}

module.exports = {
    getExchange,
    reloadExchangeData,
    loadExchangeData
    , normalizedTickerForLookup
};
