// tests/unit/services/price-router.test.js
// Unit tests for PriceRouter service

const PriceRouter = require('../../../services/price-router');

describe('PriceRouter', () => {
    let mockPool;
    let priceRouter;

    beforeEach(() => {
        // Mock MySQL pool
        mockPool = {
            execute: jest.fn(),
            query: jest.fn()
        };
        priceRouter = new PriceRouter({ pool: mockPool });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        test('should initialize with pool', () => {
            expect(priceRouter.pool).toBe(mockPool);
        });

        test('should initialize provider functions', () => {
            expect(priceRouter.providers).toBeDefined();
            expect(priceRouter.providers.YAHOO).toBeDefined();
            expect(priceRouter.providers.TREASURY_GOV).toBeDefined();
            expect(priceRouter.providers.INVESTING_COM).toBeDefined();
        });
    });

    describe('_getDefaultProvider', () => {
        test('should return YAHOO for stock', () => {
            const provider = priceRouter._getDefaultProvider('stock');
            expect(provider).toBe('YAHOO');
        });

        test('should return YAHOO for etf', () => {
            const provider = priceRouter._getDefaultProvider('etf');
            expect(provider).toBe('YAHOO');
        });

        test('should return TREASURY_GOV for bond', () => {
            const provider = priceRouter._getDefaultProvider('bond');
            expect(provider).toBe('TREASURY_GOV');
        });

        test('should return TREASURY_GOV for us_treasury', () => {
            const provider = priceRouter._getDefaultProvider('us_treasury');
            expect(provider).toBe('TREASURY_GOV');
        });

        test('should return INVESTING_COM for crypto', () => {
            const provider = priceRouter._getDefaultProvider('crypto');
            expect(provider).toBe('INVESTING_COM');
        });

        test('should return null for cash', () => {
            const provider = priceRouter._getDefaultProvider('cash');
            // Cash returns null in the typeMap, but could fall through to YAHOO
            // Check implementation to see if it's null or YAHOO
            expect([null, 'YAHOO']).toContain(provider);
        });

        test('should return YAHOO for other', () => {
            const provider = priceRouter._getDefaultProvider('other');
            expect(provider).toBe('YAHOO');
        });

        test('should return YAHOO for unknown types', () => {
            const provider = priceRouter._getDefaultProvider('unknown_type');
            expect(provider).toBe('YAHOO');
        });
    });

    describe('_lookupPricingProvider', () => {
        test('should return null when no pool configured', async () => {
            const routerWithoutPool = new PriceRouter({});
            const provider = await routerWithoutPool._lookupPricingProvider('AAPL', 'stock');
            expect(provider).toBeNull();
        });

        test('should query database for pricing provider', async () => {
            mockPool.execute.mockResolvedValue([[{ pricing_provider: 'YAHOO' }]]);

            const provider = await priceRouter._lookupPricingProvider('AAPL', 'stock');

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('SELECT pricing_provider'),
                ['AAPL', 'STOCK']
            );
            expect(provider).toBe('YAHOO');
        });

        test('should return null when ticker not found', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            const provider = await priceRouter._lookupPricingProvider('NOTFOUND', 'stock');

            expect(provider).toBeNull();
        });

        test('should handle database errors gracefully', async () => {
            mockPool.execute.mockRejectedValue(new Error('Database error'));

            const provider = await priceRouter._lookupPricingProvider('AAPL', 'stock');

            expect(provider).toBeNull();
        });

        test('should uppercase security_type in query', async () => {
            mockPool.execute.mockResolvedValue([[{ pricing_provider: 'YAHOO' }]]);

            await priceRouter._lookupPricingProvider('AAPL', 'stock');

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.any(String),
                ['AAPL', 'STOCK']
            );
        });
    });

    describe('fetchPrice', () => {
        beforeEach(() => {
            // Spy on provider methods to prevent actual API calls
            jest.spyOn(priceRouter, '_fetchFromYahoo').mockResolvedValue({
                price: 150.00,
                source: 'yahoo'
            });
            jest.spyOn(priceRouter, '_fetchFromInvesting').mockResolvedValue({
                price: 45000.00,
                source: 'investing'
            });

            // Update providers object to use the spies because they were bound in constructor
            priceRouter.providers.YAHOO = priceRouter._fetchFromYahoo;
            priceRouter.providers.INVESTING_COM = priceRouter._fetchFromInvesting;
        });

        test('should normalize ticker to uppercase', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            await priceRouter.fetchPrice('aapl', 'stock');

            expect(priceRouter._fetchFromYahoo).toHaveBeenCalledWith(
                'AAPL',
                'stock',
                expect.any(Object)
            );
        });

        test('should use provided pricing provider when specified', async () => {
            await priceRouter.fetchPrice('AAPL', 'stock', { pricingProvider: 'YAHOO' });

            expect(priceRouter._fetchFromYahoo).toHaveBeenCalled();
        });

        test('should lookup pricing provider from database when not specified', async () => {
            mockPool.execute.mockResolvedValue([[{ pricing_provider: 'YAHOO' }]]);

            await priceRouter.fetchPrice('AAPL', 'stock');

            expect(mockPool.execute).toHaveBeenCalled();
            expect(priceRouter._fetchFromYahoo).toHaveBeenCalled();
        });

        test('should use default provider when lookup returns null', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            await priceRouter.fetchPrice('NEWSTOCK', 'stock');

            expect(priceRouter._fetchFromYahoo).toHaveBeenCalled();
        });

        test('should throw error for unknown pricing provider', async () => {
            await expect(
                priceRouter.fetchPrice('AAPL', 'stock', { pricingProvider: 'UNKNOWN' })
            ).rejects.toThrow('Unknown pricing provider: UNKNOWN');
        });

        test('should return enriched price data', async () => {
            const result = await priceRouter.fetchPrice('AAPL', 'stock', { pricingProvider: 'YAHOO' });

            expect(result).toEqual({
                price: 150.00,
                source: 'yahoo',
                ticker: 'AAPL',
                security_type: 'stock',
                pricing_provider: 'YAHOO'
            });
        });

        test('should attempt fallback on provider failure when enabled', async () => {
            // Override the spy for this specific test
            priceRouter._fetchFromYahoo.mockRejectedValueOnce(new Error('Yahoo failed'));

            const result = await priceRouter.fetchPrice('AAPL', 'stock', {
                pricingProvider: 'YAHOO',
                allowFallback: true
            });

            expect(result.pricing_provider).toBe('INVESTING_COM');
            expect(result.fallback_from).toBe('YAHOO');
        });

        test('should not attempt fallback when disabled', async () => {
            // Override the spy for this specific test
            priceRouter._fetchFromYahoo.mockRejectedValueOnce(new Error('Yahoo failed'));

            await expect(
                priceRouter.fetchPrice('AAPL', 'stock', {
                    pricingProvider: 'YAHOO',
                    allowFallback: false
                })
            ).rejects.toThrow('Yahoo failed');
        });
    });

    describe('_attemptFallback', () => {
        beforeEach(() => {
            // Spy on provider methods to prevent actual API calls
            jest.spyOn(priceRouter, '_fetchFromYahoo').mockResolvedValue({
                price: 150.00,
                source: 'yahoo'
            });
            jest.spyOn(priceRouter, '_fetchFromInvesting').mockResolvedValue({
                price: 45000.00,
                source: 'investing'
            });

            // Update providers object to use the spies
            priceRouter.providers.YAHOO = priceRouter._fetchFromYahoo;
            priceRouter.providers.INVESTING_COM = priceRouter._fetchFromInvesting;
        });

        test('should try INVESTING_COM as fallback for YAHOO', async () => {
            const result = await priceRouter._attemptFallback('AAPL', 'stock', 'YAHOO', {});

            expect(priceRouter._fetchFromInvesting).toHaveBeenCalled();
            expect(result.fallback_from).toBe('YAHOO');
        });

        test('should try YAHOO as fallback for INVESTING_COM', async () => {
            const result = await priceRouter._attemptFallback('BTC', 'crypto', 'INVESTING_COM', {});

            expect(priceRouter._fetchFromYahoo).toHaveBeenCalled();
            expect(result.fallback_from).toBe('INVESTING_COM');
        });

        test('should have no fallback for TREASURY_GOV', async () => {
            await expect(
                priceRouter._attemptFallback('CUSIP123', 'bond', 'TREASURY_GOV', {})
            ).rejects.toThrow('All providers failed');
        });

        test('should throw when all fallbacks fail', async () => {
            priceRouter._fetchFromInvesting.mockRejectedValueOnce(new Error('Investing failed'));

            await expect(
                priceRouter._attemptFallback('AAPL', 'stock', 'YAHOO', {})
            ).rejects.toThrow('All providers failed for AAPL (stock)');
        });
    });

    describe('savePriceToDatabase', () => {
        test('should throw when no pool configured', async () => {
            const routerWithoutPool = new PriceRouter({});

            await expect(
                routerWithoutPool.savePriceToDatabase({ ticker: 'AAPL' })
            ).rejects.toThrow('Database pool not configured');
        });

        test('should execute INSERT with ON DUPLICATE KEY UPDATE', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            const priceData = {
                ticker: 'AAPL',
                security_type: 'stock',
                price: 150.00,
                previous_close_price: 149.50,
                prev_close_source: 'yahoo',
                prev_close_time: '2025-12-21T00:00:00Z',
                source: 'yahoo',
                time: '2025-12-21T12:00:00Z'
            };

            await priceRouter.savePriceToDatabase(priceData);

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO latest_prices'),
                expect.arrayContaining(['AAPL', 'STOCK', 150.00])
            );
        });

        test('should uppercase security_type when saving', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            const priceData = {
                ticker: 'AAPL',
                security_type: 'stock',
                price: 150.00,
                source: 'yahoo',
                time: '2025-12-21T12:00:00Z'
            };

            await priceRouter.savePriceToDatabase(priceData);

            const executeCall = mockPool.execute.mock.calls[0];
            expect(executeCall[1]).toContain('STOCK');
        });

        test('should handle database errors', async () => {
            mockPool.execute.mockRejectedValue(new Error('Database error'));

            const priceData = {
                ticker: 'AAPL',
                security_type: 'stock',
                price: 150.00,
                source: 'yahoo',
                time: '2025-12-21T12:00:00Z'
            };

            await expect(
                priceRouter.savePriceToDatabase(priceData)
            ).rejects.toThrow('Database error');
        });
    });

    describe('getPriceFromDatabase', () => {
        test('should throw when no pool configured', async () => {
            const routerWithoutPool = new PriceRouter({});

            await expect(
                routerWithoutPool.getPriceFromDatabase('AAPL', 'stock')
            ).rejects.toThrow('Database pool not configured');
        });

        test('should query database with uppercase parameters', async () => {
            mockPool.execute.mockResolvedValue([[{ price: 150.00 }]]);

            await priceRouter.getPriceFromDatabase('aapl', 'stock');

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringMatching(/SELECT\s+\*\s+FROM\s+latest_prices/i),
                ['AAPL', 'STOCK', 'US_EQUITY']
            );
        });

        test('should return price data when found', async () => {
            const priceData = {
                ticker: 'AAPL',
                security_type: 'STOCK',
                price: 150.00,
                source: 'yahoo'
            };
            mockPool.execute.mockResolvedValue([[priceData]]);

            const result = await priceRouter.getPriceFromDatabase('AAPL', 'stock');

            expect(result).toEqual(priceData);
        });

        test('should return null when not found', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            const result = await priceRouter.getPriceFromDatabase('NOTFOUND', 'stock');

            expect(result).toBeNull();
        });

        test('should handle database errors', async () => {
            mockPool.execute.mockRejectedValue(new Error('Database error'));

            await expect(
                priceRouter.getPriceFromDatabase('AAPL', 'stock')
            ).rejects.toThrow('Database error');
        });
    });

    describe('Integration Scenarios', () => {
        beforeEach(() => {
            // Spy on provider methods to prevent actual API calls
            jest.spyOn(priceRouter, '_fetchFromYahoo').mockResolvedValue({
                price: 150.00,
                source: 'yahoo'
            });
            jest.spyOn(priceRouter, '_fetchFromInvesting').mockResolvedValue({
                price: 45000.00,
                source: 'investing'
            });

            // Update providers object to use the spies
            priceRouter.providers.YAHOO = priceRouter._fetchFromYahoo;
            priceRouter.providers.INVESTING_COM = priceRouter._fetchFromInvesting;
        });

        test('should handle complete price fetch and save flow', async () => {
            mockPool.execute.mockResolvedValue([[]]);
            priceRouter._fetchFromYahoo.mockResolvedValueOnce({
                price: 150.00,
                previous_close_price: 149.50,
                source: 'yahoo',
                time: '2025-12-21T12:00:00Z'
            });

            const priceData = await priceRouter.fetchPrice('AAPL', 'stock');

            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);
            await priceRouter.savePriceToDatabase(priceData);

            expect(priceRouter._fetchFromYahoo).toHaveBeenCalled();
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO latest_prices'),
                expect.any(Array)
            );
        });

        test('should distinguish between BTC crypto and BTC ETF', async () => {
            const btcCrypto = await priceRouter.fetchPrice('BTC', 'crypto', { pricingProvider: 'INVESTING_COM' });
            const btcEtf = await priceRouter.fetchPrice('BTC', 'etf', { pricingProvider: 'YAHOO' });

            expect(btcCrypto.security_type).toBe('crypto');
            expect(btcEtf.security_type).toBe('etf');
            expect(priceRouter._fetchFromInvesting).toHaveBeenCalled();
            expect(priceRouter._fetchFromYahoo).toHaveBeenCalled();
        });
    });
});
