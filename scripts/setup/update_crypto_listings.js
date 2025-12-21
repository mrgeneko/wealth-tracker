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
        // The page appears to only load ~100 by default. Based on the user's requirement
        // that ticker #204 should be "BDX" (Beldex), we need to find a way to load all 204.
        // Trying with a limit parameter to see if it works
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
            await page.setViewport({ width: 1920, height: 1080 }); // Larger viewport
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Intercept network requests to see if there's an API we can use
            const apiResponses = [];
            page.on('response', async (response) => {
                const url = response.url();
                if (url.includes('api') || url.includes('json') || url.includes('crypto')) {
                    try {
                        if (response.status() === 200 && response.headers()['content-type']?.includes('json')) {
                            const data = await response.json();
                            apiResponses.push({ url, data });
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            });

            // Navigate to page
            await page.goto(this.url, { waitUntil: 'networkidle2', timeout: 120000 });

            // Wait for table to be present
            await page.waitForSelector('table tbody tr', { timeout: 30000 });
            console.log('Table loaded successfully');

            // Log any API responses found
            if (apiResponses.length > 0) {
                console.log(`Found ${apiResponses.length} API responses`);
                apiResponses.forEach((resp, idx) => {
                    console.log(`  API ${idx + 1}: ${resp.url}`);
                });
            }

            // Give initial content time to render
            await new Promise(r => setTimeout(r, 3000));

            // Debug: save initial page HTML for inspection
            try {
                const fs = require('fs');
                const path = require('path');
                const debugDir = path.join(__dirname, '../../tmp');
                if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
                const beforePath = path.join(debugDir, `investing_before_${Date.now()}.html`);
                const beforeHtml = await page.content();
                fs.writeFileSync(beforePath, beforeHtml, 'utf8');
                console.log(`Saved page snapshot (before loadMore) to ${beforePath}`);
            } catch (e) {
                console.warn('Failed to write pre-load snapshot:', e.message);
            }

            // Handle "Load More" button pagination
            await this.loadMoreRows(page);

            // Debug: save post-load HTML for inspection
            try {
                const fs = require('fs');
                const path = require('path');
                const debugDir = path.join(__dirname, '../../tmp');
                if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
                const afterPath = path.join(debugDir, `investing_after_${Date.now()}.html`);
                const afterHtml = await page.content();
                fs.writeFileSync(afterPath, afterHtml, 'utf8');
                console.log(`Saved page snapshot (after loadMore) to ${afterPath}`);
            } catch (e) {
                console.warn('Failed to write post-load snapshot:', e.message);
            }

            // Debug: count rows and heuristics
            try {
                const totalRows = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
                const rowsWith8 = await page.evaluate(() => Array.from(document.querySelectorAll('table tbody tr')).filter(r => r.querySelectorAll('td').length >= 8).length);
                const rowsWithSymbolAndLast = await page.evaluate(() => Array.from(document.querySelectorAll('table tbody tr')).filter(row => {
                    const tds = row.querySelectorAll('td');
                    if (tds.length < 4) return false;
                    const symbol = (tds[3] && tds[3].innerText) ? tds[3].innerText.trim() : '';
                    const last = (tds[4] && tds[4].innerText) ? tds[4].innerText.trim() : '';
                    return symbol && last && last !== '-';
                }).length);
                console.log(`DEBUG: totalRows=${totalRows}, rowsWith8=${rowsWith8}, rowsWithSymbolAndLast=${rowsWithSymbolAndLast}`);
            } catch (e) {
                console.warn('Failed to compute debug row counts:', e.message);
            }

            // First, try to extract data from Next.js __NEXT_DATA__ embedded JSON
            let results = [];
            try {
                const nextData = await page.evaluate(() => {
                    const scriptTag = document.getElementById('__NEXT_DATA__');
                    if (scriptTag) {
                        const data = JSON.parse(scriptTag.textContent);
                        const collection = data?.props?.pageProps?.state?.cryptoStore?.cryptoCoinsCollection?._collection;
                        if (collection && Array.isArray(collection)) {
                            return collection.map(item => ({
                                rank: item.rank || 9999,
                                name: item.name || '',
                                symbol: (item.symbol || '').toUpperCase(),
                                market_cap: item.marketCap || '0'
                            }));
                        }
                    }
                    return null;
                });

                if (nextData && nextData.length > 0) {
                    console.log(`Extracted ${nextData.length} cryptos from embedded Next.js data`);
                    results = nextData;
                }
            } catch (err) {
                console.warn('Failed to extract Next.js data:', err.message);
            }

            // Fallback: Extract data from table rows if Next.js extraction failed
            const rejected = [];
            if (results.length === 0) {
                console.log('Falling back to table scraping...');
                const { data: tableResults, rejected: tableRejected } = await page.evaluate(() => {
                    const rows = document.querySelectorAll('table tbody tr');
                    const data = [];
                    const rejected = [];

                    rows.forEach((row, index) => {
                        try {
                            const cells = row.querySelectorAll('td');

                            // Rank may be missing in some layouts; fall back to index
                            const rankText = (cells[1] && cells[1].innerText) ? cells[1].innerText.trim() : String(index + 1);

                            // Name/symbol cell may be at a different position on mobile/desktop
                            const nameSymbolCell = cells[3] || row.querySelector('.crypto-coins-table_secondMobileCell__pzt0Y') || row;

                            let name = '';
                            let symbol = '';

                            const nameEl = nameSymbolCell ? nameSymbolCell.querySelector('.crypto-coins-table_cellNameText__aaXmK') : null;
                            const symbolEl = nameSymbolCell ? Array.from(nameSymbolCell.querySelectorAll('span')).find(el => {
                                const text = (el.innerText || '').trim();
                                return /^[A-Z0-9]{2,10}$/.test(text) && !el.className.includes('md:hidden');
                            }) : null;

                            if (nameEl) name = nameEl.innerText.trim();
                            if (symbolEl) symbol = symbolEl.innerText.trim();

                            // Fallback: parse from inner text lines
                            if ((!name || !symbol) && nameSymbolCell && nameSymbolCell.innerText) {
                                const lines = nameSymbolCell.innerText.trim().split('\n').map(l => l.trim()).filter(l => l);
                                if (lines.length >= 1 && !name) name = lines[0];
                                if (lines.length >= 2 && !symbol) symbol = lines[lines.length - 1];
                            }

                            // Market Cap if present (index 7) otherwise default to '0'
                            let marketCap = (cells[7] && cells[7].innerText) ? cells[7].innerText.trim() : '0';
                            if (marketCap === '-' || marketCap === '') marketCap = '0';

                            // Only require symbol to push - allow missing last/price columns
                            if (symbol) {
                                data.push({
                                    rank: parseInt(rankText, 10) || 9999,
                                    name: name || '',
                                    symbol: symbol.toUpperCase(),
                                    market_cap: marketCap
                                });
                            } else {
                                rejected.push({ index, snippet: (row.innerText || '').trim().slice(0, 200), reason: 'no symbol' });
                            }
                        } catch (err) {
                            rejected.push({ index, snippet: (row.innerText || '').trim().slice(0, 200), reason: err && err.message ? err.message : String(err) });
                        }
                    });

                    return { data, rejected };
                });

                results = tableResults;
                rejected.push(...tableRejected);
            }

            console.log(`Extracted ${results.length} items. Rejected ${rejected.length} rows.`);

            if (rejected && rejected.length) {
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const debugDir = path.join(__dirname, '../../tmp');
                    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
                    const rejPath = path.join(debugDir, `investing_rejected_${Date.now()}.json`);
                    fs.writeFileSync(rejPath, JSON.stringify(rejected, null, 2), 'utf8');
                    console.log(`Saved ${rejected.length} rejected rows to ${rejPath}`);
                    console.debug('Rejected examples:', rejected.slice(0, 10));
                } catch (e) {
                    console.warn('Failed to write rejected rows file:', e && e.message ? e.message : e);
                }
            }

            return results;

        } catch (error) {
            console.error('Scraping error:', error);
            throw error;
        } finally {
            await browser.close();
        }
    }

    async loadMoreRows(page) {
        console.log('Starting aggressive scroll-based loading...');

        const targetRows = 210; // Target at least 210 rows to be safe
        const maxScrollAttempts = 100;
        let scrollCount = 0;
        let consecutiveNoGrowth = 0;
        const maxConsecutiveNoGrowth = 10;

        while (scrollCount < maxScrollAttempts && consecutiveNoGrowth < maxConsecutiveNoGrowth) {
            try {
                const prevRowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);

                // Aggressive scrolling - scroll to bottom multiple times with pauses
                for (let i = 0; i < 5; i++) {
                    await page.evaluate((scrollIndex) => {
                        // Scroll in increments to trigger lazy loading at different points
                        const scrollHeight = document.body.scrollHeight;
                        const increment = scrollHeight / 5;
                        window.scrollTo(0, increment * (scrollIndex + 1));
                    }, i);
                    await new Promise(r => setTimeout(r, 800));
                }

                // Final scroll to absolute bottom
                await page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight + 1000);
                });
                await new Promise(r => setTimeout(r, 1000));

                // Look for clickable pagination or load more elements - but be more selective
                const clickResult = await page.evaluate(() => {
                    // Look specifically for buttons/links that might load more crypto data
                    // First, try to find a clear "Load More" or pagination button
                    const allButtons = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"]'));

                    // Find candidates
                    const candidates = [];
                    for (const el of allButtons) {
                        const text = (el.textContent || '').trim();
                        const textLower = text.toLowerCase();

                        // Look for specific load more patterns
                        if ((textLower === 'load more' ||
                             textLower === 'show more' ||
                             textLower.match(/^load\s+more$/i) ||
                             textLower.match(/^show\s+more$/i) ||
                             (text.match(/^\d+$/) && el.tagName === 'A')) && // Pagination numbers
                            text.length < 20) {

                            const style = window.getComputedStyle(el);
                            if (style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null) {
                                candidates.push({ el, text, tag: el.tagName });
                            }
                        }
                    }

                    if (candidates.length > 0) {
                        // Try the first candidate
                        const candidate = candidates[0];
                        try {
                            candidate.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            setTimeout(() => candidate.el.click(), 200);
                            return { clicked: true, text: candidate.text, tag: candidate.tag, total: candidates.length };
                        } catch (e) {
                            return { clicked: false, error: e.message };
                        }
                    }

                    return { clicked: false, total: candidates.length };
                });

                if (clickResult.clicked) {
                    console.log(`Clicked element with text: "${clickResult.text}"`);
                    await new Promise(r => setTimeout(r, 3000));
                }

                // Wait for potential new content
                await new Promise(r => setTimeout(r, 2000));

                // Check row count
                const newRowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);

                if (newRowCount > prevRowCount) {
                    console.log(`Row count increased: ${prevRowCount} -> ${newRowCount}`);
                    consecutiveNoGrowth = 0;
                } else {
                    consecutiveNoGrowth++;
                    console.log(`No growth (${consecutiveNoGrowth}/${maxConsecutiveNoGrowth}) - Current: ${newRowCount} rows`);
                }

                // Check if we've reached target
                if (newRowCount >= targetRows) {
                    console.log(`Reached target of ${targetRows}+ rows (currently ${newRowCount})`);
                    break;
                }

                scrollCount++;

            } catch (err) {
                console.warn('Error during scroll loading:', err.message);
                consecutiveNoGrowth++;
            }
        }

        const finalRowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
        console.log(`Finished loading. Final row count: ${finalRowCount}`);
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
