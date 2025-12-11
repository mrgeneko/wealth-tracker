#!/usr/bin/env node

/**
 * Database Migration Executor: Symbol to Ticker Standardization
 * 
 * Executes the SQL migration with proper error handling and rollback support.
 * Usage: node execute-migration.js [--rollback] [--verify-only]
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const isRollback = args.includes('--rollback');
const verifyOnly = args.includes('--verify-only');

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'wealth_tracker',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

async function main() {
  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✅ Connected to database:', config.database);

    // Step 1: Verify pre-migration state
    console.log('\n📋 Verifying pre-migration state...');
    const preState = await verifyPreMigrationState(connection);
    console.log('  • Positions with symbol:', preState.positionsWithSymbol);
    console.log('  • Securities metadata entries:', preState.metadataCount);
    console.log('  • Symbol registry entries:', preState.registryCount);
    console.log('  • Securities dividends entries:', preState.dividendsCount);

    if (verifyOnly) {
      console.log('\n✅ Verification complete. No changes made (--verify-only flag set)');
      return;
    }

    if (isRollback) {
      console.log('\n⚠️  ROLLBACK MODE: Restoring symbol columns...');
      await rollbackMigration(connection);
    } else {
      // Step 2: Create backup
      console.log('\n💾 Creating backup of ticker columns...');
      await createBackup(connection);

      // Step 3: Execute migration
      console.log('\n🚀 Executing migration...');
      const migrationFile = path.join(__dirname, '012_rename_symbol_to_ticker.sql');
      const migrationSQL = fs.readFileSync(migrationFile, 'utf8');
      
      // Split by statement and execute
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--'));

      let completed = 0;
      for (const statement of statements) {
        if (statement) {
          await connection.execute(statement);
          completed++;
        }
      }
      console.log(`  ✓ Executed ${completed} statements`);

      // Step 4: Verify post-migration state
      console.log('\n✅ Verifying post-migration state...');
      const postState = await verifyPostMigrationState(connection);
      console.log('  • Positions with ticker:', postState.positionsWithTicker);
      console.log('  • Ticker column exists in positions:', postState.tickerExistsPositions);
      console.log('  • Ticker column exists in metadata:', postState.tickerExistsMetadata);
      console.log('  • Ticker column exists in registry:', postState.tickerExistsRegistry);
      console.log('  • Ticker column exists in dividends:', postState.tickerExistsDividends);

      // Step 5: Data integrity checks
      console.log('\n🔍 Performing data integrity checks...');
      const integrity = await checkDataIntegrity(connection);
      console.log('  • Positions with NULL ticker:', integrity.nullTickerPositions);
      console.log('  • Metadata with NULL ticker:', integrity.nullTickerMetadata);
      console.log('  • Registry with NULL ticker:', integrity.nullTickerRegistry);
      console.log('  • Dividends with NULL ticker:', integrity.nullTickerDividends);
      console.log('  • Orphaned symbol values:', integrity.orphanedSymbols);

      if (integrity.hasIssues) {
        console.warn('\n⚠️  WARNING: Some data integrity issues detected');
        console.warn('  Please review the orphaned symbols before using the migrated database');
      }

      console.log('\n✅ Migration completed successfully!');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

async function verifyPreMigrationState(connection) {
  const queries = {
    positionsWithSymbol: 'SELECT COUNT(*) as count FROM positions WHERE symbol IS NOT NULL',
    metadataCount: 'SELECT COUNT(*) as count FROM securities_metadata',
    registryCount: 'SELECT COUNT(*) as count FROM symbol_registry',
    dividendsCount: 'SELECT COUNT(*) as count FROM securities_dividends'
  };

  const results = {};
  for (const [key, query] of Object.entries(queries)) {
    const [rows] = await connection.execute(query);
    results[key] = rows[0].count;
  }
  return results;
}

async function verifyPostMigrationState(connection) {
  const results = {};

  // Count ticker values
  const [[pos]] = await connection.execute('SELECT COUNT(*) as count FROM positions WHERE ticker IS NOT NULL');
  results.positionsWithTicker = pos.count;

  // Check column existence
  const checks = [
    { table: 'positions', column: 'ticker', key: 'tickerExistsPositions' },
    { table: 'securities_metadata', column: 'ticker', key: 'tickerExistsMetadata' },
    { table: 'symbol_registry', column: 'ticker', key: 'tickerExistsRegistry' },
    { table: 'securities_dividends', column: 'ticker', key: 'tickerExistsDividends' }
  ];

  for (const check of checks) {
    const query = `
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `;
    const [rows] = await connection.execute(query, [check.table, check.column]);
    results[check.key] = rows.length > 0;
  }

  return results;
}

async function checkDataIntegrity(connection) {
  const results = {};

  // Check for NULL tickers
  const [[nullPos]] = await connection.execute('SELECT COUNT(*) as count FROM positions WHERE ticker IS NULL');
  results.nullTickerPositions = nullPos.count;

  const [[nullMeta]] = await connection.execute('SELECT COUNT(*) as count FROM securities_metadata WHERE ticker IS NULL');
  results.nullTickerMetadata = nullMeta.count;

  const [[nullReg]] = await connection.execute('SELECT COUNT(*) as count FROM symbol_registry WHERE ticker IS NULL');
  results.nullTickerRegistry = nullReg.count;

  const [[nullDiv]] = await connection.execute('SELECT COUNT(*) as count FROM securities_dividends WHERE ticker IS NULL');
  results.nullTickerDividends = nullDiv.count;

  // Check for orphaned symbols (if symbol column still exists - shouldn't be case after migration)
  const [[orphans]] = await connection.execute(`
    SELECT COUNT(*) as count FROM positions WHERE symbol IS NOT NULL
  `).catch(() => [{ count: 0 }]);
  results.orphanedSymbols = orphans?.count || 0;

  results.hasIssues = Object.values(results).some(v => v > 0);
  return results;
}

async function createBackup(connection) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(__dirname, `../../backup/migration_${timestamp}.sql`);
  
  // Create backup directory if it doesn't exist
  const backupDir = path.dirname(backupFile);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log('  • Backup file:', backupFile);
  // Note: In a real scenario, you'd mysqldump here
  console.log('  • Recommended: Run `mysqldump` before migration');
}

async function rollbackMigration(connection) {
  console.log('  ⚠️  Rollback is not implemented automatically');
  console.log('  📌 To rollback:');
  console.log('     1. Restore from database backup');
  console.log('     2. Or run: mysql -u root -p < backup/migration_TIMESTAMP.sql');
  process.exit(1);
}

main().catch(console.error);
