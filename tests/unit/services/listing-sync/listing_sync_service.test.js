jest.mock('mysql2/promise');
const mysql = require('mysql2/promise');

const { ListingSyncService } = require('../../../../services/listing-sync/listing_sync_service');

jest.mock('../../../../scripts/setup/update_crypto_listings', () => ({
  CryptoListingOrchestrator: jest.fn().mockImplementation(() => ({
    updateAll: jest.fn().mockResolvedValue(true)
  }))
}));

describe('ListingSyncService (Phase 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('initialize creates db pool and sync wiring', async () => {
    const mockPool = { end: jest.fn().mockResolvedValue(undefined) };
    mysql.createPool.mockResolvedValue(mockPool);

    const svc = new ListingSyncService({
      enableHttpApi: false,
      enableAutoSync: false
    });

    await svc.initialize();

    expect(mysql.createPool).toHaveBeenCalled();
    expect(svc.dbPool).toBe(mockPool);
    expect(svc.isRunning).toBe(true);

    await svc.shutdown();
    expect(mockPool.end).toHaveBeenCalled();
  });

  test('syncAll calls downloader and sync service', async () => {
    const mockPool = { end: jest.fn().mockResolvedValue(undefined) };

    const downloader = {
      downloadAndUpdateAll: jest.fn().mockResolvedValue({ NASDAQ: { updated: true } })
    };

    const syncService = {
      syncFileType: jest.fn().mockResolvedValue({ inserted: 1, updated: 0 })
    };

    const svc = new ListingSyncService({
      dbPool: mockPool,
      downloader,
      syncService,
      enableHttpApi: false,
      enableAutoSync: false
    });

    await svc.initialize();

    const res = await svc.syncAll();

    expect(downloader.downloadAndUpdateAll).toHaveBeenCalled();
    expect(syncService.syncFileType).toHaveBeenCalledTimes(5);
    expect(res.success).toBe(true);
  });
});
