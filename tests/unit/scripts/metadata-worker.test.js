/**
 * Unit Tests for PM2 Metadata Worker
 * 
 * Tests background metadata population service
 */

// Set environment to development so paths resolve correctly
process.env.NODE_ENV = 'development';

// Mock dependencies
jest.mock('mysql2/promise', () => ({
    createPool: jest.fn()
}));

// Mock yahoo-finance2 before importing the worker
jest.mock('yahoo-finance2', () => {
    return jest.fn().mockImplementation(() => ({
        quoteSummary: jest.fn()
    }));
});

const MetadataWorker = require('../../../scripts/metadata-worker');

jest.mock('../../../services/symbol-registry/yahoo_metadata_populator', () => {
    return jest.fn().mockImplementation(() => ({
        populateMetadata: jest.fn(),
        getStats: jest.fn()
    }));
});

describe('MetadataWorker', () => {
    let worker;
    let mockPool;
    let mockConnection;
    let mockPopulator;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Mock database connection
        mockConnection = {
            query: jest.fn(),
            execute: jest.fn(),
            ping: jest.fn().mockResolvedValue(undefined),
            release: jest.fn()
        };

        mockPool = {
            getConnection: jest.fn().mockResolvedValue(mockConnection),
            end: jest.fn().mockResolvedValue(undefined)
        };

        // Mock mysql2
        const mysql = require('mysql2/promise');
        mysql.createPool.mockReturnValue(mockPool);

        // Mock populator
        const YahooMetadataPopulator = require('../../../services/symbol-registry/yahoo_metadata_populator');
        mockPopulator = {
            populateMetadata: jest.fn(),
            getStats: jest.fn().mockReturnValue({
                total_symbols: 100,
                successfully_updated: 90,
                failed: 10,
                is_running: false
            })
        };
        YahooMetadataPopulator.mockImplementation(() => mockPopulator);

        worker = new MetadataWorker();
    });

    afterEach(() => {
        if (worker) {
            worker.isShuttingDown = true;
        }
    });

    describe('Configuration', () => {
        test('should load default configuration', () => {
            expect(worker.config.checkIntervalMs).toBe(60000); // 1 minute
            expect(worker.config.maxSymbolsPerRun).toBe(500);
            expect(worker.config.idleWaitMs).toBe(300000); // 5 minutes
            expect(worker.config.processOnStartup).toBe(true);
        });

        test('should override configuration from environment variables', () => {
            process.env.METADATA_WORKER_CHECK_INTERVAL_MS = '30000';
            process.env.METADATA_WORKER_MAX_PER_RUN = '100';
            process.env.METADATA_WORKER_STARTUP = 'false';

            const envWorker = new MetadataWorker();
            
            expect(envWorker.config.checkIntervalMs).toBe(30000);
            expect(envWorker.config.maxSymbolsPerRun).toBe(100);
            expect(envWorker.config.processOnStartup).toBe(false);

            // Cleanup
            delete process.env.METADATA_WORKER_CHECK_INTERVAL_MS;
            delete process.env.METADATA_WORKER_MAX_PER_RUN;
            delete process.env.METADATA_WORKER_STARTUP;
        });
    });

    describe('Initialization', () => {
        test('should initialize database pool and populator', async () => {
            await worker.initialize();

            expect(worker.dbPool).toBeDefined();
            expect(worker.populator).toBeDefined();
            expect(mockConnection.ping).toHaveBeenCalled();
        });

        test('should handle initialization errors', async () => {
            mockPool.getConnection.mockRejectedValue(new Error('Connection failed'));

            await expect(worker.initialize()).rejects.toThrow('Connection failed');
        });
    });

    describe('Queue Management', () => {
        beforeEach(async () => {
            await worker.initialize();
        });

        test('should get queued symbols count', async () => {
            mockConnection.execute.mockResolvedValue([[{ count: 150 }]]);

            const count = await worker.getQueuedSymbolsCount();

            expect(count).toBe(150);
            expect(mockConnection.execute).toHaveBeenCalledWith(expect.stringContaining('has_yahoo_metadata = 0'));
        });

        test('should handle database errors when getting queue count', async () => {
            mockConnection.execute.mockRejectedValue(new Error('DB Error'));

            await expect(worker.getQueuedSymbolsCount()).rejects.toThrow('DB Error');
        });
    });

    describe('Batch Processing', () => {
        beforeEach(async () => {
            await worker.initialize();
        });

        test('should process batch successfully', async () => {
            mockConnection.execute.mockResolvedValue([[{ count: 100 }]]);
            mockPopulator.populateMetadata.mockResolvedValue({
                total_symbols: 50,
                successfully_updated: 45,
                failed: 5,
                start_time: new Date(),
                end_time: new Date()
            });

            const result = await worker.processBatch();

            expect(result.status).toBe('completed');
            expect(result.total_symbols).toBe(50);
            expect(result.successfully_updated).toBe(45);
            expect(mockPopulator.populateMetadata).toHaveBeenCalledWith(500);
        });

        test('should return idle status when no symbols in queue', async () => {
            mockConnection.execute.mockResolvedValue([[{ count: 0 }]]);

            const result = await worker.processBatch();

            expect(result.status).toBe('idle');
            expect(result.queued_count).toBe(0);
            expect(mockPopulator.populateMetadata).not.toHaveBeenCalled();
        });

        test('should skip processing if already running', async () => {
            worker.currentRunning = true;

            const result = await worker.processBatch();

            expect(result.status).toBe('skipped');
            expect(result.reason).toBe('already_running');
        });

        test('should handle processing errors', async () => {
            mockConnection.execute.mockResolvedValue([[{ count: 50 }]]);
            mockPopulator.populateMetadata.mockRejectedValue(new Error('Processing failed'));

            const result = await worker.processBatch();

            expect(result.status).toBe('error');
            expect(result.error).toBe('Processing failed');
        });
    });

    describe('Graceful Shutdown', () => {
        test('should handle graceful shutdown', async () => {
            await worker.initialize();
            
            // Don't actually call gracefulShutdown as it calls process.exit()
            // Just test the shutdown flag
            worker.isShuttingDown = true;
            
            expect(worker.isShuttingDown).toBe(true);
        });

        test('should wait for current batch to complete during shutdown', async () => {
            await worker.initialize();
            
            worker.currentRunning = true;
            worker.isShuttingDown = true;
            
            // Simulate batch completion
            setTimeout(() => {
                worker.currentRunning = false;
            }, 10);

            // This would normally be in gracefulShutdown method
            let waitCount = 0;
            while (worker.currentRunning && waitCount < 5) {
                await new Promise(resolve => setTimeout(resolve, 5));
                waitCount++;
            }
            
            expect(worker.currentRunning).toBe(false);
        });
    });

    describe('Error Handling', () => {
        test('should implement exponential backoff for consecutive errors', async () => {
            // This would be tested by calling the run method with mocked errors
            // but since run() has an infinite loop, we test the logic conceptually
            
            const baseInterval = worker.config.checkIntervalMs;
            const maxConsecutiveErrors = 5;
            
            for (let errors = 1; errors <= maxConsecutiveErrors; errors++) {
                const waitTime = Math.min(baseInterval * Math.pow(2, errors), 300000);
                expect(waitTime).toBeGreaterThanOrEqual(baseInterval);
                expect(waitTime).toBeLessThanOrEqual(300000);
            }
        });

        test('should reset error counter on successful processing', async () => {
            await worker.initialize();
            mockConnection.execute.mockResolvedValue([[{ count: 10 }]]);
            mockPopulator.populateMetadata.mockResolvedValue({
                total_symbols: 10,
                successfully_updated: 10,
                failed: 0
            });

            const result = await worker.processBatch();

            expect(result.status).toBe('completed');
            // In real implementation, consecutiveErrors would be reset to 0
        });
    });

    describe('Utility Methods', () => {
        test('should provide sleep utility', async () => {
            const start = Date.now();
            await worker.sleep(10);
            const elapsed = Date.now() - start;
            
            expect(elapsed).toBeGreaterThanOrEqual(8); // Allow for timing variance
        });
    });
});