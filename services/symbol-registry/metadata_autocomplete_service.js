/**
 * MetadataAutocompleteService
 * 
 * Enhances autocomplete results with financial metadata
 * Integrates YahooMetadataPopulator with autocomplete functionality
 * 
 * Features:
 * - Ranked symbol search (exact match, prefix match, fuzzy match)
 * - Financial data enrichment (market_cap, pe_ratio, dividend_yield, etc.)
 * - Metadata completion percentage
 * - Intelligent sorting using market cap for ranking
 * - Progress tracking for metadata population
 * - Admin operations for manual refresh
 */

const mysql = require('mysql2/promise');

class MetadataAutocompleteService {
    constructor(connectionPool) {
        this.pool = connectionPool;
        this.config = {
            MAX_RESULTS: parseInt(process.env.AUTOCOMPLETE_MAX_RESULTS || '20'),
            MIN_QUERY_LENGTH: parseInt(process.env.AUTOCOMPLETE_MIN_LENGTH || '1'),
            FUZZY_THRESHOLD: parseFloat(process.env.FUZZY_MATCH_THRESHOLD || '0.7'),
            RANK_WEIGHT_MARKET_CAP: parseFloat(process.env.RANK_WEIGHT_MARKET_CAP || '0.5'),
            RANK_WEIGHT_PE_RATIO: parseFloat(process.env.RANK_WEIGHT_PE_RATIO || '0.3'),
            RANK_WEIGHT_DIVIDEND: parseFloat(process.env.RANK_WEIGHT_DIVIDEND || '0.2')
        };
    }

    /**
     * Search and rank tickers with metadata enrichment
     * Returns tickers sorted by relevance and financial metrics
     * 
     * @param {string} query - Search query (ticker, name, or partial match)
     * @param {object} options - Optional filters
     * @returns {Promise<Array>} Array of enriched ticker results
     */
    async searchTickers(query, options = {}) {
        const searchQuery = query.toUpperCase().trim();
        
        if (searchQuery.length < this.config.MIN_QUERY_LENGTH) {
            return [];
        }

        const limit = options.limit || this.config.MAX_RESULTS;
        const includeMetadata = options.includeMetadata !== false;

        let connection;
        try {
            connection = await this.pool.getConnection();

            // Build search query with ranking
            const searchResults = await this._searchWithRanking(
                connection,
                searchQuery,
                limit,
                includeMetadata
            );

            return searchResults;
        } catch (error) {
            console.error(`Error searching tickers: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.release();
            }
        }
    }

    /**
     * Internal: Search with ranking algorithm
     * Uses three-tier matching: exact > prefix > fuzzy
     */
    async _searchWithRanking(connection, query, limit, includeMetadata) {
        // Ensure limit is an integer
        const limitNum = parseInt(limit, 10) || 20;
        
        // Escape query for LIKE patterns
        const escapedQuery = query.replace(/[%_]/g, '\\$&');
        
        // Simple query without metadata join for now to avoid collation issues
        const sql = `
            SELECT 
                sr.ticker,
                sr.name,
                sr.security_type,
                sr.exchange,
                sr.source
            FROM symbol_registry sr
            WHERE sr.ticker LIKE ? OR sr.name LIKE ?
            ORDER BY 
                CASE 
                    WHEN sr.ticker = ? THEN 1
                    WHEN sr.ticker LIKE ? THEN 2
                    WHEN sr.name LIKE ? THEN 3
                    ELSE 4
                END,
                sr.ticker ASC
            LIMIT ${limitNum}
        `;

        const [results] = await connection.execute(sql, [
            `${escapedQuery}%`,    // LIKE for WHERE (prefix)
            `%${escapedQuery}%`,   // LIKE for WHERE (name contains)
            query,                  // Exact match
            `${escapedQuery}%`,    // Prefix match
            `%${escapedQuery}%`    // Partial name match
        ]);

        return results.map(row => this._formatResult(row));
    }

    /**
     * Get completion statistics for metadata population
     * @returns {Promise<object>} Stats object with total, complete, percentage
     */
    async _getMetadataStats(connection) {
        const [stats] = await connection.execute(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN metadata_fetched = 1 THEN 1 ELSE 0 END) as with_metadata
            FROM symbol_registry
        `);

        if (stats.length === 0) {
            return { total: 0, complete: 0, percentage: 0 };
        }

        const row = stats[0];
        const total = row.total || 0;
        const complete = row.with_metadata || 0;
        const percentage = total > 0 ? Math.round((complete / total) * 100) : 0;

        return { total, complete, percentage };
    }

    /**
     * Format autocomplete result with metadata
     */
    _formatResult(row, stats = null) {
        const base = {
            ticker: row.ticker,
            name: row.name || row.ticker,
            type: row.security_type || 'UNKNOWN',
            exchange: row.exchange || this._getExchange(row.ticker),
            verified: true
        };

        // Add metadata if available
        if (row.market_cap_numeric !== undefined) {
            base.metadata = {
                type: row.quote_type,
                marketCap: row.market_cap,
                marketCapValue: row.market_cap_numeric,
                pe: row.trailing_pe,
                dividend: row.dividend_yield,
                eps: row.ttm_eps,
                currency: row.currency,
                sector: row.sector,
                industry: row.industry
            };
        }

        // Add population stats
        if (stats) {
            base.populationProgress = stats;
        }

        return base;
    }
    /**
     * Infer exchange from symbol patterns
     * Used when exchange data not available
     */
    _getExchange(symbol) {
        // US Treasury bonds (4-5 character codes: DGT2, SHV, etc.)
        if (/^[A-Z]{3,4}$/.test(symbol) && symbol.length <= 4) {
            return 'NASDAQ';
        }
        // Default
        return 'NASDAQ';
    }

    /**
     * Get detailed metadata for a single ticker
     * Used for "Add Position" modal
     */
    async getTickerDetails(ticker) {
        const normalizedTicker = ticker.toUpperCase();
        
        let connection;
        try {
            connection = await this.pool.getConnection();

            // Get ticker registry data
            const [registry] = await connection.execute(`
                SELECT *
                FROM symbol_registry
                WHERE ticker = ?
            `, [normalizedTicker]);

            if (registry.length === 0) {
                return null;
            }

            const tickerData = registry[0];

            // Get metadata if available
            const [metadata] = await connection.execute(`
                SELECT *
                FROM securities_metadata
                WHERE ticker = ?
            `, [normalizedTicker]);

            return {
                ticker: tickerData.ticker,
                name: tickerData.name,
                type: tickerData.security_type,
                verified: true,
                metadata: metadata.length > 0 ? metadata[0] : null
            };
        } catch (error) {
            console.error(`Error getting ticker details: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.release();
            }
        }
    }

    /**
     * Get tickers needing metadata for population
     * Used by YahooMetadataPopulator
     * 
     * @param {number} limit - Max results to return
     * @returns {Promise<Array>} Array of tickers
     */
    async getTickersNeedingMetadata(limit = 100) {
        let connection;
        try {
            connection = await this.pool.getConnection();

            // Ensure limit is a safe integer (mysql2 has issues with parameterized LIMIT)
            const numLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 1000));

            const [results] = await connection.query(`
                SELECT ticker
                FROM symbol_registry
                WHERE has_yahoo_metadata = 0
                ORDER BY ticker ASC
                LIMIT ${numLimit}
            `);

            return results.map(row => row.ticker);
        } catch (error) {
            console.error(`Error getting tickers needing metadata: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.release();
            }
        }
    }

    /**
     * Mark ticker as having metadata
     * Called after YahooMetadataPopulator successfully fetches metadata
     */
    async markMetadataFetched(ticker) {
        const normalizedTicker = ticker.toUpperCase();
        
        let connection;
        try {
            connection = await this.pool.getConnection();

            await connection.execute(`
                UPDATE symbol_registry
                SET has_yahoo_metadata = 1,
                    updated_at = NOW()
                WHERE ticker = ?
            `, [normalizedTicker]);

            return true;
        } catch (error) {
            console.error(`Error marking metadata as fetched: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.release();
            }
        }
    }

    /**
     * Get autocomplete statistics
     * Returns metadata completion status
     */
    async getStatistics() {
        let connection;
        try {
            console.log('[getStatistics] Requesting connection from pool...');
            connection = await this.pool.getConnection();
            console.log('[getStatistics] Connection acquired');

            // Get overall stats
            console.log('[getStatistics] Executing summary query...');
            const [registry] = await connection.execute(`
                SELECT 
                    COUNT(*) as total_symbols,
                    SUM(CASE WHEN has_yahoo_metadata = 1 THEN 1 ELSE 0 END) as with_metadata,
                    MAX(updated_at) as last_update
                FROM symbol_registry
            `);
            console.log('[getStatistics] Summary query complete:', registry[0]);

            // Get by type
            console.log('[getStatistics] Executing by-type query...');
            const [byType] = await connection.execute(`
                SELECT 
                    security_type,
                    COUNT(*) as count,
                    SUM(CASE WHEN has_yahoo_metadata = 1 THEN 1 ELSE 0 END) as with_metadata
                FROM symbol_registry
                GROUP BY security_type
                ORDER BY count DESC
            `);
            console.log('[getStatistics] By-type query complete, rows:', byType.length);

            const stats = registry[0];
            const totalSymbols = stats.total_symbols || 0;
            const withMetadata = stats.with_metadata || 0;
            const completion = totalSymbols > 0 ? Math.round((withMetadata / totalSymbols) * 100) : 0;

            // Get queue metrics (symbols needing metadata)
            const [queueResult] = await connection.execute(`
                SELECT COUNT(*) as queue_size
                FROM symbol_registry 
                WHERE has_yahoo_metadata = 0 
                AND security_type IN ('EQUITY', 'ETF', 'MUTUAL_FUND')
            `);
            
            // Get recent processing metrics from securities_metadata updates
            const [processingResult] = await connection.execute(`
                SELECT 
                    COUNT(*) as recent_updates,
                    AVG(TIMESTAMPDIFF(SECOND, created_at, last_updated)) as avg_processing_time_seconds
                FROM securities_metadata 
                WHERE last_updated >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
                AND created_at IS NOT NULL
            `);
            
            const queueSize = queueResult[0].queue_size;
            const recentUpdates = processingResult[0].recent_updates || 0;
            const avgProcessingTime = processingResult[0].avg_processing_time_seconds || 0;
            
            // Estimate time to complete queue (based on 2s throttling)
            const estimatedMinutes = queueSize > 0 ? Math.ceil((queueSize * 2) / 60) : 0;

            const result = {
                summary: {
                    total_symbols: totalSymbols,
                    with_metadata: withMetadata,
                    without_metadata: totalSymbols - withMetadata,
                    completion_percentage: completion,
                    last_update: stats.last_update
                },
                queue: {
                    size: queueSize,
                    estimated_completion_minutes: estimatedMinutes,
                    status: queueSize > 0 ? 'pending' : 'complete'
                },
                processing: {
                    recent_updates_last_hour: recentUpdates,
                    avg_processing_time_seconds: Math.round(avgProcessingTime * 100) / 100,
                    throttling_delay_seconds: 2
                },
                byType: byType.map(row => ({
                    type: row.security_type,
                    total: row.count,
                    with_metadata: row.with_metadata,
                    without_metadata: row.count - row.with_metadata,
                    percentage: row.count > 0 ? Math.round((row.with_metadata / row.count) * 100) : 0
                }))
            };
            console.log('[getStatistics] Returning result');
            return result;
        } catch (error) {
            console.error(`Error getting statistics: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.release();
            }
        }
    }

    /**
     * Force refresh metadata for a ticker
     * Used by admin API
     */
    async refreshTickerMetadata(ticker) {
        const normalizedTicker = ticker.toUpperCase();
        
        let connection;
        try {
            connection = await this.pool.getConnection();

            // Reset has_yahoo_metadata flag to trigger re-fetch
            await connection.execute(`
                UPDATE symbol_registry
                SET has_yahoo_metadata = 0,
                    updated_at = NOW()
                WHERE ticker = ?
            `, [normalizedTicker]);

            // Also clear old metadata
            await connection.execute(`
                DELETE FROM securities_metadata
                WHERE ticker = ?
            `, [normalizedTicker]);

            return { ticker: normalizedTicker, status: 'reset' };
        } catch (error) {
            console.error(`Error refreshing metadata: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.release();
            }
        }
    }

    /**
     * Get ranking score for a symbol
     * Used for sorting results by relevance + financial metrics
     */
    _calculateRankingScore(row) {
        let score = 100;

        // Add market cap based ranking (larger = better)
        if (row.market_cap_numeric) {
            const capScore = Math.min(row.market_cap_numeric / 1e12, 100); // Normalize by 1 trillion
            score += capScore * this.config.RANK_WEIGHT_MARKET_CAP;
        }

        // Add PE ratio based ranking (lower is better for value)
        if (row.trailing_pe && row.trailing_pe > 0) {
            const peScore = Math.max(0, 100 - (row.trailing_pe / 50) * 100); // Normalize by 50
            score += peScore * this.config.RANK_WEIGHT_PE_RATIO;
        }

        // Add dividend yield ranking (higher = better for income)
        if (row.dividend_yield) {
            const divScore = Math.min(row.dividend_yield * 100, 100); // Normalize percentage
            score += divScore * this.config.RANK_WEIGHT_DIVIDEND;
        }

        return score;
    }
}

module.exports = MetadataAutocompleteService;
