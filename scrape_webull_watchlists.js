const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');
const { publishToKafka } = require('./publish_to_kafka');
const path = require('path');
const fs = require('fs');

async function scrapeWebullWatchlists(browser, watchlist, outputDir) {
    const webullUrl = 'https://app.webull.com/watch';
    const webullEmail = process.env.WEBULL_EMAIL;
    const webullPassword = process.env.WEBULL_PASSWORD;
    let page;
    try {
        logDebug('Using createPreparedPage (reuse webull tab if present)');
        logDebug(`outputDir: ${outputDir}`);
        page = await createPreparedPage(browser, {
            reuseIfUrlMatches: /webull\.com\/watch/,
            url: webullUrl,
            downloadPath: outputDir,
            waitUntil: 'domcontentloaded',
            timeout: 20000,
            attachCounters: true,
            gotoRetries: 3,
            reloadExisting: false
        });
        // Bring to front
        try { await page.bringToFront(); } catch (e) { /* ignore */ }

        // Diagnostic: capture and log a truncated snapshot of the current page HTML
        //try {
        //    const _pageHtml = await page.content();
        //    const _trunc = _pageHtml && _pageHtml.length > 20000 ? _pageHtml.slice(0, 20000) + '\n... (truncated)' : _pageHtml;
        //    logDebug('Page HTML snapshot (truncated): ' + _trunc);
        //} catch (e) {
        //    logDebug('Failed to capture page HTML for diagnostics: ' + (e && e.message ? e.message : e));
        //}

        // Check for login. Prefer the visible "Please Login" prompt; otherwise
        // look for a Login link/button and click it. Use XPath contains() to
        // avoid relying on non-standard pseudo selectors.
        let needsLogin = false;
        try {
            logDebug('Checking for "Please Login" prompt (more specific XPath)...');
            const pleaseLoginXpath = "//*[contains(., 'Please')]/descendant::*[normalize-space(.)='Login']";
            await page.waitForXPath(pleaseLoginXpath, { timeout: 10000 });
            needsLogin = true;
            logDebug('"Please Login" prompt detected via XPath.');
        } catch (e) {
            logDebug('"Please Login" prompt not detected, falling back to generic Login lookup...');
            try {
                const genericLoginXpath = "//*[normalize-space(.)='Login' or normalize-space(.)='Log in' or normalize-space(.)='Log In' or normalize-space(.)='Sign in' or normalize-space(.)='Sign In']";
                await page.waitForXPath(genericLoginXpath, { timeout: 5000 });
                needsLogin = true;
                logDebug('Generic "Login/Sign in" element detected via XPath fallback.');
            } catch (e2) {
                logDebug('Generic "Login" element not detected; checking for Login link/button elements to click...');
                try {
                    const loginXpath = "//a[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'login') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'sign in') ] | //button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'login') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'sign in') ]";
                    let clicked = false;
                    try {
                        // Prefer using $x when available
                        if (typeof page.$x === 'function') {
                            const els = await page.$x(loginXpath);
                            logDebug(`$x returned ${els ? els.length : 0} elements for loginXpath`);
                            if (els && els.length) {
                                needsLogin = true;
                                logDebug('Login link/button found via $x, attempting clicks...');
                                for (let i = 0; i < els.length; i++) {
                                    try {
                                        // ensure element is visible
                                        try { await els[i].evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' })); } catch (e) { /* ignore */ }
                                        await els[i].click({ delay: 50 });
                                        clicked = true;
                                        logDebug('Clicked login element via ElementHandle.click()');
                                        break;
                                    } catch (errClick) {
                                        logDebug('ElementHandle.click failed: ' + (errClick && errClick.message ? errClick.message : errClick));
                                        // fallback to mouse click at element center
                                        try {
                                            const box = await els[i].boundingBox();
                                            if (box) {
                                                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                                                clicked = true;
                                                logDebug('Clicked login element via page.mouse.click() fallback');
                                                break;
                                            }
                                        } catch (mouseErr) {
                                            logDebug('page.mouse.click fallback failed: ' + (mouseErr && mouseErr.message ? mouseErr.message : mouseErr));
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e3) {
                        logDebug('page.$x attempt failed: ' + (e3 && e3.message ? e3.message : e3));
                    }
                    // Fallback: use page.evaluate to find and click the first matching element via XPath
                    if (!clicked) {
                        try {
                            const evalClicked = await page.evaluate((xp) => {
                                try {
                                    const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                                    const el = res.singleNodeValue;
                                    if (el) {
                                        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { }
                                        try { el.focus && el.focus(); } catch (e) { }
                                        try { el.click(); } catch (e) { }
                                        try {
                                            // dispatch mouse events to simulate a real user click
                                            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                        } catch (e) { }
                                        return true;
                                    }
                                    return false;
                                } catch (e) { return false; }
                            }, loginXpath);
                            if (evalClicked) {
                                needsLogin = true;
                                logDebug('Login link/button found via page.evaluate and clicked.');
                            } else if (!clicked) {
                                logDebug('No Login link/button detected via XPath, likely already logged in.');
                            }
                        } catch (e4) {
                            logDebug('Error while searching/clicking Login link/button via evaluate: ' + (e4 && e4.message ? e4.message : e4));
                        }
                    }
                } catch (e2) {
                    logDebug('Error while searching for Login link/button: ' + (e2 && e2.message ? e2.message : e2));
                }
                }
        }

        // Final fallback: sometimes the DOM splits "Please" and "Login" into
        // adjacent nodes and our XPath checks can miss it. Check the page body
        // text for a short "Please ... Login" sequence (covers <span>Please</span><div>Login</div> cases).
        if (!needsLogin) {
            try {
                const foundPleaseLogin = await page.evaluate(() => {
                    const txt = document.body && document.body.innerText ? document.body.innerText.replace(/\u00A0/g, ' ') : '';
                    // look for 'Please' followed by up to ~40 chars then 'Login' (covers intervening elements)
                    return /Please[\s\S]{0,40}Login/i.test(txt) || /Please[\s\S]{0,40}Sign in/i.test(txt);
                });
                if (foundPleaseLogin) {
                    needsLogin = true;
                    logDebug('Detected "Please ... Login" via page body text fallback.');
                }
            } catch (e) {
                logDebug('Error during body-text login fallback check: ' + (e && e.message ? e.message : e));
            }
        }

        if (needsLogin) {
            logDebug('Attempting Email Login flow (text-based clicks for Puppeteer)...');
            // Click an Email Login button/link by searching visible buttons/anchors by text
            try {
                const clickedEmail = await page.evaluate(() => {
                    const nodes = Array.from(document.querySelectorAll('button, a'));
                    for (const n of nodes) {
                        const t = (n.innerText || n.textContent || '').trim();
                        if (/email\s*login/i.test(t) || (/email/i.test(t) && /login/i.test(t))) { n.click(); return true; }
                    }
                    return false;
                });
                if (!clickedEmail) logDebug('Email Login button not found via text search.');
            } catch (e) {
                logDebug('Error clicking Email Login via evaluate: ' + (e && e.message ? e.message : e));
            }

            // wait for email input (may already be present)
            try {
                await page.waitForSelector('input[type="email"]', { timeout: 10000 });
            } catch (_) {
                logDebug('Email input not visible after Email Login click (continuing to try typing anyway)');
            }

            try {
                logDebug('Typing email and password...');
                if (webullEmail) await page.type('input[type="email"]', webullEmail, { delay: 50 });
                if (webullPassword) await page.type('input[type="password"]', webullPassword, { delay: 50 });
            } catch (e) {
                logDebug('Error typing credentials: ' + (e && e.message ? e.message : e));
            }

            // Click a Login button by text (avoid Playwright-only selectors)
            try {
                const clickedLogin = await page.evaluate(() => {
                    const nodes = Array.from(document.querySelectorAll('button, a'));
                    for (const n of nodes) {
                        const t = (n.innerText || n.textContent || '').trim();
                        if (/^\s*login\b/i.test(t) || /log\s*in/i.test(t) || /sign\s*in/i.test(t)) { n.click(); return true; }
                    }
                    return false;
                });
                if (!clickedLogin) logDebug('Login button not found via text search.');
            } catch (e) {
                logDebug('Error clicking Login via evaluate: ' + (e && e.message ? e.message : e));
            }

            try {
                logDebug('Waiting for watchlist table after login...');
                await page.waitForSelector('table', { timeout: 15000 });
            } catch (_) {
                logDebug('Table not found immediately after login; proceeding to multi-selector watchlist wait.');
            }
        }
        // Wait for watchlist table
        // The Webull UI may not use a real <table>. Try multiple selectors
        // and as a last resort check page body text for ticker-like tokens.
        logDebug('Waiting for watchlist content (table or alternative selectors)...');
        const watchlistSelectors = ['table', '[role="grid"]', '.watchlist', '.quotes-list', '.list-root'];
        let found = false;
        for (const sel of watchlistSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 3000 });
                logDebug('Found watchlist selector: ' + sel);
                found = true;
                break;
            } catch (_) {
                // try next
            }
        }
        if (!found) {
            // Fallback: look for ticker-like tokens (e.g., AAPL, AMZN) in the visible text
            try {
                logDebug('No standard selector found, using text-based fallback to detect tickers...');
                await page.waitForFunction(() => {
                    try {
                        const txt = document.body && document.body.innerText ? document.body.innerText : '';
                        // look for 2+ probable tickers (1-5 uppercase letters, optionally with . or -)
                        const matches = txt.match(/\b[A-Z]{1,5}(?:[.\-][A-Z0-9]{1,4})?\b/g);
                        return matches && matches.length >= 2;
                    } catch (e) { return false; }
                }, { timeout: 10000 });
                logDebug('Text-based ticker fallback succeeded.');
                found = true;
            } catch (e) {
                logDebug('Watchlist content not detected within timeout.');
            }
        }
        if (!found) {
            logDebug('Watchlist not found; continuing but output may be empty.');
        }
        logDebug('Watchlist table loaded. Extracting HTML...');
        const fullPageHtml = await page.content();
        const safeWatchlistKey = sanitizeForFilename(watchlist.key || 'webull');
        const htmlOutPath = path.join(outputDir, `webull_watchlist.${safeWatchlistKey}.${getDateTimeString()}.html`);
        fs.writeFileSync(htmlOutPath, fullPageHtml, 'utf-8');
        logDebug('Parsing full page HTML for stock table...');
        const cheerio = require('cheerio');
        const $ = cheerio.load(fullPageHtml);
        // Find the main table (Webull's structure may change, adjust selectors as needed)
        const table = $('table').first();
        const dataObjects = [];
        if (table.length === 0) {
            logDebug('No table found in the HTML.');
        } else {
            table.find('tbody tr').each((i, row) => {
                const rowData = {};
                $(row).find('td').each((j, col) => {
                    // Try to extract column name from data attributes or use index
                    const colText = $(col).text().trim();
                    rowData[`col${j}`] = colText;
                });
                if (Object.keys(rowData).length > 0) {
                    dataObjects.push(rowData);
                    logDebug(`Data object for row ${i}: ${JSON.stringify(rowData)}`);
                }
            });
            logDebug(`Total valid stock rows found: ${dataObjects.length}`);
        }
        const outPath = path.join(outputDir, `webull_watchlist.${safeWatchlistKey}.${getDateTimeString()}.json`);
        fs.writeFileSync(outPath, JSON.stringify(dataObjects, null, 2), 'utf-8');
        logDebug(`Parsed data written to ${outPath}`);
        const kafkaTopic = process.env.KAFKA_TOPIC || 'webull_watchlist';
        const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
        for (const data of dataObjects) {
            publishToKafka(data, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
        }
    } catch (err) {
        logDebug('Error in scrapeWebullWatchlists: ' + err);
        if (err && err.stack) {
            const stackLine = err.stack.split('\n')[1];
            console.error('Occurred at:', stackLine.trim());
        }
        // Attempt to save a diagnostic snapshot for later analysis
        try {
            if (typeof savePageSnapshot === 'function' && typeof page !== 'undefined' && page) {
                const base = path.join(outputDir, `webull_login_failure.${getDateTimeString()}`);
                await savePageSnapshot(page, base);
                logDebug('Wrote diagnostic snapshot to ' + base + '.*');
            }
        } catch (snapErr) {
            logDebug('Failed to write diagnostic snapshot: ' + (snapErr && snapErr.message ? snapErr.message : snapErr));
        }
    }
}

module.exports = { scrapeWebullWatchlists };
