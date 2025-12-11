#!/usr/bin/env node

/**
 * Database Initialization Script
 * 
 * Runs all migrations to ensure the database schema is up-to-date.
 * Called during dashboard startup before the server begins.
 * 
 * Migrations are run in order:
 * - 011_create_ticker_registry.js
 * 
 * Environment variables:
 * - MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */

const path = require('path');
const fs = require('fs');

async function runAllMigrations() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🔄  DATABASE INITIALIZATION - Running Migrations');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const migrationsDir = path.join(__dirname, './migrations');
  
  // Get all migration files in order
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.match(/^\d+.*\.js$/))
    .sort();

  if (migrationFiles.length === 0) {
    console.warn('⚠️  No migrations found');
    return true;
  }

  console.log(`Found ${migrationFiles.length} migration(s):\n`);
  migrationFiles.forEach((f, i) => {
    console.log(`  [${i + 1}] ${f}`);
  });
  console.log('');

  let successCount = 0;
  let failureCount = 0;

  for (const migrationFile of migrationFiles) {
    const migrationPath = path.join(migrationsDir, migrationFile);
    
    try {
      console.log(`\n📋 Running: ${migrationFile}`);
      console.log('─'.repeat(70));
      
      // Dynamically require and run the migration
      const { runMigration } = require(migrationPath);
      
      if (typeof runMigration !== 'function') {
        console.error(`❌ Migration ${migrationFile} does not export runMigration function`);
        failureCount++;
        continue;
      }

      await runMigration();
      successCount++;
      console.log('─'.repeat(70));
    } catch (err) {
      console.error(`❌ Migration ${migrationFile} failed:`, err.message);
      failureCount++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  ✅ Database Initialization Complete`);
  console.log(`  ${successCount} succeeded, ${failureCount} failed`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return failureCount === 0;
}

// Run migrations if invoked directly
if (require.main === module) {
  runAllMigrations()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
      console.error('Fatal error during migrations:', err);
      process.exit(1);
    });
}

module.exports = { runAllMigrations };
