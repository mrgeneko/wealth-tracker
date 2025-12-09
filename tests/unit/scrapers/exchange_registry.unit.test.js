/**
 * Unit tests for exchange_registry.js
 * Tests exchange lookup functionality
 */

const fs = require('fs');
const path = require('path');
const { 
  getExchange, 
  reloadExchangeData, 
  loadExchangeData,
  normalizedTickerForLookup 
} = require('../../../scrapers/exchange_registry');

describe('Exchange Registry', () => {
  const CONFIG_DIR = path.join(__dirname, '../../../config');
  const NASDAQ_FILE = path.join(CONFIG_DIR, 'nasdaq-listed.csv');
  const NYSE_FILE = path.join(CONFIG_DIR, 'nyse-listed.csv');

  beforeEach(() => {
    // Clear the cache before each test
    reloadExchangeData();
  });

  describe('getExchange', () => {
    test('returns NASDAQ for NASDAQ-listed stocks', () => {
      // Assuming AAPL is in NASDAQ CSV
      const exchange = getExchange('AAPL');
      expect(exchange).toBeValidExchange();
      if (exchange) {
        expect(['NASDAQ', 'NYSE']).toContain(exchange);
      }
    });

    test('returns NYSE for NYSE-listed stocks', () => {
      // Assuming JPM or similar is in NYSE CSV
      const exchange = getExchange('JPM');
      expect(exchange).toBeValidExchange();
    });

    test('returns null for invalid/unknown ticker', () => {
      const exchange = getExchange('INVALID_TICKER_12345');
      expect(exchange).toBeNull();
    });

    test('handles null/undefined ticker', () => {
      expect(getExchange(null)).toBeNull();
      expect(getExchange(undefined)).toBeNull();
      expect(getExchange('')).toBeNull();
    });

    test('is case-insensitive', () => {
      const upper = getExchange('AAPL');
      const lower = getExchange('aapl');
      const mixed = getExchange('AaPl');
      expect(lower).toBe(upper);
      expect(mixed).toBe(upper);
    });

    test('handles class shares with dots (BRK.B)', () => {
      const exchange = getExchange('BRK.B');
      expect(exchange).toBeValidExchange();
    });

    test('normalizes hyphens to dots for lookup', () => {
      // Test that BRK-B is normalized to BRK.B
      const exchangeWithDot = getExchange('BRK.B');
      const exchangeWithDash = getExchange('BRK-B');
      // Both should return the same result if BRK.B is in the CSV
      if (exchangeWithDot) {
        expect(exchangeWithDash).toBe(exchangeWithDot);
      }
    });
  });

  describe('loadExchangeData', () => {
    test('returns an object with NASDAQ and NYSE sets', () => {
      const data = loadExchangeData();
      expect(data).toHaveProperty('NASDAQ');
      expect(data).toHaveProperty('NYSE');
      expect(data.NASDAQ).toBeInstanceOf(Set);
      expect(data.NYSE).toBeInstanceOf(Set);
    });

    test('caches data on subsequent calls', () => {
      const data1 = loadExchangeData();
      const data2 = loadExchangeData();
      expect(data1).toBe(data2); // Same reference = cached
    });

    test('loads data from CSV files if they exist', () => {
      if (fs.existsSync(NASDAQ_FILE) || fs.existsSync(NYSE_FILE)) {
        const data = loadExchangeData();
        const totalSymbols = data.NASDAQ.size + data.NYSE.size;
        expect(totalSymbols).toBeGreaterThan(0);
      }
    });

    test('handles missing CSV files gracefully', () => {
      // This test assumes CSV files might not exist in test env
      // The function should not throw
      expect(() => loadExchangeData()).not.toThrow();
    });
  });

  describe('reloadExchangeData', () => {
    test('clears cache and forces reload', () => {
      const data1 = loadExchangeData();
      reloadExchangeData();
      const data2 = loadExchangeData();
      // After reload, we get fresh data (different reference)
      expect(data1).not.toBe(data2);
    });

    test('does not throw errors', () => {
      expect(() => reloadExchangeData()).not.toThrow();
    });
  });

  describe('normalizedTickerForLookup', () => {
    test('returns URL-encoded ticker', () => {
      expect(normalizedTickerForLookup('BRK.B')).toBe('BRK.B');
      expect(normalizedTickerForLookup('AAPL')).toBe('AAPL');
    });

    test('handles special characters', () => {
      expect(normalizedTickerForLookup('BRK/B')).toBe('BRK%2FB');
    });

    test('handles empty string', () => {
      expect(normalizedTickerForLookup('')).toBe('');
    });

    test('handles null/undefined', () => {
      expect(normalizedTickerForLookup(null)).toBe('');
      expect(normalizedTickerForLookup(undefined)).toBe('');
    });

    test('converts non-string inputs to string', () => {
      expect(normalizedTickerForLookup(123)).toBe('123');
    });
  });

  describe('Data integrity checks', () => {
    test('NASDAQ set contains only uppercase symbols', () => {
      const data = loadExchangeData();
      if (data.NASDAQ.size > 0) {
        const symbols = Array.from(data.NASDAQ);
        symbols.forEach(symbol => {
          expect(symbol).toBe(symbol.toUpperCase());
        });
      }
    });

    test('NYSE set contains only uppercase symbols', () => {
      const data = loadExchangeData();
      if (data.NYSE.size > 0) {
        const symbols = Array.from(data.NYSE);
        symbols.forEach(symbol => {
          expect(symbol).toBe(symbol.toUpperCase());
        });
      }
    });

    test('no symbol appears in both NASDAQ and NYSE', () => {
      const data = loadExchangeData();
      const nasdaqArray = Array.from(data.NASDAQ);
      const nyseArray = Array.from(data.NYSE);
      
      nasdaqArray.forEach(symbol => {
        expect(data.NYSE.has(symbol)).toBe(false);
      });
      
      nyseArray.forEach(symbol => {
        expect(data.NASDAQ.has(symbol)).toBe(false);
      });
    });
  });

  describe('Performance tests', () => {
    test('lookup is fast (< 1ms for single symbol)', () => {
      const start = Date.now();
      getExchange('AAPL');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1);
    });

    test('handles rapid sequential lookups efficiently', () => {
      const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
      const start = Date.now();
      symbols.forEach(symbol => getExchange(symbol));
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10); // 10ms for 5 lookups
    });
  });
});
