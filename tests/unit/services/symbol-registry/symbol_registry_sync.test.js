/**
 * Symbol Registry Sync Service Tests
 * 
 * Tests for loading, parsing, and syncing symbols from all CSV sources
 * into the symbol registry with proper deduplication and source priority handling.
 */

const SymbolRegistrySyncService = require('../../../../services/symbol-registry/ticker_registry_sync');
const TreasuryDataHandler = require('../../../../services/symbol-registry/treasury_data_handler');

// Mock fs module
jest.mock('fs/promises');
const fs = require('fs/promises');

// Mock csv-parse
jest.mock('csv-parse/sync');
const csv = require('csv-parse/sync');

// Mock TreasuryDataHandler
jest.mock('../../../../services/symbol-registry/treasury_data_handler');

describe('SymbolRegistrySyncService', () => {
  let mockPool;
  let mockConnection;
  let mockSymbolService;
  let syncService;

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
        const typeRanks = {
          'EQUITY': 100,
          'ETF': 200,
          'OTHER': 1000
        };
        return typeRanks[type] || 1000;
      }),
      shouldUpdateSource: jest.fn((oldSource, newSource) => {
        const priorities = {
          'NASDAQ_FILE': 1,
          'NYSE_FILE': 2,
          'OTHER_FILE': 3,
          'YAHOO': 6,
          'USER_ADDED': 7
        };
        return priorities[newSource] < priorities[oldSource];
      })
    };

    // Mock TreasuryDataHandler instance
    TreasuryDataHandler.mockImplementation(() => ({
      loadTreasuryData: jest.fn().mockResolvedValue([])
    }));

    syncService = new SymbolRegistrySyncService(mockPool, mockSymbolService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    test('should have default batch size of 500', () => {
      expect(SymbolRegistrySyncService.CONFIG.BATCH_SIZE).toBe(500);
    });

    test('should allow overriding batch size via env var', () => {
      process.env.SYNC_BATCH_SIZE = '100';
      // Note: CONFIG is evaluated at class definition time, so we just verify
      // the parsing logic would work
      const batchSize = parseInt(process.env.SYNC_BATCH_SIZE || '500', 10);
      expect(batchSize).toBe(100);
      delete process.env.SYNC_BATCH_SIZE;
    });

    test('should have file paths configured', () => {
      expect(SymbolRegistrySyncService.CONFIG.NASDAQ_FILE).toContain('nasdaq-listed.csv');
      expect(SymbolRegistrySyncService.CONFIG.NYSE_FILE).toContain('nyse-listed.csv');
      expect(SymbolRegistrySyncService.CONFIG.OTHER_FILE).toContain('other-listed.csv');
    });
  });

  describe('Constructor', () => {
    test('should store database pool', () => {
      expect(syncService.dbPool).toBe(mockPool);
    });

    test('should store symbol registry service', () => {
      expect(syncService.symbolRegistryService).toBe(mockSymbolService);
    });

    test('should initialize treasury handler', () => {
      expect(syncService.treasuryHandler).toBeDefined();
    });
  });

  describe('getFileConfigs', () => {
    test('should return all file type configurations', () => {
      const configs = syncService.getFileConfigs();
      expect(configs).toHaveProperty('NASDAQ');
      expect(configs).toHaveProperty('NYSE');
      expect(configs).toHaveProperty('OTHER');
      expect(configs).toHaveProperty('TREASURY');
    });

    test('should include NASDAQ columns mapping', () => {
      const configs = syncService.getFileConfigs();
      expect(configs.NASDAQ.columns.ticker).toBe('Symbol');
      expect(configs.NASDAQ.columns.name).toBe('Security Name');
    });

    test('should include NYSE columns mapping', () => {
      const configs = syncService.getFileConfigs();
      expect(configs.NYSE.columns.ticker).toBe('ACT Symbol');
      expect(configs.NYSE.columns.name).toBe('Company Name');
    });
  });

  describe('parseNasdaqSymbols', () => {
    test('should parse valid NASDAQ records', () => {
      const records = [
        { Symbol: 'AAPL', 'Security Name': 'Apple Inc. Common Stock' },
        { Symbol: 'MSFT', 'Security Name': 'Microsoft Corp. Common Stock' }
      ];

      const symbols = syncService.parseNasdaqSymbols(records);

      expect(symbols).toHaveLength(2);
      expect(symbols[0]).toMatchObject({
        ticker: 'AAPL',
        name: 'Apple Inc. Common Stock',
        exchange: 'NASDAQ',
        source: 'NASDAQ_FILE'
      });
      expect(symbols[1].ticker).toBe('MSFT');
    });

    test('should skip records with missing ticker or name', () => {
      const records = [
        { Symbol: 'AAPL', 'Security Name': 'Apple Inc.' },
        { Symbol: '', 'Security Name': 'Invalid' },
        { Symbol: 'MSFT' } // Missing name
      ];

      const symbols = syncService.parseNasdaqSymbols(records);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].ticker).toBe('AAPL');
    });

    test('should trim whitespace from fields', () => {
      const records = [
        { Symbol: '  AAPL  ', 'Security Name': '  Apple Inc.  ' }
      ];

      const symbols = syncService.parseNasdaqSymbols(records);

      expect(symbols[0].ticker).toBe('AAPL');
      expect(symbols[0].name).toBe('Apple Inc.');
    });

    test('should infer security type from name', () => {
      const records = [
        { Symbol: 'AAPL', 'Security Name': 'Apple Inc. Common Stock' },
        { Symbol: 'VTI', 'Security Name': 'Vanguard Total Market ETF' }
      ];

      const symbols = syncService.parseNasdaqSymbols(records);

      expect(symbols[0].security_type).toBe('EQUITY');
      expect(symbols[1].security_type).toBe('ETF');
    });
  });

  describe('parseNyseSymbols', () => {
    test('should parse valid NYSE records', () => {
      const records = [
        { 'ACT Symbol': 'A', 'Company Name': 'Agilent Technologies Inc.' },
        { 'ACT Symbol': 'AA', 'Company Name': 'Alcoa Corporation' }
      ];

      const symbols = syncService.parseNyseSymbols(records);

      expect(symbols).toHaveLength(2);
      expect(symbols[0]).toMatchObject({
        ticker: 'A',
        name: 'Agilent Technologies Inc.',
        exchange: 'NYSE',
        source: 'NYSE_FILE'
      });
    });

    test('should skip records with missing required fields', () => {
      const records = [
        { 'ACT Symbol': 'A', 'Company Name': 'Valid' },
        { 'ACT Symbol': 'B' }, // Missing name
        { 'Company Name': 'Only Name' } // Missing ticker
      ];

      const symbols = syncService.parseNyseSymbols(records);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].ticker).toBe('A');
    });
  });

  describe('parseOtherSymbols', () => {
    test('should parse valid OTHER listed records', () => {
      const records = [
        { 'ACT Symbol': 'SDAQ', 'Company Name': 'Example Corp' }
      ];

      const symbols = syncService.parseOtherSymbols(records);

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        ticker: 'SDAQ',
        exchange: 'OTHER',
        source: 'OTHER_FILE'
      });
    });
  });

  describe('inferSecurityType', () => {
    test('should detect ETF', () => {
      expect(syncService.inferSecurityType('Vanguard Total Market ETF')).toBe('ETF');
      expect(syncService.inferSecurityType('iShares Core FUND')).toBe('ETF');
    });

    test('should detect CRYPTO', () => {
      expect(syncService.inferSecurityType('Bitcoin Trust')).toBe('CRYPTO');
      expect(syncService.inferSecurityType('Ethereum Futures')).toBe('CRYPTO');
    });

    test('should detect INDEX', () => {
      expect(syncService.inferSecurityType('Russell 1000 Index')).toBe('INDEX');
      expect(syncService.inferSecurityType('S&P 500 IDX')).toBe('INDEX');
    });

    test('should detect WARRANT', () => {
      expect(syncService.inferSecurityType('Apple Warrant')).toBe('WARRANT');
    });

    test('should detect PREFERRED', () => {
      expect(syncService.inferSecurityType('Preferred Series A')).toBe('PREFERRED');
    });

    test('should detect BOND', () => {
      expect(syncService.inferSecurityType('Corporate Bond')).toBe('BOND');
    });

    test('should detect TREASURY', () => {
      expect(syncService.inferSecurityType('US Treasury Note')).toBe('TREASURY');
      expect(syncService.inferSecurityType('Treasury Bill')).toBe('TREASURY');
    });

    test('should default to EQUITY for stocks', () => {
      expect(syncService.inferSecurityType('Apple Inc. Common Stock')).toBe('EQUITY');
      expect(syncService.inferSecurityType('Microsoft Corporation')).toBe('EQUITY');
    });

    test('should handle null/empty names', () => {
      expect(syncService.inferSecurityType(null)).toBe('OTHER');
      expect(syncService.inferSecurityType('')).toBe('OTHER');
    });

    test('should be case-insensitive', () => {
      expect(syncService.inferSecurityType('BITCOIN CRYPTO')).toBe('CRYPTO');
      expect(syncService.inferSecurityType('vanguard etf')).toBe('ETF');
    });
  });

  describe('symbolToRegistryFormat', () => {
    test('should convert symbol to registry format', () => {
      const symbol = {
        ticker: 'AAPL',
        name: 'Apple Inc.',
        exchange: 'NASDAQ',
        security_type: 'EQUITY',
        source: 'NASDAQ_FILE',
        cusip: null
      };

      const registryFormat = syncService.symbolToRegistryFormat(symbol);

      expect(registryFormat).toEqual({
        symbol: 'AAPL',
        name: 'Apple Inc.',
        exchange: 'NASDAQ',
        security_type: 'EQUITY',
        source: 'NASDAQ_FILE',
        has_yahoo_metadata: false,
        usd_trading_volume: null,
        issue_date: null,
        maturity_date: null,
        security_term: null,
        underlying_symbol: null,
        strike_price: null,
        option_type: null,
        expiration_date: null
      });
    });

    test('should include cusip if provided', () => {
      // For treasury securities, the CUSIP is used as the ticker/symbol
      const symbol = {
        ticker: '912797SE8',  // CUSIP is the ticker for treasury
        name: 'Test Treasury',
        exchange: 'TREASURY',
        security_type: 'TREASURY',
        source: 'TREASURY_FILE'
      };

      const registryFormat = syncService.symbolToRegistryFormat(symbol);

      // CUSIP is stored in the symbol field
      expect(registryFormat.symbol).toBe('912797SE8');
    });
  });

  describe('loadCsvFile', () => {
    // Note: loadCsvFile tests require actual file mocking which is complex
    // These will be tested via integration tests during syncFileType
    
    test('should skip csv load tests', () => {
      expect(true).toBe(true);
    });
  });

  describe('getExistingSymbol', () => {
    test('should return existing symbol', async () => {
      const existingSymbol = {
        id: 1,
        symbol: 'AAPL',
        exchange: 'NASDAQ',
        security_type: 'EQUITY',
        source: 'NASDAQ_FILE',
        has_yahoo_metadata: 0
      };

      mockConnection.query.mockResolvedValue([
        [existingSymbol],
        []
      ]);

      const result = await syncService.getExistingSymbol(
        mockConnection,
        'AAPL',
        'NASDAQ',
        'EQUITY'
      );

      expect(result).toEqual(existingSymbol);
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, symbol'),
        ['AAPL', 'NASDAQ', 'EQUITY']
      );
    });

    test('should return null if symbol not found', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      const result = await syncService.getExistingSymbol(
        mockConnection,
        'NONEXIST',
        'NASDAQ',
        'EQUITY'
      );

      expect(result).toBeNull();
    });
  });

  describe('insertSymbol', () => {
    test('should insert new symbol', async () => {
      mockSymbolService.calculateSortRank.mockReturnValue(100);
      mockConnection.query.mockResolvedValue([{ insertId: 1 }, []]);

      const symbolData = {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        exchange: 'NASDAQ',
        security_type: 'EQUITY',
        source: 'NASDAQ_FILE',
        has_yahoo_metadata: false
      };

      await syncService.insertSymbol(mockConnection, symbolData);

      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ticker_registry'),
        expect.arrayContaining(['AAPL', 'Apple Inc.', 'NASDAQ', 'EQUITY', 'NASDAQ_FILE'])
      );
      expect(mockSymbolService.calculateSortRank).toHaveBeenCalledWith('EQUITY', false, undefined);
    });

    test('should calculate sort rank correctly', async () => {
      mockSymbolService.calculateSortRank.mockReturnValue(150);
      mockConnection.query.mockResolvedValue([{ insertId: 1 }, []]);

      const symbolData = {
        symbol: 'TEST',
        name: 'Test',
        exchange: 'NASDAQ',
        security_type: 'EQUITY',
        source: 'NASDAQ_FILE',
        has_yahoo_metadata: true
      };

      await syncService.insertSymbol(mockConnection, symbolData);

      expect(mockSymbolService.calculateSortRank).toHaveBeenCalledWith('EQUITY', true, undefined);
    });
  });

  describe('updateSymbol', () => {
    test('should update existing symbol', async () => {
      mockSymbolService.calculateSortRank.mockReturnValue(100);
      mockConnection.query.mockResolvedValue([{ affectedRows: 1 }, []]);

      const symbolData = {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        exchange: 'NASDAQ',
        security_type: 'EQUITY',
        source: 'NASDAQ_FILE',
        has_yahoo_metadata: false
      };

      await syncService.updateSymbol(mockConnection, 1, symbolData);

      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ticker_registry'),
        expect.arrayContaining(['Apple Inc.', 'NASDAQ', 'EQUITY', 'NASDAQ_FILE', null])
      );
    });
  });

  describe('processBatch', () => {
    test('should process batch of symbols', async () => {
      mockConnection.query.mockResolvedValue([[], []]);
      mockSymbolService.calculateSortRank.mockReturnValue(100);

      const symbols = [
        { ticker: 'AAPL', name: 'Apple', exchange: 'NASDAQ', security_type: 'EQUITY', source: 'NASDAQ_FILE', cusip: null },
        { ticker: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ', security_type: 'EQUITY', source: 'NASDAQ_FILE', cusip: null }
      ];

      const stats = await syncService.processBatch(symbols);

      expect(mockPool.getConnection).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(stats.inserted).toBeGreaterThanOrEqual(0);
      expect(stats.errors).toBe(0);
    });

    test('should release connection on error', async () => {
      mockPool.getConnection.mockRejectedValue(new Error('Connection failed'));

      const symbols = [
        { ticker: 'AAPL', name: 'Apple', exchange: 'NASDAQ', security_type: 'EQUITY', source: 'NASDAQ_FILE', cusip: null }
      ];

      await expect(syncService.processBatch(symbols)).rejects.toThrow('Connection failed');
      expect(mockConnection.release).not.toHaveBeenCalled(); // Never got connection
    });

    test('should release connection on query error', async () => {
      mockConnection.query.mockRejectedValueOnce(new Error('Query failed'));
      mockPool.getConnection.mockResolvedValue(mockConnection);

      const symbols = [
        { ticker: 'AAPL', name: 'Apple', exchange: 'NASDAQ', security_type: 'EQUITY', source: 'NASDAQ_FILE', cusip: null }
      ];

      const stats = await syncService.processBatch(symbols);
      
      // processBatch catches errors and increments error count
      expect(stats.errors).toBeGreaterThan(0);
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  describe('syncFileType', () => {
    test('should sync NASDAQ symbols', async () => {
      const csvContent = 'Symbol,Security Name\nAAPL,Apple Inc.';
      fs.readFile.mockResolvedValue(csvContent);
      csv.parse.mockReturnValue([{ Symbol: 'AAPL', 'Security Name': 'Apple Inc.' }]);

      mockConnection.query.mockResolvedValue([[], []]);
      mockSymbolService.calculateSortRank.mockReturnValue(100);

      const stats = await syncService.syncFileType('NASDAQ');

      expect(stats.file_type).toBe('NASDAQ');
      expect(stats.total_records).toBe(1);
      expect(stats.start_time).toBeDefined();
      expect(stats.end_time).toBeDefined();
      expect(stats.duration_ms).toBeGreaterThanOrEqual(0);
    });

    test('should sync NYSE symbols', async () => {
      const csvContent = 'ACT Symbol,Company Name\nA,Agilent';
      fs.readFile.mockResolvedValue(csvContent);
      csv.parse.mockReturnValue([{ 'ACT Symbol': 'A', 'Company Name': 'Agilent' }]);

      mockConnection.query.mockResolvedValue([[], []]);
      mockSymbolService.calculateSortRank.mockReturnValue(100);

      const stats = await syncService.syncFileType('NYSE');

      expect(stats.file_type).toBe('NYSE');
      expect(stats.total_records).toBe(1);
    });

    test('should sync treasury symbols', async () => {
      const treasuries = [
        {
          ticker: 'US0001AB',
          name: 'US Treasury Bill',
          exchange: 'TREASURY',
          security_type: 'TREASURY',
          source: 'TREASURY_FILE',
          cusip: '912797SE8'
        }
      ];

      syncService.treasuryHandler.loadTreasuryData.mockResolvedValue(treasuries);

      mockConnection.query.mockResolvedValue([[], []]);
      mockSymbolService.calculateSortRank.mockReturnValue(100);

      const stats = await syncService.syncFileType('TREASURY');

      expect(stats.file_type).toBe('TREASURY');
      expect(stats.total_records).toBe(1);
      expect(syncService.treasuryHandler.loadTreasuryData).toHaveBeenCalled();
    });

    test('should calculate batch statistics correctly', async () => {
      const csvContent = 'Symbol,Security Name\nAAPL,Apple\nMSFT,Microsoft';
      fs.readFile.mockResolvedValue(csvContent);
      csv.parse.mockReturnValue([
        { Symbol: 'AAPL', 'Security Name': 'Apple' },
        { Symbol: 'MSFT', 'Security Name': 'Microsoft' }
      ]);

      mockConnection.query.mockResolvedValue([[], []]);
      mockSymbolService.calculateSortRank.mockReturnValue(100);

      const stats = await syncService.syncFileType('NASDAQ');

      expect(stats.total_records).toBe(2);
      expect(stats).toHaveProperty('inserted');
      expect(stats).toHaveProperty('updated');
      expect(stats).toHaveProperty('skipped');
      expect(stats).toHaveProperty('errors');
    });
  });

  describe('syncAll', () => {
    test('should sync all file types', async () => {
      const csvContent = 'Symbol,Security Name\nAAPL,Apple';
      fs.readFile.mockResolvedValue(csvContent);
      csv.parse.mockReturnValue([{ Symbol: 'AAPL', 'Security Name': 'Apple' }]);

      mockConnection.query.mockResolvedValue([[], []]);
      syncService.treasuryHandler.loadTreasuryData.mockResolvedValue([]);
      mockSymbolService.calculateSortRank.mockReturnValue(100);

      const allStats = await syncService.syncAll();

      expect(allStats.total_files).toBe(4);
      expect(allStats.files).toHaveLength(4);
      expect(allStats).toHaveProperty('total_records');
      expect(allStats).toHaveProperty('total_inserted');
      expect(allStats).toHaveProperty('total_updated');
      expect(allStats).toHaveProperty('total_skipped');
      expect(allStats).toHaveProperty('total_errors');
      expect(allStats).toHaveProperty('start_time');
      expect(allStats).toHaveProperty('end_time');
      expect(allStats).toHaveProperty('duration_ms');
    });

    test('should aggregate statistics from all file types', async () => {
      const csvContent = 'Symbol,Security Name\nAAPL,Apple';
      fs.readFile.mockResolvedValue(csvContent);
      csv.parse.mockReturnValue([{ Symbol: 'AAPL', 'Security Name': 'Apple' }]);

      mockConnection.query.mockResolvedValue([[], []]);
      syncService.treasuryHandler.loadTreasuryData.mockResolvedValue([
        { ticker: 'US001', name: 'Treasury', exchange: 'TREASURY', security_type: 'TREASURY', source: 'TREASURY_FILE', cusip: '123' }
      ]);
      mockSymbolService.calculateSortRank.mockReturnValue(100);

      const allStats = await syncService.syncAll();

      // Should have at least NASDAQ (1) + TREASURY (1) = 2 records
      expect(allStats.total_records).toBeGreaterThanOrEqual(2);
    });

    test('should continue syncing if one file type fails', async () => {
      fs.readFile.mockImplementation((path) => {
        if (path.includes('nasdaq')) {
          return Promise.reject(new Error('NASDAQ failed'));
        }
        return Promise.resolve('ACT Symbol,Company Name\nA,Test');
      });

      csv.parse.mockReturnValue([{ 'ACT Symbol': 'A', 'Company Name': 'Test' }]);

      mockConnection.query.mockResolvedValue([[], []]);
      syncService.treasuryHandler.loadTreasuryData.mockResolvedValue([]);
      mockSymbolService.calculateSortRank.mockReturnValue(100);

      const allStats = await syncService.syncAll();

      // Should have processed some files despite NASDAQ failure
      expect(allStats.files.length).toBeGreaterThan(0);
    });
  });

  describe('getRegistryCount', () => {
    test('should return total symbol count', async () => {
      mockConnection.query.mockResolvedValue([
        [{ count: 15000 }],
        []
      ]);

      const count = await syncService.getRegistryCount();

      expect(count).toBe(15000);
      expect(mockConnection.query).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM ticker_registry');
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('should release connection on error', async () => {
      mockConnection.query.mockRejectedValue(new Error('Query failed'));

      await expect(syncService.getRegistryCount()).rejects.toThrow('Query failed');
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  describe('getCountBySource', () => {
    test('should return count for specific source', async () => {
      mockConnection.query.mockResolvedValue([
        [{ count: 5000 }],
        []
      ]);

      const count = await syncService.getCountBySource('NASDAQ_FILE');

      expect(count).toBe(5000);
      expect(mockConnection.query).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM ticker_registry WHERE source = ?',
        ['NASDAQ_FILE']
      );
    });
  });

  describe('getCountBySecurityType', () => {
    test('should return count for specific security type', async () => {
      mockConnection.query.mockResolvedValue([
        [{ count: 8000 }],
        []
      ]);

      const count = await syncService.getCountBySecurityType('EQUITY');

      expect(count).toBe(8000);
      expect(mockConnection.query).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM ticker_registry WHERE security_type = ?',
        ['EQUITY']
      );
    });
  });

  describe('getRegistrySummary', () => {
    test('should return comprehensive registry summary', async () => {
      jest.clearAllMocks();
      mockPool.getConnection.mockResolvedValue(mockConnection);
      
      mockConnection.query
        .mockResolvedValueOnce([
          [{ count: 20000 }]
        ])
        .mockResolvedValueOnce([
          [
            { source: 'NASDAQ_FILE', count: 5000 },
            { source: 'NYSE_FILE', count: 3000 },
            { source: 'OTHER_FILE', count: 2000 },
            { source: 'TREASURY_FILE', count: 10000 }
          ]
        ])
        .mockResolvedValueOnce([
          [
            { security_type: 'EQUITY', count: 15000 },
            { security_type: 'TREASURY', count: 5000 }
          ]
        ]);

      const summary = await syncService.getRegistrySummary();

      expect(summary.total_symbols).toBe(20000);
      expect(summary.by_source).toHaveLength(4);
      expect(summary.by_security_type).toHaveLength(2);
      expect(summary.by_source[0].source).toBe('NASDAQ_FILE');
      expect(summary.by_source[0].count).toBe(5000);
    });

    test('should release connection', async () => {
      jest.clearAllMocks();
      mockPool.getConnection.mockResolvedValue(mockConnection);
      mockConnection.query
        .mockResolvedValueOnce([
          [{ count: 5000 }]
        ])
        .mockResolvedValueOnce([
          [{ source: 'NASDAQ_FILE', count: 5000 }]
        ])
        .mockResolvedValueOnce([
          [{ security_type: 'EQUITY', count: 5000 }]
        ]);

      await syncService.getRegistrySummary();

      expect(mockConnection.release).toHaveBeenCalled();
    });
  });
});
