const fs = require('fs');
const path = require('path');
const { getExchange, reloadExchangeData } = require('./exchange_registry');

const CONFIG_DIR = path.join(__dirname, '../config');
const NASDAQ_FILE = path.join(CONFIG_DIR, 'nasdaq-listed.csv');
const NYSE_FILE = path.join(CONFIG_DIR, 'nyse-listed.csv');

describe('loadExchangeData', () => {
  beforeEach(() => {
    // Clear the in-memory cache before every test
    reloadExchangeData();
  });

  afterAll(() => {
    // Clean up any test files we created
    [NASDAQ_FILE, NYSE_FILE].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
  });

  test('returns empty sets when no CSV files exist', () => {
    // Ensure files do not exist
    [NASDAQ_FILE, NYSE_FILE].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });

    const data = require('./exchange_registry').loadExchangeData();
    expect(data.NASDAQ.size).toBe(0);
    expect(data.NYSE.size).toBe(0);
  });

  test('loads NASDAQ symbols correctly', () => {
    fs.writeFileSync(NASDAQ_FILE, 'Symbol,Security Name\nAAPL,Apple Inc\nMSFT,Microsoft Corp');
    const data = require('./exchange_registry').loadExchangeData();
    expect(data.NASDAQ.has('AAPL')).toBe(true);
    expect(data.NASDAQ.has('MSFT')).toBe(true);
    expect(data.NASDAQ.has('GOOG')).toBe(false);
  });

  test('loads NYSE symbols correctly', () => {
    fs.writeFileSync(NYSE_FILE, 'ACT Symbol,Company Name\nBRK.B,Berkshire Hathaway\nJPM,JPMorgan Chase');
    const data = require('./exchange_registry').loadExchangeData();
    expect(data.NYSE.has('BRK.B')).toBe(true);
    expect(data.NYSE.has('JPM')).toBe(true);
    expect(data.NYSE.has('XOM')).toBe(false);
  });

  test('normalizes ticker symbols for lookup', () => {
    fs.writeFileSync(NASDAQ_FILE, 'Symbol,Security Name\nBRK.B,Berkshire');
    fs.writeFileSync(NYSE_FILE, 'ACT Symbol,Company Name\nJPM,JPMorgan');
    expect(getExchange('brk.b')).toBe('NASDAQ');
    expect(getExchange('JPM')).toBe('NYSE');
  });

  test('returns null for unknown tickers', () => {
    fs.writeFileSync(NASDAQ_FILE, 'Symbol,Security Name\nAAPL,Apple');
    expect(getExchange('UNKNOWN')).toBe(null);
  });
});
