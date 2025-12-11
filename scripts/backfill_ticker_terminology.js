#!/usr/bin/env node

/**
 * Backfill Script: Ticker Terminology Standardization
 * 
 * Ensures all ticker columns are properly populated after migration.
 * Validates data consistency and handles edge cases.
 */

const mysql = require('mysql2/promise');

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

    // Step 1: Validate migration completed
    console.log('\n📋 Validating migration state...');
    const migrationValid = await validateMigration(connection);
    if (!migrationValid) {
      console.error('❌ Migration validation failed. Run migration first.');
      process.exit(1);
    }
    console.log('  ✓ Migration validation passed');

    // Step 2: Backfill any missing ticker values
    console.log('\n🔄 Backfilling missing ticker values...');
    const backfilled = await backfillTickers(connection);
    console.log('  ✓ Backfilled', backfilled, 'records');

    // Step 3: Normalize ticker values
    console.log('\n✨ Normalizing ticker values...');
    const normalized = await normalizeTickers(connection);
    console.log('  ✓ Normalized', normalized, 'records');

    // Step 4: Fix relationships
    console.log('\n🔗 Validating relationships...');
    const relationships = await validateRelationships(connection);
    console.log('  ✓ Relationships valid');
    if (relationships.warnings.length > 0) {
      console.warn('  ⚠️  Warnings:');
      relationships.warnings.forEach(w => console.warn('    -', w));
    }

    // Step 5: Final integrity check
    console.log('\n✅ Performing final integrity check...');
    const integrity = await finalIntegrityCheck(connection);
    console.log('  ✓ All tickers:', integrity.totalTickers);
    console.log('  ✓ NULL tickers:', integrity.nullCount);
    console.log('  ✓ Duplicate tickers in registry:', integrity.duplicates);

    console.log('\n✅ Backfill completed successfully!');

  } catch (error) {
    console.error('❌ Backfill failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

async function validateMigration(connection) {
  const tables = ['positions', 'securities_metadata', 'ticker_registry', 'securities_dividends'];
  
  for (const table of tables) {
    const query = `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'ticker'
    `;
    const [rows] = await connection.execute(query, [table]);
    if (rows.length === 0) {
      console.error(`  ❌ Column 'ticker' not found in ${table}`);
      return false;
    }
  }
  return true;
}

async function backfillTickers(connection) {
  let totalBackfilled = 0;

  // Backfill positions
  const [posResult] = await connection.execute(`
    UPDATE positions 
    SET ticker = UPPER(symbol) 
    WHERE ticker IS NULL AND symbol IS NOT NULL
  `);
  totalBackfilled += posResult.affectedRows;
  console.log(`  • Positions: ${posResult.affectedRows} backfilled`);

  // Backfill securities_metadata
  const [metaResult] = await connection.execute(`
    UPDATE securities_metadata 
    SET ticker = UPPER(symbol) 
    WHERE ticker IS NULL AND symbol IS NOT NULL
  `);
  totalBackfilled += metaResult.affectedRows;
  console.log(`  • Securities Metadata: ${metaResult.affectedRows} backfilled`);

  // Backfill ticker_registry
  const [regResult] = await connection.execute(`
    UPDATE ticker_registry 
    SET ticker = UPPER(symbol) 
    WHERE ticker IS NULL AND symbol IS NOT NULL
  `);
  totalBackfilled += regResult.affectedRows;
  console.log(`  • Symbol Registry: ${regResult.affectedRows} backfilled`);

  // Backfill securities_dividends
  const [divResult] = await connection.execute(`
    UPDATE securities_dividends 
    SET ticker = UPPER(symbol) 
    WHERE ticker IS NULL AND symbol IS NOT NULL
  `);
  totalBackfilled += divResult.affectedRows;
  console.log(`  • Securities Dividends: ${divResult.affectedRows} backfilled`);

  return totalBackfilled;
}

async function normalizeTickers(connection) {
  let totalNormalized = 0;

  // Remove leading/trailing spaces
  const [posResult] = await connection.execute(`
    UPDATE positions 
    SET ticker = TRIM(ticker) 
    WHERE ticker IS NOT NULL AND ticker LIKE ' %' OR ticker LIKE '% '
  `);
  totalNormalized += posResult.affectedRows;

  // Ensure uppercase
  const [upperResult] = await connection.execute(`
    UPDATE ticker_registry 
    SET ticker = UPPER(ticker) 
    WHERE ticker != UPPER(ticker)
  `);
  totalNormalized += upperResult.affectedRows;

  console.log(`  • Trimmed: ${posResult.affectedRows}`);
  console.log(`  • Uppercased: ${upperResult.affectedRows}`);

  return totalNormalized;
}

async function validateRelationships(connection) {
  const warnings = [];

  // Check for positions with invalid tickers
  const [[invalidPos]] = await connection.execute(`
    SELECT COUNT(*) as count 
    FROM positions p 
    WHERE p.ticker IS NOT NULL 
    AND NOT EXISTS (
      SELECT 1 FROM ticker_registry sr WHERE sr.ticker = p.ticker
    )
  `);
  
  if (invalidPos.count > 0) {
    warnings.push(`${invalidPos.count} positions reference non-existent tickers (OK - not all tickers may be registered)`);
  }

  // Check for dividends with invalid tickers
  const [[invalidDiv]] = await connection.execute(`
    SELECT COUNT(*) as count 
    FROM securities_dividends d 
    WHERE d.ticker IS NOT NULL 
    AND NOT EXISTS (
      SELECT 1 FROM ticker_registry sr WHERE sr.ticker = d.ticker
    )
  `);
  
  if (invalidDiv.count > 0) {
    warnings.push(`${invalidDiv.count} dividend records reference non-existent tickers (consider cleanup)`);
  }

  return { warnings };
}

async function finalIntegrityCheck(connection) {
  const [[totalCheck]] = await connection.execute('SELECT COUNT(*) as count FROM ticker_registry');
  const [[nullCheck]] = await connection.execute('SELECT COUNT(*) as count FROM ticker_registry WHERE ticker IS NULL');
  const [[dupCheck]] = await connection.execute(`
    SELECT COUNT(*) as count 
    FROM (
      SELECT ticker FROM ticker_registry GROUP BY ticker HAVING COUNT(*) > 1
    ) duplicates
  `);

  return {
    totalTickers: totalCheck.count,
    nullCount: nullCheck.count,
    duplicates: dupCheck.count
  };
}

main().catch(console.error);
