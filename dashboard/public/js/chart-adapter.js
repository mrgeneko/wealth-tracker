/**
 * Chart Adapter Base Class
 * Provides abstraction layer for charting library implementation
 * Allows easy swapping of Chart.js, ECharts, D3.js, etc.
 * 
 * Usage:
 * const adapter = new ChartJsAdapter('canvas-element-id');
 * adapter.createLineChart('Navigation Time', data, options);
 * adapter.update(newData);
 */

class ChartAdapter {
  /**
   * Constructor for chart adapter
   * @param {string} elementId - ID of canvas/container element
   * @param {object} config - Chart configuration
   */
  constructor(elementId, config = {}) {
    this.elementId = elementId;
    this.element = document.getElementById(elementId);
    this.config = {
      responsive: true,
      maintainAspectRatio: true,
      ...config
    };
    this.chart = null;
    this.chartType = null;
    this.data = [];
  }

  /**
   * Create a line chart
   * @param {string} title - Chart title
   * @param {array} data - Array of {label, value, timestamp} objects
   * @param {object} options - Chart-specific options
   */
  createLineChart(title, data, options = {}) {
    this.chartType = 'line';
    this.data = data;
    this._createChart(title, data, options);
  }

  /**
   * Create a bar chart
   * @param {string} title - Chart title
   * @param {array} data - Array of {label, value} objects
   * @param {object} options - Chart-specific options
   */
  createBarChart(title, data, options = {}) {
    this.chartType = 'bar';
    this.data = data;
    this._createChart(title, data, options);
  }

  /**
   * Create a pie/doughnut chart
   * @param {string} title - Chart title
   * @param {array} data - Array of {label, value} objects
   * @param {object} options - Chart-specific options
   */
  createPieChart(title, data, options = {}) {
    this.chartType = 'pie';
    this.data = data;
    this._createChart(title, data, options);
  }

  /**
   * Create a radar chart
   * @param {string} title - Chart title
   * @param {array} data - Array of {label, value} objects
   * @param {object} options - Chart-specific options
   */
  createRadarChart(title, data, options = {}) {
    this.chartType = 'radar';
    this.data = data;
    this._createChart(title, data, options);
  }

  /**
   * Update chart with new data
   * @param {array} newData - New data points
   */
  update(newData) {
    this.data = newData;
    this._updateChartData(newData);
  }

  /**
   * Add a new data point and update chart
   * @param {object} point - New data point {label, value, timestamp}
   */
  addDataPoint(point) {
    this.data.push(point);
    
    // Keep only last 50 points for performance
    if (this.data.length > 50) {
      this.data = this.data.slice(-50);
    }
    
    this._updateChartData(this.data);
  }

  /**
   * Clear all data from chart
   */
  clear() {
    this.data = [];
    this._updateChartData([]);
  }

  /**
   * Update chart title
   * @param {string} title - New title
   */
  setTitle(title) {
    this._setTitle(title);
  }

  /**
   * Destroy chart and cleanup
   */
  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  /**
   * Show/hide chart
   * @param {boolean} visible - Whether to show chart
   */
  setVisible(visible) {
    if (this.element) {
      this.element.style.display = visible ? 'block' : 'none';
    }
  }

  /**
   * Resize chart to fit container
   */
  resize() {
    if (this.chart && typeof this.chart.resize === 'function') {
      this.chart.resize();
    }
  }

  /**
   * Export chart as image
   * @returns {string} Data URL of chart image
   */
  exportAsImage() {
    if (this.chart && typeof this.chart.toImage === 'function') {
      return this.chart.toImage();
    }
    return null;
  }

  /**
   * Get chart data
   * @returns {array} Current chart data
   */
  getData() {
    return this.data;
  }

  /**
   * ABSTRACT METHOD - Implement in subclass
   * Create the actual chart
   */
  _createChart(title, data, options) {
    throw new Error('_createChart() must be implemented by subclass');
  }

  /**
   * ABSTRACT METHOD - Implement in subclass
   * Update chart data
   */
  _updateChartData(newData) {
    throw new Error('_updateChartData() must be implemented by subclass');
  }

  /**
   * ABSTRACT METHOD - Implement in subclass
   * Set chart title
   */
  _setTitle(title) {
    throw new Error('_setTitle() must be implemented by subclass');
  }
}

/**
 * Metric aggregation utilities
 */
class MetricAggregator {
  /**
   * Calculate average of metric values
   */
  static average(metrics, field) {
    if (!metrics || metrics.length === 0) return 0;
    const sum = metrics.reduce((acc, m) => acc + (m[field] || 0), 0);
    return Math.round(sum / metrics.length);
  }

  /**
   * Calculate success rate percentage
   */
  static successRate(metrics) {
    if (!metrics || metrics.length === 0) return 0;
    const successful = metrics.filter(m => m.success).length;
    return Math.round((successful / metrics.length) * 100);
  }

  /**
   * Get min value from metrics
   */
  static min(metrics, field) {
    if (!metrics || metrics.length === 0) return 0;
    return Math.min(...metrics.map(m => m[field] || 0));
  }

  /**
   * Get max value from metrics
   */
  static max(metrics, field) {
    if (!metrics || metrics.length === 0) return 0;
    return Math.max(...metrics.map(m => m[field] || 0));
  }

  /**
   * Group metrics by scraper source
   */
  static groupBySource(metrics) {
    const grouped = {};
    metrics.forEach(metric => {
      const source = metric.scraperSource || 'unknown';
      if (!grouped[source]) {
        grouped[source] = [];
      }
      grouped[source].push(metric);
    });
    return grouped;
  }

  /**
   * Group metrics by metric type
   */
  static groupByType(metrics) {
    const grouped = {};
    metrics.forEach(metric => {
      const type = metric.type || 'unknown';
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(metric);
    });
    return grouped;
  }

  /**
   * Filter metrics by time range
   */
  static filterByTime(metrics, startTime, endTime) {
    return metrics.filter(m => {
      const time = m.recordedAt || m.timestamp;
      return time >= startTime && time <= endTime;
    });
  }

  /**
   * Convert navigation metrics to chart data
   */
  static navigationToChartData(metrics) {
    return metrics.map((m, idx) => ({
      label: `Nav ${idx + 1}`,
      value: m.navigationDurationMs,
      timestamp: m.recordedAt,
      url: m.url,
      success: m.success
    }));
  }

  /**
   * Convert scrape metrics to chart data
   */
  static scrapeToChartData(metrics) {
    return metrics.map((m, idx) => ({
      label: `Scrape ${idx + 1}`,
      value: m.scrapeDurationMs,
      timestamp: m.recordedAt,
      url: m.url,
      items: m.itemsExtracted,
      success: m.success
    }));
  }

  /**
   * Create summary statistics for scraper
   */
  static createSummary(metrics, scraperSource) {
    const navMetrics = metrics.filter(m => m.type === 'page_navigation');
    const scrapeMetrics = metrics.filter(m => m.type === 'page_scrape');

    return {
      scraperSource,
      totalMetrics: metrics.length,
      navigation: {
        count: navMetrics.length,
        avgDuration: this.average(navMetrics, 'navigationDurationMs'),
        minDuration: this.min(navMetrics, 'navigationDurationMs'),
        maxDuration: this.max(navMetrics, 'navigationDurationMs'),
        successRate: this.successRate(navMetrics)
      },
      scrape: {
        count: scrapeMetrics.length,
        avgDuration: this.average(scrapeMetrics, 'scrapeDurationMs'),
        minDuration: this.min(scrapeMetrics, 'scrapeDurationMs'),
        maxDuration: this.max(scrapeMetrics, 'scrapeDurationMs'),
        totalItems: scrapeMetrics.reduce((sum, m) => sum + (m.itemsExtracted || 0), 0),
        successRate: this.successRate(scrapeMetrics)
      }
    };
  }
}

// Export for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChartAdapter, MetricAggregator };
}
