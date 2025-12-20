describe('Treasury Registry (Phase 5)', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    function makePool(rowsByQuery) {
        const conn = {
            execute: jest.fn(async (sql, params) => {
                const key = String(sql).trim();
                const result = rowsByQuery.get(key);
                if (typeof result === 'function') return result(sql, params);
                return [result || []];
            }),
            release: jest.fn()
        };
        const pool = { getConnection: jest.fn(async () => conn) };
        return { pool, conn };
    }

    test('loadTreasuryCache throws when DB pool not initialized', async () => {
        const { loadTreasuryCache } = require('../../../scrapers/treasury_registry');
        await expect(loadTreasuryCache()).rejects.toThrow('Database pool not initialized');
    });

    test('isTreasury returns false for null/empty without DB access', async () => {
        const registry = require('../../../scrapers/treasury_registry');
        await expect(registry.isTreasury(null)).resolves.toBe(false);
        await expect(registry.isTreasury(undefined)).resolves.toBe(false);
        await expect(registry.isTreasury('')).resolves.toBe(false);
    });

    test('loadTreasuryCache loads tickers and caches results', async () => {
        const registry = require('../../../scrapers/treasury_registry');

        const sql = "SELECT ticker FROM ticker_registry WHERE security_type = 'US_TREASURY'";
        const rows = [{ ticker: '912810EX2' }, { ticker: '912797SE8' }];

        const rowsByQuery = new Map([[sql, rows]]);
        const { pool, conn } = makePool(rowsByQuery);

        registry.initializeDbPool(pool);

        const cache1 = await registry.loadTreasuryCache();
        expect(cache1).toBeInstanceOf(Set);
        expect(cache1.has('912810EX2')).toBe(true);
        expect(cache1.has('912797SE8')).toBe(true);
        expect(pool.getConnection).toHaveBeenCalledTimes(1);
        expect(conn.execute).toHaveBeenCalledTimes(1);
        expect(conn.release).toHaveBeenCalledTimes(1);

        // Cached
        const cache2 = await registry.loadTreasuryCache();
        expect(cache2).toBe(cache1);
        expect(pool.getConnection).toHaveBeenCalledTimes(1);
        expect(conn.execute).toHaveBeenCalledTimes(1);
    });

    test('isTreasury uses cache and is case-insensitive', async () => {
        const registry = require('../../../scrapers/treasury_registry');

        const sql = "SELECT ticker FROM ticker_registry WHERE security_type = 'US_TREASURY'";
        const rowsByQuery = new Map([[sql, [{ ticker: '912810EX2' }]]]);
        const { pool, conn } = makePool(rowsByQuery);
        registry.initializeDbPool(pool);

        await expect(registry.isTreasury('912810EX2')).resolves.toBe(true);
        await expect(registry.isTreasury('912810ex2')).resolves.toBe(true);
        await expect(registry.isTreasury('AAPL')).resolves.toBe(false);

        expect(conn.execute).toHaveBeenCalledTimes(1);
    });

    test('getTreasuryDetails returns normalized details when found', async () => {
        const registry = require('../../../scrapers/treasury_registry');

        const detailSql = `SELECT ticker, name, issue_date, maturity_date, security_term
       FROM ticker_registry
       WHERE ticker = ? AND security_type = 'US_TREASURY'
       LIMIT 1`;

        const rowsByQuery = new Map([
            [detailSql.trim(), [{
                ticker: '912810EX2',
                name: 'Bill 4-Week | Issue: 2025-12-09 | Maturity: 2026-01-06',
                issue_date: '2025-12-09',
                maturity_date: '2026-01-06',
                security_term: '4-Week'
            }]]
        ]);
        const { pool, conn } = makePool(rowsByQuery);
        registry.initializeDbPool(pool);

        const details = await registry.getTreasuryDetails('912810ex2');
        expect(details).toEqual({
            cusip: '912810EX2',
            name: 'Bill 4-Week | Issue: 2025-12-09 | Maturity: 2026-01-06',
            issueDate: '2025-12-09',
            maturityDate: '2026-01-06',
            securityTerm: '4-Week'
        });

        // Called with uppercased param
        const [, params] = conn.execute.mock.calls[0];
        expect(params).toEqual(['912810EX2']);
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    test('getTreasuryDetails returns null when not found', async () => {
        const registry = require('../../../scrapers/treasury_registry');

        const detailSql = `SELECT ticker, name, issue_date, maturity_date, security_term
       FROM ticker_registry
       WHERE ticker = ? AND security_type = 'TREASURY'
       LIMIT 1`;

        const rowsByQuery = new Map([[detailSql.trim(), []]]);
        const { pool } = makePool(rowsByQuery);
        registry.initializeDbPool(pool);

        await expect(registry.getTreasuryDetails('NOPE')).resolves.toBe(null);
    });

    test('reloadTreasuryData clears cache and reloads', async () => {
        const registry = require('../../../scrapers/treasury_registry');

        const sql = "SELECT ticker FROM ticker_registry WHERE security_type = 'TREASURY'";
        const conn = {
            execute: jest.fn()
                .mockResolvedValueOnce([[{ ticker: 'AAA' }]])
                .mockResolvedValueOnce([[{ ticker: 'BBB' }]]),
            release: jest.fn()
        };
        const pool = { getConnection: jest.fn(async () => conn) };

        registry.initializeDbPool(pool);

        const first = await registry.loadTreasuryCache();
        expect(first.has('AAA')).toBe(true);

        await registry.reloadTreasuryData();
        const second = await registry.loadTreasuryCache();
        expect(second.has('BBB')).toBe(true);

        expect(conn.execute).toHaveBeenCalledTimes(2);
    });

    test('normalizedIdentifier matches scraper_utils.normalizedKey behavior', async () => {
        const { normalizedIdentifier } = require('../../../scrapers/treasury_registry');
        expect(normalizedIdentifier('BRK.B')).toBe(encodeURIComponent('BRK.B'));
        expect(normalizedIdentifier(null)).toBe('');
    });
});
