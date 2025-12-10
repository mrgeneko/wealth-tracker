/**
 * Client-side WebSocket Handler for Real-time Metrics
 * Handles connection, subscription, and metric updates from server
 * 
 * Usage:
 * const wsClient = new MetricsWebSocketClient('http://localhost:3000');
 * wsClient.connect();
 * wsClient.subscribe('robinhood');
 * wsClient.on('metrics', (data) => updateDashboard(data));
 */

class MetricsWebSocketClient {
  constructor(serverUrl, options = {}) {
    this.serverUrl = serverUrl;
    this.wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws/metrics';
    this.options = {
      reconnectInterval: options.reconnectInterval || 3000,
      maxReconnectAttempts: options.maxReconnectAttempts || 10,
      heartbeatTimeout: options.heartbeatTimeout || 60000,
      ...options
    };

    this.ws = null;
    this.connected = false;
    this.subscriptions = new Set();
    this.metrics = {}; // { scraperSource: { metrics } }
    this.reconnectAttempts = 0;
    this.clientId = null;
    this.lastHeartbeat = null;
    this.heartbeatTimer = null;

    // Event listeners
    this.listeners = {
      connect: [],
      disconnect: [],
      metrics: [],
      error: [],
      status: [],
      subscribed: [],
      unsubscribed: []
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[MetricsClient] Connecting to ${this.wsUrl}`);

        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('[MetricsClient] Connected');
          this.connected = true;
          this.reconnectAttempts = 0;
          this._setupHeartbeat();
          this._emit('connect');
          resolve();
        };

        this.ws.onmessage = (event) => {
          this._handleMessage(JSON.parse(event.data));
        };

        this.ws.onerror = (error) => {
          console.error('[MetricsClient] WebSocket error:', error);
          this._emit('error', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[MetricsClient] Disconnected');
          this.connected = false;
          this._clearHeartbeat();
          this._emit('disconnect');
          this._attemptReconnect();
        };
      } catch (error) {
        console.error('[MetricsClient] Error creating WebSocket:', error);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming messages from server
   */
  _handleMessage(message) {
    try {
      switch (message.type) {
        case 'connection':
          this.clientId = message.clientId;
          console.log(`[MetricsClient] Connected with ID: ${this.clientId}`);
          break;

        case 'metrics_batch':
          this._processMetricsBatch(message);
          break;

        case 'heartbeat':
          this.lastHeartbeat = Date.now();
          break;

        case 'pong':
          this.lastHeartbeat = Date.now();
          break;

        case 'subscribed':
          console.log(`[MetricsClient] Subscribed to ${message.scraperSource}`);
          this._emit('subscribed', { scraperSource: message.scraperSource });
          break;

        case 'unsubscribed':
          console.log(`[MetricsClient] Unsubscribed from ${message.scraperSource}`);
          this._emit('unsubscribed', { scraperSource: message.scraperSource });
          break;

        case 'status':
          this._emit('status', message);
          break;

        default:
          console.warn('[MetricsClient] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[MetricsClient] Error handling message:', error);
    }
  }

  /**
   * Process batch of metrics
   */
  _processMetricsBatch(batch) {
    const { scraperSource, metrics } = batch;

    // Store metrics in memory for quick access
    if (!this.metrics[scraperSource]) {
      this.metrics[scraperSource] = [];
    }

    // Keep last 100 metrics per source in memory
    this.metrics[scraperSource].push(...metrics);
    if (this.metrics[scraperSource].length > 100) {
      this.metrics[scraperSource] = this.metrics[scraperSource].slice(-100);
    }

    // Emit event for subscribers
    this._emit('metrics', {
      scraperSource,
      count: metrics.length,
      metrics,
      timestamp: batch.timestamp
    });
  }

  /**
   * Subscribe to metrics from a scraper source
   */
  subscribe(scraperSource) {
    if (!this.connected) {
      console.warn('[MetricsClient] Not connected, cannot subscribe');
      return;
    }

    this.subscriptions.add(scraperSource);
    this.ws.send(JSON.stringify({
      type: 'subscribe',
      scraperSource
    }));

    console.log(`[MetricsClient] Subscribing to ${scraperSource}`);
  }

  /**
   * Unsubscribe from metrics
   */
  unsubscribe(scraperSource) {
    if (!this.connected) {
      console.warn('[MetricsClient] Not connected, cannot unsubscribe');
      return;
    }

    this.subscriptions.delete(scraperSource);
    this.ws.send(JSON.stringify({
      type: 'unsubscribe',
      scraperSource
    }));

    console.log(`[MetricsClient] Unsubscribing from ${scraperSource}`);
  }

  /**
   * Request client status
   */
  requestStatus() {
    if (!this.connected) {
      console.warn('[MetricsClient] Not connected');
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'get_status'
    }));
  }

  /**
   * Get stored metrics for a source
   */
  getMetrics(scraperSource) {
    return this.metrics[scraperSource] || [];
  }

  /**
   * Get recent metrics (last N) for a source
   */
  getRecentMetrics(scraperSource, count = 10) {
    const sourceMetrics = this.metrics[scraperSource] || [];
    return sourceMetrics.slice(-count);
  }

  /**
   * Setup heartbeat check
   */
  _setupHeartbeat() {
    this.lastHeartbeat = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeSinceLastHB = now - this.lastHeartbeat;

      if (timeSinceLastHB > this.options.heartbeatTimeout) {
        console.warn('[MetricsClient] Heartbeat timeout, reconnecting...');
        this.disconnect();
        this._attemptReconnect();
      } else {
        // Send ping to keep connection alive
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.options.heartbeatTimeout / 2);
  }

  /**
   * Clear heartbeat timer
   */
  _clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  _attemptReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error('[MetricsClient] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const backoffTime = this.options.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1);

    console.log(
      `[MetricsClient] Reconnecting in ${Math.round(backoffTime)}ms ` +
      `(attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('[MetricsClient] Reconnection failed:', error);
      });
    }, backoffTime);
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    this._clearHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
  }

  /**
   * Register event listener
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    } else {
      console.warn(`[MetricsClient] Unknown event: ${event}`);
    }
  }

  /**
   * Unregister event listener
   */
  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  /**
   * Emit event to all listeners
   */
  _emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[MetricsClient] Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Get connection status
   */
  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get client information
   */
  getClientInfo() {
    return {
      clientId: this.clientId,
      connected: this.isConnected(),
      subscriptions: Array.from(this.subscriptions),
      metricsSourceCount: Object.keys(this.metrics).length,
      totalMetricsStored: Object.values(this.metrics).reduce((sum, arr) => sum + arr.length, 0)
    };
  }
}

// Export for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MetricsWebSocketClient;
}
