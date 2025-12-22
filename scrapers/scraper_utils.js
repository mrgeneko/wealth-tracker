// Shared utility functions for all scrapers
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const { getExchange } = require('./exchange_registry');

function sanitizeForFilename(str) {
    // Only replace characters that are truly problematic for filenames
    // Preserve ticker symbols with: / - . = ! @ $ # : ;
    // Only sanitize: \ (Windows path separator), null bytes, and control characters
    return String(str)
        .replace(/\\/g, '_')     // backslash (Windows path separator)
        .replace(/\0/g, '_')     // null bytes
        .replace(/[\x00-\x1f\x7f]/g, '_');  // control characters
}

function getDateTimeString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}_${ms}`;
}


// Cache for the datetime string used in log file naming
let cachedDateTimeString = null;

function getTimestampedLogPath(prefix = 'scrape_daemon') {
    if (!cachedDateTimeString) {
        const timestampFile = '/usr/src/app/data/.log_timestamp';
        try {
            if (fs.existsSync(timestampFile)) {
                cachedDateTimeString = fs.readFileSync(timestampFile, 'utf8').trim();
            } else {
                cachedDateTimeString = getDateTimeString();
                fs.writeFileSync(timestampFile, cachedDateTimeString, 'utf8');
            }
        } catch (e) {
            // Fallback to generating new
            cachedDateTimeString = getDateTimeString();
        }
    }
    // Use process.env.LOG_DIR if available, otherwise default to ./logs relative to CWD
    const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
    return path.join(logDir, `${cachedDateTimeString}.${prefix}.log`);
}

// Default log path for logDebug calls without explicit path
let defaultLogPath = null;

function setDefaultLogPath(path) {
    defaultLogPath = path;
}

function logDebug(msg, logPath) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    const targetPath = logPath || defaultLogPath || getTimestampedLogPath();
    try {
        // Ensure directory exists for the target path
        try {
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            // ignore directory creation errors and fall back
        }
        fs.appendFileSync(targetPath, line);
    } catch (e) {
        // Fallback: write to local ./logs if original path is not writable
        try {
            const fallbackDir = './logs';
            if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
            const fname = (logPath && path.basename(logPath)) || path.basename(getTimestampedLogPath('scrape_daemon'));
            const fallbackPath = path.join(fallbackDir, fname);
            fs.appendFileSync(fallbackPath, line);
        } catch (e2) {
            // As a last resort, write to stderr
            try { console.error('logDebug fallback failed:', e2); } catch (e3) {}
        }
    }
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
        ,/aniview\.com/i
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

    // Suppress monetixads and mdhv/jelly endpoints observed in logs
    suppressionPatterns.push(
        /monetixads\.com/i,
        /monetix/i,
        /mdhv\.io/i,
        /jelly\.mdhv\.io/i,
        /jelly\./i
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

    // Add aniview.com to suppression substrings
    suppressionSubstrings.push('aniview.com');

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

    // Add monetixads and mdhv/jelly endpoints to substring fallback
    suppressionSubstrings.push('monetixads.com', 'monetix', 'mdhv.io', 'jelly.mdhv.io', 'jelly.');

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
            if (attempt === maxAttempts) {
                // If the error is a timeout, flag for browser restart
                if (e && e.message && (e.message.includes('Navigation timeout') || e.message.includes('TimeoutError') || e.message.includes('timeout'))) {
                    e.isProtocolTimeout = true;
                }
                throw e;
            }
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

function cleanNumberText(s) {
    if (!s && s !== 0) return '';
    return String(s).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

// Create a deterministic, reversible normalized key for symbols
// We use percent-encoding so the key is reversible and avoids collisions where
// the original symbol contains characters not suitable for DB/index keys.
function normalizedKey(symbol) {
    if (symbol == null) return '';
    try {
        return encodeURIComponent(String(symbol));
    } catch (e) {
        return String(symbol);
    }
}

function parseToIso(timeStr) {
    if (!timeStr) return '';
    let clean = String(timeStr).trim().replace(/\s+/g, ' ');
    // Remove "Last | " prefix if present
    clean = clean.replace(/^\|\s*/, '').replace(/Last\s*\|\s*/i, '');
    
    // If already ISO-like (YYYY-MM-DD...), return as is or validate
    if (/^\d{4}-\d{2}-\d{2}T/.test(clean)) return clean;
  
    // Remove timezone abbreviations (EST, EDT, etc.) to rely on explicit zone
    clean = clean.replace(/\s+(?:EST|EDT|ET)\s*$/i, '');
    
    const zone = 'America/New_York';
    // Common formats
    const formats = [
      'M/d/yy h:mm a',
      'M/d/yy',
      'h:mm a',
      'HH:mm',
      'H:mm',
      'MMM d HH:mm',
      'MMM d H:mm',
      'MMM d, HH:mm',
      'MMM d, H:mm'
    ];
  
    for (const fmt of formats) {
      const dt = DateTime.fromFormat(clean, fmt, { zone });
      if (dt.isValid) {
        return dt.toUTC().toISO();
      }
    }
    
    // Try ISO direct parse
    const dtIso = DateTime.fromISO(clean, { zone });
    if (dtIso.isValid) return dtIso.toUTC().toISO();
  
    return timeStr;
}

function isWeekday() {
    const now = DateTime.now().setZone('America/New_York');
    const day = now.weekday; // 1 is Monday, 7 is Sunday
    return day >= 1 && day <= 5;
}

function isPreMarketSession() {
    const now = DateTime.now().setZone('America/New_York');
    const preMarketOpen = now.set({ hour: 4, minute: 0, second: 0, millisecond: 0 });
    const marketOpen = now.set({ hour: 9, minute: 30, second: 0, millisecond: 0 });
    return now >= preMarketOpen && now < marketOpen;
}

function isRegularTradingSession() {
    const now = DateTime.now().setZone('America/New_York');
    const marketOpen = now.set({ hour: 9, minute: 30, second: 0, millisecond: 0 });
    const marketClose = now.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
    return now >= marketOpen && now < marketClose;
}

module.exports = {
    sanitizeForFilename,
    getDateTimeString,
    getTimestampedLogPath,
    logDebug,
    attachRequestFailureCounters,
    gotoWithRetries,
    getMetrics,
    resetMetrics,
    cleanNumberText,
    parseToIso,
    isWeekday,
    isPreMarketSession,
    isRegularTradingSession,
    // new helper
    normalizedKey
};

function isAfterHoursSession() {
    const now = DateTime.now().setZone('America/New_York');
    const marketClose = now.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
    const preMarketOpen = now.set({ hour: 4, minute: 0, second: 0, millisecond: 0 });
    // After hours is > 16:00 OR < 04:00 (next day? No, usually same day until midnight, then pre-market starts at 4am)
    // The python logic: current_time > market_close_time or current_time < pre_market_open_time
    // If it's 2 AM, it's < 4 AM, so it's after hours (or pre-pre-market).
    return now >= marketClose || now < preMarketOpen;
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

async function setupCDPSession(page, downloadPath) {
    if (!downloadPath) return;
    try {
        // Attempt to create a CDP session with retries. In unstable environments
        // the page or session may close unexpectedly; handle that gracefully.
        let client = null;
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
            attempts += 1;
            try {
                if (page.isClosed && page.isClosed()) throw new Error('page is closed');
                client = await page.target().createCDPSession();
                await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
                // In some environments Chrome enforces certificate transparency checks
                // which can cause net::ERR_CERTIFICATE_TRANSPARENCY_REQUIRED when navigating.
                // Enable ignoring certificate errors via the Security domain for this session.
                try {
                    await client.send('Security.setIgnoreCertificateErrors', { ignore: true });
                } catch (secErr) {
                    logDebug('Security.setIgnoreCertificateErrors failed: ' + (secErr && secErr.message ? secErr.message : secErr));
                }
                // success
                break;
            } catch (e) {
                logDebug(`setupCDPSession attempt ${attempts} failed: ${e && e.message ? e.message : e}`);
                try { if (client && client.detach) client.detach(); } catch (err) {}
                if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 500 * attempts));
                else throw new Error('Failed to setup CDP session: ' + (e && e.message ? e.message : e));
            }
        }
    } catch (e) {
        logDebug('Failed to set download behavior/CDP setup: ' + (e && e.message ? e.message : e));
    }
}

async function createPreparedPage(browser, opts = {}) {
    // opts: { url, downloadPath, userAgent, viewport, waitUntil, timeout, attachCounters=true, gotoRetries }
    const {
        url,
        downloadPath,
        // If provided, configure and (optionally) navigate this existing page instead of creating a new one.
        existingPage = null,
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

    // Track protocol timeout errors
    let protocolTimeoutCount = 0;
    const MAX_PROTOCOL_TIMEOUTS_IN_SETUP = 2;

    // Helper to check and track protocol timeouts
    const checkProtocolTimeout = (e, operation) => {
        const msg = e && e.message ? e.message : String(e);
        if (isProtocolTimeoutError(msg)) {
            protocolTimeoutCount++;
            logDebug(`Protocol timeout in ${operation} (count: ${protocolTimeoutCount}/${MAX_PROTOCOL_TIMEOUTS_IN_SETUP})`);
            if (protocolTimeoutCount >= MAX_PROTOCOL_TIMEOUTS_IN_SETUP) {
                // Throw to signal browser needs restart
                const err = new Error(`Multiple protocol timeouts detected (${protocolTimeoutCount}), browser may need restart`);
                err.isProtocolTimeout = true;
                throw err;
            }
        }
    };

    // If an existing page is provided (e.g., from PagePool), set it up in-place.
    if (existingPage) {
        const p = existingPage;
        if (attachCounters) {
            try { await attachRequestFailureCounters(p, { suppressionPatterns: opts.suppressionPatterns }); } catch (e) {
                logDebug('attachRequestFailureCounters failed on existing page: ' + (e && e.message ? e.message : e));
                checkProtocolTimeout(e, 'attachRequestFailureCounters');
            }
        }
        try { await p.setUserAgent(userAgent); } catch (e) {
            logDebug('setUserAgent on existing page failed: ' + (e && e.message ? e.message : e));
            checkProtocolTimeout(e, 'setUserAgent');
        }
        try { await p.setViewport(viewport); } catch (e) {
            logDebug('setViewport on existing page failed: ' + (e && e.message ? e.message : e));
            checkProtocolTimeout(e, 'setViewport');
        }
        if (url) {
            try { await gotoWithRetries(p, url, { waitUntil, timeout }, gotoRetries); } catch (e) { logDebug('gotoWithRetries on existing page failed: ' + (e && e.message ? e.message : e)); }
        }
        try { await setupCDPSession(p, downloadPath); } catch (e) { logDebug('setupCDPSession failed on existing page: ' + (e && e.message ? e.message : e)); }
        return p;
    }

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
                    // Skip closed pages
                    try { if (p.isClosed && p.isClosed()) { logDebug('Skipped reuse of closed page'); continue; } } catch (e) {}

                    // Attach counters and best-effort setup; guard each operation so a failing page doesn't abort the entire flow
                    if (attachCounters) {
                        try { await attachRequestFailureCounters(p, { suppressionPatterns: opts.suppressionPatterns }); } catch (e) { 
                            logDebug('attachRequestFailureCounters failed: ' + (e && e.message ? e.message : e)); 
                            checkProtocolTimeout(e, 'attachRequestFailureCounters');
                        }
                    }
                    try { await p.setUserAgent(userAgent); } catch (e) { 
                        logDebug('setUserAgent on reused page failed: ' + (e && e.message ? e.message : e)); 
                        checkProtocolTimeout(e, 'setUserAgent');
                    }
                    try { await p.setViewport(viewport); } catch (e) { 
                        logDebug('setViewport on reused page failed: ' + (e && e.message ? e.message : e)); 
                        checkProtocolTimeout(e, 'setViewport');
                    }
                    try { await p.bringToFront(); } catch (e) { 
                        logDebug('bringToFront on reused page failed: ' + (e && e.message ? e.message : e)); 
                        checkProtocolTimeout(e, 'bringToFront');
                    }

                    if (reloadExisting && url) {
                        try {
                            await gotoWithRetries(p, url, { waitUntil, timeout }, gotoRetries);
                        } catch (e) {
                            logDebug('Reloading existing page failed: ' + (e && e.message ? e.message : e));
                            checkProtocolTimeout(e, 'gotoWithRetries');
                        }
                    }
                    // Ensure download behavior / certificate ignore applied for reused page if requested
                    try { await setupCDPSession(p, downloadPath); } catch (e) { 
                        logDebug('setupCDPSession failed on reused page: ' + (e && e.message ? e.message : e)); 
                        checkProtocolTimeout(e, 'setupCDPSession');
                    }
                    // Final check that page is still open
                    try { if (p.isClosed && p.isClosed()) { logDebug('Reused page closed after setup, skipping'); continue; } } catch (e) {}
                    return p;
                }
            }
        } catch (e) {
            logDebug('Error while searching for existing pages: ' + (e && e.message ? e.message : e));
            // Re-throw if it's a protocol timeout error we flagged
            if (e.isProtocolTimeout) throw e;
        }
    }

    // No reusable page found, create a new one
    const page = await browser.newPage();
    if (attachCounters) {
        try { await attachRequestFailureCounters(page, { suppressionPatterns: opts.suppressionPatterns }); } catch (e) { 
            logDebug('attachRequestFailureCounters failed on new page: ' + (e && e.message ? e.message : e)); 
            checkProtocolTimeout(e, 'attachRequestFailureCounters');
        }
    }
    try { await page.setUserAgent(userAgent); } catch (e) { 
        logDebug('setUserAgent on new page failed: ' + (e && e.message ? e.message : e)); 
        checkProtocolTimeout(e, 'setUserAgent');
    }
    try { await page.setViewport(viewport); } catch (e) { 
        logDebug('setViewport on new page failed: ' + (e && e.message ? e.message : e)); 
        checkProtocolTimeout(e, 'setViewport');
    }
    if (url) {
        try { await gotoWithRetries(page, url, { waitUntil, timeout }, gotoRetries); } catch (e) { logDebug('gotoWithRetries on new page failed: ' + (e && e.message ? e.message : e)); }
    }
    try { await setupCDPSession(page, downloadPath); } catch (e) { logDebug('setupCDPSession failed on new page: ' + (e && e.message ? e.message : e)); }
    return page;
}

async function savePageSnapshot(page, basePath) {
    // Writes <basePath>.html, <basePath>.png and <basePath>.cookies.json
    try {
        const fullHtml = await page.content();
        try { fs.writeFileSync(basePath + '.html', fullHtml, 'utf-8'); } catch (e) { logDebug('Failed to write html snapshot: ' + e.message); }
        try { await page.screenshot({ path: basePath + '.png', fullPage: true }); } catch (e) { logDebug('Screenshot failed: ' + (e && e.message ? e.message : e)); }
        //try { const cookies = await page.cookies(); fs.writeFileSync(basePath + '.cookies.json', JSON.stringify(cookies, null, 2), 'utf-8'); } catch (e) { logDebug('Failed to write cookies snapshot: ' + (e && e.message ? e.message : e)); }
        return fullHtml;
    } catch (e) {
        logDebug('savePageSnapshot failed: ' + (e && e.message ? e.message : e));
        return null;
    }
}

/**
 * Get constructible scraper URLs for a given ticker
 * @param {string} ticker - The ticker symbol (e.g., 'AAPL' for stocks, '91282CGA3' for bonds)
 * @param {string} [type='stock'] - The position type: 'stock', 'etf', or 'bond'
 * @returns {Array<{source: string, url: string}>} Array of source/url pairs
 */
async function getConstructibleUrls(ticker, type = 'stock') {
    if (!ticker) return [];
    
    const normalizedType = String(type).toLowerCase();
    
    // Handle bonds separately
    if (normalizedType === 'bond') {
        const bondTicker = String(ticker).toUpperCase();
        return [
            { source: 'webull', url: `https://www.webull.com/quote/bond-${bondTicker}` }
        ];
    }
    
    // Stock/ETF logic (existing behavior)
    // Normalize ticker: ensure uppercase and use dot separator for these domains
    // e.g. BRK-B -> BRK.B
    const normalizedTicker = String(ticker).toUpperCase().replace(/-/g, '.');
    const exchange = await getExchange(ticker);
    
    const urls = [
        { source: 'cnbc', url: `https://www.cnbc.com/quotes/${normalizedTicker}` },
        //{ source: 'moomoo', url: `https://www.moomoo.com/stock/${normalizedTicker}-US` },
        { source: 'robinhood', url: `https://robinhood.com/us/en/stocks/${normalizedTicker}/` },
        //{ source: 'stocktwits', url: `https://stocktwits.com/symbol/${normalizedTicker}` },
        { source: 'ycharts', url: `https://ycharts.com/companies/${normalizedTicker}` }
        // stockmarketwatch removed - not all securities have full quote pages (some have chart-only template)
    ];

    if (exchange) {
        // Add exchange-dependent URLs
        if (exchange === 'NASDAQ') {
            urls.push({ source: 'nasdaq', url: `https://www.nasdaq.com/market-activity/stocks/${normalizedTicker.toLowerCase()}` });
            urls.push({ source: 'marketbeat', url: `https://www.marketbeat.com/stocks/NASDAQ/${normalizedTicker}/` });
            urls.push({ source: 'tradingview', url: `https://www.tradingview.com/symbols/NASDAQ-${normalizedTicker}/` });
            urls.push({ source: 'google', url: `https://www.google.com/finance/quote/${normalizedTicker}:NASDAQ` });
        } else if (exchange === 'NYSE') {
            urls.push({ source: 'marketbeat', url: `https://www.marketbeat.com/stocks/NYSE/${normalizedTicker}/` });
            urls.push({ source: 'tradingview', url: `https://www.tradingview.com/symbols/NYSE-${normalizedTicker}/` });
            urls.push({ source: 'google', url: `https://www.google.com/finance/quote/${normalizedTicker}:NYSE` });
        }
    }

    return urls;
}

module.exports = {
    sanitizeForFilename,
    getDateTimeString,
    getTimestampedLogPath,
    setDefaultLogPath,
    logDebug,
    gotoWithRetries,
    attachRequestFailureCounters,
    reportMetrics,
    getMetrics,
    resetMetrics,
    cleanNumberText,
    parseToIso,
    isWeekday,
    isPreMarketSession,
    isRegularTradingSession,
    isAfterHoursSession,
    getConstructibleUrls,
    // exported helper (percent-encoding reversible normalization)
    normalizedKey
};

// Check if error message indicates a protocol timeout
function isProtocolTimeoutError(errorMsg) {
    if (!errorMsg) return false;
    const msg = String(errorMsg).toLowerCase();
    return msg.includes('timed out') && (
        msg.includes('protocol') ||
        msg.includes('network.') ||
        msg.includes('emulation.') ||
        msg.includes('runtime.') ||
        msg.includes('page.') ||
        msg.includes('cdp') ||
        msg.includes('increase the')
    );
}

module.exports.isProtocolTimeoutError = isProtocolTimeoutError;

// Export helpers for page setup and snapshots
module.exports.createPreparedPage = createPreparedPage;
module.exports.savePageSnapshot = savePageSnapshot;
