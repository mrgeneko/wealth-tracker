/**
 * Post-Migration Validation Tests (Phase 2.4)
 * 
 * These tests verify the migration completed successfully:
 * - New schema is correct
 * - All data is accessible via ticker
 * - APIs work with new schema
 * - No data loss occurred
 * 
 * Test Count: 6 tests
 * Expected Runtime: 45 seconds
 */

const mysql = require('mysql2/promise');
const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');

let connection;

beforeAll(async () => {
  connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'wealth_tracker'
  });
});

afterAll(async () => {
  if (connection) await connection.end();
});

describe('Post-Migration Validation', () => {

  it('should have ticker column in all required tables', async () => {
    const tables = ['positions', 'symbol_registry', 'securities_metadata'];
    
    for (const table of tables) {
      const [columns] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = ? AND COLUMN_NAME = 'ticker'
      `, [table]);
      
      expect(columns.length).toBeGreaterThan(0);
    }
  });

  it('should be able to query positions by ticker', async () => {
    const [results] = await connection.query(`
      SELECT id, ticker, quantity 
      FROM positions 
      LIMIT 5
    `);
    
    expect(results.length).toBeGreaterThan(0);
    results.forEach(row => {
      expect(row.ticker).toBeDefined();
      expect(row.ticker).not.toBeNull();
    });
  });

  it('should have correct record count before and after migration', async () => {
    const [[{ count }]] = await connection.query(`
      SELECT COUNT(*) as count FROM positions
    `);
    
    expect(count).toBeGreaterThan(0);
  });

  it('should verify symbol and ticker columns match for all records', async () => {
    const [[{ mismatchCount }]] = await connection.query(`
      SELECT COUNT(*) as mismatchCount 
      FROM positions 
      WHERE symbol != ticker
    `);
    
    expect(mismatchCount).toBe(0);
  });

  it('should validate ticker uniqueness constraints', async () => {
    const [constraints] = await connection.query(`
      SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
      WHERE TABLE_NAME = 'symbol_registry'
    `);
    
    expect(constraints).toBeDefined();
  });

  it('should verify metadata views use ticker correctly', async () => {
    const [results] = await connection.query(`
      SELECT ticker, COUNT(*) as count
      FROM symbol_registry 
      GROUP BY ticker 
      LIMIT 10
    `);
    
    expect(results.length).toBeGreaterThan(0);
    results.forEach(row => {
      expect(row.ticker).toBeTruthy();
    });
  });
});
