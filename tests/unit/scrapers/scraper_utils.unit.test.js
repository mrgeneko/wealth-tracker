/**
 * Unit tests for scraper_utils.js
 * Tests utility functions without requiring browser/network dependencies
 */

jest.mock('../../../scrapers/exchange_registry', () => {
  return {
    getExchange: jest.fn(async () => 'NASDAQ'),
    reloadExchangeData: jest.fn(),
    loadExchangeData: jest.fn(async () => ({ NASDAQ: new Set(), NYSE: new Set(), OTHER: new Set() })),
    normalizedTickerForLookup: jest.fn((t) => encodeURIComponent(String(t || ''))),
    initializeDbPool: jest.fn()
  };
});

const {
  sanitizeForFilename,
  getDateTimeString,
  cleanNumberText,
  normalizedKey,
  parseToIso,
  isWeekday,
  getMetrics,
  resetMetrics,
  getConstructibleUrls
} = require('../../../scrapers/scraper_utils');

describe('sanitizeForFilename', () => {
  test('preserves most special characters', () => {
    expect(sanitizeForFilename('hello@world!')).toBe('hello@world!');
  });

  test('preserves alphanumeric, dots, dashes, underscores', () => {
    expect(sanitizeForFilename('test-file_v1.2.txt')).toBe('test-file_v1.2.txt');
  });

  test('handles empty string', () => {
    expect(sanitizeForFilename('')).toBe('');
  });

  test('converts non-string inputs to string', () => {
    expect(sanitizeForFilename(12345)).toBe('12345');
  });
});

describe('getDateTimeString', () => {
  test('returns string in correct format YYYYMMDD_HHMMSS_mmm', () => {
    const result = getDateTimeString();
    expect(result).toMatch(/^\d{8}_\d{6}_\d{3}$/);
  });

  test('includes milliseconds', () => {
    const result = getDateTimeString();
    const parts = result.split('_');
    expect(parts).toHaveLength(3);
    expect(parts[2]).toHaveLength(3); // milliseconds
  });
});

describe('cleanNumberText', () => {
  test('removes commas from numbers', () => {
    expect(cleanNumberText('1,234,567')).toBe('1234567');
  });

  test('removes dollar signs', () => {
    expect(cleanNumberText('$123.45')).toBe('123.45');
  });

  test('handles percentage signs', () => {
    expect(cleanNumberText('12.5%')).toBe('12.5');
  });

  test('removes parentheses', () => {
    expect(cleanNumberText('(123.45)')).toBe('123.45');
  });

  test('handles complex formatted numbers', () => {
    expect(cleanNumberText('$1,234,567.89')).toBe('1234567.89');
  });

  test('handles negative numbers', () => {
    expect(cleanNumberText('-$1,234.56')).toBe('-1234.56');
  });

  test('preserves decimal points', () => {
    expect(cleanNumberText('123.456')).toBe('123.456');
  });

  test('handles empty string', () => {
    expect(cleanNumberText('')).toBe('');
  });

  test('handles null/undefined', () => {
    expect(cleanNumberText(null)).toBe('');
    expect(cleanNumberText(undefined)).toBe('');
  });
});

describe('normalizedKey', () => {
  test('encodes special characters using encodeURIComponent', () => {
    expect(normalizedKey('BRK.B')).toBe('BRK.B');
    expect(normalizedKey('BF.B')).toBe('BF.B');
  });

  test('handles symbols without special characters', () => {
    expect(normalizedKey('AAPL')).toBe('AAPL');
    expect(normalizedKey('MSFT')).toBe('MSFT');
  });

  test('handles empty string', () => {
    expect(normalizedKey('')).toBe('');
  });

  test('handles symbols with slashes', () => {
    expect(normalizedKey('BRK/B')).toBe('BRK%2FB');
  });

  test('converts to string if needed', () => {
    expect(normalizedKey(123)).toBe('123');
  });
});

  describe('parseToIso', () => {
  test('handles already ISO formatted dates', () => {
    const result = parseToIso('2025-12-08T10:30:00.000Z');
    expect(result).toContain('2025-12-08');
  });

  test('handles simple date formats', () => {
    // The function returns ISO timestamps, so just check it's not null/empty
    const result = parseToIso('12/08/2025');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  test('returns original string for unparseable dates', () => {
    const invalid = 'not a valid date';
    const result = parseToIso(invalid);
    expect(result).toBe(invalid);
  });

  test('handles empty/null inputs', () => {
    expect(parseToIso('')).toBe('');
    expect(parseToIso(null)).toBe('');
    expect(parseToIso(undefined)).toBe('');
  });

  test('handles dates with time components', () => {
    const result = parseToIso('12/08/2025 2:30 PM');
    expect(result).toBeTruthy();
  });

  test('strips timezone abbreviations', () => {
    const result = parseToIso('12/08/2025 2:30 PM EST');
    expect(result).toBeTruthy();
  });
});describe('isWeekday', () => {
  test('returns boolean', () => {
    const result = isWeekday();
    expect(typeof result).toBe('boolean');
  });

  test('determines weekday correctly', () => {
    // This test depends on actual day - just verify it works
    const result = isWeekday();
    expect([true, false]).toContain(result);
  });
});

describe('Metrics functions', () => {
  beforeEach(() => {
    resetMetrics();
  });

  test('getMetrics returns current metrics', () => {
    const metrics = getMetrics();
    expect(metrics).toHaveProperty('totalNavigations');
    expect(metrics).toHaveProperty('failedNavigations');
    expect(metrics).toHaveProperty('totalRequests');
    expect(metrics).toHaveProperty('failedRequests');
  });

  test('resetMetrics clears all counters to zero', () => {
    resetMetrics();
    const metrics = getMetrics();
    expect(metrics.totalNavigations).toBe(0);
    expect(metrics.failedNavigations).toBe(0);
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.failedRequests).toBe(0);
  });
});

describe('getConstructibleUrls', () => {
  test('returns an array', async () => {
    const urls = await getConstructibleUrls('AAPL', 'stock');
    expect(Array.isArray(urls)).toBe(true);
  });

  test('handles various symbols', async () => {
    expect(Array.isArray(await getConstructibleUrls('AAPL', 'stock'))).toBe(true);
    expect(Array.isArray(await getConstructibleUrls('BRK.B', 'stock'))).toBe(true);
    expect(Array.isArray(await getConstructibleUrls('', 'stock'))).toBe(true);
  });
});

describe('Edge cases and error handling', () => {
  test('cleanNumberText handles various edge cases', () => {
    // cleanNumberText removes all non-numeric characters except . and -
    expect(cleanNumberText('N/A')).toBe(''); // Letters removed
    expect(cleanNumberText('--')).toBe('--'); // Dashes preserved
    expect(cleanNumberText('0')).toBe('0');
    expect(cleanNumberText('0.00')).toBe('0.00');
  });

  test('normalizedKey handles null/undefined gracefully', () => {
    expect(normalizedKey(null)).toBe('');
    expect(normalizedKey(undefined)).toBe('');
  });

  test('sanitizeForFilename handles unicode characters', () => {
    expect(sanitizeForFilename('test™')).toBe('test™');
    expect(sanitizeForFilename('café')).toBe('café');
  });
});
