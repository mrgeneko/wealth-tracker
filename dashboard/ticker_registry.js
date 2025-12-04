/**
 * Ticker Registry - Loads all available tickers from exchange and treasury CSV files
 * Used for autocomplete in the dashboard
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const NASDAQ_FILE = path.join(CONFIG_DIR, 'nasdaq-listed.csv');
const NYSE_FILE = path.join(CONFIG_DIR, 'nyse-listed.csv');
const TREASURY_FILE = path.join(CONFIG_DIR, 'us-treasury-auctions.csv');

let tickerCache = null;

// Strip BOM (Byte Order Mark) from file content
function stripBOM(content) {
    if (content.charCodeAt(0) === 0xFEFF) {
        return content.slice(1);
    }
    return content;
}

function loadAllTickers() {
    if (tickerCache) return tickerCache;

    const tickers = [];

    try {
        // Load NASDAQ symbols
        if (fs.existsSync(NASDAQ_FILE)) {
            const content = stripBOM(fs.readFileSync(NASDAQ_FILE, 'utf-8'));
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true
            });
            records.forEach(record => {
                if (record.Symbol) {
                    tickers.push({
                        symbol: record.Symbol.trim().toUpperCase(),
                        name: record['Security Name'] || '',
                        exchange: 'NASDAQ'
                    });
                }
            });
        }

        // Load NYSE symbols
        if (fs.existsSync(NYSE_FILE)) {
            const content = stripBOM(fs.readFileSync(NYSE_FILE, 'utf-8'));
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true
            });
            records.forEach(record => {
                if (record['ACT Symbol']) {
                    tickers.push({
                        symbol: record['ACT Symbol'].trim().toUpperCase(),
                        name: record['Company Name'] || '',
                        exchange: 'NYSE'
                    });
                }
            });
        }

        // Load Treasury CUSIPs
        if (fs.existsSync(TREASURY_FILE)) {
            const content = stripBOM(fs.readFileSync(TREASURY_FILE, 'utf-8'));
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true
            });
            records.forEach(record => {
                // Header is 'CUSIP' (uppercase)
                const cusip = record.CUSIP || record.Cusip;
                if (cusip) {
                    const securityType = record['Security Type'] || '';
                    const securityTerm = record['Security Term'] || '';
                    const issueDate = record['Issue Date'] || '';
                    const maturityDate = record['Maturity Date'] || '';
                    // Build description: "Bill 4-Week | Issue: 2025-12-09 | Maturity: 2026-01-06"
                    const parts = [];
                    if (securityType) parts.push(securityType);
                    if (securityTerm) parts.push(securityTerm);
                    const dateParts = [];
                    if (issueDate) dateParts.push(`Issue: ${issueDate}`);
                    if (maturityDate) dateParts.push(`Maturity: ${maturityDate}`);
                    const name = parts.join(' ') + (dateParts.length ? ' | ' + dateParts.join(' | ') : '');
                    tickers.push({
                        symbol: cusip.trim().toUpperCase(),
                        name: name.trim(),
                        exchange: 'TREASURY'
                    });
                }
            });
        }
    } catch (e) {
        console.error('Error loading tickers:', e.message);
    }

    tickerCache = tickers;
    return tickers;
}

function reloadTickers() {
    tickerCache = null;
    return loadAllTickers();
}

module.exports = {
    loadAllTickers,
    reloadTickers
};
