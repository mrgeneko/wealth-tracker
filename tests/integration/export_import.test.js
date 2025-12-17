// tests/integration/export_import.test.js
// Integration test for export/import functionality
// Tests that data can be exported and re-imported successfully

require('dotenv').config();
const mysql = require('mysql2/promise');
const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');

// We'll need to set up a minimal express app with the export/import endpoints
// For now, we'll test the database operations directly

describe('Export/Import Integration Test', () => {
  let connection;

  beforeAll(async () => {
    // Check for required environment variables
    const required = ['MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
    const missing = required.filter(v => !process.env[v]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE
    });

    // Initialize schema
    await initializeSchema(connection);
  }, 30000);

  afterAll(async () => {
    if (connection) {
      await connection.end();
    }
  });

  async function initializeSchema(conn) {
    // Drop existing test tables
    const tablesToDrop = [
      'positions',
      'accounts',
      'fixed_assets',
      'account_types'
    ];

    try {
      await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of tablesToDrop) {
        try {
          await conn.execute(`DROP TABLE IF EXISTS ${table}`);
        } catch (err) {
          // Ignore errors
        }
      }
      await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
    } catch (err) {
      console.warn('Warning dropping tables:', err.message);
    }

    // Read and execute init scripts
    const baseSchemaPath = path.join(__dirname, '../..', 'scripts/init-db/000-base-schema.sql');

    if (fs.existsSync(baseSchemaPath)) {
      const baseSchema = fs.readFileSync(baseSchemaPath, 'utf8');
      const statements = baseSchema.split(';').filter(s => s.trim().length > 0);
      for (const statement of statements) {
        try {
          await conn.query(statement);
        } catch (err) {
          console.warn('Warning executing schema statement:', err.message);
        }
      }
    }
  }

  async function exportData(conn) {
    // Simulate the export endpoint
    const [accounts] = await conn.query(`
      SELECT id, name, account_type_id, currency, display_order
      FROM accounts
      ORDER BY display_order
    `);

    const [positions] = await conn.query(`
      SELECT id, account_id, ticker, description, quantity, type,
             exchange, currency, maturity_date, coupon, normalized_key
      FROM positions
    `);

    const [fixedAssets] = await conn.query(`
      SELECT id, name, type, value, currency, display_order
      FROM fixed_assets
      ORDER BY display_order
    `);

    return {
      exportDate: new Date().toISOString(),
      version: '2.0',
      data: {
        accounts: accounts,
        positions: positions,
        fixed_assets: fixedAssets
      }
    };
  }

  async function importData(conn, importData) {
    // Simulate the import endpoint
    if (!importData.data || !importData.data.accounts || !importData.data.positions) {
      throw new Error('Invalid data format');
    }

    const { accounts, positions, fixed_assets } = importData.data;

    // Start transaction
    await conn.execute('START TRANSACTION');

    try {
      // Clear existing data
      await conn.execute('DELETE FROM positions');
      await conn.execute('DELETE FROM accounts');
      if (fixed_assets && fixed_assets.length > 0) {
        await conn.execute('DELETE FROM fixed_assets');
      }

      // Insert accounts
      for (const account of accounts) {
        await conn.execute(
          'INSERT INTO accounts (id, name, account_type_id, currency, display_order) VALUES (?, ?, ?, ?, ?)',
          [account.id, account.name, account.account_type_id, account.currency || 'USD', account.display_order || 0]
        );
      }

      // Insert positions
      for (const position of positions) {
        await conn.execute(
          'INSERT INTO positions (account_id, ticker, description, quantity, type, exchange, currency, maturity_date, coupon, normalized_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            position.account_id,
            position.ticker || null,
            position.description || null,
            position.quantity,
            position.type,
            position.exchange || null,
            position.currency || 'USD',
            position.maturity_date || null,
            position.coupon || null,
            position.normalized_key || null
          ]
        );
      }

      // Insert fixed assets if present
      if (fixed_assets && fixed_assets.length > 0) {
        for (const asset of fixed_assets) {
          await conn.execute(
            'INSERT INTO fixed_assets (name, type, value, currency, display_order) VALUES (?, ?, ?, ?, ?)',
            [asset.name, asset.type, asset.value, asset.currency || 'USD', asset.display_order || 0]
          );
        }
      }

      // Commit transaction
      await conn.execute('COMMIT');
    } catch (error) {
      // Rollback on error
      await conn.execute('ROLLBACK');
      throw error;
    }
  }

  test('Export and re-import data successfully', async () => {
    // Clean up first
    await connection.execute('DELETE FROM positions');
    await connection.execute('DELETE FROM accounts');
    await connection.execute('DELETE FROM fixed_assets');

    // Get or create an account type
    const [accountTypes] = await connection.execute(
      'SELECT id FROM account_types LIMIT 1'
    );
    const accountTypeId = accountTypes[0]?.id || 1;

    // Insert test data
    await connection.execute(
      'INSERT INTO accounts (id, name, account_type_id, currency, display_order) VALUES (?, ?, ?, ?, ?)',
      [100, 'Test Brokerage', accountTypeId, 'USD', 0]
    );

    await connection.execute(
      'INSERT INTO positions (account_id, ticker, description, quantity, type, exchange, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [100, 'AAPL', 'Apple Inc.', 50, 'stock', 'NASDAQ', 'USD']
    );

    await connection.execute(
      'INSERT INTO positions (account_id, ticker, quantity, type, currency) VALUES (?, ?, ?, ?, ?)',
      [100, 'USD', 5000, 'cash', 'USD']
    );

    await connection.execute(
      'INSERT INTO fixed_assets (name, type, value, currency, display_order) VALUES (?, ?, ?, ?, ?)',
      ['Primary Residence', 'real_estate', 500000, 'USD', 0]
    );

    // Export the data
    const exportedData = await exportData(connection);

    // Verify export structure
    expect(exportedData).toHaveProperty('exportDate');
    expect(exportedData).toHaveProperty('version');
    expect(exportedData.version).toBe('2.0');
    expect(exportedData).toHaveProperty('data');
    expect(exportedData.data).toHaveProperty('accounts');
    expect(exportedData.data).toHaveProperty('positions');
    expect(exportedData.data).toHaveProperty('fixed_assets');

    // Verify exported data
    expect(exportedData.data.accounts).toHaveLength(1);
    expect(exportedData.data.accounts[0].name).toBe('Test Brokerage');
    expect(exportedData.data.positions).toHaveLength(2);
    expect(exportedData.data.fixed_assets).toHaveLength(1);

    // Clear database
    await connection.execute('DELETE FROM positions');
    await connection.execute('DELETE FROM accounts');
    await connection.execute('DELETE FROM fixed_assets');

    // Verify database is empty
    const [accountsCheck] = await connection.execute('SELECT COUNT(*) as count FROM accounts');
    expect(accountsCheck[0].count).toBe(0);

    // Re-import the data
    await importData(connection, exportedData);

    // Verify re-imported data
    const [accounts] = await connection.execute('SELECT * FROM accounts WHERE id = 100');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Test Brokerage');
    expect(accounts[0].currency).toBe('USD');

    const [positions] = await connection.execute('SELECT * FROM positions WHERE account_id = 100 ORDER BY ticker');
    expect(positions).toHaveLength(2);
    expect(positions[0].ticker).toBe('AAPL');
    expect(positions[0].description).toBe('Apple Inc.');
    expect(parseFloat(positions[0].quantity)).toBe(50);
    expect(positions[1].ticker).toBe('USD');
    expect(parseFloat(positions[1].quantity)).toBe(5000);

    const [fixedAssets] = await connection.execute('SELECT * FROM fixed_assets');
    expect(fixedAssets).toHaveLength(1);
    expect(fixedAssets[0].name).toBe('Primary Residence');
    expect(parseFloat(fixedAssets[0].value)).toBe(500000);

    // Cleanup
    await connection.execute('DELETE FROM positions WHERE account_id = 100');
    await connection.execute('DELETE FROM accounts WHERE id = 100');
    await connection.execute('DELETE FROM fixed_assets');
  }, 60000);

  test('Export with all position field types', async () => {
    // Clean up first
    await connection.execute('DELETE FROM positions');
    await connection.execute('DELETE FROM accounts');

    // Get or create an account type
    const [accountTypes] = await connection.execute(
      'SELECT id FROM account_types LIMIT 1'
    );
    const accountTypeId = accountTypes[0]?.id || 1;

    // Insert test account
    await connection.execute(
      'INSERT INTO accounts (id, name, account_type_id, currency) VALUES (?, ?, ?, ?)',
      [101, 'Test Account', accountTypeId, 'USD']
    );

    // Insert positions with various field combinations
    await connection.execute(
      'INSERT INTO positions (account_id, ticker, description, quantity, type, exchange, currency, normalized_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [101, 'MSFT', 'Microsoft Corp', 100, 'stock', 'NASDAQ', 'USD', 'MSFT']
    );

    await connection.execute(
      'INSERT INTO positions (account_id, ticker, quantity, type, currency, maturity_date, coupon) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [101, 'US10Y', 10000, 'bond', 'USD', '2035-12-31', 4.5]
    );

    // Export
    const exportedData = await exportData(connection);

    // Verify all fields are present
    expect(exportedData.data.positions).toHaveLength(2);

    const stockPosition = exportedData.data.positions.find(p => p.ticker === 'MSFT');
    expect(stockPosition).toBeDefined();
    expect(stockPosition.description).toBe('Microsoft Corp');
    expect(stockPosition.exchange).toBe('NASDAQ');
    expect(stockPosition.normalized_key).toBe('MSFT');

    const bondPosition = exportedData.data.positions.find(p => p.ticker === 'US10Y');
    expect(bondPosition).toBeDefined();
    expect(bondPosition.maturity_date).toBeDefined();
    expect(parseFloat(bondPosition.coupon)).toBe(4.5);

    // Cleanup
    await connection.execute('DELETE FROM positions WHERE account_id = 101');
    await connection.execute('DELETE FROM accounts WHERE id = 101');
  }, 60000);
});
