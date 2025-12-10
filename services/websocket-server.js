/**
 * WebSocket Server for Real-time Metrics
 * Handles live streaming of scraper and scheduler metrics
 * 
 * Features:
 * - Real-time metric broadcasting to connected clients
 * - Per-scraper channel subscriptions
 * - Metric batching and throttling for performance
 * - Automatic reconnection handling
 * - Graceful shutdown with cleanup
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

class MetricsWebSocketServer extends EventEmitter {
  constructor(server, options = {}) {
    super();
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws/metrics',
      perMessageDeflate: false // Disable compression for lower latency
    });

    this.options = {
      batchInterval: options.batchInterval || 1000, // Batch metrics every 1 second
      maxBatchSize: options.maxBatchSize || 100,
      maxClients: options.maxClients || 1000,
      heartbeatInterval: options.heartbeatInterval || 30000,
      ...options
    };

    // Track connected clients and their subscriptions
    this.clients = new Map();
    this.subscriptions = new Map(); // scraperSource -> Set of clients
    this.metricsQueue = new Map(); // scraperSource -> []

    // Initialize event handlers
    this._setupHandlers();
  }

  _setupHandlers() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this._generateClientId();
      const client = {
        id: clientId,
        ws,
        subscriptions: new Set(),
        lastHeartbeat: Date.now(),
        metricsReceived: 0,
        connectedAt: new Date()
      };

      this.clients.set(clientId, client);

      console.log(`[WebSocket] Client ${clientId} connected. Total clients: ${this.clients.size}`);

      // Send welcome message
      this._send(ws, {
        type: 'connection',
        clientId,
        timestamp: Date.now(),
        message: 'Connected to metrics server'
      });

      // Setup client message handler
      ws.on('message', (data) => this._handleClientMessage(clientId, data));
      ws.on('close', () => this._handleClientDisconnect(clientId));
      ws.on('error', (error) => this._handleClientError(clientId, error));

      // Setup heartbeat
      const heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this._send(ws, {
            type: 'heartbeat',
            timestamp: Date.now()
          });
        } else {
          clearInterval(heartbeatTimer);
        }
      }, this.options.heartbeatInterval);
    });

    // Periodic batch flush
    this.flushInterval = setInterval(() => {
      this._flushMetricsBatch();
    }, this.options.batchInterval);
  }

  /**
   * Record a page navigation metric
   */
  recordPageNavigation(scraperSource, navigationData) {
    if (!this.metricsQueue.has(scraperSource)) {
      this.metricsQueue.set(scraperSource, []);
    }

    this.metricsQueue.get(scraperSource).push({
      type: 'page_navigation',
      scraperSource,
      ...navigationData,
      recordedAt: Date.now()
    });

    // Flush if batch size exceeded
    if (this.metricsQueue.get(scraperSource).length >= this.options.maxBatchSize) {
      this._flushMetricsForSource(scraperSource);
    }
  }

  /**
   * Record a page scrape metric
   */
  recordPageScrape(scraperSource, scrapeData) {
    if (!this.metricsQueue.has(scraperSource)) {
      this.metricsQueue.set(scraperSource, []);
    }

    this.metricsQueue.get(scraperSource).push({
      type: 'page_scrape',
      scraperSource,
      ...scrapeData,
      recordedAt: Date.now()
    });

    // Flush if batch size exceeded
    if (this.metricsQueue.get(scraperSource).length >= this.options.maxBatchSize) {
      this._flushMetricsForSource(scraperSource);
    }
  }

  /**
   * Record a scheduler metric
   */
  recordSchedulerMetric(schedulerName, metricData) {
    if (!this.metricsQueue.has('scheduler')) {
      this.metricsQueue.set('scheduler', []);
    }

    this.metricsQueue.get('scheduler').push({
      type: 'scheduler_metric',
      schedulerName,
      ...metricData,
      recordedAt: Date.now()
    });

    if (this.metricsQueue.get('scheduler').length >= this.options.maxBatchSize) {
      this._flushMetricsForSource('scheduler');
    }
  }

  /**
   * Flush all queued metrics
   */
  _flushMetricsBatch() {
    for (const [scraperSource, metrics] of this.metricsQueue.entries()) {
      if (metrics.length > 0) {
        this._flushMetricsForSource(scraperSource);
      }
    }
  }

  /**
   * Flush metrics for specific source
   */
  _flushMetricsForSource(scraperSource) {
    const metrics = this.metricsQueue.get(scraperSource);
    if (!metrics || metrics.length === 0) return;

    // Get all subscribers for this source
    const subscribers = this.subscriptions.get(scraperSource) || new Set();
    if (subscribers.size === 0) return; // No one listening

    const batch = {
      type: 'metrics_batch',
      scraperSource,
      count: metrics.length,
      metrics,
      timestamp: Date.now()
    };

    // Send to all subscribed clients
    subscribers.forEach(clientId => {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        this._send(client.ws, batch);
        client.metricsReceived += metrics.length;
      }
    });

    // Clear the queue
    this.metricsQueue.set(scraperSource, []);
  }

  /**
   * Handle client message (subscriptions, etc.)
   */
  _handleClientMessage(clientId, data) {
    try {
      const client = this.clients.get(clientId);
      if (!client) return;

      const message = JSON.parse(data);

      switch (message.type) {
        case 'subscribe':
          this._handleSubscribe(clientId, message.scraperSource);
          break;

        case 'unsubscribe':
          this._handleUnsubscribe(clientId, message.scraperSource);
          break;

        case 'ping':
          this._send(client.ws, {
            type: 'pong',
            clientId,
            timestamp: Date.now()
          });
          break;

        case 'get_status':
          this._sendClientStatus(clientId);
          break;

        default:
          console.warn(`[WebSocket] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[WebSocket] Error handling client message:`, error);
    }
  }

  /**
   * Handle subscription request
   */
  _handleSubscribe(clientId, scraperSource) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscriptions.add(scraperSource);

    if (!this.subscriptions.has(scraperSource)) {
      this.subscriptions.set(scraperSource, new Set());
    }
    this.subscriptions.get(scraperSource).add(clientId);

    console.log(
      `[WebSocket] Client ${clientId} subscribed to ${scraperSource}. ` +
      `Total subscribers: ${this.subscriptions.get(scraperSource).size}`
    );

    // Send confirmation
    this._send(client.ws, {
      type: 'subscribed',
      scraperSource,
      timestamp: Date.now()
    });
  }

  /**
   * Handle unsubscription request
   */
  _handleUnsubscribe(clientId, scraperSource) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscriptions.delete(scraperSource);

    const subscribers = this.subscriptions.get(scraperSource);
    if (subscribers) {
      subscribers.delete(clientId);
      if (subscribers.size === 0) {
        this.subscriptions.delete(scraperSource);
        console.log(`[WebSocket] No more subscribers for ${scraperSource}`);
      }
    }

    this._send(client.ws, {
      type: 'unsubscribed',
      scraperSource,
      timestamp: Date.now()
    });
  }

  /**
   * Send client status information
   */
  _sendClientStatus(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    this._send(client.ws, {
      type: 'status',
      clientId,
      subscriptions: Array.from(client.subscriptions),
      metricsReceived: client.metricsReceived,
      connectedDuration: Date.now() - client.connectedAt.getTime(),
      serverClients: this.clients.size,
      timestamp: Date.now()
    });
  }

  /**
   * Handle client disconnect
   */
  _handleClientDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from all subscriptions
    client.subscriptions.forEach(scraperSource => {
      const subscribers = this.subscriptions.get(scraperSource);
      if (subscribers) {
        subscribers.delete(clientId);
        if (subscribers.size === 0) {
          this.subscriptions.delete(scraperSource);
        }
      }
    });

    this.clients.delete(clientId);

    console.log(
      `[WebSocket] Client ${clientId} disconnected. ` +
      `Total clients: ${this.clients.size}. ` +
      `Metrics received: ${client.metricsReceived}`
    );
  }

  /**
   * Handle client error
   */
  _handleClientError(clientId, error) {
    console.error(`[WebSocket] Client ${clientId} error:`, error.message);
  }

  /**
   * Send message to client
   */
  _send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(data) {
    const message = JSON.stringify(data);
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Get server statistics
   */
  getStats() {
    const stats = {
      connectedClients: this.clients.size,
      subscriptions: {},
      metrics: {},
      memory: process.memoryUsage()
    };

    // Count subscriptions per source
    this.subscriptions.forEach((clients, source) => {
      stats.subscriptions[source] = clients.size;
    });

    // Count queued metrics
    this.metricsQueue.forEach((metrics, source) => {
      stats.metrics[source] = metrics.length;
    });

    return stats;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('[WebSocket] Shutting down server...');

    clearInterval(this.flushInterval);

    // Flush any remaining metrics
    this._flushMetricsBatch();

    // Close all client connections
    const closePromises = Array.from(this.clients.values()).map(client => {
      return new Promise(resolve => {
        client.ws.close(1000, 'Server shutdown');
        client.ws.on('close', resolve);
      });
    });

    await Promise.all(closePromises);

    // Close WebSocket server
    return new Promise(resolve => {
      this.wss.close(() => {
        console.log('[WebSocket] Server shutdown complete');
        resolve();
      });
    });
  }

  /**
   * Generate unique client ID
   */
  _generateClientId() {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = MetricsWebSocketServer;
