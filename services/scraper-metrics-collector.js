/**
 * Scraper Metrics Collector Service
 * Collects metrics from scraper operations and persists to database
 * Integrates with WebSocket server for real-time updates
 * 
 * Features:
 * - Per-page navigation timing
 * - Per-page scrape duration
 * - Per-source aggregation
 * - Real-time WebSocket broadcasting
 * - Batch database inserts
 * - Nightly aggregation into summary tables
 */

const pool = require('../db');

class ScraperMetricsCollector {
  constructor(wsServer, options = {}) {
    this.wsServer = wsServer;
    this.options = {
      batchSize: options.batchSize || 100,
      flushInterval: options.flushInterval || 5000, // 5 seconds
      ...options
    };

    // In-memory batch queues
    this.navigationMetrics = [];
    this.scrapeMetrics = [];
    this.schedulerMetrics = [];

    // Start periodic flush
    this.flushTimer = setInterval(() => this.flush(), this.options.flushInterval);
  }

  /**
   * Record page navigation timing
   */
  recordPageNavigation(scraperSource, navigationData) {
    const metric = {
      scraperSource,
      url: navigationData.url,
      navigationDurationMs: navigationData.navigationDurationMs,
      retryCount: navigationData.retryCount || 0,
      success: navigationData.success !== false,
      error: navigationData.error || null,
      timestamp: new Date(),
      recordedAt: Date.now()
    };

    this.navigationMetrics.push(metric);

    // Broadcast to WebSocket subscribers
    if (this.wsServer) {
      this.wsServer.recordPageNavigation(scraperSource, metric);
    }

    // Auto-flush if batch size exceeded
    if (this.navigationMetrics.length >= this.options.batchSize) {
      this.flushNavigationMetrics();
    }

    return metric;
  }

  /**
   * Record page scrape timing
   */
  recordPageScrape(scraperSource, scrapeData) {
    const metric = {
      scraperSource,
      url: scrapeData.url,
      scrapeDurationMs: scrapeData.scrapeDurationMs,
      itemsExtracted: scrapeData.itemsExtracted || 0,
      success: scrapeData.success !== false,
      error: scrapeData.error || null,
      dataSize: scrapeData.dataSize || 0,
      timestamp: new Date(),
      recordedAt: Date.now()
    };

    this.scrapeMetrics.push(metric);

    // Broadcast to WebSocket subscribers
    if (this.wsServer) {
      this.wsServer.recordPageScrape(scraperSource, metric);
    }

    // Auto-flush if batch size exceeded
    if (this.scrapeMetrics.length >= this.options.batchSize) {
      this.flushScrapeMetrics();
    }

    return metric;
  }

  /**
   * Record scheduler metric
   */
  recordSchedulerMetric(schedulerName, metricData) {
    const metric = {
      schedulerName,
      executionDurationMs: metricData.executionDurationMs,
      itemsProcessed: metricData.itemsProcessed || 0,
      success: metricData.success !== false,
      error: metricData.error || null,
      timestamp: new Date(),
      recordedAt: Date.now()
    };

    this.schedulerMetrics.push(metric);

    // Broadcast to WebSocket subscribers
    if (this.wsServer) {
      this.wsServer.recordSchedulerMetric(schedulerName, metric);
    }

    // Auto-flush if batch size exceeded
    if (this.schedulerMetrics.length >= this.options.batchSize) {
      this.flushSchedulerMetrics();
    }

    return metric;
  }

  /**
   * Flush navigation metrics to database
   */
  async flushNavigationMetrics() {
    if (this.navigationMetrics.length === 0) return;

    const metrics = this.navigationMetrics.splice(0);

    try {
      const conn = await pool.getConnection();

      try {
        // Insert navigation metrics
        const insertQuery = `
          INSERT INTO scraper_page_performance 
          (scraper_source, metric_type, page_url, navigation_duration_ms, 
           retry_count, success, error, created_at) 
          VALUES (?, 'navigation', ?, ?, ?, ?, ?, NOW())
        `;

        for (const metric of metrics) {
          await conn.query(insertQuery, [
            metric.scraperSource,
            metric.url,
            metric.navigationDurationMs,
            metric.retryCount,
            metric.success ? 1 : 0,
            metric.error
          ]);
        }

        console.log(`[Metrics] Inserted ${metrics.length} navigation metrics`);
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('[Metrics] Error flushing navigation metrics:', error);
      // Re-queue failed metrics
      this.navigationMetrics.unshift(...metrics);
    }
  }

  /**
   * Flush scrape metrics to database
   */
  async flushScrapeMetrics() {
    if (this.scrapeMetrics.length === 0) return;

    const metrics = this.scrapeMetrics.splice(0);

    try {
      const conn = await pool.getConnection();

      try {
        // Insert scrape metrics
        const insertQuery = `
          INSERT INTO scraper_page_performance 
          (scraper_source, metric_type, page_url, scrape_duration_ms, 
           items_extracted, success, error, data_size, created_at) 
          VALUES (?, 'scrape', ?, ?, ?, ?, ?, ?, NOW())
        `;

        for (const metric of metrics) {
          await conn.query(insertQuery, [
            metric.scraperSource,
            metric.url,
            metric.scrapeDurationMs,
            metric.itemsExtracted,
            metric.success ? 1 : 0,
            metric.error,
            metric.dataSize
          ]);
        }

        console.log(`[Metrics] Inserted ${metrics.length} scrape metrics`);
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('[Metrics] Error flushing scrape metrics:', error);
      // Re-queue failed metrics
      this.scrapeMetrics.unshift(...metrics);
    }
  }

  /**
   * Flush scheduler metrics to database
   */
  async flushSchedulerMetrics() {
    if (this.schedulerMetrics.length === 0) return;

    const metrics = this.schedulerMetrics.splice(0);

    try {
      const conn = await pool.getConnection();

      try {
        // Insert scheduler metrics
        const insertQuery = `
          INSERT INTO scheduler_metrics 
          (scheduler_name, execution_duration_ms, items_processed, success, error, created_at) 
          VALUES (?, ?, ?, ?, ?, NOW())
        `;

        for (const metric of metrics) {
          await conn.query(insertQuery, [
            metric.schedulerName,
            metric.executionDurationMs,
            metric.itemsProcessed,
            metric.success ? 1 : 0,
            metric.error
          ]);
        }

        console.log(`[Metrics] Inserted ${metrics.length} scheduler metrics`);
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('[Metrics] Error flushing scheduler metrics:', error);
      // Re-queue failed metrics
      this.schedulerMetrics.unshift(...metrics);
    }
  }

  /**
   * Flush all metric types
   */
  async flush() {
    try {
      await Promise.all([
        this.flushNavigationMetrics(),
        this.flushScrapeMetrics(),
        this.flushSchedulerMetrics()
      ]);
    } catch (error) {
      console.error('[Metrics] Error in flush:', error);
    }
  }

  /**
   * Generate daily summary from page performance metrics
   * Run nightly to aggregate previous day's metrics
   */
  async generateDailySummary(date = new Date()) {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    try {
      const conn = await pool.getConnection();

      try {
        // Get all unique scraper sources from today
        const sourcesResult = await conn.query(`
          SELECT DISTINCT scraper_source FROM scraper_page_performance
          WHERE created_at BETWEEN ? AND ?
        `, [startDate, endDate]);

        const sources = sourcesResult.map(r => r.scraper_source);

        // For each source, generate summary
        for (const source of sources) {
          // Navigation metrics summary
          const navQuery = `
            SELECT
              scraper_source,
              COUNT(*) as total_navigations,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_navigations,
              AVG(navigation_duration_ms) as avg_navigation_duration_ms,
              MIN(navigation_duration_ms) as min_navigation_duration_ms,
              MAX(navigation_duration_ms) as max_navigation_duration_ms,
              AVG(retry_count) as avg_retry_count,
              DATE(created_at) as metric_date
            FROM scraper_page_performance
            WHERE metric_type = 'navigation'
              AND scraper_source = ?
              AND created_at BETWEEN ? AND ?
            GROUP BY scraper_source, DATE(created_at)
          `;

          const navResults = await conn.query(navQuery, [source, startDate, endDate]);

          for (const navSummary of navResults) {
            await conn.query(`
              INSERT INTO scraper_daily_summary 
              (scraper_source, metric_date, total_navigations, successful_navigations, 
               avg_navigation_duration_ms, min_navigation_duration_ms, 
               max_navigation_duration_ms, avg_retry_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                total_navigations = VALUES(total_navigations),
                successful_navigations = VALUES(successful_navigations),
                avg_navigation_duration_ms = VALUES(avg_navigation_duration_ms),
                min_navigation_duration_ms = VALUES(min_navigation_duration_ms),
                max_navigation_duration_ms = VALUES(max_navigation_duration_ms),
                avg_retry_count = VALUES(avg_retry_count)
            `, [
              navSummary.scraper_source,
              navSummary.metric_date,
              navSummary.total_navigations,
              navSummary.successful_navigations,
              navSummary.avg_navigation_duration_ms,
              navSummary.min_navigation_duration_ms,
              navSummary.max_navigation_duration_ms,
              navSummary.avg_retry_count
            ]);
          }

          // Scrape metrics summary
          const scrapeQuery = `
            SELECT
              scraper_source,
              COUNT(*) as total_scrapes,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_scrapes,
              AVG(scrape_duration_ms) as avg_scrape_duration_ms,
              MIN(scrape_duration_ms) as min_scrape_duration_ms,
              MAX(scrape_duration_ms) as max_scrape_duration_ms,
              SUM(items_extracted) as total_items_extracted,
              AVG(items_extracted) as avg_items_extracted,
              DATE(created_at) as metric_date
            FROM scraper_page_performance
            WHERE metric_type = 'scrape'
              AND scraper_source = ?
              AND created_at BETWEEN ? AND ?
            GROUP BY scraper_source, DATE(created_at)
          `;

          const scrapeResults = await conn.query(scrapeQuery, [source, startDate, endDate]);

          for (const scrapeSummary of scrapeResults) {
            await conn.query(`
              INSERT INTO scraper_daily_summary 
              (scraper_source, metric_date, total_scrapes, successful_scrapes, 
               avg_scrape_duration_ms, min_scrape_duration_ms, 
               max_scrape_duration_ms, total_items_extracted, avg_items_extracted)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                total_scrapes = VALUES(total_scrapes),
                successful_scrapes = VALUES(successful_scrapes),
                avg_scrape_duration_ms = VALUES(avg_scrape_duration_ms),
                min_scrape_duration_ms = VALUES(min_scrape_duration_ms),
                max_scrape_duration_ms = VALUES(max_scrape_duration_ms),
                total_items_extracted = VALUES(total_items_extracted),
                avg_items_extracted = VALUES(avg_items_extracted)
            `, [
              scrapeSummary.scraper_source,
              scrapeSummary.metric_date,
              scrapeSummary.total_scrapes,
              scrapeSummary.successful_scrapes,
              scrapeSummary.avg_scrape_duration_ms,
              scrapeSummary.min_scrape_duration_ms,
              scrapeSummary.max_scrape_duration_ms,
              scrapeSummary.total_items_extracted,
              scrapeSummary.avg_items_extracted
            ]);
          }
        }

        console.log(`[Metrics] Generated daily summaries for ${sources.length} sources on ${startDate.toDateString()}`);
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('[Metrics] Error generating daily summary:', error);
    }
  }

  /**
   * Cleanup old metrics (retention policy)
   * Keep detailed metrics for 7 days, summaries permanently
   */
  async cleanupOldMetrics(retentionDays = 7) {
    try {
      const conn = await pool.getConnection();

      try {
        const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));

        const result = await conn.query(`
          DELETE FROM scraper_page_performance
          WHERE created_at < ?
        `, [cutoffDate]);

        console.log(`[Metrics] Cleaned up ${result.affectedRows} old performance metrics`);
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('[Metrics] Error cleaning up old metrics:', error);
    }
  }

  /**
   * Get metrics statistics for monitoring
   */
  async getMetricsStats() {
    return {
      pendingNavigation: this.navigationMetrics.length,
      pendingScrape: this.scrapeMetrics.length,
      pendingScheduler: this.schedulerMetrics.length,
      totalPending: 
        this.navigationMetrics.length + 
        this.scrapeMetrics.length + 
        this.schedulerMetrics.length
    };
  }

  /**
   * Shutdown collector
   */
  async shutdown() {
    clearInterval(this.flushTimer);
    await this.flush();
    console.log('[Metrics] Collector shutdown complete');
  }
}

module.exports = ScraperMetricsCollector;
