const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth plugin to avoid basic bot detection
puppeteer.use(StealthPlugin());

const CONFIG_DIR = path.join(__dirname, '../../config');

/**
 * Orchestrator class to manage multiple crypto listing providers
 */
class CryptoListingOrchestrator {
    constructor() {
        this.providers = [
            new InvestingProvider()
        ];
    }

    /**
     * Run all providers and save their data
     */
    async updateAll() {
        console.log('Starting crypto listing updates...');

        // Ensure config directory exists
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }

        for (const provider of this.providers) {
            try {
                console.log(`\n--- Running provider: ${provider.name} ---`);
                const data = await provider.fetch();

                if (data && data.length > 0) {
                    await this.saveToCsv(provider.targetFile, data);
                    console.log(`Successfully updated ${provider.name} with ${data.length} records.`);
                } else {
                    console.warn(`Provider ${provider.name} returned no data. Skipping save.`);
                }
            } catch (error) {
                console.error(`Failed to update provider ${provider.name}:`, error.message);
            }
        }

        console.log('\nAll crypto updates completed.');
    }

    /**
     * Save data to a CSV file safely (atomic write)
     */
    async saveToCsv(filename, data) {
        const filePath = path.join(CONFIG_DIR, filename);
        const tempPath = `${filePath}.tmp`;

        // Create CSV header and body
        // Columns: symbol,name,market_cap,rank
        const header = 'symbol,name,market_cap,rank\n';
        const rows = data.map(item => {
            // Escape commas in names if present
            const safeName = item.name.includes(',') ? `"${item.name}"` : item.name;
            const safeSymbol = item.symbol.includes(',') ? `"${item.symbol}"` : item.symbol;
            return `${safeSymbol},${safeName},${item.market_cap},${item.rank}`;
        }).join('\n');

        const content = header + rows;

        // Write to temp file first
        fs.writeFileSync(tempPath, content, 'utf8');

        // Rename temp file to destination (atomic operation)
        if (fs.existsSync(filePath)) {
            // Optional: Backup existing file
            // fs.copyFileSync(filePath, `${filePath}.bak`);
        }
        fs.renameSync(tempPath, filePath);
        console.log(`Saved data to ${filePath}`);
    }
}

/**
 * Provider for Investing.com Crypto Currencies
 */
class InvestingProvider {
    constructor() {
        this.name = 'Investing.com Crypto';
        this.targetFile = 'investing-crypto.csv';
        this.url = 'https://www.investing.com/crypto/currencies';
        this.maxItems = 1000; // Original limit
    }

    async fetch() {
        console.log(`Launching Puppeteer for ${this.url}...`);

        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        try {
            const page = await browser.newPage();

            // Set realistic viewport and user agent
            await page.setViewport({ width: 1366, height: 768 });
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');


            // Navigate to page
            await page.goto(this.url, { waitUntil: 'networkidle2', timeout: 120000 });

            // Handle "Load More" button pagination
            await this.loadMoreRows(page);

            // Extract data
            const results = await page.evaluate(() => {
                const rows = document.querySelectorAll('table tbody tr');
                const data = [];

                rows.forEach((row, index) => {
                    try {
                        const cells = row.querySelectorAll('td');
                        if (cells.length < 8) return;

                        const rank = cells[1].innerText.trim();
                        const nameSymbolCell = cells[3];

                        let name = '';
                        let symbol = '';

                        const nameEl = nameSymbolCell.querySelector('.crypto-coins-table_cellNameText__aaXmK');
                        const symbolEl = Array.from(nameSymbolCell.querySelectorAll('span')).find(el => {
                            // Find span that looks like a ticker (all caps, short)
                            const text = el.innerText.trim();
                            return /^[A-Z0-9]{2,10}$/.test(text) && !el.className.includes('md:hidden');
                        });

                        if (nameEl) name = nameEl.innerText.trim();
                        if (symbolEl) symbol = symbolEl.innerText.trim();


                        // Fallback: If specific selectors fail, try to parse from cell text
                        if (!name || !symbol) {
                            const lines = nameSymbolCell.innerText.trim().split('\n').map(l => l.trim()).filter(l => l);
                            if (lines.length >= 2) {
                                name = lines[0];
                                symbol = lines[lines.length - 1];
                            }
                        }

                        // Market Cap in Column 7 (index 7)
                        let marketCap = cells[7].innerText.trim();
                        if (marketCap === '-') {
                            // Try volume or other columns if market cap is missing
                            marketCap = '0';
                        }

                        if (symbol && name) {
                            data.push({
                                rank: parseInt(rank, 10) || 9999,
                                name,
                                symbol,
                                market_cap: marketCap
                            });
                        }
                    } catch (err) {
                        // Skip malformed row
                    }
                });

                return data;
            });

            console.log(`Extracted ${results.length} items.`);
            return results;

        } catch (error) {
            console.error('Scraping error:', error);
            throw error;
        } finally {
            await browser.close();
        }
    }

    async loadMoreRows(page) {
        console.log('Checking for "Load More" button...');
        let clickCount = 0;
        const maxClicks = 20;

        while (clickCount < maxClicks) {
            try {
                // Agent identified it as a DIV.
                // Use generic XPath to find any element with "Load more" text
                const loadMoreBtns = await page.$$("xpath//*[contains(text(), 'Load more')]");

                let clicked = false;
                for (const btn of loadMoreBtns) {
                    const isVisible = await page.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
                    }, btn);

                    if (isVisible) {
                        console.log(`Clicking "Load More" (${clickCount + 1}/${maxClicks})...`);
                        await btn.click();
                        clicked = true;

                        // Wait for update
                        const prevRowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
                        await new Promise(r => setTimeout(r, 2000));
                        const newRowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);

                        console.log(`  Row count: ${prevRowCount} -> ${newRowCount}`);

                        if (newRowCount >= this.maxItems) return; // Stop if limit reached
                        if (newRowCount === prevRowCount) return; // Stop if no new rows

                        break; // Clicked one, break inner loop to re-check
                    }
                }

                if (!clicked) {
                    console.log('No visible "Load More" button found.');
                    break;
                }

                clickCount++;

            } catch (err) {
                console.warn('Error clicking load more:', err.message);
                break;
            }
        }
    }
}

// Run if called directly
if (require.main === module) {
    const orchestrator = new CryptoListingOrchestrator();
    orchestrator.updateAll().catch(err => {
        console.error('Orchestrator failed:', err);
        process.exit(1);
    });
}

module.exports = { CryptoListingOrchestrator, InvestingProvider };
