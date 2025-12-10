#!/usr/bin/env node

/**
 * Phase 9 Database Schema Initialization
 * Creates the three new tables required for WebSocket real-time metrics
 */

const mysql = require('mysql2/promise');

const MYSQL_HOST = process.env.MYSQL_HOST || 'mysql';
const MYSQL_PORT = process.env.MYSQL_PORT || 3306;
const MYSQL_USER = process.env.MYSQL_USER || 'test';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'test';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'testdb';

async function createPhase9Schema() {
  let connection;
  try {
    console.log(`[Phase 9 Schema] Connecting to MySQL at ${MYSQL_HOST}:${MYSQL_PORT}...`);
    
    connection = await mysql.createConnection({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE
    });

    console.log('[Phase 9 Schema] Connected to database. Creating tables...\n');

    // Table 1: scraper_page_performance
    console.log('[Phase 9 Schema] Creating scraper_page_performance table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS scraper_page_performance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        scraper_source VARCHAR(50) NOT NULL,
        metric_type VARCHAR(50) NOT NULL,
        url VARCHAR(500),
        navigation_duration_ms INT,
        scrape_duration_ms INT,
        items_extracted INT,
        success BOOLEAN DEFAULT TRUE,
        error VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_source_time (scraper_source, created_at DESC),
        INDEX idx_type_source (metric_type, scraper_source, created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ scraper_page_performance created\n');

    // Table 2: scraper_daily_summary
    console.log('[Phase 9 Schema] Creating scraper_daily_summary table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS scraper_daily_summary (
        id INT AUTO_INCREMENT PRIMARY KEY,
        scraper_source VARCHAR(50) NOT NULL,
        metric_date DATE NOT NULL,
        metric_type VARCHAR(50),
        total_count INT,
        success_count INT,
        avg_duration_ms FLOAT,
        total_items_extracted INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (scraper_source, metric_date, metric_type),
        INDEX idx_source_date (scraper_source, metric_date DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ scraper_daily_summary created\n');

    // Table 3: scheduler_metrics
    console.log('[Phase 9 Schema] Creating scheduler_metrics table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS scheduler_metrics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        scraper_source VARCHAR(50),
        execution_duration_ms INT,
        success BOOLEAN DEFAULT TRUE,
        error VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_source_time (scraper_source, created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ scheduler_metrics created\n');

    // Verify tables were created
    console.log('[Phase 9 Schema] Verifying tables...');
    const [tables] = await connection.execute(
      "SHOW TABLES LIKE 'scraper%' OR SHOW TABLES LIKE 'scheduler%'"
    );
    
    // Better verification
    const [pagePerf] = await connection.execute(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'scraper_page_performance'",
      [MYSQL_DATABASE]
    );
    
    const [dailySummary] = await connection.execute(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'scraper_daily_summary'",
      [MYSQL_DATABASE]
    );
    
    const [schedulerMetrics] = await connection.execute(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'scheduler_metrics'",
      [MYSQL_DATABASE]
    );

    console.log('✓ scraper_page_performance exists:', pagePerf.length > 0);
    console.log('✓ scraper_daily_summary exists:', dailySummary.length > 0);
    console.log('✓ scheduler_metrics exists:', schedulerMetrics.length > 0);
    
    console.log('\n✅ Phase 9 database schema successfully created!');
    console.log('\nNext steps:');
    console.log('1. Restart the dashboard server: npm start');
    console.log('2. Navigate to http://localhost:3001/analytics');
    console.log('3. Check browser console for WebSocket connection');

  } catch (error) {
    console.error('\n❌ Error creating Phase 9 schema:');
    console.error(error.message);
    
    if (error.code === 'PROTOCOL_CONNECTION_LOST') {
      console.error('\nNote: MySQL connection lost. Make sure MySQL is running.');
      console.error('Run: docker-compose up -d mysql');
    }
    
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the schema creation
createPhase9Schema();
