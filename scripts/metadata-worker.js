#!/usr/bin/env node

/**
 * PM2 Metadata Worker
 * 
 * Continuously processes queued symbols from symbol_registry table.
 * Replaces cron jobs and populate_securities_metadata.js scripts.
 * 
 * Usage:
 *   pm2 start scripts/metadata-worker.js --name "metadata-worker"
 *   pm2 stop metadata-worker
 *   pm2 logs metadata-worker
 */

// Load dotenv if available (optional, environment variables can be passed via Docker)
try {
    require('dotenv').config();
} catch (e) {
    // dotenv not available, use environment variables directly
}

const mysql = require('mysql2/promise');
const path = require('path');

// Debug flag - set via environment variable
const DEBUG = process.env.METADATA_WORKER_DEBUG === 'true' || process.env.DEBUG === 'true';

function debug(...args) {
    if (DEBUG) {
        console.log('[MetadataWorker:DEBUG]', new Date().toISOString(), ...args);
    }
}

// Import services
// Services are installed at /services/ in Docker, or ../services/ in local dev
const serviceBasePath = process.env.NODE_ENV === 'development' 
    ? path.join(__dirname, '../services')
    : '/services';

debug('Loading services from:', serviceBasePath);

const YahooMetadataPopulator = require(path.join(serviceBasePath, 'symbol-registry/yahoo_metadata_populator.js'));
const SymbolRegistryService = require(path.join(serviceBasePath, 'symbol-registry/symbol_registry_service.js'));

// Try to load yahoo-finance2 for the Yahoo client (v3 API)
let yahooFinance = null;
try {
    const YahooFinanceClass = require('yahoo-finance2').default || require('yahoo-finance2');
    // v3 requires instantiation
    yahooFinance = new YahooFinanceClass({
        suppressNotices: ['yahooSurvey', 'rippieTip']
    });
    debug('yahoo-finance2 v3 loaded and instantiated successfully');
} catch (e) {
    console.warn('[MetadataWorker] yahoo-finance2 not available:', e.message);
}

/**
 * Minimal Yahoo Finance client wrapper
 * Uses yahoo-finance2 if available, otherwise returns null metadata
 */
class YahooFinanceClient {
    constructor() {
        this.quoteSummaryModules = ['assetProfile', 'summaryDetail', 'price', 'defaultKeyStatistics'];
    }
    
    async getMetadata(ticker) {
        if (!yahooFinance) {
            debug(`[YahooClient] No yahoo-finance2 available, skipping ${ticker}`);
            return null;
        }
        
        try {
            debug(`[YahooClient] Fetching metadata for ${ticker}...`);
            const result = await yahooFinance.quoteSummary(ticker, {
                modules: this.quoteSummaryModules
            });
            
            if (!result) {
                debug(`[YahooClient] No result for ${ticker}`);
                return null;
            }
            
            // Extract relevant fields from quoteSummary
            const price = result.price || {};
            const summaryDetail = result.summaryDetail || {};
            const defaultKeyStatistics = result.defaultKeyStatistics || {};
            
            const metadata = {
                shortName: price.shortName,
                longName: price.longName,
                currency: price.currency,
                exchange: price.exchange,
                exchangeName: price.exchangeName,
                marketCap: price.marketCap,
                quoteType: price.quoteType,
                trailingPE: summaryDetail.trailingPE,
                forwardPE: summaryDetail.forwardPE,
                dividendYield: summaryDetail.dividendYield,
                dividendRate: summaryDetail.dividendRate,
                beta: summaryDetail.beta,
                fiftyTwoWeekHigh: summaryDetail.fiftyTwoWeekHigh,
                fiftyTwoWeekLow: summaryDetail.fiftyTwoWeekLow,
                trailingEps: defaultKeyStatistics.trailingEps,
                priceToBook: defaultKeyStatistics.priceToBook
            };
            
            debug(`[YahooClient] Got metadata for ${ticker}:`, metadata.shortName || metadata.longName);
            return metadata;
        } catch (error) {
            debug(`[YahooClient] Error fetching ${ticker}:`, error.message);
            throw error;
        }
    }
}

class MetadataWorker {
    constructor() {
        this.isShuttingDown = false;
        this.dbPool = null;
        this.populator = null;
        this.currentRunning = false;
        
        // Configuration
        this.config = {
            // How often to check for new queued symbols (1 minute)
            checkIntervalMs: parseInt(process.env.METADATA_WORKER_CHECK_INTERVAL_MS || '60000', 10),
            
            // Max symbols to process per batch
            maxSymbolsPerRun: parseInt(process.env.METADATA_WORKER_MAX_PER_RUN || '500', 10),
            
            // Wait time when no symbols found (5 minutes)
            idleWaitMs: parseInt(process.env.METADATA_WORKER_IDLE_WAIT_MS || '300000', 10),
            
            // Enable startup processing
            processOnStartup: process.env.METADATA_WORKER_STARTUP !== 'false'
        };
        
        console.log('[MetadataWorker] Configuration:', this.config);
        
        // Handle graceful shutdown
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.on('uncaughtException', (error) => {
            console.error('[MetadataWorker] Uncaught exception:', error);
            this.gracefulShutdown('uncaughtException');
        });
    }
    
    /**
     * Initialize database connection and services
     */
    async initialize() {
        console.log('[MetadataWorker] Initializing...');
        debug('DEBUG mode enabled - verbose logging active');
        
        try {
            // Create database pool
            const dbConfig = {
                host: process.env.MYSQL_HOST || 'localhost',
                port: parseInt(process.env.MYSQL_PORT || '3306'),
                user: process.env.MYSQL_USER || 'root',
                password: process.env.MYSQL_PASSWORD || '',
                database: process.env.MYSQL_DATABASE || 'wealth_tracker',
                waitForConnections: true,
                connectionLimit: 5,
                queueLimit: 0
            };
            
            debug('Database config:', { ...dbConfig, password: '***' });
            
            this.dbPool = mysql.createPool(dbConfig);
            
            console.log('[MetadataWorker] Database pool created');
            
            // Test database connection
            const connection = await this.dbPool.getConnection();
            await connection.ping();
            connection.release();
            
            console.log('[MetadataWorker] Database connection verified');
            
            // Initialize dependencies for YahooMetadataPopulator
            const symbolRegistryService = new SymbolRegistryService(this.dbPool);
            const yahooFinanceClient = new YahooFinanceClient();
            
            debug('SymbolRegistryService initialized');
            debug('YahooFinanceClient initialized, yahoo-finance2 available:', !!yahooFinance);
            
            // Initialize metadata populator with proper dependencies
            this.populator = new YahooMetadataPopulator(
                this.dbPool, 
                symbolRegistryService, 
                yahooFinanceClient
            );
            
            console.log('[MetadataWorker] YahooMetadataPopulator initialized');
            
            return true;
        } catch (error) {
            console.error('[MetadataWorker] Initialization failed:', error);
            throw error;
        }
    }
    
    /**
     * Get count of symbols needing metadata
     */
    async getQueuedSymbolsCount() {
        const connection = await this.dbPool.getConnection();
        try {
            const [rows] = await connection.execute(`
                SELECT COUNT(*) as count
                FROM symbol_registry 
                WHERE has_yahoo_metadata = 0
                AND security_type IN ('EQUITY', 'ETF', 'MUTUAL_FUND')
            `);
            return rows[0].count;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Process a batch of queued symbols
     */
    async processBatch() {
        if (this.currentRunning) {
            console.log('[MetadataWorker] Already processing, skipping...');
            return { status: 'skipped', reason: 'already_running' };
        }
        
        try {
            this.currentRunning = true;
            debug('Starting batch processing...');
            
            const queuedCount = await this.getQueuedSymbolsCount();
            debug(`Queued symbols count: ${queuedCount}`);
            
            if (queuedCount === 0) {
                console.log('[MetadataWorker] No symbols in queue');
                return { status: 'idle', queued_count: 0 };
            }
            
            console.log(`[MetadataWorker] Processing batch: ${queuedCount} symbols queued, max ${this.config.maxSymbolsPerRun}`);
            debug('Calling populator.populateMetadata...');
            
            const startTime = Date.now();
            const result = await this.populator.populateMetadata(this.config.maxSymbolsPerRun);
            const duration = Date.now() - startTime;
            
            console.log(`[MetadataWorker] Batch complete:`, {
                duration_ms: duration,
                duration_min: Math.round(duration / 60000 * 100) / 100,
                ...result
            });
            
            debug('Batch result details:', JSON.stringify(result, null, 2));
            
            return {
                status: 'completed',
                duration_ms: duration,
                ...result
            };
            
        } catch (error) {
            console.error('[MetadataWorker] Error processing batch:', error);
            debug('Error stack:', error.stack);
            return {
                status: 'error',
                error: error.message
            };
        } finally {
            this.currentRunning = false;
        }
    }
    
    /**
     * Main worker loop
     */
    async run() {
        console.log('[MetadataWorker] Starting worker loop...');
        
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5;
        
        while (!this.isShuttingDown) {
            try {
                const result = await this.processBatch();
                
                // Reset error counter on success
                if (result.status === 'completed') {
                    consecutiveErrors = 0;
                }
                
                // Determine wait time
                let waitTime = this.config.checkIntervalMs;
                
                if (result.status === 'idle') {
                    // No symbols to process, wait longer
                    waitTime = this.config.idleWaitMs;
                    console.log(`[MetadataWorker] Queue empty, waiting ${waitTime/1000}s...`);
                } else if (result.status === 'error') {
                    consecutiveErrors++;
                    // Exponential backoff on errors
                    waitTime = Math.min(this.config.checkIntervalMs * Math.pow(2, consecutiveErrors), 300000);
                    console.log(`[MetadataWorker] Error #${consecutiveErrors}, waiting ${waitTime/1000}s...`);
                    
                    if (consecutiveErrors >= maxConsecutiveErrors) {
                        console.error('[MetadataWorker] Too many consecutive errors, shutting down');
                        break;
                    }
                } else {
                    console.log(`[MetadataWorker] Next check in ${waitTime/1000}s...`);
                }
                
                // Wait before next iteration
                await this.sleep(waitTime);
                
            } catch (error) {
                console.error('[MetadataWorker] Unexpected error in main loop:', error);
                consecutiveErrors++;
                
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    console.error('[MetadataWorker] Too many errors, shutting down');
                    break;
                }
                
                await this.sleep(this.config.checkIntervalMs * consecutiveErrors);
            }
        }
        
        console.log('[MetadataWorker] Worker loop ended');
    }
    
    /**
     * Start the metadata worker
     */
    async start() {
        try {
            console.log('[MetadataWorker] Starting...');
            
            await this.initialize();
            
            if (this.config.processOnStartup) {
                console.log('[MetadataWorker] Running initial batch on startup...');
                await this.processBatch();
            }
            
            // Start main worker loop
            await this.run();
            
        } catch (error) {
            console.error('[MetadataWorker] Failed to start:', error);
            process.exit(1);
        }
    }
    
    /**
     * Graceful shutdown
     */
    async gracefulShutdown(signal) {
        console.log(`[MetadataWorker] Received ${signal}, shutting down gracefully...`);
        
        this.isShuttingDown = true;
        
        // Wait for current batch to complete
        let waitCount = 0;
        while (this.currentRunning && waitCount < 30) {
            console.log('[MetadataWorker] Waiting for current batch to complete...');
            await this.sleep(1000);
            waitCount++;
        }
        
        // Close database pool
        if (this.dbPool) {
            console.log('[MetadataWorker] Closing database pool...');
            await this.dbPool.end();
        }
        
        console.log('[MetadataWorker] Shutdown complete');
        process.exit(0);
    }
    
    /**
     * Utility: Sleep for specified milliseconds
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Start the worker if this file is run directly
if (require.main === module) {
    const worker = new MetadataWorker();
    worker.start().catch(error => {
        console.error('[MetadataWorker] Fatal error:', error);
        process.exit(1);
    });
}

module.exports = MetadataWorker;