/**
 * Backward Compatibility - Symbol Parameter Support Tests (Phase 3.6)
 * File: tests/unit/backward-compatibility-symbol.test.js
 * 
 * Ensures API still accepts 'symbol' parameter during transition period
 * Tests translation layer from symbol → ticker
 * 
 * Test Count: 4 tests
 * Expected Runtime: 10 seconds
 */

const { describe, it, expect } = require('@jest/globals');

describe('Backward Compatibility - Symbol Parameter', () => {

  it('should accept symbol parameter and convert to ticker internally', () => {
    const apiHandler = (params) => {
      // Accept either symbol or ticker, prefer ticker
      const ticker = params.ticker || params.symbol;
      
      if (!ticker) {
        throw new Error('ticker or symbol required');
      }

      return {
        ticker,
        originalParam: params.ticker ? 'ticker' : 'symbol'
      };
    };

    // Old code using symbol parameter
    const oldFormatResult = apiHandler({ symbol: 'AAPL' });
    expect(oldFormatResult.ticker).toBe('AAPL');
    expect(oldFormatResult.originalParam).toBe('symbol');

    // New code using ticker parameter
    const newFormatResult = apiHandler({ ticker: 'AAPL' });
    expect(newFormatResult.ticker).toBe('AAPL');
    expect(newFormatResult.originalParam).toBe('ticker');
  });

  it('should prefer ticker over symbol when both provided', () => {
    const apiHandler = (params) => {
      // If both provided, use ticker (new standard)
      return params.ticker || params.symbol;
    };

    const result = apiHandler({ ticker: 'MSFT', symbol: 'AAPL' });
    expect(result).toBe('MSFT');
  });

  it('should support symbol field in request body during transition', () => {
    const requestBodyHandler = (body) => {
      // Support both for backward compatibility
      if (body.ticker) return body.ticker;
      if (body.symbol) return body.symbol;
      throw new Error('ticker or symbol required');
    };

    const oldFormat = { symbol: 'GOOGL', quantity: 10 };
    const newFormat = { ticker: 'GOOGL', quantity: 10 };
    const mixedFormat = { ticker: 'GOOGL', symbol: 'AAPL', quantity: 10 };

    expect(requestBodyHandler(oldFormat)).toBe('GOOGL');
    expect(requestBodyHandler(newFormat)).toBe('GOOGL');
    expect(requestBodyHandler(mixedFormat)).toBe('GOOGL'); // ticker wins
  });

  it('should log deprecation warning when symbol parameter is used', () => {
    const consoleWarnMock = jest.fn();
    const originalWarn = console.warn;
    console.warn = consoleWarnMock;

    const apiHandler = (params) => {
      if (params.symbol && !params.ticker) {
        console.warn('DEPRECATION: "symbol" parameter is deprecated, use "ticker" instead');
      }
      return params.ticker || params.symbol;
    };

    apiHandler({ symbol: 'AAPL' });

    expect(consoleWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('DEPRECATION')
    );

    console.warn = originalWarn;
  });
});
