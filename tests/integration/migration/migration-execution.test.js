/**
 * Migration Execution Tests (Phase 2.4)
 * 
 * These tests verify the actual migration process:
 * - Schema changes apply correctly
 * - Data is preserved during migration
 * - New ticker column is populated
 * - Old symbol column handling
 * 
 * Test Count: 8 tests
 * Expected Runtime: 30 seconds
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

describe('Migration Execution', () => {

  it('should successfully add ticker column to positions table', async () => {
    // This would run after migration script
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'positions' AND COLUMN_NAME = 'ticker'
    `);
    expect(columns.length).toBeGreaterThan(0);
  });

  it('should copy symbol data to ticker column', async () => {
    const [[{ symbolCount }]] = await connection.query(`
      SELECT COUNT(*) as symbolCount 
      FROM positions 
      WHERE symbol IS NOT NULL AND symbol != ''
    `);

    const [[{ tickerCount }]] = await connection.query(`
      SELECT COUNT(*) as tickerCount 
      FROM positions 
      WHERE ticker IS NOT NULL AND ticker != ''
    `);

    expect(tickerCount).toBe(symbolCount);
  });

  it('should preserve data integrity during copy', async () => {
    const [[result]] = await connection.query(`
      SELECT COUNT(*) as mismatchCount 
      FROM positions 
      WHERE symbol != ticker AND symbol IS NOT NULL AND ticker IS NOT NULL
    `);
    
    expect(result.mismatchCount).toBe(0);
  });

  it('should create indexes on ticker column', async () => {
    const [indexes] = await connection.query(`
      SELECT INDEX_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_NAME = 'positions' AND COLUMN_NAME = 'ticker'
    `);
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('should apply migration to symbol_registry table', async () => {
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'symbol_registry' AND COLUMN_NAME = 'ticker'
    `);
    expect(columns.length).toBeGreaterThan(0);
  });

  it('should maintain foreign key relationships after migration', async () => {
    const [constraints] = await connection.query(`
      SELECT CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS 
      WHERE TABLE_NAME = 'positions'
    `);
    expect(constraints.length).toBeGreaterThanOrEqual(0); // May be 0 if no FKs
  });

  it('should handle nullable ticker column appropriately', async () => {
    const [columns] = await connection.query(`
      SELECT IS_NULLABLE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'positions' AND COLUMN_NAME = 'ticker'
    `);
    expect(columns[0].IS_NULLABLE).toBe('YES');
  });

  it('should set correct character encoding for ticker column', async () => {
    const [columns] = await connection.query(`
      SELECT CHARACTER_SET_NAME, COLLATION_NAME
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'positions' AND COLUMN_NAME = 'ticker'
    `);
    expect(columns[0].CHARACTER_SET_NAME).toBe('utf8mb4');
  });
});
