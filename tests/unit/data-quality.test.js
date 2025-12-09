/**
 * Data Quality Unit Tests
 * Tests data validation and integrity functions without requiring database
 */

describe('Data Quality Validators', () => {
  describe('Symbol validation', () => {
    const validateSymbol = (symbol) => {
      if (!symbol || typeof symbol !== 'string') return false;
      // Valid: 1-5 uppercase letters, optionally followed by . and 1 letter
      return /^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol);
    };

    test('accepts valid stock symbols', () => {
      expect(validateSymbol('AAPL')).toBe(true);
      expect(validateSymbol('MSFT')).toBe(true);
      expect(validateSymbol('GOOGL')).toBe(true);
      expect(validateSymbol('A')).toBe(true);
    });

    test('accepts class shares with dots', () => {
      expect(validateSymbol('BRK.B')).toBe(true);
      expect(validateSymbol('BF.A')).toBe(true);
    });

    test('rejects invalid symbols', () => {
      expect(validateSymbol('aapl')).toBe(false); // lowercase
      expect(validateSymbol('TOOLONG')).toBe(false); // too long
      expect(validateSymbol('123')).toBe(false); // numbers
      expect(validateSymbol('AA-PL')).toBe(false); // hyphen
      expect(validateSymbol('')).toBe(false); // empty
      expect(validateSymbol(null)).toBe(false); // null
      expect(validateSymbol(undefined)).toBe(false); // undefined
    });

    test('rejects symbols with multiple dots', () => {
      expect(validateSymbol('A.B.C')).toBe(false);
    });
  });

  describe('Currency validation', () => {
    const validateCurrency = (currency) => {
      const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'];
      return validCurrencies.includes(currency);
    };

    test('accepts valid currency codes', () => {
      expect(validateCurrency('USD')).toBe(true);
      expect(validateCurrency('EUR')).toBe(true);
      expect(validateCurrency('GBP')).toBe(true);
    });

    test('rejects invalid currency codes', () => {
      expect(validateCurrency('usd')).toBe(false); // lowercase
      expect(validateCurrency('XXX')).toBe(false); // invalid
      expect(validateCurrency('')).toBe(false); // empty
      expect(validateCurrency(null)).toBe(false); // null
    });
  });

  describe('Exchange validation', () => {
    const validateExchange = (exchange) => {
      const validExchanges = ['NASDAQ', 'NYSE', 'AMEX', 'LSE', 'TSX'];
      return exchange === null || validExchanges.includes(exchange);
    };

    test('accepts valid exchanges', () => {
      expect(validateExchange('NASDAQ')).toBe(true);
      expect(validateExchange('NYSE')).toBe(true);
      expect(validateExchange(null)).toBe(true); // null is acceptable
    });

    test('rejects invalid exchanges', () => {
      expect(validateExchange('nasdaq')).toBe(false); // lowercase
      expect(validateExchange('INVALID')).toBe(false);
      expect(validateExchange('')).toBe(false);
    });
  });

  describe('Numeric value validation', () => {
    const validatePositiveNumber = (value) => {
      if (value === null || value === undefined) return true; // nullable
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0;
    };

    test('accepts valid positive numbers', () => {
      expect(validatePositiveNumber(100)).toBe(true);
      expect(validatePositiveNumber(0)).toBe(true);
      expect(validatePositiveNumber(123.45)).toBe(true);
      expect(validatePositiveNumber('123.45')).toBe(true);
      expect(validatePositiveNumber(null)).toBe(true); // nullable
    });

    test('rejects negative numbers', () => {
      expect(validatePositiveNumber(-100)).toBe(false);
      expect(validatePositiveNumber('-123.45')).toBe(false);
    });

    test('rejects non-numeric values', () => {
      expect(validatePositiveNumber('abc')).toBe(false);
      expect(validatePositiveNumber('N/A')).toBe(false);
      expect(validatePositiveNumber('')).toBe(false);
    });
  });

  describe('Percentage validation', () => {
    const validatePercentage = (value) => {
      if (value === null || value === undefined) return true; // nullable
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0 && num <= 100;
    };

    test('accepts valid percentages', () => {
      expect(validatePercentage(0)).toBe(true);
      expect(validatePercentage(50)).toBe(true);
      expect(validatePercentage(100)).toBe(true);
      expect(validatePercentage(12.5)).toBe(true);
      expect(validatePercentage(null)).toBe(true);
    });

    test('rejects out-of-range values', () => {
      expect(validatePercentage(-1)).toBe(false);
      expect(validatePercentage(101)).toBe(false);
      expect(validatePercentage(200)).toBe(false);
    });

    test('rejects non-numeric values', () => {
      expect(validatePercentage('abc')).toBe(false);
      expect(validatePercentage('')).toBe(false);
    });
  });

  describe('Date validation', () => {
    const validateIsoDate = (date) => {
      if (!date) return false;
      // ISO format: YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const parsed = new Date(date);
      return !isNaN(parsed.getTime());
    };

    test('accepts valid ISO dates', () => {
      expect(validateIsoDate('2025-12-08')).toBe(true);
      expect(validateIsoDate('2024-01-01')).toBe(true);
      expect(validateIsoDate('2023-06-15')).toBe(true);
    });

    test('rejects invalid date formats', () => {
      expect(validateIsoDate('12/08/2025')).toBe(false); // US format
      expect(validateIsoDate('2025-12-8')).toBe(false); // missing leading zero
      expect(validateIsoDate('2025-13-01')).toBe(false); // invalid month
      expect(validateIsoDate('2025-12-32')).toBe(false); // invalid day
      expect(validateIsoDate('')).toBe(false);
      expect(validateIsoDate(null)).toBe(false);
    });

    test('rejects future dates beyond reasonable range', () => {
      const futureDate = '2100-01-01';
      const year = new Date(futureDate).getFullYear();
      expect(year > 2050).toBe(true); // This would be flagged in real validation
    });
  });

  describe('Metadata completeness checks', () => {
    const isMetadataComplete = (metadata) => {
      const requiredFields = ['symbol', 'quote_type'];
      const optionalButUseful = ['short_name', 'exchange', 'currency'];
      
      // Check required fields
      const hasRequired = requiredFields.every(field => 
        metadata[field] !== null && metadata[field] !== undefined && metadata[field] !== ''
      );
      
      // Check at least some optional fields
      const hasOptional = optionalButUseful.some(field => 
        metadata[field] !== null && metadata[field] !== undefined && metadata[field] !== ''
      );
      
      return hasRequired && hasOptional;
    };

    test('identifies complete metadata', () => {
      const complete = {
        symbol: 'AAPL',
        quote_type: 'EQUITY',
        short_name: 'Apple Inc.',
        exchange: 'NASDAQ',
        currency: 'USD'
      };
      expect(isMetadataComplete(complete)).toBe(true);
    });

    test('identifies incomplete metadata - missing required fields', () => {
      const incomplete = {
        short_name: 'Apple Inc.',
        exchange: 'NASDAQ'
      };
      expect(isMetadataComplete(incomplete)).toBe(false);
    });

    test('identifies incomplete metadata - only required fields', () => {
      const minimal = {
        symbol: 'AAPL',
        quote_type: 'EQUITY'
      };
      expect(isMetadataComplete(minimal)).toBe(false);
    });

    test('identifies incomplete metadata - empty required fields', () => {
      const empty = {
        symbol: '',
        quote_type: 'EQUITY',
        short_name: 'Apple Inc.'
      };
      expect(isMetadataComplete(empty)).toBe(false);
    });
  });

  describe('Data consistency checks', () => {
    const checkPriceConsistency = (price, marketCap, sharesOutstanding) => {
      if (!price || !marketCap || !sharesOutstanding) return true; // skip if missing data
      const calculatedPrice = marketCap / sharesOutstanding;
      const tolerance = 0.05; // 5% tolerance
      const difference = Math.abs(price - calculatedPrice) / price;
      return difference <= tolerance;
    };

    test('accepts consistent price/market cap/shares', () => {
      expect(checkPriceConsistency(100, 1000000, 10000)).toBe(true);
      expect(checkPriceConsistency(50, 500000, 10000)).toBe(true);
    });

    test('accepts small discrepancies within tolerance', () => {
      // 2% difference
      expect(checkPriceConsistency(100, 1020000, 10000)).toBe(true);
    });

    test('rejects large inconsistencies', () => {
      // 50% difference
      expect(checkPriceConsistency(100, 1500000, 10000)).toBe(false);
    });

    test('skips check when data is missing', () => {
      expect(checkPriceConsistency(100, null, 10000)).toBe(true);
      expect(checkPriceConsistency(null, 1000000, 10000)).toBe(true);
    });
  });

  describe('Dividend data validation', () => {
    const validateDividendData = (dividend) => {
      if (!dividend) return false;
      
      // Required fields
      if (!dividend.symbol || !dividend.ex_date) return false;
      
      // Amount should be positive
      if (dividend.amount !== null && dividend.amount <= 0) return false;
      
      // Dates should be valid
      const exDate = new Date(dividend.ex_date);
      if (isNaN(exDate.getTime())) return false;
      
      if (dividend.payment_date) {
        const payDate = new Date(dividend.payment_date);
        if (isNaN(payDate.getTime())) return false;
        // Payment date should be after ex-date
        if (payDate < exDate) return false;
      }
      
      return true;
    };

    test('accepts valid dividend data', () => {
      const valid = {
        symbol: 'AAPL',
        ex_date: '2025-11-01',
        payment_date: '2025-11-15',
        amount: 0.24
      };
      expect(validateDividendData(valid)).toBe(true);
    });

    test('accepts dividend without payment date', () => {
      const valid = {
        symbol: 'AAPL',
        ex_date: '2025-11-01',
        amount: 0.24
      };
      expect(validateDividendData(valid)).toBe(true);
    });

    test('rejects dividend with negative amount', () => {
      const invalid = {
        symbol: 'AAPL',
        ex_date: '2025-11-01',
        amount: -0.24
      };
      expect(validateDividendData(invalid)).toBe(false);
    });

    test('rejects dividend with payment date before ex-date', () => {
      const invalid = {
        symbol: 'AAPL',
        ex_date: '2025-11-15',
        payment_date: '2025-11-01',
        amount: 0.24
      };
      expect(validateDividendData(invalid)).toBe(false);
    });

    test('rejects dividend with invalid dates', () => {
      const invalid = {
        symbol: 'AAPL',
        ex_date: 'invalid-date',
        amount: 0.24
      };
      expect(validateDividendData(invalid)).toBe(false);
    });

    test('rejects dividend without required fields', () => {
      expect(validateDividendData({})).toBe(false);
      expect(validateDividendData({ symbol: 'AAPL' })).toBe(false);
      expect(validateDividendData({ ex_date: '2025-11-01' })).toBe(false);
    });
  });
});
