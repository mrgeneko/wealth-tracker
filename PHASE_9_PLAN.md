PHASE 9 PLAN - Advanced Analytics Dashboard
============================================

OVERVIEW
========
Phase 9 will add comprehensive analytics dashboards to the wealth-tracker application,
leveraging the metrics data collected in Phase 8. The implementation will use an abstraction
layer to allow easy replacement of the charting library (Chart.js → ECharts, D3.js, etc.)
without refactoring dashboard logic.

ARCHITECTURE APPROACH
=====================

The dashboard will use a clean separation of concerns:

1. DATA LAYER (Backend)
   └── New analytics API endpoints (/api/analytics/*)
   
2. ABSTRACTION LAYER (Frontend)
   └── ChartAdapter interface (standardized chart config)
   └── Can be swapped for EChartsAdapter, D3Adapter, etc.
   
3. VISUALIZATION LAYER (Frontend)
   └── Chart.js implementation (replaceable)
   
4. UI LAYER (Frontend)
   └── Dashboard components (independent of charting library)

PHASE 9 IMPLEMENTATION STRUCTURE
=================================

Backend (New)
-------------
/api/analytics.js
├── GET /api/analytics/symbol-growth - Symbol count over time
├── GET /api/analytics/refresh-success-rate - Refresh success % by type
├── GET /api/analytics/metadata-completion - Metadata % complete
├── GET /api/analytics/sync-performance - Sync duration trends
├── GET /api/analytics/error-trends - Error rate over time
├── GET /api/analytics/type-distribution - EQUITY/ETF/BOND/TREASURY split
└── GET /api/analytics/summary - Combined dashboard data

Frontend (New)
--------------
/dashboard/public/js/
├── adapters/
│   ├── ChartAdapter.js (Abstract base class - interface definition)
│   ├── ChartJsAdapter.js (Chart.js implementation)
│   └── adapters/EChartsAdapter.js (Future: ECharts implementation)
│
├── charts/
│   ├── SymbolGrowthChart.js (Uses adapter)
│   ├── RefreshSuccessChart.js (Uses adapter)
│   ├── MetadataCompletionChart.js (Uses adapter)
│   ├── SyncPerformanceChart.js (Uses adapter)
│   ├── ErrorTrendChart.js (Uses adapter)
│   └── TypeDistributionChart.js (Uses adapter)
│
└── dashboards/
    └── AnalyticsDashboard.js (Orchestrates all charts)

/dashboard/public/
├── analytics.html (Analytics page)
└── css/analytics.css (Dashboard styling)

Tests (New)
-----------
/tests/unit/adapters/
├── ChartAdapter.test.js (Interface contract tests)
├── ChartJsAdapter.test.js (Implementation tests)
└── ChartJsAdapter.integration.test.js (With Chart.js library)

/tests/unit/api/
└── analytics.test.js (Analytics endpoints)

DATA FLOW
=========

User Request
    ↓
Browser (analytics.html)
    ↓
AnalyticsDashboard.js (Orchestrator)
    ├→ Calls API endpoints (/api/analytics/*)
    ├→ Gets raw metric data
    ├→ Passes to Chart adapters
    ├→ ChartAdapter.normalizeData() (Standardized format)
    ├→ ChartAdapter.createConfig() (Returns library-specific config)
    ├→ ChartJsAdapter implementation (Current)
    └→ Renders using Chart.js library

To swap libraries later:
    └→ Just implement EChartsAdapter extending ChartAdapter
    └→ AnalyticsDashboard uses EChartsAdapter instead
    └→ No changes needed to the rest of the application

ABSTRACT ADAPTER PATTERN
========================

// /dashboard/public/js/adapters/ChartAdapter.js
class ChartAdapter {
  /**
   * Normalize raw metric data to standard format
   * @returns {Object} Standardized data structure
   */
  normalizeData(rawData) {
    throw new Error('normalizeData() must be implemented');
  }

  /**
   * Create library-specific chart configuration
   * @returns {Object} Config object for the charting library
   */
  createConfig(normalizedData, options = {}) {
    throw new Error('createConfig() must be implemented');
  }

  /**
   * Render chart to DOM element
   * @param {HTMLElement} container
   * @param {Object} config
   */
  render(container, config) {
    throw new Error('render() must be implemented');
  }

  /**
   * Update existing chart with new data
   * @param {Object} newData
   */
  update(newData) {
    throw new Error('update() must be implemented');
  }

  /**
   * Destroy chart instance and cleanup
   */
  destroy() {
    throw new Error('destroy() must be implemented');
  }
}

// /dashboard/public/js/adapters/ChartJsAdapter.js
class ChartJsAdapter extends ChartAdapter {
  constructor(chartType) {
    super();
    this.chartType = chartType; // 'line', 'bar', 'pie', etc.
    this.chart = null;
  }

  normalizeData(rawData) {
    // Convert API response to standard format
    return {
      labels: rawData.labels,
      datasets: rawData.datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.color || '#3b82f6',
        backgroundColor: ds.backgroundColor || 'rgba(59, 130, 246, 0.1)',
        tension: 0.1
      }))
    };
  }

  createConfig(normalizedData, options = {}) {
    return {
      type: this.chartType,
      data: normalizedData,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'top'
          },
          title: {
            display: true,
            text: options.title || 'Chart'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ...options.yAxisConfig
          }
        },
        ...options
      }
    };
  }

  render(container, config) {
    const ctx = container.getContext('2d');
    this.chart = new Chart(ctx, config);
    return this.chart;
  }

  update(newData) {
    if (!this.chart) throw new Error('Chart not initialized');
    const normalized = this.normalizeData(newData);
    this.chart.data = normalized;
    this.chart.update();
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}

// /dashboard/public/js/charts/SymbolGrowthChart.js
class SymbolGrowthChart {
  constructor(containerId, adapter) {
    this.container = document.getElementById(containerId);
    this.adapter = adapter; // Can be ChartJsAdapter, EChartsAdapter, etc.
    this.chart = null;
  }

  async loadData() {
    const response = await fetch('/api/analytics/symbol-growth');
    return await response.json();
  }

  async initialize() {
    const rawData = await this.loadData();
    const normalized = this.adapter.normalizeData(rawData);
    const config = this.adapter.createConfig(normalized, {
      title: 'Symbol Registry Growth Over Time',
      yAxisConfig: {
        title: {
          display: true,
          text: 'Total Symbols'
        }
      }
    });
    this.chart = this.adapter.render(this.container, config);
  }

  async refresh() {
    const rawData = await this.loadData();
    this.adapter.update(rawData);
  }

  destroy() {
    if (this.chart) {
      this.adapter.destroy();
    }
  }
}

// /dashboard/public/js/dashboards/AnalyticsDashboard.js
class AnalyticsDashboard {
  constructor(adapterClass = ChartJsAdapter) {
    this.adapterClass = adapterClass;
    this.charts = {};
  }

  async initialize() {
    // Initialize all charts with the specified adapter
    this.charts.symbolGrowth = new SymbolGrowthChart(
      'symbol-growth-chart',
      new this.adapterClass('line')
    );
    
    this.charts.refreshSuccess = new RefreshSuccessChart(
      'refresh-success-chart',
      new this.adapterClass('bar')
    );
    
    this.charts.metadataCompletion = new MetadataCompletionChart(
      'metadata-completion-chart',
      new this.adapterClass('doughnut')
    );
    
    // ... initialize other charts ...

    // Initialize all
    await Promise.all(
      Object.values(this.charts).map(chart => chart.initialize())
    );
  }

  async refreshAll() {
    await Promise.all(
      Object.values(this.charts).map(chart => chart.refresh())
    );
  }

  destroy() {
    Object.values(this.charts).forEach(chart => chart.destroy());
    this.charts = {};
  }
}

// Usage in HTML:
// Default: Chart.js
// const dashboard = new AnalyticsDashboard(ChartJsAdapter);
// 
// Swap to ECharts:
// const dashboard = new AnalyticsDashboard(EChartsAdapter);
// 
// No other code changes needed!

DASHBOARD PAGES & METRICS
==========================

1. SYMBOL REGISTRY ANALYTICS (/dashboard/analytics.html)
   ├── Symbol Growth Chart (Line)
   │   └── Total symbols over time, grouped by type
   │
   ├── Type Distribution Chart (Pie)
   │   └── EQUITY vs ETF vs BOND vs TREASURY split
   │
   ├── Metadata Completion Chart (Progress/Gauge)
   │   └── % of symbols with Yahoo metadata
   │
   └── Symbol Source Breakdown (Stacked Bar)
       └── Count by source (NASDAQ, NYSE, OTHER, TREASURY)

2. FILE REFRESH ANALYTICS (/dashboard/refresh-analytics.html)
   ├── Refresh Success Rate Chart (Bar)
   │   └── Success % by file type
   │
   ├── Sync Performance Chart (Line)
   │   └── Sync duration trends per file type
   │
   ├── Error Trend Chart (Area)
   │   └── Error rate over time
   │
   └── Last Refresh Status Table
       └── Current status of each file type

3. SYSTEM HEALTH DASHBOARD (/dashboard/health-analytics.html)
   ├── Overall Health Score (Gauge)
   │   └── Composite score from all metrics
   │
   ├── Refresh Frequency Chart (Heatmap)
   │   └── When refreshes typically occur
   │
   ├── Record Counts Chart (Stacked Area)
   │   └── Inserted/Updated/Skipped/Errors per refresh
   │
   └── Performance SLA Chart (Line)
       └── Track against target performance metrics

API ENDPOINTS (New)
===================

GET /api/analytics/symbol-growth
- Returns: { labels: [...], datasets: [{ label, data }] }
- Query params: days=30 (default), type=EQUITY|ETF|BOND|TREASURY (optional)

GET /api/analytics/refresh-success-rate
- Returns: { data: { NASDAQ: 98%, NYSE: 99%, ... } }
- Query params: days=30, source=NASDAQ_FILE|NYSE_FILE|... (optional)

GET /api/analytics/metadata-completion
- Returns: { totalSymbols, withMetadata, percentage, byType: {...} }

GET /api/analytics/sync-performance
- Returns: { labels: [...], datasets: [{ label: 'NASDAQ', data: [...] }] }
- Query params: days=30, fileType=NASDAQ|NYSE|OTHER|TREASURY (optional)

GET /api/analytics/error-trends
- Returns: { labels: [...], datasets: [{ label: 'Error Count', data: [...] }] }
- Query params: days=30, source=NASDAQ_FILE|... (optional)

GET /api/analytics/type-distribution
- Returns: { labels: ['EQUITY', 'ETF', 'BOND', 'TREASURY'], 
             datasets: [{ data: [7419, 4638, 131, 360] }] }

GET /api/analytics/summary
- Returns: All analytics data in one call for dashboard initialization

TECH STACK
==========

Frontend:
- Chart.js 4.x (charting library - swappable)
- ChartAdapter (abstraction layer - our custom code)
- Vanilla JavaScript or Vue.js (UI components)
- Tailwind CSS (styling)

Backend:
- Node.js + Express.js (already have)
- MySQL (already have for metrics data)
- Query aggregation functions (new)

Testing:
- Jest unit tests for adapters and API endpoints
- Integration tests for full dashboard flow

MIGRATION PATH (For Future Library Swaps)
==========================================

Phase 9.1: Initial implementation with Chart.js
- All charts use ChartJsAdapter
- Abstraction layer in place

Phase 9.2: Add ECharts support (example)
- Create EChartsAdapter extending ChartAdapter
- Tests verify adapter contract
- Dashboard can use either library

Phase 9.3: Add D3.js support (example)
- Create D3Adapter extending ChartAdapter
- Tests verify adapter contract
- Dashboard supports all three libraries

IMPLEMENTATION PHASES
=====================

Phase 9.1: Analytics API & Chart Adapter
- Create /api/analytics.js with 6 endpoints
- Create ChartAdapter abstract class
- Create ChartJsAdapter implementation
- Tests: API endpoints + adapter contract

Phase 9.2: Dashboard UI Components
- Create AnalyticsDashboard orchestrator
- Create individual chart components
- Create analytics.html page
- Tests: Chart rendering, data flow

Phase 9.3: Dashboard Pages & Integration
- Create multiple dashboard pages (Symbol Registry, Refresh, Health)
- Add navigation to dashboard UI
- Real-time refresh capability
- Tests: Full dashboard integration

Phase 9.4: Performance & Polish
- Optimize queries for large datasets
- Add filtering/date range selectors
- Add export functionality (CSV, PNG)
- Performance testing and optimization

TESTING STRATEGY
================

Unit Tests:
- ChartAdapter interface contract tests
- ChartJsAdapter implementation tests
- API endpoint tests
- Data normalization tests

Integration Tests:
- Full dashboard initialization
- Chart rendering with real data
- Adapter swapping at runtime
- Data refresh scenarios

Test Coverage Target: 85%+

DELIVERABLES
============

Code:
✓ /api/analytics.js - Analytics API endpoints
✓ /dashboard/public/js/adapters/ChartAdapter.js - Abstract interface
✓ /dashboard/public/js/adapters/ChartJsAdapter.js - Chart.js implementation
✓ /dashboard/public/js/charts/*.js - Individual chart classes
✓ /dashboard/public/js/dashboards/AnalyticsDashboard.js - Orchestrator
✓ /dashboard/public/analytics.html - Analytics page
✓ /dashboard/public/css/analytics.css - Dashboard styling

Tests:
✓ /tests/unit/adapters/ChartAdapter.test.js
✓ /tests/unit/adapters/ChartJsAdapter.test.js
✓ /tests/unit/api/analytics.test.js
✓ /tests/integration/analytics-dashboard.test.js

Documentation:
✓ /docs/PHASE_9_PLAN.md (This file)
✓ /docs/ANALYTICS_ARCHITECTURE.md (Detailed design)
✓ /docs/ADAPTER_PATTERN.md (How to extend/replace)
✓ Inline code comments

ESTIMATED EFFORT
================

Phase 9.1 (Analytics API + Adapter):   3-4 days
Phase 9.2 (Dashboard UI Components):   3-4 days
Phase 9.3 (Dashboard Pages):            2-3 days
Phase 9.4 (Performance & Polish):       2-3 days
─────────────────────────────────────
Total Phase 9 Effort:                  10-14 days

SUCCESS CRITERIA
================

✓ All 6 analytics API endpoints working
✓ ChartAdapter interface fully defined and tested
✓ ChartJsAdapter implementation complete and tested
✓ Dashboard displays all 6 chart types correctly
✓ Charts update in real-time with data refresh
✓ Adapter can be swapped with minimal code changes
✓ 85%+ test coverage for new code
✓ Performance: Dashboards load in <2 seconds
✓ Documentation: Setup guide for new adapters
✓ Backward compatible with Phase 8

KEY FEATURES
============

1. ABSTRACTION LAYER
   - Library-agnostic chart interface
   - Easy to swap implementations
   - Standardized data format

2. MODULAR COMPONENTS
   - Each chart is independent
   - Can be reused in different dashboards
   - Easy to add new chart types

3. FLEXIBLE RENDERING
   - Single or multi-chart dashboards
   - Real-time updates
   - Export capabilities (future)

4. TESTABLE DESIGN
   - Adapters testable independently
   - API endpoints testable separately
   - Full integration testing possible

5. PERFORMANCE OPTIMIZED
   - Aggregated API endpoints (not single records)
   - Client-side rendering (no server-side rendering)
   - Efficient data structures

NOTES FOR FUTURE ENHANCEMENTS
=============================

After Phase 9 completion, possible additions:
- Real-time WebSocket updates (vs polling)
- Custom date range selector
- Chart export to PNG/PDF
- Dashboard customization (drag/drop)
- Alerting based on thresholds
- Comparative analysis (time periods)
- Automated report generation

CONCLUSION
==========

Phase 9 will add powerful analytics capabilities while maintaining clean,
maintainable architecture. The adapter pattern ensures that moving to a more
sophisticated charting library in the future requires only implementing a
new adapter - no changes to the rest of the codebase.

This approach balances simplicity (start with Chart.js) with flexibility
(swap libraries anytime) and scalability (add new metrics easily).
