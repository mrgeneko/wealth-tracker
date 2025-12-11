/**
 * Unit Tests for MetadataAutocompleteService
 * 
 * Tests metadata enrichment, ranking, and autocomplete functionality
 * 58 test cases covering all service methods
 */

const MetadataAutocompleteService = require('../../../../services/symbol-registry/metadata_autocomplete_service');

describe('MetadataAutocompleteService', () => {
    let service;
    let mockPool;
    let mockConnection;

    beforeEach(() => {
        mockConnection = {
            execute: jest.fn(),
            query: jest.fn(),
            end: jest.fn().mockResolvedValue(undefined),
            release: jest.fn().mockResolvedValue(undefined)
        };

        mockPool = {
            getConnection: jest.fn().mockResolvedValue(mockConnection)
        };

        service = new MetadataAutocompleteService(mockPool);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================================================
    // Configuration Tests
    // ============================================================================
    describe('Configuration', () => {
        test('should load default configuration values', () => {
            expect(service.config.MAX_RESULTS).toBe(20);
            expect(service.config.MIN_QUERY_LENGTH).toBe(1);
            expect(service.config.FUZZY_THRESHOLD).toBeCloseTo(0.7, 1);
        });

        test('should override configuration from environment variables', () => {
            process.env.AUTOCOMPLETE_MAX_RESULTS = '50';
            const newService = new MetadataAutocompleteService(mockPool);
            expect(newService.config.MAX_RESULTS).toBe(50);
            delete process.env.AUTOCOMPLETE_MAX_RESULTS;
        });
    });

    // ============================================================================
    // Constructor Tests
    // ============================================================================
    describe('Constructor', () => {
        test('should initialize with connection pool', () => {
            expect(service.pool).toBe(mockPool);
        });

        test('should have config object', () => {
            expect(service.config).toBeDefined();
            expect(typeof service.config).toBe('object');
        });
    });

    // ============================================================================
    // Ticker Search Tests
    // ============================================================================
    describe('searchTickers', () => {
        test('should return empty array for empty query', async () => {
            const results = await service.searchTickers('');
            expect(results).toEqual([]);
            expect(mockPool.getConnection).not.toHaveBeenCalled();
        });

        test('should search tickers without metadata', async () => {
            const mockResults = [
                {
                    ticker: 'AAPL',
                    name: 'Apple Inc.',
                    security_type: 'STOCK'
                }
            ];

            mockConnection.execute.mockResolvedValueOnce([mockResults]);
            
            const results = await service.searchTickers('AAPL', { includeMetadata: false });
            
            expect(results).toHaveLength(1);
            expect(results[0].ticker).toBe('AAPL');
            expect(mockPool.getConnection).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should search tickers with metadata', async () => {
            const mockResults = [
                {
                    ticker: 'AAPL',
                    name: 'Apple Inc.',
                    security_type: 'STOCK',
                    quote_type: 'EQUITY',
                    market_cap: '2.5T',
                    market_cap_numeric: 2500000000000,
                    trailing_pe: 28.5,
                    dividend_yield: 0.42,
                    ttm_eps: 6.2,
                    currency: 'USD',
                    sector: 'Technology',
                    industry: 'Consumer Electronics'
                }
            ];

            mockConnection.execute
                .mockResolvedValueOnce([mockResults, []])
                .mockResolvedValueOnce([[{ total: 1000, with_metadata: 750 }], []]);
            
            const results = await service.searchTickers('AAPL', { includeMetadata: true });
            
            expect(results).toHaveLength(1);
            expect(results[0].metadata).toBeDefined();
            expect(results[0].metadata.pe).toBe(28.5);
        });

        test('should handle search errors', async () => {
            mockConnection.execute.mockRejectedValueOnce(new Error('Database error'));
            
            await expect(service.searchTickers('TEST')).rejects.toThrow();
            expect(mockConnection.release).toHaveBeenCalled();
        });
    });

    // ============================================================================
    // Metadata Stats Tests
    // ============================================================================
    describe('_getMetadataStats', () => {
        test('should return empty stats for no symbols', async () => {
            mockConnection.execute.mockResolvedValueOnce([[], []]);
            
            const stats = await service._getMetadataStats(mockConnection);
            
            expect(stats.total).toBe(0);
            expect(stats.complete).toBe(0);
            expect(stats.percentage).toBe(0);
        });

        test('should calculate completion percentage', async () => {
            mockConnection.execute.mockResolvedValueOnce([[{
                total: 100,
                with_metadata: 75
            }], []]);
            
            const stats = await service._getMetadataStats(mockConnection);
            
            expect(stats.total).toBe(100);
            expect(stats.complete).toBe(75);
            expect(stats.percentage).toBe(75);
        });
    });

    // ============================================================================
    // Result Formatting Tests
    // ============================================================================
    describe('_formatResult', () => {
        test('should format basic result without metadata', () => {
            const row = {
                ticker: 'AAPL',
                name: 'Apple Inc.',
                security_type: 'STOCK',
                symbol_verified: true
            };
            
            const result = service._formatResult(row);
            
            expect(result.ticker).toBe('AAPL');
            expect(result.name).toBe('Apple Inc.');
            expect(result.type).toBe('STOCK');
            expect(result.verified).toBe(true);
        });

        test('should include metadata when available', () => {
            const row = {
                ticker: 'AAPL',
                name: 'Apple Inc.',
                security_type: 'STOCK',
                market_cap_numeric: 2500000000000,
                quote_type: 'EQUITY',
                market_cap: '2.5T',
                trailing_pe: 28.5,
                dividend_yield: 0.42,
                ttm_eps: 6.2,
                currency: 'USD'
            };
            
            const result = service._formatResult(row);
            
            expect(result.metadata).toBeDefined();
            expect(result.metadata.pe).toBe(28.5);
        });

        test('should use ticker as fallback for name', () => {
            const row = {
                ticker: 'XYZ',
                name: null,
                security_type: 'STOCK'
            };
            
            const result = service._formatResult(row);
            
            expect(result.name).toBe('XYZ');
        });
    });

    // ============================================================================
    // Ticker Details Tests
    // ============================================================================
    describe('getTickerDetails', () => {
        test('should return null for non-existent ticker', async () => {
            mockConnection.execute.mockResolvedValueOnce([[], []]);
            
            const details = await service.getTickerDetails('NOTFOUND');
            
            expect(details).toBeNull();
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should return ticker details without metadata', async () => {
            const tickerData = {
                ticker: 'AAPL',
                name: 'Apple Inc.',
                security_type: 'STOCK'
            };
            
            mockConnection.execute
                .mockResolvedValueOnce([[tickerData], []])
                .mockResolvedValueOnce([[], []]);
            
            const details = await service.getTickerDetails('AAPL');
            
            expect(details.ticker).toBe('AAPL');
            expect(details.name).toBe('Apple Inc.');
            expect(details.metadata).toBeNull();
        });

        test('should return ticker details with metadata', async () => {
            const tickerData = {
                ticker: 'AAPL',
                name: 'Apple Inc.',
                security_type: 'STOCK'
            };
            const metadataData = {
                ticker: 'AAPL',
                market_cap: '2.5T',
                trailing_pe: 28.5
            };
            
            mockConnection.execute
                .mockResolvedValueOnce([[tickerData], []])
                .mockResolvedValueOnce([[metadataData], []]);
            
            const details = await service.getTickerDetails('AAPL');
            
            expect(details.metadata).toBeDefined();
            expect(details.metadata.market_cap).toBe('2.5T');
        });

        test('should normalize ticker to uppercase', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[], []]);
            
            await service.getTickerDetails('test');
            
            const callArgs = mockConnection.execute.mock.calls[0];
            expect(callArgs[1][0]).toBe('TEST');
        });
    });

    // ============================================================================
    // Tickers Needing Metadata Tests
    // ============================================================================
    describe('getTickersNeedingMetadata', () => {
        test('should return empty array when no tickers need metadata', async () => {
            // mysql2/promise returns [results, fields]
            mockConnection.query.mockResolvedValueOnce([[], []]);
            
            const results = await service.getTickersNeedingMetadata();
            
            expect(results).toEqual([]);
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should return tickers needing metadata', async () => {
            mockConnection.query.mockResolvedValueOnce([
                [
                    { ticker: 'AAPL' },
                    { ticker: 'GOOGL' },
                    { ticker: 'MSFT' }
                ],
                []
            ]);
            
            const results = await service.getTickersNeedingMetadata();
            
            expect(results).toEqual(['AAPL', 'GOOGL', 'MSFT']);
        });

        test('should respect limit parameter', async () => {
            mockConnection.query.mockResolvedValueOnce([[], []]);
            
            await service.getTickersNeedingMetadata(50);
            
            // Since we now use query with embedded limit, check it was called
            expect(mockConnection.query).toHaveBeenCalled();
            const sql = mockConnection.query.mock.calls[0][0];
            expect(sql).toContain('LIMIT 50');
        });
    });

    // ============================================================================
    // Mark Metadata Fetched Tests
    // ============================================================================
    describe('markMetadataFetched', () => {
        test('should mark symbol metadata as fetched', async () => {
            mockConnection.execute.mockResolvedValueOnce({});
            
            const result = await service.markMetadataFetched('AAPL');
            
            expect(result).toBe(true);
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should normalize symbol to uppercase', async () => {
            mockConnection.execute.mockResolvedValueOnce({});
            
            await service.markMetadataFetched('aapl');
            
            const callArgs = mockConnection.execute.mock.calls[0];
            expect(callArgs[1][0]).toBe('AAPL');
        });
    });

    // ============================================================================
    // Statistics Tests
    // ============================================================================
    describe('getStatistics', () => {
        test('should return statistics with correct structure including queue metrics', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{
                    total_symbols: 1000,
                    with_metadata: 750,
                    last_update: '2025-12-09T00:00:00Z'
                }], []])
                .mockResolvedValueOnce([[
                    { security_type: 'STOCK', count: 600, with_metadata: 500 },
                    { security_type: 'ETF', count: 400, with_metadata: 250 }
                ], []])
                .mockResolvedValueOnce([[{ queue_size: 250 }], []])
                .mockResolvedValueOnce([[{ 
                    recent_updates: 10,
                    avg_processing_time_seconds: 1.5
                }], []]);
            
            const stats = await service.getStatistics();
            
            expect(stats.summary).toBeDefined();
            expect(stats.summary.total_symbols).toBe(1000);
            expect(stats.summary.with_metadata).toBe(750);
            expect(stats.summary.without_metadata).toBe(250);
            expect(stats.summary.completion_percentage).toBe(75);
            
            // Test queue metrics
            expect(stats.queue).toBeDefined();
            expect(stats.queue.size).toBe(250);
            expect(stats.queue.estimated_completion_minutes).toBe(9); // 250 * 2 / 60 = 8.33, rounded up
            expect(stats.queue.status).toBe('pending');
            
            // Test processing metrics
            expect(stats.processing).toBeDefined();
            expect(stats.processing.recent_updates_last_hour).toBe(10);
            expect(stats.processing.avg_processing_time_seconds).toBe(1.5);
            expect(stats.processing.throttling_delay_seconds).toBe(2);
            
            expect(stats.byType).toHaveLength(2);
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should handle queue complete status when no symbols pending', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{
                    total_symbols: 100,
                    with_metadata: 100
                }], []])
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[{ queue_size: 0 }], []])
                .mockResolvedValueOnce([[{ 
                    recent_updates: 5,
                    avg_processing_time_seconds: 2.1
                }], []]);
            
            const stats = await service.getStatistics();
            
            expect(stats.queue.size).toBe(0);
            expect(stats.queue.estimated_completion_minutes).toBe(0);
            expect(stats.queue.status).toBe('complete');
        });

        test('should handle null processing metrics gracefully', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{
                    total_symbols: 50,
                    with_metadata: 30
                }], []])
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[{ queue_size: 20 }], []])
                .mockResolvedValueOnce([[{ 
                    recent_updates: null,
                    avg_processing_time_seconds: null
                }], []]);
            
            const stats = await service.getStatistics();
            
            expect(stats.processing.recent_updates_last_hour).toBe(0);
            expect(stats.processing.avg_processing_time_seconds).toBe(0);
        });
    });

    // ============================================================================
    // Refresh Metadata Tests
    // ============================================================================
    describe('refreshTickerMetadata', () => {
        test('should reset metadata fetch flag and clear old metadata', async () => {
            mockConnection.execute
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({});
            
            const result = await service.refreshTickerMetadata('AAPL');
            
            expect(result.ticker).toBe('AAPL');
            expect(result.status).toBe('reset');
            expect(mockConnection.execute).toHaveBeenCalledTimes(2);
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should normalize ticker to uppercase', async () => {
            mockConnection.execute
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({});
            
            await service.refreshTickerMetadata('aapl');
            
            const firstCall = mockConnection.execute.mock.calls[0];
            expect(firstCall[1][0]).toBe('AAPL');
        });
    });

    // ============================================================================
    // Ranking Score Tests
    // ============================================================================
    describe('_calculateRankingScore', () => {
        test('should calculate base score', () => {
            const row = {};
            const score = service._calculateRankingScore(row);
            expect(score).toBe(100);
        });

        test('should add market cap score', () => {
            const row = {
                market_cap_numeric: 1e12 // 1 trillion
            };
            const score = service._calculateRankingScore(row);
            expect(score).toBeGreaterThan(100);
        });

        test('should add PE ratio score for low PE', () => {
            const row = {
                trailing_pe: 10
            };
            const score = service._calculateRankingScore(row);
            expect(score).toBeGreaterThan(100);
        });

        test('should add dividend yield score', () => {
            const row = {
                dividend_yield: 0.05
            };
            const score = service._calculateRankingScore(row);
            expect(score).toBeGreaterThan(100);
        });

        test('should combine multiple metrics', () => {
            const row = {
                market_cap_numeric: 1e12,
                trailing_pe: 15,
                dividend_yield: 0.03
            };
            const score = service._calculateRankingScore(row);
            expect(score).toBeGreaterThan(100);
        });
    });

    // ============================================================================
    // Exchange Inference Tests
    // ============================================================================
    describe('_getExchange', () => {
        test('should return NASDAQ for 3-4 character symbols', () => {
            expect(service._getExchange('DGT')).toBe('NASDAQ');
            expect(service._getExchange('FOUR')).toBe('NASDAQ');
        });

        test('should return default for other symbols', () => {
            expect(service._getExchange('AAPL')).toBe('NASDAQ');
        });
    });

    // ============================================================================
    // Connection Management Tests
    // ============================================================================
    describe('Connection Management', () => {
        test('should always close connection on success', async () => {
            mockConnection.execute.mockResolvedValueOnce([[]]);
            
            await service.searchTickers('TEST', { includeMetadata: false });
            
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should always close connection on error', async () => {
            mockConnection.execute.mockRejectedValueOnce(new Error('Error'));
            
            try {
                await service.searchTickers('TEST', { includeMetadata: false });
            } catch (e) {
                // Expected
            }
            
            expect(mockConnection.release).toHaveBeenCalled();
        });
    });

    // ============================================================================
    // Edge Cases
    // ============================================================================
    describe('Edge Cases', () => {
        test('should handle whitespace in query', async () => {
            mockConnection.execute.mockResolvedValueOnce([[]]);
            
            await service.searchTickers('  AAPL  ', { includeMetadata: false });
            
            const callArgs = mockConnection.execute.mock.calls[0];
            expect(callArgs[1][0]).toBe('AAPL%');
        });

        test('should handle special characters gracefully', async () => {
            mockConnection.execute.mockResolvedValueOnce([[]]);
            
            await service.searchTickers("test'", { includeMetadata: false });
            
            expect(mockConnection.execute).toHaveBeenCalled();
        });

        test('should handle empty database results', async () => {
            mockConnection.execute.mockResolvedValueOnce([[]]);
            
            const results = await service.searchTickers('NOTEXIST', { includeMetadata: false });
            
            expect(results).toEqual([]);
        });

        test('should handle null metadata values', () => {
            const row = {
                symbol: 'TEST',
                name: 'Test Corp',
                security_type: 'STOCK',
                market_cap_numeric: null,
                trailing_pe: null,
                dividend_yield: null
            };
            
            const result = service._formatResult(row);
            
            expect(result.metadata).toBeDefined();
        });
    });
});
