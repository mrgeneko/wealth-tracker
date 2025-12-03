const { loadExchangeData, getExchange, reloadExchangeData } = require('../scrapers/exchange_registry');

console.log('Testing loadExchangeData() function...\n');

// Test 1: Load exchange data
console.log('Test 1: Loading exchange data...');
const exchangeData = loadExchangeData();
console.log('Exchange data loaded successfully:', exchangeData);
console.log('NASDAQ symbols count:', exchangeData.NASDAQ.size);
console.log('NYSE symbols count:', exchangeData.NYSE.size);
console.log('');

// Test 2: Test caching mechanism
console.log('Test 2: Testing caching mechanism...');
const exchangeData2 = loadExchangeData();
console.log('Second load returns same object:', exchangeData === exchangeData2);
console.log('');

// Test 3: Test specific symbols
console.log('Test 3: Testing specific symbols...');
const testSymbols = ['AAPL', 'MSFT', 'BRK.B', 'GOOGL', 'AMZN'];
testSymbols.forEach(symbol => {
    const exchange = getExchange(symbol);
    console.log(`${symbol}: ${exchange || 'Not found'}`);
});
console.log('');

// Test 4: Test reload functionality
console.log('Test 4: Testing reload functionality...');
reloadExchangeData();
const exchangeData3 = loadExchangeData();
console.log('After reload - same object (expected):', exchangeData === exchangeData3);
console.log('After reload - NASDAQ symbols count:', exchangeData3.NASDAQ.size);
console.log('After reload - NYSE symbols count:', exchangeData3.NYSE.size);
console.log('');

console.log('All tests completed!');