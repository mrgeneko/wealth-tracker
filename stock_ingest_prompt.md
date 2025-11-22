Build a realtime price ingestion + caching + dashboard system. High level:
- Kafka messages contain price updates for securities. Implement a consumer that:
  - Persists each incoming message to MySQL.
  - Ensures uniqueness/keys by (ticker + capture_time) — supports upsert semantics on capture_time.
  - Updates a Redis cache with the latest price for the ticker.
  - Publishes a notification (Redis pub/sub or WebSocket) so frontend pages update in real time.
- Create HTTP APIs:
  - GET /api/v1/price/:ticker — return latest price from Redis; on cache miss fall back to MySQL and populate Redis.
  - GET /api/v1/positions — return positions (from `assets.json`) merged with most recent prices.
  - Optionally: GET /api/v1/account/:id and GET /api/v1/networth.
- Provide a single-page web UI that:
  - Loads `assets.json` (server-side or static file) and displays accounts in a grid.
  - For each position compute value = shares * most recent price.
  - Show account totals (positions + cash) and a total net worth across everything (assets + accounts).
  - Colors: price and change in green when price_change_decimal > 0, red when < 0; neutral when 0 or missing.
  - Updates continuously as new prices are published on Kafka (via Redis pub/sub -> server -> SSE/WebSocket, or direct WebSocket from consumer).
- Provide tests and a README with run instructions, env vars, and migration script for MySQL.

Tech stack (recommended):
- Node.js (Express) for APIs + websocket or Python/Flask + SocketIO — implement in the stack you're most comfortable with.
- Kafka consumer: use confluent-kafka or kafkajs for Node; confluent-kafka or kafka-python for Python.
- MySQL as persistent store.
- Redis for cache and pub/sub.
- Frontend: React or vanilla JS + minimal CSS. Use socket.io or SSE for push updates.

Detailed requirements and acceptance criteria:
1. Kafka consumer behavior
   - Accept JSON messages (see sample below).
   - Insert or update MySQL `price_data` table on every message.
   - Maintain uniqueness keyed by (ticker, capture_time) only; do not enforce uniqueness on quote_time.
   - Update Redis key `price:latest:{TICKER}` with the canonical "latest" price object (JSON). Latest is decided based on capture_time (use message capture_time; if absent, use server ingestion time).
   - Publish to Redis channel `price_updates` with payload { ticker, timestamp, new_value } to notify web clients.

2. MySQL table schema (example)
   - Table name: `price_data`
   - Columns:
     - id: BIGINT AUTO_INCREMENT PRIMARY KEY
     - ticker: VARCHAR(32) NOT NULL
     - capture_time: DATETIME NOT NULL
     - quote_time: DATETIME NULL
     - last_price: DECIMAL(20,8) NULL
     - pre_market_price: DECIMAL(20,8) NULL
     - after_hours_price: DECIMAL(20,8) NULL
     - price_change_decimal: DECIMAL(20,8) NULL
     - price_change_percent: VARCHAR(32) NULL
     - raw_json: JSON NULL
     - source: VARCHAR(64) NULL
     - created_at: DATETIME DEFAULT CURRENT_TIMESTAMP
   - Indexes/constraints:
     - UNIQUE KEY uniq_ticker_capture (ticker, capture_time)
     - INDEX idx_ticker_quote (ticker, quote_time)
     - INDEX idx_ticker_capture (ticker, capture_time)
   - Note: There is no UNIQUE constraint on (ticker, quote_time). quote_time is indexed for lookups but allowed to have duplicates.

3. Redis patterns
   - Latest price per ticker: key `price:latest:{TICKER}` — store a JSON string of the latest price object (fields as in Kafka message).
   - Pub/Sub channel for updates: `price_updates` — messages include `{"ticker":"AMZN","capture_time":"2025-11-22T20:36:14.714Z","payload":{...}}`.
   - Optionally keep a TTL for latest keys (e.g., 24h) or no TTL depending on needs.

4. API endpoints
   - GET /api/v1/price/:ticker
     - Try Redis `price:latest:{ticker}`. If present return JSON.
     - On miss, query MySQL for latest row (ORDER BY capture_time DESC), return it, then write to Redis.
     - 200 response: { ticker, last_price, last_price_quote_time, price_change_decimal, price_change_percent, source, capture_time, raw_json }
     - 404 if no price data.
   - GET /api/v1/positions
    - Load `assets.json` (server-side cached) and for each position fetch latest price from Redis or MySQL (batched).
     - Return merged payload with computed values: per-position value, per-account totals, and global net worth.
   - GET /api/v1/accounts and GET /api/v1/networth are optional extras.

5. Frontend
   - Single page that requests GET /api/v1/positions to load initial data.
   - Connect to server via SSE or WebSocket; on each `price_updates` event update the cached price and recalc affected positions/account totals and net worth and update DOM.
   - UI grid:
     - Columns: Account name | Position (ticker) | Shares | Currency | Last price | Price change | Position value | Account total (per-account row)
     - Color price and change as described (green up, red down).
   - Minimal styling responsive to grid display.

6. Positions file
  - Create `assets.json` at repo root (example structure included below).
   - Server reads it and validates schema on startup.

7. Tests & README
   - Unit tests for Kafka message processing (insert/upsert + Redis update).
   - Integration test for GET /api/v1/price/:ticker (mock Redis/MySQL).
   - README with env vars:
     - KAFKA_BOOTSTRAP_SERVERS, KAFKA_TOPIC, KAFKA_CONSUMER_GROUP
     - MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
     - REDIS_HOST, REDIS_PORT, REDIS_PASSWORD (if any)
     - PORT
   - Provide a small Docker-compose example showing consumer/service, API service, MySQL, Redis, and Kafka (optional).

Sample Kafka message (use this as canonical example)
{
  "key": "AMZN",
  "last_price": "220.69",
  "last_price_quote_time": "Nov 21, 2025, 4:00 PM EST",
  "price_change_decimal": "3.55",
  "price_change_percent": "1.63%",
  "previous_close_price": "217.14",
  "pre_market_price": "",
  "pre_market_price_change_decimal": "",
  "pre_market_price_change_percent": "",
  "pre_market_price_quote_time": "",
  "after_hours_price": "221.50",
  "after_hours_change_decimal": "0.81",
  "after_hours_change_percent": "0.37%",
  "after_hours_price_quote_time": "Nov 21, 2025, 7:59 PM EST",
  "source": "stock_analysis",
  "capture_time": "2025-11-22 20:36:14.714 UTC",
  "quote_time": ""
}

Implementation notes and edge cases
- Timestamp parsing: accept capture_time and quote_time in ISO8601 if possible. If times are in human-readable format (like "Nov 21, 2025, 7:59 PM EST"), parse to UTC and store canonical DATETIME in DB.
- Idempotency: consumer should handle duplicate messages (use unique keys and upsert on capture_time).
- Upsert logic: dedupe on `capture_time` (ON DUPLICATE KEY UPDATE using uniq_ticker_capture).
- Latest in Redis: determine "latest" by comparing capture_time; only update Redis if message.capture_time >= current Redis capture_time.
- High throughput: batch DB writes if needed; consider redis pipelines.

Deliverables
- Consumer code (Kafka -> MySQL + Redis + pubsub).
- API service with GET /api/v1/price/:ticker and GET /api/v1/positions.
 - `assets.json` file.
- Frontend SPA that displays the grid and live updates.
- README and tests.

Acceptance tests (manual)
- Publish a sample Kafka message; observe:
  - Row inserted/updated in MySQL (by capture_time).
  - `price:latest:AMZN` in Redis updated.
  - Browser connected to WebSocket/SSE updates the displayed AMZN row and recalculates its account total and net worth.

---

If you'd like, I can now:
- Add a migration SQL file to the repo that creates `price_data` without the (ticker, quote_time) unique key and instead creates an index on `quote_time`.
- Update the consumer (e.g., `wealth_tracker/scripts/consume_kafka_ck.py`) to upsert by capture_time, normalize timestamps to UTC, and update Redis.
Tell me which of those to do next.