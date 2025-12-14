const path = require('path');

const tickerRegistryPath = path.join(__dirname, '../../../dashboard/ticker_registry');

describe('Dashboard Ticker Registry (Phase 4)', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('loadAllTickers throws when DB pool not initialized', async () => {
        const { loadAllTickers } = require(tickerRegistryPath);
        await expect(loadAllTickers()).rejects.toThrow('Database pool not initialized');
    });

    test('initializeDbPool sets hasDbConnection and clears cache', async () => {
        const tickerRegistry = require(tickerRegistryPath);

        const conn = { execute: jest.fn().mockResolvedValue([[]]), release: jest.fn() };
        const pool = { getConnection: jest.fn().mockResolvedValue(conn) };

        tickerRegistry.initializeDbPool(pool);
        expect(tickerRegistry.getCacheStats().hasDbConnection).toBe(true);
        expect(tickerRegistry.getCacheStats().count).toBe(0);

        await tickerRegistry.loadAllTickers();
        expect(tickerRegistry.getCacheStats().count).toBe(0);

        // Resetting pool should clear cache
        tickerRegistry.initializeDbPool(pool);
        expect(tickerRegistry.getCacheStats().count).toBe(0);
    });

    test('loadAllTickers loads from DB, normalizes shape, and caches', async () => {
        const tickerRegistry = require(tickerRegistryPath);

        const rows = [
            {
                ticker: 'AAPL',
                name: 'Apple Inc.',
                exchange: 'NASDAQ',
                security_type: 'EQUITY',
                maturity_date: null,
                issue_date: null,
                security_term: null,
                sort_rank: 100
            },
            {
                ticker: '912796YB4',
                name: 'Bill 4-Week | Issue: 2025-12-09 | Maturity: 2026-01-06',
                exchange: 'TREASURY',
                security_type: 'TREASURY',
                maturity_date: '2026-01-06',
                issue_date: '2025-12-09',
                security_term: '4-Week',
                sort_rank: 800
            }
        ];

        const execute = jest.fn().mockResolvedValue([rows]);
        const conn = { execute, release: jest.fn() };
        const pool = { getConnection: jest.fn().mockResolvedValue(conn) };

        tickerRegistry.initializeDbPool(pool);

        const first = await tickerRegistry.loadAllTickers();
        expect(pool.getConnection).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(conn.release).toHaveBeenCalledTimes(1);

        expect(first).toEqual([
            {
                ticker: 'AAPL',
                symbol: 'AAPL',
                name: 'Apple Inc.',
                exchange: 'NASDAQ',
                securityType: 'EQUITY',
                maturityDate: null,
                issueDate: null,
                securityTerm: null
            },
            {
                ticker: '912796YB4',
                symbol: '912796YB4',
                name: 'Bill 4-Week | Issue: 2025-12-09 | Maturity: 2026-01-06',
                exchange: 'TREASURY',
                securityType: 'TREASURY',
                maturityDate: '2026-01-06',
                issueDate: '2025-12-09',
                securityTerm: '4-Week'
            }
        ]);

        const second = await tickerRegistry.loadAllTickers();
        expect(second).toBe(first);
        expect(pool.getConnection).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(tickerRegistry.getCacheStats().count).toBe(2);
    });

    test('reloadTickers invalidates cache and forces reload', async () => {
        const tickerRegistry = require(tickerRegistryPath);

        const rows1 = [{ ticker: 'AAA', name: 'AAA', exchange: 'NASDAQ', security_type: 'EQUITY', maturity_date: null, issue_date: null, security_term: null, sort_rank: 100 }];
        const rows2 = [{ ticker: 'BBB', name: 'BBB', exchange: 'NYSE', security_type: 'EQUITY', maturity_date: null, issue_date: null, security_term: null, sort_rank: 100 }];

        const execute = jest.fn()
            .mockResolvedValueOnce([rows1])
            .mockResolvedValueOnce([rows2]);
        const conn = { execute, release: jest.fn() };
        const pool = { getConnection: jest.fn().mockResolvedValue(conn) };

        tickerRegistry.initializeDbPool(pool);

        const first = await tickerRegistry.loadAllTickers();
        expect(first.map(t => t.ticker)).toEqual(['AAA']);

        const second = await tickerRegistry.reloadTickers();
        expect(second.map(t => t.ticker)).toEqual(['BBB']);

        expect(pool.getConnection).toHaveBeenCalledTimes(2);
        expect(conn.release).toHaveBeenCalledTimes(2);
        expect(execute).toHaveBeenCalledTimes(2);
    });

    test('searchTickers performs prefix search and uppercases prefix', async () => {
        const tickerRegistry = require(tickerRegistryPath);

        const rows = [{ ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', security_type: 'EQUITY' }];
        const execute = jest.fn().mockResolvedValue([rows]);
        const conn = { execute, release: jest.fn() };
        const pool = { getConnection: jest.fn().mockResolvedValue(conn) };

        tickerRegistry.initializeDbPool(pool);

        const results = await tickerRegistry.searchTickers('aa', 5);
        expect(results).toEqual(rows);

        const [sql, params] = execute.mock.calls[0];
        expect(sql).toEqual(expect.stringContaining('WHERE ticker LIKE ?'));
        expect(params).toEqual(['AA%', 5]);
        expect(conn.release).toHaveBeenCalledTimes(1);
    });
});
