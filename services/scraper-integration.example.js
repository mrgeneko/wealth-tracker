/**
 * Scraper Integration Guide: WebSocket Metrics
 * 
 * This file shows how to integrate the MetricsWebSocketServer and 
 * ScraperMetricsCollector into existing scrapers for real-time metrics tracking.
 */

// ============================================================================
// 1. SERVER INITIALIZATION (in main server file, e.g., dashboard/server.js)
// ============================================================================

const express = require('express');
const http = require('http');
const MetricsWebSocketServer = require('../services/websocket-server');
const ScraperMetricsCollector = require('../services/scraper-metrics-collector');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const metricsWS = new MetricsWebSocketServer(server, {
  batchInterval: 1000,        // Batch metrics every 1 second
  maxBatchSize: 100,          // Flush after 100 metrics
  maxClients: 1000,
  heartbeatInterval: 30000    // 30 second heartbeat
});

// Initialize metrics collector
const metricsCollector = new ScraperMetricsCollector(metricsWS, {
  batchSize: 100,
  flushInterval: 5000         // Flush to DB every 5 seconds
});

// Make collector globally accessible to scrapers
global.metricsCollector = metricsCollector;

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await metricsCollector.shutdown();
  await metricsWS.shutdown();
  server.close();
});

server.listen(3000, () => {
  console.log('Server with WebSocket metrics running on port 3000');
});

// ============================================================================
// 2. SCRAPER WRAPPER INTEGRATION (in scraper_utils.js)
// ============================================================================

/**
 * Enhanced gotoWithRetries that tracks metrics
 * 
 * Usage:
 * const startNav = Date.now();
 * await gotoWithRetriesTracked(page, url, options, maxAttempts, 'robinhood');
 */
async function gotoWithRetriesTracked(
  page,
  url,
  options = {},
  maxAttempts = 3,
  scraperSource = 'unknown'
) {
  const navigationStartTime = Date.now();
  let lastError = null;
  let retryCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const pageStartTime = Date.now();
      
      // Perform the actual navigation
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
        ...options
      });

      const navigationDurationMs = Date.now() - pageStartTime;
      retryCount = attempt - 1;

      // Record successful navigation
      if (global.metricsCollector) {
        global.metricsCollector.recordPageNavigation(scraperSource, {
          url,
          navigationDurationMs,
          retryCount,
          success: true,
          error: null
        });
      }

      console.log(
        `[${scraperSource}] Navigation to ${url} succeeded ` +
        `in ${navigationDurationMs}ms (attempt ${attempt}/${maxAttempts})`
      );

      return true;

    } catch (error) {
      lastError = error;
      retryCount = attempt;

      console.warn(
        `[${scraperSource}] Navigation to ${url} failed on attempt ${attempt}/${maxAttempts}: ` +
        `${error.message}`
      );

      if (attempt < maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        console.log(`[${scraperSource}] Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  // Record failed navigation
  if (global.metricsCollector) {
    global.metricsCollector.recordPageNavigation(scraperSource, {
      url,
      navigationDurationMs: Date.now() - navigationStartTime,
      retryCount,
      success: false,
      error: lastError?.message || 'Unknown error'
    });
  }

  throw new Error(
    `Failed to navigate to ${url} after ${maxAttempts} attempts: ${lastError?.message}`
  );
}

/**
 * Enhanced page scraping with timing
 * 
 * Usage:
 * const data = await scrapePageTracked(page, url, 'robinhood', async (page) => {
 *   // Your scraping logic here
 *   return extractedData;
 * });
 */
async function scrapePageTracked(
  page,
  url,
  scraperSource,
  scrapingFunction
) {
  const scrapeStartTime = Date.now();

  try {
    // Execute the scraping function
    const data = await scrapingFunction(page);

    const scrapeDurationMs = Date.now() - scrapeStartTime;
    const itemsExtracted = Array.isArray(data) ? data.length : 1;
    const dataSize = JSON.stringify(data).length;

    // Record successful scrape
    if (global.metricsCollector) {
      global.metricsCollector.recordPageScrape(scraperSource, {
        url,
        scrapeDurationMs,
        itemsExtracted,
        success: true,
        dataSize,
        error: null
      });
    }

    console.log(
      `[${scraperSource}] Scraped ${url} in ${scrapeDurationMs}ms, ` +
      `extracted ${itemsExtracted} items (${dataSize} bytes)`
    );

    return data;

  } catch (error) {
    const scrapeDurationMs = Date.now() - scrapeStartTime;

    // Record failed scrape
    if (global.metricsCollector) {
      global.metricsCollector.recordPageScrape(scraperSource, {
        url,
        scrapeDurationMs,
        itemsExtracted: 0,
        success: false,
        dataSize: 0,
        error: error.message
      });
    }

    console.error(
      `[${scraperSource}] Scraping ${url} failed after ${scrapeDurationMs}ms: ` +
      `${error.message}`
    );

    throw error;
  }
}

// ============================================================================
// 3. EXAMPLE: Robinhood Scraper Integration
// ============================================================================

/**
 * Example: How to use tracked navigation and scraping in a real scraper
 */
async function scrapeRobinhoodQuotes(tickers) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const results = [];

    for (const ticker of tickers) {
      try {
        const url = `https://robinhood.com/stocks/${ticker}/`;

        // Use tracked navigation
        await gotoWithRetriesTracked(
          page,
          url,
          { waitUntil: 'networkidle2' },
          3,
          'robinhood'
        );

        // Use tracked scraping
        const quoteData = await scrapePageTracked(
          page,
          url,
          'robinhood',
          async (page) => {
            // Your extraction logic
            return await page.evaluate(() => {
              return {
                price: document.querySelector('[data-testid="pricing-card-price"]')?.textContent,
                change: document.querySelector('[data-testid="pricing-card-change"]')?.textContent,
                timestamp: new Date().toISOString()
              };
            });
          }
        );

        results.push({ ticker, ...quoteData });

      } catch (error) {
        console.error(`[robinhood] Error scraping ${ticker}:`, error.message);
      }
    }

    return results;

  } finally {
    await browser.close();
  }
}

// ============================================================================
// 4. DATABASE SCHEMA (Create tables before running scrapers)
// ============================================================================

/**
 * Run these SQL commands to create required tables:
 */

const CREATE_SCRAPER_PERFORMANCE_TABLE = `
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
`;

const CREATE_DAILY_SUMMARY_TABLE = `
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
`;

const CREATE_SCHEDULER_METRICS_TABLE = `
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
`;

// ============================================================================
// 5. NIGHTLY AGGREGATION JOB (Run via cron)
// ============================================================================

/**
 * Schedule this to run nightly (e.g., 2 AM)
 * 
 * In crontab:
 * 0 2 * * * /usr/bin/node /path/to/nightly-aggregation.js
 */

async function runNightlyAggregation() {
  console.log('[Aggregation] Starting nightly metrics aggregation...');

  try {
    // Generate summary for yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await global.metricsCollector.generateDailySummary(yesterday);

    // Cleanup metrics older than 7 days
    await global.metricsCollector.cleanupOldMetrics(7);

    console.log('[Aggregation] Nightly aggregation complete');
  } catch (error) {
    console.error('[Aggregation] Error during nightly aggregation:', error);
  }
}

// ============================================================================
// 6. SCHEDULER METRICS INTEGRATION
// ============================================================================

/**
 * Example: Track scheduler execution
 */
async function runMetricsSchedulerTracked(schedulerName, schedulerFunction) {
  const startTime = Date.now();

  try {
    const result = await schedulerFunction();
    const durationMs = Date.now() - startTime;

    if (global.metricsCollector) {
      global.metricsCollector.recordSchedulerMetric(schedulerName, {
        executionDurationMs: durationMs,
        itemsProcessed: result.itemsProcessed || 0,
        success: true,
        error: null
      });
    }

    console.log(
      `[${schedulerName}] Completed in ${durationMs}ms, ` +
      `processed ${result.itemsProcessed || 0} items`
    );

    return result;

  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (global.metricsCollector) {
      global.metricsCollector.recordSchedulerMetric(schedulerName, {
        executionDurationMs: durationMs,
        itemsProcessed: 0,
        success: false,
        error: error.message
      });
    }

    console.error(
      `[${schedulerName}] Failed after ${durationMs}ms: ${error.message}`
    );

    throw error;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  gotoWithRetriesTracked,
  scrapePageTracked,
  runMetricsSchedulerTracked,
  scrapeRobinhoodQuotes,
  CREATE_SCRAPER_PERFORMANCE_TABLE,
  CREATE_DAILY_SUMMARY_TABLE,
  CREATE_SCHEDULER_METRICS_TABLE,
  runNightlyAggregation
};
