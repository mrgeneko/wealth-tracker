#!/usr/bin/env node

/**
 * Database Schema Verification Script
 * 
 * Verifies that all required database tables exist.
 * Called during dashboard startup before the server begins.
 * 
 * All table creation is handled by Docker init scripts in scripts/init-db/
 * This script only validates that the schema is properly initialized.
 * 
 * Environment variables:
 * - MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */

const mysql = require('mysql2/promise');

const REQUIRED_TABLES = [
  // Core tables (000-base-schema.sql)
  'accounts',
  'positions',
  'fixed_assets',
  'latest_prices',
  'securities_metadata',
  'securities_dividends',
  'securities_dividends_backup',
  'securities_earnings',
  'security_splits',
  
  // Ticker registry tables (001-symbol-registry.sql)
  'ticker_registry',
  'ticker_registry_metrics',
  'file_refresh_status',
  'symbol_yahoo_metrics',
  
  // Metrics tables (002-phase9-metrics.sql)
  'scraper_page_performance',
  'scraper_daily_summary',
  'scheduler_metrics'
];

async function runAllMigrations() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🔄  DATABASE SCHEMA VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const dbConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'wealth_tracker'
  };

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log(`✅ Connected to ${dbConfig.database}@${dbConfig.host}:${dbConfig.port}\n`);

    // Get existing tables
    const [rows] = await connection.execute('SHOW TABLES');
    const existingTables = rows.map(r => Object.values(r)[0]);

    // Check for missing tables
    const missingTables = REQUIRED_TABLES.filter(t => !existingTables.includes(t));
    const presentTables = REQUIRED_TABLES.filter(t => existingTables.includes(t));

    console.log(`Found ${presentTables.length}/${REQUIRED_TABLES.length} required tables:\n`);
    
    presentTables.forEach(t => console.log(`  ✅ ${t}`));
    
    if (missingTables.length > 0) {
      console.log('\n⚠️  Missing tables:');
      missingTables.forEach(t => console.log(`  ❌ ${t}`));
      console.log('\n  To fix: Recreate the Docker container to run init scripts');
      console.log('  Or manually run: mysql < scripts/init-db/000-base-schema.sql');
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    if (missingTables.length === 0) {
      console.log('  ✅ Database Schema Verification Complete - All tables present');
    } else {
      console.log(`  ⚠️  Database Schema Verification Complete - ${missingTables.length} tables missing`);
    }
    console.log('═══════════════════════════════════════════════════════════════\n');

    return missingTables.length === 0;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    return false;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run verification if invoked directly
if (require.main === module) {
  runAllMigrations()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
      console.error('Fatal error during verification:', err);
      process.exit(1);
    });
}

module.exports = { runAllMigrations };
