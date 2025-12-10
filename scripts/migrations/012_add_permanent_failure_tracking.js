#!/usr/bin/env node

/**
 * Migration: Add permanent failure tracking to symbol_registry
 * 
 * Adds:
 * - permanently_failed BOOLEAN column to track tickers that can't be fetched
 * - permanent_failure_reason VARCHAR(255) to store the reason
 * - permanent_failure_at TIMESTAMP to track when it failed
 * 
 * Used by metadata worker to avoid retrying delisted/acquired securities
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
  // Add permanently_failed column
  `ALTER TABLE symbol_registry 
   ADD COLUMN permanently_failed BOOLEAN DEFAULT FALSE AFTER has_yahoo_metadata`,
  
  // Add permanent_failure_reason column
  `ALTER TABLE symbol_registry 
   ADD COLUMN permanent_failure_reason VARCHAR(255) NULL AFTER permanently_failed`,
  
  // Add permanent_failure_at column
  `ALTER TABLE symbol_registry 
   ADD COLUMN permanent_failure_at TIMESTAMP NULL AFTER permanent_failure_reason`,
  
  // Add index for permanently_failed queries
  `ALTER TABLE symbol_registry 
   ADD INDEX idx_permanently_failed (permanently_failed)`
];

async function runMigration() {
  let connection;
  try {
    console.log('🔄 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected');

    console.log('\n📋 Running migration: Add permanent failure tracking\n');
    for (let i = 0; i < SQL_STATEMENTS.length; i++) {
      const statement = SQL_STATEMENTS[i];
      const statementNum = i + 1;
      
      try {
        await connection.execute(statement);
        console.log(`✅ [${statementNum}/${SQL_STATEMENTS.length}] Executed: ${statement.substring(0, 60)}...`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`⚠️  [${statementNum}/${SQL_STATEMENTS.length}] Column already exists`);
        } else if (err.code === 'ER_DUP_KEY_NAME') {
          console.log(`⚠️  [${statementNum}/${SQL_STATEMENTS.length}] Index already exists`);
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
