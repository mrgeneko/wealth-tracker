(async () => {
  const puppeteer = require('puppeteer');
  const { scrapeWebullWatchlists } = require('../scrape_webull_watchlists');
  const path = require('path');
  const outputDir = path.join(__dirname, '..', 'logs');

  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const result = await scrapeWebullWatchlists(browser, { key: 'webull_test' }, outputDir);
    console.log('scrapeWebullWatchlists result:', result);
  } catch (e) {
    console.error('Test runner error:', e);
  } finally {
    if (browser) await browser.close();
  }
})();
