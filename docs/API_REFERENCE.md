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
