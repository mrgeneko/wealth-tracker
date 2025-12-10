#!/usr/bin/env node

/**
 * Migration: Create symbol_registry and related tables
 * 
 * Creates three new tables for the autocomplete enhancement:
 * 1. symbol_registry - Main registry of all symbols
 * 2. symbol_registry_metrics - Track coverage and refresh metrics
 * 3. file_refresh_status - Track when files were last refreshed
 * 
 * Uses environment variables for database configuration:
 * - MYSQL_HOST (default: localhost)
 * - MYSQL_USER (default: root)
 * - MYSQL_PASSWORD (default: empty)
 * - MYSQL_DATABASE (default: wealth_tracker)
 * 
 * Run: node scripts/migrations/011_create_symbol_registry.js
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
  // Create symbol_registry table
  `CREATE TABLE IF NOT EXISTS symbol_registry (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(500),
    exchange VARCHAR(50),
    security_type ENUM('EQUITY', 'ETF', 'BOND', 'TREASURY', 'MUTUAL_FUND', 'OPTION', 'CRYPTO', 'FX', 'FUTURES', 'INDEX', 'OTHER') DEFAULT 'EQUITY',
    source ENUM('NASDAQ_FILE', 'NYSE_FILE', 'OTHER_FILE', 'TREASURY_FILE', 'TREASURY_HISTORICAL', 'YAHOO', 'USER_ADDED') NOT NULL,
    has_yahoo_metadata BOOLEAN DEFAULT FALSE,
    permanently_failed BOOLEAN DEFAULT FALSE,
    permanent_failure_reason VARCHAR(255) NULL,
    permanent_failure_at TIMESTAMP NULL,
    usd_trading_volume DECIMAL(20, 2) NULL,
    sort_rank INT DEFAULT 1000,
    
    -- Treasury-specific fields
    issue_date DATE NULL,
    maturity_date DATE NULL,
    security_term VARCHAR(50) NULL,
    
    -- Option-specific fields
    underlying_symbol VARCHAR(50) NULL,
    strike_price DECIMAL(18, 4) NULL,
    option_type ENUM('CALL', 'PUT') NULL,
    expiration_date DATE NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_symbol (symbol),
    INDEX idx_security_type (security_type),
    INDEX idx_sort_rank (sort_rank),
    INDEX idx_maturity_date (maturity_date),
    INDEX idx_expiration_date (expiration_date),
    INDEX idx_underlying_symbol (underlying_symbol),
    INDEX idx_permanently_failed (permanently_failed),
    CONSTRAINT fk_underlying_symbol FOREIGN KEY (underlying_symbol) REFERENCES symbol_registry(symbol) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // Create symbol_registry_metrics table
  `CREATE TABLE IF NOT EXISTS symbol_registry_metrics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    metric_date DATE NOT NULL,
    source VARCHAR(50) NOT NULL,
    total_symbols INT NOT NULL,
    symbols_with_yahoo_metadata INT NOT NULL,
    symbols_without_yahoo_metadata INT NOT NULL,
    last_file_refresh_at TIMESTAMP NULL,
    file_download_duration_ms INT NULL,
    avg_yahoo_fetch_duration_ms INT NULL,
    errors_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_date_source (metric_date, source),
    INDEX idx_metric_date (metric_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // Create file_refresh_status table
  `CREATE TABLE IF NOT EXISTS file_refresh_status (
    id INT AUTO_INCREMENT PRIMARY KEY,
    file_type ENUM('NASDAQ', 'NYSE', 'OTHER', 'TREASURY') NOT NULL UNIQUE,
    last_refresh_at TIMESTAMP NULL,
    last_refresh_duration_ms INT NULL,
    last_refresh_status ENUM('SUCCESS', 'FAILED', 'IN_PROGRESS') DEFAULT 'SUCCESS',
    last_error_message TEXT NULL,
    symbols_added INT DEFAULT 0,
    symbols_updated INT DEFAULT 0,
    next_refresh_due_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_file_type (file_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
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
