const request = require('supertest');

// Mock mysql2/promise with all data INSIDE the factory (jest.mock is hoisted)
const mockExecute = jest.fn();
const mockQuery = jest.fn();

jest.mock('mysql2/promise', () => {
    const accountTypes = [
        { id: 1, key: 'individual_brokerage', display_name: 'Individual Brokerage', category: 'investment', tax_treatment: 'taxable', custodial: 0, requires_ssn: 0, active: 1, sort_order: 100 },
        { id: 2, key: 'roth_ira', display_name: 'Roth IRA', category: 'investment', tax_treatment: 'tax_deferred', custodial: 0, requires_ssn: 1, active: 1, sort_order: 200 }
    ];
    
    return {
        createPool: () => ({
            query: async (sql, params) => {
                if (typeof sql === 'string' && sql.includes('FROM account_types')) {
                    return [accountTypes];
                }
                if (typeof sql === 'string' && sql.indexOf('SELECT id FROM account_types') === 0) {
                    const key = params && params[0];
                    const found = accountTypes.find(a => a.key === key);
                    return [found ? [{ id: found.id }] : []];
                }
                return [[]];
            },
            execute: async (sql, params) => {
                mockExecute(sql, params);
                if (typeof sql === 'string' && sql.toLowerCase().includes('insert into account_types')) {
                    return [{ insertId: 123 }];
                }
                return [{ insertId: 1 }];
            }
        })
    };
});

const { app } = require('../../dashboard/server');

describe('Integration - account-types API', () => {
    test('GET /api/account-types returns active account types', async () => {
        const res = await request(app).get('/api/account-types').auth('admin', 'admin');
        if (res.status !== 200) {
            console.error('GET /api/account-types failed:', res.status, res.body);
        }
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
        expect(res.body[0]).toHaveProperty('key');
    });

    test('POST /api/account-types creates a new account type', async () => {
        const payload = { key: 'test_bank', display_name: 'Test Bank', category: 'bank' };
        const res = await request(app).post('/api/account-types').auth('admin', 'admin').send(payload);
        if (res.status !== 200) {
            console.error('POST /api/account-types failed:', res.status, res.body);
        }
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id', 123);
        expect(mockExecute).toHaveBeenCalled();
    });
});
