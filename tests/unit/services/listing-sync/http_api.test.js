const request = require('supertest');

const { createHttpApi } = require('../../../../services/listing-sync/http_api');

describe('Listing Sync HTTP API (Phase 2)', () => {
  test('GET /health returns status and uptime', async () => {
    const service = {
      getHealth: jest.fn().mockReturnValue({
        status: 'ok',
        uptime: 123,
        lastSync: { at: null, status: null }
      })
    };

    const server = createHttpApi(service);
    const res = await request(server).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBe(123);
  });

  test('OPTIONS preflight returns 204', async () => {
    const service = {
      getHealth: jest.fn()
    };

    const server = createHttpApi(service);
    const res = await request(server).options('/health');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  test('GET /status returns normalized shape', async () => {
    const service = {
      getStatus: jest.fn().mockReturnValue({
        isRunning: true,
        stats: { totalSyncs: 1 },
        lastSyncAt: '2025-12-14T00:00:00.000Z',
        lastSyncStatus: 'SUCCESS'
      })
    };

    const server = createHttpApi(service);
    const res = await request(server).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.isRunning).toBe(true);
    expect(res.body.stats.totalSyncs).toBe(1);
    expect(res.body.lastSync).toEqual({
      at: '2025-12-14T00:00:00.000Z',
      status: 'SUCCESS'
    });
  });

  test('POST /sync/all wraps results', async () => {
    const service = {
      syncAll: jest.fn().mockResolvedValue({ success: true, downloads: {}, sync: {} })
    };

    const server = createHttpApi(service);
    const res = await request(server).post('/sync/all');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.results).toBeDefined();
    expect(service.syncAll).toHaveBeenCalledTimes(1);
  });

  test('POST /sync/file/:type validates fileType', async () => {
    const service = {
      syncFileType: jest.fn()
    };

    const server = createHttpApi(service);
    const res = await request(server).post('/sync/file/BOGUS');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid file type');
    expect(service.syncFileType).not.toHaveBeenCalled();
  });

  test('POST /sync/tickers rejects invalid JSON', async () => {
    const service = {
      syncTickers: jest.fn()
    };

    const server = createHttpApi(service);
    const res = await request(server)
      .post('/sync/tickers')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid JSON');
    expect(service.syncTickers).not.toHaveBeenCalled();
  });

  test('POST /sync/tickers requires non-empty tickers array', async () => {
    const service = {
      syncTickers: jest.fn()
    };

    const server = createHttpApi(service);
    const res = await request(server)
      .post('/sync/tickers')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tickers array/);
    expect(service.syncTickers).not.toHaveBeenCalled();
  });

  test('GET /lookup/:ticker returns 404 when not found', async () => {
    const service = {
      lookupTicker: jest.fn().mockResolvedValue(null)
    };

    const server = createHttpApi(service);
    const res = await request(server).get('/lookup/NOPE');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Ticker not found');
    expect(res.body.ticker).toBe('NOPE');
  });

  test('GET /lookup/:ticker returns ticker info', async () => {
    const service = {
      lookupTicker: jest.fn().mockResolvedValue({
        ticker: 'AAPL',
        exchange: 'NASDAQ',
        security_type: 'EQUITY'
      })
    };

    const server = createHttpApi(service);
    const res = await request(server).get('/lookup/aapl');

    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('AAPL');
    expect(res.body.exchange).toBe('NASDAQ');
  });

  test('unknown route returns 404', async () => {
    const service = {};
    const server = createHttpApi(service);

    const res = await request(server).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
