/**
 * Dashboard Integration Tests
 * These tests require:
 * 1. MySQL running with proper schema
 * 2. Environment variables set (MYSQL_HOST, MYSQL_USER, etc.)
 * 3. NODE_ENV=test to prevent server auto-start
 * 
 * NOTE: This file should NOT be included in Jest unit tests.
 * It is meant to run only as part of the integration test suite via CI.
 * Jest is configured to exclude integration tests (see jest.config.js).
 */

// Set test env before importing server
process.env.NODE_ENV = 'test';

const request = require('supertest');

let app, pool;
let dbConnectionError = null;

// Skip all tests if we can't connect to the database
const dbAvailable = process.env.MYSQL_USER && process.env.MYSQL_PASSWORD;

const describeIf = (condition) => condition ? describe : describe.skip;

describeIf(dbAvailable)('Dashboard Integration API', () => {
    let assetsPollingInterval = null;
    
    beforeAll(async () => {
        try {
            // Import server module only when we're actually running tests
            const server = require('../../dashboard/server');
            app = server.app;
            pool = server.pool;
            assetsPollingInterval = server.assetsPollingInterval;
            
            // Test database connection
            await pool.query('SELECT 1');
            console.log('Database connection verified');
        } catch (err) {
            dbConnectionError = err;
            console.error('Database connection failed:', err.message);
        }
    });

    // Cleanup after tests
    afterAll(async () => {
        // Clear any polling intervals first
        if (assetsPollingInterval) {
            clearInterval(assetsPollingInterval);
        }
        if (pool) {
            await pool.end();
        }
    });

    test('GET /api/assets returns enriched positions', async () => {
        if (dbConnectionError) {
            console.warn('Skipping test due to DB connection error:', dbConnectionError.message);
            return;
        }

        const res = await request(app)
            .get('/api/assets')
            .auth(process.env.BASIC_AUTH_USER || 'admin', process.env.BASIC_AUTH_PASSWORD || 'admin');

        // Log error details if request failed
        if (res.statusCode !== 200) {
            console.error('API error response:', res.statusCode, res.body);
        }

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('accounts');

        // Find a stock position to check metadata
        let stockPos = null;
        for (const acc of res.body.accounts) {
            if (acc.holdings && acc.holdings.stocks && acc.holdings.stocks.length > 0) {
                stockPos = acc.holdings.stocks[0];
                break;
            }
        }

        if (stockPos) {
            // These fields might be null if not populated, but keys should exist
            expect(stockPos).toHaveProperty('short_name');
            expect(stockPos).toHaveProperty('sector');
            expect(stockPos).toHaveProperty('trailing_pe');
            expect(stockPos).toHaveProperty('dividend_yield');
        } else {
            console.warn('No stock positions found to verify metadata fields.');
        }
    }, 30000);

    test('GET /api/metadata/autocomplete returns suggestions', async () => {
        if (dbConnectionError) {
            console.warn('Skipping test due to DB connection error:', dbConnectionError.message);
            return;
        }

        // We need to ensure we have at least one stock with 'A' or similar
        const res = await request(app)
            .get('/api/metadata/autocomplete?q=A')
            .auth(process.env.BASIC_AUTH_USER || 'admin', process.env.BASIC_AUTH_PASSWORD || 'admin');

        // Log error details if request failed
        if (res.statusCode !== 200) {
            console.error('API error response:', res.statusCode, res.body);
        }

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('results');
        expect(Array.isArray(res.body.results)).toBe(true);

        // If we populated data, we should have results like AAPL
        if (res.body.results.length > 0) {
            const first = res.body.results[0];
            expect(first).toHaveProperty('symbol');
            expect(first).toHaveProperty('name');
            expect(first).toHaveProperty('exchange');
        }
    }, 30000);
});
