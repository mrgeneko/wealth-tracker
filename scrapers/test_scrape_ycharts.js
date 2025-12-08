const puppeteer = require('puppeteer');
// const puppeteerExtra = require('puppeteer-extra');
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// puppeteerExtra.use(StealthPlugin());
const { scrapeYCharts } = require('./scrape_ycharts');
const path = require('path');

(async () => {
    console.log('Starting YCharts test...');
    
    // Launch browser
    const browser = await puppeteer.launch({
        headless: false, // Run headful to see what's happening
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1920,1080'
        ]
    });

    try {
        // Test data
        const { normalizedKey } = require('./scraper_utils');
        const security = {
            ticker: 'QQQ',
            ycharts: 'https://ycharts.com/companies/QQQ',
            type: 'etf',
            normalized_key: normalizedKey('QQQ')
        };

        const outputDir = path.join(__dirname, 'logs'); // Save logs to local logs folder
        
        // Ensure output dir exists
        const fs = require('fs');
        if (!fs.existsSync(outputDir)){
            fs.mkdirSync(outputDir);
        }

        console.log(`Scraping ${security.ticker} from ${security.ycharts}...`);
        const data = await scrapeYCharts(browser, security, outputDir);
        
        console.log('Scrape Result:');
        console.log(JSON.stringify(data, null, 2));

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
})();
