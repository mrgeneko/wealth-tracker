// Jest Configuration
// Separates unit tests from integration tests for CI efficiency

module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Coverage configuration
  collectCoverageFrom: [
    'scrapers/**/*.js',
    'api/**/*.js',
    'scripts/**/*.js',
    '!scrapers/logs/**',
    '!scrapers/scrape_daemon.js', // Daemon requires special testing
    '!scripts/archive/**', // Don't test archived migration scripts
    '!scripts/utilities/**', // Utility scripts are ad-hoc
    '!**/node_modules/**',
    '!**/temp_*.js',
    '!**/tmp_*.js',
    '!**/test_*.js'
  ],
  
  // Test match patterns
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/unit/**/*.unit.test.js',
    '!**/tests/integration/**',
    '!**/tests/unit/**/deprecated/**'
  ],
  
  // Coverage thresholds (start conservative, increase over time)
  coverageThreshold: {
    global: {
      statements: 2,
      branches: 1,
      functions: 5,
      lines: 2
    }
  },
  
  // Timeout for tests (5 seconds default)
  testTimeout: 5000,
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Collect coverage by default when running tests
  collectCoverage: false, // Set to true in CI
  
  // Coverage output directory
  coverageDirectory: 'coverage',
  
  // Coverage reporters
  coverageReporters: ['text', 'lcov', 'html'],
  
  // Module paths
  moduleDirectories: ['node_modules', '<rootDir>'],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};
