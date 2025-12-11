// tests/integration/fetch-price-integration.test.js
// Integration tests for the fetch-price endpoint
// Tests the full flow: Yahoo Finance -> Cache -> Socket.io -> Kafka -> MySQL

const request = require('supertest');

// Custom skipIf implementation for conditional test skipping
if (!it.skipIf) {
    it.skipIf = (condition) => condition ? it.skip : it;
}

// Skip these tests if not running in CI with real services
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION_TESTS === 'true';

describe('Fetch Price Integration Tests', () => {
    // These tests require a running dashboard container
    const BASE_URL = process.env.DASHBOARD_URL || 'https://localhost:3001';
    const AUTH_USER = process.env.BASIC_AUTH_USER || 'admin';
    const AUTH_PASS = process.env.BASIC_AUTH_PASSWORD || 'admin';
    let dashboardAvailable = false;

    beforeAll(async () => {
        // Disable TLS verification for self-signed certs
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        
        // Check if dashboard is available
        try {
            const res = await request(BASE_URL)
                .get('/health')
                .timeout(2000);
            dashboardAvailable = res.status === 200;
        } catch (err) {
            dashboardAvailable = false;
        }
    });

    // Helper function to skip tests if dashboard isn't available
    const describeIfDashboard = dashboardAvailable ? describe : describe.skip;
    const itIfDashboard = dashboardAvailable ? it : it.skip;

    describe('POST /api/fetch-price', () => {
        itIfDashboard('should fetch and return price for valid symbol', async () => {
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

        itIfDashboard('should persist price to Kafka', async () => {
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: 'MSFT' })
                .timeout(10000);

            expect(res.status).toBe(200);
            expect(res.body.persisted).toBe(true);
        });

        itIfDashboard('should return 404 for invalid symbol', async () => {
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: 'INVALIDXYZ123' })
                .timeout(10000);

            // Yahoo may return 404 or 500 depending on error type
            expect([404, 500]).toContain(res.status);
        });

        itIfDashboard('should detect bond via treasury registry and trigger async scraping', async () => {
            // Test with a known treasury symbol from the registry
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: '912810EX2', type: 'bond' }) // 30-Year Treasury Bond
                .timeout(10000);

            // Bonds return 200 with async message, not immediate price
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                symbol: '912810EX2',
                message: expect.stringContaining('will be fetched by scrape daemon')
            });
            // Bonds should indicate triggered = true
            expect(res.body.triggered).toBe(true);
        });

        itIfDashboard('should detect treasury bill (4-week)', async () => {
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: '912797SE8', type: 'bond' }) // 4-Week Treasury Bill
                .timeout(10000);

            expect(res.status).toBe(200);
            expect(res.body.triggered).toBe(true);
            expect(res.body.message).toBeDefined();
        });

        itIfDashboard('should detect treasury note (7-year)', async () => {
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: '91282CPM7', type: 'bond' }) // 7-Year Treasury Note
                .timeout(10000);

            expect(res.status).toBe(200);
            expect(res.body.triggered).toBe(true);
        });
    });

    describe('Bond Treasury Registry Detection', () => {
        itIfDashboard('should accept bond without explicit type if registry detects treasury', async () => {
            // Even without type='bond', treasury symbols should be detected
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: '912810EX2' }) // No type specified
                .timeout(10000);

            expect(res.status).toBe(200);
            expect(res.body.triggered).toBe(true);
        });

        itIfDashboard('should reject non-treasury symbols even if type=bond is specified', async () => {
            // Stocks should NOT be treated as bonds, even if user explicitly says type=bond
            const res = await request(BASE_URL)
                .post('/api/fetch-price')
                .auth(AUTH_USER, AUTH_PASS)
                .send({ symbol: 'AAPL', type: 'bond' }) // Type doesn't matter, AAPL is a stock
                .timeout(10000);

            // Should fetch via Yahoo Finance, not trigger daemon
            expect(res.status).toBe(200);
            // Should have regular stock price response
            expect(res.body.price).toBeGreaterThan(0);
            expect(res.body.triggered).not.toBe(true);
        });
    });
});
