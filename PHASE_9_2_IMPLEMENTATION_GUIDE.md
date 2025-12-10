---
title: Phase 9.2 Implementation Guide - WebSocket Real-time Metrics
description: Complete implementation guide for real-time metrics streaming using WebSocket
date: December 10, 2025
status: ready-for-implementation
---

# Phase 9.2: WebSocket Real-time Metrics Implementation

## Overview

Phase 9.2 implements **real-time metrics streaming** using WebSocket, enabling live updates of scraper performance, scheduler metrics, and system health directly to the dashboard without polling.

### Key Features
- **Real-time Broadcasting**: Metrics pushed to clients immediately as they're recorded
- **Per-Scraper Channels**: Subscribe to individual scraper metrics (robinhood, cnbc, webull, etc.)
- **Batch Optimization**: Metrics batched (every 1 second or 100 items) for efficient transmission
- **Automatic Reconnection**: Client-side exponential backoff for connection failures
- **Heartbeat Monitoring**: Keep-alive checks prevent stale connections
- **Database Persistence**: All metrics persisted to MySQL with 7-day retention
- **Nightly Aggregation**: Daily summaries for historical trending

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard (Browser)                       │
│  MetricsWebSocketClient (metrics-websocket-client.js)       │
│  - Connects to ws://server/ws/metrics                        │
│  - Subscribes to scrapers (robinhood, cnbc, webull, etc.)    │
│  - Receives metric batches in real-time                      │
│  - Manages reconnection with exponential backoff             │
└─────────────────────────────────────────────────────────────┘
                           ↑↓ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                    Node.js Server                            │
│  MetricsWebSocketServer (websocket-server.js)               │
│  - Manages client connections                               │
│  - Handles subscriptions per scraperSource                  │
│  - Batches metrics every 1 second                           │
│  - Broadcasts to subscribed clients                         │
└─────────────────────────────────────────────────────────────┘
           ↑                           ↑
           │ recordPageNavigation()    │ recordPageScrape()
           │ recordSchedulerMetric()   │
           └───────────────┬───────────┘
           
┌─────────────────────────────────────────────────────────────┐
│          ScraperMetricsCollector (scraper-metrics-collector.js)
│  - Queues navigation/scrape/scheduler metrics               │
│  - Flushes in-memory batches to database                   │
│  - Generates daily summaries (nightly)                      │
│  - Manages database connections                            │
└─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────┐
│                   MySQL Database                            │
│  - scraper_page_performance (7-day retention)              │
│  - scraper_daily_summary (permanent)                       │
│  - scheduler_metrics (7-day retention)                     │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Scraper Operation** → Calls `gotoWithRetriesTracked()` or `scrapePageTracked()`
2. **Metric Recording** → `ScraperMetricsCollector.recordPageNavigation/Scrape()`
3. **WebSocket Broadcasting** → `MetricsWebSocketServer.recordPageNavigation/Scrape()`
4. **Client Subscription** → If clients subscribed to that scraperSource, batch sent
5. **Dashboard Update** → Client receives metrics and updates charts in real-time
6. **Database Persistence** → Metrics flushed to MySQL every 5 seconds or 100 items

---

## Implementation Steps

### Step 1: Create Database Tables

Execute these SQL commands to prepare the database:

```sql
-- Detailed page-level metrics (7-day retention)
CREATE TABLE IF NOT EXISTS scraper_page_performance (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  scraper_source VARCHAR(50) NOT NULL,
  metric_type ENUM('navigation', 'scrape') NOT NULL,
  page_url VARCHAR(2048),
  
  -- Navigation metrics
  navigation_duration_ms INT,
  retry_count INT DEFAULT 0,
  
  -- Scrape metrics
  scrape_duration_ms INT,
  items_extracted INT DEFAULT 0,
  data_size INT DEFAULT 0,
  
  -- Status
  success TINYINT DEFAULT 1,
  error TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for performance
  INDEX idx_scraper_created (scraper_source, created_at),
  INDEX idx_metric_type (metric_type),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily aggregated summary (permanent retention)
CREATE TABLE IF NOT EXISTS scraper_daily_summary (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  scraper_source VARCHAR(50) NOT NULL,
  metric_date DATE NOT NULL,
  
  -- Navigation metrics
  total_navigations INT DEFAULT 0,
  successful_navigations INT DEFAULT 0,
  avg_navigation_duration_ms DECIMAL(10, 2),
  min_navigation_duration_ms INT,
  max_navigation_duration_ms INT,
  avg_retry_count DECIMAL(10, 2),
  
  -- Scrape metrics
  total_scrapes INT DEFAULT 0,
  successful_scrapes INT DEFAULT 0,
  avg_scrape_duration_ms DECIMAL(10, 2),
  min_scrape_duration_ms INT,
  max_scrape_duration_ms INT,
  total_items_extracted INT DEFAULT 0,
  avg_items_extracted DECIMAL(10, 2),
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_source_date (scraper_source, metric_date),
  INDEX idx_scraper_date (scraper_source, metric_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scheduler execution metrics
CREATE TABLE IF NOT EXISTS scheduler_metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  scheduler_name VARCHAR(100) NOT NULL,
  execution_duration_ms INT,
  items_processed INT DEFAULT 0,
  success TINYINT DEFAULT 1,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_scheduler (scheduler_name, created_at),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 2: Install WebSocket Dependency

```bash
npm install ws
```

### Step 3: Initialize WebSocket Server

In `dashboard/server.js`, add WebSocket server initialization:

```javascript
const http = require('http');
const MetricsWebSocketServer = require('../services/websocket-server');
const ScraperMetricsCollector = require('../services/scraper-metrics-collector');

// Create HTTP server (instead of just Express server)
const server = http.createServer(app);

// Initialize WebSocket server
const metricsWS = new MetricsWebSocketServer(server, {
  batchInterval: 1000,        // Batch every 1 second
  maxBatchSize: 100,          // Or 100 metrics, whichever comes first
  maxClients: 1000,
  heartbeatInterval: 30000    // 30 second heartbeat
});

// Initialize metrics collector
const metricsCollector = new ScraperMetricsCollector(metricsWS, {
  batchSize: 100,
  flushInterval: 5000         // Flush to DB every 5 seconds
});

// Make collector globally accessible
global.metricsCollector = metricsCollector;

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await metricsCollector.shutdown();
  await metricsWS.shutdown();
  server.close();
});

server.listen(3000);
```

### Step 4: Instrument Scrapers

In each scraper file, replace direct page navigation with tracked versions:

**Before:**
```javascript
await page.goto(url, { waitUntil: 'networkidle2' });
```

**After:**
```javascript
const ScraperIntegration = require('../services/scraper-integration.example');

await ScraperIntegration.gotoWithRetriesTracked(
  page,
  url,
  { waitUntil: 'networkidle2' },
  3,  // maxAttempts
  'robinhood'  // scraperSource
);
```

For page scraping:

**Before:**
```javascript
const data = await page.evaluate(() => {
  return { /* extracted data */ };
});
```

**After:**
```javascript
const data = await ScraperIntegration.scrapePageTracked(
  page,
  url,
  'robinhood',
  async (page) => {
    return await page.evaluate(() => {
      return { /* extracted data */ };
    });
  }
);
```

### Step 5: Add Dashboard HTML

In `dashboard/public/analytics.html`, add WebSocket client initialization:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Analytics Dashboard</title>
  <script src="/js/metrics-websocket-client.js"></script>
</head>
<body>
  <div id="metrics-container"></div>

  <script>
    // Initialize WebSocket client
    const wsClient = new MetricsWebSocketClient('http://localhost:3000');

    // Connect and subscribe to metrics
    wsClient.connect().then(() => {
      console.log('Connected to metrics server');
      
      // Subscribe to specific scrapers
      wsClient.subscribe('robinhood');
      wsClient.subscribe('cnbc');
      wsClient.subscribe('webull');
      wsClient.subscribe('marketbeat');
    });

    // Listen for metric updates
    wsClient.on('metrics', (data) => {
      console.log(`Received ${data.count} metrics from ${data.scraperSource}`);
      
      // Update dashboard charts
      updateMetricsDisplay(data);
    });

    // Handle connection events
    wsClient.on('connect', () => {
      document.getElementById('connection-status').textContent = 'Connected';
    });

    wsClient.on('disconnect', () => {
      document.getElementById('connection-status').textContent = 'Disconnected';
    });

    function updateMetricsDisplay(data) {
      const { scraperSource, metrics, timestamp } = data;
      
      // Process metrics and update charts
      metrics.forEach(metric => {
        if (metric.type === 'page_navigation') {
          console.log(`Navigation to ${metric.url}: ${metric.navigationDurationMs}ms`);
        } else if (metric.type === 'page_scrape') {
          console.log(`Scraped ${metric.url}: ${metric.itemsExtracted} items`);
        }
      });
    }
  </script>
</body>
</html>
```

### Step 6: Setup Nightly Aggregation

Create `scripts/nightly-aggregation.js`:

```javascript
const ScraperMetricsCollector = require('../services/scraper-metrics-collector');
const pool = require('../db');

async function runNightlyAggregation() {
  console.log('[Aggregation] Starting nightly metrics aggregation...');

  try {
    const collector = new ScraperMetricsCollector(null, {
      batchSize: 100,
      flushInterval: 10000
    });

    // Generate summary for yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await collector.generateDailySummary(yesterday);

    // Cleanup metrics older than 7 days
    await collector.cleanupOldMetrics(7);

    console.log('[Aggregation] Nightly aggregation complete');

    await collector.shutdown();
    process.exit(0);
  } catch (error) {
    console.error('[Aggregation] Error:', error);
    process.exit(1);
  }
}

runNightlyAggregation();
```

Add to crontab:
```bash
0 2 * * * /usr/bin/node /path/to/wealth-tracker/scripts/nightly-aggregation.js
```

---

## Configuration

### WebSocket Server Options

```javascript
{
  batchInterval: 1000,        // Batch metrics every N milliseconds
  maxBatchSize: 100,          // Flush when N metrics accumulated
  maxClients: 1000,           // Maximum concurrent clients
  heartbeatInterval: 30000    // Heartbeat check interval (ms)
}
```

### Metrics Collector Options

```javascript
{
  batchSize: 100,            // Max items before auto-flush
  flushInterval: 5000        // Flush to DB every N milliseconds
}
```

### WebSocket Client Options

```javascript
{
  reconnectInterval: 3000,          // Initial reconnect delay (ms)
  maxReconnectAttempts: 10,         // Max retry attempts
  heartbeatTimeout: 60000,          // Disconnect if no heartbeat (ms)
}
```

---

## Performance Characteristics

### Network Efficiency
- **Batch Size**: 100 metrics per message (typical)
- **Batch Interval**: 1 second maximum
- **Message Size**: ~5-10 KB per batch (typical)
- **Bandwidth**: ~30-60 KB/min per client (estimate)

### Database Performance
- **Insert Rate**: 100 metrics per batch × 5 second flush = 20/sec
- **7-day Retention**: ~17 million metrics per scraper (estimated)
- **Query Performance**: Indexes on scraper_source, created_at ensure <100ms queries

### Memory Usage
- **Per Client**: ~100 KB (subscription list + recent metrics)
- **Server**: ~50 MB for 1000 clients
- **Metrics Collector**: ~1-5 MB (in-memory queue)

---

## Monitoring & Metrics

### Server Statistics

```javascript
const stats = metricsWS.getStats();
// {
//   connectedClients: 5,
//   subscriptions: {
//     robinhood: 3,
//     cnbc: 2,
//     webull: 1
//   },
//   metrics: {
//     robinhood: 50,
//     cnbc: 30
//   },
//   memory: { ... }
// }
```

### Collector Statistics

```javascript
const stats = await metricsCollector.getMetricsStats();
// {
//   pendingNavigation: 5,
//   pendingScrape: 3,
//   pendingScheduler: 2,
//   totalPending: 10
// }
```

---

## Error Handling

### Connection Failures
- **Auto-reconnect** with exponential backoff (3s → 13.5s max)
- **Max 10 attempts** before giving up
- **Heartbeat timeout** triggers reconnection after 60 seconds

### Metric Recording Failures
- Failed metrics **re-queued** for next flush attempt
- Up to 3 retry attempts in-memory
- Logged for manual inspection

### Database Errors
- Connection failures logged but don't block metrics recording
- Metrics stay in memory until database available
- Automatic retry on next flush cycle

---

## Testing

### Run Unit Tests

```bash
npm test -- tests/phase-9-websocket.test.js
```

### Test Coverage
- WebSocket server (8 tests)
- Metrics collector (6 tests)
- Integration tests (2 tests)
- Error handling (2 tests)

### Manual Testing

```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Connect WebSocket client
node -e "
const MetricsWebSocketClient = require('./dashboard/public/js/metrics-websocket-client.js');
const client = new MetricsWebSocketClient('http://localhost:3000');
client.connect().then(() => {
  client.subscribe('robinhood');
  client.on('metrics', (data) => console.log('Metrics:', data));
});
"

# Terminal 3: Send test metrics
node -e "
global.metricsCollector = require('./services/scraper-metrics-collector');
global.metricsCollector.recordPageNavigation('robinhood', {
  url: 'https://example.com',
  navigationDurationMs: 100,
  success: true
});
"
```

---

## Migration Path (From Polling to WebSocket)

### Phase 9.1 (Polling - Already Implemented)
- REST API endpoints for metrics
- Client polling every 5-10 seconds
- Suitable for low-traffic scenarios

### Phase 9.2 (WebSocket - This Implementation)
- Real-time push from server
- Sub-second latency
- More efficient for high-frequency updates
- Better for live dashboards

### Coexistence Strategy
Both can run simultaneously:

```javascript
// Keep REST API for backwards compatibility
app.get('/api/analytics/metrics', (req, res) => {
  // Query recent metrics from database
});

// Add WebSocket for new clients
wsServer = new MetricsWebSocketServer(server);
```

---

## Troubleshooting

### WebSocket Connection Fails
```javascript
// Check server is listening on correct port
const stats = metricsWS.getStats();
console.log('Connected clients:', stats.connectedClients);

// Check browser console for connection errors
// Verify ws:// URL matches server endpoint
```

### Metrics Not Received
```javascript
// Verify subscriptions are active
wsClient.requestStatus();

// Check collector is recording metrics
const stats = await metricsCollector.getMetricsStats();
console.log('Pending metrics:', stats.totalPending);

// Check database connection
SELECT COUNT(*) FROM scraper_page_performance;
```

### High Memory Usage
```javascript
// Increase flush frequency
new ScraperMetricsCollector(wsServer, {
  flushInterval: 2000  // Flush every 2 seconds instead of 5
});

// Reduce batch size
new MetricsWebSocketServer(server, {
  maxBatchSize: 50  // Batch 50 instead of 100
});
```

---

## Deliverables

✅ `services/websocket-server.js` - WebSocket server (400+ lines)
✅ `services/scraper-metrics-collector.js` - Metrics collector (450+ lines)
✅ `dashboard/public/js/metrics-websocket-client.js` - Client handler (300+ lines)
✅ `services/scraper-integration.example.js` - Integration guide with examples (300+ lines)
✅ `tests/phase-9-websocket.test.js` - 18 comprehensive unit tests
✅ `PHASE_9_2_IMPLEMENTATION_GUIDE.md` - This document (600+ lines)

**Total Lines of Code**: 1,850+ lines
**Test Coverage**: 18 tests covering all major functionality
**Estimated Development Time**: 3-4 days for full implementation including integration

---

## Next Steps

1. **Phase 9.3**: Dashboard UI components and chart integration
2. **Phase 9.4**: Performance optimization and production deployment
3. **Phase 10**: Advanced analytics and predictive metrics

---

## Support & Questions

For implementation questions or issues, refer to:
- `PHASE_9_METRICS_COMPATIBILITY.md` - Metrics design and database schema
- `PHASE_9_PLAN.md` - Overall Phase 9 architecture
- Unit tests in `tests/phase-9-websocket.test.js` - Usage examples

