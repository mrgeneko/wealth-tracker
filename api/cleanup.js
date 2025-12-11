/**
 * Cleanup API Endpoints
 * 
 * Handles cleanup operations:
 * - Remove expired/unused symbols
 * - Archive old metadata
 * - Reset metadata for re-fetch
 * - Database maintenance
 */

const express = require('express');
const router = express.Router();

let pool = null;

/**
 * Initialize pool for cleanup operations
 * Must be called before any requests
 */
function initializePool(connectionPool) {
    pool = connectionPool;
}

/**
 * POST /cleanup
 * Remove symbols with no metadata and no associated holdings
 * 
 * Query Parameters:
 * - security_type: Filter by type (STOCK, ETF, BOND, etc.)
 * - days_since_update: Remove symbols not updated in X days
 * 
 * Returns:
 * - count: Number of symbols deleted
 * - details: Breakdown by type
 */
router.post('/cleanup', async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).json({
                error: 'Service unavailable',
                message: 'Pool not initialized'
            });
        }

        const securityType = req.query.security_type ? req.query.security_type.toUpperCase() : null;
        const daysSinceUpdate = parseInt(req.query.days_since_update) || 30;

        let connection;
        try {
            connection = await pool.getConnection();

            // Get tickers that are safe to delete (no holdings)
            let whereClause = `
                WHERE sr.has_yahoo_metadata = 0
                AND sr.updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
                AND sr.ticker NOT IN (
                    SELECT DISTINCT ticker FROM positions WHERE quantity > 0
                )
            `;
            const params = [daysSinceUpdate];

            if (securityType) {
                whereClause += ` AND sr.security_type = ?`;
                params.push(securityType);
            }

            // Get count of symbols to delete
            const [countResults] = await connection.execute(`
                SELECT COUNT(*) as count, sr.security_type, COUNT(*) as type_count
                FROM ticker_registry sr
                ${whereClause}
                GROUP BY sr.security_type
            `, params);

            const totalCount = countResults.reduce((sum, row) => sum + row.count, 0);

            // Delete symbols if any found
            let deletedCount = 0;
            if (totalCount > 0) {
                const [deleteResult] = await connection.execute(`
                    DELETE FROM ticker_registry
                    ${whereClause}
                `, params);

                deletedCount = deleteResult.affectedRows;
            }

            res.status(200).json({
                action: 'cleanup_completed',
                symbols_deleted: deletedCount,
                total_requested: totalCount,
                by_type: countResults.map(row => ({
                    type: row.security_type,
                    count: row.type_count
                })),
                timestamp: new Date().toISOString()
            });

        } finally {
            if (connection) {
                await connection.release();
            }
        }

    } catch (error) {
        console.error('[cleanup POST /cleanup]', error.message);
        res.status(500).json({
            error: 'Cleanup failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /reset-metadata
 * Reset metadata_fetched flag for symbols to trigger re-fetch
 * 
 * Query Parameters:
 * - security_type: Reset only specific type (STOCK, ETF, BOND, etc.)
 * 
 * Returns:
 * - count: Number of symbols reset
 */
router.post('/reset-metadata', async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).json({
                error: 'Service unavailable',
                message: 'Pool not initialized'
            });
        }

        const securityType = req.query.security_type ? req.query.security_type.toUpperCase() : null;

        let connection;
        try {
            connection = await pool.getConnection();

            let query = `
                UPDATE ticker_registry
                SET has_yahoo_metadata = 0, updated_at = NOW()
            `;
            const params = [];

            if (securityType) {
                query += ` WHERE security_type = ?`;
                params.push(securityType);
            }

            const [result] = await connection.execute(query, params);

            res.status(200).json({
                action: 'metadata_reset',
                symbols_reset: result.affectedRows,
                security_type: securityType,
                timestamp: new Date().toISOString()
            });

        } finally {
            if (connection) {
                await connection.release();
            }
        }

    } catch (error) {
        console.error('[cleanup POST /reset-metadata]', error.message);
        res.status(500).json({
            error: 'Reset failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /archive-old-metadata
 * Archive metadata older than X days to separate table for storage efficiency
 * 
 * Query Parameters:
 * - days: Archive metadata older than X days (default: 90)
 * 
 * Returns:
 * - count: Number of metadata records archived
 */
router.post('/archive-old-metadata', async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).json({
                error: 'Service unavailable',
                message: 'Pool not initialized'
            });
        }

        const days = parseInt(req.query.days) || 90;

        let connection;
        try {
            connection = await pool.getConnection();

            // Create archive table if not exists
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS ticker_registry_metadata_archive (
                    symbol VARCHAR(50),
                    quote_type VARCHAR(50),
                    market_cap VARCHAR(50),
                    trailing_pe DECIMAL(10, 2),
                    dividend_yield DECIMAL(10, 4),
                    ttm_dividend_amount DECIMAL(10, 4),
                    ttm_eps DECIMAL(10, 4),
                    currency VARCHAR(10),
                    sector VARCHAR(255),
                    industry VARCHAR(255),
                    exchange VARCHAR(50),
                    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    original_update_time DATETIME,
                    PRIMARY KEY (symbol, original_update_time)
                )
            `);

            // Move old metadata to archive
            const [moveResult] = await connection.execute(`
                INSERT INTO ticker_registry_metadata_archive 
                SELECT *, NOW() as archived_at, updated_at as original_update_time
                FROM securities_metadata
                WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
            `, [days]);

            // Delete archived metadata
            const [deleteResult] = await connection.execute(`
                DELETE FROM securities_metadata
                WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
            `, [days]);

            res.status(200).json({
                action: 'metadata_archived',
                archived_count: moveResult.affectedRows,
                deleted_count: deleteResult.affectedRows,
                older_than_days: days,
                timestamp: new Date().toISOString()
            });

        } finally {
            if (connection) {
                await connection.release();
            }
        }

    } catch (error) {
        console.error('[cleanup POST /archive-old-metadata]', error.message);
        res.status(500).json({
            error: 'Archive failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /status
 * Get cleanup operation status
 * Shows:
 * - Total symbols in registry
 * - Symbols with metadata
 * - Symbols safe to delete
 * - Last cleanup operation
 */
router.get('/status', async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).json({
                error: 'Service unavailable',
                message: 'Pool not initialized'
            });
        }

        let connection;
        try {
            connection = await pool.getConnection();

            // Get overall stats
            const [stats] = await connection.execute(`
                SELECT 
                    COUNT(*) as total_symbols,
                    SUM(CASE WHEN has_yahoo_metadata = 1 THEN 1 ELSE 0 END) as with_metadata,
                    SUM(CASE WHEN has_yahoo_metadata = 0 THEN 1 ELSE 0 END) as without_metadata
                FROM ticker_registry
            `);

            // Get tickers safe to delete (no holdings, no metadata)
            const [deletable] = await connection.execute(`
                SELECT COUNT(*) as safe_to_delete
                FROM ticker_registry sr
                WHERE sr.has_yahoo_metadata = 0
                AND sr.ticker NOT IN (
                    SELECT DISTINCT ticker FROM positions WHERE quantity > 0
                )
            `);

            // Get by type
            const [byType] = await connection.execute(`
                SELECT 
                    security_type,
                    COUNT(*) as total,
                    SUM(CASE WHEN has_yahoo_metadata = 1 THEN 1 ELSE 0 END) as with_metadata
                FROM ticker_registry
                GROUP BY security_type
                ORDER BY total DESC
            `);

            const stat = stats[0] || { total_symbols: 0, with_metadata: 0, without_metadata: 0 };
            const deletableSafe = deletable[0]?.safe_to_delete || 0;

            res.status(200).json({
                status: 'healthy',
                summary: {
                    total_symbols: stat.total_symbols,
                    with_metadata: stat.with_metadata,
                    without_metadata: stat.without_metadata,
                    safe_to_delete: deletableSafe
                },
                by_type: byType,
                timestamp: new Date().toISOString()
            });

        } finally {
            if (connection) {
                await connection.release();
            }
        }

    } catch (error) {
        console.error('[cleanup GET /status]', error.message);
        res.status(500).json({
            error: 'Status check failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = { router, initializePool };
