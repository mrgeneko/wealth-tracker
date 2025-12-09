// tests/unit/api/autocomplete.test.js
// Unit tests for autocomplete REST API endpoints
// Tests: /api/autocomplete/search, /details, /stats, /pending, /refresh, /health

const express = require('express');
const request = require('supertest');

// Mock the MetadataAutocompleteService before importing router
jest.mock('../../../services/symbol-registry', () => ({
    MetadataAutocompleteService: jest.fn()
}));

const { router, initializePool } = require('../../../api/autocomplete');
const { MetadataAutocompleteService } = require('../../../services/symbol-registry');

describe('Autocomplete API Endpoints', () => {
    let app;
    let mockPool;
    let mockService;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        
        // Create mock pool
        mockPool = {
            getConnection: jest.fn()
        };

        // Create fresh mock service
        mockService = {
            searchSymbols: jest.fn(),
            getSymbolDetails: jest.fn(),
            getStatistics: jest.fn(),
            getSymbolsNeedingMetadata: jest.fn(),
            refreshSymbolMetadata: jest.fn(),
            markMetadataFetched: jest.fn()
        };

        // Mock the service constructor to return our mockService
        MetadataAutocompleteService.mockReturnValue(mockService);

        // Initialize router with mock pool
        initializePool(mockPool);
        app.use('/api/autocomplete', router);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ========== SEARCH ENDPOINT ==========

    describe('GET /search', () => {
        it('should search for symbols successfully', async () => {
            mockService.searchSymbols.mockResolvedValue([
                {
                    symbol: 'AAPL',
                    name: 'Apple Inc.',
                    type: 'STOCK',
                    verified: true,
                    score: 145.7
                }
            ]);

            const res = await request(app)
                .get('/api/autocomplete/search')
                .query({ q: 'AAPL' });

            expect(res.status).toBe(200);
            expect(res.body.query).toBe('AAPL');
            expect(res.body.results).toHaveLength(1);
            expect(res.body.count).toBe(1);
            expect(res.body.timestamp).toBeDefined();
        });

        it('should require query parameter', async () => {
            const res = await request(app)
                .get('/api/autocomplete/search');

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid request');
            expect(res.body.message).toContain('required');
        });

        it('should reject empty query', async () => {
            const res = await request(app)
                .get('/api/autocomplete/search')
                .query({ q: '   ' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid request');
        });

        it('should respect limit parameter', async () => {
            mockService.searchSymbols.mockResolvedValue([]);

            await request(app)
                .get('/api/autocomplete/search')
                .query({ q: 'A', limit: 50 });

            expect(mockService.searchSymbols).toHaveBeenCalledWith('A', expect.objectContaining({ limit: 50 }));
        });

        it('should cap limit at 100', async () => {
            mockService.searchSymbols.mockResolvedValue([]);

            await request(app)
                .get('/api/autocomplete/search')
                .query({ q: 'A', limit: 1000 });

            expect(mockService.searchSymbols).toHaveBeenCalledWith('A', expect.objectContaining({ limit: 100 }));
        });

        it('should include metadata when requested', async () => {
            mockService.searchSymbols.mockResolvedValue([]);

            await request(app)
                .get('/api/autocomplete/search')
                .query({ q: 'A', metadata: 'true' });

            expect(mockService.searchSymbols).toHaveBeenCalledWith('A', expect.objectContaining({ includeMetadata: true }));
        });

        it('should handle search errors', async () => {
            mockService.searchSymbols.mockRejectedValue(new Error('Database error'));

            const res = await request(app)
                .get('/api/autocomplete/search')
                .query({ q: 'AAPL' });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Search failed');
        });
    });

    // ========== DETAILS ENDPOINT ==========

    describe('GET /details/:symbol', () => {
        it('should return symbol details', async () => {
            mockService.getSymbolDetails.mockResolvedValue({
                symbol: 'AAPL',
                name: 'Apple Inc.',
                type: 'STOCK',
                exchange: 'NASDAQ',
                sector: 'Technology',
                industry: 'Consumer Electronics',
                verified: true,
                metadata_fetched: true,
                metadata: {
                    market_cap: '3200000000000',
                    trailing_pe: 28.5,
                    dividend_yield: 0.42
                }
            });

            const res = await request(app)
                .get('/api/autocomplete/details/AAPL');

            expect(res.status).toBe(200);
            expect(res.body.symbol).toBe('AAPL');
            expect(res.body.name).toBe('Apple Inc.');
            expect(res.body.timestamp).toBeDefined();
        });

        it('should normalize symbol to uppercase', async () => {
            mockService.getSymbolDetails.mockResolvedValue({ symbol: 'AAPL' });

            await request(app)
                .get('/api/autocomplete/details/aapl');

            expect(mockService.getSymbolDetails).toHaveBeenCalledWith('AAPL');
        });

        it('should return 404 for unknown symbol', async () => {
            mockService.getSymbolDetails.mockResolvedValue(null);

            const res = await request(app)
                .get('/api/autocomplete/details/UNKNOWN');

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Not found');
            expect(res.body.message).toContain('not found');
        });

        it('should handle retrieval errors', async () => {
            mockService.getSymbolDetails.mockRejectedValue(new Error('Database error'));

            const res = await request(app)
                .get('/api/autocomplete/details/AAPL');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Lookup failed');
        });
    });

    // ========== STATISTICS ENDPOINT ==========

    describe('GET /stats', () => {
        it('should return statistics', async () => {
            mockService.getStatistics.mockResolvedValue({
                summary: {
                    total_symbols: 5000,
                    with_metadata: 3500,
                    without_metadata: 1500,
                    completion_percentage: 70.0
                },
                by_type: [
                    {
                        type: 'STOCK',
                        total: 3000,
                        with_metadata: 2100,
                        without_metadata: 900,
                        percentage: 70.0
                    }
                ]
            });

            const res = await request(app)
                .get('/api/autocomplete/stats');

            expect(res.status).toBe(200);
            expect(res.body.summary).toBeDefined();
            expect(res.body.summary.total_symbols).toBe(5000);
            expect(res.body.summary.completion_percentage).toBe(70.0);
            expect(res.body.by_type).toHaveLength(1);
            expect(res.body.timestamp).toBeDefined();
        });

        it('should handle statistics errors', async () => {
            mockService.getStatistics.mockRejectedValue(new Error('Database error'));

            const res = await request(app)
                .get('/api/autocomplete/stats');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Statistics retrieval failed');
        });
    });

    // ========== PENDING ENDPOINT ==========

    describe('GET /pending', () => {
        it('should return pending symbols', async () => {
            mockService.getSymbolsNeedingMetadata.mockResolvedValue(['SYMBOL1', 'SYMBOL2', 'SYMBOL3']);

            const res = await request(app)
                .get('/api/autocomplete/pending');

            expect(res.status).toBe(200);
            expect(res.body.pending).toHaveLength(3);
            expect(res.body.count).toBe(3);
            expect(res.body.timestamp).toBeDefined();
        });

        it('should respect limit parameter', async () => {
            mockService.getSymbolsNeedingMetadata.mockResolvedValue([]);

            await request(app)
                .get('/api/autocomplete/pending')
                .query({ limit: 500 });

            expect(mockService.getSymbolsNeedingMetadata).toHaveBeenCalledWith(500);
        });

        it('should cap limit at 1000', async () => {
            mockService.getSymbolsNeedingMetadata.mockResolvedValue([]);

            await request(app)
                .get('/api/autocomplete/pending')
                .query({ limit: 5000 });

            expect(mockService.getSymbolsNeedingMetadata).toHaveBeenCalledWith(1000);
        });

        it('should handle pending retrieval errors', async () => {
            mockService.getSymbolsNeedingMetadata.mockRejectedValue(new Error('Database error'));

            const res = await request(app)
                .get('/api/autocomplete/pending');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Failed to retrieve pending symbols');
        });
    });

    // ========== REFRESH ENDPOINT ==========

    describe('POST /refresh/:symbol', () => {
        it('should refresh symbol metadata', async () => {
            mockService.refreshSymbolMetadata.mockResolvedValue();

            const res = await request(app)
                .post('/api/autocomplete/refresh/AAPL');

            expect(res.status).toBe(200);
            expect(res.body.symbol).toBe('AAPL');
            expect(res.body.action).toBe('refresh_initiated');
            expect(mockService.refreshSymbolMetadata).toHaveBeenCalledWith('AAPL');
        });

        it('should normalize symbol to uppercase', async () => {
            mockService.refreshSymbolMetadata.mockResolvedValue();

            await request(app)
                .post('/api/autocomplete/refresh/aapl');

            expect(mockService.refreshSymbolMetadata).toHaveBeenCalledWith('AAPL');
        });

        it('should trim whitespace from symbol', async () => {
            mockService.refreshSymbolMetadata.mockResolvedValue();

            await request(app)
                .post('/api/autocomplete/refresh/%20AAPL%20');

            expect(mockService.refreshSymbolMetadata).toHaveBeenCalledWith('AAPL');
        });

        it('should handle refresh errors', async () => {
            mockService.refreshSymbolMetadata.mockRejectedValue(new Error('Update failed'));

            const res = await request(app)
                .post('/api/autocomplete/refresh/AAPL');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Refresh failed');
        });
    });

    // ========== BULK REFRESH ENDPOINT ==========

    describe('POST /bulk-refresh', () => {
        it('should refresh multiple symbols', async () => {
            mockService.refreshSymbolMetadata.mockResolvedValue();

            const res = await request(app)
                .post('/api/autocomplete/bulk-refresh')
                .send({ symbols: ['AAPL', 'GOOGL', 'MSFT'] });

            expect(res.status).toBe(200);
            expect(res.body.action).toBe('bulk_refresh_initiated');
            expect(res.body.symbols_refreshed).toBe(3);
            expect(res.body.total_requested).toBe(3);
            expect(mockService.refreshSymbolMetadata).toHaveBeenCalledTimes(3);
        });

        it('should normalize symbols to uppercase', async () => {
            mockService.refreshSymbolMetadata.mockResolvedValue();

            await request(app)
                .post('/api/autocomplete/bulk-refresh')
                .send({ symbols: ['aapl', 'googl'] });

            expect(mockService.refreshSymbolMetadata).toHaveBeenNthCalledWith(1, 'AAPL');
            expect(mockService.refreshSymbolMetadata).toHaveBeenNthCalledWith(2, 'GOOGL');
        });

        it('should handle partial failures gracefully', async () => {
            mockService.refreshSymbolMetadata
                .mockResolvedValueOnce()
                .mockRejectedValueOnce(new Error('Error'))
                .mockResolvedValueOnce();

            const res = await request(app)
                .post('/api/autocomplete/bulk-refresh')
                .send({ symbols: ['AAPL', 'GOOGL', 'MSFT'] });

            expect(res.status).toBe(200);
            expect(res.body.symbols_refreshed).toBe(2); // Only 2 succeeded
            expect(res.body.total_requested).toBe(3);
        });

        it('should require symbols array', async () => {
            const res = await request(app)
                .post('/api/autocomplete/bulk-refresh')
                .send({ symbols: [] });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid request');
            expect(res.body.message).toContain('non-empty array');
        });

        it('should reject non-array symbols', async () => {
            const res = await request(app)
                .post('/api/autocomplete/bulk-refresh')
                .send({ symbols: 'AAPL' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid request');
        });
    });

    // ========== HEALTH ENDPOINT ==========

    describe('GET /health', () => {
        it('should return healthy status', async () => {
            const res = await request(app)
                .get('/api/autocomplete/health');

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('healthy');
            expect(res.body.service).toBe('autocomplete');
            expect(res.body.pool_available).toBe(true);
            expect(res.body.timestamp).toBeDefined();
        });
    });

    // ========== POOL INITIALIZATION TESTS ==========

    describe('Pool Initialization', () => {
        it('should return 503 if pool not initialized on protected endpoints', (done) => {
            // Create a new app without pool initialization
            // We need to reset the global pool state
            const { router: testRouter, initializePool: testInitPool } = require('../../../api/autocomplete');
            testInitPool(null); // Clear the pool

            const app2 = express();
            app2.use(express.json());
            app2.use('/api/autocomplete', testRouter);

            request(app2)
                .get('/api/autocomplete/search')
                .query({ q: 'test' })
                .expect(503)
                .end((err) => {
                    // Restore pool for remaining tests
                    initializePool(mockPool);
                    done(err);
                });
        });
    });

    // ========== ERROR HANDLING TESTS ==========

    describe('Error Handling', () => {
        it('should handle connection errors', async () => {
            mockService.searchSymbols.mockRejectedValue(new Error('Connection timeout'));

            const res = await request(app)
                .get('/api/autocomplete/search')
                .query({ q: 'test' });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Search failed');
            expect(res.body.message).toBeDefined();
        });

        it('should include timestamp on all successful responses', async () => {
            mockService.searchSymbols.mockResolvedValue([]);

            const res = await request(app)
                .get('/api/autocomplete/search')
                .query({ q: 'A' });

            expect(res.body.timestamp).toBeDefined();
            expect(new Date(res.body.timestamp)).toBeInstanceOf(Date);
        });
    });
});
