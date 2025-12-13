/**
 * Symbol Registry Sync Service
 * 
 * Loads and syncs symbol data from all source CSV files (NASDAQ, NYSE, OTHER, TREASURY)
 * into the ticker_registry table. Handles deduplication, source priority, and rank
 * calculation during the sync process.
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parse/sync');
const TreasuryDataHandler = require('./treasury_data_handler');

class SymbolRegistrySyncService {
  static CONFIG = {
    // Support both local dev and Docker paths
    NASDAQ_FILE: process.env.NASDAQ_FILE || path.join(__dirname, '../../config/nasdaq-listed.csv'),
    NYSE_FILE: process.env.NYSE_FILE || path.join(__dirname, '../../config/nyse-listed.csv'),
    OTHER_FILE: process.env.OTHER_FILE || path.join(__dirname, '../../config/other-listed.csv'),
    BATCH_SIZE: parseInt(process.env.SYNC_BATCH_SIZE || '500', 10),
    ENABLE_SYNC_ON_STARTUP: process.env.ENABLE_SYNC_ON_STARTUP !== 'false'
  };

  constructor(dbPool, symbolRegistryService) {
    this.dbPool = dbPool;
    this.symbolRegistryService = symbolRegistryService;
    this.treasuryHandler = new TreasuryDataHandler();
  }

  /**
   * Get all configured file types and their paths
   */
  getFileConfigs() {
    return {
      'NASDAQ': { path: this.constructor.CONFIG.NASDAQ_FILE, columns: this.getNasdaqColumns() },
      'NYSE': { path: this.constructor.CONFIG.NYSE_FILE, columns: this.getNyseColumns() },
      'OTHER': { path: this.constructor.CONFIG.OTHER_FILE, columns: this.getOtherColumns() },
      'TREASURY': { path: null, columns: null } // Loaded via TreasuryDataHandler
    };
  }

  /**
   * NASDAQ CSV columns: Symbol, Security Name
   */
  getNasdaqColumns() {
    return {
      ticker: 'Symbol',
      name: 'Security Name',
      exchange: null // Will be set to NASDAQ
    };
  }

  /**
   * NYSE CSV columns: ACT Symbol, Company Name (with optional Security Name)
   */
  getNyseColumns() {
    return {
      ticker: 'ACT Symbol',
      name: 'Company Name',
      exchange: null // Will be set to NYSE
    };
  }

  /**
   * OTHER CSV columns: ACT Symbol, Company Name (or Security Name)
   */
  getOtherColumns() {
    return {
      ticker: 'ACT Symbol',
      name: 'Company Name',
      exchange: null // Will be set to OTHER
    };
  }

  /**
   * Load CSV file and parse records
   */
  async loadCsvFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const records = csv.parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
      return records;
    } catch (err) {
      throw new Error(`Failed to load CSV file ${filePath}: ${err.message}`);
    }
  }

  /**
   * Parse NASDAQ symbols from CSV records
   */
  parseNasdaqSymbols(records) {
    return records
      .filter(r => r.Symbol && r['Security Name'])
      .map(r => {
        const name = r['Security Name'].trim();
        // Determine security type: ETF if 'ETF' in name, otherwise EQUITY
        const securityType = name.toUpperCase().includes('ETF') ? 'ETF' : 'EQUITY';
        
        return {
          ticker: r.Symbol.trim(),
          name: name,
          exchange: 'NASDAQ',
          source: 'NASDAQ_FILE',
          security_type: securityType,
          cusip: null
        };
      });
  }

  /**
   * Parse NYSE symbols from CSV records
   */
  parseNyseSymbols(records) {
    return records
      .filter(r => r['ACT Symbol'] && r['Company Name'])
      .map(r => {
        const name = r['Company Name'].trim();
        // Determine security type: ETF if 'ETF' in name, otherwise EQUITY (no bonds/treasuries in NYSE)
        const securityType = name.toUpperCase().includes('ETF') ? 'ETF' : 'EQUITY';
        
        return {
          ticker: r['ACT Symbol'].trim(),
          name: name,
          exchange: 'NYSE',
          source: 'NYSE_FILE',
          security_type: securityType,
          cusip: null
        };
      });
  }

  /**
   * Parse OTHER listed symbols from CSV records
   */
  parseOtherSymbols(records) {
    return records
      .filter(r => r['ACT Symbol'] && r['Company Name'])
      .map(r => {
        const name = r['Company Name'].trim();
        // Use the ETF column if available, otherwise check name
        let securityType = 'EQUITY';
        if (r['ETF'] && r['ETF'].toUpperCase() === 'Y') {
          securityType = 'ETF';
        } else if (name.toUpperCase().includes('ETF')) {
          securityType = 'ETF';
        }
        
        return {
          ticker: r['ACT Symbol'].trim(),
          name: name,
          exchange: 'OTHER',
          source: 'OTHER_FILE',
          security_type: securityType,
          cusip: null
        };
      });
  }

  /**
   * Infer security type from name using keywords
   */
  inferSecurityType(name) {
    if (!name) return 'OTHER';

    const lowerName = name.toLowerCase();

    // Check for specific types
    if (lowerName.includes('etf') || lowerName.includes('fund')) return 'ETF';
    if (lowerName.includes('crypto') || lowerName.includes('bitcoin') || lowerName.includes('ethereum')) return 'CRYPTO';
    if (lowerName.includes('index') || lowerName.includes('idx')) return 'INDEX';
    if (lowerName.includes('warrant')) return 'WARRANT';
    if (lowerName.includes('preferred')) return 'PREFERRED';
    if (lowerName.includes('bond')) return 'BOND';
    if (lowerName.includes('note') || lowerName.includes('bill')) return 'TREASURY';

    // Default to EQUITY for most stocks
    return 'EQUITY';
  }

  /**
   * Convert parsed symbol to registry format
   */
  symbolToRegistryFormat(symbolData) {
    return {
      ticker: symbolData.ticker,  // 'ticker' from CSV is mapped to 'ticker' in DB
      name: symbolData.name,
      exchange: symbolData.exchange,
      security_type: symbolData.security_type,
      source: symbolData.source,
      has_yahoo_metadata: false,
      usd_trading_volume: null,
      issue_date: null,
      maturity_date: null,
      security_term: null,
      underlying_ticker: null,
      strike_price: null,
      option_type: null,
      expiration_date: null
    };
  }

  /**
   * Sync all symbols from a specific file type
   */
  async syncFileType(fileType) {
    const stats = {
      file_type: fileType,
      total_records: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      start_time: new Date()
    };

    try {
      // Record sync start
      await this.updateFileRefreshStatus(fileType, 'IN_PROGRESS', null, 0, 0, null);

      let records = [];

      if (fileType === 'NASDAQ') {
        records = await this.loadCsvFile(this.constructor.CONFIG.NASDAQ_FILE);
        records = this.parseNasdaqSymbols(records);
      } else if (fileType === 'NYSE') {
        records = await this.loadCsvFile(this.constructor.CONFIG.NYSE_FILE);
        records = this.parseNyseSymbols(records);
      } else if (fileType === 'OTHER') {
        records = await this.loadCsvFile(this.constructor.CONFIG.OTHER_FILE);
        records = this.parseOtherSymbols(records);
      } else if (fileType === 'TREASURY') {
        records = await this.treasuryHandler.loadTreasuryData();
      }

      stats.total_records = records.length;

      // Process in batches
      for (let i = 0; i < records.length; i += this.constructor.CONFIG.BATCH_SIZE) {
        const batch = records.slice(i, i + this.constructor.CONFIG.BATCH_SIZE);
        const batchStats = await this.processBatch(batch);

        stats.inserted += batchStats.inserted;
        stats.updated += batchStats.updated;
        stats.skipped += batchStats.skipped;
        stats.errors += batchStats.errors;
      }

      stats.end_time = new Date();
      stats.duration_ms = stats.end_time - stats.start_time;

      // Record successful sync
      await this.updateFileRefreshStatus(
        fileType, 
        'SUCCESS', 
        stats.duration_ms, 
        stats.inserted, 
        stats.updated, 
        null
      );

      return stats;
    } catch (err) {
      stats.errors++;
      stats.error_message = err.message;
      stats.end_time = new Date();
      stats.duration_ms = stats.end_time - stats.start_time;

      // Record failed sync
      await this.updateFileRefreshStatus(
        fileType,
        'FAILED',
        stats.duration_ms,
        stats.inserted,
        stats.updated,
        err.message
      );

      throw err;
    }
  }

  /**
   * Update file refresh status in the database
   */
  async updateFileRefreshStatus(fileType, status, durationMs, symbolsAdded, symbolsUpdated, errorMessage) {
    const conn = await this.dbPool.getConnection();
    try {
      await conn.execute(`
        INSERT INTO file_refresh_status (
          file_type,
          last_refresh_at,
          last_refresh_duration_ms,
          last_refresh_status,
          last_error_message,
          tickers_added,
          tickers_updated
        ) VALUES (?, NOW(), ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          last_refresh_at = NOW(),
          last_refresh_duration_ms = VALUES(last_refresh_duration_ms),
          last_refresh_status = VALUES(last_refresh_status),
          last_error_message = VALUES(last_error_message),
          tickers_added = VALUES(tickers_added),
          tickers_updated = VALUES(tickers_updated)
      `, [fileType, durationMs, status, errorMessage, symbolsAdded || 0, symbolsUpdated || 0]);
    } catch (err) {
      console.error('[SymbolRegistrySync] Error updating file refresh status:', err.message);
    } finally {
      conn.release();
    }
  }

  /**
   * Process a batch of symbols
   */
  async processBatch(symbols) {
    const stats = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0
    };

    const conn = await this.dbPool.getConnection();
    try {
      for (const symbol of symbols) {
        try {
          const registryData = this.symbolToRegistryFormat(symbol);

          // Check if symbol already exists with same ticker+exchange+security_type
          const existing = await this.getExistingSymbol(
            conn,
            symbol.ticker,
            symbol.exchange,
            symbol.security_type
          );

          if (existing) {
            // Check if we should update based on source priority
            if (this.symbolRegistryService.shouldUpdateSource(existing.source, symbol.source)) {
              await this.updateSymbol(conn, existing.id, registryData);
              stats.updated++;
            } else {
              stats.skipped++;
            }
          } else {
            // Insert new symbol
            try {
              await this.insertSymbol(conn, registryData);
              stats.inserted++;
            } catch (insertErr) {
              console.error('[SymbolRegistrySync] Insert error for symbol', symbol.ticker, ':', insertErr.message);
              stats.errors++;
            }
          }
        } catch (err) {
          console.error('[SymbolRegistrySync] Symbol processing error:', err.message);
          stats.errors++;
        }
      }
    } finally {
      conn.release();
    }

    return stats;
  }

  /**
   * Get existing symbol by ticker, exchange, and security type
   */
  async getExistingSymbol(conn, ticker, exchange, securityType) {
    const sql = `
      SELECT id, ticker, exchange, security_type, source, has_yahoo_metadata
      FROM ticker_registry
      WHERE ticker = ? AND exchange = ? AND security_type = ?
      LIMIT 1
    `;

    const results = await conn.query(sql, [ticker, exchange, securityType]);
    return results[0] && results[0].length > 0 ? results[0][0] : null;
  }

  /**
   * Insert new symbol into registry
   */
  async insertSymbol(conn, symbolData) {
    const sql = `
      INSERT INTO ticker_registry (
        ticker, name, exchange, security_type, source, has_yahoo_metadata, 
        usd_trading_volume, sort_rank, issue_date, maturity_date, security_term, 
        underlying_ticker, strike_price, option_type, expiration_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const sortRank = this.symbolRegistryService.calculateSortRank(
      symbolData.security_type,
      symbolData.has_yahoo_metadata,
      symbolData.usd_trading_volume
    );

    await conn.query(sql, [
      symbolData.ticker,
      symbolData.name,
      symbolData.exchange,
      symbolData.security_type,
      symbolData.source,
      symbolData.has_yahoo_metadata ? 1 : 0,
      symbolData.usd_trading_volume || null,
      sortRank,
      symbolData.issue_date || null,
      symbolData.maturity_date || null,
      symbolData.security_term || null,
      symbolData.underlying_ticker || null,
      symbolData.strike_price || null,
      symbolData.option_type || null,
      symbolData.expiration_date || null
    ]);
  }

  /**
   * Update existing symbol in registry
   */
  async updateSymbol(conn, symbolId, symbolData) {
    const sql = `
      UPDATE ticker_registry
      SET name = ?, exchange = ?, security_type = ?, source = ?,
          usd_trading_volume = ?, sort_rank = ?, updated_at = NOW()
      WHERE id = ?
    `;

    const sortRank = this.symbolRegistryService.calculateSortRank(
      symbolData.security_type,
      symbolData.has_yahoo_metadata,
      symbolData.usd_trading_volume
    );

    await conn.query(sql, [
      symbolData.name,
      symbolData.exchange,
      symbolData.security_type,
      symbolData.source,
      symbolData.usd_trading_volume || null,
      sortRank,
      symbolId
    ]);
  }

  /**
   * Sync all file types
   * Returns aggregated statistics for all syncs
   */
  async syncAll() {
    const allStats = {
      total_files: 4,
      files: [],
      total_records: 0,
      total_inserted: 0,
      total_updated: 0,
      total_skipped: 0,
      total_errors: 0,
      start_time: new Date()
    };

    for (const fileType of ['NASDAQ', 'NYSE', 'OTHER', 'TREASURY']) {
      try {
        console.log('[SymbolRegistrySync] Starting sync for', fileType);
        const stats = await this.syncFileType(fileType);
        console.log('[SymbolRegistrySync]', fileType, 'sync complete:', JSON.stringify(stats, null, 2));
        allStats.files.push(stats);
        allStats.total_records += stats.total_records;
        allStats.total_inserted += stats.inserted;
        allStats.total_updated += stats.updated;
        allStats.total_skipped += stats.skipped;
        allStats.total_errors += stats.errors;
      } catch (err) {
        console.error('[SymbolRegistrySync] Error syncing', fileType, ':', err.message);
        console.error('[SymbolRegistrySync] Stack:', err.stack);
        allStats.total_errors++;
        allStats.files.push({
          file_type: fileType,
          error: err.message
        });
      }
    }

    allStats.end_time = new Date();
    allStats.duration_ms = allStats.end_time - allStats.start_time;

    return allStats;
  }

  /**
   * Get count of symbols in registry
   */
  async getRegistryCount() {
    const conn = await this.dbPool.getConnection();
    try {
      const sql = 'SELECT COUNT(*) as count FROM ticker_registry';
      const results = await conn.query(sql);
      return results[0][0].count;
    } finally {
      conn.release();
    }
  }

  /**
   * Get count of symbols by file type
   */
  async getCountBySource(source) {
    const conn = await this.dbPool.getConnection();
    try {
      const sql = 'SELECT COUNT(*) as count FROM ticker_registry WHERE source = ?';
      const results = await conn.query(sql, [source]);
      return results[0][0].count;
    } finally {
      conn.release();
    }
  }

  /**
   * Get count of symbols by security type
   */
  async getCountBySecurityType(securityType) {
    const conn = await this.dbPool.getConnection();
    try {
      const sql = 'SELECT COUNT(*) as count FROM ticker_registry WHERE security_type = ?';
      const results = await conn.query(sql, [securityType]);
      return results[0][0].count;
    } finally {
      conn.release();
    }
  }

  /**
   * Get summary statistics of registry
   */
  async getRegistrySummary() {
    const conn = await this.dbPool.getConnection();
    try {
      const countSql = 'SELECT COUNT(*) as count FROM ticker_registry';
      const countResults = await conn.query(countSql);
      const totalCount = countResults[0][0].count;

      const sourcesSql = `
        SELECT source, COUNT(*) as count
        FROM ticker_registry
        GROUP BY source
        ORDER BY count DESC
      `;
      const sourcesResults = await conn.query(sourcesSql);
      const bySources = sourcesResults[0];

      const typesSql = `
        SELECT security_type, COUNT(*) as count
        FROM ticker_registry
        GROUP BY security_type
        ORDER BY count DESC
      `;
      const typesResults = await conn.query(typesSql);
      const byTypes = typesResults[0];

      return {
        total_symbols: totalCount,
        by_source: bySources,
        by_security_type: byTypes
      };
    } finally {
      conn.release();
    }
  }
}

module.exports = SymbolRegistrySyncService;
