/**
 * Unit Tests for TreasuryDataHandler
 */

const TreasuryDataHandler = require('../../../../services/symbol-registry/treasury_data_handler');
const path = require('path');
const fs = require('fs');

describe('TreasuryDataHandler', () => {
  let handler;
  
  beforeEach(() => {
    handler = new TreasuryDataHandler();
  });

  describe('Date Parsing', () => {
    test('parseMaturityDate should handle ISO format (YYYY-MM-DD)', () => {
      const record = { 'Maturity Date': '2025-12-31' };
      const date = handler.parseMaturityDate(record);
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2025);
      expect(date.getMonth()).toBe(11); // December
      expect(date.getDate()).toBe(31);
    });

    test('parseMaturityDate should handle MM/DD/YYYY format', () => {
      const record = { 'Maturity Date': '12/31/2025' };
      const date = handler.parseMaturityDate(record);
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2025);
      expect(date.getMonth()).toBe(11);
      expect(date.getDate()).toBe(31);
    });

    test('parseMaturityDate should return null for missing date', () => {
      const record = { other_field: 'value' };
      const date = handler.parseMaturityDate(record);
      expect(date).toBeNull();
    });

    test('parseMaturityDate should handle alternative column names', () => {
      const record = { 'maturity_date': '2025-06-30' };
      const date = handler.parseMaturityDate(record);
      expect(date).toBeInstanceOf(Date);
      expect(date.getMonth()).toBe(5); // June
    });

    test('parseIssueDate should parse issue dates correctly', () => {
      const record = { 'Issue Date': '2024-01-15' };
      const date = handler.parseIssueDate(record);
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(0); // January
      expect(date.getDate()).toBe(15);
    });
  });

  describe('CUSIP Extraction', () => {
    test('extractCUSIP should extract from CUSIP column', () => {
      const record = { CUSIP: '912810 QC 0' };
      const cusip = handler.extractCUSIP(record);
      expect(cusip).toBe('912810 QC 0');
    });

    test('extractCUSIP should handle lowercase cusip', () => {
      const record = { cusip: '912828 QC 0' };
      const cusip = handler.extractCUSIP(record);
      expect(cusip).toBe('912828 QC 0');
    });

    test('extractCUSIP should return null for missing CUSIP', () => {
      const record = { other_field: 'value' };
      const cusip = handler.extractCUSIP(record);
      expect(cusip).toBeNull();
    });

    test('extractCUSIP should trim whitespace', () => {
      const record = { CUSIP: '  912810 QC 0  ' };
      const cusip = handler.extractCUSIP(record);
      expect(cusip).toBe('912810 QC 0');
    });
  });

  describe('Security Term Extraction', () => {
    test('extractSecurityTerm should extract from Security Term column', () => {
      const record = { 'Security Term': '4-Week' };
      const term = handler.extractSecurityTerm(record);
      expect(term).toBe('4-Week');
    });

    test('extractSecurityTerm should handle alternative column names', () => {
      const record = { 'security_term': '10-Year' };
      const term = handler.extractSecurityTerm(record);
      expect(term).toBe('10-Year');
    });

    test('extractSecurityTerm should return null when missing', () => {
      const record = { other_field: 'value' };
      const term = handler.extractSecurityTerm(record);
      expect(term).toBeNull();
    });
  });

  describe('Security Type Extraction', () => {
    test('extractSecurityType should return TREASURY for regular bonds', () => {
      const record = { 'Security Type': 'Bill' };
      const type = handler.extractSecurityType(record);
      expect(type).toBe('TREASURY');
    });

    test('extractSecurityType should return TREASURY for notes', () => {
      const record = { 'Security Type': 'Note' };
      const type = handler.extractSecurityType(record);
      expect(type).toBe('TREASURY');
    });

    test('extractSecurityType should return BOND for bonds', () => {
      const record = { 'Security Type': 'Bond' };
      const type = handler.extractSecurityType(record);
      expect(type).toBe('BOND');
    });

    test('extractSecurityType should be case insensitive', () => {
      const record = { 'Security Type': 'BOND' };
      const type = handler.extractSecurityType(record);
      expect(type).toBe('BOND');
    });
  });

  describe('Treasury Name Formatting', () => {
    test('formatTreasuryName should create properly formatted name', () => {
      const record = {
        'Security Type': 'Note',
        'Security Term': '10-Year',
        'Issue Date': '2024-01-15',
        'Maturity Date': '2034-01-15'
      };
      const name = handler.formatTreasuryName(record);
      expect(name).toContain('TREASURY');
      expect(name).toContain('10-Year');
      expect(name).toContain('2024-01-15');
      expect(name).toContain('2034-01-15');
    });

    test('formatTreasuryName should handle missing dates', () => {
      const record = {
        'Security Type': 'Bill',
        'Security Term': '4-Week'
      };
      const name = handler.formatTreasuryName(record);
      expect(name).toContain('TREASURY');
      expect(name).toContain('4-Week');
      expect(name).toContain('Unknown');
    });
  });

  describe('Date Formatting for Display', () => {
    test('formatDateForDisplay should handle Date objects', () => {
      const date = new Date('2025-12-31');
      const formatted = handler.formatDateForDisplay(date);
      expect(formatted).toBe('2025-12-31');
    });

    test('formatDateForDisplay should handle ISO strings', () => {
      const formatted = handler.formatDateForDisplay('2025-12-31T00:00:00Z');
      expect(formatted).toBe('2025-12-31');
    });

    test('formatDateForDisplay should return Unknown for null', () => {
      const formatted = handler.formatDateForDisplay(null);
      expect(formatted).toBe('Unknown');
    });
  });

  describe('Treasury Filtering', () => {
    test('filterMaturedTreasuries should keep treasuries within cutoff', () => {
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 90); // 90 days in future

      const record = { 'Maturity Date': futureDate.toISOString().split('T')[0] };
      const filtered = handler.filterMaturedTreasuries([record], 59);
      expect(filtered.length).toBe(1);
    });

    test('filterMaturedTreasuries should remove treasuries past cutoff', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 100); // 100 days in past

      const record = { 'Maturity Date': pastDate.toISOString().split('T')[0] };
      const filtered = handler.filterMaturedTreasuries([record], 59);
      expect(filtered.length).toBe(0);
    });

    test('filterMaturedTreasuries should use default cutoff of 59 days', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 60); // Just past default cutoff

      const record = { 'Maturity Date': pastDate.toISOString().split('T')[0] };
      const filtered = handler.filterMaturedTreasuries([record]);
      expect(filtered.length).toBe(0);
    });

    test('filterMaturedTreasuries should keep records with unparseable dates', () => {
      const record = { 'Maturity Date': 'invalid-date' };
      const filtered = handler.filterMaturedTreasuries([record], 59);
      expect(filtered.length).toBe(1);
    });

    test('filterMaturedTreasuries should handle edge case at exactly cutoff boundary', () => {
      const boundaryDate = new Date();
      boundaryDate.setDate(boundaryDate.getDate() - 59); // Exactly 59 days

      const record = { 'Maturity Date': boundaryDate.toISOString().split('T')[0] };
      const filtered = handler.filterMaturedTreasuries([record], 59);
      // At boundary, should still filter out (59 days ago is considered matured)
      expect(filtered.length).toBe(0);
    });
  });

  describe('Registry Format Conversion', () => {
    test('treasuryToRegistryFormat should convert treasury record correctly', () => {
      const record = {
        CUSIP: '912810 QC 0',
        'Security Type': 'Bill',
        'Security Term': '4-Week',
        'Issue Date': '2024-12-09',
        'Maturity Date': '2025-01-06'
      };

      const formatted = handler.treasuryToRegistryFormat(record, 'TREASURY_FILE');
      
      expect(formatted.symbol).toBe('912810 QC 0');
      expect(formatted.exchange).toBe('OTC');
      expect(formatted.security_type).toBe('TREASURY');
      expect(formatted.source).toBe('TREASURY_FILE');
      expect(formatted.has_yahoo_metadata).toBe(false);
      expect(formatted.maturity_date).toBe('2025-01-06');
      expect(formatted.issue_date).toBe('2024-12-09');
      expect(formatted.security_term).toBe('4-Week');
      expect(formatted.name).toContain('4-Week');
    });

    test('treasuryToRegistryFormat should use record source if not provided', () => {
      const record = {
        CUSIP: '912828 QC 0',
        _source: 'TREASURY_HISTORICAL',
        'Security Type': 'Note',
        'Security Term': '10-Year',
        'Issue Date': '2024-01-15',
        'Maturity Date': '2034-01-15'
      };

      const formatted = handler.treasuryToRegistryFormat(record);
      expect(formatted.source).toBe('TREASURY_HISTORICAL');
    });
  });

  describe('Statistics', () => {
    test('getStatistics should return zero counts when no data loaded', () => {
      const stats = handler.getStatistics();
      expect(stats.recent_auctions_count).toBe(0);
      expect(stats.historical_auctions_count).toBe(0);
      expect(stats.merged_count).toBe(0);
      expect(stats.after_filtering).toBe(0);
    });

    test('getStatistics should reflect loaded data', () => {
      handler.recentTreasuries = [{ CUSIP: '1' }, { CUSIP: '2' }];
      handler.historicalTreasuries = [{ CUSIP: '3' }];
      handler.mergedTreasuries = [{ CUSIP: '1' }, { CUSIP: '2' }, { CUSIP: '3' }];

      const stats = handler.getStatistics();
      expect(stats.recent_auctions_count).toBe(2);
      expect(stats.historical_auctions_count).toBe(1);
      expect(stats.merged_count).toBe(3);
    });
  });

  describe('Treasury Merging', () => {
    test('mergeTreasuryData should prefer recent data over historical', () => {
      handler.recentTreasuries = [{ CUSIP: '912810 QC 0', 'Issue Date': '2024-12-09', _source: 'recent' }];
      handler.historicalTreasuries = [{ CUSIP: '912810 QC 0', 'Issue Date': '2020-01-01', _source: 'historical' }];
      
      const merged = handler.mergeTreasuryData();
      expect(merged.length).toBe(1);
      expect(merged[0]._source).toBe('TREASURY_FILE');
    });

    test('mergeTreasuryData should combine unique treasuries from both sources', () => {
      handler.recentTreasuries = [{ CUSIP: '912810 QC 0', _source: 'recent' }];
      handler.historicalTreasuries = [{ CUSIP: '912828 QC 0', _source: 'historical' }];
      
      const merged = handler.mergeTreasuryData();
      expect(merged.length).toBe(2);
    });

    test('mergeTreasuryData should skip records without CUSIP', () => {
      handler.recentTreasuries = [{ 'Issue Date': '2024-12-09' }]; // No CUSIP
      handler.historicalTreasuries = [{ CUSIP: '912810 QC 0' }];
      
      const merged = handler.mergeTreasuryData();
      expect(merged.length).toBe(1);
      expect(merged[0].CUSIP).toBe('912810 QC 0');
    });
  });
});
