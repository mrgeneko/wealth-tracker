console.log('SCRIPT VERSION: 2025-11-14');
const puppeteer = require('puppeteer');
const path = require('path');


async function saveWithSingleFile(url, outputDir, extensionPath) {
  try {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
      headless: false,
      executablePath: '/usr/bin/google-chrome',
      args: [
        `--load-extension=${extensionPath}`,
        `--disable-extensions-except=${extensionPath}`,
        '--no-sandbox',
        '--disable-gpu',
        '--display=:99',
        '--user-data-dir=/tmp/chrome-profile2',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=9222'
      ],
      env: {
        ...process.env,
        DISPLAY: ':99'
      }
    });


    console.log('Opening new page...');
    const page = await browser.newPage();

    // Set download behavior (Chrome 111+)
    console.log('Setting download behavior...');
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: outputDir
    });

    console.log('Navigating to URL:', url);
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Focus the browser window
    console.log('Focusing browser window...');
    await page.bringToFront();
    console.log('Window focused. Waiting 5 seconds before sending xdotool shortcut...');
    await new Promise(r => setTimeout(r, 5000));
    try {
      // Ensure DISPLAY is set for xdotool
      process.env.DISPLAY = ':99';
      const { execSync } = require('child_process');
      // Find the Chrome window ID
      console.log('Finding Chrome window ID with xdotool...');
      const winId = execSync("xdotool search --onlyvisible --class 'chrome' | head -n 1").toString().trim();
      console.log('Chrome window ID:', winId);
      if (!winId) throw new Error('Could not find Chrome window ID');
      // Send Ctrl+Shift+Y to the Chrome window
      console.log('Sending Ctrl+Shift+Y to Chrome window using xdotool...');
      execSync(`xdotool windowactivate --sync ${winId} key --clearmodifiers ctrl+shift+y`);
      console.log('xdotool shortcut sent. Waiting for save to complete...');
      await new Promise(r => setTimeout(r, 15000));
    } catch (e) {
      console.error('Failed to trigger SingleFile via xdotool:', e.message);
    }

    await browser.close();
    console.log('Done.');
  } catch (err) {
    console.error('Error in saveWithSingleFile:', err);
  }
}

// Usage
const url = process.argv[2] || 'https://www.example.com';
const outputDir = process.argv[3] || '/usr/src/app/logs';
const extensionPath = '/opt/singlefile-extension';

saveWithSingleFile(url, outputDir, extensionPath);
