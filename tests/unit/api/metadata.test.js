/**
 * Unit tests for API metadata helper functions
 * Tests validation logic without requiring full router or database
 */

describe('Metadata API Input Validation', () => {
  describe('Symbol validation', () => {
    const validateSymbol = (symbol) => {
      if (!symbol || typeof symbol !== 'string') return false;
      return /^[A-Z0-9]{1,10}(\.[A-Z])?$/.test(symbol.toUpperCase());
    };

    test('accepts valid symbols', () => {
      expect(validateSymbol('AAPL')).toBe(true);
      expect(validateSymbol('MSFT')).toBe(true);
      expect(validateSymbol('BRK.B')).toBe(true);
    });

    test('rejects invalid symbols', () => {
      expect(validateSymbol('')).toBe(false);
      expect(validateSymbol(null)).toBe(false);
      expect(validateSymbol(123)).toBe(false);
    });
  });

  describe('Symbol normalization', () => {
    const normalizeSymbol = (symbol) => {
      if (!symbol) return null;
      return String(symbol).toUpperCase().trim();
    };

    test('converts to uppercase', () => {
      expect(normalizeSymbol('aapl')).toBe('AAPL');
      expect(normalizeSymbol('AaPl')).toBe('AAPL');
    });

    test('trims whitespace', () => {
      expect(normalizeSymbol(' AAPL ')).toBe('AAPL');
      expect(normalizeSymbol('  MSFT  ')).toBe('MSFT');
    });

    test('handles null/undefined', () => {
      expect(normalizeSymbol(null)).toBeNull();
      expect(normalizeSymbol(undefined)).toBeNull();
      expect(normalizeSymbol('')).toBeNull();
    });
  });

  describe('Autocomplete query validation', () => {
    const validateAutocompleteQuery = (query) => {
      if (!query || typeof query !== 'string') return false;
      const trimmed = query.trim();
      return trimmed.length >= 1 && trimmed.length <= 50;
    };

    test('accepts valid queries', () => {
      expect(validateAutocompleteQuery('A')).toBe(true);
      expect(validateAutocompleteQuery('AAPL')).toBe(true);
      expect(validateAutocompleteQuery('Apple')).toBe(true);
    });

    test('rejects empty queries', () => {
      expect(validateAutocompleteQuery('')).toBe(false);
      expect(validateAutocompleteQuery('   ')).toBe(false);
    });

    test('rejects too long queries', () => {
      const longQuery = 'A'.repeat(51);
      expect(validateAutocompleteQuery(longQuery)).toBe(false);
    });

    test('rejects non-string queries', () => {
      expect(validateAutocompleteQuery(null)).toBe(false);
      expect(validateAutocompleteQuery(undefined)).toBe(false);
      expect(validateAutocompleteQuery(123)).toBe(false);
    });
  });

  describe('Batch prefetch validation', () => {
    const validateBatchRequest = (symbols) => {
      if (!Array.isArray(symbols)) return { valid: false, error: 'Symbols must be an array' };
      if (symbols.length === 0) return { valid: false, error: 'Symbols array cannot be empty' };
      if (symbols.length > 100) return { valid: false, error: 'Maximum 100 symbols allowed' };
      
      for (const symbol of symbols) {
        if (!symbol || typeof symbol !== 'string') {
          return { valid: false, error: 'All symbols must be strings' };
        }
      }
      
      return { valid: true };
    };

    test('accepts valid symbol arrays', () => {
      expect(validateBatchRequest(['AAPL', 'MSFT'])).toEqual({ valid: true });
      expect(validateBatchRequest(['AAPL'])).toEqual({ valid: true });
    });

    test('rejects non-arrays', () => {
      expect(validateBatchRequest('AAPL').valid).toBe(false);
      expect(validateBatchRequest(null).valid).toBe(false);
      expect(validateBatchRequest(undefined).valid).toBe(false);
    });

    test('rejects empty arrays', () => {
      expect(validateBatchRequest([]).valid).toBe(false);
    });

    test('rejects too many symbols', () => {
      const tooMany = new Array(101).fill('AAPL');
      expect(validateBatchRequest(tooMany).valid).toBe(false);
    });

    test('rejects invalid symbol types', () => {
      expect(validateBatchRequest(['AAPL', 123]).valid).toBe(false);
      expect(validateBatchRequest(['AAPL', null]).valid).toBe(false);
    });
  });

  describe('Metadata response formatting', () => {
    const formatMetadata = (raw) => {
      if (!raw) return null;
      
      return {
        symbol: raw.symbol,
        name: raw.long_name || raw.short_name,
        type: raw.quote_type,
        exchange: raw.exchange,
        currency: raw.currency,
        marketCap: raw.market_cap,
        dividendYield: raw.dividend_yield,
        trailingPE: raw.trailing_pe
      };
    };

    test('formats complete metadata correctly', () => {
      const raw = {
        symbol: 'AAPL',
        short_name: 'Apple Inc.',
        long_name: 'Apple Inc.',
        quote_type: 'EQUITY',
        exchange: 'NASDAQ',
        currency: 'USD',
        market_cap: 3000000000000,
        dividend_yield: 0.005,
        trailing_pe: 28.5
      };

      const formatted = formatMetadata(raw);
      expect(formatted.symbol).toBe('AAPL');
      expect(formatted.name).toBe('Apple Inc.');
      expect(formatted.type).toBe('EQUITY');
    });

    test('handles missing optional fields', () => {
      const minimal = {
        symbol: 'TEST',
        short_name: 'Test Corp',
        quote_type: 'EQUITY'
      };

      const formatted = formatMetadata(minimal);
      expect(formatted.symbol).toBe('TEST');
      expect(formatted.marketCap).toBeUndefined();
    });

    test('prefers long_name over short_name', () => {
      const raw = {
        symbol: 'AAPL',
        short_name: 'Apple',
        long_name: 'Apple Inc.',
        quote_type: 'EQUITY'
      };

      const formatted = formatMetadata(raw);
      expect(formatted.name).toBe('Apple Inc.');
    });

    test('handles null input', () => {
      expect(formatMetadata(null)).toBeNull();
      expect(formatMetadata(undefined)).toBeNull();
    });
  });
});
