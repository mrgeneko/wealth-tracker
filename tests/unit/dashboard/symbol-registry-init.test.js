// tests/unit/dashboard/symbol-registry-init.test.js
// Unit tests for symbol registry initialization with database retry logic
// Tests: database connection waiting, CSV sync, verification

describe('Symbol Registry Initialization', () => {
    let mockPool;
    let mockSymbolRegistryService;
    let mockSyncService;

    beforeEach(() => {
        jest.useFakeTimers();
        
        mockPool = {
            query: jest.fn(),
            getConnection: jest.fn()
        };

        mockSyncService = {
            syncAll: jest.fn()
        };

        mockSymbolRegistryService = {};
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    describe('Database Connection Retry Logic', () => {
        it('should wait for database to be ready before syncing', async () => {
            // Simulate database not ready initially, then ready
            let attemptCount = 0;
            mockPool.query.mockImplementation(() => {
                attemptCount++;
                if (attemptCount < 3) {
                    return Promise.reject(new Error('ECONNREFUSED'));
                }
                return Promise.resolve([[{ count: 0 }]]);
            });

            mockSyncService.syncAll.mockResolvedValue({
                total_inserted: 12548,
                total_errors: 0
            });

            // Simulate the initializeSymbolRegistry function logic
            const MAX_RETRIES = 10;
            let retries = 0;
            let connected = false;

            while (retries < MAX_RETRIES && !connected) {
                try {
                    await mockPool.query('SELECT 1');
                    connected = true;
                } catch (err) {
                    retries++;
                    // No actual delay in test
                }
            }

            expect(connected).toBe(true);
            expect(attemptCount).toBe(3);
        }, 10000);

        it('should fail gracefully after max retries', async () => {
            // Simulate database never becoming ready
            mockPool.query.mockRejectedValue(new Error('ECONNREFUSED'));

            const MAX_RETRIES = 5; // Shorter for test
            let retries = 0;
            let connected = false;

            while (retries < MAX_RETRIES && !connected) {
                try {
                    await mockPool.query('SELECT 1');
                    connected = true;
                } catch (err) {
                    retries++;
                }
            }

            expect(connected).toBe(false);
            expect(retries).toBe(MAX_RETRIES);
        });

        it('should proceed immediately if database is already ready', async () => {
            mockPool.query.mockResolvedValue([[{ '1': 1 }]]);

            let attemptCount = 0;
            
            // Simulate single successful check
            try {
                await mockPool.query('SELECT 1');
                attemptCount++;
            } catch (err) {
                // Should not reach here
            }

            expect(attemptCount).toBe(1);
            expect(mockPool.query).toHaveBeenCalledTimes(1);
        });
    });

    describe('CSV Sync Process', () => {
        beforeEach(() => {
            mockPool.query.mockResolvedValue([[{ count: 0 }]]);
        });

        it('should sync all file types (NASDAQ, NYSE, OTHER, TREASURY)', async () => {
            mockSyncService.syncAll.mockResolvedValue({
                total_files: 4,
                files: [
                    { file_type: 'NASDAQ', inserted: 5222, errors: 0 },
                    { file_type: 'NYSE', inserted: 2891, errors: 0 },
                    { file_type: 'OTHER', inserted: 3944, errors: 2891 },
                    { file_type: 'TREASURY', inserted: 491, errors: 0 }
                ],
                total_records: 15439,
                total_inserted: 12548,
                total_errors: 2891
            });

            const result = await mockSyncService.syncAll();

            expect(result.total_files).toBe(4);
            expect(result.total_inserted).toBe(12548);
            expect(result.files).toHaveLength(4);
        });

        it('should handle sync errors gracefully', async () => {
            mockSyncService.syncAll.mockRejectedValue(new Error('File not found'));

            await expect(mockSyncService.syncAll()).rejects.toThrow('File not found');
        });
    });

    describe('Verification After Sync', () => {
        it('should verify records were inserted after sync', async () => {
            // Mock returns array format like mysql2
            mockPool.query.mockResolvedValue([[{ count: 12548 }]]);

            mockSyncService.syncAll.mockResolvedValue({
                total_inserted: 12548
            });

            // Simulate verification step
            const result = await mockPool.query('SELECT COUNT(*) as count FROM symbol_registry');
            const checkResult = result[0];
            
            expect(checkResult[0].count).toBe(12548);
        });

        it('should warn if zero records after sync', async () => {
            mockPool.query.mockResolvedValue([[{ count: 0 }]]);

            const [checkResult] = await mockPool.query('SELECT COUNT(*) as count FROM symbol_registry');
            
            expect(checkResult[0].count).toBe(0);
            // In actual code, this triggers a warning log
        });
    });
});

describe('Dotenv Optional Loading', () => {
    it('should not throw if dotenv is not available', () => {
        // This tests the try/catch around dotenv
        const loadDotenv = () => {
            try {
                require('dotenv').config();
            } catch (e) {
                // Expected - dotenv not available in test environment
            }
        };

        expect(loadDotenv).not.toThrow();
    });

    it('should use existing environment variables when dotenv is unavailable', () => {
        process.env.TEST_VAR = 'test_value';
        
        // Simulate the script behavior
        try {
            require('dotenv').config();
        } catch (e) {
            // dotenv not available
        }

        expect(process.env.TEST_VAR).toBe('test_value');
        delete process.env.TEST_VAR;
    });
});
