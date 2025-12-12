// populate_securities_metadata.js
// Fetch and populate security metadata from Yahoo Finance into MySQL
// Usage: node scripts/populate/populate_securities_metadata.js [--ticker AAPL] [--all]

// dotenv is optional - in Docker containers, env vars are already set
try { require('dotenv').config(); } catch (e) { /* dotenv not available, using existing env vars */ }
const mysql = require('mysql2/promise');

// Helper to load yahoo-finance2 (ESM-only package, must use dynamic import)
// Copied from working scrape_yahoo.js implementation
let _yahooModule = null;
async function ensureYahoo() {
    if (_yahooModule) return _yahooModule;
    // Helper: detect ES6 class constructors so we can instantiate them.
    function isClass(fn) {
        if (typeof fn !== 'function') return false;
        const s = Function.prototype.toString.call(fn);
        return /^class\s/.test(s);
    }
    try {
        // Try CommonJS require first (works when package exposes CJS or default)
        const req = require('yahoo-finance2');
        _yahooModule = (req && req.default) ? req.default : req;
        if (typeof _yahooModule === 'function') {
            if (isClass(_yahooModule) || (_yahooModule.prototype && (typeof _yahooModule.prototype.quote === 'function'))) {
                try {
                    _yahooModule = new _yahooModule();
                } catch (e) {
                    const FnCtor = _yahooModule;
                    _yahooModule = {
                        quote: async (symbol, opts) => {
                            try { const inst = new FnCtor(); return await inst.quote(symbol, opts); } catch (err) { return null; }
                        }
                    };
                }
            } else {
                const fn = _yahooModule;
                _yahooModule = { quote: fn };
            }
        }
        return _yahooModule;
    } catch (err) {
        // Fall back to dynamic ESM import when package is ESM-only
        const imported = await import('yahoo-finance2');
        _yahooModule = (imported && imported.default) ? imported.default : imported;
        if (typeof _yahooModule === 'function') {
            if (isClass(_yahooModule) || (_yahooModule.prototype && (typeof _yahooModule.prototype.quote === 'function'))) {
                try {
                    _yahooModule = new _yahooModule();
                } catch (e) {
                    const FnCtor = _yahooModule;
                    _yahooModule = {
                        quote: async (symbol, opts) => { try { const inst = new FnCtor(); return await inst.quote(symbol, opts); } catch (err) { return null; } }
                    };
                }
            } else {
                const fn = _yahooModule;
                _yahooModule = { quote: fn };
            }
        }
        return _yahooModule;
    }
}

// Helper functions
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseDate(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) return dateValue;
    if (typeof dateValue === 'string') {
        try {
            return new Date(dateValue);
        } catch (e) {
            return null;
        }
    }
    // Unix timestamp (seconds or milliseconds)
    if (typeof dateValue === 'number') {
        const ts = dateValue > 1e12 ? dateValue : dateValue * 1000;
        return new Date(ts);
    }
    return null;
}

function formatDateTime(date) {
    if (!date) return null;
    const d = parseDate(date);
    if (!d || isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

function formatDate(date) {
    if (!date) return null;
    const d = parseDate(date);
    if (!d || isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

async function fetchSecurityMetadata(symbol) {
    console.log(`Fetching metadata for ${symbol}...`);
    const yahoo = await ensureYahoo();

    if (!yahoo) {
        console.error('Yahoo module not loaded');
        return null;
    }

    try {
        // Try to use quoteSummary with explicit modules — this returns structured
        // sections like summaryDetail, summaryProfile/assetProfile etc which are
        // more reliable for fields like sector and dividend_yield.
        let result = null;
        try {
            const modules = ['price', 'summaryDetail', 'summaryProfile', 'assetProfile', 'defaultKeyStatistics', 'calendarEvents'];
            // quoteSummary sometimes requires an options object in different package versions
            if (typeof yahoo.quoteSummary === 'function') {
                result = await yahoo.quoteSummary(symbol, { modules });
            } else if (typeof yahoo.quote === 'function') {
                // Fallback to older quote wrapper
                const q = await yahoo.quote(symbol);
                result = { price: q, summaryDetail: q, quoteType: q, defaultKeyStatistics: q, calendarEvents: { earnings: q.earningsTimestamp ? { earningsDate: q.earningsTimestamp } : null, dividendDate: q.dividendDate } };
            }
        } catch (e) {
            // Some versions / environments may not support quoteSummary; fall back
            console.warn(`quoteSummary failed for ${symbol} — falling back to quote(): ${e.message}`);
            const q = await yahoo.quote(symbol);
            if (!q) {
                console.error(`No data returned for ${symbol}`);
                return null;
            }
            result = { price: q, summaryDetail: q, quoteType: q, defaultKeyStatistics: q, calendarEvents: { earnings: q.earningsTimestamp ? { earningsDate: q.earningsTimestamp } : null, dividendDate: q.dividendDate } };
        }

        // Normalize quoteSummary return shape: yahoo.quoteSummary often returns
        // { price: {...}, summaryDetail: {...}, summaryProfile: {...} }
        // If the library wrapped returned the full response under `result` with nested .price etc
        // treat 'result' as the structured payload; otherwise try to map top-level properties
        const price = result.price || result;
        const summaryDetail = result.summaryDetail || result.summarydetail || {};
        const summaryProfile = result.summaryProfile || result.summaryprofile || {};
        const assetProfile = result.assetProfile || result.assetprofile || {};
        const defaultKeyStatistics = result.defaultKeyStatistics || result.defaultkeystatistics || {};
        const calendarEvents = result.calendarEvents || result.calendarevents || {};

        return {
            price,
            summaryDetail,
            quoteType: price || {},
            summaryProfile,
            assetProfile,
            calendarEvents,
            defaultKeyStatistics
        };
    } catch (error) {
        console.error(`Error fetching ${symbol}:`, error.message);
        return null;
    }
}

async function upsertSecurityMetadata(connection, symbol, data) {
    if (!data) return;

    const price = data.price || {};
    const summaryDetail = data.summaryDetail || {};
    const quoteType = data.quoteType || {};
    const stats = data.defaultKeyStatistics || {};

    const metadata = {
        ticker: symbol,
        quote_type: quoteType.quoteType || price.quoteType,
        type_display: quoteType.typeDisp || price.typeDisp,
        short_name: quoteType.shortName || price.shortName,
        long_name: quoteType.longName || price.longName,

        // Sector may appear in different parts of the yahoo-finance2 response
        // (summaryProfile, assetProfile, summaryDetail, price). Try useful candidates
        // in order of likelihood.
        sector: (data.assetProfile && data.assetProfile.sector)
            || (data.summaryProfile && data.summaryProfile.sector)
            || (summaryDetail && summaryDetail.sector)
            || (price && price.sector) || null,
        industry: summaryDetail.industry || price.industry,

        region: price.region,
        exchange: quoteType.exchange || price.exchange,
        full_exchange_name: price.fullExchangeName,
        currency: price.currency,
        timezone_name: quoteType.timeZoneFullName || price.exchangeTimezoneName,
        timezone_short: quoteType.timeZoneShortName || price.exchangeTimezoneShortName,

        market: price.market,
        market_state: price.marketState,
        tradeable: price.tradeable,

        net_assets: summaryDetail.totalAssets || price.netAssets,
        net_expense_ratio: summaryDetail.expenseRatio || price.netExpenseRatio,

        shares_outstanding: price.sharesOutstanding,
        market_cap: price.marketCap || summaryDetail.marketCap,

        dividend_rate: summaryDetail.dividendRate,
        // Normalize dividend_yield to a fraction (e.g. 0.0435 for 4.35%).
        // Different Yahoo data fields sometimes return inconsistent units
        // (e.g., "dividendYield" may be '1.14' meaning 1.14% or '0.0114' meaning 1.14%).
        // Prefer trailingAnnualDividendYield if available (it's a fractional value)
        dividend_yield: (function() {
            const cand = summaryDetail && summaryDetail.trailingAnnualDividendYield !== undefined && summaryDetail.trailingAnnualDividendYield !== null
                ? summaryDetail.trailingAnnualDividendYield
                : (summaryDetail && summaryDetail.dividendYield !== undefined && summaryDetail.dividendYield !== null
                    ? summaryDetail.dividendYield
                    : (price && price.trailingAnnualDividendYield !== undefined && price.trailingAnnualDividendYield !== null
                        ? price.trailingAnnualDividendYield
                        : (price && price.dividendYield !== undefined && price.dividendYield !== null ? price.dividendYield : null)));

            // Configurable max acceptable dividend yield (fraction). Values above
            // this threshold are treated as suspicious and will be ignored.
            // Default: 15% (0.15)
            const MAX_ACCEPTABLE_YIELD = parseFloat(process.env.MAX_ACCEPTABLE_DIVIDEND_YIELD || '0.15');

            if (cand === null || cand === undefined) return null;
            const parsed = parseFloat(cand);
            if (isNaN(parsed)) return null;
            // If value seems to be a percentage (e.g., > 1 and <= 100), convert to fraction
            if (parsed > 1 && parsed <= 100) {
                const frac = parsed / 100.0;
                if (frac > MAX_ACCEPTABLE_YIELD) {
                    console.warn(`Suspicious dividend yield for ${symbol}: ${parsed} (converted ${frac}) > ${MAX_ACCEPTABLE_YIELD} — ignoring`);
                    return null;
                }
                return frac;
            }
            // If value is absurdly large (e.g., >100), treat as null to avoid bad data
            if (parsed > 100) return null;
            // If parsed is fractional already, check threshold
            if (parsed > MAX_ACCEPTABLE_YIELD) {
                console.warn(`Suspicious dividend yield for ${symbol}: ${parsed} > ${MAX_ACCEPTABLE_YIELD} — ignoring`);
                return null;
            }
            // Otherwise assume it's a fractional value already
            return parsed;
        })(),
        trailing_annual_dividend_rate: summaryDetail.trailingAnnualDividendRate || price.trailingAnnualDividendRate,
        trailing_annual_dividend_yield: summaryDetail.trailingAnnualDividendYield || price.trailingAnnualDividendYield,

        trailing_pe: summaryDetail.trailingPE || price.trailingPE,
        forward_pe: summaryDetail.forwardPE,
        price_to_book: summaryDetail.priceToBook || price.priceToBook,
        beta: summaryDetail.beta || stats.beta,

        fifty_two_week_low: summaryDetail.fiftyTwoWeekLow || price.fiftyTwoWeekLow,
        fifty_two_week_high: summaryDetail.fiftyTwoWeekHigh || price.fiftyTwoWeekHigh,

        first_trade_date: formatDateTime(price.firstTradeDateMilliseconds),
        data_source: 'yahoo'
    };

    const sql = `
    INSERT INTO securities_metadata (
      ticker, quote_type, type_display, short_name, long_name,
      sector, industry,
      region, exchange, full_exchange_name, currency, timezone_name, timezone_short,
      market, market_state, tradeable,
      net_assets, net_expense_ratio,
      shares_outstanding, market_cap,
      dividend_rate, dividend_yield, trailing_annual_dividend_rate, trailing_annual_dividend_yield,
      trailing_pe, forward_pe, price_to_book, beta,
      fifty_two_week_low, fifty_two_week_high,
      first_trade_date, data_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      quote_type = VALUES(quote_type),
      type_display = VALUES(type_display),
      short_name = VALUES(short_name),
      long_name = VALUES(long_name),
      sector = VALUES(sector),
      industry = VALUES(industry),
      region = VALUES(region),
      exchange = VALUES(exchange),
      full_exchange_name = VALUES(full_exchange_name),
      currency = VALUES(currency),
      timezone_name = VALUES(timezone_name),
      timezone_short = VALUES(timezone_short),
      market = VALUES(market),
      market_state = VALUES(market_state),
      tradeable = VALUES(tradeable),
      net_assets = VALUES(net_assets),
      net_expense_ratio = VALUES(net_expense_ratio),
      shares_outstanding = VALUES(shares_outstanding),
      market_cap = VALUES(market_cap),
      dividend_rate = VALUES(dividend_rate),
      dividend_yield = VALUES(dividend_yield),
      trailing_annual_dividend_rate = VALUES(trailing_annual_dividend_rate),
      trailing_annual_dividend_yield = VALUES(trailing_annual_dividend_yield),
      trailing_pe = VALUES(trailing_pe),
      forward_pe = VALUES(forward_pe),
      price_to_book = VALUES(price_to_book),
      beta = VALUES(beta),
      fifty_two_week_low = VALUES(fifty_two_week_low),
      fifty_two_week_high = VALUES(fifty_two_week_high),
      first_trade_date = VALUES(first_trade_date)
  `;

    const values = [
        metadata.ticker, metadata.quote_type, metadata.type_display, metadata.short_name, metadata.long_name,
        metadata.sector, metadata.industry,
        metadata.region, metadata.exchange, metadata.full_exchange_name, metadata.currency, metadata.timezone_name, metadata.timezone_short,
        metadata.market, metadata.market_state, metadata.tradeable,
        metadata.net_assets, metadata.net_expense_ratio,
        metadata.shares_outstanding, metadata.market_cap,
        metadata.dividend_rate, metadata.dividend_yield, metadata.trailing_annual_dividend_rate, metadata.trailing_annual_dividend_yield,
        metadata.trailing_pe, metadata.forward_pe, metadata.price_to_book, metadata.beta,
        metadata.fifty_two_week_low, metadata.fifty_two_week_high,
        metadata.first_trade_date, metadata.data_source
    ].map(v => v === undefined ? null : v);  // Convert undefined to null for MySQL

    await connection.execute(sql, values);
    console.log(`✓ Upserted metadata for ${symbol}`);
}

async function upsertEarningsEvents(connection, symbol, calendarEvents) {
    if (!calendarEvents || !calendarEvents.earnings) return;

    const earnings = calendarEvents.earnings;
    let earningsDate = earnings.earningsDate || earnings.earningsAverage;

    // Handle case where earningsDate is an array (Yahoo Finance returns arrays)
    if (Array.isArray(earningsDate) && earningsDate.length > 0) {
        earningsDate = earningsDate[0];
    }

    if (!earningsDate) return;

    // Ensure the date can be properly formatted before proceeding
    const formattedEarningsDate = formatDateTime(earningsDate);
    if (!formattedEarningsDate) {
        console.log(`  ⊘ Skipping earnings for ${symbol} (invalid date format: ${earningsDate})`);
        return;
    }

    const earningsData = {
        ticker: symbol,
        earnings_date: formattedEarningsDate,
        earnings_date_end: formatDateTime(earnings.earningsHigh),
        is_estimate: true,
        eps_estimate: null,
        revenue_estimate: earnings.revenue?.avg,
        fiscal_quarter: null,
        fiscal_year: null,
        data_source: 'yahoo'
    };

    const sql = `
    INSERT INTO securities_earnings (
      ticker, earnings_date, earnings_date_end, is_estimate,
      eps_estimate, revenue_estimate, fiscal_quarter, fiscal_year, data_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      earnings_date_end = VALUES(earnings_date_end),
      is_estimate = VALUES(is_estimate),
      eps_estimate = VALUES(eps_estimate),
      revenue_estimate = VALUES(revenue_estimate)
  `;

    const values = [
        earningsData.ticker, earningsData.earnings_date, earningsData.earnings_date_end,
        earningsData.is_estimate, earningsData.eps_estimate, earningsData.revenue_estimate,
        earningsData.fiscal_quarter, earningsData.fiscal_year, earningsData.data_source
    ].map(v => v === undefined ? null : v);  // Convert undefined to null for MySQL

    try {
        await connection.execute(sql, values);
        console.log(`  ✓ Upserted earnings event for ${symbol}`);
    } catch (error) {
        console.error(`  ✗ Error upserting earnings for ${symbol}:`, error.message);
    }
}

async function upsertDividendEvents(connection, ticker, calendarEvents) {
    if (!calendarEvents || !calendarEvents.dividendDate) return;

    const dividendDate = calendarEvents.dividendDate;

    if (!dividendDate) return;

    // Note: Yahoo's calendarEvents typically only provides the next dividend date
    // For full dividend history, you'd need to use the historical dividends endpoint
    const dividendData = {
        ticker: ticker,
        ex_dividend_date: formatDate(dividendDate),
        payment_date: null,
        record_date: null,
        declaration_date: null,
        dividend_amount: 0, // Not provided in calendarEvents, would need summaryDetail.dividendRate
        dividend_type: 'CASH',
        currency: 'USD',
        is_estimate: true,
        status: 'estimated',
        data_source: 'yahoo'
    };

    // Skip if we don't have the dividend amount
    if (!dividendData.dividend_amount || dividendData.dividend_amount === 0) {
        console.log(`  ⊘ Skipping dividend for ${ticker} (no amount available)`);
        return;
    }

    const sql = `
    INSERT INTO securities_dividends (
      ticker, ex_dividend_date, payment_date, record_date, declaration_date,
      dividend_amount, dividend_type, currency, is_estimate, status, data_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      payment_date = VALUES(payment_date),
      is_estimate = VALUES(is_estimate),
      status = VALUES(status)
  `;

    const values = [
        dividendData.ticker, dividendData.ex_dividend_date, dividendData.payment_date,
        dividendData.record_date, dividendData.declaration_date, dividendData.dividend_amount,
        dividendData.dividend_type, dividendData.currency, dividendData.is_estimate,
        dividendData.status, dividendData.data_source
    ];

    try {
        await connection.execute(sql, values);
        console.log(`  ✓ Upserted dividend event for ${ticker}`);
    } catch (error) {
        console.error(`  ✗ Error upserting dividend for ${ticker}:`, error.message);
    }
}

async function getUniqueTickers(connection) {
    const [rows] = await connection.execute(`
    SELECT DISTINCT ticker FROM positions WHERE ticker IS NOT NULL AND ticker != 'CASH'
  `);
    return rows.map(r => r.ticker);
}

async function getAllMetadataTickers(connection) {
        const [rows] = await connection.execute(`
        SELECT DISTINCT ticker FROM securities_metadata WHERE ticker IS NOT NULL AND ticker != ''
    `);
        return rows.map(r => r.ticker);
}

async function main() {
    const args = process.argv.slice(2);
    const tickerArg = args.includes('--ticker') ? args[args.indexOf('--ticker') + 1] : null;
    const allFlag = args.includes('--all');
    const allMetadataFlag = args.includes('--all-metadata') || args.includes('--all_metadata');

    // Connect to MySQL
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    console.log('Connected to MySQL');

    try {
        let symbols = [];

        if (tickerArg) {
            symbols = [tickerArg];
            console.log(`Processing single ticker: ${tickerArg}`);
        } else if (allFlag) {
            symbols = await getUniqueTickers(connection);
            console.log(`Processing ${symbols.length} symbols from positions table`);
        } else if (allMetadataFlag) {
            symbols = await getAllMetadataTickers(connection);
            console.log(`Processing ${symbols.length} symbols from securities_metadata table`);
        } else {
            console.log('Usage:');
            console.log('  node scripts/populate/populate_securities_metadata.js --ticker AAPL');
            console.log('  node scripts/populate/populate_securities_metadata.js --all');
            process.exit(1);
        }

        for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            console.log(`\n[${i + 1}/${symbols.length}] Processing ${symbol}...`);

            const data = await fetchSecurityMetadata(symbol);

            if (data) {
                await upsertSecurityMetadata(connection, symbol, data);
                await upsertEarningsEvents(connection, symbol, data.calendarEvents);
                await upsertDividendEvents(connection, symbol, data.calendarEvents);
            }

            // Rate limiting: wait between requests
            if (i < symbols.length - 1) {
                await sleep(500); // 500ms delay between symbols
            }
        }

        console.log('\n✓ Metadata population complete!');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await connection.end();
    }
}

main();
