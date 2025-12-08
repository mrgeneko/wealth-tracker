const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { normalizedKey } = require('./scraper_utils');

const CONFIG_DIR = path.join(__dirname, '../config');
const TREASURY_FILE = path.join(CONFIG_DIR, 'us-treasury-auctions.csv');

let treasuryCache = null;

function loadTreasuryData() {
    if (treasuryCache) return treasuryCache;
    const cache = new Set();
    try {
        if (fs.existsSync(TREASURY_FILE)) {
            const content = fs.readFileSync(TREASURY_FILE);
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true
            });
            // Treasury CSV header: e.g. Security Type, Cusip, etc.
            records.forEach(record => {
                // Use CUSIP as unique identifier if present
                if (record.Cusip) {
                    cache.add(record.Cusip.trim().toUpperCase());
                }
                // Optionally, add other identifiers (e.g. Issue Date, Security Type)
            });
        }
    } catch (e) {
        console.error('Error loading treasury data:', e.message);
    }
    treasuryCache = cache;
    return cache;
}

/**
 * Determines if a ticker (CUSIP) is a US Treasury security.
 * @param {string} ticker - The CUSIP or identifier
 * @returns {boolean} - true if found in treasury listings
 */
function isTreasury(ticker) {
    if (!ticker) return false;
    const normalized = ticker.trim().toUpperCase();
    const data = loadTreasuryData();
    return data.has(normalized);
}

// Utility: return a normalized identifier for a treasury ticker/CUSIP.
// This is provided mainly for tests and external callers that want
// to match the encoding used by scrapers/publishers.
function normalizedIdentifier(ticker) {
    if (!ticker) return '';
    return normalizedKey(ticker);
}

function reloadTreasuryData() {
    treasuryCache = null;
    loadTreasuryData();
}

module.exports = {
    isTreasury,
    reloadTreasuryData,
    loadTreasuryData
    , normalizedIdentifier
};
