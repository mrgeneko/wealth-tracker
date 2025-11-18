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

async function attachRequestFailureCounters(page, opts = {}) {
    // opts: { suppressionPatterns: [regexOrString], logSuppressed: false }
    if (!page || typeof page.on !== 'function') return;

    const suppressionPatterns = opts.suppressionPatterns || [
        /doubleclick\.net/i,
        /googlesyndication\.com/i,
        /google-analytics\.com/i,
        /analytics\.google/i,
        /securepubads\.g\.doubleclick\.net/i,
        /pagead\d*\.googlesyndication\.com/i,
        /creativedot2\.net/i,
        /media\.net/i,
        /tracking\.mygaru\.com/i,
        /krxd\.net/i,
        /pubmatic\.com/i,
        /id5-sync\.com/i,
        /connectad\.io/i,
        /adkernel\.com/i,
        /ingage\.tech/i,
        /image8\.pubmatic\.com/i,
        /promos\.investing\.com/i,
        /pagead\d*\.googlesyndication\.com/i,
        /match\.adsrvr\.org/i,
        /tapad\.com/i,
        /d\.turn\.com/i,
        /turn\.com/i,
        /sonobi\.com/i,
        /adnxs\.com/i,
        /openx\.net/i,
        /rubiconproject\.com/i,
        /360yield\.com/i,
        /fastclick\.net/i,
        /2mdn\.net/i,
        /s0\.2mdn\.net/i,
        /casalemedia\.com/i,
        /sadbundle/i,
        /4dex\.io/i,
        /mp\.4dex\.io/i,
        /aidemsrv\.com/i,
        /gum\.aidemsrv\.com/i,
        /iqzone\.com/i,
        /cs\.iqzone\.com/i,
        /ybp\.yahoo\.com/i,
        /pr-bh\.ybp\.yahoo\.com/i,
        /mrtnsvr\.com/i,
        /ad\.mrtnsvr\.com/i,
        /acuityplatform\.com/i,
        /ums\.acuityplatform\.com/i,
        /audienceexposure\.com/i,
        /bidswitch\.net/i,
        /x\.bidswitch\.net/i,
        /ids?\./i,
        /ids\.ad\.gt/i,
        /adform\.net|adform\.com|adform/i
    ];
    
    // Additions: suppress known noisy bidder/sync/analytics endpoints observed in logs
    suppressionPatterns.push(
        /inmobi\.com/i,
        /sync\.inmobi\.com/i,
        /api\.w\.inmobi\.com/i,
        /rlcdn\.com/i,
        /check\.analytics\.rlcdn\.com/i,
        /adentifi\.com/i,
        /rtb\.adentifi\.com/i,
        /bricks-co\.com/i,
        /pbsj\.bricks-co\.com/i,
        /admatic\.de/i,
        /static\.cdn\.admatic\.de/i,
        /fwmrm\.net/i,
        /user-sync\.fwmrm\.net/i,
        /sitescout\.com/i,
        /pixel-sync\.sitescout\.com/i
    );

    // Additional noisy endpoints observed: forexpros, facebook/fbevents, investing data script, scorecardresearch
    suppressionPatterns.push(
        /streaming\.forexpros\.com/i,
        /forexpros\.com/i,
        /connect\.facebook\.net/i,
        /fbevents\.js/i,
        /data\.investing\.com\/p\.js/i,
        /scorecardresearch\.com/i,
        /sb\.scorecardresearch\.com/i
    );

        // bidder/bidding endpoints commonly used for header bidding / prebid
        // suppress noisy auction endpoints (3lift, richaudience, seedtag, criteo)
        suppressionPatterns.push(
            /tlx\.3lift\.com/i,
            /3lift\.com/i,
            /richaudience\.com/i,
            /shb\.richaudience\.com/i,
            /seedtag\.com/i,
            /s\.seedtag\.com/i,
            /criteo\.com/i,
            /grid-bidder\.criteo\.com/i
        );

        // additional analytics, tag managers, and bidder endpoints observed
        suppressionPatterns.push(
            /googleadservices\.com/i,
            /googletagmanager\.com/i,
            /gtm\.js/i,
            /accounts\.google\.com/i,
            /cloudfront\.net/i,
            /outbrain\.com/i,
            /cloudflareinsights\.com/i,
            /jsdelivr\.net/i,
            /prebid\/currency-file/i,
            /pbxai\.com/i,
            /floor\.pbxai\.com/i,
            /taboola\.com/i,
            /privacymanager\.io/i,
            /launchpad-wrapper\.privacymanager\.io/i,
            /33across\.com/i,
            /crwdcntrl\.net/i,
            /maze\.co/i,
            /amazon-adsystem\.com/i,
            /springserve\.com/i,
            /pm\.w55c\.net/i,
            /adtarget\.biz/i,
            /invmed\.co/i,
            /trc\.taboola\.com/i,
            /tags\.crwdcntrl\.net/i,
            /snippet\.maze\.co/i,
            /cdn-ima\.33across\.com/i,
            /amplify\.outbrain\.com/i
        );

    function isSuppressed(url) {
        if (!url) return false;
        try {
            for (const p of suppressionPatterns) {
                if (p instanceof RegExp && p.test(url)) return true;
                if (typeof p === 'string' && url.includes(p)) return true;
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    // Additional simple substring list as a robust fallback for noisy domains
    const suppressionSubstrings = [
        'aidemsrv.com', 'gum.aidemsrv', 'iqzone.com', 'cs.iqzone', 'ybp.yahoo.com', 'mrtnsvr.com', 'ad.mrtnsvr.com', 'acuityplatform.com', 'ums.acuityplatform.com', 'audienceexposure.com', 'bidswitch.net', 'x.bidswitch.net', 'nextmillmedia.com', 'technoratimedia.com',
        '3lift.com', 'tlx.3lift.com', 'richaudience.com', 'shb.richaudience.com', 'seedtag.com', 's.seedtag.com', 'criteo.com', 'grid-bidder.criteo.com'
    ];

    // add analytics/tag manager/bidder substrings
    suppressionSubstrings.push(
        'googleadservices.com', 'googletagmanager.com', 'gtm.js', 'accounts.google.com', 'cloudfront.net', 'outbrain.com', 'cloudflareinsights.com', 'jsdelivr.net', 'pbxai.com', 'floor.pbxai.com', 'taboola.com', 'privacymanager.io', '33across.com', 'crwdcntrl.net', 'maze.co', 'amazon-adsystem.com', 'springserve.com', 'pm.w55c.net', 'adtarget.biz', 'invmed.co', 'taboola', 'outbrain'
    );

    // Fallback substrings for additional noisy domains observed
    suppressionSubstrings.push(
        'inmobi.com', 'sync.inmobi.com', 'api.w.inmobi.com', 'rlcdn.com', 'check.analytics.rlcdn.com', 'adentifi.com', 'rtb.adentifi.com', 'bricks-co.com', 'pbsj.bricks-co.com', 'admatic.de', 'static.cdn.admatic.de', 'fwmrm.net', 'user-sync.fwmrm.net', 'sitescout.com', 'pixel-sync.sitescout.com'
    );

    // Add forexpros, facebook fbevents, investing p.js and scorecardresearch to fallback substrings
    suppressionSubstrings.push(
        'streaming.forexpros.com', 'forexpros.com', 'connect.facebook.net', 'fbevents.js', 'data.investing.com/p.js', 'scorecardresearch.com', 'sb.scorecardresearch.com'
    );

    function isSuppressedFallback(url) {
        if (!url) return false;
        try {
            const lower = url.toLowerCase();
            for (const s of suppressionSubstrings) if (lower.includes(s)) return true;
        } catch (e) {}
        return false;
    }

    // Enable request interception so we can control and observe requests before navigation.
    try {
        await page.setRequestInterception(true);
    } catch (e) {
        // some environments may not support interception; log and continue
        logDebug('setRequestInterception failed: ' + (e && e.message ? e.message : e));
    }

    // Intercept requests: continue suppressed URLs without counting, count others
    page.on('request', req => {
        const url = req.url();
        // Do not increment totalRequests for suppressed URLs. Instead of aborting (which
        // can cause "Request is already handled" errors in some Chromium versions),
        // just continue the request and ignore its failures in the requestfailed handler.
        if (isSuppressed(url)) {
            // continue() returns a promise; catch rejections to avoid unhandled rejections
            try { req.continue().catch(() => {}); } catch (e) { /* ignore */ }
            return;
        }
        metrics.totalRequests += 1;
        try { req.continue().catch(() => {}); } catch (e) { /* ignore */ }
    });

    page.on('requestfailed', req => {
        const url = req.url();
        // Skip failures for common non-essential resource types
        let rtype = null;
        try { rtype = typeof req.resourceType === 'function' ? req.resourceType() : null; } catch (e) { rtype = null; }
        const ignoredResourceTypes = ['image', 'media', 'font'];
        if (rtype && ignoredResourceTypes.includes(rtype)) return;
        if (isSuppressed(url) || isSuppressedFallback(url)) return; // don't count or log suppressed failures
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
        gotoRetries = 3,
        // reuseIfUrlMatches: string or RegExp to match existing page.url()
        reuseIfUrlMatches = null,
        // if true and an existing page is reused, navigate/reload it to the provided `url`
        reloadExisting = false
    } = opts;

    // If reuseIfUrlMatches provided, try to find an existing page whose URL matches
    if (reuseIfUrlMatches) {
        try {
            const pages = await browser.pages();
            for (const p of pages) {
                let u = null;
                try { u = p.url(); } catch (e) { /* ignore */ }
                if (!u) continue;
                let matched = false;
                if (reuseIfUrlMatches instanceof RegExp) matched = reuseIfUrlMatches.test(u);
                else if (typeof reuseIfUrlMatches === 'string') matched = u.includes(reuseIfUrlMatches);
                if (matched) {
                    // Attach counters and best-effort setup
                    if (attachCounters) await attachRequestFailureCounters(p, { suppressionPatterns: opts.suppressionPatterns });
                    try { await p.setUserAgent(userAgent); } catch (e) { /* ignore */ }
                    try { await p.setViewport(viewport); } catch (e) { /* ignore */ }
                    try { await p.bringToFront(); } catch (e) { /* ignore */ }
                    if (reloadExisting && url) {
                        try {
                            await gotoWithRetries(p, url, { waitUntil, timeout }, gotoRetries);
                        } catch (e) {
                            logDebug('Reloading existing page failed: ' + (e && e.message ? e.message : e));
                        }
                    }
                    // Ensure download behavior / certificate ignore applied for reused page if requested
                    if (downloadPath) {
                        try {
                            const client = await p.target().createCDPSession();
                            await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
                            try {
                                await client.send('Security.setIgnoreCertificateErrors', { ignore: true });
                            } catch (secErr) {
                                logDebug('Security.setIgnoreCertificateErrors failed on reused page: ' + (secErr && secErr.message ? secErr.message : secErr));
                            }
                        } catch (e) {
                            logDebug('Failed to set download behavior on reused page: ' + (e && e.message ? e.message : e));
                        }
                    }
                    return p;
                }
            }
        } catch (e) {
            logDebug('Error while searching for existing pages: ' + (e && e.message ? e.message : e));
        }
    }

    // No reusable page found, create a new one
    const page = await browser.newPage();
    if (attachCounters) await attachRequestFailureCounters(page, { suppressionPatterns: opts.suppressionPatterns });
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
