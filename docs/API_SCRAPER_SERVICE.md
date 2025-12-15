# API Scraper Service (Phase 10)

## Purpose

The API Scraper service runs **non-browser** scrapers (HTTP/API clients) outside the Chrome/Puppeteer container.

In Phase 10, this primarily means **Yahoo Finance (via `yahoo-finance2`)** batch scraping is executed by the API Scraper daemon instead of the browser-based `scrape_daemon.js`.

## Why this exists

- Yahoo scraping is **API-only** (no Puppeteer required)
- Running it in the Chrome container wastes memory and couples deploys
- Separating it allows independent scaling and simpler runtime requirements

## Entry point

- Service: `services/api-scraper/api_scrape_daemon.js`
- Docker image: `docker/Dockerfile.api-scraper`

## Health endpoints

The daemon exposes a small HTTP server:

- `GET /health` → `{ ok: true }`
- `GET /status` → last-run timestamps and last error info

Default port: `3020` (set via `API_SCRAPER_HEALTH_PORT`).

## Configuration

### Enabling the Yahoo batch

The daemon reads the shared config file (same one used by the browser scrapers):

- Container path: `/usr/src/app/config/config.json`
- Local path fallback: `./config/config.json`

To run the Yahoo batch, enable the scrape group:

```json
{
  "scrape_groups": {
    "yahoo_batch": { "enabled": true, "interval": 45 }
  }
}
```

### Environment variables

- `CONFIG_DIR` (default: `./config` or `/usr/src/app/config`)
- `DATA_DIR` (default: `./data` or `/usr/src/app/data`)
- `LOG_DIR` (default: `./logs` or `/usr/src/app/logs`)
- `OUTPUT_DIR` (default: `${DATA_DIR}/scraper_output`)

Database (used to read tickers from the `positions` table):

- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`

Kafka publishing (delegated to existing `scrapers/publish_to_kafka.js`):

- `KAFKA_BROKERS` (comma-separated)
- `KAFKA_TOPIC` (defaults inside publisher when not set)

Yahoo batch tuning (already supported by `scrapers/scrape_yahoo.js`):

- `YAHOO_CHUNK_SIZE`
- `YAHOO_DELAY_MS`
- `YAHOO_MAX_RETRIES`
- `YAHOO_BACKOFF_BASE_MS`

## Docker Compose

`docker-compose.yml` includes an `api-scraper` service that runs this daemon and exposes the health port on `3020`.
