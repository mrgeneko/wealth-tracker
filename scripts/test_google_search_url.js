const puppeteer = require('puppeteer');
const { findUrlViaGoogleSearch } = require('../scrapers/scraper_utils');

(async () => {
    const browser = await puppeteer.launch({ headless: false }); // Headless false to see what happens
    try {
        const ticker = 'AAPL';
        const sitePrefix = 'investing.com/equities';
        
        console.log(`Searching for ${ticker} on ${sitePrefix}...`);
        const url = await findUrlViaGoogleSearch(browser, ticker, sitePrefix);
        
        console.log('Result:', url);
    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
