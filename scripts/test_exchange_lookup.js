const { getExchange } = require('../scrapers/exchange_registry');

const testTickers = ['AAPL', 'GOOG', 'WMT', 'BRK.B', 'BRK-B', 'NVDA', 'UNKNOWN123'];

console.log('Testing Exchange Lookup:');
testTickers.forEach(ticker => {
    const exchange = getExchange(ticker);
    console.log(`${ticker}: ${exchange}`);
});
