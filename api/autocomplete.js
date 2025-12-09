// api/autocomplete.js
// REST API endpoints for metadata autocomplete service
// Provides: symbol search, details lookup, statistics, admin refresh

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { MetadataAutocompleteService } = require('../services/symbol-registry');

// Database connection pool
let connectionPool = null;

/**
 * Initialize connection pool for use by autocomplete service
 * Called at application startup
 */
function initializePool(pool) {
    connectionPool = pool;
}

/**
 * Middleware to ensure pool is initialized
 */
function requirePool(req, res, next) {
    if (!connectionPool) {
        return res.status(503).json({
            error: 'Service unavailable',
            message: 'Database pool not initialized'
        });
    }
    next();
}

/**
 * GET /api/autocomplete/search
 * Search for symbols with optional metadata enrichment
 *
 * Query Parameters:
 *   - q (required): Search query
 *   - limit (optional): Max results, default 20
 *   - metadata (optional): Include metadata, default false
 *
 * Response:
 *   {
 *     query: "string",
 *     results: [
 *       {
 *         symbol: "AAPL",
 *         name: "Apple Inc.",
 *         type: "STOCK",
 *         verified: true,
 *         score: 145.7,
 *         metadata: { ... } // if requested
 *       }
 *     ],
 *     count: number,
 *     timestamp: ISO8601
 *   }
 */
router.get('/search', requirePool, async (req, res) => {
    const { q, limit, metadata } = req.query;

    if (!q || q.trim().length === 0) {
        return res.status(400).json({
            error: 'Invalid request',
            message: 'Query parameter "q" is required and cannot be empty'
        });
    }

    try {
        const service = new MetadataAutocompleteService(connectionPool);

        const options = {
            limit: Math.min(parseInt(limit) || 20, 100), // Cap at 100
            includeMetadata: metadata === 'true' || metadata === '1'
        };

        const results = await service.searchSymbols(q, options);

        res.json({
            query: q.trim(),
            results,
            count: results.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Autocomplete search error:', error);
        res.status(500).json({
            error: 'Search failed',
            message: error.message
        });
    }
});

/**
 * GET /api/autocomplete/details/:symbol
 * Get detailed information for a single symbol
 *
 * Response:
 *   {
 *     symbol: "AAPL",
 *     name: "Apple Inc.",
 *     type: "STOCK",
 *     exchange: "NASDAQ",
 *     sector: "Technology",
 *     industry: "Consumer Electronics",
 *     verified: true,
 *     metadata_fetched: true,
 *     metadata_updated_at: "2024-12-09T12:00:00Z",
 *     metadata: {
 *       market_cap: "3200000000000",
 *       trailing_pe: 28.5,
 *       dividend_yield: 0.42,
 *       ...
 *     }
 *   }
 */
router.get('/details/:symbol', requirePool, async (req, res) => {
    const symbol = (req.params.symbol || '').toUpperCase().trim();

    if (!symbol) {
        return res.status(400).json({
            error: 'Invalid request',
            message: 'Symbol parameter is required'
        });
    }

    try {
        const service = new MetadataAutocompleteService(connectionPool);
        const details = await service.getSymbolDetails(symbol);

        if (!details) {
            return res.status(404).json({
                error: 'Not found',
                message: `Symbol "${symbol}" not found in registry`,
                symbol
            });
        }

        res.json({
            ...details,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Symbol details error:', error);
        res.status(500).json({
            error: 'Lookup failed',
            message: error.message
        });
    }
});

/**
 * GET /api/autocomplete/stats
 * Get metadata population statistics
 *
 * Response:
 *   {
 *     summary: {
 *       total_symbols: 5000,
 *       with_metadata: 3500,
 *       without_metadata: 1500,
 *       completion_percentage: 70.0
 *     },
 *     by_type: [
 *       {
 *         type: "STOCK",
 *         total: 3000,
 *         with_metadata: 2100,
 *         without_metadata: 900,
 *         percentage: 70.0
 *       },
 *       ...
 *     ],
 *     timestamp: ISO8601
 *   }
 */
router.get('/stats', requirePool, async (req, res) => {
    try {
        const service = new MetadataAutocompleteService(connectionPool);
        const stats = await service.getStatistics();

        res.json({
            ...stats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Statistics error:', error);
        res.status(500).json({
            error: 'Statistics retrieval failed',
            message: error.message
        });
    }
});

/**
 * GET /api/autocomplete/pending
 * Get list of symbols needing metadata (for background population)
 *
 * Query Parameters:
 *   - limit (optional): Max results, default 100
 *
 * Response:
 *   {
 *     pending: ["SYMBOL1", "SYMBOL2", ...],
 *     count: number,
 *     timestamp: ISO8601
 *   }
 */
router.get('/pending', requirePool, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const service = new MetadataAutocompleteService(connectionPool);
        const pending = await service.getSymbolsNeedingMetadata(limit);

        res.json({
            pending,
            count: pending.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Pending symbols error:', error);
        res.status(500).json({
            error: 'Failed to retrieve pending symbols',
            message: error.message
        });
    }
});

/**
 * POST /api/autocomplete/refresh/:symbol
 * Admin: Refresh metadata for a specific symbol
 *
 * Authorization: Optional (can be secured with middleware)
 *
 * Response:
 *   {
 *     symbol: "AAPL",
 *     action: "refresh_initiated",
 *     message: "Metadata refresh flag reset. Symbol will be repopulated on next cycle.",
 *     timestamp: ISO8601
 *   }
 */
router.post('/refresh/:symbol', requirePool, async (req, res) => {
    const symbol = (req.params.symbol || '').toUpperCase().trim();

    if (!symbol) {
        return res.status(400).json({
            error: 'Invalid request',
            message: 'Symbol parameter is required'
        });
    }

    try {
        const service = new MetadataAutocompleteService(connectionPool);
        await service.refreshSymbolMetadata(symbol);

        res.json({
            symbol,
            action: 'refresh_initiated',
            message: 'Metadata refresh flag reset. Symbol will be repopulated on next cycle.',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Refresh metadata error:', error);
        res.status(500).json({
            error: 'Refresh failed',
            message: error.message
        });
    }
});

/**
 * POST /api/autocomplete/bulk-refresh
 * Admin: Mark multiple symbols for refresh
 *
 * Body:
 *   {
 *     symbols: ["AAPL", "GOOGL", "MSFT"],
 *     type: "STOCK" // optional: filter by type
 *   }
 *
 * Response:
 *   {
 *     action: "bulk_refresh_initiated",
 *     symbols_refreshed: 3,
 *     symbols: ["AAPL", "GOOGL", "MSFT"],
 *     timestamp: ISO8601
 *   }
 */
router.post('/bulk-refresh', requirePool, async (req, res) => {
    const { symbols } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({
            error: 'Invalid request',
            message: 'Symbols must be a non-empty array'
        });
    }

    try {
        const service = new MetadataAutocompleteService(connectionPool);
        const normalizedSymbols = symbols.map(s => (s || '').toUpperCase().trim()).filter(s => s);

        let refreshedCount = 0;
        for (const symbol of normalizedSymbols) {
            try {
                await service.refreshSymbolMetadata(symbol);
                refreshedCount++;
            } catch (err) {
                console.error(`Failed to refresh ${symbol}:`, err.message);
            }
        }

        res.json({
            action: 'bulk_refresh_initiated',
            symbols_refreshed: refreshedCount,
            total_requested: symbols.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Bulk refresh error:', error);
        res.status(500).json({
            error: 'Bulk refresh failed',
            message: error.message
        });
    }
});

/**
 * GET /api/autocomplete/health
 * Health check endpoint for monitoring
 *
 * Response:
 *   {
 *     status: "healthy",
 *     service: "autocomplete",
 *     pool_available: true,
 *     timestamp: ISO8601
 *   }
 */
router.get('/health', requirePool, (req, res) => {
    res.json({
        status: 'healthy',
        service: 'autocomplete',
        pool_available: !!connectionPool,
        timestamp: new Date().toISOString()
    });
});

module.exports = {
    router,
    initializePool
};
