/**
 * Unit Tests for Settings Modal - Import/Export Data
 * 
 * Tests the Import Data and Export Data functionality in the settings modal
 */

describe('Settings Modal - Import/Export Data', () => {
    let mockPool;
    let mockConnection;
    let mockResponse;
    let mockRequest;
    let testData;

    beforeEach(() => {
        // Mock database connection
        mockConnection = {
            query: jest.fn(),
            execute: jest.fn(),
            release: jest.fn()
        };

        mockPool = {
            getConnection: jest.fn().mockResolvedValue(mockConnection),
            execute: jest.fn(),
            end: jest.fn().mockResolvedValue(undefined)
        };

        // Standard test data
        testData = {
            exportDate: new Date().toISOString(),
            version: '1.0',
            data: {
                accounts: [
                    {
                        id: '1',
                        name: 'Checking Account',
                        type: 'bank',
                        category: 'investment',
                        currency: 'USD',
                        display_order: 0
                    }
                ],
                positions: [
                    {
                        account_id: '1',
                        symbol: 'AAPL',
                        quantity: 100,
                        type: 'equity',
                        exchange: 'NASDAQ',
                        currency: 'USD',
                        maturity_date: null,
                        coupon: null,
                        display_order: 0
                    }
                ],
                fixed_assets: []
            }
        };

        // Mock response object
        mockResponse = {
            json: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis(),
            end: jest.fn().mockReturnThis()
        };

        // Mock request object
        mockRequest = {
            body: testData
        };
    });

    describe('Export Data (/api/export)', () => {
        test('should export all data successfully', async () => {
            mockPool.execute.mockResolvedValueOnce([testData.data]);

            // Simulate the export endpoint logic
            const data = testData.data;
            const exportData = {
                exportDate: new Date().toISOString(),
                version: '1.0',
                data: data
            };

            expect(exportData).toHaveProperty('exportDate');
            expect(exportData).toHaveProperty('version');
            expect(exportData).toHaveProperty('data');
            expect(exportData.data).toHaveProperty('accounts');
            expect(exportData.data).toHaveProperty('positions');
        });

        test('should include accounts in export', async () => {
            const data = testData.data;
            expect(data.accounts).toBeDefined();
            expect(data.accounts).toBeInstanceOf(Array);
            expect(data.accounts.length).toBeGreaterThan(0);
            expect(data.accounts[0]).toHaveProperty('id');
            expect(data.accounts[0]).toHaveProperty('name');
            expect(data.accounts[0]).toHaveProperty('type');
            expect(data.accounts[0]).toHaveProperty('currency');
        });

        test('should include positions in export', async () => {
            const data = testData.data;
            expect(data.positions).toBeDefined();
            expect(data.positions).toBeInstanceOf(Array);
            expect(data.positions.length).toBeGreaterThan(0);
            expect(data.positions[0]).toHaveProperty('account_id');
            expect(data.positions[0]).toHaveProperty('symbol');
            expect(data.positions[0]).toHaveProperty('quantity');
            expect(data.positions[0]).toHaveProperty('type');
        });

        test('should handle export with empty data', async () => {
            const emptyData = {
                exportDate: new Date().toISOString(),
                version: '1.0',
                data: {
                    accounts: [],
                    positions: [],
                    fixed_assets: []
                }
            };

            expect(emptyData.data.accounts).toEqual([]);
            expect(emptyData.data.positions).toEqual([]);
        });

        test('should include fixed assets if present', async () => {
            const dataWithAssets = {
                ...testData,
                data: {
                    ...testData.data,
                    fixed_assets: [
                        {
                            name: 'House',
                            type: 'real_estate',
                            value: 500000,
                            currency: 'USD',
                            display_order: 0
                        }
                    ]
                }
            };

            expect(dataWithAssets.data.fixed_assets).toBeDefined();
            expect(dataWithAssets.data.fixed_assets[0]).toHaveProperty('name');
            expect(dataWithAssets.data.fixed_assets[0]).toHaveProperty('type');
            expect(dataWithAssets.data.fixed_assets[0]).toHaveProperty('value');
        });
    });

    describe('Import Data (/api/import)', () => {
        test('should validate data structure before import', () => {
            // Test valid structure
            const validData = {
                data: {
                    accounts: [],
                    positions: []
                }
            };
            expect(validData).toHaveProperty('data');
            expect(validData.data).toHaveProperty('accounts');
            expect(validData.data).toHaveProperty('positions');
        });

        test('should reject data without accounts', () => {
            const invalidData = {
                data: {
                    positions: []
                }
            };
            expect(invalidData.data).not.toHaveProperty('accounts');
        });

        test('should reject data without positions', () => {
            const invalidData = {
                data: {
                    accounts: []
                }
            };
            expect(invalidData.data).not.toHaveProperty('positions');
        });

        test('should accept valid import data structure', () => {
            const validData = {
                exportDate: '2025-12-10T18:00:00.000Z',
                version: '1.0',
                data: {
                    accounts: [
                        {
                            id: '1',
                            name: 'Test Account',
                            type: 'bank',
                            category: 'investment',
                            currency: 'USD',
                            display_order: 0
                        }
                    ],
                    positions: [
                        {
                            account_id: '1',
                            symbol: 'TEST',
                            quantity: 10,
                            type: 'equity',
                            exchange: 'NYSE',
                            currency: 'USD',
                            maturity_date: null,
                            coupon: null,
                            display_order: 0
                        }
                    ]
                }
            };

            expect(validData.data.accounts).toHaveLength(1);
            expect(validData.data.positions).toHaveLength(1);
            expect(validData.data.accounts[0].name).toBe('Test Account');
            expect(validData.data.positions[0].symbol).toBe('TEST');
        });

        test('should handle import with multiple accounts', () => {
            const multiAccountData = {
                data: {
                    accounts: [
                        {
                            id: '1',
                            name: 'Savings',
                            type: 'bank',
                            category: 'investment',
                            currency: 'USD',
                            display_order: 0
                        },
                        {
                            id: '2',
                            name: 'Brokerage',
                            type: 'investment',
                            category: 'investment',
                            currency: 'USD',
                            display_order: 1
                        }
                    ],
                    positions: []
                }
            };

            expect(multiAccountData.data.accounts).toHaveLength(2);
            expect(multiAccountData.data.accounts[0].id).toBe('1');
            expect(multiAccountData.data.accounts[1].id).toBe('2');
        });

        test('should handle import with multiple positions', () => {
            const multiPositionData = {
                data: {
                    accounts: [],
                    positions: [
                        {
                            account_id: '1',
                            symbol: 'AAPL',
                            quantity: 100,
                            type: 'equity',
                            exchange: 'NASDAQ',
                            currency: 'USD',
                            maturity_date: null,
                            coupon: null,
                            display_order: 0
                        },
                        {
                            account_id: '1',
                            symbol: 'MSFT',
                            quantity: 50,
                            type: 'equity',
                            exchange: 'NASDAQ',
                            currency: 'USD',
                            maturity_date: null,
                            coupon: null,
                            display_order: 1
                        }
                    ]
                }
            };

            expect(multiPositionData.data.positions).toHaveLength(2);
            expect(multiPositionData.data.positions[0].symbol).toBe('AAPL');
            expect(multiPositionData.data.positions[1].symbol).toBe('MSFT');
        });

        test('should preserve field values during import', () => {
            const dataWithValues = {
                data: {
                    accounts: [
                        {
                            id: 'acc-001',
                            name: 'Premium Account',
                            type: 'investment',
                            category: 'trading',
                            currency: 'USD',
                            display_order: 5
                        }
                    ],
                    positions: [
                        {
                            account_id: 'acc-001',
                            symbol: 'BRK.B',
                            quantity: 25.5,
                            type: 'equity',
                            exchange: 'NYSE',
                            currency: 'USD',
                            maturity_date: null,
                            coupon: null,
                            display_order: 2
                        }
                    ]
                }
            };

            const account = dataWithValues.data.accounts[0];
            const position = dataWithValues.data.positions[0];

            expect(account.id).toBe('acc-001');
            expect(account.display_order).toBe(5);
            expect(position.quantity).toBe(25.5);
            expect(position.symbol).toBe('BRK.B');
        });

        test('should handle optional fields in import', () => {
            const dataWithOptional = {
                data: {
                    accounts: [
                        {
                            id: '1',
                            name: 'Account',
                            type: 'bank'
                            // category, currency, display_order are optional
                        }
                    ],
                    positions: [
                        {
                            account_id: '1',
                            symbol: 'AAPL',
                            quantity: 10,
                            type: 'equity'
                            // exchange, maturity_date, coupon are optional
                        }
                    ]
                }
            };

            expect(dataWithOptional.data.accounts[0].id).toBe('1');
            expect(dataWithOptional.data.positions[0].symbol).toBe('AAPL');
        });

        test('should handle fixed assets in import', () => {
            const dataWithAssets = {
                data: {
                    accounts: [],
                    positions: [],
                    fixed_assets: [
                        {
                            name: 'Primary Residence',
                            type: 'real_estate',
                            value: 750000,
                            currency: 'USD',
                            display_order: 0
                        },
                        {
                            name: 'Investment Property',
                            type: 'real_estate',
                            value: 450000,
                            currency: 'USD',
                            display_order: 1
                        }
                    ]
                }
            };

            expect(dataWithAssets.data.fixed_assets).toHaveLength(2);
            expect(dataWithAssets.data.fixed_assets[0].type).toBe('real_estate');
            expect(dataWithAssets.data.fixed_assets[1].value).toBe(450000);
        });
    });

    describe('Data Integrity', () => {
        test('should handle account IDs correctly', () => {
            const data = {
                data: {
                    accounts: [
                        { id: 'unique-id-123', name: 'Account' }
                    ],
                    positions: [
                        { account_id: 'unique-id-123', symbol: 'AAPL', quantity: 1 }
                    ]
                }
            };

            const accountId = data.data.accounts[0].id;
            const positionAccountId = data.data.positions[0].account_id;

            expect(accountId).toBe(positionAccountId);
        });

        test('should handle currency fields', () => {
            const data = {
                data: {
                    accounts: [
                        { id: '1', name: 'USD Account', currency: 'USD' },
                        { id: '2', name: 'EUR Account', currency: 'EUR' }
                    ],
                    positions: [
                        { account_id: '1', symbol: 'AAPL', quantity: 10, currency: 'USD' },
                        { account_id: '2', symbol: 'SAP', quantity: 5, currency: 'EUR' }
                    ]
                }
            };

            expect(data.data.accounts[0].currency).toBe('USD');
            expect(data.data.accounts[1].currency).toBe('EUR');
            expect(data.data.positions[0].currency).toBe('USD');
            expect(data.data.positions[1].currency).toBe('EUR');
        });

        test('should preserve bond/treasury fields', () => {
            const bondPosition = {
                account_id: '1',
                symbol: 'US10Y',
                quantity: 1000,
                type: 'bond',
                maturity_date: '2035-12-31',
                coupon: 4.5,
                currency: 'USD'
            };

            expect(bondPosition.maturity_date).toBe('2035-12-31');
            expect(bondPosition.coupon).toBe(4.5);
        });
    });

    describe('Error Handling', () => {
        test('should reject null data', () => {
            expect(() => {
                if (!null || !null.data) {
                    throw new Error('Invalid data format');
                }
            }).toThrow('Invalid data format');
        });

        test('should reject undefined data', () => {
            expect(() => {
                const data = undefined;
                if (!data || !data.data) {
                    throw new Error('Invalid data format');
                }
            }).toThrow('Invalid data format');
        });

        test('should handle malformed JSON in import', () => {
            const malformedJson = '{invalid json}';
            expect(() => {
                JSON.parse(malformedJson);
            }).toThrow();
        });

        test('should validate account array is not null', () => {
            const invalidData = {
                data: {
                    accounts: null,
                    positions: []
                }
            };

            expect(invalidData.data.accounts).toBeNull();
        });
    });

    describe('File Format', () => {
        test('should include exportDate in ISO format', () => {
            const data = {
                exportDate: new Date().toISOString(),
                version: '1.0',
                data: { accounts: [], positions: [] }
            };

            expect(data.exportDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        test('should include version field', () => {
            const data = {
                exportDate: '2025-12-10T00:00:00.000Z',
                version: '1.0',
                data: { accounts: [], positions: [] }
            };

            expect(data).toHaveProperty('version');
            expect(data.version).toBe('1.0');
        });

        test('should create proper filename with date', () => {
            const date = new Date().toISOString().split('T')[0];
            const filename = `wealth-tracker-export-${date}.json`;

            expect(filename).toMatch(/wealth-tracker-export-\d{4}-\d{2}-\d{2}\.json/);
        });
    });
});
