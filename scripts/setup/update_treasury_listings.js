/**
 * Update Treasury Securities Listings
 * 
 * Downloads Treasury Securities Auctions Data from fiscaldata.treasury.gov
 * This data includes auction information for US Treasury bills, notes, and bonds.
 * 
 * The Treasury website generates CSV files client-side using blob URLs, so we use
 * Puppeteer to automate the browser-based download process.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const CONFIG_DIR = path.join(__dirname, '../config');
const TREASURY_FILE = path.join(CONFIG_DIR, 'us-treasury-auctions.csv');
const TREASURY_URL = 'https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/treasury-securities-auctions-data';

/**
 * Fallback: Use Puppeteer to download from the website
 * This handles the blob URL download by clicking the CSV download button
 */
async function downloadViaPuppeteer() {
    console.log('Attempting download via Puppeteer...');
    
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
        const page = await browser.newPage();
        
        // Set up download handling
        const downloadPath = CONFIG_DIR;
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath
        });

        // Set viewport and user agent
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log(`Navigating to ${TREASURY_URL}`);
        await page.goto(TREASURY_URL, { waitUntil: 'networkidle0', timeout: 90000 });
        console.log('Page loaded');
        
        // Wait for the page to fully load
        console.log('Waiting for download button...');
        await page.waitForSelector('[data-testid="csv-download-button"]', { timeout: 60000 });
        
        console.log('Found CSV download button, clicking...');
        
        // Get the current filename from the download link
        const downloadFilename = await page.$eval('[data-testid="csv-download-button"]', el => el.getAttribute('download'));
        console.log(`Expected filename: ${downloadFilename}`);
        
        // Click the download button
        await page.click('[data-testid="csv-download-button"]');
        
        // Wait for download to complete (give it some time)
        console.log('Waiting for download to complete...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Check if the file was downloaded and rename it
        const expectedPath = path.join(downloadPath, downloadFilename);
        if (fs.existsSync(expectedPath)) {
            const newFileSize = fs.statSync(expectedPath).size;
            
            // Check if new file is significantly smaller than existing file
            if (fs.existsSync(TREASURY_FILE)) {
                const oldFileSize = fs.statSync(TREASURY_FILE).size;
                const sizeReduction = (oldFileSize - newFileSize) / oldFileSize;
                
                if (sizeReduction > 0.05) {
                    console.warn(`WARNING: New file is ${(sizeReduction * 100).toFixed(1)}% smaller than existing file`);
                    console.warn(`  Old size: ${oldFileSize} bytes, New size: ${newFileSize} bytes`);
                    console.warn('Aborting update to prevent data loss. Delete the old file manually if this is intentional.');
                    fs.unlinkSync(expectedPath); // Clean up downloaded file
                    return false;
                }
                
                // Backup existing file
                const backupPath = `${TREASURY_FILE}.backup.${Date.now()}`;
                fs.renameSync(TREASURY_FILE, backupPath);
            }
            fs.renameSync(expectedPath, TREASURY_FILE);
            console.log(`Downloaded and saved to ${TREASURY_FILE}`);
            return true;
        } else {
            // Try to find any recently downloaded CSV file
            const files = fs.readdirSync(downloadPath)
                .filter(f => f.endsWith('.csv') && f.includes('Auctions'))
                .map(f => ({
                    name: f,
                    path: path.join(downloadPath, f),
                    mtime: fs.statSync(path.join(downloadPath, f)).mtime
                }))
                .sort((a, b) => b.mtime - a.mtime);
            
            if (files.length > 0) {
                const newFileSize = fs.statSync(files[0].path).size;
                
                // Check if new file is significantly smaller than existing file
                if (fs.existsSync(TREASURY_FILE)) {
                    const oldFileSize = fs.statSync(TREASURY_FILE).size;
                    const sizeReduction = (oldFileSize - newFileSize) / oldFileSize;
                    
                    if (sizeReduction > 0.05) {
                        console.warn(`WARNING: New file is ${(sizeReduction * 100).toFixed(1)}% smaller than existing file`);
                        console.warn(`  Old size: ${oldFileSize} bytes, New size: ${newFileSize} bytes`);
                        console.warn('Aborting update to prevent data loss. Delete the old file manually if this is intentional.');
                        fs.unlinkSync(files[0].path); // Clean up downloaded file
                        return false;
                    }
                    
                    const backupPath = `${TREASURY_FILE}.backup.${Date.now()}`;
                    fs.renameSync(TREASURY_FILE, backupPath);
                }
                fs.renameSync(files[0].path, TREASURY_FILE);
                console.log(`Downloaded and saved to ${TREASURY_FILE}`);
                return true;
            }
            
            console.log('Download file not found');
            return false;
        }
    } catch (error) {
        console.error('Puppeteer download failed:', error.message);
        return false;
    } finally {
        await browser.close();
    }
}

/**
 * Main function to update Treasury listings
 */
async function updateTreasuryListings() {
    try {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }

        console.log('Updating US Treasury Securities Auction listings...');
        
        // Use Puppeteer to download (API endpoint doesn't exist for this dataset)
        let success = await downloadViaPuppeteer();
        
        if (success) {
            console.log('Treasury securities listings updated successfully.');
            
            // Parse and display some stats about the downloaded file
            if (fs.existsSync(TREASURY_FILE)) {
                const content = fs.readFileSync(TREASURY_FILE, 'utf8');
                const lines = content.split('\n').filter(l => l.trim());
                console.log(`Total records: ${lines.length - 1}`); // Subtract header
                
                // Count by security type if possible
                if (lines.length > 1) {
                    const header = lines[0].split(',');
                    const typeIndex = header.findIndex(h => h.toLowerCase().includes('security_type'));
                    if (typeIndex >= 0) {
                        const types = {};
                        for (let i = 1; i < lines.length; i++) {
                            const cols = lines[i].split(',');
                            const type = cols[typeIndex]?.replace(/"/g, '') || 'Unknown';
                            types[type] = (types[type] || 0) + 1;
                        }
                        console.log('By security type:');
                        for (const [type, count] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
                            console.log(`  ${type}: ${count}`);
                        }
                    }
                }
            }
        } else {
            console.error('Failed to update Treasury securities listings.');
            process.exit(1);
        }
    } catch (error) {
        console.error('Error updating Treasury listings:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    updateTreasuryListings();
}

module.exports = { updateTreasuryListings };
