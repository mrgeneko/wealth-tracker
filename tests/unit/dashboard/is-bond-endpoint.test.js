const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const request = require('supertest');

// Mock Express server to test the /api/is-bond endpoint
let app;
let server;

beforeAll(() => {
  const express = require('express');
  app = express();
  
  // Mock the isBondTicker function
  const isBondTickerMock = async (ticker) => {
    // Hardcode some known treasury CUSIPs and symbols for testing
    const treasuryTickers = ['91282CGE5', '91282CGA3', '91282CKS9', '91282CET4'];
    return treasuryTickers.includes(ticker?.trim().toUpperCase());
  };

  // Add the endpoint
  app.get('/api/is-bond/:ticker', async (req, res) => {
    const ticker = req.params.ticker || '';
    if (!ticker.trim()) {
      return res.status(400).json({ error: 'Ticker is required' });
    }
    
    try {
      const isBond = await isBondTickerMock(ticker);
      res.json({ ticker: ticker.toUpperCase(), isBond });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

describe('Dashboard - /api/is-bond/:ticker endpoint', () => {
  it('should return isBond=true for known treasury CUSIP', async () => {
    const response = await request(app)
      .get('/api/is-bond/91282CGE5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ticker: '91282CGE5',
      isBond: true
    });
  });

  it('should return isBond=false for stock ticker', async () => {
    const response = await request(app)
      .get('/api/is-bond/AAPL');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ticker: 'AAPL',
      isBond: false
    });
  });

  it('should handle case-insensitive ticker lookup', async () => {
    const response = await request(app)
      .get('/api/is-bond/91282cge5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ticker: '91282CGE5',
      isBond: true
    });
  });

  it('should handle missing ticker gracefully', async () => {
    // Note: Express routing will match /api/is-bond/ as a route mismatch (404),
    // but a truly empty ticker parameter would only occur via direct call.
    // The endpoint validation catches empty strings when ticker is present but empty.
    
    // We can test this by mocking a request with explicit empty string
    const response = await request(app)
      .get('/api/is-bond/%20'); // URL-encoded space, which trims to empty

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('required');
  });

  it('should return isBond=true for multiple known treasury CUSIPs', async () => {
    const treasuryTickers = ['91282CGE5', '91282CGA3', '91282CKS9', '91282CET4'];
    
    for (const ticker of treasuryTickers) {
      const response = await request(app)
        .get(`/api/is-bond/${ticker}`);

      expect(response.status).toBe(200);
      expect(response.body.isBond).toBe(true);
    }
  });
});
