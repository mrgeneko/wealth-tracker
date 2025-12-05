const puppeteer = require('puppeteer');
const { scrapeGoogle } = require('./scrapers/scrape_google');

async function testGoogleScraper() {
    let browser;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({ headless: true });
        const security = {
            key: 'BRK.B',
            google: 'https://www.google.com/finance/quote/BRK.B:NYSE'
        };
        console.log('Calling scrapeGoogle...');
        const result = await scrapeGoogle(browser, security, './data');
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
}

testGoogleScraper();