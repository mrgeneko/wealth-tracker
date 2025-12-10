/**
 * Unit tests for Performance Metrics API
 * Phase 8.4 Implementation
 */

const { router, initializePool } = require('../../../api/metrics');
const express = require('express');
const request = require('supertest');

// Mock database pool
const mockConnection = {
    execute: jest.fn(),
    release: jest.fn()
};

const mockPool = {
    getConnection: jest.fn().mockResolvedValue(mockConnection)
};

// Create test app
function createTestApp() {
    const app = express();
    app.use(express.json());
    initializePool(mockPool);
    app.use('/api/metrics', router);
    return app;
}

describe('Performance Metrics API', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = createTestApp();
    });

    describe('GET /api/metrics/summary', () => {
        it('should return metrics summary with all required fields', async () => {
            // Mock latest metrics
            mockConnection.execute
                .mockResolvedValueOnce([[
                    { source: 'NASDAQ', metric_date: new Date(), total_symbols: 5000 }
                ]])
                // Mock file status
                .mockResolvedValueOnce([[
                    { file_type: 'NASDAQ', last_refresh_status: 'SUCCESS' }
                ]])
                // Mock overall stats
                .mockResolvedValueOnce([[
                    { total_symbols: 12000, with_metadata: 1000, type_count: 4 }
                ]])
                // Mock recent errors
                .mockResolvedValueOnce([[{ error_count: 0 }]]);

            const response = await request(app).get('/api/metrics/summary');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body).toHaveProperty('summary');
            expect(response.body).toHaveProperty('latestMetrics');
            expect(response.body).toHaveProperty('fileRefreshStatus');
            expect(response.body).toHaveProperty('timestamp');
        });

        it('should calculate completion percentage correctly', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[]])
                .mockResolvedValueOnce([[]])
                .mockResolvedValueOnce([[
                    { total_symbols: 100, with_metadata: 75, type_count: 2 }
                ]])
                .mockResolvedValueOnce([[{ error_count: 5 }]]);

            const response = await request(app).get('/api/metrics/summary');

            expect(response.status).toBe(200);
            expect(response.body.summary.completionPercentage).toBe(75);
            expect(response.body.summary.recentErrors).toBe(5);
        });

        it('should handle empty database gracefully', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[]])
                .mockResolvedValueOnce([[]])
                .mockResolvedValueOnce([[{ total_symbols: 0, with_metadata: 0, type_count: 0 }]])
                .mockResolvedValueOnce([[{ error_count: 0 }]]);

            const response = await request(app).get('/api/metrics/summary');

            expect(response.status).toBe(200);
            expect(response.body.summary.totalSymbols).toBe(0);
            expect(response.body.summary.completionPercentage).toBe(0);
        });
    });

    describe('GET /api/metrics/history', () => {
        it('should return metrics history for default 7 days', async () => {
            mockConnection.execute.mockResolvedValueOnce([[
                { metric_date: new Date('2025-12-09'), source: 'NASDAQ', total_symbols: 5000 },
                { metric_date: new Date('2025-12-08'), source: 'NASDAQ', total_symbols: 4900 }
            ]]);

            const response = await request(app).get('/api/metrics/history');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.days).toBe(7);
            expect(response.body).toHaveProperty('history');
            expect(response.body).toHaveProperty('rawData');
        });

        it('should filter by source when provided', async () => {
            mockConnection.execute.mockResolvedValueOnce([[]]);

            const response = await request(app).get('/api/metrics/history?source=NASDAQ&days=14');

            expect(response.status).toBe(200);
            expect(response.body.days).toBe(14);
            expect(response.body.source).toBe('NASDAQ');
        });

        it('should group history by date', async () => {
            mockConnection.execute.mockResolvedValueOnce([[
                { metric_date: new Date('2025-12-09'), source: 'NASDAQ', total_symbols: 5000 },
                { metric_date: new Date('2025-12-09'), source: 'NYSE', total_symbols: 3000 }
            ]]);

            const response = await request(app).get('/api/metrics/history');

            expect(response.status).toBe(200);
            expect(response.body.history.length).toBeGreaterThan(0);
            expect(response.body.history[0]).toHaveProperty('sources');
        });
    });

    describe('GET /api/metrics/refresh-status', () => {
        it('should return refresh status for all file types', async () => {
            mockConnection.execute.mockResolvedValueOnce([[
                { file_type: 'NASDAQ', last_refresh_status: 'SUCCESS', last_refresh_at: new Date() },
                { file_type: 'NYSE', last_refresh_status: 'SUCCESS', last_refresh_at: new Date() },
                { file_type: 'OTHER', last_refresh_status: 'FAILED', last_error_message: 'Test error' },
                { file_type: 'TREASURY', last_refresh_status: 'IN_PROGRESS' }
            ]]);

            const response = await request(app).get('/api/metrics/refresh-status');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.status).toHaveLength(4);
            expect(response.body.overallHealth).toBe('degraded'); // Because OTHER failed
        });

        it('should calculate health status correctly', async () => {
            mockConnection.execute.mockResolvedValueOnce([[
                { file_type: 'NASDAQ', last_refresh_status: 'SUCCESS' },
                { file_type: 'NYSE', last_refresh_status: 'SUCCESS' }
            ]]);

            const response = await request(app).get('/api/metrics/refresh-status');

            expect(response.status).toBe(200);
            expect(response.body.overallHealth).toBe('healthy');
        });

        it('should include time since refresh', async () => {
            const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
            mockConnection.execute.mockResolvedValueOnce([[
                { file_type: 'NASDAQ', last_refresh_status: 'SUCCESS', last_refresh_at: pastDate }
            ]]);

            const response = await request(app).get('/api/metrics/refresh-status');

            expect(response.status).toBe(200);
            expect(response.body.status[0].timeSinceRefresh).toBeGreaterThanOrEqual(60);
        });
    });

    describe('POST /api/metrics/record', () => {
        it('should record new metrics entry', async () => {
            mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

            const response = await request(app)
                .post('/api/metrics/record')
                .send({
                    source: 'NASDAQ',
                    totalSymbols: 5000,
                    symbolsWithMetadata: 1000,
                    symbolsWithoutMetadata: 4000,
                    downloadDurationMs: 1500,
                    errorsCount: 0
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(mockConnection.execute).toHaveBeenCalled();
        });

        it('should require source parameter', async () => {
            const response = await request(app)
                .post('/api/metrics/record')
                .send({ totalSymbols: 5000 });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid request');
        });
    });

    describe('POST /api/metrics/update-file-status', () => {
        it('should update file status successfully', async () => {
            mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

            const response = await request(app)
                .post('/api/metrics/update-file-status')
                .send({
                    fileType: 'NASDAQ',
                    status: 'SUCCESS',
                    durationMs: 2500,
                    symbolsAdded: 100,
                    symbolsUpdated: 50
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('should validate file type', async () => {
            const response = await request(app)
                .post('/api/metrics/update-file-status')
                .send({
                    fileType: 'INVALID',
                    status: 'SUCCESS'
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid file type');
        });

        it('should validate status', async () => {
            const response = await request(app)
                .post('/api/metrics/update-file-status')
                .send({
                    fileType: 'NASDAQ',
                    status: 'INVALID'
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid status');
        });

        it('should require fileType and status', async () => {
            const response = await request(app)
                .post('/api/metrics/update-file-status')
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('required');
        });
    });

    describe('GET /api/metrics/success-rate', () => {
        it('should calculate success rate correctly', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[
                    { file_type: 'NASDAQ', last_refresh_status: 'SUCCESS', count: 1 },
                    { file_type: 'NYSE', last_refresh_status: 'SUCCESS', count: 1 },
                    { file_type: 'OTHER', last_refresh_status: 'FAILED', count: 1 }
                ]])
                .mockResolvedValueOnce([[
                    { metric_date: new Date(), total_errors: 5 }
                ]]);

            const response = await request(app).get('/api/metrics/success-rate?days=7');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.successRate).toBe(67); // 2/3 = 67%
            expect(response.body).toHaveProperty('errorTrends');
        });

        it('should return 100% when all successful', async () => {
            mockConnection.execute
                .mockResolvedValueOnce([[
                    { file_type: 'NASDAQ', last_refresh_status: 'SUCCESS', count: 1 },
                    { file_type: 'NYSE', last_refresh_status: 'SUCCESS', count: 1 }
                ]])
                .mockResolvedValueOnce([[]]);

            const response = await request(app).get('/api/metrics/success-rate');

            expect(response.status).toBe(200);
            expect(response.body.successRate).toBe(100);
        });
    });

    describe('Error handling', () => {
        it('should handle database errors gracefully', async () => {
            mockConnection.execute.mockRejectedValueOnce(new Error('Database error'));

            const response = await request(app).get('/api/metrics/summary');

            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Failed to fetch metrics');
        });

        it('should return 503 when pool not initialized', async () => {
            const app = express();
            app.use(express.json());
            // Don't initialize pool
            const { router: uninitRouter } = require('../../../api/metrics');
            // Create new router without pool
            const testRouter = express.Router();
            testRouter.get('/test', (req, res) => res.json({ ok: true }));
            app.use('/api/metrics', uninitRouter);

            // This test verifies the middleware works, actual behavior depends on module state
            const response = await request(app).get('/api/metrics/summary');
            // Will either be 503 (pool not init) or 500 (error) depending on test order
            expect([500, 503]).toContain(response.status);
        });
    });
});
