/**
 * Phase 9: Metrics Integration Helper
 * 
 * This module provides utilities for recording scraper metrics to the WebSocket
 * real-time metrics system integrated in Phase 9.
 * 
 * Usage:
 *   const { recordScraperMetrics, getMetricsCollector } = require('./metrics-integration');
 *   const metricsCollector = getMetricsCollector();
 *   
 *   // Wrap your scraper calls
 *   const result = await recordScraperMetrics('yahoo', async () => {
 *     return await scrapeYahoo(browser, security, outputDir);
 *   });
 */

let metricsCollector = null;

/**
 * Initialize the metrics collector from the global scope
 * Called automatically on first use, but can be called explicitly
 */
function initializeMetricsCollector() {
  if (global.metricsCollector) {
    metricsCollector = global.metricsCollector;
    console.log('[Metrics] MetricsCollector initialized from global scope');
  } else {
    console.warn('[Metrics] global.metricsCollector not available - metrics will not be recorded');
  }
}

/**
 * Get the metrics collector instance
 * @returns {Object|null} MetricsCollector instance or null if not available
 */
function getMetricsCollector() {
  if (!metricsCollector) {
    initializeMetricsCollector();
  }
  return metricsCollector;
}

/**
 * Record a scraper execution with metrics
 * 
 * @param {string} scraperSource - Name of the scraper (e.g., 'yahoo', 'robinhood', 'nasdaq')
 * @param {Function} scraperFunction - Async function that performs the scraping
 * @param {Object} options - Additional options
 * @param {string} options.url - URL being scraped (optional)
 * @returns {Promise} Result from the scraper function
 */
async function recordScraperMetrics(scraperSource, scraperFunction, options = {}) {
  const startTime = Date.now();
  let success = false;
  let itemsExtracted = 0;
  let error = null;

  try {
    // Execute the scraper
    const result = await scraperFunction();

    // Try to extract items count from result
    if (result && typeof result === 'object') {
      if (Array.isArray(result)) {
        itemsExtracted = result.length;
      } else if (result.items && Array.isArray(result.items)) {
        itemsExtracted = result.items.length;
      } else if (result.data && Array.isArray(result.data)) {
        itemsExtracted = result.data.length;
      } else if (typeof result.count === 'number') {
        itemsExtracted = result.count;
      }
    }

    success = true;
    return result;
  } catch (err) {
    success = false;
    error = err.message || String(err);
    throw err;
  } finally {
    // Record metrics
    const duration = Date.now() - startTime;

    if (metricsCollector) {
      try {
        metricsCollector.recordPageScrape({
          scraper_source: scraperSource,
          url: options.url || '',
          scrape_duration_ms: duration,
          items_extracted: itemsExtracted,
          success: success,
          error: error
        });
      } catch (metricsError) {
        console.warn(`[Metrics] Failed to record metrics: ${metricsError.message}`);
      }
    }
  }
}

/**
 * Record a navigation event with metrics
 * 
 * @param {string} scraperSource - Name of the scraper (e.g., 'yahoo', 'robinhood')
 * @param {Function} navigationFunction - Async function that performs navigation
 * @param {Object} options - Additional options
 * @param {string} options.url - URL being navigated to
 * @returns {Promise} Result from the navigation function
 */
async function recordNavigationMetrics(scraperSource, navigationFunction, options = {}) {
  const startTime = Date.now();
  let success = false;
  let error = null;

  try {
    // Execute the navigation
    const result = await navigationFunction();
    success = true;
    return result;
  } catch (err) {
    success = false;
    error = err.message || String(err);
    throw err;
  } finally {
    // Record metrics
    const duration = Date.now() - startTime;

    if (metricsCollector) {
      try {
        metricsCollector.recordPageNavigation({
          scraper_source: scraperSource,
          url: options.url || '',
          navigation_duration_ms: duration,
          success: success,
          error: error
        });
      } catch (metricsError) {
        console.warn(`[Metrics] Failed to record navigation metrics: ${metricsError.message}`);
      }
    }
  }
}

/**
 * Wrap a scraper function to automatically record metrics
 * 
 * @param {string} scraperSource - Name of the scraper
 * @param {Function} originalScraperFunction - Original scraper function
 * @returns {Function} Wrapped scraper function that records metrics
 */
function createMetricsWrappedScraper(scraperSource, originalScraperFunction) {
  return async function wrappedScraper(browser, security, outputDir, ...args) {
    return await recordScraperMetrics(scraperSource, async () => {
      return await originalScraperFunction(browser, security, outputDir, ...args);
    }, {
      url: security[scraperSource] || security.url || ''
    });
  };
}

module.exports = {
  getMetricsCollector,
  initializeMetricsCollector,
  recordScraperMetrics,
  recordNavigationMetrics,
  createMetricsWrappedScraper
};
