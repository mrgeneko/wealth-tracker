const request = require('supertest');

jest.resetModules();

// Fake DB state for account_types
const fakeAccountTypes = [
    { id: 1, key: 'individual_brokerage', display_name: 'Individual Brokerage', category: 'investment', tax_treatment: 'taxable', custodial: 0, requires_ssn: 0, active: 1, sort_order: 100 },
    { id: 2, key: 'roth_ira', display_name: 'Roth IRA', category: 'investment', tax_treatment: 'tax_deferred', custodial: 0, requires_ssn: 1, active: 1, sort_order: 200 }
];

const fakePool = {
    query: jest.fn(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('FROM account_types')) {
            return [fakeAccountTypes];
        }
        if (typeof sql === 'string' && sql.indexOf('SELECT id FROM account_types') === 0) {
            const key = params && params[0];
            const found = fakeAccountTypes.find(a => a.key === key);
            return [found ? [{ id: found.id }] : []];
        }
        return [[]];
    }),
    execute: jest.fn(async (sql, params) => {
        if (typeof sql === 'string' && sql.toLowerCase().includes('insert into account_types')) {
            return [{ insertId: 123 }];
        }
        return [{ insertId: 1 }];
    })
};

jest.doMock('mysql2/promise', () => ({ createPool: () => fakePool }));

const { app } = require('../../dashboard/server');

describe('Integration - account-types API', () => {
    test('GET /api/account-types returns active account types', async () => {
        const res = await request(app).get('/api/account-types').auth('admin', 'admin');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
        expect(res.body[0]).toHaveProperty('key');
    });

    test('POST /api/account-types creates a new account type', async () => {
        const payload = { key: 'test_bank', display_name: 'Test Bank', category: 'bank' };
        const res = await request(app).post('/api/account-types').auth('admin', 'admin').send(payload);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id', 123);
        expect(fakePool.execute).toHaveBeenCalled();
    });
});
