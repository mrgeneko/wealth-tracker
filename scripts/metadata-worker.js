#!/usr/bin/env node

/**
 * PM2 Metadata Worker
 * 
 * Continuously processes queued symbols from ticker_registry table.
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
const fs = require('fs');

// Log file configuration - use same directory as scrapers
const LOG_DIR = process.env.LOG_DIR || '/usr/src/app/logs';
let logFilePath = null;

/**
 * Get or create the log file path for this worker session
 */
function getLogFilePath() {
    if (!logFilePath) {
        // Create log directory if it doesn't exist
        try {
            if (!fs.existsSync(LOG_DIR)) {
                fs.mkdirSync(LOG_DIR, { recursive: true });
            }
        } catch (e) {
            // Fall back to current directory
        }
        
        // Use date and time-based log file name (YYYY-MM-DD.HH-mm)
        const date = new Date();
        const isoStr = date.toISOString(); // 2025-12-10T22:43:15.123Z
        const dateStr = isoStr.split('T')[0]; // YYYY-MM-DD
        const timeStr = isoStr.split('T')[1].substring(0, 5).replace(':', '-'); // HH-mm
        logFilePath = path.join(LOG_DIR, `metadata_worker.${dateStr}.${timeStr}.log`);
    }
    return logFilePath;
}

/**
 * Write log message to file
 */
function log(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `${timestamp} [MetadataWorker:${level}] ${message}\n`;
    
    // Write to file
    try {
        fs.appendFileSync(getLogFilePath(), line);
    } catch (e) {
        // Fall back to console if file write fails
        console.error('Log file write failed:', e.message);
    }
    
    // Also write to console for Docker logs
    if (level === 'ERROR') {
        console.error(line.trim());
    } else {
        console.log(line.trim());
    }
}

// Debug flag - set via environment variable
const DEBUG = process.env.METADATA_WORKER_DEBUG === 'true' || process.env.DEBUG === 'true';

function debug(...args) {
    if (DEBUG) {
        log('DEBUG', ...args);
    }
}

// Import services
// Services are installed at /services/ in Docker, or ../services/ in local dev
const serviceBasePath = process.env.NODE_ENV === 'development' 
    ? path.join(__dirname, '../services')
    : '/app/services';

const YahooMetadataPopulator = require(path.join(serviceBasePath, 'symbol-registry/yahoo_metadata_populator.js'));
const SymbolRegistryService = require(path.join(serviceBasePath, 'symbol-registry/ticker_registry_service.js'));

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
    log('WARN', 'yahoo-finance2 not available:', e.message);
}

/**
 * Minimal Yahoo Finance client wrapper
 * Uses yahoo-finance2 if available, otherwise returns null metadata
 * 
 * Special error handling:
 * - Schema validation errors: marked as PERMANENT (delisted/acquired securities)
 * - Quote not found: marked as PERMANENT (invalid ticker or delisted)
 * - Other errors: treated as transient (network, rate limit, etc)
 */
class YahooFinanceClient {
    constructor() {
        this.quoteSummaryModules = ['assetProfile', 'summaryDetail', 'price', 'defaultKeyStatistics'];
        // Tickers that have permanently failed (delisted, acquired, or invalid)
        this.permanentFailures = new Set();
    }
    
    async getMetadata(ticker) {
        if (!yahooFinance) {
            debug(`[YahooClient] No yahoo-finance2 available, skipping ${ticker}`);
            return null;
        }
        
        // Check if this ticker has already permanently failed
        if (this.permanentFailures.has(ticker)) {
            const error = new Error('Permanently failed: ticker is delisted, acquired, or has invalid data structure');
            error.isPermanentFailure = true;
            throw error;
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
            // Detect permanent failures
            if (this.isPermamentFailure(error)) {
                this.permanentFailures.add(ticker);
                error.isPermanentFailure = true;
                log('WARN', `[YahooClient] Permanent failure for ${ticker}: ${error.message} (will not retry)`);
                throw error;
            }
            
            debug(`[YahooClient] Error fetching ${ticker}:`, error.message);
            throw error;
        }
    }
    
    /**
     * Determine if an error is permanent (won't be resolved by retrying)
     */
    isPermamentFailure(error) {
        const msg = error.message || '';
        
        // Schema validation errors = ticker has incomplete/malformed data
        if (msg.includes('Failed Yahoo Schema validation')) {
            return true;
        }
        
        // Quote not found = invalid ticker or delisted
        if (msg.includes('Quote not found for symbol')) {
            return true;
        }
        
        // Invalid ticker symbol
        if (msg.includes('No result')) {
            return true;
        }
        
        return false;
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
            
            // Wait time when no symbols found (60 minutes)
            idleWaitMs: parseInt(process.env.METADATA_WORKER_IDLE_WAIT_MS || '3600000', 10),
            
            // Enable startup processing
            processOnStartup: process.env.METADATA_WORKER_STARTUP !== 'false'
        };
        
        log('INFO', 'Configuration:', this.config);
        
        // Handle graceful shutdown
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.on('uncaughtException', (error) => {
            log('ERROR', 'Uncaught exception:', error);
            this.gracefulShutdown('uncaughtException');
        });
    }
    
    /**
     * Initialize database connection and services
     */
    async initialize() {
        log('INFO', 'Initializing...');
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
            
            log('INFO', 'Database pool created');
            
            // Test database connection
            const connection = await this.dbPool.getConnection();
            await connection.ping();
            connection.release();
            
            log('INFO', 'Database connection verified');
            
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
            
            log('INFO', 'YahooMetadataPopulator initialized');
            
            return true;
        } catch (error) {
            log('ERROR', 'Initialization failed:', error);
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
                FROM ticker_registry 
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
            log('INFO', 'Already processing, skipping...');
            return { status: 'skipped', reason: 'already_running' };
        }
        
        try {
            this.currentRunning = true;
            debug('Starting batch processing...');
            
            const queuedCount = await this.getQueuedSymbolsCount();
            debug(`Queued symbols count: ${queuedCount}`);
            
            if (queuedCount === 0) {
                log('INFO', 'No symbols in queue');
                return { status: 'idle', queued_count: 0 };
            }
            
            log('INFO', ` Processing batch: ${queuedCount} symbols queued, max ${this.config.maxSymbolsPerRun}`);
            debug('Calling populator.populateMetadata...');
            
            const startTime = Date.now();
            const result = await this.populator.populateMetadata(this.config.maxSymbolsPerRun);
            const duration = Date.now() - startTime;
            
            log('INFO', ` Batch complete:`, {
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
            log('ERROR', 'Error processing batch:', error);
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
        log('INFO', 'Starting worker loop...');
        
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
                    log('INFO', ` Queue empty, waiting ${waitTime/1000}s...`);
                } else if (result.status === 'error') {
                    consecutiveErrors++;
                    // Exponential backoff on errors
                    waitTime = Math.min(this.config.checkIntervalMs * Math.pow(2, consecutiveErrors), 300000);
                    log('INFO', ` Error #${consecutiveErrors}, waiting ${waitTime/1000}s...`);
                    
                    if (consecutiveErrors >= maxConsecutiveErrors) {
                        log('ERROR', 'Too many consecutive errors, shutting down');
                        break;
                    }
                } else {
                    log('INFO', ` Next check in ${waitTime/1000}s...`);
                }
                
                // Wait before next iteration
                await this.sleep(waitTime);
                
            } catch (error) {
                log('ERROR', 'Unexpected error in main loop:', error);
                consecutiveErrors++;
                
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    log('ERROR', 'Too many errors, shutting down');
                    break;
                }
                
                await this.sleep(this.config.checkIntervalMs * consecutiveErrors);
            }
        }
        
        log('INFO', 'Worker loop ended');
    }
    
    /**
     * Start the metadata worker
     */
    async start() {
        try {
            log('INFO', 'Starting...');
            
            await this.initialize();
            
            if (this.config.processOnStartup) {
                log('INFO', 'Running initial batch on startup...');
                await this.processBatch();
            }
            
            // Start main worker loop
            await this.run();
            
        } catch (error) {
            log('ERROR', 'Failed to start:', error);
            process.exit(1);
        }
    }
    
    /**
     * Graceful shutdown
     */
    async gracefulShutdown(signal) {
        log('INFO', ` Received ${signal}, shutting down gracefully...`);
        
        this.isShuttingDown = true;
        
        // Wait for current batch to complete
        let waitCount = 0;
        while (this.currentRunning && waitCount < 30) {
            log('INFO', 'Waiting for current batch to complete...');
            await this.sleep(1000);
            waitCount++;
        }
        
        // Close database pool
        if (this.dbPool) {
            log('INFO', 'Closing database pool...');
            await this.dbPool.end();
        }
        
        log('INFO', 'Shutdown complete');
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
        log('ERROR', 'Fatal error:', error);
        process.exit(1);
    });
}

module.exports = MetadataWorker;