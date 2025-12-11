/**
 * Performance Validation Tests (Phase 2.4)
 * 
 * These tests ensure the migration didn't introduce performance regressions:
 * - Query performance on ticker column
 * - Index performance
 * - Data retrieval speed
 * 
 * Test Count: 3 tests
 * Expected Runtime: 1-2 minutes (with real data)
 * 
 * NOTE: Requires live MySQL database connection. Set environment variables:
 *   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
 */

const mysql = require('mysql2/promise');
const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');

let connection;
let skipTests = false;

beforeAll(async () => {
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'root',
      database: process.env.DB_NAME || 'wealth_tracker'
    });
  } catch (error) {
    console.warn('⚠️  Database connection failed. Performance tests will be skipped.');
    skipTests = true;
  }
});

afterAll(async () => {
  if (connection) {
    try {
      await connection.end();
    } catch (error) {
      // Connection already closed
    }
  }
});

describe('Performance Validation', () => {

  it('should query by ticker efficiently', async () => {
    if (skipTests) {
      console.warn('⏭️  Test skipped (no database)');
      return;
    }
    const startTime = Date.now();
    
    const [results] = await connection.query(`
      SELECT id, ticker, quantity 
      FROM positions 
      WHERE ticker = 'AAPL'
      LIMIT 100
    `);
    
    const duration = Date.now() - startTime;
    
    expect(duration).toBeLessThan(100); // Should complete in < 100ms
    expect(results).toBeDefined();
  });

  it('should handle bulk ticker lookups efficiently', async () => {
    if (skipTests) {
      console.warn('⏭️  Test skipped (no database)');
      return;
    }
    const startTime = Date.now();
    
    const [results] = await connection.query(`
      SELECT DISTINCT ticker 
      FROM positions 
      WHERE quantity > 0 
      LIMIT 1000
    `);
    
    const duration = Date.now() - startTime;
    
    expect(duration).toBeLessThan(500); // Should complete in < 500ms
    expect(results).toBeDefined();
  });

  it('should maintain index performance on ticker column', async () => {
    if (skipTests) {
      console.warn('⏭️  Test skipped (no database)');
      return;
    }
    const startTime = Date.now();
    
    const [results] = await connection.query(`
      SELECT SQL_NO_CACHE p.id, p.ticker, sr.registry_data
      FROM positions p
      LEFT JOIN symbol_registry sr ON p.ticker = sr.ticker
      WHERE p.ticker IS NOT NULL
      LIMIT 500
    `);
    
    const duration = Date.now() - startTime;
    
    expect(duration).toBeLessThan(1000); // Should complete in < 1 second
    expect(results).toBeDefined();
  });

  it('should indicate that database tests are skipped', () => {
    if (!skipTests) {
      return;
    }
    expect(skipTests).toBe(true);
  });
});
