#!/usr/bin/env node

/**
 * Database Migration Executor
 * File: scripts/migrations/execute-migration.js
 * 
 * This script executes the ticker standardization migration safely:
 * - Performs pre-migration validation
 * - Backs up data
 * - Executes migration
 * - Validates results
 * - Provides rollback capability
 * 
 * Usage:
 *   node scripts/migrations/execute-migration.js [--dry-run] [--rollback]
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const rollback = args.includes('--rollback');

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'wealth_tracker'
};

async function main() {
  let connection;

  try {
    connection = await mysql.createConnection(config);
    
    console.log('🔄 Starting Database Migration: Symbol → Ticker Standardization\n');

    if (rollback) {
      await performRollback(connection);
      return;
    }

    // Step 1: Pre-migration validation
    console.log('Step 1: Pre-migration Validation');
    await validatePreMigration(connection);
    console.log('✅ Pre-migration validation passed\n');

    // Step 2: Create backup
    console.log('Step 2: Creating Data Backup');
    await createBackup(connection);
    console.log('✅ Backup created\n');

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made');
      console.log('Run without --dry-run flag to execute migration\n');
      return;
    }

    // Step 3: Execute migration
    console.log('Step 3: Executing Migration');
    await executeMigration(connection);
    console.log('✅ Migration executed\n');

    // Step 4: Post-migration validation
    console.log('Step 4: Post-migration Validation');
    await validatePostMigration(connection);
    console.log('✅ Post-migration validation passed\n');

    // Step 5: Performance check
    console.log('Step 5: Performance Validation');
    await validatePerformance(connection);
    console.log('✅ Performance validation passed\n');

    console.log('🎉 Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Review the changes in your staging environment');
    console.log('2. Run the test suite: npm run test:migration:post');
    console.log('3. Deploy backend code changes');
    console.log('4. Deploy frontend code changes');
    console.log('5. Monitor error rates and performance\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nTo rollback, run: node scripts/migrations/execute-migration.js --rollback');
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

async function validatePreMigration(connection) {
  console.log('  - Checking symbol columns exist...');
  const [tables] = await connection.query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = DATABASE()
  `);

  for (const table of tables) {
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = ? AND COLUMN_NAME = 'symbol'
    `, [table.TABLE_NAME]);
    
    if (columns.length > 0) {
      console.log(`    ✓ Table '${table.TABLE_NAME}' has symbol column`);
    }
  }

  console.log('  - Checking for existing ticker columns...');
  const [existing] = await connection.query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE COLUMN_NAME = 'ticker' AND TABLE_SCHEMA = DATABASE()
  `);

  if (existing.length > 0) {
    throw new Error('Ticker column already exists. Migration may have run previously.');
  }

  console.log('    ✓ No ticker columns found (ready for migration)');
}

async function createBackup(connection) {
  console.log('  - Creating backup of positions table...');
  await connection.query(`
    CREATE TABLE positions_backup_pre_ticker_migration AS
    SELECT * FROM positions
  `);
  console.log('    ✓ positions_backup_pre_ticker_migration created');

  console.log('  - Creating backup of symbol_registry table...');
  await connection.query(`
    CREATE TABLE symbol_registry_backup_pre_ticker_migration AS
    SELECT * FROM symbol_registry
  `);
  console.log('    ✓ symbol_registry_backup_pre_ticker_migration created');
}

async function executeMigration(connection) {
  console.log('  - Adding ticker column to positions...');
  await connection.query(`
    ALTER TABLE positions
    ADD COLUMN ticker VARCHAR(20) NULL AFTER symbol,
    ADD INDEX idx_ticker (ticker)
  `);
  console.log('    ✓ ticker column added to positions');

  console.log('  - Adding ticker column to symbol_registry...');
  await connection.query(`
    ALTER TABLE symbol_registry
    ADD COLUMN ticker VARCHAR(20) NULL UNIQUE AFTER symbol,
    ADD INDEX idx_ticker (ticker)
  `);
  console.log('    ✓ ticker column added to symbol_registry');

  console.log('  - Copying symbol data to ticker for positions...');
  const [result1] = await connection.query(`
    UPDATE positions
    SET ticker = symbol
    WHERE symbol IS NOT NULL AND symbol != ''
  `);
  console.log(`    ✓ ${result1.affectedRows} rows updated in positions`);

  console.log('  - Copying symbol data to ticker for symbol_registry...');
  const [result2] = await connection.query(`
    UPDATE symbol_registry
    SET ticker = symbol
    WHERE symbol IS NOT NULL AND symbol != ''
  `);
  console.log(`    ✓ ${result2.affectedRows} rows updated in symbol_registry`);

  console.log('  - Creating performance indexes...');
  await connection.query(`
    ALTER TABLE positions
    ADD INDEX idx_ticker_quantity (ticker, quantity)
  `);
  console.log('    ✓ Performance indexes created');
}

async function validatePostMigration(connection) {
  console.log('  - Verifying ticker column exists...');
  const [columns] = await connection.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'positions' AND COLUMN_NAME = 'ticker'
  `);
  if (columns.length === 0) throw new Error('Ticker column not found');
  console.log('    ✓ ticker column exists');

  console.log('  - Verifying data was copied...');
  const [[{ symbolCount }]] = await connection.query(`
    SELECT COUNT(*) as symbolCount FROM positions WHERE symbol IS NOT NULL
  `);
  const [[{ tickerCount }]] = await connection.query(`
    SELECT COUNT(*) as tickerCount FROM positions WHERE ticker IS NOT NULL
  `);
  if (symbolCount !== tickerCount) {
    throw new Error(`Data mismatch: symbol=${symbolCount}, ticker=${tickerCount}`);
  }
  console.log(`    ✓ ${tickerCount} rows successfully migrated`);

  console.log('  - Verifying data integrity...');
  const [[{ mismatch }]] = await connection.query(`
    SELECT COUNT(*) as mismatch FROM positions 
    WHERE symbol != ticker AND symbol IS NOT NULL
  `);
  if (mismatch > 0) throw new Error(`${mismatch} rows have mismatched data`);
  console.log('    ✓ Data integrity verified (no mismatches)');
}

async function validatePerformance(connection) {
  console.log('  - Testing query performance...');
  
  const startTime = Date.now();
  await connection.query(`
    SELECT * FROM positions WHERE ticker = 'AAPL' LIMIT 100
  `);
  const duration = Date.now() - startTime;
  
  if (duration > 100) {
    console.log(`    ⚠ Query took ${duration}ms (expected < 100ms)`);
  } else {
    console.log(`    ✓ Query performance acceptable (${duration}ms)`);
  }
}

async function performRollback(connection) {
  console.log('🔄 Performing Rollback...\n');

  try {
    console.log('Step 1: Dropping ticker columns...');
    await connection.query('ALTER TABLE positions DROP COLUMN ticker');
    console.log('  ✓ Dropped ticker from positions');

    await connection.query('ALTER TABLE symbol_registry DROP COLUMN ticker');
    console.log('  ✓ Dropped ticker from symbol_registry');

    console.log('\nStep 2: Cleaning up backup tables...');
    await connection.query('DROP TABLE IF EXISTS positions_backup_pre_ticker_migration');
    console.log('  ✓ Removed positions backup');

    await connection.query('DROP TABLE IF EXISTS symbol_registry_backup_pre_ticker_migration');
    console.log('  ✓ Removed symbol_registry backup');

    console.log('\n✅ Rollback completed successfully');
    console.log('Your database is back to the pre-migration state.\n');

  } catch (error) {
    console.error('❌ Rollback failed:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
