# Listing Sync Service

The Listing Sync Service keeps symbol listing files and the `ticker_registry` table up to date. It exposes a small HTTP API for health/status and on-demand sync operations.

## Purpose

- Download/update listings into the local `config/` directory (NASDAQ/NYSE/OTHER)
- Sync listings into MySQL (`ticker_registry`) using the existing symbol registry sync pipeline
- Provide an HTTP API so other services (dashboard, ops tooling) can trigger syncs and lookups

## How To Run

### Docker Compose

If your compose file includes the `listing-sync` service:

- Service listens on `http://localhost:3010`
- Health endpoint: `GET /health`

### Node (local)

Run directly:

- `HTTP_PORT=3010 ENABLE_HTTP_API=true node services/listing-sync/listing_sync_service.js`

## Configuration

Environment variables:

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `HTTP_PORT` (default: `3010`)
- `ENABLE_HTTP_API` (default: `true` when run as a service)
- `ENABLE_AUTO_SYNC` (default: `false`)
- `SYNC_INTERVAL_MINUTES` (default: `1440`)
- `CONFIG_DIR` (path to listing CSVs; typically mounted to `/app/config` in containers)

## HTTP API

All responses are JSON.

- `GET /health`
  - 200: `{ "status": "ok", "uptime": <seconds>, "lastSync": { "at": <iso|null>, "status": <"SUCCESS"|"FAILED"|null> } }`

- `GET /status`
  - 200: `{ "isRunning": true, "stats": { ... }, "lastSync": { ... } }`

- `POST /sync/all`
  - 200: `{ "success": true, "results": { "downloads": {...}, "sync": {...} } }`

- `POST /sync/file/:type`
  - `type` in `{ NASDAQ, NYSE, OTHER, TREASURY }`

- `POST /sync/tickers`
  - Body: `{ "tickers": ["AAPL", "MSFT"] }`

- `GET /lookup/:ticker`
  - 200: ticker record
  - 404: `{ "error": "Ticker not found", "ticker": "..." }`
