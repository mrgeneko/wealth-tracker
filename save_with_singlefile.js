console.log('VERSION:6');
const puppeteer = require('puppeteer');
const fs = require('fs');
function getTimestampedLogPath() {
  const now = new Date();
  const pad = n => n.toString().padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `/usr/src/app/logs/save_with_singlefile.${y}${m}${d}_${h}${min}${s}.log`;
}
const debugLogPath = getTimestampedLogPath();
function logDebug(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(debugLogPath, line);
}
const path = require('path');
// Add puppeteer-extra and stealth plugin
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());



const http = require('http');
async function saveWithSingleFile(url, outputDir, extensionPath) {
  try {
    logDebug('Connecting to existing Chrome instance...');
    // Fetch the WebSocket endpoint from the running Chrome
    const wsEndpoint = await new Promise((resolve, reject) => {
      http.get('http://localhost:9222/json/version', res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.webSocketDebuggerUrl);
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });

    logDebug('Opening new page...');
    const page = await browser.newPage();

    // Set download behavior (Chrome 111+)
    logDebug('Setting download behavior...');
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: outputDir
    });

    logDebug('Navigating to URL: ' + url);
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Focus the browser window
    logDebug('Focusing browser window...');
    await page.bringToFront();
    logDebug('Window focused. Waiting 5 seconds before sending xdotool shortcut...');
    await new Promise(r => setTimeout(r, 5000));
    try {
      // Ensure DISPLAY is set for xdotool
      process.env.DISPLAY = ':99';
      const { execSync } = require('child_process');
      // Find the Chrome window ID
      logDebug('Finding Chrome window ID with xdotool...');
      const winId = execSync("xdotool search --onlyvisible --class 'chrome' | head -n 1").toString().trim();
      logDebug('Chrome window ID: ' + winId);
      if (!winId) throw new Error('Could not find Chrome window ID');
      // Send Ctrl+Shift+Y to the Chrome window
      logDebug('Sending Ctrl+Shift+Y to Chrome window using xdotool...');
      execSync(`xdotool windowactivate --sync ${winId} key --clearmodifiers ctrl+shift+y`);
      logDebug('xdotool shortcut sent. Waiting for save to complete...');
      await new Promise(r => setTimeout(r, 15000));
    } catch (e) {
      logDebug('Failed to trigger SingleFile via xdotool: ' + e.message);
    }

    // Do not close the browser, just disconnect
    await browser.disconnect();
    logDebug('Done.');
  } catch (err) {
    logDebug('Error in saveWithSingleFile: ' + err);
  }
}

async function scrapeInvestingComMonitor(outputDir, extensionPath) {
  const investingUrl = 'https://www.investing.com/portfolio/?portfolioID=Z2RkM2YyPms1ZTo3ZjBjaA%3D%3D';
  const investingEmail = '***REMOVED***';
  const investingPassword = '***REMOVED***';
  try {
    logDebug('Launching browser for Investing.com...');
    logDebug(`outputDir: ${outputDir}, extensionPath: ${extensionPath}`);
    // Use a persistent user-data-dir for extension reliability
    const persistentProfileDir = '/tmp/chrome-profile2';
    const browser = await puppeteerExtra.launch({
      headless: false,
      executablePath: '/opt/google/chrome/chrome',
      args: [
        `--load-extension=${extensionPath}`,
        `--disable-extensions-except=${extensionPath}`,
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--display=:99',
        `--user-data-dir=${persistentProfileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--remote-debugging-port=9222',
        '--disable-features=AudioServiceOutOfProcess',
        '--disable-component-update',
        '--disable-background-networking',
        '--disable-domain-reliability'
      ],
      env: {
        ...process.env,
        DISPLAY: ':99',
        CHROME_DISABLE_UPDATE: '1'
      }
    });

    // Close all initial tabs (about:blank, etc.)
    logDebug('Closing initial tabs...');
    const initialPages = await browser.pages();
    for (const p of initialPages) {
      await p.close();
    }

    // Open the SingleFile extension's popup page to initialize the extension
    logDebug('Opening SingleFile extension popup to initialize extension...');
    const extensionId = 'jancglblobklnlpiikeddjijmfgakbla';
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const popup = await browser.newPage();
    await popup.goto(popupUrl);
    await new Promise(r => setTimeout(r, 2000));
    await popup.close();
    // Always use a new tab for the automation
    logDebug('Opening new page...');
    const page = await browser.newPage();
    // Set a realistic user agent
    logDebug('Setting user agent and viewport, navigating to Investing.com...');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    logDebug('Navigating to: ' + investingUrl);
    await page.goto(investingUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    logDebug('Navigation complete.');

        // ...existing code...
    // ...existing code...
    // ...existing code...

    // Close all other tabs except the current one (Investing.com)
    const allPages = await browser.pages();
    for (const p of allPages) {
      if (p !== page) {
        try { await p.close(); } catch (e) {}
      }
    }
    // Bring the Investing.com tab to the front
    await page.bringToFront();
    logDebug('Page brought to front.');

    // Set download behavior
    logDebug('Setting download behavior...');
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: outputDir
    });
    logDebug('Download behavior set.');

    // Check for login form
    let needsLogin = false;
    try {
      logDebug('Checking for login form...');
      await page.waitForSelector('#loginFormUser_email', { timeout: 5000 });
      needsLogin = true;
      logDebug('Login form detected.');
    } catch (e) {
      logDebug('No login form detected, likely already logged in.');
    }
    if (needsLogin) {
      logDebug('Typing email and password...');
      await page.type('#loginFormUser_email', investingEmail, { delay: 50 });
      await page.type('#loginForm_password', investingPassword, { delay: 50 });
      logDebug('Sending Enter key to submit login form...');
      await page.keyboard.press('Enter');
      logDebug('Waiting for My Watchlist heading or Summary tab after login...');
      // Wait for either the heading or the Summary tab link
      try {
        await Promise.race([
          page.waitForSelector('h1', { timeout: 10000 }).then(async h1 => {
            const text = await page.evaluate(el => el.textContent, h1);
            if (!text.includes('My Watchlist')) throw new Error('h1 does not contain My Watchlist');
          }),
          page.waitForSelector('a[name^="tab1_"][tab="overview"]', { timeout: 10000 })
        ]);
        logDebug('Login form submitted, My Watchlist heading or Summary tab found.');
      } catch (e) {
        logDebug('Login post-submit wait failed: ' + e.message);
        throw e;
      }
    }

    // Wait for 'My Watchlist' or Summary tab to be visible
    logDebug('Waiting for My Watchlist heading or Summary tab...');
    try {
      await Promise.race([
        page.waitForSelector('h1', { timeout: 10000 }).then(async h1 => {
          const text = await page.evaluate(el => el.textContent, h1);
          if (!text.includes('My Watchlist')) throw new Error('h1 does not contain My Watchlist');
        }),
        page.waitForSelector('a[name^="tab1_"][tab="overview"]', { timeout: 10000 })
      ]);
      logDebug('FOUND My Watchlist heading or Summary tab...');
    } catch (e) {
      logDebug('Wait for My Watchlist heading/Summary tab failed: ' + e.message);
      throw e;
    }

    // Wait for the watchlist table to load
    logDebug('Waiting for watchlist table to load...');
    try {
      await page.waitForSelector('[id^="tbody_overview_"]', { timeout: 7000 });
      logDebug('Watchlist table loaded. Extracting HTML...');
    } catch (e) {
      logDebug('Watchlist table did not load: ' + e.message);
      throw e;
    }
    const tableHtml = await page.$eval('[id^="tbody_overview_"]', el => el.outerHTML);

    // Use cheerio to parse the table HTML
    const cheerio = require('cheerio');
    const $ = cheerio.load(tableHtml);
    const requiredColumns = new Set(["symbol", "exchange", "last", "bid", "ask", "extended_hours", "extended_hours_percent", "open", "prev", "high", "low", "chg", "chgpercent", "vol", "next_earning", "time"]);
    const specificRowsJson = [];
    $('tr').each((i, row) => {
      const rowData = {};
      $(row).find('td').each((j, col) => {
        const columnName = $(col).attr('data-column-name');
        if (requiredColumns.has(columnName)) {
          rowData[columnName] = $(col).text().trim();
        }
      });
      if (Object.keys(rowData).length === requiredColumns.size) {
        specificRowsJson.push(rowData);
      }
    });

    // Write the parsed data to a JSON file in the outputDir
    const outPath = require('path').join(outputDir, `investing_com_watchlist_${Date.now()}.json`);
    require('fs').writeFileSync(outPath, JSON.stringify(specificRowsJson, null, 2), 'utf-8');
    logDebug(`Parsed data written to ${outPath}`);

    // Close the browser to release resources
    await browser.close();
    logDebug('Done. Browser closed.');
  } catch (err) {
    logDebug('Error in saveInvestingComMonitorWithSingleFile: ' + err);
  }
}

// Usage
const url = process.argv[2] || 'https://www.example.com';
const outputDir = process.argv[3] || '/usr/src/app/logs';
const extensionPath = '/opt/singlefile-extension';

// To use the new Investing.com monitor function, uncomment:
scrapeInvestingComMonitor(outputDir, extensionPath);

// Minimal test with saveWithSingleFile
//saveWithSingleFile('https://example.com', '/usr/src/app/logs', '/opt/singlefile-extension');
