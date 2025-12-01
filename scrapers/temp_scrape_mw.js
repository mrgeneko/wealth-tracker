
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // Set a real user agent to avoid detection
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const url = 'https://www.marketwatch.com/investing/stock/brk.b?mod=mw_quote_switch';
  console.log(`Navigating to ${url}...`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait a bit for dynamic content
    await new Promise(r => setTimeout(r, 5000));

    const html = await page.content();
    fs.writeFileSync('mw_dump.html', html);
    console.log('HTML saved to mw_dump.html');
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await browser.close();
  }
})();
