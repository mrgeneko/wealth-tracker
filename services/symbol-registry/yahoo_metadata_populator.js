/**
 * Yahoo Metadata Populator Service
 * 
 * Background service that fetches metadata from Yahoo Finance API for symbols
 * in the registry and updates has_yahoo_metadata flag and sort ranks.
 * Implements batch processing with configurable throttling to avoid rate limits.
 */

class YahooMetadataPopulator {
  static CONFIG = {
    BATCH_SIZE: parseInt(process.env.YAHOO_BATCH_SIZE || '50', 10),
    DELAY_MS: parseInt(process.env.YAHOO_DELAY_MS || '2000', 10),
    MAX_SYMBOLS_PER_RUN: parseInt(process.env.YAHOO_MAX_SYMBOLS_PER_RUN || '500', 10),
    RETRY_ATTEMPTS: parseInt(process.env.YAHOO_RETRY_ATTEMPTS || '3', 10),
    RETRY_DELAY_MS: parseInt(process.env.YAHOO_RETRY_DELAY_MS || '1000', 10),
    ENABLE_ON_STARTUP: process.env.ENABLE_YAHOO_POPULATOR_ON_STARTUP !== 'false',
    TIMEOUT_MS: parseInt(process.env.YAHOO_TIMEOUT_MS || '10000', 10)
  };

  constructor(dbPool, symbolRegistryService, yahooFinanceClient) {
    this.dbPool = dbPool;
    this.symbolRegistryService = symbolRegistryService;
    this.yahooFinanceClient = yahooFinanceClient;
    this.isRunning = false;
    this.stats = {
      total_symbols: 0,
      successfully_updated: 0,
      failed: 0,
      skipped: 0,
      start_time: null,
      end_time: null
    };
  }

  /**
   * Check if populator is currently running
   */
  isPopulatorRunning() {
    return this.isRunning;
  }

  /**
   * Get symbols that don't have Yahoo metadata yet
   */
  async getSymbolsNeedingMetadata(limit = 100) {
    const conn = await this.dbPool.getConnection();
    try {
      const sql = `
        SELECT id, ticker, name, exchange, security_type, has_yahoo_metadata
        FROM symbol_registry
        WHERE has_yahoo_metadata = 0
        AND security_type IN ('EQUITY', 'ETF')
        ORDER BY sort_rank ASC
        LIMIT ?
      `;

      const results = await conn.query(sql, [limit]);
      return results[0] || [];
    } finally {
      conn.release();
    }
  }

  /**
   * Fetch metadata from Yahoo Finance with retry logic
   */
  async fetchYahooMetadata(ticker, attempt = 1) {
    try {
      const metadata = await this.yahooFinanceClient.getMetadata(ticker);
      return {
        ticker,
        metadata,
        success: true,
        error: null
      };
    } catch (err) {
      if (attempt < this.constructor.CONFIG.RETRY_ATTEMPTS) {
        // Exponential backoff: wait longer between retries
        const delayMs = this.constructor.CONFIG.RETRY_DELAY_MS * attempt;
        await this.sleep(delayMs);
        return this.fetchYahooMetadata(ticker, attempt + 1);
      }

      return {
        ticker,
        metadata: null,
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Sleep utility for delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract relevant fields from Yahoo metadata
   */
  extractMetadata(metadata) {
    if (!metadata) return null;

    return {
      name: metadata.longName || metadata.shortName,
      currency: metadata.currency,
      exchange: metadata.exchange,
      market_cap: metadata.marketCap,
      trailing_pe: metadata.trailingPE,
      dividend_yield: metadata.dividendYield,
      fifty_two_week_high: metadata.fiftyTwoWeekHigh,
      fifty_two_week_low: metadata.fiftyTwoWeekLow,
      beta: metadata.beta,
      trailing_revenue: metadata.trailingAnnualRevenue,
      trailing_eps: metadata.trailingEps
    };
  }

  /**
   * Update symbol with Yahoo metadata
   */
  async updateSymbolMetadata(conn, symbolId, metadata) {
    const sql = `
      UPDATE symbol_registry
      SET has_yahoo_metadata = 1,
          sort_rank = ?,
          last_updated = NOW()
      WHERE id = ?
    `;

    // Note: sort_rank will be recalculated by caller
    await conn.query(sql, [null, symbolId]); // Placeholder, actual rank passed in
  }

  /**
   * Store extended metadata in separate table
   */
  async storeExtendedMetadata(conn, symbolId, ticker, metadata) {
    const sql = `
      INSERT INTO symbol_registry_metrics (
        symbol_id, ticker, market_cap, trailing_pe, dividend_yield,
        fifty_two_week_high, fifty_two_week_low, beta, trailing_revenue,
        trailing_eps, currency, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        market_cap = VALUES(market_cap),
        trailing_pe = VALUES(trailing_pe),
        dividend_yield = VALUES(dividend_yield),
        fifty_two_week_high = VALUES(fifty_two_week_high),
        fifty_two_week_low = VALUES(fifty_two_week_low),
        beta = VALUES(beta),
        trailing_revenue = VALUES(trailing_revenue),
        trailing_eps = VALUES(trailing_eps),
        recorded_at = NOW()
    `;

    const extracted = this.extractMetadata(metadata);
    if (!extracted) return;

    await conn.query(sql, [
      symbolId,
      ticker,
      extracted.market_cap,
      extracted.trailing_pe,
      extracted.dividend_yield,
      extracted.fifty_two_week_high,
      extracted.fifty_two_week_low,
      extracted.beta,
      extracted.trailing_revenue,
      extracted.trailing_eps,
      extracted.currency
    ]);
  }

  /**
   * Process a batch of symbols
   */
  async processBatch(symbols) {
    const conn = await this.dbPool.getConnection();
    const batchStats = {
      processed: 0,
      successful: 0,
      failed: 0
    };

    try {
      for (const symbol of symbols) {
        try {
          // Fetch metadata from Yahoo
          const result = await this.fetchYahooMetadata(symbol.ticker);

          if (result.success && result.metadata) {
            // Extract and store metadata
            const extracted = this.extractMetadata(result.metadata);

            // Update symbol with Yahoo metadata flag
            const rankSql = `
              UPDATE symbol_registry
              SET has_yahoo_metadata = 1,
                  sort_rank = ?,
                  last_updated = NOW()
              WHERE id = ?
            `;

            const newRank = this.symbolRegistryService.calculateSortRank(
              symbol.security_type,
              true, // has Yahoo metadata
              extracted?.market_cap
            );

            await conn.query(rankSql, [newRank, symbol.id]);

            // Store extended metrics
            await this.storeExtendedMetadata(conn, symbol.id, symbol.ticker, result.metadata);

            batchStats.successful++;
            this.stats.successfully_updated++;
          } else {
            batchStats.failed++;
            this.stats.failed++;
          }

          batchStats.processed++;
          this.stats.total_symbols++;

          // Throttle requests to avoid rate limiting
          if (batchStats.processed < symbols.length) {
            await this.sleep(this.constructor.CONFIG.DELAY_MS);
          }
        } catch (err) {
          batchStats.failed++;
          this.stats.failed++;
          batchStats.processed++;
          this.stats.total_symbols++;
        }
      }
    } finally {
      conn.release();
    }

    return batchStats;
  }

  /**
   * Run metadata population for limited symbols
   */
  async populateMetadata(maxSymbols = null) {
    if (this.isRunning) {
      throw new Error('Metadata population already in progress');
    }

    const limit = maxSymbols || this.constructor.CONFIG.MAX_SYMBOLS_PER_RUN;
    this.isRunning = true;
    this.stats = {
      total_symbols: 0,
      successfully_updated: 0,
      failed: 0,
      skipped: 0,
      start_time: new Date(),
      end_time: null
    };

    try {
      let processed = 0;

      while (processed < limit) {
        const remaining = limit - processed;
        const batchLimit = Math.min(
          this.constructor.CONFIG.BATCH_SIZE,
          remaining
        );

        const symbols = await this.getSymbolsNeedingMetadata(batchLimit);

        if (symbols.length === 0) {
          // No more symbols to process
          break;
        }

        const batchStats = await this.processBatch(symbols);
        processed += batchStats.processed;
      }

      this.stats.end_time = new Date();
      this.stats.duration_ms = this.stats.end_time - this.stats.start_time;

      return this.stats;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run metadata population continuously (background job)
   */
  async startBackgroundPopulation() {
    if (this.backgroundJob) {
      throw new Error('Background population already running');
    }

    // Start background job (non-blocking)
    this.backgroundJob = setImmediate(async () => {
      try {
        while (true) {
          await this.populateMetadata();

          // Wait before next run (e.g., 1 hour)
          const runIntervalMs = parseInt(
            process.env.YAHOO_POPULATOR_RUN_INTERVAL_MS || '3600000',
            10
          );
          await this.sleep(runIntervalMs);
        }
      } catch (err) {
        console.error('Background metadata population error:', err);
      }
    });

    return {
      status: 'started',
      config: this.constructor.CONFIG
    };
  }

  /**
   * Stop background population
   */
  stopBackgroundPopulation() {
    if (this.backgroundJob) {
      clearImmediate(this.backgroundJob);
      this.backgroundJob = null;
      return { status: 'stopped' };
    }

    return { status: 'not running' };
  }

  /**
   * Get current population statistics
   */
  getStats() {
    return {
      ...this.stats,
      is_running: this.isRunning
    };
  }

  /**
   * Get count of symbols still needing metadata
   */
  async getRemainingCount() {
    const conn = await this.dbPool.getConnection();
    try {
      const sql = `
        SELECT COUNT(*) as count
        FROM symbol_registry
        WHERE has_yahoo_metadata = 0
        AND security_type IN ('EQUITY', 'ETF')
      `;

      const results = await conn.query(sql);
      return results[0][0].count;
    } finally {
      conn.release();
    }
  }

  /**
   * Get percentage of symbols with metadata
   */
  async getCompletionPercentage() {
    const conn = await this.dbPool.getConnection();
    try {
      const sql = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN has_yahoo_metadata = 1 THEN 1 ELSE 0 END) as with_metadata
        FROM symbol_registry
        WHERE security_type IN ('EQUITY', 'ETF')
      `;

      const results = await conn.query(sql);
      const row = results[0][0];

      if (row.total === 0) return 0;

      return Math.round((row.with_metadata / row.total) * 100);
    } finally {
      conn.release();
    }
  }

  /**
   * Force refresh metadata for a specific ticker
   */
  async refreshMetadataForTicker(ticker) {
    const conn = await this.dbPool.getConnection();
    try {
      // Find symbol
      const selectSql = `
        SELECT id, security_type FROM symbol_registry WHERE ticker = ? LIMIT 1
      `;

      const results = await conn.query(selectSql, [ticker]);

      if (!results[0] || results[0].length === 0) {
        return { success: false, error: 'Symbol not found' };
      }

      const symbol = results[0][0];

      // Fetch fresh metadata
      const result = await this.fetchYahooMetadata(ticker);

      if (result.success && result.metadata) {
        const extracted = this.extractMetadata(result.metadata);

        const updateSql = `
          UPDATE symbol_registry
          SET has_yahoo_metadata = 1,
              sort_rank = ?,
              last_updated = NOW()
          WHERE id = ?
        `;

        const newRank = this.symbolRegistryService.calculateSortRank(
          symbol.security_type,
          true,
          extracted?.market_cap
        );

        await conn.query(updateSql, [newRank, symbol.id]);
        await this.storeExtendedMetadata(conn, symbol.id, ticker, result.metadata);

        return { success: true, metadata: extracted };
      } else {
        return { success: false, error: result.error };
      }
    } finally {
      conn.release();
    }
  }

  /**
   * Reset metadata for testing/cleanup
   */
  async resetMetadata(securityType = 'EQUITY') {
    const conn = await this.dbPool.getConnection();
    try {
      const sql = `
        UPDATE symbol_registry
        SET has_yahoo_metadata = 0,
            sort_rank = ?
        WHERE security_type = ?
      `;

      // Recalculate sort ranks without Yahoo metadata
      await conn.query(sql, [null, securityType]); // Will need proper calculation

      return { success: true };
    } finally {
      conn.release();
    }
  }
}

module.exports = YahooMetadataPopulator;
