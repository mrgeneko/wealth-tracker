#!/usr/bin/env node

/**
 * Migration: Create Phase 9 WebSocket Real-time Metrics Tables
 * 
 * Creates three tables for real-time metrics collection and visualization:
 * 1. scraper_page_performance - Per-request metrics from scrapers
 * 2. scraper_daily_summary - Aggregated daily metrics
 * 3. scheduler_metrics - Scheduler execution metrics
 * 
 * Uses environment variables for database configuration:
 * - MYSQL_HOST (default: localhost)
 * - MYSQL_USER (default: root)
 * - MYSQL_PASSWORD (default: empty)
 * - MYSQL_DATABASE (default: wealth_tracker)
 * 
 * Run: node scripts/migrations/012_create_phase9_metrics_tables.js
 */

const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'wealth_tracker',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const SQL_STATEMENTS = [
  // Table 1: scraper_page_performance - Per-request metrics
  `CREATE TABLE IF NOT EXISTS scraper_page_performance (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // Table 2: scraper_daily_summary - Aggregated daily metrics
  `CREATE TABLE IF NOT EXISTS scraper_daily_summary (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // Table 3: scheduler_metrics - Scheduler execution metrics
  `CREATE TABLE IF NOT EXISTS scheduler_metrics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    scraper_source VARCHAR(50),
    execution_duration_ms INT,
    success BOOLEAN DEFAULT TRUE,
    error VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_source_time (scraper_source, created_at DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

async function runMigration() {
  let connection;
  try {
    console.log('🔄 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected');

    console.log('\n📋 Running migration...\n');
    for (let i = 0; i < SQL_STATEMENTS.length; i++) {
      const statement = SQL_STATEMENTS[i];
      const statementNum = i + 1;
      const tableName = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
      
      try {
        await connection.execute(statement);
        console.log(`✅ [${statementNum}/${SQL_STATEMENTS.length}] Created table: ${tableName}`);
      } catch (err) {
        if (err.code === 'ER_TABLE_EXISTS_ERROR') {
          console.log(`⚠️  [${statementNum}/${SQL_STATEMENTS.length}] Table already exists: ${tableName}`);
        } else {
          throw err;
        }
      }
    }

    console.log('\n✅ Migration completed successfully');
    return true;
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run migration if invoked directly
if (require.main === module) {
  runMigration().then(() => process.exit(0));
}

module.exports = { runMigration };
