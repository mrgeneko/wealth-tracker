// Jest setup file
// Runs before all tests to configure the test environment

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
process.env.MYSQL_PORT = process.env.MYSQL_PORT || '3306';
process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'testdb';
process.env.MYSQL_USER = process.env.MYSQL_USER || 'test';
process.env.MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'test';

// Suppress console output during tests unless explicitly needed
if (!process.env.VERBOSE_TESTS) {
  global.console = {
    ...console,
    log: jest.fn(), // Mock console.log
    debug: jest.fn(), // Mock console.debug
    info: jest.fn(), // Mock console.info
    warn: jest.fn(), // Keep warnings visible in tests
    error: jest.fn() // Keep errors visible in tests
  };
}

// Set reasonable timeouts for async operations
jest.setTimeout(5000);

// Add custom matchers if needed
expect.extend({
  toBeValidSymbol(received) {
    const pass = /^[A-Z]{1,5}(\.[A-Z])?$/.test(received);
    return {
      pass,
      message: () => `expected ${received} to be a valid stock symbol`
    };
  },
  
  toBeValidExchange(received) {
    const pass = ['NASDAQ', 'NYSE', 'OTHER', null].includes(received);
    return {
      pass,
      message: () => `expected ${received} to be a valid exchange (NASDAQ, NYSE, OTHER, or null)`
    };
  }
});
