const fs = require('fs');
const path = require('path');
const { needsUpdate } = require('./update_exchange_data');

const CONFIG_DIR = path.join(__dirname, '../config');
const NASDAQ_FILE = path.join(CONFIG_DIR, 'nasdaq-listed.csv');

// Read the real NASDAQ file
const realContent = fs.readFileSync(NASDAQ_FILE, 'utf8');
const realSize = Buffer.byteLength(realContent, 'utf8');

// Create a test file that's exactly 1% smaller
const onePercentSmallerSize = Math.floor(realSize * 0.99);
const onePercentSmallerContent = realContent.substring(0, onePercentSmallerSize);

const TEST_FILE = path.join(CONFIG_DIR, 'test-edge-case.csv');
fs.writeFileSync(TEST_FILE, onePercentSmallerContent, 'utf8');

console.log('Testing edge case - exactly 1% smaller file...');
console.log(`Original size: ${realSize} bytes`);
console.log(`Test file size: ${onePercentSmallerSize} bytes`);
console.log(`Size difference: ${((realSize - onePercentSmallerSize) / realSize * 100).toFixed(2)}%`);

const shouldUpdate = needsUpdate(NASDAQ_FILE, onePercentSmallerContent);
console.log(`\nResult: ${shouldUpdate ? 'Update would proceed' : 'Update blocked by size validation'}`);

// Clean up
fs.unlinkSync(TEST_FILE);
console.log('\nTest file cleaned up.');

// Test with 0.99% smaller (should allow update)
const pointNineNinePercentSmallerSize = Math.floor(realSize * 0.9901);
const pointNineNinePercentSmallerContent = realContent.substring(0, pointNineNinePercentSmallerSize);
fs.writeFileSync(TEST_FILE, pointNineNinePercentSmallerContent, 'utf8');

console.log('\nTesting edge case - 0.99% smaller file...');
console.log(`Original size: ${realSize} bytes`);
console.log(`Test file size: ${pointNineNinePercentSmallerSize} bytes`);
console.log(`Size difference: ${((realSize - pointNineNinePercentSmallerSize) / realSize * 100).toFixed(4)}%`);

const shouldUpdate2 = needsUpdate(NASDAQ_FILE, pointNineNinePercentSmallerContent);
console.log(`\nResult: ${shouldUpdate2 ? 'Update would proceed' : 'Update blocked by size validation'}`);

// Clean up
fs.unlinkSync(TEST_FILE);
console.log('\nTest file cleaned up.');