// tests/integration/source-tracking.integration.test.js
// Integration tests for source tracking flow

const request = require('supertest');

// Mock mysql2/promise
const mockExecute = jest.fn();
const mockQuery = jest.fn();

jest.mock('mysql2/promise', () => ({
    createPool: jest.fn(() => ({
        execute: mockExecute,
        query: mockQuery,
        getConnection: jest.fn().mockResolvedValue({
            execute: mockExecute,
            query: mockQuery,
            release: jest.fn()
        }),
        on: jest.fn(),
        end: jest.fn().mockResolvedValue()
    }))
}));

// Mock PriceRouter to avoid real API calls
jest.mock('../../services/price-router', () => {
    return jest.fn().mockImplementation(() => ({
        fetchPrice: jest.fn().mockResolvedValue({
            price: 150.00,
            ticker: 'AAPL',
            security_type: 'stock',
            pricing_provider: 'YAHOO',
            source: 'yahoo',
            time: new Date().toISOString()
        }),
        savePriceToDatabase: jest.fn().mockResolvedValue(true),
        _lookupPricingProvider: jest.fn().mockResolvedValue('YAHOO'),
        _getDefaultProvider: jest.fn().mockReturnValue('YAHOO')
    }));
});

// Mock Kafka to avoid connection issues
jest.mock('kafkajs', () => ({
    Kafka: jest.fn().mockImplementation(() => ({
        producer: jest.fn().mockImplementation(() => ({
            connect: jest.fn().mockResolvedValue(),
            send: jest.fn().mockResolvedValue(),
            disconnect: jest.fn().mockResolvedValue()
        })),
        consumer: jest.fn().mockImplementation(() => ({
            connect: jest.fn().mockResolvedValue(),
            subscribe: jest.fn().mockResolvedValue(),
            run: jest.fn().mockResolvedValue(),
            disconnect: jest.fn().mockResolvedValue()
        }))
    }))
}));

const { app, server, pool, assetsPollingInterval } = require('../../dashboard/server');

describe('Source Tracking Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default mock responses
        mockExecute.mockResolvedValue([[], []]);
        mockQuery.mockResolvedValue([[], []]);
    });

    afterAll(async () => {
        if (assetsPollingInterval) clearInterval(assetsPollingInterval);
        if (server && server.close) server.close();
        if (pool && pool.end) await pool.end();
    });

    describe('POST /api/positions', () => {
        test('should save source and pricing_provider when adding a position', async () => {
            const payload = {
                account_id: 1,
                ticker: 'AAPL',
                quantity: 10,
                type: 'stock',
                source: 'MANUAL',
                pricing_provider: 'YAHOO'
            };

            const res = await request(app)
                .post('/api/positions')
                .auth('admin', 'admin')
                .send(payload);

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                ticker: 'AAPL',
                source: 'MANUAL',
                pricing_provider: 'YAHOO'
            });

            expect(mockExecute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO positions'),
                expect.arrayContaining([1, 'AAPL', 'stock', 10, 'USD', 'MANUAL', 'YAHOO'])
            );
        });

        test('should handle missing source and pricing_provider', async () => {
            const payload = {
                account_id: 1,
                ticker: 'MSFT',
                quantity: 5,
                type: 'stock'
            };

            const res = await request(app)
                .post('/api/positions')
                .auth('admin', 'admin')
                .send(payload);

            expect(res.status).toBe(200);
            expect(mockExecute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO positions'),
                expect.arrayContaining([1, 'MSFT', 'stock', 5, 'USD', null, null])
            );
        });
    });

    describe('PUT /api/positions/:id', () => {
        test('should update source and pricing_provider', async () => {
            const payload = {
                ticker: 'AAPL',
                quantity: 15,
                type: 'stock',
                source: 'MANUAL_UPDATED',
                pricing_provider: 'INVESTING_COM'
            };

            const res = await request(app)
                .put('/api/positions/123')
                .auth('admin', 'admin')
                .send(payload);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true });

            expect(mockExecute).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE positions SET'),
                expect.arrayContaining(['AAPL', 'stock', 15, 'USD', 'MANUAL_UPDATED', 'INVESTING_COM', '123'])
            );
        });
    });

    describe('GET /api/assets', () => {
        test('should return source and pricing_provider for positions', async () => {
            // Mock accounts
            mockQuery.mockResolvedValueOnce([[
                { id: 1, name: 'Test Account', account_type_display_name: 'Brokerage', category: 'investment' }
            ]]);
            // Mock positions
            mockQuery.mockResolvedValueOnce([[
                { 
                    id: 10, 
                    account_id: 1, 
                    ticker: 'AAPL', 
                    quantity: 10, 
                    security_type: 'stock', 
                    type: 'stock',
                    source: 'MANUAL', 
                    pricing_provider: 'YAHOO' 
                }
            ]]);
            // Mock fixed assets
            mockQuery.mockResolvedValueOnce([[]]);

            // Force cache clear and reload by adding a position
            await request(app)
                .post('/api/positions')
                .auth('admin', 'admin')
                .send({ account_id: 1, ticker: 'AAPL', quantity: 10 });

            const res = await request(app)
                .get('/api/assets')
                .auth('admin', 'admin');

            expect(res.status).toBe(200);
            const account = res.body.accounts.find(a => a.id === 1);
            expect(account).toBeDefined();
            const position = account.holdings.stocks.find(p => p.ticker === 'AAPL');
            
            expect(position).toMatchObject({
                source: 'MANUAL',
                pricing_provider: 'YAHOO'
            });
        });
    });

    describe('Multi-type Ticker Support', () => {
        test('should support same ticker with different security types', async () => {
            // 1. Add BTC as crypto
            await request(app)
                .post('/api/positions')
                .auth('admin', 'admin')
                .send({
                    account_id: 1,
                    ticker: 'BTC',
                    quantity: 0.5,
                    type: 'crypto',
                    source: 'COINBASE',
                    pricing_provider: 'INVESTING_COM'
                });

            expect(mockExecute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO positions'),
                expect.arrayContaining([1, 'BTC', 'crypto', 0.5, 'USD', 'COINBASE', 'INVESTING_COM'])
            );

            // 2. Add BTC as ETF (e.g. BlackRock iShares Bitcoin Trust)
            await request(app)
                .post('/api/positions')
                .auth('admin', 'admin')
                .send({
                    account_id: 1,
                    ticker: 'BTC',
                    quantity: 100,
                    type: 'etf',
                    source: 'FIDELITY',
                    pricing_provider: 'YAHOO'
                });

            expect(mockExecute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO positions'),
                expect.arrayContaining([1, 'BTC', 'etf', 100, 'USD', 'FIDELITY', 'YAHOO'])
            );
        });
    });

    describe('POST /api/fetch-price', () => {
        test('should use pricing_provider from request if provided', async () => {
            const PriceRouter = require('../../services/price-router');
            const payload = {
                ticker: 'BTC',
                security_type: 'crypto',
                pricing_provider: 'INVESTING_COM'
            };

            const res = await request(app)
                .post('/api/fetch-price')
                .auth('admin', 'admin')
                .send(payload);

            if (res.status !== 200) {
                console.log('DEBUG: res.status =', res.status);
                console.log('DEBUG: res.body =', JSON.stringify(res.body, null, 2));
            }
            expect(res.status).toBe(200);
            
            // Verify PriceRouter was called with the correct provider
            const routerInstance = PriceRouter.mock.results[0].value;
            expect(routerInstance.fetchPrice).toHaveBeenCalledWith(
                'BTC',
                'crypto',
                expect.objectContaining({
                    pricingProvider: 'INVESTING_COM'
                })
            );
        });

        test('should pass security_type to PriceRouter', async () => {
            const PriceRouter = require('../../services/price-router');
            const payload = {
                ticker: 'AAPL',
                security_type: 'etf'
            };

            const res = await request(app)
                .post('/api/fetch-price')
                .auth('admin', 'admin')
                .send(payload);

            expect(res.status).toBe(200);
            
            const routerInstance = PriceRouter.mock.results[0].value;
            expect(routerInstance.fetchPrice).toHaveBeenCalledWith(
                'AAPL',
                'etf',
                expect.any(Object)
            );
        });
    });
});
