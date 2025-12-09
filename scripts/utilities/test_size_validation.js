const fs = require('fs');
const path = require('path');
const { needsUpdate } = require('./update_exchange_listings');

const CONFIG_DIR = path.join(__dirname, '../config');
const NASDAQ_FILE = path.join(CONFIG_DIR, 'nasdaq-listed.csv');
const TEST_FILE = path.join(CONFIG_DIR, 'test-size-validation.csv');

// Create a test file that's much smaller than the real NASDAQ file
console.log('Creating test file with reduced size...');

// Read the real NASDAQ file
const realContent = fs.readFileSync(NASDAQ_FILE, 'utf8');
const realLines = realContent.split('\n').length;
const realSize = Buffer.byteLength(realContent, 'utf8');

// Create a test file with only 10% of the content (simulating a truncated file)
const linesToKeep = Math.floor(realLines * 0.1);
const testContent = realContent.split('\n').slice(0, linesToKeep).join('\n');

fs.writeFileSync(TEST_FILE, testContent, 'utf8');
console.log(`Created test file with ${linesToKeep} lines (10% of original)`);
console.log(`Original size: ${realSize} bytes`);
console.log(`Test file size: ${Buffer.byteLength(testContent, 'utf8')} bytes`);

// Test the size validation
console.log('\nTesting size validation...');
const shouldUpdate = needsUpdate(NASDAQ_FILE, testContent);

console.log(`\nResult: ${shouldUpdate ? 'Update would proceed' : 'Update blocked by size validation'}`);

// Clean up
fs.unlinkSync(TEST_FILE);
console.log('\nTest file cleaned up.');

// Test with a normal size difference
console.log('\nTesting with normal size difference...');
const slightlySmallerContent = realContent.split('\n').slice(0, realLines - 10).join('\n');
fs.writeFileSync(TEST_FILE, slightlySmallerContent, 'utf8');
console.log(`Created test file with ${realLines - 10} lines (slightly smaller than original)`);
console.log(`Original size: ${realSize} bytes`);
console.log(`Test file size: ${Buffer.byteLength(slightlySmallerContent, 'utf8')} bytes`);

const shouldUpdate2 = needsUpdate(NASDAQ_FILE, slightlySmallerContent);
console.log(`\nResult: ${shouldUpdate2 ? 'Update would proceed' : 'Update blocked by size validation'}`);

// Clean up
fs.unlinkSync(TEST_FILE);
console.log('\nTest file cleaned up.');