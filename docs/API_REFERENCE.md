# API Reference

This document summarizes the HTTP endpoints used by the refactoring plan components.

## Scrapers Service (browser scraping)

### POST /scrape

On-demand browser scrape endpoint exposed by the scrapers daemon health server.

- URL (docker-compose default): `http://localhost:3002/scrape`
- Method: `POST`
- Content-Type: `application/json`

Request:

```json
{ "tickers": ["AAPL", "MSFT"], "source": "google" }
```

Rules:
- `tickers` is required and must be an array of strings.
- `source` is optional; defaults to `"google"`.
- The server enforces per-source rate limiting and fails fast with 429.

Success (200):

```json
{
  "success": true,
  "results": {
    "AAPL": { "success": true, "price": "187.12", "source": "google" },
    "MSFT": { "success": false, "error": "not found", "source": "google" }
  }
}
```

Client errors (400):

```json
{ "error": "tickers array required" }
```

```json
{ "error": "too_many_tickers" }
```

Rate limited (429):

```json
{
  "error": "rate_limited",
  "source": "google",
  "retryAfterMs": 12000,
  "limits": { "maxTickersPerMinute": 60, "maxConcurrent": 4 }
}
```

Headers:
- `Retry-After`: seconds (rounded up)

### Watchlist management (Phase 11)

Provider-based watchlist endpoints exposed by the scrapers daemon health server.

- URL (docker-compose default via dashboard): `http://localhost:3000/api/watchlist/...`
- URL (direct to scrapers daemon): `http://localhost:3002/watchlist/...`

Routes (scrapers daemon):
- `GET /watchlist/providers`
- `GET /watchlist/:provider/status`
- `GET /watchlist/:provider/tabs`
- `GET /watchlist/:provider/tickers`
- `POST /watchlist/:provider/add` body: `{ "ticker": "AAPL", "watchlist": "primary", "assetType": "stock" }`
- `POST /watchlist/:provider/delete` body: `{ "ticker": "AAPL", "watchlist": "primary" }`

Routes (dashboard proxy):
- `GET /api/watchlist/providers`
- `GET /api/watchlist/:provider/status`
- `GET /api/watchlist/:provider/tabs`
- `GET /api/watchlist/:provider/tickers`
- `POST /api/watchlist/:provider/add`
- `POST /api/watchlist/:provider/delete`

For configuration and adding new providers, see `docs/WATCHLIST_PROVIDERS.md`.

## Listing Sync Service

- URL (docker-compose default): `http://localhost:3010`

Endpoints:
- `GET /health`
- `GET /status`
- `POST /sync/all`
- `POST /sync/file/:type`
- `POST /sync/tickers`
- `GET /lookup/:ticker`

See docs/LISTING_SYNC_SERVICE.md for details.
