/**
 * CSV Downloader Module
 *
 * Downloads exchange listing CSVs into the configured config directory.
 * Designed to be used by ListingSyncService as a pre-step before DB sync.
 */

const https = require('https');
const path = require('path');
const fs = require('fs/promises');

const DEFAULT_SOURCES = {
  NASDAQ: {
    url: 'https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed.csv',
    fileName: 'nasdaq-listed.csv'
  },
  NYSE: {
    url: 'https://raw.githubusercontent.com/datasets/nyse-other-listings/main/data/nyse-listed.csv',
    fileName: 'nyse-listed.csv'
  },
  OTHER: {
    url: 'https://raw.githubusercontent.com/datasets/nyse-other-listings/main/data/other-listed.csv',
    fileName: 'other-listed.csv'
  }
};

function defaultFetch(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
        res.resume();
        return;
      }

      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout downloading ${url}`));
    });
    req.on('error', reject);
  });
}

async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch (e) {
    return false;
  }
}

function lineCount(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

/**
 * Decide whether the local file should be updated.
 *
 * Safety rule: if remote is significantly smaller (default 1%), skip update.
 */
async function needsUpdate(localFile, remoteContent, options = {}) {
  const minSizeRatio = options.minSizeRatio ?? 0.99;

  const exists = await fileExists(localFile);
  if (!exists) return true;

  const localContent = await fs.readFile(localFile, 'utf8');
  const localSize = Buffer.byteLength(localContent, 'utf8');
  const remoteSize = Buffer.byteLength(remoteContent, 'utf8');

  if (localSize > 0) {
    const sizeRatio = remoteSize / localSize;
    if (sizeRatio < minSizeRatio) {
      return false;
    }
  }

  return lineCount(localContent) !== lineCount(remoteContent);
}

class CsvDownloader {
  constructor(options = {}) {
    this.configDir = options.configDir || process.env.CONFIG_DIR || path.join(__dirname, '../../config');
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.minSizeRatio = options.minSizeRatio ?? 0.99;

    // Dependency injection for tests
    this.fetch = options.fetch || ((url) => defaultFetch(url, this.timeoutMs));

    this.sources = options.sources || DEFAULT_SOURCES;
  }

  async _sleep(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }

  async _fetchWithRetry(url) {
    let lastErr = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.fetch(url);
      } catch (e) {
        lastErr = e;
        if (attempt < this.maxRetries) {
          await this._sleep(this.retryDelayMs);
        }
      }
    }
    throw lastErr;
  }

  async downloadAndUpdate(sourceKey) {
    const src = this.sources[sourceKey];
    if (!src) throw new Error(`Unknown CSV source: ${sourceKey}`);

    await fs.mkdir(this.configDir, { recursive: true });

    const destPath = path.join(this.configDir, src.fileName);
    const remoteContent = await this._fetchWithRetry(src.url);

    const shouldUpdate = await needsUpdate(destPath, remoteContent, { minSizeRatio: this.minSizeRatio });
    if (!shouldUpdate) {
      return {
        source: sourceKey,
        updated: false,
        path: destPath
      };
    }

    // Backup existing file if present
    if (await fileExists(destPath)) {
      const backupPath = `${destPath}.backup.${Date.now()}`;
      await fs.copyFile(destPath, backupPath);
    }

    await fs.writeFile(destPath, remoteContent, 'utf8');

    return {
      source: sourceKey,
      updated: true,
      path: destPath
    };
  }

  async downloadAndUpdateAll() {
    const results = {};
    for (const sourceKey of Object.keys(this.sources)) {
      results[sourceKey] = await this.downloadAndUpdate(sourceKey);
    }
    return results;
  }
}

module.exports = {
  CsvDownloader,
  DEFAULT_SOURCES,
  needsUpdate
};
