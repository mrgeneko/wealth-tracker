/**
 * Statistics API for Advanced Metadata Filtering
 * 
 * Provides detailed metadata statistics with per-security-type filtering
 * - Overall statistics
 * - Per-type breakdown (EQUITY, ETF, etc.)
 * - Filtering by security type
 * - Completion percentage tracking
 */

const express = require('express');
const router = express.Router();

let statisticsPool = null;

/**
 * Initialize the pool for statistics operations
 * @param {Object} pool - MySQL connection pool
 */
function initializePool(pool) {
    statisticsPool = pool;
}

/**
 * GET /
 * Get overall metadata statistics
 * Optional query: ?type=EQUITY,ETF (comma-separated)
 */
router.get('/', async (req, res) => {
    if (!statisticsPool) {
        return res.status(503).json({ error: 'Statistics service unavailable' });
    }

    let connection;
    try {
        connection = await statisticsPool.getConnection();
        
        // Get overall statistics
        const typeFilter = req.query.type ? req.query.type.split(',').map(t => t.trim().toUpperCase()) : null;
        let totalQuery = 'SELECT COUNT(*) as count FROM symbol_registry';
        let withMetadataQuery = 'SELECT COUNT(*) as count FROM symbol_registry WHERE has_yahoo_metadata = 1';
        let params = [];

        if (typeFilter && typeFilter.length > 0) {
            const placeholders = typeFilter.map(() => '?').join(',');
            totalQuery += ` WHERE security_type IN (${placeholders})`;
            withMetadataQuery += ` AND security_type IN (${placeholders})`;
            params = typeFilter;
        }

        const [totalResult] = await connection.execute(totalQuery, typeFilter || []);
        const [withMetadataResult] = await connection.execute(withMetadataQuery, typeFilter || []);
        
        const total = totalResult[0].count;
        const withMetadata = withMetadataResult[0].count;
        const withoutMetadata = total - withMetadata;
        const completion = total > 0 ? Math.round((withMetadata / total) * 100) : 0;

        res.json({
            success: true,
            summary: {
                total_symbols: total,
                with_metadata: withMetadata,
                without_metadata: withoutMetadata,
                completion_percentage: completion
            },
            filter: {
                applied: typeFilter ? true : false,
                types: typeFilter || []
            }
        });

    } catch (error) {
        console.error('[Statistics API] Error fetching statistics:', error);
        res.status(500).json({ error: 'Failed to fetch statistics', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * GET /by-type
 * Get detailed statistics broken down by security type
 */
router.get('/by-type', async (req, res) => {
    if (!statisticsPool) {
        return res.status(503).json({ error: 'Statistics service unavailable' });
    }

    let connection;
    try {
        connection = await statisticsPool.getConnection();
        
        // Get count by security type with metadata status
        const [results] = await connection.execute(`
            SELECT 
                sr.security_type,
                COUNT(*) as total,
                SUM(CASE WHEN sr.has_yahoo_metadata = 1 THEN 1 ELSE 0 END) as with_metadata,
                SUM(CASE WHEN sr.has_yahoo_metadata = 0 THEN 1 ELSE 0 END) as without_metadata
            FROM symbol_registry sr
            WHERE sr.security_type IS NOT NULL
            GROUP BY sr.security_type
            ORDER BY sr.security_type ASC
        `);

        // Calculate completion for each type
        const byType = results.map(row => ({
            security_type: row.security_type || 'UNKNOWN',
            total_symbols: row.total,
            with_metadata: row.with_metadata,
            without_metadata: row.without_metadata,
            completion_percentage: row.total > 0 ? Math.round((row.with_metadata / row.total) * 100) : 0
        }));

        // Calculate overall
        const totalAll = byType.reduce((sum, t) => sum + t.total_symbols, 0);
        const withMetadataAll = byType.reduce((sum, t) => sum + t.with_metadata, 0);
        const completionAll = totalAll > 0 ? Math.round((withMetadataAll / totalAll) * 100) : 0;

        res.json({
            success: true,
            overall: {
                total_symbols: totalAll,
                with_metadata: withMetadataAll,
                without_metadata: totalAll - withMetadataAll,
                completion_percentage: completionAll
            },
            by_type: byType,
            type_count: byType.length
        });

    } catch (error) {
        console.error('[Statistics API] Error fetching type breakdown:', error);
        res.status(500).json({ error: 'Failed to fetch type breakdown', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * GET /type/:type
 * Get statistics for a specific security type
 */
router.get('/type/:type', async (req, res) => {
    if (!statisticsPool) {
        return res.status(503).json({ error: 'Statistics service unavailable' });
    }

    let connection;
    try {
        const securityType = req.params.type.toUpperCase();
        
        connection = await statisticsPool.getConnection();
        
        // Validate security type exists
        const [typeCheck] = await connection.execute(
            'SELECT DISTINCT security_type FROM symbol_registry WHERE security_type = ? LIMIT 1',
            [securityType]
        );

        if (typeCheck.length === 0) {
            return res.status(404).json({ error: `Security type '${securityType}' not found` });
        }

        // Get detailed stats for type
        const [results] = await connection.execute(`
            SELECT 
                security_type,
                COUNT(*) as total,
                SUM(CASE WHEN has_yahoo_metadata = 1 THEN 1 ELSE 0 END) as with_metadata,
                SUM(CASE WHEN has_yahoo_metadata = 0 THEN 1 ELSE 0 END) as without_metadata
            FROM symbol_registry
            WHERE security_type = ?
            GROUP BY security_type
        `, [securityType]);

        if (results.length === 0) {
            return res.status(404).json({ error: 'No data found for type' });
        }

        const row = results[0];
        const stats = {
            security_type: row.security_type,
            total_symbols: row.total,
            with_metadata: row.with_metadata,
            without_metadata: row.without_metadata,
            completion_percentage: row.total > 0 ? Math.round((row.with_metadata / row.total) * 100) : 0
        };

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('[Statistics API] Error fetching type statistics:', error);
        res.status(500).json({ error: 'Failed to fetch type statistics', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * POST /refresh-type
 * Trigger metadata refresh for a specific security type
 * Body: { type: 'EQUITY' }
 */
router.post('/refresh-type', async (req, res) => {
    if (!statisticsPool) {
        return res.status(503).json({ error: 'Statistics service unavailable' });
    }

    const { type } = req.body;
    if (!type) {
        return res.status(400).json({ error: 'Security type required' });
    }

    let connection;
    try {
        const securityType = type.toUpperCase();
        connection = await statisticsPool.getConnection();

        // Reset metadata flag for all symbols of this type
        const [result] = await connection.execute(
            `UPDATE symbol_registry 
             SET has_yahoo_metadata = 0 
             WHERE security_type = ?`,
            [securityType]
        );

        const affectedRows = result.affectedRows;

        res.json({
            success: true,
            message: `Marked ${affectedRows} ${securityType} symbols for metadata refresh`,
            type: securityType,
            affected_count: affectedRows
        });

    } catch (error) {
        console.error('[Statistics API] Error triggering refresh:', error);
        res.status(500).json({ error: 'Failed to trigger refresh', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * POST /reset-type
 * Reset all metadata for a specific security type (archive first)
 * Body: { type: 'EQUITY' }
 */
router.post('/reset-type', async (req, res) => {
    if (!statisticsPool) {
        return res.status(503).json({ error: 'Statistics service unavailable' });
    }

    const { type } = req.body;
    if (!type) {
        return res.status(400).json({ error: 'Security type required' });
    }

    let connection;
    try {
        const securityType = type.toUpperCase();
        connection = await statisticsPool.getConnection();

        // Start transaction
        await connection.beginTransaction();

        // Archive existing metadata
        await connection.execute(`
            INSERT INTO symbol_registry_metadata_archive 
            SELECT * FROM securities_metadata 
            WHERE ticker IN (
                SELECT symbol FROM symbol_registry WHERE security_type = ?
            )
        `, [securityType]);

        // Delete archived metadata
        await connection.execute(`
            DELETE FROM securities_metadata 
            WHERE ticker IN (
                SELECT symbol FROM symbol_registry WHERE security_type = ?
            )
        `, [securityType]);

        // Reset flag
        await connection.execute(
            `UPDATE symbol_registry 
             SET has_yahoo_metadata = 0 
             WHERE security_type = ?`,
            [securityType]
        );

        await connection.commit();

        res.json({
            success: true,
            message: `Reset all metadata for ${securityType} symbols`,
            type: securityType
        });

    } catch (error) {
        console.error('[Statistics API] Error resetting type metadata:', error);
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('[Statistics API] Rollback error:', rollbackError);
            }
        }
        res.status(500).json({ error: 'Failed to reset metadata', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * GET /available-types
 * Get list of all available security types
 */
router.get('/available-types', async (req, res) => {
    if (!statisticsPool) {
        return res.status(503).json({ error: 'Statistics service unavailable' });
    }

    let connection;
    try {
        connection = await statisticsPool.getConnection();
        
        const [results] = await connection.execute(
            'SELECT DISTINCT security_type FROM symbol_registry WHERE security_type IS NOT NULL ORDER BY security_type ASC'
        );

        const types = results.map(r => r.security_type);

        res.json({
            success: true,
            types: types,
            count: types.length
        });

    } catch (error) {
        console.error('[Statistics API] Error fetching available types:', error);
        res.status(500).json({ error: 'Failed to fetch available types', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = {
    router,
    initializePool
};
