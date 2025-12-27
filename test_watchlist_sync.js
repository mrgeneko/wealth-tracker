const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { scrapeInvestingComWatchlists } = require('./scrapers/scrape_investingcom_watchlists');
const path = require('path');
require('dotenv').config();
process.env.MYSQL_HOST = '127.0.0.1'; // Force localhost for test
process.env.LOG_DIR = path.join(__dirname, 'logs'); // Force local logs dir


(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    console.log('Browser launched. Configured URL: https://www.investing.com/portfolio/?portfolioID=MTI/aGQwNmMxYT0wZDI4Mw==');

    const watchlist = {
        key: 'primary',
        // Use the URL found in database
        url: 'https://www.investing.com/portfolio/?portfolioID=MTI/aGQwNmMxYT0wZDI4Mw=='
    };

    const outputDir = path.join(__dirname, 'test_output');
    if (!require('fs').existsSync(outputDir)) require('fs').mkdirSync(outputDir);

    try {
        console.log('Running scrapeInvestingComWatchlists (should trigger Sync)...');
        await scrapeInvestingComWatchlists(browser, watchlist, outputDir);
        console.log('Scrape function completed.');
    } catch (e) {
        console.error('Test Error:', e);
    } finally {
        await browser.close();
        process.exit(0);
    }
})();
