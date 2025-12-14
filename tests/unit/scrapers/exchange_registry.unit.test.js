/**
 * Unit tests for exchange_registry.js
 * Tests DB-backed exchange lookup functionality
 */

const {
  getExchange,
  reloadExchangeData,
  loadExchangeData,
  normalizedTickerForLookup,
  initializeDbPool
} = require('../../../scrapers/exchange_registry');

describe('Exchange Registry', () => {
  let pool;
  let connection;

  const seededRows = [
    { ticker: 'AAPL', exchange: 'NASDAQ' },
    { ticker: 'BRK.B', exchange: 'NYSE' },
    { ticker: 'JPM', exchange: 'NYSE' },
    { ticker: 'VTI', exchange: 'OTHER' }
  ];

  beforeEach(() => {
    connection = {
      query: jest.fn().mockResolvedValue([seededRows]),
      release: jest.fn()
    };
    pool = {
      getConnection: jest.fn().mockResolvedValue(connection)
    };

    initializeDbPool(pool);
    reloadExchangeData();
  });

  describe('getExchange', () => {
    test('returns NASDAQ for NASDAQ-listed stocks', async () => {
      const exchange = await getExchange('AAPL');
      expect(exchange).toBe('NASDAQ');
      expect(exchange).toBeValidExchange();
    });

    test('returns NYSE for NYSE-listed stocks', async () => {
      const exchange = await getExchange('JPM');
      expect(exchange).toBe('NYSE');
      expect(exchange).toBeValidExchange();
    });

    test('returns OTHER for OTHER-listed stocks', async () => {
      const exchange = await getExchange('VTI');
      expect(exchange).toBe('OTHER');
      expect(exchange).toBeValidExchange();
    });

    test('returns null for invalid/unknown ticker', async () => {
      const exchange = await getExchange('INVALID_TICKER_12345');
      expect(exchange).toBeNull();
    });

    test('handles null/undefined ticker', async () => {
      await expect(getExchange(null)).resolves.toBeNull();
      await expect(getExchange(undefined)).resolves.toBeNull();
      await expect(getExchange('')).resolves.toBeNull();
    });

    test('is case-insensitive', async () => {
      const upper = await getExchange('AAPL');
      const lower = await getExchange('aapl');
      const mixed = await getExchange('AaPl');
      expect(lower).toBe(upper);
      expect(mixed).toBe(upper);
    });

    test('handles class shares with dots (BRK.B)', async () => {
      const exchange = await getExchange('BRK.B');
      expect(exchange).toBe('NYSE');
      expect(exchange).toBeValidExchange();
    });

    test('normalizes hyphens to dots for lookup', async () => {
      const exchangeWithDot = await getExchange('BRK.B');
      const exchangeWithDash = await getExchange('BRK-B');
      expect(exchangeWithDash).toBe(exchangeWithDot);
    });
  });

  describe('loadExchangeData', () => {
    test('returns an object with NASDAQ/NYSE/OTHER sets', async () => {
      const data = await loadExchangeData();
      expect(data).toHaveProperty('NASDAQ');
      expect(data).toHaveProperty('NYSE');
      expect(data).toHaveProperty('OTHER');
      expect(data.NASDAQ).toBeInstanceOf(Set);
      expect(data.NYSE).toBeInstanceOf(Set);
      expect(data.OTHER).toBeInstanceOf(Set);
    });

    test('caches data on subsequent calls', async () => {
      const data1 = await loadExchangeData();
      const data2 = await loadExchangeData();
      expect(data1).toBe(data2); // Same reference = cached
    });

    test('queries DB only once due to caching', async () => {
      await loadExchangeData();
      await loadExchangeData();
      expect(pool.getConnection).toHaveBeenCalledTimes(1);
      expect(connection.query).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('reloadExchangeData', () => {
    test('clears cache and forces reload', async () => {
      const data1 = await loadExchangeData();
      reloadExchangeData();
      const data2 = await loadExchangeData();
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
    test('NASDAQ set contains only uppercase symbols', async () => {
      const data = await loadExchangeData();
      if (data.NASDAQ.size > 0) {
        const symbols = Array.from(data.NASDAQ);
        symbols.forEach(symbol => {
          expect(symbol).toBe(symbol.toUpperCase());
        });
      }
    });

    test('NYSE set contains only uppercase symbols', async () => {
      const data = await loadExchangeData();
      if (data.NYSE.size > 0) {
        const symbols = Array.from(data.NYSE);
        symbols.forEach(symbol => {
          expect(symbol).toBe(symbol.toUpperCase());
        });
      }
    });

    test('no symbol appears in both NASDAQ and NYSE', async () => {
      const data = await loadExchangeData();
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
});
