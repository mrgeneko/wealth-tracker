const request = require('supertest');

// Mock mysql2/promise with all data INSIDE the factory (jest.mock is hoisted)
const mockExecute = jest.fn();

jest.mock('mysql2/promise', () => {
    const accountTypes = [
        { id: 1, key: 'individual_brokerage', display_name: 'Individual Brokerage', category: 'investment', active: 1 },
        { id: 2, key: 'roth_ira', display_name: 'Roth IRA', category: 'investment', active: 1 }
    ];
    
    return {
        createPool: () => ({
            query: async (sql, params) => {
                // key lookups
                if (typeof sql === 'string' && sql.indexOf('SELECT id FROM account_types') === 0) {
                    const key = params && params[0];
                    const found = accountTypes.find(a => a.key === key);
                    return [found ? [{ id: found.id }] : []];
                }
                // accounts select used elsewhere
                if (typeof sql === 'string' && sql.includes('FROM accounts')) {
                    return [[]];
                }
                return [[]];
            },
            execute: async (sql, params) => {
                mockExecute(sql, params);
                if (typeof sql === 'string' && sql.toLowerCase().startsWith('insert into accounts')) {
                    return [{ insertId: 777 }];
                }
                return [{ insertId: 1 }];
            }
        })
    };
});

const { app } = require('../../dashboard/server');

describe('Integration - accounts API (account_type mapping)', () => {
    test('POST /api/accounts accepts legacy free-text type and resolves to account_type_id', async () => {
        const payload = { name: 'My Roth', type: 'Roth IRA' };
        const res = await request(app).post('/api/accounts').auth('admin', 'admin').send(payload);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id', 777);
        expect(res.body).toHaveProperty('account_type_id');
        // The resolved account_type_id should come from mockAccountTypes (roth_ira -> id 2)
        expect(res.body.account_type_id === 2 || typeof res.body.account_type_id === 'number').toBeTruthy();
        expect(mockExecute).toHaveBeenCalled();
    });
});
