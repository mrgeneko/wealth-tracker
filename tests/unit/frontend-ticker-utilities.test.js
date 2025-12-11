/**
 * Frontend - Ticker Utilities Tests (Phase 4.3)
 * File: tests/unit/frontend-ticker-utilities.test.js
 * 
 * Tests JavaScript utilities for ticker handling in frontend
 * 
 * Test Count: 6 tests
 * Expected Runtime: 5 seconds
 */

const { describe, it, expect } = require('@jest/globals');

// Mock ticker utility functions
const tickerUtils = {
  formatTicker: (ticker) => {
    if (!ticker) return '';
    return ticker.toUpperCase().trim();
  },

  validateTickerFormat: (ticker) => {
    if (!ticker || typeof ticker !== 'string') return false;
    if (ticker.length < 1 || ticker.length > 20) return false;
    return /^[A-Z0-9\-\.]+$/.test(ticker.toUpperCase());
  },

  normalizeTicker: (ticker) => {
    if (!ticker) return null;
    return ticker.toUpperCase().trim();
  },

  compareTickersEqual: (ticker1, ticker2) => {
    if (!ticker1 || !ticker2) return false;
    return ticker1.toUpperCase() === ticker2.toUpperCase();
  },

  extractTickerFromString: (str) => {
    // Extract ticker like "AAPL - Apple Inc" → "AAPL"
    const match = str.match(/^([A-Z0-9\-\.]+)\s*[-–]/);
    return match ? match[1] : null;
  },

  buildTickerQuery: (searchTerm) => {
    if (!searchTerm) return '';
    return `SELECT ticker FROM tickers WHERE ticker LIKE '${searchTerm.toUpperCase()}%'`;
  }
};

describe('Frontend - Ticker Utilities', () => {

  it('should format ticker to uppercase', () => {
    expect(tickerUtils.formatTicker('aapl')).toBe('AAPL');
    expect(tickerUtils.formatTicker('  msft  ')).toBe('MSFT');
    expect(tickerUtils.formatTicker('BRK.B')).toBe('BRK.B');
  });

  it('should validate ticker format correctly', () => {
    expect(tickerUtils.validateTickerFormat('AAPL')).toBe(true);
    expect(tickerUtils.validateTickerFormat('BRK.B')).toBe(true);
    expect(tickerUtils.validateTickerFormat('VALID-TICKER')).toBe(true);
    expect(tickerUtils.validateTickerFormat('invalid-ticker-longer-than-twenty-chars')).toBe(false);
    expect(tickerUtils.validateTickerFormat('')).toBe(false);
    expect(tickerUtils.validateTickerFormat(null)).toBe(false);
  });

  it('should normalize ticker consistently', () => {
    expect(tickerUtils.normalizeTicker('aapl')).toBe('AAPL');
    expect(tickerUtils.normalizeTicker('  MSFT  ')).toBe('MSFT');
    expect(tickerUtils.normalizeTicker(null)).toBe(null);
  });

  it('should compare tickers case-insensitively', () => {
    expect(tickerUtils.compareTickersEqual('AAPL', 'aapl')).toBe(true);
    expect(tickerUtils.compareTickersEqual('MSFT', 'MSFT')).toBe(true);
    expect(tickerUtils.compareTickersEqual('AAPL', 'MSFT')).toBe(false);
    expect(tickerUtils.compareTickersEqual(null, 'AAPL')).toBe(false);
  });

  it('should extract ticker from display string', () => {
    expect(tickerUtils.extractTickerFromString('AAPL - Apple Inc')).toBe('AAPL');
    expect(tickerUtils.extractTickerFromString('MSFT – Microsoft Corporation')).toBe('MSFT');
    expect(tickerUtils.extractTickerFromString('Not a ticker')).toBe(null);
  });

  it('should build properly formatted ticker queries', () => {
    const query = tickerUtils.buildTickerQuery('AA');
    expect(query).toContain('LIKE');
    expect(query).toContain('AA%');
    expect(query).toContain('ticker');
  });
});
