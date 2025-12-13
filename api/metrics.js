// api/metrics.js
// Performance Metrics API for tracking refresh operations, success rates, and system health
// Phase 8.4 Implementation

const express = require('express');
const router = express.Router();

// Database connection pool (initialized from server.js)
let connectionPool = null;

/**
 * Initialize connection pool for metrics operations
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
 * GET /api/metrics/summary
 * Get overall performance metrics summary
 */
router.get('/summary', requirePool, async (req, res) => {
    let connection;
    try {
        connection = await connectionPool.getConnection();

        // Get latest metrics by source
        const [latestMetrics] = await connection.execute(`
            SELECT 
                source,
                metric_date,
                total_tickers,
                tickers_with_yahoo_metadata,
                tickers_without_yahoo_metadata,
                last_file_refresh_at,
                file_download_duration_ms,
                avg_yahoo_fetch_duration_ms,
                errors_count
            FROM ticker_registry_metrics
            WHERE (source, metric_date) IN (
                SELECT source, MAX(metric_date) FROM ticker_registry_metrics GROUP BY source
            )
            ORDER BY source
        `);

        // Get file refresh status
        const [fileStatus] = await connection.execute(`
            SELECT 
                file_type,
                last_refresh_at,
                last_refresh_duration_ms,
                last_refresh_status,
                last_error_message,
                tickers_added,
                tickers_updated,
                next_refresh_due_at
            FROM file_refresh_status
            ORDER BY file_type
        `);

        // Calculate overall statistics
        const [overallStats] = await connection.execute(`
            SELECT 
                COUNT(*) as total_symbols,
                SUM(CASE WHEN has_yahoo_metadata = 1 THEN 1 ELSE 0 END) as with_metadata,
                COUNT(DISTINCT security_type) as type_count
            FROM ticker_registry
        `);

        // Get recent error count (last 24 hours)
        const [recentErrors] = await connection.execute(`
            SELECT COALESCE(SUM(errors_count), 0) as error_count
            FROM ticker_registry_metrics
            WHERE metric_date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        `);

        res.json({
            success: true,
            summary: {
                totalSymbols: overallStats[0]?.total_symbols || 0,
                withMetadata: overallStats[0]?.with_metadata || 0,
                completionPercentage: overallStats[0]?.total_symbols > 0 
                    ? Math.round((overallStats[0].with_metadata / overallStats[0].total_symbols) * 100) 
                    : 0,
                typeCount: overallStats[0]?.type_count || 0,
                recentErrors: recentErrors[0]?.error_count || 0
            },
            latestMetrics,
            fileRefreshStatus: fileStatus,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching metrics summary:', error.message);
        res.status(500).json({
            error: 'Failed to fetch metrics',
            message: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * GET /api/metrics/history
 * Get historical metrics for charting
 * Query params: days (default 7), source (optional)
 */
router.get('/history', requirePool, async (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const source = req.query.source;

    let connection;
    try {
        connection = await connectionPool.getConnection();

        let query = `
            SELECT 
                metric_date,
                source,
                total_tickers,
                tickers_with_yahoo_metadata,
                tickers_without_yahoo_metadata,
                file_download_duration_ms,
                avg_yahoo_fetch_duration_ms,
                errors_count
            FROM ticker_registry_metrics
            WHERE metric_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        `;
        const params = [days];

        if (source) {
            query += ' AND source = ?';
            params.push(source);
        }

        query += ' ORDER BY metric_date DESC, source';

        const [history] = await connection.execute(query, params);

        // Group by date for easier charting
        const byDate = {};
        history.forEach(row => {
            const dateKey = row.metric_date.toISOString().split('T')[0];
            if (!byDate[dateKey]) {
                byDate[dateKey] = { date: dateKey, sources: {} };
            }
            byDate[dateKey].sources[row.source] = {
                totalTickers: row.total_tickers,
                withMetadata: row.tickers_with_yahoo_metadata,
                downloadDuration: row.file_download_duration_ms,
                fetchDuration: row.avg_yahoo_fetch_duration_ms,
                errors: row.errors_count
            };
        });

        res.json({
            success: true,
            days,
            source: source || 'all',
            history: Object.values(byDate),
            rawData: history,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching metrics history:', error.message);
        res.status(500).json({
            error: 'Failed to fetch metrics history',
            message: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * GET /api/metrics/refresh-status
 * Get current refresh status for all file types
 */
router.get('/refresh-status', requirePool, async (req, res) => {
    let connection;
    try {
        connection = await connectionPool.getConnection();

        const [status] = await connection.execute(`
            SELECT 
                file_type,
                last_refresh_at,
                last_refresh_duration_ms,
                last_refresh_status,
                last_error_message,
                tickers_added,
                tickers_updated,
                next_refresh_due_at,
                updated_at
            FROM file_refresh_status
            ORDER BY file_type
        `);

        // Calculate health status
        const healthStatus = status.map(s => ({
            ...s,
            isHealthy: s.last_refresh_status === 'SUCCESS',
            isOverdue: s.next_refresh_due_at && new Date(s.next_refresh_due_at) < new Date(),
            timeSinceRefresh: s.last_refresh_at 
                ? Math.round((Date.now() - new Date(s.last_refresh_at).getTime()) / 1000 / 60)
                : null
        }));

        res.json({
            success: true,
            status: healthStatus,
            overallHealth: healthStatus.every(s => s.isHealthy) ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching refresh status:', error.message);
        res.status(500).json({
            error: 'Failed to fetch refresh status',
            message: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * POST /api/metrics/record
 * Record a new metrics entry (called by refresh services)
 */
router.post('/record', requirePool, async (req, res) => {
    const {
        source,
        totalSymbols,
        symbolsWithMetadata,
        symbolsWithoutMetadata,
        downloadDurationMs,
        avgFetchDurationMs,
        errorsCount
    } = req.body;

    if (!source) {
        return res.status(400).json({
            error: 'Invalid request',
            message: 'Source is required'
        });
    }

    let connection;
    try {
        connection = await connectionPool.getConnection();

        await connection.execute(`
            INSERT INTO ticker_registry_metrics (
                metric_date,
                source,
                total_tickers,
                tickers_with_yahoo_metadata,
                tickers_without_yahoo_metadata,
                last_file_refresh_at,
                file_download_duration_ms,
                avg_yahoo_fetch_duration_ms,
                errors_count
            ) VALUES (
                CURDATE(), ?, ?, ?, ?, NOW(), ?, ?, ?
            )
            ON DUPLICATE KEY UPDATE
                total_tickers = VALUES(total_tickers),
                tickers_with_yahoo_metadata = VALUES(tickers_with_yahoo_metadata),
                tickers_without_yahoo_metadata = VALUES(tickers_without_yahoo_metadata),
                last_file_refresh_at = VALUES(last_file_refresh_at),
                file_download_duration_ms = VALUES(file_download_duration_ms),
                avg_yahoo_fetch_duration_ms = VALUES(avg_yahoo_fetch_duration_ms),
                errors_count = errors_count + VALUES(errors_count)
        `, [
            source,
            totalSymbols || 0,
            symbolsWithMetadata || 0,
            symbolsWithoutMetadata || 0,
            downloadDurationMs || null,
            avgFetchDurationMs || null,
            errorsCount || 0
        ]);

        res.json({
            success: true,
            message: 'Metrics recorded',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error recording metrics:', error.message);
        res.status(500).json({
            error: 'Failed to record metrics',
            message: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * POST /api/metrics/update-file-status
 * Update file refresh status (called by sync services)
 */
router.post('/update-file-status', requirePool, async (req, res) => {
    const {
        fileType,
        status,
        durationMs,
        symbolsAdded,
        symbolsUpdated,
        errorMessage,
        nextRefreshAt
    } = req.body;

    if (!fileType || !status) {
        return res.status(400).json({
            error: 'Invalid request',
            message: 'fileType and status are required'
        });
    }

    const validFileTypes = ['NASDAQ', 'NYSE', 'OTHER', 'TREASURY'];
    const validStatuses = ['SUCCESS', 'FAILED', 'IN_PROGRESS'];

    if (!validFileTypes.includes(fileType)) {
        return res.status(400).json({
            error: 'Invalid file type',
            message: `File type must be one of: ${validFileTypes.join(', ')}`
        });
    }

    if (!validStatuses.includes(status)) {
        return res.status(400).json({
            error: 'Invalid status',
            message: `Status must be one of: ${validStatuses.join(', ')}`
        });
    }

    let connection;
    try {
        connection = await connectionPool.getConnection();

        await connection.execute(`
            INSERT INTO file_refresh_status (
                file_type,
                last_refresh_at,
                last_refresh_duration_ms,
                last_refresh_status,
                last_error_message,
                tickers_added,
                tickers_updated,
                next_refresh_due_at
            ) VALUES (?, NOW(), ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                last_refresh_at = NOW(),
                last_refresh_duration_ms = VALUES(last_refresh_duration_ms),
                last_refresh_status = VALUES(last_refresh_status),
                last_error_message = VALUES(last_error_message),
                tickers_added = VALUES(tickers_added),
                tickers_updated = VALUES(tickers_updated),
                next_refresh_due_at = VALUES(next_refresh_due_at)
        `, [
            fileType,
            durationMs || null,
            status,
            errorMessage || null,
            symbolsAdded || 0,
            symbolsUpdated || 0,
            nextRefreshAt || null
        ]);

        res.json({
            success: true,
            message: `File status updated for ${fileType}`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error updating file status:', error.message);
        res.status(500).json({
            error: 'Failed to update file status',
            message: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * GET /api/metrics/success-rate
 * Calculate success rate over a period
 */
router.get('/success-rate', requirePool, async (req, res) => {
    const days = parseInt(req.query.days) || 7;

    let connection;
    try {
        connection = await connectionPool.getConnection();

        // Calculate success rate from file refresh status history
        const [results] = await connection.execute(`
            SELECT 
                file_type,
                last_refresh_status,
                COUNT(*) as count
            FROM file_refresh_status
            GROUP BY file_type, last_refresh_status
        `);

        // Get error trends
        const [errorTrends] = await connection.execute(`
            SELECT 
                metric_date,
                SUM(errors_count) as total_errors
            FROM ticker_registry_metrics
            WHERE metric_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY metric_date
            ORDER BY metric_date
        `, [days]);

        // Calculate overall success rate
        const successCount = results.filter(r => r.last_refresh_status === 'SUCCESS').length;
        const totalCount = results.length || 1;
        const successRate = Math.round((successCount / totalCount) * 100);

        res.json({
            success: true,
            successRate,
            byFileType: results,
            errorTrends,
            period: `${days} days`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error calculating success rate:', error.message);
        res.status(500).json({
            error: 'Failed to calculate success rate',
            message: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = {
    router,
    initializePool
};
