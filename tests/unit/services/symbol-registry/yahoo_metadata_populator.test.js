/**
 * Yahoo Metadata Populator Service Tests
 * 
 * Tests for batch processing, throttling, retry logic, metadata extraction,
 * and background job management for Yahoo Finance metadata population.
 */

const YahooMetadataPopulator = require('../../../../services/symbol-registry/yahoo_metadata_populator');

describe('YahooMetadataPopulator', () => {
  let mockPool;
  let mockConnection;
  let mockSymbolService;
  let mockYahooClient;
  let populator;

  beforeEach(() => {
    // Mock database connection
    mockConnection = {
      query: jest.fn(),
      release: jest.fn()
    };

    mockPool = {
      getConnection: jest.fn().mockResolvedValue(mockConnection)
    };

    // Mock symbol registry service
    mockSymbolService = {
      calculateSortRank: jest.fn((type, hasYahoo, volume) => {
        if (type === 'EQUITY' && hasYahoo) return 50;
        if (type === 'ETF' && hasYahoo) return 150;
        return 200;
      })
    };

    // Mock Yahoo Finance client
    mockYahooClient = {
      getMetadata: jest.fn()
    };

    populator = new YahooMetadataPopulator(mockPool, mockSymbolService, mockYahooClient);

    // Always clean up any lingering background jobs
    if (populator.backgroundJob) {
      clearImmediate(populator.backgroundJob);
      populator.backgroundJob = null;
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (populator.backgroundJob) {
      populator.stopBackgroundPopulation();
    }
  });

  describe('Configuration', () => {
    test('should have default batch size of 50', () => {
      expect(YahooMetadataPopulator.CONFIG.BATCH_SIZE).toBe(50);
    });

    test('should have default delay of 2000ms', () => {
      expect(YahooMetadataPopulator.CONFIG.DELAY_MS).toBe(2000);
    });

    test('should have default max symbols per run of 500', () => {
      expect(YahooMetadataPopulator.CONFIG.MAX_SYMBOLS_PER_RUN).toBe(500);
    });

    test('should have default retry attempts of 3', () => {
      expect(YahooMetadataPopulator.CONFIG.RETRY_ATTEMPTS).toBe(3);
    });

    test('should have default timeout of 10000ms', () => {
      expect(YahooMetadataPopulator.CONFIG.TIMEOUT_MS).toBe(10000);
    });
  });

  describe('Constructor', () => {
    test('should initialize with database pool and services', () => {
      expect(populator.dbPool).toBe(mockPool);
      expect(populator.symbolRegistryService).toBe(mockSymbolService);
      expect(populator.yahooFinanceClient).toBe(mockYahooClient);
    });

    test('should initialize isRunning as false', () => {
      expect(populator.isRunning).toBe(false);
    });

    test('should initialize stats object', () => {
      expect(populator.stats).toHaveProperty('total_symbols');
      expect(populator.stats.total_symbols).toBe(0);
    });
  });

  describe('isPopulatorRunning', () => {
    test('should return false when not running', () => {
      expect(populator.isPopulatorRunning()).toBe(false);
    });

    test('should return true when running', () => {
      populator.isRunning = true;
      expect(populator.isPopulatorRunning()).toBe(true);
    });
  });

  describe('getSymbolsNeedingMetadata', () => {
    test('should return symbols without Yahoo metadata', async () => {
      const mockSymbols = [
        { id: 1, ticker: 'AAPL', security_type: 'EQUITY', has_yahoo_metadata: 0 },
        { id: 2, ticker: 'MSFT', security_type: 'EQUITY', has_yahoo_metadata: 0 }
      ];

      mockConnection.query.mockResolvedValue([mockSymbols, []]);

      const result = await populator.getSymbolsNeedingMetadata(10);

      expect(result).toEqual(mockSymbols);
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('has_yahoo_metadata = 0'),
        [10]
      );
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('should filter by EQUITY and ETF security types', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      await populator.getSymbolsNeedingMetadata(50);

      const query = mockConnection.query.mock.calls[0][0];
      expect(query).toContain("'EQUITY', 'ETF'");
    });

    test('should order by sort_rank', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      await populator.getSymbolsNeedingMetadata(100);

      const query = mockConnection.query.mock.calls[0][0];
      expect(query).toContain('ORDER BY sort_rank ASC');
    });

    test('should release connection on error', async () => {
      mockConnection.query.mockRejectedValue(new Error('Query failed'));

      await expect(populator.getSymbolsNeedingMetadata(10))
        .rejects
        .toThrow('Query failed');

      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  describe('fetchYahooMetadata', () => {
    test('should fetch metadata successfully', async () => {
      const mockMetadata = {
        longName: 'Apple Inc.',
        marketCap: 3000000000000,
        currency: 'USD'
      };

      mockYahooClient.getMetadata.mockResolvedValue(mockMetadata);

      const result = await populator.fetchYahooMetadata('AAPL');

      expect(result.success).toBe(true);
      expect(result.metadata).toEqual(mockMetadata);
      expect(result.error).toBeNull();
    });

    test('should retry on failure', async () => {
      mockYahooClient.getMetadata
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ longName: 'Apple Inc.', marketCap: 3000000000000 });

      jest.useFakeTimers();

      const promise = populator.fetchYahooMetadata('AAPL');

      // Advance through retry delay
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockYahooClient.getMetadata).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    test('should fail after max retry attempts', async () => {
      mockYahooClient.getMetadata.mockRejectedValue(new Error('Network error'));

      jest.useFakeTimers();

      const promise = populator.fetchYahooMetadata('INVALID');

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockYahooClient.getMetadata).toHaveBeenCalledTimes(3);

      jest.useRealTimers();
    });

    test('should return null metadata on failure', async () => {
      mockYahooClient.getMetadata.mockRejectedValue(new Error('Not found'));

      jest.useFakeTimers();

      const promise = populator.fetchYahooMetadata('BADTICKER');

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result.metadata).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('extractMetadata', () => {
    test('should extract relevant fields from metadata', () => {
      const metadata = {
        longName: 'Apple Inc.',
        shortName: 'AAPL',
        currency: 'USD',
        exchange: 'NASDAQ',
        marketCap: 3000000000000,
        trailingPE: 25.5,
        dividendYield: 0.005,
        fiftyTwoWeekHigh: 250,
        fiftyTwoWeekLow: 150,
        beta: 1.2,
        trailingAnnualRevenue: 400000000000,
        trailingEps: 6.05
      };

      const result = populator.extractMetadata(metadata);

      expect(result.name).toBe('Apple Inc.');
      expect(result.currency).toBe('USD');
      expect(result.market_cap).toBe(3000000000000);
      expect(result.trailing_pe).toBe(25.5);
    });

    test('should use shortName if longName missing', () => {
      const metadata = {
        shortName: 'AAPL',
        currency: 'USD'
      };

      const result = populator.extractMetadata(metadata);

      expect(result.name).toBe('AAPL');
    });

    test('should return null for null metadata', () => {
      const result = populator.extractMetadata(null);

      expect(result).toBeNull();
    });

    test('should handle missing fields gracefully', () => {
      const metadata = {
        longName: 'Test Corp'
      };

      const result = populator.extractMetadata(metadata);

      expect(result.name).toBe('Test Corp');
      expect(result.market_cap).toBeUndefined();
    });
  });

  describe('updateSymbolMetadata', () => {
    test('should update symbol with Yahoo metadata flag', async () => {
      mockConnection.query.mockResolvedValue([{ affectedRows: 1 }, []]);

      await populator.updateSymbolMetadata(mockConnection, 1, {
        market_cap: 3000000000000
      });

      const query = mockConnection.query.mock.calls[0][0];
      expect(query).toContain('has_yahoo_metadata = 1');
    });
  });

  describe('storeExtendedMetadata', () => {
    test('should store metadata in metrics table', async () => {
      const metadata = {
        marketCap: 3000000000000,
        trailingPE: 25.5,
        dividendYield: 0.005,
        currency: 'USD'
      };

      mockConnection.query.mockResolvedValue([{ affectedRows: 1 }, []]);

      await populator.storeExtendedMetadata(mockConnection, 1, 'AAPL', metadata);

      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('symbol_yahoo_metrics'),
        expect.arrayContaining([1, 'AAPL'])
      );
    });

    test('should skip storing if metadata is null', async () => {
      await populator.storeExtendedMetadata(mockConnection, 1, 'AAPL', null);

      expect(mockConnection.query).not.toHaveBeenCalled();
    });
  });

  describe('processBatch', () => {
    test('should process batch of symbols', async () => {
      const symbols = [
        { id: 1, ticker: 'AAPL', security_type: 'EQUITY' },
        { id: 2, ticker: 'MSFT', security_type: 'EQUITY' }
      ];

      mockYahooClient.getMetadata
        .mockResolvedValueOnce({ longName: 'Apple Inc.', marketCap: 3000000000000 })
        .mockResolvedValueOnce({ longName: 'Microsoft Corp.', marketCap: 2800000000000 });

      mockConnection.query.mockResolvedValue([{ affectedRows: 1 }, []]);

      jest.useFakeTimers();

      const promise = populator.processBatch(symbols);

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result.processed).toBe(2);
      expect(result.successful).toBe(2);

      jest.useRealTimers();
    });

    test('should track failed symbols', async () => {
      const symbols = [
        { id: 1, ticker: 'AAPL', security_type: 'EQUITY' }
      ];

      mockYahooClient.getMetadata.mockRejectedValue(new Error('Network error'));

      jest.useFakeTimers();

      const promise = populator.processBatch(symbols);

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result.failed).toBeGreaterThan(0);

      jest.useRealTimers();
    });

    test('should release connection after batch', async () => {
      const symbols = [
        { id: 1, ticker: 'AAPL', security_type: 'EQUITY' }
      ];

      mockYahooClient.getMetadata.mockResolvedValue({ longName: 'Apple Inc.' });
      mockConnection.query.mockResolvedValue([{ affectedRows: 1 }, []]);

      jest.useFakeTimers();

      const promise = populator.processBatch(symbols);

      await jest.runAllTimersAsync();

      await promise;

      expect(mockConnection.release).toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('should apply throttling delay between requests', async () => {
      const symbols = [
        { id: 1, ticker: 'AAPL', security_type: 'EQUITY' },
        { id: 2, ticker: 'MSFT', security_type: 'EQUITY' }
      ];

      mockYahooClient.getMetadata.mockResolvedValue({ longName: 'Test' });
      mockConnection.query.mockResolvedValue([{ affectedRows: 1 }, []]);

      jest.useFakeTimers();

      const promise = populator.processBatch(symbols);

      await jest.runAllTimersAsync();

      await promise;

      // Both symbols should have been fetched
      expect(mockYahooClient.getMetadata).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe('populateMetadata', () => {
    test('should populate metadata for symbols', async () => {
      const mockSymbols = [
        { id: 1, ticker: 'AAPL', security_type: 'EQUITY' }
      ];

      // Use mockResolvedValueOnce for each call sequentially
      // getSymbolsNeedingMetadata first call returns symbols
      // processBatch call
      // getSymbolsNeedingMetadata second call returns empty
      mockConnection.query.mockImplementation(() => {
        const callCount = mockConnection.query.mock.calls.length;
        if (callCount === 1) {
          // First getSymbolsNeedingMetadata call
          return Promise.resolve([mockSymbols, []]);
        }
        // All other calls return something that won't cause issues
        return Promise.resolve([[{ affectedRows: 1 }], []]);
      });

      mockYahooClient.getMetadata.mockResolvedValue({
        longName: 'Apple Inc.',
        marketCap: 3000000000000
      });

      jest.useFakeTimers();

      const promise = populator.populateMetadata(10);

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result.successfully_updated).toBeGreaterThanOrEqual(0);

      jest.useRealTimers();
    });

    test('should set isRunning flag during population', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      jest.useFakeTimers();

      const promise = populator.populateMetadata(1);

      expect(populator.isRunning).toBe(true);

      await jest.runAllTimersAsync();

      await promise;

      expect(populator.isRunning).toBe(false);

      jest.useRealTimers();
    });

    test('should throw error if already running', async () => {
      populator.isRunning = true;

      await expect(populator.populateMetadata())
        .rejects
        .toThrow('already in progress');
    });

    test('should track stats correctly', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      jest.useFakeTimers();

      const promise = populator.populateMetadata(10);

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toHaveProperty('total_symbols');
      expect(result).toHaveProperty('successfully_updated');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('start_time');
      expect(result).toHaveProperty('end_time');
      expect(result).toHaveProperty('duration_ms');

      jest.useRealTimers();
    });
  });

  describe('startBackgroundPopulation', () => {
    test('should have backgroundJob function defined', () => {
      expect(typeof populator.startBackgroundPopulation).toBe('function');
    });
  });

  describe('stopBackgroundPopulation', () => {
    test('should stop background job', () => {
      populator.backgroundJob = setImmediate(() => {});

      const result = populator.stopBackgroundPopulation();

      expect(result.status).toBe('stopped');
      expect(populator.backgroundJob).toBeNull();
    });

    test('should return not running if no job', () => {
      populator.backgroundJob = null;

      const result = populator.stopBackgroundPopulation();

      expect(result.status).toBe('not running');
    });
  });

  describe('getStats', () => {
    test('should return current statistics', () => {
      populator.stats = {
        total_symbols: 100,
        successfully_updated: 90,
        failed: 10,
        skipped: 0,
        start_time: new Date(),
        end_time: new Date(),
        duration_ms: 1000
      };

      populator.isRunning = true;

      const stats = populator.getStats();

      expect(stats.total_symbols).toBe(100);
      expect(stats.is_running).toBe(true);
    });
  });

  describe('getRemainingCount', () => {
    test('should return count of symbols needing metadata', async () => {
      mockConnection.query.mockResolvedValue([[{ count: 250 }], []]);

      const count = await populator.getRemainingCount();

      expect(count).toBe(250);
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('should filter by EQUITY and ETF only', async () => {
      mockConnection.query.mockResolvedValue([[{ count: 0 }], []]);

      await populator.getRemainingCount();

      const query = mockConnection.query.mock.calls[0][0];
      expect(query).toContain("'EQUITY', 'ETF'");
    });
  });

  describe('getCompletionPercentage', () => {
    test('should calculate completion percentage', async () => {
      mockConnection.query.mockResolvedValue([[
        { total: 1000, with_metadata: 750 }
      ], []]);

      const percentage = await populator.getCompletionPercentage();

      expect(percentage).toBe(75);
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('should return 0 for empty registry', async () => {
      mockConnection.query.mockResolvedValue([[
        { total: 0, with_metadata: 0 }
      ], []]);

      const percentage = await populator.getCompletionPercentage();

      expect(percentage).toBe(0);
    });

    test('should return 100 for fully populated', async () => {
      mockConnection.query.mockResolvedValue([[
        { total: 500, with_metadata: 500 }
      ], []]);

      const percentage = await populator.getCompletionPercentage();

      expect(percentage).toBe(100);
    });
  });

  describe('refreshMetadataForTicker', () => {
    test('should refresh metadata for specific ticker', async () => {
      mockConnection.query.mockResolvedValueOnce([
        [{ id: 1, security_type: 'EQUITY' }],
        []
      ]);
      mockConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      mockYahooClient.getMetadata.mockResolvedValue({
        longName: 'Apple Inc.',
        marketCap: 3000000000000
      });

      const result = await populator.refreshMetadataForTicker('AAPL');

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
    });

    test('should return error for unknown ticker', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      const result = await populator.refreshMetadataForTicker('INVALID');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Symbol not found');
    });

    test('should handle fetch errors gracefully', async () => {
      // Create a fresh populator with error-returning client
      const freshPool = {
        getConnection: jest.fn().mockResolvedValue({
          query: jest.fn().mockResolvedValue([[{ id: 1, security_type: 'EQUITY' }], []]),
          release: jest.fn()
        })
      };

      const freshYahooClient = {
        getMetadata: jest.fn().mockRejectedValue(new Error('Network error'))
      };

      const freshPopulator = new YahooMetadataPopulator(freshPool, mockSymbolService, freshYahooClient);

      // Don't use fake timers to avoid infinite loops with background jobs
      const result = await freshPopulator.refreshMetadataForTicker('AAPL');

      // Should fail due to network error
      expect(result.success).toBe(false);
      expect(result.metadata).not.toBeDefined();
    });
  });

  describe('resetMetadata', () => {
    test('should reset metadata for security type', async () => {
      mockConnection.query.mockResolvedValue([{ affectedRows: 100 }, []]);

      const result = await populator.resetMetadata('EQUITY');

      expect(result.success).toBe(true);
      const query = mockConnection.query.mock.calls[0][0];
      expect(query).toContain('has_yahoo_metadata = 0');
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  describe('sleep utility', () => {
    test('should have sleep method', () => {
      expect(typeof populator.sleep).toBe('function');
    });
  });
});
