// tests/integration/fetch-price-integration.test.js
// Integration tests for the fetch-price endpoint
// Tests the full flow: Yahoo Finance -> Cache -> Socket.io -> Kafka -> MySQL

const request = require('supertest');

// Skip these tests if not running in CI with real services
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION_TESTS === 'true';

describe('Fetch Price Integration Tests', () => {
    // These tests require a running dashboard container
    const BASE_URL = process.env.DASHBOARD_URL || 'https://localhost:3001';
    const AUTH_USER = process.env.BASIC_AUTH_USER || 'admin';
    const AUTH_PASS = process.env.BASIC_AUTH_PASSWORD || 'admin';

    beforeAll(() => {
        // Disable TLS verification for self-signed certs
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    });

    describe('POST /api/fetch-price', () => {
        it.skipIf(SKIP_INTEGRATION)('should fetch and return price for valid symbol', async () => {
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: 'AAPL' })
                .timeout(10000);

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                symbol: 'AAPL',
                currency: expect.any(String),
                cached: true
            });
            expect(res.body.price).toBeGreaterThan(0);
            expect(res.body.timestamp).toBeDefined();
        });

        it.skipIf(SKIP_INTEGRATION)('should persist price to Kafka', async () => {
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: 'MSFT' })
                .timeout(10000);

            expect(res.status).toBe(200);
            expect(res.body.persisted).toBe(true);
        });

        it.skipIf(SKIP_INTEGRATION)('should return 404 for invalid symbol', async () => {
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: 'INVALIDXYZ123' })
                .timeout(10000);

            // Yahoo may return 404 or 500 depending on error type
            expect([404, 500]).toContain(res.status);
        });
    });
});

// Custom skipIf implementation for conditional test skipping
if (!it.skipIf) {
    it.skipIf = (condition) => condition ? it.skip : it;
}
