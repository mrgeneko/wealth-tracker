/**
 * HTTP API Handler for Listing Sync Service (Phase 2)
 *
 * Endpoints:
 * - GET  /health
 * - GET  /status
 * - POST /sync/all
 * - POST /sync/file/:type
 * - POST /sync/tickers
 * - GET  /lookup/:ticker
 */

const http = require('http');

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, options = {}) {
  const maxBytes = options.maxBytes ?? 1024 * 1024; // 1MB

  return await new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;

    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });

    req.on('end', () => {
      if (!data) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (e) {
        const err = new Error('Invalid JSON');
        err.code = 'INVALID_JSON';
        reject(err);
      }
    });

    req.on('error', reject);
  });
}

function normalizeTicker(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim().toUpperCase();
  if (!t) return null;
  return t;
}

function normalizeFileType(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim().toUpperCase();
  if (!t) return null;
  return t;
}

function createHttpApi(service) {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = parsedUrl.pathname || '/';
    const method = req.method || 'GET';

    // CORS headers for dashboard access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (pathname === '/health' && method === 'GET') {
        const data = await service.getHealth();
        writeJson(res, 200, data);
        return;
      }

      if (pathname === '/status' && method === 'GET') {
        const status = await service.getStatus();
        const lastSync = {
          at: status.lastSyncAt,
          status: status.lastSyncStatus
        };
        writeJson(res, 200, {
          isRunning: status.isRunning,
          stats: status.stats,
          lastSync
        });
        return;
      }

      if (pathname === '/sync/all' && method === 'POST') {
        const results = await service.syncAll();
        writeJson(res, 200, { success: !!results.success, results });
        return;
      }

      if (pathname.startsWith('/sync/file/') && method === 'POST') {
        const fileTypeRaw = pathname.slice('/sync/file/'.length);
        const fileType = normalizeFileType(decodeURIComponent(fileTypeRaw));
        const allowed = new Set(['NASDAQ', 'NYSE', 'OTHER', 'TREASURY']);
        if (!fileType || !allowed.has(fileType)) {
          writeJson(res, 400, { error: 'Invalid file type', allowed: Array.from(allowed) });
          return;
        }

        const result = await service.syncFileType(fileType);
        writeJson(res, 200, {
          success: !!result.success,
          fileType,
          stats: result.stats,
          download: result.download,
          error: result.error
        });
        return;
      }

      if (pathname === '/sync/tickers' && method === 'POST') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          if (e.code === 'INVALID_JSON') {
            writeJson(res, 400, { error: 'Invalid JSON' });
            return;
          }
          if (e.message === 'Request body too large') {
            writeJson(res, 413, { error: 'Request body too large' });
            return;
          }
          throw e;
        }

        const tickersRaw = body && body.tickers;
        if (!Array.isArray(tickersRaw) || tickersRaw.length === 0) {
          writeJson(res, 400, { error: 'Request body must include non-empty tickers array' });
          return;
        }

        const tickers = tickersRaw
          .map(normalizeTicker)
          .filter(Boolean);

        if (tickers.length === 0) {
          writeJson(res, 400, { error: 'No valid tickers provided' });
          return;
        }

        const results = await service.syncTickers(tickers);
        writeJson(res, 200, { success: !!results.success, results });
        return;
      }

      if (pathname.startsWith('/lookup/') && method === 'GET') {
        const tickerRaw = pathname.slice('/lookup/'.length);
        const ticker = normalizeTicker(decodeURIComponent(tickerRaw));
        if (!ticker) {
          writeJson(res, 400, { error: 'Invalid ticker' });
          return;
        }

        const data = await service.lookupTicker(ticker);
        if (!data) {
          writeJson(res, 404, { error: 'Ticker not found', ticker });
          return;
        }

        writeJson(res, 200, data);
        return;
      }

      writeJson(res, 404, { error: 'Not found' });
    } catch (error) {
      // Avoid leaking internal details beyond message; keep contract stable.
      writeJson(res, 500, { error: error && error.message ? error.message : 'Internal error' });
    }
  });

  return server;
}

module.exports = {
  createHttpApi,
  readJsonBody,
  normalizeTicker,
  normalizeFileType
};
