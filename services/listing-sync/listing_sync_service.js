/**
 * Listing Sync Service (Phase 1)
 *
 * Provides a single orchestration point to:
 * 1) download/update listing CSV files into config/
 * 2) sync those listings into MySQL (ticker_registry)
 *
 * Phase 2 adds the HTTP API endpoints in detail.
 */

const mysql = require('mysql2/promise');

const { CsvDownloader } = require('./csv_downloader');
const { createHttpApi } = require('./http_api');
const SymbolRegistryService = require('../symbol-registry/ticker_registry_service');
const SymbolRegistrySyncService = require('../symbol-registry/symbol_registry_sync');
const { CryptoListingOrchestrator } = require('../../scripts/setup/update_crypto_listings');
const path = require('path');

const DEFAULT_CONFIG = {
  syncIntervalMinutes: 1440,
  httpPort: 3010,
  enableAutoSync: false,
  enableHttpApi: false,

  dbHost: process.env.DB_HOST || 'mysql',
  dbPort: parseInt(process.env.DB_PORT || '3306', 10),
  dbName: process.env.DB_NAME || 'wealth_tracker',
  dbUser: process.env.DB_USER || 'root',
  dbPassword: process.env.DB_PASSWORD || ''
};

class ListingSyncService {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };

    this.startedAtMs = Date.now();

    this.dbPool = options.dbPool || null;
    this.downloader = options.downloader || new CsvDownloader({ configDir: options.configDir });

    // Allow injection for unit tests
    this.symbolRegistryService = options.symbolRegistryService || null;
    this.syncService = options.syncService || null;

    this.httpServer = null;
    this.syncTimer = null;

    this.isRunning = false;
    this.lastSyncAt = null;
    this.lastSyncStatus = null;

    this.stats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastSyncDurationMs: 0
    };
  }

  async initialize() {
    if (!this.dbPool) {
      this.dbPool = await mysql.createPool({
        host: this.config.dbHost,
        port: this.config.dbPort,
        user: this.config.dbUser,
        password: this.config.dbPassword,
        database: this.config.dbName,
        waitForConnections: true,
        connectionLimit: 5
      });
    }

    if (!this.symbolRegistryService) {
      this.symbolRegistryService = new SymbolRegistryService(this.dbPool);
    }

    if (!this.syncService) {
      this.syncService = new SymbolRegistrySyncService(this.dbPool, this.symbolRegistryService);
    }

    if (this.config.enableHttpApi) {
      await this._startHttpServer();
    }

    if (this.config.enableAutoSync) {
      const intervalMs = this.config.syncIntervalMinutes * 60 * 1000;
      this.syncTimer = setInterval(() => {
        this.syncAll().catch(() => { });
      }, intervalMs);
    }

    this.isRunning = true;
  }

  async _startHttpServer() {
    if (this.httpServer) return;

    this.httpServer = createHttpApi(this);

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      this.httpServer.once('error', onError);
      this.httpServer.listen(this.config.httpPort, () => {
        this.httpServer.off('error', onError);
        resolve();
      });
    });
  }

  getHealth() {
    return {
      status: 'ok',
      uptime: Math.max(0, Math.floor((Date.now() - this.startedAtMs) / 1000)),
      lastSync: {
        at: this.lastSyncAt,
        status: this.lastSyncStatus
      }
    };
  }

  async syncFileType(fileType) {
    const start = Date.now();
    try {
      let download = null;

      // Exchange file types require file download/update.
      if (fileType === 'NASDAQ' || fileType === 'NYSE' || fileType === 'OTHER') {
        download = await this.downloader.downloadAndUpdate(fileType);
      } else if (fileType === 'CRYPTO_INVESTING') {
        await this.updateCryptoListings();
      }

      const stats = await this.syncService.syncFileType(fileType);
      return {
        success: true,
        fileType,
        stats,
        download,
        durationMs: Date.now() - start
      };
    } catch (e) {
      return {
        success: false,
        fileType,
        error: e.message,
        durationMs: Date.now() - start
      };
    }
  }

  async syncTickers(tickers) {
    const sync = await this.syncAll();
    if (!sync.success) {
      return {
        success: false,
        error: sync.error,
        results: null
      };
    }

    const results = {};
    for (const t of tickers) {
      const data = await this.lookupTicker(t);
      results[t] = {
        found: !!data,
        data: data || null
      };
    }

    return {
      success: true,
      results
    };
  }

  async lookupTicker(ticker) {
    return await this.symbolRegistryService.lookupSymbol(ticker);
  }

  async updateCryptoListings() {
    console.log('[ListingSyncService] Updating crypto listings...');
    const orchestrator = new CryptoListingOrchestrator();
    await orchestrator.updateAll();
  }

  async syncAll() {
    const start = Date.now();
    this.stats.totalSyncs++;

    try {
      // 1) Ensure listing CSVs are up to date
      const downloadResults = await this.downloader.downloadAndUpdateAll();

      // 1b) Update crypto listings (scraping)
      await this.updateCryptoListings();

      // 2) Sync into DB via the existing registry sync implementation
      const fileTypes = ['NASDAQ', 'NYSE', 'OTHER', 'TREASURY', 'CRYPTO_INVESTING'];
      const syncResults = {};
      for (const ft of fileTypes) {
        // Treasury loads from TreasuryDataHandler; exchange file types from CSV
        syncResults[ft] = await this.syncService.syncFileType(ft);
      }

      this.lastSyncAt = new Date().toISOString();
      this.lastSyncStatus = 'SUCCESS';
      this.stats.successfulSyncs++;
      this.stats.lastSyncDurationMs = Date.now() - start;

      return {
        success: true,
        downloads: downloadResults,
        sync: syncResults,
        durationMs: this.stats.lastSyncDurationMs
      };
    } catch (e) {
      this.lastSyncAt = new Date().toISOString();
      this.lastSyncStatus = 'FAILED';
      this.stats.failedSyncs++;
      this.stats.lastSyncDurationMs = Date.now() - start;

      return {
        success: false,
        error: e.message,
        durationMs: this.stats.lastSyncDurationMs
      };
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastSyncAt: this.lastSyncAt,
      lastSyncStatus: this.lastSyncStatus,
      stats: this.stats
    };
  }

  async shutdown() {
    this.isRunning = false;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }

    if (this.dbPool && typeof this.dbPool.end === 'function') {
      await this.dbPool.end();
      this.dbPool = null;
    }
  }
}

module.exports = {
  ListingSyncService,
  DEFAULT_CONFIG
};

function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
  return defaultValue;
}

if (require.main === module) {
  (async () => {
    const httpPort = parseInt(process.env.HTTP_PORT || process.env.LISTING_SYNC_PORT || String(DEFAULT_CONFIG.httpPort), 10);
    const enableHttpApi = envFlag('ENABLE_HTTP_API', envFlag('ENABLE_LISTING_SYNC_HTTP_API', true));
    const enableAutoSync = envFlag('ENABLE_AUTO_SYNC', envFlag('ENABLE_LISTING_SYNC_AUTO_SYNC', false));
    const syncIntervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || String(DEFAULT_CONFIG.syncIntervalMinutes), 10);

    const service = new ListingSyncService({
      httpPort,
      enableHttpApi,
      enableAutoSync,
      syncIntervalMinutes,
      configDir: process.env.CONFIG_DIR
    });

    await service.initialize();
    // eslint-disable-next-line no-console
    console.log(`[ListingSyncService] running on :${httpPort} (httpApi=${enableHttpApi}, autoSync=${enableAutoSync})`);

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      // eslint-disable-next-line no-console
      console.log(`[ListingSyncService] shutting down (${signal})...`);
      try {
        await service.shutdown();
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  })().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[ListingSyncService] failed to start:', e);
    process.exit(1);
  });
}
