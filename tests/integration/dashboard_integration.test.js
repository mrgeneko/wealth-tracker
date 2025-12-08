
const request = require('supertest');
const { app, pool } = require('../../dashboard/server');

describe('Dashboard Integration API', () => {

    // Cleanup after tests
    afterAll(async () => {
        await pool.end();
        // Server might be listening if logic wasn't perfect, but we exported app
    });

    test('GET /api/assets returns enriched positions', async () => {
        const res = await request(app)
            .get('/api/assets')
            .auth(process.env.BASIC_AUTH_USER || 'admin', process.env.BASIC_AUTH_PASSWORD || 'admin');

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('accounts');

        // Find a stock position to check metadata
        let stockPos = null;
        for (const acc of res.body.accounts) {
            if (acc.holdings.stocks.length > 0) {
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
    });

    test('GET /api/metadata/autocomplete returns suggestions', async () => {
        // We need to ensure we have at least one stock with 'A' or similar
        const res = await request(app)
            .get('/api/metadata/autocomplete?q=A')
            .auth(process.env.BASIC_AUTH_USER || 'admin', process.env.BASIC_AUTH_PASSWORD || 'admin');

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
    });
});
