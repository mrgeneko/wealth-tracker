/**
 * Unit Tests for WebSocket Metrics System (Phase 9.2)
 * 
 * Test coverage:
 * - WebSocket server initialization and configuration
 * - Client connections and disconnections
 * - Subscription/unsubscription logic
 * - Metric recording and batching
 * - Real-time metric broadcasting
 * - Database persistence
 * - Error handling and recovery
 * - Graceful shutdown
 */

const http = require('http');
const WebSocket = require('ws');
const MetricsWebSocketServer = require('../services/websocket-server');
const ScraperMetricsCollector = require('../services/scraper-metrics-collector');

describe('WebSocket Metrics System - Phase 9.2', () => {

  // =========================================================================
  // Test Suite: MetricsWebSocketServer
  // =========================================================================

  describe('MetricsWebSocketServer', () => {
    let server;
    let metricsWS;

    beforeEach(() => {
      server = http.createServer();
      metricsWS = new MetricsWebSocketServer(server, {
        batchInterval: 100,
        maxBatchSize: 10
      });
    });

    afterEach(async () => {
      await metricsWS.shutdown();
      await new Promise((resolve) => {
        if (server.listening) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    });

    test('should initialize with default options', () => {
      // The server doesn't need to be listening for basic property checks
      expect(metricsWS).toBeDefined();
      expect(metricsWS.wss).toBeDefined();
      expect(metricsWS.clients).toBeInstanceOf(Map);
      expect(metricsWS.subscriptions).toBeInstanceOf(Map);
      expect(metricsWS.metricsQueue).toBeInstanceOf(Map);
    });

    test('should initialize with custom options', () => {
      const customWS = new MetricsWebSocketServer(server, {
        batchInterval: 5000,
        maxBatchSize: 500,
        maxClients: 100
      });

      expect(customWS.options.batchInterval).toBe(5000);
      expect(customWS.options.maxBatchSize).toBe(500);
      expect(customWS.options.maxClients).toBe(100);
    });

    test('should provide server statistics', () => {
      const stats = metricsWS.getStatistics();
      expect(stats).toBeDefined();
      expect(stats.connectedClients).toBe(0);
      expect(stats.subscriptions).toBeDefined();
    });

    test('should handle client connections', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);

        let connectedMessage = false;

        client.on('open', () => {
          expect(metricsWS.clients.size).toBeGreaterThan(0);
        });

        client.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'connection') {
            expect(msg.clientId).toBeDefined();
            expect(msg.clientId).toMatch(/^client-/);
            connectedMessage = true;
            client.close();
          }
        });

        client.on('close', () => {
          expect(connectedMessage).toBe(true);
          // Give the server a moment to recognize the connection has closed
          setTimeout(() => {
            expect(metricsWS.clients.size).toBe(0);
            done();
          }, 100);
        });
      });
    });

    test('should handle subscription requests', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);

        client.on('message', (data) => {
          const msg = JSON.parse(data);

          if (msg.type === 'connection') {
            client.send(JSON.stringify({
              type: 'subscribe',
              scraperSource: 'robinhood'
            }));
          } else if (msg.type === 'subscribed') {
            expect(msg.scraperSource).toBe('robinhood');
            expect(metricsWS.subscriptions.has('robinhood')).toBe(true);
            client.close();
            done();
          }
        });
      });
    });

    test('should handle multiple subscriptions per client', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);

        const subscribed = [];

        client.on('message', (data) => {
          const msg = JSON.parse(data);

          if (msg.type === 'connection') {
            client.send(JSON.stringify({
              type: 'subscribe',
              scraperSource: 'robinhood'
            }));
            client.send(JSON.stringify({
              type: 'subscribe',
              scraperSource: 'cnbc'
            }));
          } else if (msg.type === 'subscribed') {
            subscribed.push(msg.scraperSource);

            if (subscribed.length === 2) {
              expect(subscribed).toContain('robinhood');
              expect(subscribed).toContain('cnbc');
              client.close();
              done();
            }
          }
        });
      });
    });

    test('should handle unsubscription requests', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);

        let unsubscribed = false;

        client.on('message', (data) => {
          const msg = JSON.parse(data);

          if (msg.type === 'connection') {
            client.send(JSON.stringify({
              type: 'subscribe',
              scraperSource: 'robinhood'
            }));
          } else if (msg.type === 'subscribed' && !unsubscribed) {
            unsubscribed = true;
            client.send(JSON.stringify({
              type: 'unsubscribe',
              scraperSource: 'robinhood'
            }));
          } else if (msg.type === 'unsubscribed') {
            expect(metricsWS.subscriptions.has('robinhood')).toBe(false);
            client.close();
            done();
          }
        });
      });
    });

    test('should broadcast metrics to subscribed clients', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);

        let subscribed = false;
        let metricsReceived = false;

        client.on('message', (data) => {
          const msg = JSON.parse(data);

          if (msg.type === 'connection') {
            client.send(JSON.stringify({
              type: 'subscribe',
              scraperSource: 'robinhood'
            }));
          } else if (msg.type === 'subscribed') {
            subscribed = true;

            // Record metrics
            metricsWS.recordPageNavigation('robinhood', {
              url: 'https://example.com',
              navigationDurationMs: 100,
              success: true
            });
          } else if (msg.type === 'metrics_batch' && subscribed) {
            expect(msg.scraperSource).toBe('robinhood');
            expect(msg.metrics.length).toBeGreaterThan(0);
            metricsReceived = true;
            client.close();
          }
        });

        client.on('close', () => {
          expect(metricsReceived).toBe(true);
          done();
        });
      });
    });

    test('should not broadcast to unsubscribed clients', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);

        let metricsReceived = false;

        const timeout = setTimeout(() => {
          expect(metricsReceived).toBe(false);
          client.close();
          done();
        }, 500);

        client.on('message', (data) => {
          const msg = JSON.parse(data);

          if (msg.type === 'metrics_batch') {
            metricsReceived = true;
            clearTimeout(timeout);
            client.close();
            done();
          }
        });

        // Record metrics without subscribing
        metricsWS.recordPageNavigation('robinhood', {
          url: 'https://example.com',
          navigationDurationMs: 100,
          success: true
        });
      });
    });

    test('should track connected client count', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const clients = [];

        // Create 3 clients
        for (let i = 0; i < 3; i++) {
          const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);
          clients.push(client);
        }

        setTimeout(() => {
          expect(metricsWS.clients.size).toBe(3);

          // Close one client
          clients[0].close();

          setTimeout(() => {
            expect(metricsWS.clients.size).toBe(2);

            // Close remaining clients
            clients[1].close();
            clients[2].close();

            setTimeout(() => {
              expect(metricsWS.clients.size).toBe(0);
              done();
            }, 100);
          }, 100);
        }, 100);
      });
    });

    test('should provide server statistics', () => {
      metricsWS.recordPageNavigation('robinhood', {
        url: 'https://example.com',
        navigationDurationMs: 100,
        success: true
      });

      const stats = metricsWS.getStats();

      expect(stats.connectedClients).toBe(0);
      expect(stats.subscriptions).toBeDefined();
      expect(stats.metrics).toBeDefined();
      expect(stats.metrics.robinhood).toBe(1);
    });
  });

  // =========================================================================
  // Test Suite: ScraperMetricsCollector
  // =========================================================================

  describe('ScraperMetricsCollector', () => {
    let collector;
    let wsServer;
    let server;

    beforeEach(() => {
      server = http.createServer();
      wsServer = new MetricsWebSocketServer(server, {
        batchInterval: 100,
        maxBatchSize: 10
      });
      collector = new ScraperMetricsCollector(wsServer, {
        batchSize: 5,
        flushInterval: 100
      });
    });

    afterEach(async () => {
      await collector.shutdown();
      await wsServer.shutdown();
    });

    test('should initialize with default options', () => {
      expect(collector).toBeDefined();
      expect(collector.navigationMetrics).toEqual([]);
      expect(collector.scrapeMetrics).toEqual([]);
      expect(collector.schedulerMetrics).toEqual([]);
    });

    test('should record navigation metrics', () => {
      const metric = collector.recordPageNavigation('robinhood', {
        url: 'https://robinhood.com/stocks/AAPL',
        navigationDurationMs: 150,
        retryCount: 1,
        success: true
      });

      expect(metric).toBeDefined();
      expect(metric.scraperSource).toBe('robinhood');
      expect(metric.navigationDurationMs).toBe(150);
      expect(metric.retryCount).toBe(1);
      expect(metric.success).toBe(true);
    });

    test('should record scrape metrics', () => {
      const metric = collector.recordPageScrape('cnbc', {
        url: 'https://cnbc.com/quotes/AAPL',
        scrapeDurationMs: 200,
        itemsExtracted: 15,
        success: true,
        dataSize: 5000
      });

      expect(metric).toBeDefined();
      expect(metric.scraperSource).toBe('cnbc');
      expect(metric.scrapeDurationMs).toBe(200);
      expect(metric.itemsExtracted).toBe(15);
      expect(metric.dataSize).toBe(5000);
    });

    test('should record scheduler metrics', () => {
      const metric = collector.recordSchedulerMetric('symbol-refresh', {
        executionDurationMs: 500,
        itemsProcessed: 100,
        success: true
      });

      expect(metric).toBeDefined();
      expect(metric.schedulerName).toBe('symbol-refresh');
      expect(metric.executionDurationMs).toBe(500);
      expect(metric.itemsProcessed).toBe(100);
    });

    test('should batch metrics in memory', () => {
      for (let i = 0; i < 3; i++) {
        collector.recordPageNavigation('robinhood', {
          url: `https://example.com/${i}`,
          navigationDurationMs: 100 + i,
          success: true
        });
      }

      expect(collector.navigationMetrics.length).toBe(3);
    });

    test('should auto-flush when batch size exceeded', async () => {
      // Record 4 metrics (batch size is 5, should not flush yet)
      for (let i = 0; i < 4; i++) {
        collector.recordPageNavigation('robinhood', {
          url: `https://example.com/${i}`,
          navigationDurationMs: 100,
          success: true
        });
      }

      expect(collector.navigationMetrics.length).toBe(4);

      // 5th metric should trigger flush
      collector.recordPageNavigation('robinhood', {
        url: 'https://example.com/4',
        navigationDurationMs: 100,
        success: true
      });

      // Auto-flush happens synchronously when batchSize is exceeded
      expect(collector.navigationMetrics.length).toBe(0);
    });

    test('should broadcast metrics to WebSocket on record', () => {
      const recordSpy = jest.spyOn(wsServer, 'recordPageNavigation');

      collector.recordPageNavigation('robinhood', {
        url: 'https://example.com',
        navigationDurationMs: 100,
        success: true
      });

      expect(recordSpy).toHaveBeenCalled();
      recordSpy.mockRestore();
    });

    test('should provide metrics statistics', async () => {
      collector.recordPageNavigation('robinhood', {
        url: 'https://example.com',
        navigationDurationMs: 100,
        success: true
      });

      collector.recordPageScrape('cnbc', {
        url: 'https://example.com',
        scrapeDurationMs: 200,
        itemsExtracted: 10,
        success: true
      });

      const stats = await collector.getMetricsStats();

      expect(stats.pendingNavigation).toBe(1);
      expect(stats.pendingScrape).toBe(1);
      expect(stats.totalPending).toBe(2);
    });
  });

  // =========================================================================
  // Test Suite: Integration Tests
  // =========================================================================

  describe('Integration Tests', () => {
    let server;
    let metricsWS;
    let collector;

    beforeEach(() => {
      server = http.createServer();
      metricsWS = new MetricsWebSocketServer(server, {
        batchInterval: 100,
        maxBatchSize: 20
      });
      collector = new ScraperMetricsCollector(metricsWS, {
        batchSize: 10,
        flushInterval: 100
      });
    });

    afterEach(async () => {
      await collector.shutdown();
      await metricsWS.shutdown();
    });

    test('should enable end-to-end metrics flow', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);

        let clientId = null;
        let metricsReceived = false;

        client.on('message', (data) => {
          const msg = JSON.parse(data);

          if (msg.type === 'connection') {
            clientId = msg.clientId;

            // Subscribe to robinhood metrics
            client.send(JSON.stringify({
              type: 'subscribe',
              scraperSource: 'robinhood'
            }));
          } else if (msg.type === 'subscribed') {
            // Now record metrics
            collector.recordPageNavigation('robinhood', {
              url: 'https://robinhood.com/stocks/AAPL',
              navigationDurationMs: 150,
              success: true
            });

            collector.recordPageScrape('robinhood', {
              url: 'https://robinhood.com/stocks/AAPL',
              scrapeDurationMs: 200,
              itemsExtracted: 5,
              success: true
            });
          } else if (msg.type === 'metrics_batch' && msg.scraperSource === 'robinhood') {
            expect(msg.metrics.length).toBeGreaterThan(0);
            metricsReceived = true;
            client.close();
          }
        });

        client.on('close', () => {
          expect(metricsReceived).toBe(true);
          done();
        });
      });
    });

    test('should handle multiple concurrent metrics from different scrapers', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);

        const received = new Map();

        client.on('message', (data) => {
          const msg = JSON.parse(data);

          if (msg.type === 'connection') {
            // Subscribe to multiple sources
            client.send(JSON.stringify({
              type: 'subscribe',
              scraperSource: 'robinhood'
            }));
            client.send(JSON.stringify({
              type: 'subscribe',
              scraperSource: 'cnbc'
            }));
            client.send(JSON.stringify({
              type: 'subscribe',
              scraperSource: 'webull'
            }));
          } else if (msg.type === 'subscribed') {
            // Record metrics from all sources
            if (msg.scraperSource === 'robinhood') {
              collector.recordPageNavigation('robinhood', {
                url: 'https://robinhood.com',
                navigationDurationMs: 100,
                success: true
              });
            } else if (msg.scraperSource === 'cnbc') {
              collector.recordPageNavigation('cnbc', {
                url: 'https://cnbc.com',
                navigationDurationMs: 110,
                success: true
              });
            } else if (msg.scraperSource === 'webull') {
              collector.recordPageNavigation('webull', {
                url: 'https://webull.com',
                navigationDurationMs: 120,
                success: true
              });
            }
          } else if (msg.type === 'metrics_batch') {
            const source = msg.scraperSource;
            if (!received.has(source)) {
              received.set(source, true);
            }

            if (received.size === 3) {
              expect(received.has('robinhood')).toBe(true);
              expect(received.has('cnbc')).toBe(true);
              expect(received.has('webull')).toBe(true);
              client.close();
            }
          }
        });

        client.on('close', () => {
          expect(received.size).toBe(3);
          done();
        });
      });
    });
  });

  // =========================================================================
  // Test Suite: Error Handling
  // =========================================================================

  describe('Error Handling', () => {
    let server;
    let metricsWS;

    beforeEach(() => {
      server = http.createServer();
      metricsWS = new MetricsWebSocketServer(server);
    });

    afterEach(async () => {
      await metricsWS.shutdown();
    });

    test('should handle invalid messages gracefully', (done) => {
      server.listen(0, () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://localhost:${port}/ws/metrics`);

        client.on('open', () => {
          // Send invalid JSON
          client.send('invalid json');

          // Send valid message afterwards
          client.send(JSON.stringify({
            type: 'ping'
          }));
        });

        let pongReceived = false;

        client.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'pong') {
            pongReceived = true;
            client.close();
          }
        });

        client.on('close', () => {
          expect(pongReceived).toBe(true);
          done();
        });
      });
    });

    test('should handle missing database connections gracefully', async () => {
      const collector = new ScraperMetricsCollector(metricsWS, {
        batchSize: 1,
        flushInterval: 10000
      });

      // Record a metric but don't provide DB connection
      const metric = collector.recordPageNavigation('robinhood', {
        url: 'https://example.com',
        navigationDurationMs: 100,
        success: true
      });

      expect(metric).toBeDefined();

      await collector.shutdown();
    });
  });

});
