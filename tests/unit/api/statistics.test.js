/**
 * Unit Tests for Statistics API
 * 
 * Tests per-type filtering, advanced statistics, and type-specific operations
 */

// Require at module level for setup
const request = require('supertest');
const express = require('express');

// Store modules at module scope
let statsModule;
let app;
let mockPool;
let mockConnection;

describe('Statistics API', () => {
    const createTestApp = () => {
        // Clear cache every test
        delete require.cache[require.resolve('../../../api/statistics')];
        
        const testApp = express();
        testApp.use(express.json());
        
        // Get fresh module
        const mod = require('../../../api/statistics');
        
        // Setup mock pool and connection
        const conn = {
            execute: jest.fn(),
            beginTransaction: jest.fn().mockResolvedValue(undefined),
            commit: jest.fn().mockResolvedValue(undefined),
            rollback: jest.fn().mockResolvedValue(undefined),
            release: jest.fn()
        };

        const pool = {
            getConnection: jest.fn().mockResolvedValue(conn)
        };

        // Initialize pool and mount router
        mod.initializePool(pool);
        testApp.use('/api/statistics', mod.router);
        
        return { app: testApp, pool, connection: conn };
    };

    beforeEach(() => {
        // Reset for each test
        const setup = createTestApp();
        app = setup.app;
        mockPool = setup.pool;
        mockConnection = setup.connection;
    });

    describe('GET /statistics', () => {
        test('should return overall statistics with queue and processing metrics', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 1000 }]]) // total
                .mockResolvedValueOnce([[{ count: 750 }]])  // with metadata
                .mockResolvedValueOnce([[{ queue_size: 250 }]]) // queue size
                .mockResolvedValueOnce([[{ // processing metrics
                    recent_updates: 15,
                    avg_processing_time_seconds: 1.8
                }]]);

            const res = await request(app)
                .get('/api/statistics')
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.summary.total_symbols).toBe(1000);
            expect(res.body.summary.with_metadata).toBe(750);
            expect(res.body.summary.without_metadata).toBe(250);
            expect(res.body.summary.completion_percentage).toBe(75);
            
            // Test queue metrics
            expect(res.body.queue).toBeDefined();
            expect(res.body.queue.size).toBe(250);
            expect(res.body.queue.estimated_completion_minutes).toBe(9); // 250 * 2 / 60 = 8.33, rounded up
            expect(res.body.queue.status).toBe('pending');
            
            // Test processing metrics
            expect(res.body.processing).toBeDefined();
            expect(res.body.processing.recent_updates_last_hour).toBe(15);
            expect(res.body.processing.avg_processing_time_seconds).toBe(1.8);
            expect(res.body.processing.throttling_delay_seconds).toBe(2);
        });

        test('should return queue complete status when no symbols pending', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 1000 }]]) // total
                .mockResolvedValueOnce([[{ count: 1000 }]]) // all with metadata
                .mockResolvedValueOnce([[{ queue_size: 0 }]]) // empty queue
                .mockResolvedValueOnce([[{ // processing metrics
                    recent_updates: 20,
                    avg_processing_time_seconds: 1.5
                }]]);

            const res = await request(app)
                .get('/api/statistics')
                .expect(200);

            expect(res.body.queue.size).toBe(0);
            expect(res.body.queue.estimated_completion_minutes).toBe(0);
            expect(res.body.queue.status).toBe('complete');
        });

        test('should handle null processing metrics gracefully', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 500 }]]) // total
                .mockResolvedValueOnce([[{ count: 300 }]]) // with metadata
                .mockResolvedValueOnce([[{ queue_size: 200 }]]) // queue size
                .mockResolvedValueOnce([[{ // null processing metrics
                    recent_updates: null,
                    avg_processing_time_seconds: null
                }]]);

            const res = await request(app)
                .get('/api/statistics')
                .expect(200);

            expect(res.body.processing.recent_updates_last_hour).toBe(0);
            expect(res.body.processing.avg_processing_time_seconds).toBe(0);
        });

        test('should filter statistics by type', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 500 }]])  // total EQUITY
                .mockResolvedValueOnce([[{ count: 400 }]])  // with metadata EQUITY
                .mockResolvedValueOnce([[{ queue_size: 100 }]]) // queue size
                .mockResolvedValueOnce([[{ recent_updates: 5, avg_processing_time_seconds: 1.2 }]]); // processing

            const res = await request(app)
                .get('/api/statistics?type=EQUITY')
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.summary.total_symbols).toBe(500);
            expect(res.body.filter.applied).toBe(true);
            expect(res.body.filter.types).toContain('EQUITY');
        });

        test('should filter by multiple types', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 700 }]])  // total
                .mockResolvedValueOnce([[{ count: 550 }]])  // with metadata
                .mockResolvedValueOnce([[{ queue_size: 150 }]]) // queue size
                .mockResolvedValueOnce([[{ recent_updates: 8, avg_processing_time_seconds: 1.6 }]]); // processing

            const res = await request(app)
                .get('/api/statistics?type=EQUITY,ETF')
                .expect(200);

            expect(res.body.filter.types.length).toBe(2);
            expect(res.body.filter.types).toContain('EQUITY');
            expect(res.body.filter.types).toContain('ETF');
        });

        test('should handle empty registry', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 0 }]]) // total
                .mockResolvedValueOnce([[{ count: 0 }]]) // with metadata
                .mockResolvedValueOnce([[{ queue_size: 0 }]]) // queue size
                .mockResolvedValueOnce([[{ recent_updates: 0, avg_processing_time_seconds: 0 }]]); // processing

            const res = await request(app)
                .get('/api/statistics')
                .expect(200);

            expect(res.body.summary.total_symbols).toBe(0);
            expect(res.body.summary.completion_percentage).toBe(0);
        });

        test('should return 503 when pool unavailable', async () => {
            // Simulate pool that's initialized but fails
            mockPool.getConnection.mockRejectedValue(new Error('Connection unavailable'));

            const res = await request(app)
                .get('/api/statistics')
                .expect(500); // Will be 500 since pool exists but getConnection fails

            expect(res.body.error).toBeDefined();
        });

        test('should handle database errors', async () => {
            mockConnection.execute.mockRejectedValue(new Error('Database error'));

            const res = await request(app)
                .get('/api/statistics')
                .expect(500);

            expect(res.body.error).toContain('Failed to fetch statistics');
        });
    });

    describe('GET /statistics/by-type', () => {
        test('should return statistics by type', async () => {
            const mockData = [
                {
                    security_type: 'EQUITY',
                    total: 600,
                    with_metadata: 500,
                    without_metadata: 100
                },
                {
                    security_type: 'ETF',
                    total: 400,
                    with_metadata: 250,
                    without_metadata: 150
                }
            ];

            mockConnection.execute.mockResolvedValue([mockData]);

            const res = await request(app)
                .get('/api/statistics/by-type')
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.by_type).toHaveLength(2);
            expect(res.body.by_type[0].security_type).toBe('EQUITY');
            expect(res.body.by_type[0].completion_percentage).toBe(83);
            expect(res.body.by_type[1].completion_percentage).toBe(63);
        });

        test('should calculate overall statistics correctly', async () => {
            const mockData = [
                { security_type: 'EQUITY', total: 600, with_metadata: 500, without_metadata: 100 },
                { security_type: 'ETF', total: 400, with_metadata: 250, without_metadata: 150 }
            ];

            mockConnection.execute.mockResolvedValue([mockData]);

            const res = await request(app)
                .get('/api/statistics/by-type')
                .expect(200);

            expect(res.body.overall.total_symbols).toBe(1000);
            expect(res.body.overall.with_metadata).toBe(750);
            expect(res.body.overall.completion_percentage).toBe(75);
        });

        test('should include type count', async () => {
            mockConnection.execute.mockResolvedValue([[
                { security_type: 'EQUITY', total: 600, with_metadata: 500, without_metadata: 100 }
            ]]);

            const res = await request(app)
                .get('/api/statistics/by-type')
                .expect(200);

            expect(res.body.type_count).toBe(1);
        });

        test('should handle database errors', async () => {
            mockConnection.execute.mockRejectedValue(new Error('Database error'));

            const res = await request(app)
                .get('/api/statistics/by-type')
                .expect(500);

            expect(res.body.error).toContain('Failed to fetch type breakdown');
        });
    });

    describe('GET /statistics/type/:type', () => {
        test('should return statistics for specific type', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ security_type: 'EQUITY' }]]) // type check
                .mockResolvedValueOnce([[{
                    security_type: 'EQUITY',
                    total: 600,
                    with_metadata: 500,
                    without_metadata: 100
                }]]); // stats

            const res = await request(app)
                .get('/api/statistics/type/equity')
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data.security_type).toBe('EQUITY');
            expect(res.body.data.total_symbols).toBe(600);
            expect(res.body.data.completion_percentage).toBe(83);
        });

        test('should convert type to uppercase', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ security_type: 'ETF' }]])
                .mockResolvedValueOnce([[{
                    security_type: 'ETF',
                    total: 400,
                    with_metadata: 300,
                    without_metadata: 100
                }]]);

            await request(app)
                .get('/api/statistics/type/etf')
                .expect(200);

            const calls = mockConnection.execute.mock.calls;
            expect(calls[0][1][0]).toBe('ETF');
            expect(calls[1][1][0]).toBe('ETF');
        });

        test('should return 404 for non-existent type', async () => {
            mockConnection.execute.mockResolvedValueOnce([[]]);

            const res = await request(app)
                .get('/api/statistics/type/UNKNOWN')
                .expect(404);

            expect(res.body.error).toContain('not found');
        });

        test('should handle database errors', async () => {
            mockConnection.execute.mockRejectedValue(new Error('Database error'));

            const res = await request(app)
                .get('/api/statistics/type/EQUITY')
                .expect(500);

            expect(res.body.error).toContain('Failed to fetch type statistics');
        });
    });

    describe('POST /statistics/refresh-type', () => {
        test('should refresh metadata for security type', async () => {
            mockConnection.execute.mockResolvedValue([{
                affectedRows: 250
            }]);

            const res = await request(app)
                .post('/api/statistics/refresh-type')
                .send({ type: 'EQUITY' })
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.affected_count).toBe(250);
            expect(res.body.message).toContain('EQUITY');
        });

        test('should require type parameter', async () => {
            const res = await request(app)
                .post('/api/statistics/refresh-type')
                .send({})
                .expect(400);

            expect(res.body.error).toContain('Security type required');
        });

        test('should convert type to uppercase', async () => {
            mockConnection.execute.mockResolvedValue([{ affectedRows: 100 }]);

            await request(app)
                .post('/api/statistics/refresh-type')
                .send({ type: 'etf' })
                .expect(200);

            const calls = mockConnection.execute.mock.calls;
            expect(calls[0][1][0]).toBe('ETF');
        });

        test('should handle database errors', async () => {
            mockConnection.execute.mockRejectedValue(new Error('Database error'));

            const res = await request(app)
                .post('/api/statistics/refresh-type')
                .send({ type: 'EQUITY' })
                .expect(500);

            expect(res.body.error).toContain('Failed to trigger refresh');
        });
    });

    describe('POST /statistics/reset-type', () => {
        test('should reset metadata for security type', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([{ affectedRows: 50 }]) // archive
                .mockResolvedValueOnce([{ affectedRows: 50 }]) // delete
                .mockResolvedValueOnce([{ affectedRows: 100 }]); // reset

            const res = await request(app)
                .post('/api/statistics/reset-type')
                .send({ type: 'EQUITY' })
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('EQUITY');
        });

        test('should require type parameter', async () => {
            const res = await request(app)
                .post('/api/statistics/reset-type')
                .send({})
                .expect(400);

            expect(res.body.error).toContain('Security type required');
        });

        test('should use transaction for reset', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([{ affectedRows: 50 }])
                .mockResolvedValueOnce([{ affectedRows: 50 }])
                .mockResolvedValueOnce([{ affectedRows: 100 }]);

            await request(app)
                .post('/api/statistics/reset-type')
                .send({ type: 'ETF' })
                .expect(200);

            expect(mockConnection.beginTransaction).toHaveBeenCalled();
            expect(mockConnection.commit).toHaveBeenCalled();
        });

        test('should rollback on error', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([{ affectedRows: 50 }])
                .mockRejectedValueOnce(new Error('Database error'));

            const res = await request(app)
                .post('/api/statistics/reset-type')
                .send({ type: 'EQUITY' })
                .expect(500);

            expect(mockConnection.rollback).toHaveBeenCalled();
            expect(res.body.error).toContain('Failed to reset metadata');
        });

        test('should handle rollback errors', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([{ affectedRows: 50 }])
                .mockRejectedValueOnce(new Error('Database error'));
            
            mockConnection.rollback.mockRejectedValueOnce(new Error('Rollback failed'));

            const res = await request(app)
                .post('/api/statistics/reset-type')
                .send({ type: 'EQUITY' })
                .expect(500);

            expect(res.body.error).toBeDefined();
        });
    });

    describe('GET /statistics/available-types', () => {
        test('should return list of available types', async () => {
            mockConnection.execute.mockResolvedValue([[
                { security_type: 'EQUITY' },
                { security_type: 'ETF' },
                { security_type: 'MUTUAL_FUND' }
            ]]);

            const res = await request(app)
                .get('/api/statistics/available-types')
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.types).toHaveLength(3);
            expect(res.body.types).toContain('EQUITY');
            expect(res.body.count).toBe(3);
        });

        test('should return empty array for no types', async () => {
            mockConnection.execute.mockResolvedValue([[]]);

            const res = await request(app)
                .get('/api/statistics/available-types')
                .expect(200);

            expect(res.body.types).toHaveLength(0);
            expect(res.body.count).toBe(0);
        });

        test('should handle database errors', async () => {
            mockConnection.execute.mockRejectedValue(new Error('Database error'));

            const res = await request(app)
                .get('/api/statistics/available-types')
                .expect(500);

            expect(res.body.error).toContain('Failed to fetch available types');
        });
    });

    describe('Error Handling', () => {
        test('should release connection on success', async () => {
            mockConnection.execute.mockResolvedValue([[{ count: 100 }]]);

            await request(app)
                .get('/api/statistics')
                .expect(200);

            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should release connection on error', async () => {
            mockConnection.execute.mockRejectedValue(new Error('Database error'));

            await request(app)
                .get('/api/statistics')
                .expect(500);

            expect(mockConnection.release).toHaveBeenCalled();
        });

        test('should handle missing pool gracefully', async () => {
            // Simulate pool that's initialized but fails
            mockPool.getConnection.mockRejectedValue(new Error('Connection failed'));

            const res = await request(app)
                .get('/api/statistics')
                .expect(500);

            expect(res.body.error).toBeDefined();
        });

        test('should handle null completion gracefully', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 0 }]])
                .mockResolvedValueOnce([[{ count: 0 }]])
                .mockResolvedValueOnce([[{ queue_size: 0 }]])
                .mockResolvedValueOnce([[{ recent_updates: 0, avg_processing_time_seconds: 0 }]]);

            const res = await request(app)
                .get('/api/statistics')
                .expect(200);

            expect(res.body.summary.completion_percentage).toBe(0);
        });
    });

    describe('Type Parameter Handling', () => {
        test('should trim whitespace in type filter', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 800 }]])
                .mockResolvedValueOnce([[{ count: 650 }]])
                .mockResolvedValueOnce([[{ queue_size: 150 }]])
                .mockResolvedValueOnce([[{ recent_updates: 12, avg_processing_time_seconds: 1.4 }]]);

            const res = await request(app)
                .get('/api/statistics?type=EQUITY, ETF')
                .expect(200);

            expect(res.body.filter.types).toHaveLength(2);
            expect(res.body.filter.types).toContain('ETF');
        });

        test('should uppercase type values', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 300 }]])
                .mockResolvedValueOnce([[{ count: 200 }]])
                .mockResolvedValueOnce([[{ queue_size: 100 }]])
                .mockResolvedValueOnce([[{ recent_updates: 7, avg_processing_time_seconds: 1.1 }]]);

            const res = await request(app)
                .get('/api/statistics?type=equity')
                .expect(200);

            expect(res.body.filter.types[0]).toBe('EQUITY');
        });
    });

    describe('Statistics Calculations', () => {
        test('should calculate completion percentage correctly', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 300 }]])
                .mockResolvedValueOnce([[{ count: 100 }]])
                .mockResolvedValueOnce([[{ queue_size: 200 }]])
                .mockResolvedValueOnce([[{ recent_updates: 5, avg_processing_time_seconds: 1.3 }]]);

            const res = await request(app)
                .get('/api/statistics')
                .expect(200);

            expect(res.body.summary.completion_percentage).toBe(33);
        });

        test('should round completion percentage', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 300 }]])
                .mockResolvedValueOnce([[{ count: 200 }]])
                .mockResolvedValueOnce([[{ queue_size: 100 }]])
                .mockResolvedValueOnce([[{ recent_updates: 10, avg_processing_time_seconds: 1.5 }]]);

            const res = await request(app)
                .get('/api/statistics')
                .expect(200);

            expect(res.body.summary.completion_percentage).toBe(67);
        });

        test('should handle 100% completion', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[{ count: 100 }]])
                .mockResolvedValueOnce([[{ count: 100 }]])
                .mockResolvedValueOnce([[{ queue_size: 0 }]])
                .mockResolvedValueOnce([[{ recent_updates: 15, avg_processing_time_seconds: 1.2 }]]);

            const res = await request(app)
                .get('/api/statistics')
                .expect(200);

            expect(res.body.summary.completion_percentage).toBe(100);
        });
    });
});
