/**
 * Chart.js Adapter Implementation
 * Concrete implementation of ChartAdapter for Chart.js library
 * 
 * Dependencies:
 * - Chart.js (https://cdn.jsdelivr.net/npm/chart.js)
 * - chart-adapter.js
 * 
 * Usage:
 * const chart = new ChartJsAdapter('canvas-id');
 * chart.createLineChart('Navigation Times', data);
 * chart.addDataPoint({ label: 'Nav 1', value: 150, timestamp: Date.now() });
 */

class ChartJsAdapter extends ChartAdapter {
  constructor(elementId, config = {}) {
    super(elementId, config);
    this.defaultColors = [
      'rgb(75, 192, 192)',   // Teal
      'rgb(255, 99, 132)',   // Red
      'rgb(54, 162, 235)',   // Blue
      'rgb(255, 206, 86)',   // Yellow
      'rgb(153, 102, 255)',  // Purple
      'rgb(255, 159, 64)',   // Orange
      'rgb(199, 199, 199)',  // Gray
      'rgb(83, 102, 255)',   // Navy
      'rgb(255, 99, 200)',   // Pink
      'rgb(75, 255, 192)'    // Green
    ];
    this.colorIndex = 0;
  }

  /**
   * Get next color from palette
   */
  _getNextColor() {
    const color = this.defaultColors[this.colorIndex % this.defaultColors.length];
    this.colorIndex++;
    return color;
  }

  /**
   * Create Chart.js line chart
   */
  _createChart(title, data, options = {}) {
    const ctx = this.element.getContext('2d');
    
    const chartData = {
      labels: data.map((d, i) => d.label || `Point ${i + 1}`),
      datasets: [{
        label: title,
        data: data.map(d => d.value),
        borderColor: this._getNextColor(),
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: 'rgba(75, 192, 192, 1)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }]
    };

    const chartOptions = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        title: {
          display: true,
          text: title,
          font: { size: 14, weight: 'bold' }
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          titleFont: { size: 12 },
          bodyFont: { size: 11 }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return value + 'ms';
            }
          }
        }
      },
      ...options
    };

    this.chart = new Chart(ctx, {
      type: this.chartType || 'line',
      data: chartData,
      options: chartOptions
    });
  }

  /**
   * Update Chart.js chart data
   */
  _updateChartData(newData) {
    if (!this.chart) return;

    // Keep only last 50 points for performance
    const displayData = newData.slice(-50);

    this.chart.data.labels = displayData.map((d, i) => d.label || `Point ${i + 1}`);
    this.chart.data.datasets[0].data = displayData.map(d => d.value);
    this.chart.update('none'); // 'none' = no animation for real-time updates
  }

  /**
   * Set chart title
   */
  _setTitle(title) {
    if (this.chart) {
      this.chart.options.plugins.title.text = title;
      this.chart.update();
    }
  }

  /**
   * Create bar chart
   */
  createBarChart(title, data, options = {}) {
    this.chartType = 'bar';
    this.data = data;

    const ctx = this.element.getContext('2d');
    
    const chartData = {
      labels: data.map((d, i) => d.label || `Bar ${i + 1}`),
      datasets: [{
        label: title,
        data: data.map(d => d.value),
        backgroundColor: data.map(() => this._getNextColor()),
        borderColor: data.map(() => 'rgba(0, 0, 0, 0.3)'),
        borderWidth: 1
      }]
    };

    const chartOptions = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: title,
          font: { size: 14, weight: 'bold' }
        }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      },
      ...options
    };

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: chartData,
      options: chartOptions
    });
  }

  /**
   * Create pie chart
   */
  createPieChart(title, data, options = {}) {
    this.chartType = 'pie';
    this.data = data;

    const ctx = this.element.getContext('2d');
    
    const chartData = {
      labels: data.map(d => d.label),
      datasets: [{
        data: data.map(d => d.value),
        backgroundColor: data.map(() => this._getNextColor()),
        borderColor: '#fff',
        borderWidth: 2
      }]
    };

    const chartOptions = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'right'
        },
        title: {
          display: true,
          text: title,
          font: { size: 14, weight: 'bold' }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const sum = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / sum) * 100).toFixed(1);
              return `${label}: ${value} (${percentage}%)`;
            }
          }
        }
      },
      ...options
    };

    this.chart = new Chart(ctx, {
      type: 'pie',
      data: chartData,
      options: chartOptions
    });
  }

  /**
   * Create radar chart
   */
  createRadarChart(title, data, options = {}) {
    this.chartType = 'radar';
    this.data = data;

    const ctx = this.element.getContext('2d');
    
    const chartData = {
      labels: data.map(d => d.label),
      datasets: [{
        label: title,
        data: data.map(d => d.value),
        borderColor: this._getNextColor(),
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    };

    const chartOptions = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        title: {
          display: true,
          text: title,
          font: { size: 14, weight: 'bold' }
        }
      },
      scales: {
        r: {
          beginAtZero: true
        }
      },
      ...options
    };

    this.chart = new Chart(ctx, {
      type: 'radar',
      data: chartData,
      options: chartOptions
    });
  }

  /**
   * Create multi-dataset line chart (for comparison)
   */
  createMultiLineChart(title, datasets, options = {}) {
    const ctx = this.element.getContext('2d');
    
    // Get all unique labels from all datasets
    const allLabels = new Set();
    datasets.forEach(ds => {
      ds.data.forEach(d => {
        allLabels.add(d.label || '');
      });
    });

    const chartData = {
      labels: Array.from(allLabels),
      datasets: datasets.map(ds => ({
        label: ds.label,
        data: ds.data.map(d => d.value),
        borderColor: this._getNextColor(),
        backgroundColor: 'rgba(0, 0, 0, 0)',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
        fill: false
      }))
    };

    const chartOptions = {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        title: {
          display: true,
          text: title,
          font: { size: 14, weight: 'bold' }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return value + 'ms';
            }
          }
        }
      },
      ...options
    };

    this.chart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: chartOptions
    });
  }

  /**
   * Add multiple data points at once
   */
  addDataPoints(points) {
    this.data.push(...points);
    
    if (this.data.length > 50) {
      this.data = this.data.slice(-50);
    }
    
    this._updateChartData(this.data);
  }

  /**
   * Export chart as image
   */
  exportAsImage() {
    if (this.chart && this.chart.canvas) {
      return this.chart.canvas.toDataURL('image/png');
    }
    return null;
  }

  /**
   * Export chart as CSV
   */
  exportAsCSV(filename = 'chart-data.csv') {
    if (!this.data || this.data.length === 0) return;

    let csv = 'Label,Value,Timestamp\n';
    this.data.forEach(d => {
      csv += `"${d.label}",${d.value},${d.timestamp || ''}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  }
}

// Export for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChartJsAdapter;
}
