const { getConstructibleUrls } = require('../scrapers/scraper_utils');

const testCases = [
    { ticker: 'AAPL', type: 'stock' },
    { ticker: 'WMT', type: 'stock' },
    { ticker: 'BRK.B', type: 'stock' },
    { ticker: 'QQQ', type: 'etf' },
    { ticker: '91282CGA3', type: 'bond' }
];

console.log('Testing Constructible URLs with Exchange Info:');
testCases.forEach(({ ticker, type }) => {
    console.log(`\n--- ${ticker} (${type}) ---`);
    const urls = getConstructibleUrls(ticker, type);
    urls.forEach(u => console.log(`${u.source}: ${u.url}`));
});
