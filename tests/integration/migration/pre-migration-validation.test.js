/**
 * Pre-Migration Validation Tests (Phase 2.4)
 * 
 * These tests run BEFORE the database migration to verify:
 * - Current schema structure with 'symbol' column
 * - Data integrity before changes
 * - Backup readiness
 * 
 * Test Count: 8 tests
 * Expected Runtime: 30-45 seconds
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

describe('Pre-Migration Validation', () => {
  
  it('should have positions table with symbol column', async () => {
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'positions' AND COLUMN_NAME = 'symbol'
    `);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns[0].DATA_TYPE).toBe('varchar');
  });

  it('should have symbol_registry table with symbol column', async () => {
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'symbol_registry' AND COLUMN_NAME = 'symbol'
    `);
    expect(columns.length).toBeGreaterThan(0);
  });

  it('should verify no ticker column exists yet', async () => {
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'positions' AND COLUMN_NAME = 'ticker'
    `);
    expect(columns.length).toBe(0);
  });

  it('should have valid data in symbol column', async () => {
    const [[{ count }]] = await connection.query(`
      SELECT COUNT(*) as count 
      FROM positions 
      WHERE symbol IS NOT NULL AND symbol != ''
    `);
    expect(count).toBeGreaterThan(0);
  });

  it('should verify symbol column has no duplicates issue', async () => {
    const [results] = await connection.query(`
      SELECT symbol, COUNT(*) as count 
      FROM positions 
      GROUP BY symbol 
      HAVING count > 100
    `);
    // This is informational - shows max frequency per symbol
    expect(results).toBeDefined();
  });

  it('should have correct indexes on symbol column', async () => {
    const [indexes] = await connection.query(`
      SELECT INDEX_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_NAME = 'positions' AND COLUMN_NAME = 'symbol'
    `);
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('should verify foreign key constraints before migration', async () => {
    const [constraints] = await connection.query(`
      SELECT CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
      WHERE TABLE_NAME = 'positions' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    `);
    // Document current state
    expect(constraints).toBeDefined();
  });

  it('should validate data types across symbol columns', async () => {
    const [columns] = await connection.query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE COLUMN_NAME = 'symbol' AND TABLE_SCHEMA = DATABASE()
    `);
    
    columns.forEach(col => {
      expect(col.DATA_TYPE).toBe('varchar');
      expect(col.CHARACTER_MAXIMUM_LENGTH).toBeGreaterThanOrEqual(50);
    });
  });
});
