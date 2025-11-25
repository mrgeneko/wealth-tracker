const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');
const { publishToKafka } = require('./publish_to_kafka');
const { DateTime } = require('luxon');

// Helper to check if error is from a known ad/tracker domain
function isSuppressedPageError(err) {
	if (!err || !err.stack) return false;
	const suppressedPatterns = [
		'pagead2.googlesyndication.com',
		'doubleclick.net',
		'securepubads.g.doubleclick.net',
		'creativedot2.net',
		'media.net',
		'googletagservices.com',
		'googletagmanager.com',
		'adservice.google.com',
		'adservice.google.',
		'adservice.',
		'ads.',
		'adserver.'
	];
	return suppressedPatterns.some(pattern => err.stack.includes(pattern));
}

function cleanNumber(str) {
    if (!str) return null;
    // Remove commas, non-breaking spaces, and handle different minus signs
    // The HTML might contain LTR marks or other invisible characters
    const cleaned = str.replace(/,/g, '')
                       .replace(/[−]/g, '-') // specific unicode minus
                       .replace(/[^\d.-]/g, ''); // remove anything that isn't a digit, dot, or minus
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
}

async function scrapeTradingViewWatchlists(browser, watchlist, outputDir) {
	const tvUrl = watchlist.url;
	if (!tvUrl) {
		logDebug('WARNING: TRADINGVIEW_URL is missing or invalid');
		throw new Error('TRADINGVIEW_URL is not set in .env');
	}
	const tvEmail = process.env.TRADINGVIEW_EMAIL;
	const tvPassword = process.env.TRADINGVIEW_PASSWORD;

	try {
        logDebug('scrapeTradingViewWatchlists [UPDATED] started');
		logDebug('Using createPreparedPage (reuse tradingview tab if present)');
		logDebug(`outputDir: ${outputDir}`);
		const page = await createPreparedPage(browser, {
			reuseIfUrlMatches: /tradingview\.com/,
			url: tvUrl,
			downloadPath: outputDir,
			waitUntil: 'domcontentloaded',
			timeout: 15000,
			attachCounters: true,
			gotoRetries: 3,
			reloadExisting: false
		});

        // Bypass CSP to prevent EvalErrors from TradingView/Recaptcha scripts
        try {
            await page.setBypassCSP(true);
            logDebug('Enabled CSP bypass');
        } catch (e) {
            logDebug('Failed to enable CSP bypass: ' + e.message);
        }

		// Ensure we have standard page error handlers
		try {
			page.on('pageerror', (err) => {
				if (!isSuppressedPageError(err)) {
					logDebug(`[BROWSER PAGE ERROR] ${err && err.stack ? err.stack : err}`);
				}
			});
			page.on('error', (err) => {
				logDebug(`[BROWSER ERROR] ${err && err.stack ? err.stack : err}`);
			});
		} catch (e) { /* ignore if page closed or events not supported */ }

		try { await page.bringToFront(); } catch (e) { /* ignore */ }

		// Login logic (Placeholder - selectors need verification)
		let needsLogin = false;
		try {
			logDebug('Checking for login button...');

            // Debug snapshot
            const debugTime = getDateTimeString();
            logDebug(`Taking debug snapshot at login check: ${debugTime}`);
            try {
                await page.screenshot({ path: `/usr/src/app/logs/${debugTime}.tv_login_check.png` });
                const html = await page.content();
                require('fs').writeFileSync(`/usr/src/app/logs/${debugTime}.tv_login_check.html`, html);
                logDebug('Debug snapshots saved.');
            } catch (snapErr) {
                logDebug('Failed to save debug snapshots: ' + snapErr.message);
            }

            // Check for and close popups (e.g. Black Friday)
            try {
                const closeBtn = await page.$('.tv-dialog__close, .js-dialog__close, [data-name="close"]');
                if (closeBtn) {
                    logDebug('Popup detected. Closing...');
                    await closeBtn.click();
                    await new Promise(r => setTimeout(r, 1000)); // Wait for animation
                }
            } catch (popupErr) {
                logDebug('Error checking/closing popup: ' + popupErr.message);
            }

            // Check for 404 "Head to homepage" using evaluate (more robust than $x)
            const is404 = await page.evaluate(() => {
                const el = document.evaluate("//a[contains(., 'Head to homepage')] | //button[contains(., 'Head to homepage')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                return !!el;
            });

            if (is404) {
                logDebug('404 Page detected. Clicking "Head to homepage"...');
                
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                    page.evaluate(() => {
                        const el = document.evaluate("//a[contains(., 'Head to homepage')] | //button[contains(., 'Head to homepage')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        if (el) el.click();
                    })
                ]);

                try { await page.setBypassCSP(true); } catch (e) {}
                
                // Snapshots of homepage
                const ts = getDateTimeString();
                logDebug(`Taking homepage snapshots: ${ts}`);
                await page.screenshot({ path: `/usr/src/app/logs/${ts}.tv_homepage.png` });
                require('fs').writeFileSync(`/usr/src/app/logs/${ts}.tv_homepage.html`, await page.content());
                
                // Open User Menu
                logDebug('Clicking user menu...');
                const userMenuSelectors = [
                    // 'button.tv-header__user-menu-button--anonymous',
                    'button[data-name="header-user-menu-button"]',
                    'div[data-name="header-user-menu-button"]',
                    'button[aria-label="Open user menu"]',
                    'button[aria-label="Profile"]',
                    '.tv-header__user-menu-button',
                    'button.js-header-user-menu-button',
                    'div[class*="userMenu"] button',
                    'button[class*="userMenu"]'
                ];

                let userMenu = null;
                for (const sel of userMenuSelectors) {
                    userMenu = await page.$(sel);
                    if (userMenu) {
                        logDebug(`Found user menu with selector: ${sel}`);
                        break;
                    }
                }

                if (userMenu) {
                    try {
                        await userMenu.click();
                    } catch (e) {
                        logDebug(`Standard click failed, trying JS click: ${e.message}`);
                        await page.evaluate(el => el.click(), userMenu);
                    }
                    // Wait for menu to open
                    await new Promise(r => setTimeout(r, 2000));
                    
                    // Click Sign In
                    logDebug('Looking for Sign in option...');
                    const signInSelectors = [
                        'button[data-name="header-user-menu-sign-in"]',
                        'div[data-name="header-user-menu-sign-in"]',
                        'a[href*="/id/signin"]',
                        '[data-role="menu-item"]' // Generic menu item, will filter by text
                    ];

                    let signInClicked = false;
                    for (const sel of signInSelectors) {
                        const els = await page.$$(sel);
                        for (const el of els) {
                            const text = await page.evaluate(e => e.innerText, el);
                            if (text && text.toLowerCase().includes('sign in')) {
                                logDebug(`Found Sign in option with selector: ${sel} and text: ${text}`);
                                
                                // Multi-faceted click approach
                                try {
                                    // 1. Mouse click
                                    const box = await el.boundingBox();
                                    if (box) {
                                        logDebug(`Attempt 1: Mouse click at ${box.x + box.width/2}, ${box.y + box.height/2}`);
                                        await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
                                        await new Promise(r => setTimeout(r, 500));
                                    }

                                    // 2. Keyboard Navigation (Focus + Enter)
                                    logDebug('Attempt 2: Keyboard Navigation (Focus + Enter)');
                                    try {
                                        await el.focus();
                                        await new Promise(r => setTimeout(r, 200));
                                        await page.keyboard.press('Enter');
                                        await new Promise(r => setTimeout(r, 500));
                                    } catch (kbErr) {
                                        logDebug('Keyboard navigation failed: ' + kbErr.message);
                                    }

                                    // 3. JS Event Dispatch (mousedown/up/click)
                                    logDebug('Attempt 3: Dispatching synthetic events');
                                    await page.evaluate(element => {
                                        ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                                            const event = new MouseEvent(eventType, {
                                                view: window,
                                                bubbles: true,
                                                cancelable: true,
                                                buttons: 1
                                            });
                                            element.dispatchEvent(event);
                                        });
                                        // 4. Direct .click()
                                        element.click();
                                    }, el);
                                    
                                } catch (e) {
                                    logDebug(`Click attempts failed: ${e.message}`);
                                }

                                await new Promise(r => setTimeout(r, 3000)); // Wait for modal
                                signInClicked = true;
                                needsLogin = true;
                                break;
                            }
                        }
                        if (signInClicked) break;
                    }

                    if (!signInClicked) {
                        // Fallback: Try text search for Sign in using XPath
                        logDebug('Trying XPath search for Sign in...');
                        const foundSignIn = await page.evaluate(() => {
                            const xpath = "//div[contains(text(), 'Sign in')] | //span[contains(text(), 'Sign in')] | //button[contains(text(), 'Sign in')]";
                            const el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                            if (el) {
                                el.click();
                                return true;
                            }
                            return false;
                        });
                        if (foundSignIn) {
                            logDebug('Found Sign in via XPath');
                            needsLogin = true;
                        } else {
                            logDebug('Could not find Sign in option in menu');
                            // Snapshot of open menu
                            const tsMenu = getDateTimeString();
                            await page.screenshot({ path: `/usr/src/app/logs/${tsMenu}.tv_menu_open.png` });
                        }
                    }
                } else {
                    logDebug('User menu button not found');
                    // Try to find "Sign in" directly on header (sometimes visible if not logged in)
                    const directSignIn = await page.$('button[data-name="header-user-menu-sign-in"]');
                    if (directSignIn) {
                        logDebug('Found direct Sign in button on header');
                        await directSignIn.click();
                        needsLogin = true;
                    }
                }
            } else {
                // Common selector for "Sign in" button on TradingView
                const loginBtn = await page.$('button[data-name="header-user-menu-button"]');
                if (loginBtn) {
                    // Check if it says "Sign in" or shows user profile
                    // This is tricky without seeing the live page. 
                    // For now, we'll assume if we are on the watchlist page and see the table, we are good.
                    // If we see a "Sign in" specific element, we might need to act.
                }
            }
		} catch (e) {
			logDebug('Error checking login/404: ' + e.message);
		}

		if (needsLogin) {
            logDebug('Login required. Attempting to log in...');
            try {
                // Snapshots after clicking "Sign In"
                const tsSignIn = getDateTimeString();
                logDebug(`Taking snapshots after clicking Sign In: ${tsSignIn}`);
                try {
                    await page.screenshot({ path: `/usr/src/app/logs/${tsSignIn}.tv_signin_clicked.png` });
                    require('fs').writeFileSync(`/usr/src/app/logs/${tsSignIn}.tv_signin_clicked.html`, await page.content());
                } catch (e) { logDebug('Snapshot failed: ' + e.message); }

                // Click "Email" option
                logDebug('Looking for "Email" login option...');
                // Wait a bit for the modal to fully render
                await new Promise(r => setTimeout(r, 1000));
                
                const emailClicked = await page.evaluate(() => {
                    const xpath = "//button[contains(., 'Email')] | //span[contains(., 'Email')] | //div[contains(., 'Email')]";
                    const iterator = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                    let node = iterator.iterateNext();
                    while (node) {
                        // Ensure it's visible and looks like a button/action
                        // Check if it has a click listener or is a button/div with role
                        if (node.offsetParent !== null && (
                            node.tagName === 'BUTTON' || 
                            node.classList.contains('item-content') || 
                            node.getAttribute('role') === 'button' ||
                            node.innerText.trim() === 'Email'
                        )) {
                             node.click();
                             return true;
                        }
                        node = iterator.iterateNext();
                    }
                    return false;
                });

                if (emailClicked) {
                    logDebug('Clicked "Email" option.');
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    logDebug('"Email" option not found via text match. Checking if form is already visible...');
                }

                // Wait for login form
                await page.waitForSelector('input[name="username"], input[name="id_username"]', { timeout: 5000 });
                
                logDebug('Typing credentials...');
                // Username
                const userField = await page.$('input[name="username"]') || await page.$('input[name="id_username"]');
                if (userField) {
                    logDebug('Found username field. Typing...');
                    await userField.type(tvEmail, { delay: 50 });
                } else {
                    logDebug('Username field not found.');
                }
                
                // Password
                const passField = await page.$('input[name="password"]') || await page.$('input[type="password"]');
                if (passField) {
                    logDebug('Found password field. Typing...');
                    await passField.type(tvPassword, { delay: 50 });
                } else {
                    logDebug('Password field not found.');
                }
                
                // Submit
                const submitBtn = await page.$('button[type="submit"]') || await page.$('button[class*="submit"]');
                if (submitBtn) {
                    logDebug('Found submit button. Attempting to submit via Keyboard (Focus + Enter)...');
                    try {
                        await submitBtn.focus();
                        await new Promise(r => setTimeout(r, 500)); // Wait for focus
                        
                        // Use a shorter timeout and catch errors to avoid crashing if it's an SPA transition
                        const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
                            .catch(e => logDebug('Navigation wait ended (timeout or error): ' + e.message));
                        
                        await page.keyboard.press('Enter');
                        
                        await navPromise;
                        logDebug('Login submission sequence complete.');
                    } catch (e) {
                        logDebug('Error during submit sequence: ' + e.message);
                    }
                    
                    // After login, we are likely on the homepage or dashboard. 
                    // We need to navigate back to the watchlist URL.
                    logDebug(`Navigating back to watchlist URL: ${tvUrl}`);
                    await page.goto(tvUrl, { waitUntil: 'domcontentloaded' });
                } else {
                    logDebug('Submit button not found.');
                }
            } catch (loginErr) {
                logDebug('Login failed: ' + loginErr.message);
            }
		}

		logDebug('Waiting for watchlist table to load...');
		try {
            // Wait for the row class we identified
			await page.waitForSelector('.listItem-gfVnbvfd', { timeout: 10000 });
			logDebug('Watchlist table loaded. Extracting HTML...');
		} catch (e) {
			logDebug('Watchlist table did not load: ' + e.message);
			throw e;
		}

        // Scroll down to ensure all lazy-loaded rows are present (TradingView uses virtual scrolling sometimes)
        // But for a watchlist, it might be all loaded. Let's try scrolling a bit just in case.
        await page.evaluate(async () => {
            const distance = 100;
            const delay = 100;
            while (document.scrollingElement.scrollTop + window.innerHeight < document.scrollingElement.scrollHeight) {
                document.scrollingElement.scrollBy(0, distance);
                await new Promise(resolve => setTimeout(resolve, delay));
                // Break if we've scrolled enough or hit a limit (simple version)
                if (document.scrollingElement.scrollTop > 5000) break; 
            }
        });

		const safeWatchlistKey = sanitizeForFilename(watchlist.key);
		const htmlOutPath = `/usr/src/app/logs/${getDateTimeString()}.tradingview_watchlist.${safeWatchlistKey}.html`;
		const fullPageHtml = await page.content();
		require('fs').writeFileSync(htmlOutPath, fullPageHtml, 'utf-8');

		logDebug('Parsing full page HTML for stock table...');
		const cheerio = require('cheerio');
		const $ = cheerio.load(fullPageHtml);

		const dataObjects = [];
        const rows = $('.listItem-gfVnbvfd');
		logDebug(`Rows found: ${rows.length}`);

		if (rows.length === 0) {
			logDebug("No rows found in the HTML.");
		} else {
			rows.each((i, row) => {
                const symbolEl = $(row).find('.symbolWrap-nNqEjNlw .symbol-nNqEjNlw');
                if (symbolEl.length === 0) return; // Skip header rows or separators

                const symbol = symbolEl.text().trim();
                const cells = $(row).find('.cell-l4PFpEb8');

                // We expect at least Last, Chg%, Chg (3 cells)
                if (cells.length < 3) {
                    logDebug(`Row ${i} (${symbol}) has insufficient cells: ${cells.length}`);
                    return;
                }

                // Cell 0: Last Price
                // Cell 1: Chg%
                // Cell 2: Chg
                // Cell 3: Volume (optional)
                
                const lastPriceStr = $(cells[0]).find('.value-dCK2c9ft').text().trim();
                const chgPctStr = $(cells[1]).find('.value-dCK2c9ft').text().trim();
                const chgStr = $(cells[2]).find('.value-dCK2c9ft').text().trim();

                const lastPrice = cleanNumber(lastPriceStr);
                const chg = cleanNumber(chgStr);

                if (lastPrice !== null) {
                    let prevClose = null;
                    if (chg !== null) {
                        // Calculate previous close: Last - Chg
                        // Example: Last 100, Chg +2 => Prev 98
                        // Example: Last 100, Chg -2 => Prev 102
                        prevClose = lastPrice - chg;
                        // Round to 2 decimals or appropriate precision
                        prevClose = Math.round(prevClose * 100) / 100;
                    }

                    const data = {
                        key: symbol,
                        last_price: lastPrice,
                        price_change_decimal: chgStr,
                        price_change_percent: chgPctStr,
                        source: "tradingview",
                        previous_close_price: prevClose,
                        capture_time: new Date().toISOString(),
                        quote_time: new Date().toISOString() // No specific quote time in row, use current
                    };
                    dataObjects.push(data);
                    logDebug(`Data object for row ${i}: ${JSON.stringify(data)}`);
                } else {
                    logDebug(`Row ${i} (${symbol}) missing last price: ${lastPriceStr}`);
                }
			});
			logDebug(`Total valid stock rows found: ${dataObjects.length}`);
		}

		const outPath = require('path').join(outputDir, `${getDateTimeString()}.tradingview_watchlist.${safeWatchlistKey}.json`);
		require('fs').writeFileSync(outPath, JSON.stringify(dataObjects, null, 2), 'utf-8');
		logDebug(`Parsed data written to ${outPath}`);

		const kafkaTopic = process.env.KAFKA_TOPIC || 'tradingview_watchlist';
		const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

		for (const sec of dataObjects) {
			publishToKafka(sec, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
		}

	} catch (err) {
		logDebug('Error in scrapeTradingViewWatchlists: ' + err);
		if (err.stack) {
			const stackLine = err.stack.split('\n')[1];
			console.error('Occurred at:', stackLine.trim());
		}
		try {
			if (typeof savePageSnapshot === 'function' && typeof page !== 'undefined' && page) {
				const base = `/usr/src/app/logs/${getDateTimeString()}.tradingview_failure`;
				await savePageSnapshot(page, base);
				logDebug('Wrote diagnostic snapshot to ' + base + '.*');
			}
		} catch (snapErr) {
			logDebug('Failed to write diagnostic snapshot: ' + (snapErr && snapErr.message ? snapErr.message : snapErr));
		}
	}
}

module.exports = { scrapeTradingViewWatchlists };
