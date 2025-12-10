/**
 * Treasury Data Handler
 * 
 * Handles loading, merging, and processing of Treasury security data from CSV files.
 * Merges recent auction data with historical data, filters out matured securities,
 * and formats treasury records for the symbol registry.
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parse/sync');

class TreasuryDataHandler {
  static CONFIG = {
    TREASURY_EXPIRY_CUTOFF_DAYS: parseInt(process.env.TREASURY_EXPIRY_CUTOFF_DAYS || '59', 10),
    RECENT_AUCTIONS_FILE: process.env.TREASURY_AUCTIONS_FILE || path.join(__dirname, '../../config/us-treasury-auctions.csv'),
    HISTORICAL_AUCTIONS_FILE: process.env.TREASURY_HISTORICAL_FILE || path.join(__dirname, '../../config/Auctions_Query_19791115_20251215.csv')
  };

  constructor() {
    this.recentTreasuries = [];
    this.historicalTreasuries = [];
    this.mergedTreasuries = [];
  }

  /**
   * Load Treasury data from both CSV files
   */
  async loadTreasuryData() {
    try {
      console.log('[Treasury] Loading recent auctions from:', this.constructor.CONFIG.RECENT_AUCTIONS_FILE);
      const recentCount = await this.loadRecentAuctions();
      console.log('[Treasury] Loaded', recentCount, 'recent auction records');
      
      console.log('[Treasury] Loading historical auctions from:', this.constructor.CONFIG.HISTORICAL_AUCTIONS_FILE);
      const historicalCount = await this.loadHistoricalAuctions();
      console.log('[Treasury] Loaded', historicalCount, 'historical auction records');
      
      this.mergedTreasuries = this.mergeTreasuryData();
      console.log('[Treasury] Merged into', this.mergedTreasuries.length, 'treasury records');
      
      // Filter matured treasuries and convert to registry format
      const filtered = this.filterMaturedTreasuries(this.mergedTreasuries);
      console.log('[Treasury] After filtering matured (cutoff:', this.constructor.CONFIG.TREASURY_EXPIRY_CUTOFF_DAYS, 'days):', filtered.length, 'records');
      
      const formatted = filtered.map(record => this.treasuryToRegistryFormat(record));
      console.log('[Treasury] Formatted to registry format:', formatted.length, 'records');
      
      return formatted;
    } catch (err) {
      console.error('[Treasury] Error loading treasury data:', err.message);
      throw new Error(`Failed to load treasury data: ${err.message}`);
    }
  }

  /**
   * Load recent treasury auction data from us-treasury-auctions.csv
   */
  async loadRecentAuctions() {
    try {
      const content = await fs.readFile(this.constructor.CONFIG.RECENT_AUCTIONS_FILE, 'utf-8');
      const records = csv.parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
      this.recentTreasuries = records;
      console.log('[Treasury] loadRecentAuctions: Loaded', records.length, 'records');
      return records.length;
    } catch (err) {
      console.warn(`⚠️  Could not load recent auctions: ${err.message}`);
      this.recentTreasuries = [];
      return 0;
    }
  }

  /**
   * Load historical treasury auction data from Auctions_Query file
   */
  async loadHistoricalAuctions() {
    try {
      const content = await fs.readFile(this.constructor.CONFIG.HISTORICAL_AUCTIONS_FILE, 'utf-8');
      const records = csv.parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
      this.historicalTreasuries = records;
      console.log('[Treasury] loadHistoricalAuctions: Loaded', records.length, 'records');
      return records.length;
    } catch (err) {
      console.warn(`⚠️  Could not load historical auctions: ${err.message}`);
      this.historicalTreasuries = [];
      return 0;
    }
  }

  /**
   * Merge recent and historical treasury data
   * Recent data takes precedence over historical for duplicate CUSIPs
   */
  mergeTreasuryData() {
    const merged = {};

    // Debug: log sample records
    if (this.historicalTreasuries.length > 0) {
      console.log('[Treasury] Sample historical record keys:', Object.keys(this.historicalTreasuries[0]));
      console.log('[Treasury] Sample historical record:', JSON.stringify(this.historicalTreasuries[0]));
    }
    if (this.recentTreasuries.length > 0) {
      console.log('[Treasury] Sample recent record keys:', Object.keys(this.recentTreasuries[0]));
      console.log('[Treasury] Sample recent record:', JSON.stringify(this.recentTreasuries[0]));
    }

    // First, add all historical data
    let historicalAdded = 0;
    for (const record of this.historicalTreasuries) {
      const cusip = this.extractCUSIP(record);
      if (cusip) {
        merged[cusip] = { ...record, _source: 'TREASURY_HISTORICAL' };
        historicalAdded++;
      }
    }
    console.log('[Treasury] Historical records added to merged:', historicalAdded);

    // Then, add recent data (overwrites historical if same CUSIP)
    let recentAdded = 0;
    for (const record of this.recentTreasuries) {
      const cusip = this.extractCUSIP(record);
      if (cusip) {
        merged[cusip] = { ...record, _source: 'TREASURY_FILE' };
        recentAdded++;
      }
    }
    console.log('[Treasury] Recent records added/updated in merged:', recentAdded);
    console.log('[Treasury] Final merged count:', Object.keys(merged).length);

    return Object.values(merged);
  }

  /**
   * Extract CUSIP from record (typically in 'CUSIP' or 'cusip' column)
   */
  extractCUSIP(record) {
    // Handle BOM and various column name variations
    // First check exact matches, then iterate keys to handle BOM prefix
    let cusip = record.CUSIP || record.cusip || record['CUSIP Number'] || record['cusip_number'];
    
    // If not found, search keys for one containing 'CUSIP' (handles BOM)
    if (!cusip) {
      const keys = Object.keys(record);
      for (const key of keys) {
        if (key.toUpperCase().includes('CUSIP') || key.endsWith('CUSIP')) {
          cusip = record[key];
          break;
        }
      }
    }
    
    return cusip ? cusip.trim() : null;
  }

  /**
   * Parse maturity date from treasury record
   * Tries multiple date formats and column names
   */
  parseMaturityDate(record) {
    // Try common column names for maturity date
    const maturityValue = record['Maturity Date'] || 
                         record['maturity_date'] || 
                         record['Maturity'] || 
                         record['maturity'];

    if (!maturityValue) return null;

    // Parse ISO format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(maturityValue)) {
      const parts = maturityValue.split('-');
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }

    // Parse MM/DD/YYYY format
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(maturityValue)) {
      const parts = maturityValue.split('/');
      return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
    }

    return null;
  }

  /**
   * Parse issue date from treasury record
   */
  parseIssueDate(record) {
    const issueValue = record['Issue Date'] || 
                      record['issue_date'] || 
                      record['Issue'] || 
                      record['issue'];

    if (!issueValue) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(issueValue)) {
      const parts = issueValue.split('-');
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }

    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(issueValue)) {
      const parts = issueValue.split('/');
      return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
    }

    return null;
  }

  /**
   * Extract security term (e.g., "4-Week", "10-Year", "30-Year")
   */
  extractSecurityTerm(record) {
    return record['Security Term'] || 
           record['security_term'] || 
           record['Term'] || 
           record['term'] ||
           null;
  }

  /**
   * Extract security type from record
   */
  extractSecurityType(record) {
    const secType = record['Security Type'] || 
                   record['security_type'] || 
                   record['Type'] || 
                   record['type'] ||
                   'TREASURY';

    return secType.toUpperCase().includes('BOND') ? 'BOND' : 'TREASURY';
  }

  /**
   * Format treasury name for display in autocomplete
   * Format: {SecurityType} {SecurityTerm} | Issue: {IssueDate} | Maturity: {MaturityDate}
   */
  formatTreasuryName(record) {
    const securityType = this.extractSecurityType(record);
    const securityTerm = this.extractSecurityTerm(record) || 'Treasury';
    const issueDate = this.formatDateForDisplay(this.parseIssueDate(record));
    const maturityDate = this.formatDateForDisplay(this.parseMaturityDate(record));

    return `${securityType} ${securityTerm} | Issue: ${issueDate} | Maturity: ${maturityDate}`;
  }

  /**
   * Format date for display (YYYY-MM-DD)
   */
  formatDateForDisplay(date) {
    if (!date) return 'Unknown';
    if (typeof date === 'string') {
      return date.substring(0, 10);
    }
    if (date instanceof Date) {
      return date.toISOString().substring(0, 10);
    }
    return 'Unknown';
  }

  /**
   * Filter out treasuries that matured more than N days ago
   */
  filterMaturedTreasuries(records, cutoffDays = null) {
    cutoffDays = cutoffDays || this.constructor.CONFIG.TREASURY_EXPIRY_CUTOFF_DAYS;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);

    return records.filter(record => {
      const maturityDate = this.parseMaturityDate(record);
      if (!maturityDate) {
        // If we can't parse the date, keep the record
        return true;
      }
      // Keep if maturity date is after cutoff
      return maturityDate > cutoffDate;
    });
  }

  /**
   * Convert treasury record to symbol registry format
   */
  treasuryToRegistryFormat(record, source) {
    const cusip = this.extractCUSIP(record);
    const maturityDate = this.parseMaturityDate(record);
    const issueDate = this.parseIssueDate(record);

    return {
      ticker: cusip,  // Used by processBatch to check existence
      symbol: cusip,  // Used by insertSymbol
      name: this.formatTreasuryName(record),
      exchange: 'OTC',
      security_type: this.extractSecurityType(record),
      source: source || record._source || 'TREASURY_FILE',
      has_yahoo_metadata: false,
      maturity_date: maturityDate ? this.formatDateForDisplay(maturityDate) : null,
      issue_date: issueDate ? this.formatDateForDisplay(issueDate) : null,
      security_term: this.extractSecurityTerm(record),
      usd_trading_volume: null
    };
  }

  /**
   * Process treasury data and return formatted records ready for symbol registry
   */
  async processTreasuries(cutoffDays = null) {
    if (this.mergedTreasuries.length === 0) {
      await this.loadTreasuryData();
    }

    const filtered = this.filterMaturedTreasuries(this.mergedTreasuries, cutoffDays);
    return filtered.map(record => this.treasuryToRegistryFormat(record));
  }

  /**
   * Get statistics about loaded treasury data
   */
  getStatistics() {
    return {
      recent_auctions_count: this.recentTreasuries.length,
      historical_auctions_count: this.historicalTreasuries.length,
      merged_count: this.mergedTreasuries.length,
      after_filtering: this.filterMaturedTreasuries(this.mergedTreasuries).length
    };
  }
}

module.exports = TreasuryDataHandler;
