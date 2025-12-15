const { describe, it, expect } = require('@jest/globals');

const { normalizePositionBody } = require('../../../dashboard/position_body');

describe('Dashboard - Position body normalization', () => {
  it('accepts legacy symbol and converts to ticker', () => {
    const normalized = normalizePositionBody({
      account_id: 1,
      symbol: 'AAPL',
      type: 'stock',
      quantity: '100',
      currency: 'USD'
    });

    expect(normalized.ticker).toBe('AAPL');
    expect(normalized.quantity).toBe(100);
  });

  it('prefers ticker when both ticker and symbol provided', () => {
    const normalized = normalizePositionBody({
      ticker: 'MSFT',
      symbol: 'AAPL',
      quantity: 10
    });

    expect(normalized.ticker).toBe('MSFT');
    expect(normalized.quantity).toBe(10);
  });

  it('treats 0 as valid quantity (not falsy)', () => {
    const normalized = normalizePositionBody({
      ticker: 'AAPL',
      quantity: '0'
    });

    expect(normalized.quantity).toBe(0);
  });

  it('returns undefined quantity for non-numeric input', () => {
    const normalized = normalizePositionBody({
      ticker: 'AAPL',
      quantity: 'not-a-number'
    });

    expect(normalized.quantity).toBeUndefined();
  });
});
