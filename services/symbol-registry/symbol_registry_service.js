/**
 * Symbol Registry Service
 * 
 * Core service managing the symbol_registry table, file refresh operations,
 * Yahoo metadata population, and autocomplete functionality.
 */

const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs').promises;

class SymbolRegistryService {
  static CONFIG = {
    FILE_REFRESH_INTERVAL_HOURS: parseInt(process.env.FILE_REFRESH_INTERVAL_HOURS || '24', 10),
    YAHOO_BATCH_SIZE: parseInt(process.env.YAHOO_BATCH_SIZE || '50', 10),
    YAHOO_DELAY_MS: parseInt(process.env.YAHOO_DELAY_MS || '2000', 10),
    YAHOO_MAX_SYMBOLS_PER_RUN: parseInt(process.env.YAHOO_MAX_SYMBOLS_PER_RUN || '500', 10),
    TREASURY_EXPIRY_CUTOFF_DAYS: parseInt(process.env.TREASURY_EXPIRY_CUTOFF_DAYS || '59', 10),
    OPTION_EXPIRY_CUTOFF_DAYS: parseInt(process.env.OPTION_EXPIRY_CUTOFF_DAYS || '59', 10),
    FUTURES_EXPIRY_CUTOFF_DAYS: parseInt(process.env.FUTURES_EXPIRY_CUTOFF_DAYS || '59', 10),
    AUTOCOMPLETE_MAX_RESULTS: parseInt(process.env.AUTOCOMPLETE_MAX_RESULTS || '20', 10)
  };

  constructor(dbPool) {
    this.dbPool = dbPool;
  }

  /**
   * Calculate sort rank for a symbol based on security type, metadata, and volume
   * Lower rank = higher priority in autocomplete
   * 
   * Priority: Equities > ETFs > Crypto > Indices > FX > Futures > Options > Treasuries
   */
  calculateSortRank(securityType, hasYahooMetadata, usdTradingVolume) {
    const typeRanks = {
      'EQUITY': 100,
      'ETF': 200,
      'CRYPTO': 300,
      'INDEX': 400,
      'FX': 500,
      'FUTURES': 600,
      'OPTION': 700,
      'TREASURY': 800,
      'BOND': 850,
      'MUTUAL_FUND': 900,
      'OTHER': 1000
    };

    let rank = typeRanks[securityType] || 1000;

    // Bonus for having Yahoo metadata
    if (hasYahooMetadata) {
      rank -= 50;
    }

    // Volume-based adjustment
    if (usdTradingVolume) {
      if (usdTradingVolume > 1000000000) rank -= 40;      // > $1B
      else if (usdTradingVolume > 100000000) rank -= 30;  // > $100M
      else if (usdTradingVolume > 10000000) rank -= 20;   // > $10M
      else if (usdTradingVolume > 1000000) rank -= 10;    // > $1M
    }

    return rank;
  }

  /**
   * Determine the source priority when a symbol exists in multiple sources
   * Higher priority sources override lower ones
   */
  getSourcePriority(source) {
    const priorities = {
      'NASDAQ_FILE': 1,
      'NYSE_FILE': 2,
      'OTHER_FILE': 3,
      'TREASURY_FILE': 4,
      'TREASURY_HISTORICAL': 5,
      'YAHOO': 6,
      'USER_ADDED': 7
    };
    return priorities[source] || 999;
  }

  /**
   * Check if a symbol should be updated based on source priority
   * Returns true if newSource has higher priority (lower number) than oldSource
   */
  shouldUpdateSource(oldSource, newSource) {
    return this.getSourcePriority(newSource) < this.getSourcePriority(oldSource);
  }

  /**
   * Insert or update a symbol in the registry
   */
  async upsertSymbol(symbolData) {
    const conn = await this.dbPool.getConnection();
    try {
      const {
        symbol,
        name,
        exchange,
        security_type = 'EQUITY',
        source,
        has_yahoo_metadata = false,
        usd_trading_volume = null,
        issue_date = null,
        maturity_date = null,
        security_term = null,
        underlying_symbol = null,
        strike_price = null,
        option_type = null,
        expiration_date = null
      } = symbolData;

      const sortRank = this.calculateSortRank(security_type, has_yahoo_metadata, usd_trading_volume);

      // Check if symbol exists
      const [existing] = await conn.query(
        'SELECT source FROM symbol_registry WHERE symbol = ?',
        [symbol]
      );

      if (existing.length > 0) {
        // Symbol exists - update if new source has higher priority
        const oldSource = existing[0].source;
        if (this.shouldUpdateSource(oldSource, source)) {
          // New source is more authoritative - update it
          await conn.query(
            `UPDATE symbol_registry 
             SET name = ?, exchange = ?, security_type = ?, source = ?, 
                 has_yahoo_metadata = ?, usd_trading_volume = ?, sort_rank = ?,
                 issue_date = ?, maturity_date = ?, security_term = ?,
                 underlying_symbol = ?, strike_price = ?, option_type = ?, expiration_date = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE symbol = ?`,
            [name, exchange, security_type, source, has_yahoo_metadata, usd_trading_volume, sortRank,
             issue_date, maturity_date, security_term, underlying_symbol, strike_price, option_type, expiration_date,
             symbol]
          );
        } else {
          // Old source is more authoritative - just update metadata if present
          if (has_yahoo_metadata || usd_trading_volume) {
            await conn.query(
              `UPDATE symbol_registry 
               SET has_yahoo_metadata = ?, usd_trading_volume = ?, sort_rank = ?, updated_at = CURRENT_TIMESTAMP
               WHERE symbol = ?`,
              [has_yahoo_metadata, usd_trading_volume, sortRank, symbol]
            );
          }
        }
      } else {
        // New symbol - insert it
        await conn.query(
          `INSERT INTO symbol_registry 
           (symbol, name, exchange, security_type, source, has_yahoo_metadata, usd_trading_volume, sort_rank,
            issue_date, maturity_date, security_term, underlying_symbol, strike_price, option_type, expiration_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [symbol, name, exchange, security_type, source, has_yahoo_metadata, usd_trading_volume, sortRank,
           issue_date, maturity_date, security_term, underlying_symbol, strike_price, option_type, expiration_date]
        );
      }
    } finally {
      conn.release();
    }
  }

  /**
   * Get a symbol from the registry with optional metadata enrichment
   */
  async lookupSymbol(symbol) {
    const conn = await this.dbPool.getConnection();
    try {
      const [results] = await conn.query(
        `SELECT 
          sr.symbol,
          COALESCE(sm.long_name, sm.short_name, sr.name) as name,
          sr.security_type,
          COALESCE(sm.exchange, sr.exchange) as exchange,
          sr.has_yahoo_metadata,
          sr.maturity_date,
          sr.issue_date,
          sr.security_term,
          sr.expiration_date,
          sm.dividend_yield,
          sm.trailing_pe,
          sm.ttm_dividend_amount,
          sm.ttm_eps
         FROM symbol_registry sr
         LEFT JOIN securities_metadata sm ON sr.symbol = sm.symbol
         WHERE sr.symbol = ?`,
        [symbol]
      );

      return results.length > 0 ? results[0] : null;
    } finally {
      conn.release();
    }
  }

  /**
   * Autocomplete search across symbol registry
   */
  async autocomplete(query, limit = null) {
    limit = limit || this.constructor.CONFIG.AUTOCOMPLETE_MAX_RESULTS;
    const conn = await this.dbPool.getConnection();
    try {
      const searchPattern = `%${query}%`;
      const exactMatch = query;
      const prefixMatch = `${query}%`;

      const [results] = await conn.query(
        `SELECT 
          sr.symbol,
          COALESCE(sm.long_name, sm.short_name, sr.name) as name,
          sr.security_type,
          COALESCE(sm.exchange, sr.exchange) as exchange,
          sr.has_yahoo_metadata,
          sr.maturity_date,
          sr.issue_date,
          sr.security_term,
          sm.dividend_yield,
          sm.trailing_pe
         FROM symbol_registry sr
         LEFT JOIN securities_metadata sm ON sr.symbol = sm.symbol
         WHERE 
          sr.symbol LIKE ? 
          OR sr.name LIKE ?
          OR sm.short_name LIKE ?
          OR sm.long_name LIKE ?
         ORDER BY 
          CASE WHEN sr.symbol = ? THEN 1
               WHEN sr.symbol LIKE ? THEN 2
               ELSE 3 END,
          sr.sort_rank ASC,
          sr.symbol ASC
         LIMIT ?`,
        [searchPattern, searchPattern, searchPattern, searchPattern, exactMatch, prefixMatch, limit]
      );

      return results;
    } finally {
      conn.release();
    }
  }

  /**
   * Get registry metrics for a given date and source
   */
  async getMetrics(metricDate = null, source = null) {
    metricDate = metricDate || new Date().toISOString().split('T')[0];
    const conn = await this.dbPool.getConnection();
    try {
      let query = 'SELECT * FROM symbol_registry_metrics WHERE metric_date = ?';
      const params = [metricDate];

      if (source) {
        query += ' AND source = ?';
        params.push(source);
      }

      const [results] = await conn.query(query, params);
      return results;
    } finally {
      conn.release();
    }
  }

  /**
   * Record refresh status for a file type
   */
  async recordRefreshStatus(fileType, status, durationMs, symbolsAdded, symbolsUpdated, errorMessage = null) {
    const conn = await this.dbPool.getConnection();
    try {
      await conn.query(
        `INSERT INTO file_refresh_status 
         (file_type, last_refresh_at, last_refresh_duration_ms, last_refresh_status, 
          symbols_added, symbols_updated, last_error_message, next_refresh_due_at, updated_at)
         VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR), CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
          last_refresh_at = CURRENT_TIMESTAMP,
          last_refresh_duration_ms = VALUES(last_refresh_duration_ms),
          last_refresh_status = VALUES(last_refresh_status),
          symbols_added = VALUES(symbols_added),
          symbols_updated = VALUES(symbols_updated),
          last_error_message = VALUES(last_error_message),
          next_refresh_due_at = VALUES(next_refresh_due_at),
          updated_at = CURRENT_TIMESTAMP`,
        [fileType, durationMs, status, symbolsAdded, symbolsUpdated, errorMessage, this.constructor.CONFIG.FILE_REFRESH_INTERVAL_HOURS]
      );
    } finally {
      conn.release();
    }
  }

  /**
   * Get refresh status for all file types
   */
  async getRefreshStatus(fileType = null) {
    const conn = await this.dbPool.getConnection();
    try {
      let query = 'SELECT * FROM file_refresh_status ORDER BY file_type';
      const params = [];

      if (fileType) {
        query = 'SELECT * FROM file_refresh_status WHERE file_type = ?';
        params.push(fileType);
      }

      const [results] = await conn.query(query, params);
      return results;
    } finally {
      conn.release();
    }
  }
}

module.exports = SymbolRegistryService;
