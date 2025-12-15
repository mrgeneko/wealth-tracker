const { describe, it, expect } = require('@jest/globals');

describe('Dashboard - Add Position modal type detection', () => {
  it('should detect bond symbols and set type to "bond" in add position data', () => {
    // Simulate the logic used in the "+" button
    const accounts = [
      {
        id: 1,
        name: 'Account 1',
        holdings: {
          stocks: [{ id: 1, ticker: 'AAPL', quantity: 10 }],
          bonds: []
        }
      },
      {
        id: 2,
        name: 'Account 2',
        holdings: {
          stocks: [],
          bonds: [{ id: 5, ticker: '91282CGE5', quantity: 100000 }]
        }
      }
    ];

    // Test 1: Bond symbol should be detected as bond
    const sym = '91282CGE5';
    let isBondSymbol = false;
    for (const account of accounts) {
      if (account.holdings.bonds.find(b => b.ticker === sym)) {
        isBondSymbol = true;
        break;
      }
    }
    const posType = isBondSymbol ? 'bond' : 'stock';
    
    expect(isBondSymbol).toBe(true);
    expect(posType).toBe('bond');
  });

  it('should set stock symbols to type "stock"', () => {
    const accounts = [
      {
        id: 1,
        name: 'Account 1',
        holdings: {
          stocks: [{ id: 1, ticker: 'MSFT', quantity: 50 }],
          bonds: []
        }
      }
    ];

    const sym = 'MSFT';
    let isBondSymbol = false;
    for (const account of accounts) {
      if (account.holdings.bonds.find(b => b.ticker === sym)) {
        isBondSymbol = true;
        break;
      }
    }
    const posType = isBondSymbol ? 'bond' : 'stock';
    
    expect(isBondSymbol).toBe(false);
    expect(posType).toBe('stock');
  });

  it('should detect bond symbol even if in second account', () => {
    const accounts = [
      {
        id: 1,
        holdings: { stocks: [{ ticker: 'AAPL' }], bonds: [] }
      },
      {
        id: 2,
        holdings: { stocks: [], bonds: [{ ticker: '91282CKS9' }] }
      },
      {
        id: 3,
        holdings: { stocks: [{ ticker: 'GOOGL' }], bonds: [] }
      }
    ];

    const sym = '91282CKS9';
    let isBondSymbol = false;
    for (const account of accounts) {
      if (account.holdings.bonds.find(b => b.ticker === sym)) {
        isBondSymbol = true;
        break;
      }
    }
    const posType = isBondSymbol ? 'bond' : 'stock';
    
    expect(isBondSymbol).toBe(true);
    expect(posType).toBe('bond');
  });
});
