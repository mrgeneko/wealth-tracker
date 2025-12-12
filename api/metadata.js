// api/metadata.js
// API endpoints for security metadata operations
// Supports: ticker lookup, autocomplete, metadata prefetch, batch import

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Database connection helper
async function getDbConnection() {
    return await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
}

// Helper to fetch metadata using the populate script
async function fetchMetadataForTicker(ticker) {
    try {
        const path = require('path');
        
        // All files are under /app in Docker (api at /app/api, scripts at /app/scripts)
        // This also works for local dev since paths are relative to this file's parent
        const scriptPath = path.join(__dirname, '..', 'scripts', 'populate', 'populate_securities_metadata.js');
        const cwd = path.join(__dirname, '..');
        
        console.log(`[Metadata] Running script: ${scriptPath} from cwd: ${cwd}`);
        
        const { stdout, stderr } = await execPromise(
            `node "${scriptPath}" --ticker ${ticker}`,
            { cwd }
        );
        console.log(`[Metadata] Fetched metadata for ${ticker}`);
        return { success: true, output: stdout };
    } catch (error) {
        console.error(`Failed to fetch metadata for ${ticker}:`, error.message);
        if (error.stderr) {
            console.error(`[Metadata] stderr:`, error.stderr);
        }
        return { success: false, error: error.message };
    }
}

/**
 * GET /api/metadata/lookup/:ticker
 * Quick lookup - returns metadata if exists, triggers fetch if not
 * Used for: Autocomplete, ticker validation, "Add Position" modal
 */
router.get('/lookup/:ticker', async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    const connection = await getDbConnection();

    try {
        // Check if metadata exists
        const [rows] = await connection.execute(
            `SELECT 
        ticker, quote_type, type_display, short_name, long_name,
            exchange, currency, market_cap, dividend_yield, trailing_pe,
            ttm_dividend_amount, ttm_eps
       FROM securities_metadata 
       WHERE ticker = ?`,
            [ticker]
        );

        if (rows.length > 0) {
            // Metadata exists - return immediately
            res.json({
                exists: true,
                metadata: rows[0]
            });
        } else {
            // Metadata doesn't exist - trigger fetch in background
            res.json({
                exists: false,
                message: 'Fetching metadata...',
                ticker: ticker
            });

            // Fetch asynchronously (don't wait)
            fetchMetadataForTicker(ticker).then(result => {
                if (result.success) {
                    console.log(`✓ Background fetch completed for ${ticker}`);
                }
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await connection.end();
    }
});

/**
 * POST /api/metadata/prefetch
 * Prefetch metadata for a ticker (blocks until complete)
 * Used for: "Add Position" modal when user selects ticker
 */
router.post('/prefetch', async (req, res) => {
    const { ticker } = req.body;

    if (!ticker) {
        return res.status(400).json({ error: 'Ticker is required' });
    }

    const normalizedTicker = ticker.toUpperCase();
    const connection = await getDbConnection();

    try {
        // Check if already exists
        const [existing] = await connection.execute(
            'SELECT ticker FROM securities_metadata WHERE ticker = ?',
            [normalizedTicker]
        );

        if (existing.length > 0) {
            // Already have it
            const [metadata] = await connection.execute(
                `SELECT 
          ticker, quote_type, type_display, short_name, long_name,
              exchange, currency, region, market_cap, dividend_yield,
              ttm_dividend_amount, ttm_eps
         FROM securities_metadata 
         WHERE ticker = ?`,
                [normalizedTicker]
            );

            return res.json({
                cached: true,
                metadata: metadata[0]
            });
        }

        // Fetch it now (user waits ~1-2 seconds)
        console.log(`Prefetching metadata for ${normalizedTicker}...`);
        const result = await fetchMetadataForTicker(normalizedTicker);

        if (!result.success) {
            return res.status(404).json({
                error: 'Ticker not found in Yahoo Finance',
                ticker: normalizedTicker
            });
        }

        // Retrieve the newly inserted metadata
        const [metadata] = await connection.execute(
            `SELECT 
        ticker, quote_type, type_display, short_name, long_name,
        exchange, currency, region, market_cap, dividend_yield,
        ttm_dividend_amount, ttm_eps
       FROM securities_metadata 
       WHERE ticker = ?`,
            [normalizedTicker]
        );

        res.json({
            cached: false,
            metadata: metadata[0] || null
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await connection.end();
    }
});

/**
 * GET /api/metadata/autocomplete?q=AAPL
 * Autocomplete search for tickers
 * Searches ticker_registry (populated from exchange CSV files)
 */
router.get('/autocomplete', async (req, res) => {
    const query = (req.query.q || '').toUpperCase();

    if (query.length < 1) {
        return res.json({ results: [] });
    }

    const connection = await getDbConnection();

    try {
        // Search ticker_registry (populated from NASDAQ/NYSE/OTHER/TREASURY CSV files)
        const [rows] = await connection.execute(
            `SELECT 
                ticker, name, security_type, exchange
            FROM ticker_registry 
            WHERE ticker LIKE ? OR name LIKE ?
            ORDER BY 
                CASE 
                    WHEN ticker = ? THEN 1
                    WHEN ticker LIKE ? THEN 2
                    WHEN name LIKE ? THEN 3
                    ELSE 4
                END,
                ticker
            LIMIT 20`,
            [`${query}%`, `%${query}%`, query, `${query}%`, `%${query}%`]
        );

        const results = rows.map(row => ({
            symbol: row.ticker,
            name: row.name || row.ticker,
            type: row.security_type,
            exchange: row.exchange,
            source: 'registry'
        }));

        res.json({ results });

    } catch (error) {
        console.error('Autocomplete error:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        await connection.end();
    }
});

/**
 * POST /api/metadata/batch-prefetch
 * Prefetch metadata for multiple tickers (for import feature)
 * Returns status for each ticker
 */
router.post('/batch-prefetch', async (req, res) => {
    const { tickers } = req.body;

    if (!Array.isArray(tickers) || tickers.length === 0) {
        return res.status(400).json({ error: 'Tickers array is required' });
    }

    const connection = await getDbConnection();
    const results = [];

    try {
        for (const ticker of tickers) {
            const normalizedTicker = ticker.toUpperCase();

            // Check if exists
            const [existing] = await connection.execute(
                'SELECT ticker FROM securities_metadata WHERE ticker = ?',
                [normalizedTicker]
            );

            if (existing.length > 0) {
                results.push({
                    ticker: normalizedTicker,
                    status: 'cached',
                    message: 'Metadata already exists'
                });
                continue;
            }

            // Fetch it
            console.log(`Fetching metadata for ${normalizedTicker}...`);
            const result = await fetchMetadataForTicker(normalizedTicker);

            if (result.success) {
                results.push({
                    ticker: normalizedTicker,
                    status: 'fetched',
                    message: 'Metadata retrieved successfully'
                });
            } else {
                results.push({
                    ticker: normalizedTicker,
                    status: 'failed',
                    message: 'Ticker not found in Yahoo Finance'
                });
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const summary = {
            total: tickers.length,
            cached: results.filter(r => r.status === 'cached').length,
            fetched: results.filter(r => r.status === 'fetched').length,
            failed: results.filter(r => r.status === 'failed').length
        };

        res.json({ summary, results });

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await connection.end();
    }
});

/**
 * GET /api/metadata/check-missing
 * Check which positions don't have metadata
 * Used for: Dashboard health check, maintenance
 */
router.get('/check-missing', async (req, res) => {
    const connection = await getDbConnection();

    try {
        const [rows] = await connection.execute(`
      SELECT DISTINCT p.ticker
      FROM positions p
      LEFT JOIN securities_metadata sm ON p.ticker = sm.ticker
      WHERE p.ticker IS NOT NULL 
        AND p.ticker != 'CASH'
        AND sm.ticker IS NULL
    `);

        const missingTickers = rows.map(r => r.ticker);

        res.json({
            count: missingSymbols.length,
            symbols: missingSymbols
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await connection.end();
    }
});

module.exports = router;
