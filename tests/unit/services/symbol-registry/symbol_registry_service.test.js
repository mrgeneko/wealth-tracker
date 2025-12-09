/**
 * Unit Tests for SymbolRegistryService
 */

const SymbolRegistryService = require('../../../../services/symbol-registry/symbol_registry_service');

describe('SymbolRegistryService', () => {
  let service;
  let mockPool;

  beforeEach(() => {
    // Mock database pool
    mockPool = {
      getConnection: jest.fn(async () => ({
        query: jest.fn(),
        release: jest.fn(),
        execute: jest.fn()
      }))
    };

    service = new SymbolRegistryService(mockPool);
  });

  describe('Configuration', () => {
    test('CONFIG should have default values', () => {
      expect(SymbolRegistryService.CONFIG).toHaveProperty('FILE_REFRESH_INTERVAL_HOURS');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('YAHOO_BATCH_SIZE');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('TREASURY_EXPIRY_CUTOFF_DAYS');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('AUTOCOMPLETE_MAX_RESULTS');
    });

    test('CONFIG values should be integers', () => {
      expect(typeof SymbolRegistryService.CONFIG.FILE_REFRESH_INTERVAL_HOURS).toBe('number');
      expect(typeof SymbolRegistryService.CONFIG.YAHOO_BATCH_SIZE).toBe('number');
      expect(typeof SymbolRegistryService.CONFIG.TREASURY_EXPIRY_CUTOFF_DAYS).toBe('number');
    });
  });

  describe('Sort Rank Calculation', () => {
    test('calculateSortRank should rank Equity as 100', () => {
      const rank = service.calculateSortRank('EQUITY', false, null);
      expect(rank).toBe(100);
    });

    test('calculateSortRank should rank ETF as 200', () => {
      const rank = service.calculateSortRank('ETF', false, null);
      expect(rank).toBe(200);
    });

    test('calculateSortRank should rank CRYPTO as 300', () => {
      const rank = service.calculateSortRank('CRYPTO', false, null);
      expect(rank).toBe(300);
    });

    test('calculateSortRank should rank INDEX as 400', () => {
      const rank = service.calculateSortRank('INDEX', false, null);
      expect(rank).toBe(400);
    });

    test('calculateSortRank should rank FX as 500', () => {
      const rank = service.calculateSortRank('FX', false, null);
      expect(rank).toBe(500);
    });

    test('calculateSortRank should rank FUTURES as 600', () => {
      const rank = service.calculateSortRank('FUTURES', false, null);
      expect(rank).toBe(600);
    });

    test('calculateSortRank should rank OPTION as 700', () => {
      const rank = service.calculateSortRank('OPTION', false, null);
      expect(rank).toBe(700);
    });

    test('calculateSortRank should rank TREASURY as 800', () => {
      const rank = service.calculateSortRank('TREASURY', false, null);
      expect(rank).toBe(800);
    });

    test('calculateSortRank should rank BOND as 850', () => {
      const rank = service.calculateSortRank('BOND', false, null);
      expect(rank).toBe(850);
    });

    test('calculateSortRank should rank OTHER as 1000', () => {
      const rank = service.calculateSortRank('OTHER', false, null);
      expect(rank).toBe(1000);
    });

    test('calculateSortRank should return default for unknown security type', () => {
      const rank = service.calculateSortRank('UNKNOWN_TYPE', false, null);
      expect(rank).toBe(1000);
    });

    test('calculateSortRank should apply -50 bonus for Yahoo metadata', () => {
      const rankWithoutMetadata = service.calculateSortRank('EQUITY', false, null);
      const rankWithMetadata = service.calculateSortRank('EQUITY', true, null);
      expect(rankWithMetadata).toBe(rankWithoutMetadata - 50);
    });

    test('calculateSortRank should apply volume bonus > $1B', () => {
      const baseRank = service.calculateSortRank('EQUITY', false, null);
      const rankWith1BVolume = service.calculateSortRank('EQUITY', false, 2000000000);
      expect(rankWith1BVolume).toBe(baseRank - 40);
    });

    test('calculateSortRank should apply volume bonus > $100M', () => {
      const baseRank = service.calculateSortRank('EQUITY', false, null);
      const rankWith100MVolume = service.calculateSortRank('EQUITY', false, 500000000);
      expect(rankWith100MVolume).toBe(baseRank - 30);
    });

    test('calculateSortRank should apply volume bonus > $10M', () => {
      const baseRank = service.calculateSortRank('EQUITY', false, null);
      const rankWith10MVolume = service.calculateSortRank('EQUITY', false, 50000000);
      expect(rankWith10MVolume).toBe(baseRank - 20);
    });

    test('calculateSortRank should apply volume bonus > $1M', () => {
      const baseRank = service.calculateSortRank('EQUITY', false, null);
      const rankWith1MVolume = service.calculateSortRank('EQUITY', false, 5000000);
      expect(rankWith1MVolume).toBe(baseRank - 10);
    });

    test('calculateSortRank should combine bonuses correctly', () => {
      // Equity (100) + Yahoo metadata (-50) + $1B volume (-40) = 10
      const rank = service.calculateSortRank('EQUITY', true, 2000000000);
      expect(rank).toBe(10);
    });
  });

  describe('Source Priority', () => {
    test('getSourcePriority should return 1 for NASDAQ_FILE', () => {
      expect(service.getSourcePriority('NASDAQ_FILE')).toBe(1);
    });

    test('getSourcePriority should return 2 for NYSE_FILE', () => {
      expect(service.getSourcePriority('NYSE_FILE')).toBe(2);
    });

    test('getSourcePriority should return 3 for OTHER_FILE', () => {
      expect(service.getSourcePriority('OTHER_FILE')).toBe(3);
    });

    test('getSourcePriority should return 4 for TREASURY_FILE', () => {
      expect(service.getSourcePriority('TREASURY_FILE')).toBe(4);
    });

    test('getSourcePriority should return 5 for TREASURY_HISTORICAL', () => {
      expect(service.getSourcePriority('TREASURY_HISTORICAL')).toBe(5);
    });

    test('getSourcePriority should return 6 for YAHOO', () => {
      expect(service.getSourcePriority('YAHOO')).toBe(6);
    });

    test('getSourcePriority should return 7 for USER_ADDED', () => {
      expect(service.getSourcePriority('USER_ADDED')).toBe(7);
    });

    test('getSourcePriority should return 999 for unknown source', () => {
      expect(service.getSourcePriority('UNKNOWN')).toBe(999);
    });

    test('shouldUpdateSource should return true when new source has higher priority', () => {
      // NASDAQ_FILE (1) > USER_ADDED (7)
      expect(service.shouldUpdateSource('USER_ADDED', 'NASDAQ_FILE')).toBe(true);
    });

    test('shouldUpdateSource should return false when old source has higher priority', () => {
      // NYSE_FILE (2) < YAHOO (6)
      expect(service.shouldUpdateSource('NYSE_FILE', 'YAHOO')).toBe(false);
    });

    test('shouldUpdateSource should return false when sources have equal priority', () => {
      expect(service.shouldUpdateSource('NASDAQ_FILE', 'NASDAQ_FILE')).toBe(false);
    });

    test('Source priority order should match design specification', () => {
      const sources = ['NASDAQ_FILE', 'NYSE_FILE', 'OTHER_FILE', 'TREASURY_FILE', 'TREASURY_HISTORICAL', 'YAHOO', 'USER_ADDED'];
      for (let i = 0; i < sources.length - 1; i++) {
        expect(service.getSourcePriority(sources[i])).toBeLessThan(
          service.getSourcePriority(sources[i + 1])
        );
      }
    });
  });

  describe('Constructor', () => {
    test('constructor should store database pool reference', () => {
      expect(service.dbPool).toBe(mockPool);
    });
  });

  describe('Configuration Environment Variables', () => {
    test('CONFIG should contain all expected environment variable keys', () => {
      expect(SymbolRegistryService.CONFIG).toHaveProperty('FILE_REFRESH_INTERVAL_HOURS');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('YAHOO_BATCH_SIZE');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('YAHOO_DELAY_MS');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('YAHOO_MAX_SYMBOLS_PER_RUN');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('TREASURY_EXPIRY_CUTOFF_DAYS');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('OPTION_EXPIRY_CUTOFF_DAYS');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('FUTURES_EXPIRY_CUTOFF_DAYS');
      expect(SymbolRegistryService.CONFIG).toHaveProperty('AUTOCOMPLETE_MAX_RESULTS');
    });

    test('All CONFIG values should be positive integers', () => {
      Object.entries(SymbolRegistryService.CONFIG).forEach(([key, value]) => {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      });
    });

    test('Default values should be reasonable', () => {
      expect(SymbolRegistryService.CONFIG.FILE_REFRESH_INTERVAL_HOURS).toBeGreaterThanOrEqual(1);
      expect(SymbolRegistryService.CONFIG.YAHOO_BATCH_SIZE).toBeGreaterThanOrEqual(10);
      expect(SymbolRegistryService.CONFIG.TREASURY_EXPIRY_CUTOFF_DAYS).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Security Type Ranking Priority', () => {
    test('Equity should rank better than ETF', () => {
      const equityRank = service.calculateSortRank('EQUITY', false, null);
      const etfRank = service.calculateSortRank('ETF', false, null);
      expect(equityRank).toBeLessThan(etfRank);
    });

    test('ETF should rank better than Crypto', () => {
      const etfRank = service.calculateSortRank('ETF', false, null);
      const cryptoRank = service.calculateSortRank('CRYPTO', false, null);
      expect(etfRank).toBeLessThan(cryptoRank);
    });

    test('Crypto should rank better than Index', () => {
      const cryptoRank = service.calculateSortRank('CRYPTO', false, null);
      const indexRank = service.calculateSortRank('INDEX', false, null);
      expect(cryptoRank).toBeLessThan(indexRank);
    });

    test('Index should rank better than FX', () => {
      const indexRank = service.calculateSortRank('INDEX', false, null);
      const fxRank = service.calculateSortRank('FX', false, null);
      expect(indexRank).toBeLessThan(fxRank);
    });

    test('FX should rank better than Futures', () => {
      const fxRank = service.calculateSortRank('FX', false, null);
      const futuresRank = service.calculateSortRank('FUTURES', false, null);
      expect(fxRank).toBeLessThan(futuresRank);
    });

    test('Futures should rank better than Option', () => {
      const futuresRank = service.calculateSortRank('FUTURES', false, null);
      const optionRank = service.calculateSortRank('OPTION', false, null);
      expect(futuresRank).toBeLessThan(optionRank);
    });

    test('Option should rank better than Treasury', () => {
      const optionRank = service.calculateSortRank('OPTION', false, null);
      const treasuryRank = service.calculateSortRank('TREASURY', false, null);
      expect(optionRank).toBeLessThan(treasuryRank);
    });

    test('Treasury should rank better than Other', () => {
      const treasuryRank = service.calculateSortRank('TREASURY', false, null);
      const otherRank = service.calculateSortRank('OTHER', false, null);
      expect(treasuryRank).toBeLessThan(otherRank);
    });
  });
});
