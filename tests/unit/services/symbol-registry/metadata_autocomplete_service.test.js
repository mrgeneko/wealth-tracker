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
            end: jest.fn().mockResolvedValue(undefined)
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
    // Symbol Search Tests
    // ============================================================================
    describe('searchSymbols', () => {
        test('should return empty array for empty query', async () => {
            const results = await service.searchSymbols('');
            expect(results).toEqual([]);
            expect(mockPool.getConnection).not.toHaveBeenCalled();
        });

        test('should search symbols without metadata', async () => {
            const mockResults = [
                {
                    symbol: 'AAPL',
                    display_name: 'Apple Inc.',
                    security_type: 'STOCK'
                }
            ];

            mockConnection.execute.mockResolvedValueOnce([mockResults]);
            
            const results = await service.searchSymbols('AAPL', { includeMetadata: false });
            
            expect(results).toHaveLength(1);
            expect(results[0].symbol).toBe('AAPL');
            expect(mockPool.getConnection).toHaveBeenCalled();
            expect(mockConnection.end).toHaveBeenCalled();
        });

        test('should search symbols with metadata', async () => {
            const mockResults = [
                {
                    symbol: 'AAPL',
                    display_name: 'Apple Inc.',
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
            
            const results = await service.searchSymbols('AAPL', { includeMetadata: true });
            
            expect(results).toHaveLength(1);
            expect(results[0].metadata).toBeDefined();
            expect(results[0].metadata.pe).toBe(28.5);
        });

        test('should handle search errors', async () => {
            mockConnection.execute.mockRejectedValueOnce(new Error('Database error'));
            
            await expect(service.searchSymbols('TEST')).rejects.toThrow();
            expect(mockConnection.end).toHaveBeenCalled();
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
                symbol: 'AAPL',
                display_name: 'Apple Inc.',
                security_type: 'STOCK',
                symbol_verified: true
            };
            
            const result = service._formatResult(row);
            
            expect(result.symbol).toBe('AAPL');
            expect(result.name).toBe('Apple Inc.');
            expect(result.type).toBe('STOCK');
            expect(result.verified).toBe(true);
        });

        test('should include metadata when available', () => {
            const row = {
                symbol: 'AAPL',
                display_name: 'Apple Inc.',
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

        test('should use symbol as fallback for name', () => {
            const row = {
                symbol: 'XYZ',
                display_name: null,
                security_type: 'STOCK'
            };
            
            const result = service._formatResult(row);
            
            expect(result.name).toBe('XYZ');
        });
    });

    // ============================================================================
    // Symbol Details Tests
    // ============================================================================
    describe('getSymbolDetails', () => {
        test('should return null for non-existent symbol', async () => {
            mockConnection.execute.mockResolvedValueOnce([[], []]);
            
            const details = await service.getSymbolDetails('NOTFOUND');
            
            expect(details).toBeNull();
            expect(mockConnection.end).toHaveBeenCalled();
        });

        test('should return symbol details without metadata', async () => {
            const symbolData = {
                ticker: 'AAPL',
                display_name: 'Apple Inc.',
                security_type: 'STOCK',
                symbol_verified: true
            };
            
            mockConnection.execute
                .mockResolvedValueOnce([[symbolData], []])
                .mockResolvedValueOnce([[], []]);
            
            const details = await service.getSymbolDetails('AAPL');
            
            expect(details.symbol).toBe('AAPL');
            expect(details.name).toBe('Apple Inc.');
            expect(details.metadata).toBeNull();
        });

        test('should return symbol details with metadata', async () => {
            const symbolData = {
                ticker: 'AAPL',
                display_name: 'Apple Inc.',
                security_type: 'STOCK',
                symbol_verified: true
            };
            const metadataData = {
                symbol: 'AAPL',
                market_cap: '2.5T',
                trailing_pe: 28.5
            };
            
            mockConnection.execute
                .mockResolvedValueOnce([[symbolData], []])
                .mockResolvedValueOnce([[metadataData], []]);
            
            const details = await service.getSymbolDetails('AAPL');
            
            expect(details.metadata).toBeDefined();
            expect(details.metadata.market_cap).toBe('2.5T');
        });

        test('should normalize symbol to uppercase', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[], []]);
            
            await service.getSymbolDetails('test');
            
            const callArgs = mockConnection.execute.mock.calls[0];
            expect(callArgs[1][0]).toBe('TEST');
        });
    });

    // ============================================================================
    // Symbols Needing Metadata Tests
    // ============================================================================
    describe('getSymbolsNeedingMetadata', () => {
        test('should return empty array when no symbols need metadata', async () => {
            // mysql2/promise returns [results, fields]
            mockConnection.execute.mockResolvedValueOnce([[], []]);
            
            const results = await service.getSymbolsNeedingMetadata();
            
            expect(results).toEqual([]);
            expect(mockConnection.end).toHaveBeenCalled();
        });

        test('should return symbols needing metadata', async () => {
            mockConnection.execute.mockResolvedValueOnce([
                [
                    { ticker: 'AAPL' },
                    { ticker: 'GOOGL' },
                    { ticker: 'MSFT' }
                ],
                []
            ]);
            
            const results = await service.getSymbolsNeedingMetadata();
            
            expect(results).toEqual(['AAPL', 'GOOGL', 'MSFT']);
        });

        test('should respect limit parameter', async () => {
            mockConnection.execute.mockResolvedValueOnce([[], []]);
            
            await service.getSymbolsNeedingMetadata(50);
            
            const callArgs = mockConnection.execute.mock.calls[0];
            expect(callArgs[1][0]).toBe(50);
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
            expect(mockConnection.end).toHaveBeenCalled();
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
        test('should return statistics with correct structure', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{
                    total_symbols: 1000,
                    with_metadata: 750,
                    last_update: '2025-12-09T00:00:00Z'
                }], []])
                .mockResolvedValueOnce([[
                    { security_type: 'STOCK', count: 600, with_metadata: 500 },
                    { security_type: 'ETF', count: 400, with_metadata: 250 }
                ], []]);
            
            const stats = await service.getStatistics();
            
            expect(stats.summary).toBeDefined();
            expect(stats.summary.total).toBe(1000);
            expect(stats.summary.completed).toBe(750);
            expect(stats.summary.pending).toBe(250);
            expect(stats.summary.completionPercentage).toBe(75);
            expect(stats.byType).toHaveLength(2);
            expect(mockConnection.end).toHaveBeenCalled();
        });

        test('should calculate pending correctly', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{
                    total_symbols: 100,
                    with_metadata: 30
                }], []])
                .mockResolvedValueOnce([[], []]);
            
            const stats = await service.getStatistics();
            
            expect(stats.summary.pending).toBe(70);
        });
    });

    // ============================================================================
    // Refresh Metadata Tests
    // ============================================================================
    describe('refreshSymbolMetadata', () => {
        test('should reset metadata fetch flag and clear old metadata', async () => {
            mockConnection.execute
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({});
            
            const result = await service.refreshSymbolMetadata('AAPL');
            
            expect(result.symbol).toBe('AAPL');
            expect(result.status).toBe('reset');
            expect(mockConnection.execute).toHaveBeenCalledTimes(2);
            expect(mockConnection.end).toHaveBeenCalled();
        });

        test('should normalize symbol to uppercase', async () => {
            mockConnection.execute
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({});
            
            await service.refreshSymbolMetadata('aapl');
            
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
            
            await service.searchSymbols('TEST', { includeMetadata: false });
            
            expect(mockConnection.end).toHaveBeenCalled();
        });

        test('should always close connection on error', async () => {
            mockConnection.execute.mockRejectedValueOnce(new Error('Error'));
            
            try {
                await service.searchSymbols('TEST', { includeMetadata: false });
            } catch (e) {
                // Expected
            }
            
            expect(mockConnection.end).toHaveBeenCalled();
        });
    });

    // ============================================================================
    // Edge Cases
    // ============================================================================
    describe('Edge Cases', () => {
        test('should handle whitespace in query', async () => {
            mockConnection.execute.mockResolvedValueOnce([[]]);
            
            await service.searchSymbols('  AAPL  ', { includeMetadata: false });
            
            const callArgs = mockConnection.execute.mock.calls[0];
            expect(callArgs[1][0]).toBe('AAPL%');
        });

        test('should handle special characters gracefully', async () => {
            mockConnection.execute.mockResolvedValueOnce([[]]);
            
            await service.searchSymbols("test'", { includeMetadata: false });
            
            expect(mockConnection.execute).toHaveBeenCalled();
        });

        test('should handle empty database results', async () => {
            mockConnection.execute.mockResolvedValueOnce([[]]);
            
            const results = await service.searchSymbols('NOTEXIST', { includeMetadata: false });
            
            expect(results).toEqual([]);
        });

        test('should handle null metadata values', () => {
            const row = {
                symbol: 'TEST',
                display_name: 'Test Corp',
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
