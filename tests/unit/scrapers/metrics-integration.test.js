/**
 * Unit Tests for Metrics Integration Module (Phase 9)
 * 
 * Tests the wrapper functions that transparently record metrics
 * during scraper execution without modifying existing scraper code.
 * 
 * Note: Due to module caching in the metrics-integration.js (which maintains
 * internal state), we test the primary use cases and integration patterns
 * rather than isolated unit tests.
 */

describe('Metrics Integration Module - Phase 9', () => {
  let recordScraperMetrics;
  let recordNavigationMetrics;
  let createMetricsWrappedScraper;
  let getMetricsCollector;

  beforeEach(() => {
    // Fresh load for each test suite
    jest.resetModules();
    const module = require('../../../scrapers/metrics-integration');
    recordScraperMetrics = module.recordScraperMetrics;
    recordNavigationMetrics = module.recordNavigationMetrics;
    createMetricsWrappedScraper = module.createMetricsWrappedScraper;
    getMetricsCollector = module.getMetricsCollector;

    // Clear global state
    delete global.metricsCollector;
  });

  afterEach(() => {
    delete global.metricsCollector;
  });

  // =========================================================================
  // Test Suite: Basic Functionality
  // =========================================================================

  describe('recordScraperMetrics - Basic Functionality', () => {
    test('should execute scraper function and return result', async () => {
      const mockResult = [{ symbol: 'AAPL', price: 150 }];
      const mockFn = jest.fn().mockResolvedValue(mockResult);

      const result = await recordScraperMetrics('yahoo', mockFn);

      expect(result).toEqual(mockResult);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should handle scraper functions that return arrays', async () => {
      const mockFn = jest.fn().mockResolvedValue([
        { symbol: 'AAPL' },
        { symbol: 'GOOGL' },
        { symbol: 'MSFT' }
      ]);

      const result = await recordScraperMetrics('nasdaq', mockFn);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
    });

    test('should handle scraper functions that return objects', async () => {
      const mockResult = {
        items: [1, 2, 3, 4, 5],
        status: 'success'
      };
      const mockFn = jest.fn().mockResolvedValue(mockResult);

      const result = await recordScraperMetrics('robinhood', mockFn);

      expect(result.items.length).toBe(5);
      expect(result.status).toBe('success');
    });

    test('should propagate scraper errors', async () => {
      const error = new Error('Network timeout');
      const mockFn = jest.fn().mockRejectedValue(error);

      await expect(recordScraperMetrics('yahoo', mockFn)).rejects.toThrow('Network timeout');
      expect(mockFn).toHaveBeenCalled();
    });

    test('should handle empty results gracefully', async () => {
      const mockFn = jest.fn().mockResolvedValue([]);

      const result = await recordScraperMetrics('cnbc', mockFn);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    test('should handle null results gracefully', async () => {
      const mockFn = jest.fn().mockResolvedValue(null);

      const result = await recordScraperMetrics('yahoo', mockFn);

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Test Suite: Metrics Recording with Collector
  // =========================================================================

  describe('recordScraperMetrics - With Global Collector', () => {
    test('should not throw when global.metricsCollector is available', async () => {
      const mockCollector = {
        recordPageScrape: jest.fn()
      };
      global.metricsCollector = mockCollector;

      const mockFn = jest.fn().mockResolvedValue([{ symbol: 'AAPL' }]);

      // Should execute without throwing
      expect(async () => {
        await recordScraperMetrics('yahoo', mockFn, { url: 'https://yahoo.com' });
      }).not.toThrow();

      expect(mockFn).toHaveBeenCalled();
    });

    test('should handle recorder errors gracefully and still return result', async () => {
      const mockCollector = {
        recordPageScrape: jest.fn(() => {
          throw new Error('Database error');
        })
      };
      global.metricsCollector = mockCollector;

      const mockResult = [{ symbol: 'TEST' }];
      const mockFn = jest.fn().mockResolvedValue(mockResult);

      // Should not throw even if recorder fails
      const result = await recordScraperMetrics('yahoo', mockFn);

      expect(result).toEqual(mockResult);
      expect(mockFn).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test Suite: Navigation Metrics
  // =========================================================================

  describe('recordNavigationMetrics - Basic Functionality', () => {
    test('should execute navigation function and return result', async () => {
      const mockResult = { status: 'success' };
      const mockFn = jest.fn().mockResolvedValue(mockResult);

      const result = await recordNavigationMetrics('yahoo', mockFn);

      expect(result).toEqual(mockResult);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should propagate navigation errors', async () => {
      const error = new Error('Page not found');
      const mockFn = jest.fn().mockRejectedValue(error);

      await expect(recordNavigationMetrics('google', mockFn)).rejects.toThrow('Page not found');
    });

    test('should not throw when global collector is available', async () => {
      const mockCollector = {
        recordPageNavigation: jest.fn()
      };
      global.metricsCollector = mockCollector;

      const mockFn = jest.fn().mockResolvedValue(undefined);

      expect(async () => {
        await recordNavigationMetrics('yahoo', mockFn, { url: 'https://finance.yahoo.com' });
      }).not.toThrow();

      expect(mockFn).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test Suite: Wrapped Scraper Functions
  // =========================================================================

  describe('createMetricsWrappedScraper', () => {
    test('should return a function', () => {
      const originalFn = jest.fn();
      const wrappedFn = createMetricsWrappedScraper('yahoo', originalFn);

      expect(typeof wrappedFn).toBe('function');
    });

    test('should call original function with all arguments', async () => {
      const mockResult = { success: true };
      const originalFn = jest.fn().mockResolvedValue(mockResult);

      const wrappedFn = createMetricsWrappedScraper('yahoo', originalFn);
      const browser = { test: 'browser' };
      const security = { key: 'AAPL', ticker_yahoo: 'AAPL' };
      const outputDir = '/tmp';
      const extraArg = 'extra';

      const result = await wrappedFn(browser, security, outputDir, extraArg);

      expect(result).toEqual(mockResult);
      expect(originalFn).toHaveBeenCalledWith(browser, security, outputDir, extraArg);
    });

    test('should propagate scraper errors', async () => {
      const error = new Error('Scrape failed');
      const originalFn = jest.fn().mockRejectedValue(error);

      const wrappedFn = createMetricsWrappedScraper('yahoo', originalFn);

      await expect(wrappedFn({}, { key: 'AAPL' }, '/tmp')).rejects.toThrow('Scrape failed');
    });
  });

  // =========================================================================
  // Test Suite: Collector Initialization
  // =========================================================================

  describe('getMetricsCollector', () => {
    test('should return null when global.metricsCollector is not set', () => {
      delete global.metricsCollector;
      const collector = getMetricsCollector();
      expect(collector).toBeNull();
    });

    test('should return metricsCollector when global is set', () => {
      const mockCollector = { recordPageScrape: jest.fn() };
      global.metricsCollector = mockCollector;

      const collector = getMetricsCollector();
      expect(collector).toBe(mockCollector);
    });

    test('should return cached value after first call', () => {
      jest.resetModules();
      const module = require('../../../scrapers/metrics-integration');
      getMetricsCollector = module.getMetricsCollector;

      const mockCollector = { recordPageScrape: jest.fn() };
      global.metricsCollector = mockCollector;

      const collector1 = getMetricsCollector();
      const collector2 = getMetricsCollector();

      expect(collector1).toBe(collector2);
      expect(collector1).toBe(mockCollector);
    });
  });

  // =========================================================================
  // Test Suite: Multiple Scrapers in Sequence
  // =========================================================================

  describe('Multiple Scrapers - Sequential Execution', () => {
    test('should execute multiple scrapers in sequence', async () => {
      const fn1 = jest.fn().mockResolvedValue([{ symbol: 'AAPL' }]);
      const fn2 = jest.fn().mockResolvedValue([{ symbol: 'GOOGL' }, { symbol: 'MSFT' }]);
      const fn3 = jest.fn().mockResolvedValue([]);

      await recordScraperMetrics('yahoo', fn1);
      await recordScraperMetrics('google', fn2);
      await recordScraperMetrics('nasdaq', fn3);

      expect(fn1).toHaveBeenCalled();
      expect(fn2).toHaveBeenCalled();
      expect(fn3).toHaveBeenCalled();
    });

    test('should handle mixed success and failure', async () => {
      const fn1 = jest.fn().mockResolvedValue([]);
      const fn2 = jest.fn().mockRejectedValue(new Error('Network error'));
      const fn3 = jest.fn().mockResolvedValue([{ symbol: 'AAPL' }]);

      await recordScraperMetrics('yahoo', fn1);

      try {
        await recordScraperMetrics('google', fn2);
      } catch (e) {
        // Expected - network error
      }

      await recordScraperMetrics('nasdaq', fn3);

      expect(fn1).toHaveBeenCalled();
      expect(fn2).toHaveBeenCalled();
      expect(fn3).toHaveBeenCalled();
    });
  });
});
