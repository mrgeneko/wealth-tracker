const { getConstructibleUrls } = require('../scrapers/scraper_utils');

const tickers = ['AAPL', 'WMT', 'BRK.B'];

console.log('Testing Constructible URLs with Exchange Info:');
tickers.forEach(ticker => {
    console.log(`\n--- ${ticker} ---`);
    const urls = getConstructibleUrls(ticker);
    urls.forEach(u => console.log(`${u.source}: ${u.url}`));
});
