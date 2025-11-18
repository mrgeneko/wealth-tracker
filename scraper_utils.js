// Shared utility functions for all scrapers
const fs = require('fs');

function sanitizeForFilename(str) {
    return String(str).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getDateTimeString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}


// Cache for the datetime string used in log file naming
let cachedDateTimeString = null;

function getTimestampedLogPath(prefix = 'scrape_security_data') {
    if (!cachedDateTimeString) {
        cachedDateTimeString = getDateTimeString();
    }
    return `/usr/src/app/logs/${prefix}.${cachedDateTimeString}.log`;
}

function logDebug(msg, logPath) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    const path = logPath || getTimestampedLogPath();
    fs.appendFileSync(path, line);
}

// Runtime navigation/request metrics
let metrics = {
    totalNavigations: 0,
    failedNavigations: 0,
    totalRequests: 0,
    failedRequests: 0
};

function attachRequestFailureCounters(page) {
    if (!page || typeof page.on !== 'function') return;
    // increment totalRequests for each request and failedRequests when requestfailed fires
    page.on('request', () => { metrics.totalRequests += 1; });
    page.on('requestfailed', req => {
        metrics.failedRequests += 1;
        try {
            const failure = req.failure ? req.failure() : null;
            const text = failure && failure.errorText ? failure.errorText : JSON.stringify(failure);
            logDebug(`[REQUEST FAILED] ${req.url()} ${text}`);
        } catch (e) {
            logDebug('[REQUEST FAILED] ' + req.url());
        }
    });
}

async function gotoWithRetries(page, url, options = {}, maxAttempts = 3) {
    metrics.totalNavigations += 1;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // small incremental backoff between attempts
            if (attempt > 1) await new Promise(r => setTimeout(r, 500 * attempt));
            const res = await page.goto(url, options);
            return res;
        } catch (e) {
            lastErr = e;
            metrics.failedNavigations += 1;
            logDebug(`[NAV FAIL] attempt=${attempt} url=${url} err=${e && e.message ? e.message : e}`);
            // on final attempt rethrow
            if (attempt === maxAttempts) throw e;
        }
    }
    if (lastErr) throw lastErr;
}

function getMetrics() {
    return { ...metrics };
}

function resetMetrics() {
    metrics = { totalNavigations: 0, failedNavigations: 0, totalRequests: 0, failedRequests: 0 };
}

function reportMetrics(thresholds = { navFail: 5, reqFail: 10 }, logPath) {
    const m = getMetrics();
    const summary = `METRICS: totalNavigations=${m.totalNavigations} failedNavigations=${m.failedNavigations} totalRequests=${m.totalRequests} failedRequests=${m.failedRequests}`;
    logDebug(summary, logPath);
    if (m.failedNavigations >= thresholds.navFail) {
        const warn = `ALERT: failedNavigations (${m.failedNavigations}) >= threshold (${thresholds.navFail})`;
        logDebug(warn, logPath);
        try { console.warn(warn); } catch (e) {}
    }
    if (m.failedRequests >= thresholds.reqFail) {
        const warn = `ALERT: failedRequests (${m.failedRequests}) >= threshold (${thresholds.reqFail})`;
        logDebug(warn, logPath);
        try { console.warn(warn); } catch (e) {}
    }
}

async function createPreparedPage(browser, opts = {}) {
    // opts: { url, downloadPath, userAgent, viewport, waitUntil, timeout, attachCounters=true, gotoRetries }
    const {
        url,
        downloadPath,
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport = { width: 1280, height: 900 },
        waitUntil = 'domcontentloaded',
        timeout = 15000,
        attachCounters = true,
        gotoRetries = 3
    } = opts;

    const page = await browser.newPage();
    if (attachCounters) attachRequestFailureCounters(page);
    try { await page.setUserAgent(userAgent); } catch (e) { /* ignore */ }
    try { await page.setViewport(viewport); } catch (e) { /* ignore */ }
    if (url) {
        await gotoWithRetries(page, url, { waitUntil, timeout }, gotoRetries);
    }
    if (downloadPath) {
        try {
            const client = await page.target().createCDPSession();
            await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
            // In some environments Chrome enforces certificate transparency checks
            // which can cause net::ERR_CERTIFICATE_TRANSPARENCY_REQUIRED when navigating.
            // Enable ignoring certificate errors via the Security domain for this session.
            try {
                await client.send('Security.setIgnoreCertificateErrors', { ignore: true });
            } catch (secErr) {
                logDebug('Security.setIgnoreCertificateErrors failed: ' + (secErr && secErr.message ? secErr.message : secErr));
            }
        } catch (e) {
            logDebug('Failed to set download behavior: ' + (e && e.message ? e.message : e));
        }
    }
    return page;
}

async function savePageSnapshot(page, basePath) {
    // Writes <basePath>.html, <basePath>.png and <basePath>.cookies.json
    try {
        const fullHtml = await page.content();
        try { require('fs').writeFileSync(basePath + '.html', fullHtml, 'utf-8'); } catch (e) { logDebug('Failed to write html snapshot: ' + e.message); }
        try { await page.screenshot({ path: basePath + '.png', fullPage: true }); } catch (e) { logDebug('Screenshot failed: ' + (e && e.message ? e.message : e)); }
        try { const cookies = await page.cookies(); require('fs').writeFileSync(basePath + '.cookies.json', JSON.stringify(cookies, null, 2), 'utf-8'); } catch (e) { logDebug('Failed to write cookies snapshot: ' + (e && e.message ? e.message : e)); }
        return fullHtml;
    } catch (e) {
        logDebug('savePageSnapshot failed: ' + (e && e.message ? e.message : e));
        return null;
    }
}

module.exports = {
    sanitizeForFilename,
    getDateTimeString,
    getTimestampedLogPath,
    logDebug,
    gotoWithRetries,
    attachRequestFailureCounters,
    reportMetrics,
    getMetrics,
    resetMetrics
};

// Export helpers for page setup and snapshots
module.exports.createPreparedPage = createPreparedPage;
module.exports.savePageSnapshot = savePageSnapshot;
