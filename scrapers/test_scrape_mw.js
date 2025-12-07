
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { scrapeMarketWatch } = require('./scrape_marketwatch');

(async () => {
  // Launch with headful mode so we can see what's happening
  const browser = await puppeteer.launch({
    headless: false, 
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const { normalizedKey } = require('./scraper_utils');
  const security = {
    key: 'BRK.B',
    marketwatchUrl: 'https://www.marketwatch.com/investing/stock/brk.b?mod=mw_quote_switch',
    normalized_key: normalizedKey('BRK.B')
  };
  
  try {
    console.log('Starting scrape...');
    const data = await scrapeMarketWatch(browser, security, '.');
    console.log('Scraped Data:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await browser.close();
  }
})();
