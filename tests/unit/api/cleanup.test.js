/**
 * Unit Tests for Cleanup API Endpoints
 * 
 * Tests cleanup operations:
 * - Remove expired symbols
 * - Reset metadata flags
 * - Archive old metadata
 * - Status checking
 * 
 * Total: 8 tests
 */

const request = require('supertest');
const express = require('express');
const { router, initializePool } = require('../../../api/cleanup');

describe('Cleanup API Endpoints', () => {
    let app;
    let mockPool;
    let mockConnection;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use('/api/cleanup', router);

        mockConnection = {
            execute: jest.fn(),
            release: jest.fn().mockResolvedValue(undefined)
        };

        mockPool = {
            getConnection: jest.fn().mockResolvedValue(mockConnection)
        };

        initializePool(mockPool);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================================================
    // POST /cleanup - Remove Expired Symbols
    // ============================================================================
    describe('POST /cleanup', () => {
        test('should remove symbols with no metadata and no holdings', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([
                    [{ security_type: 'STOCK', count: 5, type_count: 5 }],
                    []
                ])
                .mockResolvedValueOnce([{ affectedRows: 5 }, []]);

            const response = await request(app)
                .post('/api/cleanup/cleanup')
                .expect(200);

            expect(response.body.action).toBe('cleanup_completed');
            expect(response.body.symbols_deleted).toBe(5);
            expect(response.body.by_type).toHaveLength(1);
            expect(response.body.timestamp).toBeDefined();
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should filter by security type', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([
                    [{ security_type: 'ETF', count: 2, type_count: 2 }],
                    []
                ])
                .mockResolvedValueOnce([{ affectedRows: 2 }, []]);

            const response = await request(app)
                .post('/api/cleanup/cleanup?security_type=ETF')
                .expect(200);

            expect(response.body.symbols_deleted).toBe(2);
            expect(mockConnection.execute).toHaveBeenCalledWith(
                expect.stringContaining('security_type = ?'),
                expect.arrayContaining(['ETF'])
            );
        });

        test('should respect days_since_update parameter', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([
                    [{ security_type: 'STOCK', count: 3, type_count: 3 }],
                    []
                ])
                .mockResolvedValueOnce([{ affectedRows: 3 }, []]);

            await request(app)
                .post('/api/cleanup/cleanup?days_since_update=60')
                .expect(200);

            expect(mockConnection.execute).toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining([60])
            );
        });

        test('should handle no symbols to delete', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([{ affectedRows: 0 }, []]);

            const response = await request(app)
                .post('/api/cleanup/cleanup')
                .expect(200);

            expect(response.body.symbols_deleted).toBe(0);
        });

        test('should return 503 when pool not initialized', async () => {
            initializePool(null);

            const response = await request(app)
                .post('/api/cleanup/cleanup')
                .expect(503);

            expect(response.body.error).toBe('Service unavailable');
        });

        test('should handle database errors', async () => {
            mockConnection.execute.mockRejectedValueOnce(new Error('Database error'));

            const response = await request(app)
                .post('/api/cleanup/cleanup')
                .expect(500);

            expect(response.body.error).toBe('Cleanup failed');
            expect(response.body.message).toBe('Database error');
        });
    });

    // ============================================================================
    // POST /reset-metadata - Reset Metadata Flags
    // ============================================================================
    describe('POST /reset-metadata', () => {
        test('should reset metadata flags for all symbols', async () => {
            mockConnection.execute.mockResolvedValueOnce([
                { affectedRows: 100 },
                []
            ]);

            const response = await request(app)
                .post('/api/cleanup/reset-metadata')
                .expect(200);

            expect(response.body.action).toBe('metadata_reset');
            expect(response.body.symbols_reset).toBe(100);
            expect(response.body.security_type).toBeNull();
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should reset metadata for specific security type', async () => {
            mockConnection.execute.mockResolvedValueOnce([
                { affectedRows: 25 },
                []
            ]);

            const response = await request(app)
                .post('/api/cleanup/reset-metadata?security_type=ETF')
                .expect(200);

            expect(response.body.symbols_reset).toBe(25);
            expect(response.body.security_type).toBe('ETF');
            expect(mockConnection.execute).toHaveBeenCalledWith(
                expect.stringContaining('security_type = ?'),
                ['ETF']
            );
        });
    });

    // ============================================================================
    // POST /archive-old-metadata - Archive Old Metadata
    // ============================================================================
    describe('POST /archive-old-metadata', () => {
        test('should archive metadata older than X days', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([undefined, []])  // CREATE TABLE
                .mockResolvedValueOnce([{ affectedRows: 50 }, []])  // INSERT
                .mockResolvedValueOnce([{ affectedRows: 50 }, []]);  // DELETE

            const response = await request(app)
                .post('/api/cleanup/archive-old-metadata?days=90')
                .expect(200);

            expect(response.body.action).toBe('metadata_archived');
            expect(response.body.archived_count).toBe(50);
            expect(response.body.deleted_count).toBe(50);
            expect(response.body.older_than_days).toBe(90);
        });

        test('should use default 90 days if not specified', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([undefined, []])
                .mockResolvedValueOnce([{ affectedRows: 0 }, []])
                .mockResolvedValueOnce([{ affectedRows: 0 }, []]);

            await request(app)
                .post('/api/cleanup/archive-old-metadata')
                .expect(200);

            // Check that 90 is used as default
            const calls = mockConnection.execute.mock.calls;
            const archiveCall = calls.find(c => c[0].includes('DATE_SUB'));
            expect(archiveCall[1][0]).toBe(90);
        });

        test('should create archive table if not exists', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([undefined, []])
                .mockResolvedValueOnce([{ affectedRows: 0 }, []])
                .mockResolvedValueOnce([{ affectedRows: 0 }, []]);

            await request(app)
                .post('/api/cleanup/archive-old-metadata')
                .expect(200);

            const calls = mockConnection.execute.mock.calls;
            const createTableCall = calls[0];
            expect(createTableCall[0]).toContain('CREATE TABLE IF NOT EXISTS ticker_registry_metadata_archive');
        });
    });

    // ============================================================================
    // GET /status - Cleanup Status
    // ============================================================================
    describe('GET /status', () => {
        test('should return cleanup status with statistics', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([
                    [{ total_symbols: 1000, with_metadata: 750, without_metadata: 250 }],
                    []
                ])
                .mockResolvedValueOnce([
                    [{ safe_to_delete: 100 }],
                    []
                ])
                .mockResolvedValueOnce([
                    [
                        { security_type: 'STOCK', total: 600, with_metadata: 450 },
                        { security_type: 'ETF', total: 400, with_metadata: 300 }
                    ],
                    []
                ]);

            const response = await request(app)
                .get('/api/cleanup/status')
                .expect(200);

            expect(response.body.status).toBe('healthy');
            expect(response.body.summary.total_symbols).toBe(1000);
            expect(response.body.summary.with_metadata).toBe(750);
            expect(response.body.summary.without_metadata).toBe(250);
            expect(response.body.summary.safe_to_delete).toBe(100);
            expect(response.body.by_type).toHaveLength(2);
            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should handle empty database', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[], []]);

            const response = await request(app)
                .get('/api/cleanup/status')
                .expect(200);

            expect(response.body.summary.total_symbols).toBe(0);
            expect(response.body.summary.safe_to_delete).toBe(0);
        });
    });

    // ============================================================================
    // Connection Management
    // ============================================================================
    describe('Connection Management', () => {
        test('should always release connection on success', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ total_symbols: 0, with_metadata: 0, without_metadata: 0 }], []])  // summary
                .mockResolvedValueOnce([[{ safe_to_delete: 0 }], []])  // deletable
                .mockResolvedValueOnce([[], []]);  // by_type

            await request(app)
                .get('/api/cleanup/status')
                .expect(200);

            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should always release connection on error', async () => {
            mockConnection.execute.mockRejectedValueOnce(new Error('DB error'));

            await request(app)
                .get('/api/cleanup/status')
                .expect(500);

            expect(mockConnection.release).toHaveBeenCalled();
        });
    });
});
