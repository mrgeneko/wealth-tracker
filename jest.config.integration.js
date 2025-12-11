// Jest Configuration for Integration Tests
// Allows integration tests to run with proper configuration

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Test match patterns - ONLY integration tests
  testMatch: [
    '**/tests/integration/**/*.test.js',
    '!**/tests/unit/**'
  ],

  // Timeout for integration tests (60 seconds - they may be slower)
  testTimeout: 60000,

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Collect coverage by default when running tests
  collectCoverage: false,

  // Coverage output directory
  coverageDirectory: 'coverage',

  // Module paths
  moduleDirectories: ['node_modules', '<rootDir>'],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};
