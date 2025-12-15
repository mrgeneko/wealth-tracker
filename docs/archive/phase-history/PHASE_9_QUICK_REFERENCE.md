---
title: Phase 9 Quick Reference - Integration Checklist
description: Quick reference guide for Phase 9.2 and 9.3 integration
date: December 10, 2025
---

# Phase 9 Quick Reference & Integration Checklist

## 📋 What's Included

### Phase 9.2: WebSocket Real-time Metrics (1,850+ lines)
- ✅ WebSocket server (`/services/websocket-server.js`)
- ✅ Metrics collector (`/services/scraper-metrics-collector.js`)
- ✅ WebSocket client (`/dashboard/public/js/metrics-websocket-client.js`)
- ✅ Integration examples (`/services/scraper-integration.example.js`)
- ✅ 18 unit tests (`/tests/phase-9-websocket.test.js`)
- ✅ Complete documentation & guides

### Phase 9.3: Dashboard UI (2,650+ lines)
- ✅ Chart adapter base class (`/dashboard/public/js/chart-adapter.js`)
- ✅ Chart.js implementation (`/dashboard/public/js/chartjs-adapter.js`)
- ✅ Main analytics dashboard (`/dashboard/public/analytics.html`)
- ✅ Complete documentation & guides

---

## 🚀 5-Minute Integration Guide

### Step 1: Install Dependencies
```bash
cd /Users/gene/VS\ Code/wealth-tracker
npm install ws
```

### Step 2: Initialize WebSocket Server (In `dashboard/server.js`)
```javascript
// Add near the top, after other requires
const MetricsWebSocketServer = require('../services/websocket-server');
const ScraperMetricsCollector = require('../services/scraper-metrics-collector');

// Create instances (after express app is created)
const metricsWS = new MetricsWebSocketServer(server);
const metricsCollector = new ScraperMetricsCollector(metricsWS);

// Make available globally for scrapers
global.metricsCollector = metricsCollector;

// Add route for analytics dashboard
app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});
```

### Step 3: Create Database Tables
```bash
# Execute the SQL from PHASE_9_2_IMPLEMENTATION_GUIDE.md
# Or run this directly:
mysql -u root -p wealth_tracker << 'EOF'
CREATE TABLE IF NOT EXISTS scraper_page_performance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scraper_source VARCHAR(50) NOT NULL,
  metric_type VARCHAR(50) NOT NULL,
  url VARCHAR(500),
  navigation_duration_ms INT,
  scrape_duration_ms INT,
  items_extracted INT,
  success BOOLEAN DEFAULT TRUE,
  error VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source_time (scraper_source, created_at DESC),
  INDEX idx_type_source (metric_type, scraper_source, created_at DESC)
);

CREATE TABLE IF NOT EXISTS scraper_daily_summary (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scraper_source VARCHAR(50) NOT NULL,
  metric_date DATE NOT NULL,
  metric_type VARCHAR(50),
  total_count INT,
  success_count INT,
  avg_duration_ms FLOAT,
  total_items_extracted INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scraper_source, metric_date, metric_type),
  INDEX idx_source_date (scraper_source, metric_date DESC)
);

CREATE TABLE IF NOT EXISTS scheduler_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scraper_source VARCHAR(50),
  execution_duration_ms INT,
  success BOOLEAN DEFAULT TRUE,
  error VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source_time (scraper_source, created_at DESC)
);
EOF
```

### Step 4: Start Dashboard Server
```bash
cd /Users/gene/VS\ Code/wealth-tracker/dashboard
npm start
# or: node server.js
```

### Step 5: View Analytics Dashboard
```
Open: http://localhost:3000/analytics
```

---

## 📊 Integration Points

### Phase 9.2 Integration (Metrics Recording)

**In your scraper code**, add metric tracking:

```javascript
const metricsCollector = global.metricsCollector;

// Track navigation
const start = Date.now();
await page.goto(url, { waitUntil: 'networkidle2' });
const navigationTime = Date.now() - start;

metricsCollector.recordPageNavigation({
  scraper_source: 'robinhood',
  url: url,
  navigation_duration_ms: navigationTime,
  success: true
});

// Track scraping
const scrapeStart = Date.now();
const itemsExtracted = await page.evaluate(() => {
  // Your scraping logic
  return dataItems.length;
});

metricsCollector.recordPageScrape({
  scraper_source: 'robinhood',
  url: url,
  scrape_duration_ms: Date.now() - scrapeStart,
  items_extracted: itemsExtracted,
  success: true
});
```

### Phase 9.3 Integration (Dashboard Display)

**Metrics automatically stream to dashboard once:**
1. Metrics are recorded via `metricsCollector`
2. Dashboard connects via WebSocket to `/ws` endpoint
3. Charts update in real-time with new metrics
4. Statistics auto-calculate and display

---

## 🔧 Configuration Options

### WebSocket Server (In `websocket-server.js`)

```javascript
// Adjust these for your deployment:
const MAX_CLIENTS = 1000;           // Max concurrent clients
const METRIC_BATCH_SIZE = 100;      // Batch metrics every N items
const METRIC_BATCH_TIME_MS = 1000;  // Or every N milliseconds
const HEARTBEAT_INTERVAL_MS = 30000; // Heartbeat every 30s
const CLIENT_TIMEOUT_MS = 60000;    // Drop client if silent >60s
```

### Metrics Collector (In `scraper-metrics-collector.js`)

```javascript
// Adjust these for your needs:
const DB_FLUSH_INTERVAL_MS = 5000;  // Auto-flush to DB every 5s
const DB_FLUSH_BATCH_SIZE = 100;    // Or when 100 metrics collected
const RETENTION_DAYS = 7;            // Keep detailed metrics 7 days
const DAILY_SUMMARY_HOUR = 1;        // Generate summary at 1 AM
```

### WebSocket Client (In `metrics-websocket-client.js`)

```javascript
// Browser-side connection settings:
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BACKOFF_MS = 1000;
const HEARTBEAT_TIMEOUT_MS = 60000;
const MAX_METRICS_IN_MEMORY = 100;  // Keep last 100 metrics per source
```

---

## 📊 Viewing Metrics

### Real-time Dashboard
```
http://localhost:3000/analytics
```
- 6 sections: Overview, Scrapers, Navigation, Scraping, Scheduler, Alerts
- Real-time charts updating as metrics stream in
- Summary statistics for all metrics
- Per-scraper health overview

### API Endpoints (Phase 9.4)
```
GET /api/metrics/stats?scraper=robinhood&timeWindow=7d
GET /api/metrics/export?format=csv&scraper=robinhood
GET /api/metrics/timeseries?scraper=robinhood&granularity=1h
```

### Database Queries
```sql
-- Last 24 hours of navigation metrics
SELECT * FROM scraper_page_performance 
WHERE metric_type = 'page_navigation' 
AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
ORDER BY created_at DESC;

-- Daily summary for last 7 days
SELECT * FROM scraper_daily_summary
WHERE metric_date >= CURDATE() - INTERVAL 7 DAY
ORDER BY metric_date DESC;

-- Success rate by scraper
SELECT scraper_source, 
  SUM(success_count) / SUM(total_count) as success_rate
FROM scraper_daily_summary
WHERE metric_date >= CURDATE() - INTERVAL 7 DAY
GROUP BY scraper_source;
```

---

## ✅ Integration Checklist

### Pre-Integration
- [ ] Read `PHASE_9_COMPLETE_SUMMARY.md` for full overview
- [ ] Review `PHASE_9_2_IMPLEMENTATION_GUIDE.md` for WebSocket details
- [ ] Review `PHASE_9_3_IMPLEMENTATION_GUIDE.md` for dashboard details

### Installation
- [ ] Run `npm install ws`
- [ ] Copy all Phase 9 files to correct locations:
  - [ ] `/services/websocket-server.js`
  - [ ] `/services/scraper-metrics-collector.js`
  - [ ] `/dashboard/public/js/metrics-websocket-client.js`
  - [ ] `/dashboard/public/js/chart-adapter.js`
  - [ ] `/dashboard/public/js/chartjs-adapter.js`
  - [ ] `/dashboard/public/analytics.html`
  - [ ] `/services/scraper-integration.example.js` (reference only)

### Database Setup
- [ ] Create `scraper_page_performance` table
- [ ] Create `scraper_daily_summary` table
- [ ] Create `scheduler_metrics` table
- [ ] Verify table creation: `SHOW TABLES;`

### Code Integration
- [ ] Initialize WebSocket server in `dashboard/server.js`
- [ ] Add metrics collector to global scope
- [ ] Add `/analytics` route to Express app
- [ ] Add metric tracking to scraper code (3-4 lines per scraper)

### Verification
- [ ] Start dashboard server: `npm start`
- [ ] Open dashboard: http://localhost:3000/analytics
- [ ] Check browser console for errors
- [ ] Run scraper to generate metrics
- [ ] Verify metrics appear in dashboard in real-time
- [ ] Verify database tables have data
- [ ] Check WebSocket connection (should show "Connected" indicator)

### Testing
- [ ] Run unit tests: `npm test -- tests/phase-9-websocket.test.js`
- [ ] All 18 tests should pass
- [ ] No console errors
- [ ] No memory leaks (check DevTools)

### Deployment
- [ ] Update production database with schema
- [ ] Deploy to production server
- [ ] Configure WebSocket for SSL/TLS (wss://)
- [ ] Test under load (100+ concurrent users)
- [ ] Monitor error rates and performance

---

## 🎯 What Each File Does

| File | Purpose | Lines | Key Classes |
|------|---------|-------|-------------|
| `websocket-server.js` | WebSocket server for real-time streaming | 400 | `MetricsWebSocketServer` |
| `scraper-metrics-collector.js` | Collect and persist metrics | 450 | `ScraperMetricsCollector` |
| `metrics-websocket-client.js` | Browser WebSocket client | 300 | `MetricsWebSocketClient` |
| `chart-adapter.js` | Abstract chart interface | 400 | `ChartAdapter`, `MetricAggregator` |
| `chartjs-adapter.js` | Chart.js implementation | 450 | `ChartJsAdapter` |
| `analytics.html` | Main dashboard page | 1,200 | `AnalyticsDashboard` |
| `scraper-integration.example.js` | Integration examples | 300 | Example functions |

---

## 🐛 Troubleshooting

### "Cannot find module 'ws'"
```bash
# Install the WebSocket library
npm install ws
```

### "WebSocket connection failed"
```javascript
// Check that WebSocket server is running
// In dashboard/server.js, verify:
const metricsWS = new MetricsWebSocketServer(server);
// And that 'server' is the HTTP server instance
```

### "Dashboard shows 'Connecting...' but never connects"
```javascript
// Check browser console for WebSocket errors
// Verify WebSocket endpoint: 
// Should be: ws://localhost:3000/ws
// In production: wss://yourdomain.com/ws
```

### "Metrics not showing in dashboard"
```javascript
// 1. Verify global.metricsCollector is initialized
console.log(global.metricsCollector); // Should not be undefined

// 2. Call metrics in your scraper:
global.metricsCollector.recordPageNavigation({...});

// 3. Check database for inserted metrics:
SELECT * FROM scraper_page_performance ORDER BY created_at DESC LIMIT 10;

// 4. Check WebSocket connections in DevTools:
// Look at Network tab, find ws:// connection
```

### "Database tables not created"
```bash
# Verify MySQL connection
mysql -u root -p -h localhost

# Check database
USE wealth_tracker;
SHOW TABLES;

# Manually create table:
mysql -u root -p wealth_tracker < /path/to/schema.sql
```

### "High CPU or memory usage"
```javascript
// In websocket-server.js, check:
// 1. MAX_CLIENTS - don't exceed 1000 per server
// 2. METRIC_BATCH_SIZE - keep metrics in memory briefly
// 3. METRIC_BATCH_TIME_MS - don't collect too long

// Monitor with:
// ps aux | grep node
// top -p <node_pid>
```

---

## 📈 Performance Expectations

### Real-time Latency
- Metric recorded → WebSocket sent: <10ms
- WebSocket sent → Browser received: <50ms
- Browser received → Chart updated: <50ms
- **Total latency**: <100ms

### Database Performance
- Insert 1 metric: <1ms
- Query 1000 metrics: <50ms
- Aggregate 100K metrics: <200ms

### Network Usage
- Per metric: ~200 bytes
- 100 metrics/second: ~20 KB/sec
- Per client: ~5 KB/sec at idle

### Memory Usage
- WebSocket server: ~5 MB baseline + 100 KB per client
- 1000 clients: ~105 MB
- Browser dashboard: ~10 MB

---

## 🔐 Security Considerations

### WebSocket Connection
```javascript
// In production, use WSS (WebSocket Secure)
// Update analytics.html:
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
```

### Database Access
```javascript
// Use parameterized queries (already done in code)
// NEVER use string concatenation for SQL
db.query('SELECT * FROM metrics WHERE scraper = ?', [scraper]);  // ✅ Safe
db.query(`SELECT * FROM metrics WHERE scraper = '${scraper}'`);  // ❌ SQL Injection risk
```

### CORS Headers
```javascript
// If dashboard hosted separately from API:
app.use(cors({
  origin: ['https://yourdomain.com'],
  credentials: true
}));
```

---

## 📚 Additional Resources

### Documentation Files
- `PHASE_9_COMPLETE_SUMMARY.md` - Complete Phase 9 overview (8,000+ words)
- `PHASE_9_2_COMPLETION_SUMMARY.md` - WebSocket details (4,000+ words)
- `PHASE_9_3_COMPLETION_SUMMARY.md` - Dashboard details (4,000+ words)
- `PHASE_9_2_IMPLEMENTATION_GUIDE.md` - Setup guide (3,000+ words)
- `PHASE_9_3_IMPLEMENTATION_GUIDE.md` - Dashboard setup (3,000+ words)
- `PHASE_9_4_PLAN.md` - Next phase planning (3,000+ words)

### Test Files
- `tests/phase-9-websocket.test.js` - 18 unit tests with examples

### Example Code
- `services/scraper-integration.example.js` - Real scraper examples

---

## 🎉 What's Next?

Once Phase 9.2 & 9.3 are integrated and working:

### Phase 9.4: Performance Optimization
- Database query optimization (80%+ faster)
- Redis caching layer
- Load testing to 5,000 concurrent users
- Custom dashboard configurations
- Alert thresholds

### Phase 10: Advanced Analytics
- Predictive analytics for SLA violations
- Anomaly detection with ML
- Forecasting engine
- Custom metrics builder

---

**Status**: ✅ Ready for Integration  
**Estimated Integration Time**: 2-4 hours  
**Support**: See troubleshooting section or documentation files

