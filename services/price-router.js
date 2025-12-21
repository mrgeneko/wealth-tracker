/**
 * PriceRouter
 *
 * Routes price fetching requests to the appropriate pricing provider based on
 * the pricing_provider field from ticker_registry or positions table.
 *
 * Supports:
 * - YAHOO: Yahoo Finance (stocks, ETFs, some crypto)
 * - TREASURY_GOV: US Treasury (bonds)
 * - INVESTING_COM: Investing.com (crypto, other assets)
 *
 * Architecture:
 * - Ticker + security_type uniquely identify which price to fetch
 * - pricing_provider determines which API/scraper to use
 * - Handles fallback logic when preferred provider fails
 */

class PriceRouter {
    constructor(options = {}) {
        this.pool = options.pool; // MySQL connection pool
        this.providers = {
            YAHOO: this._fetchFromYahoo.bind(this),
            TREASURY_GOV: this._fetchFromTreasury.bind(this),
            INVESTING_COM: this._fetchFromInvesting.bind(this)
        };
    }

    /**
     * Fetch price for a ticker with specified security type
     *
     * @param {string} ticker - The ticker symbol
     * @param {string} securityType - Security type (stock, etf, bond, crypto, etc.)
     * @param {object} options - Additional options
     * @returns {Promise<object>} Price data object
     */
    async fetchPrice(ticker, securityType, options = {}) {
        const normalizedTicker = ticker.toUpperCase().trim();
        const normalizedType = (securityType || 'stock').toLowerCase();

        // Determine pricing provider
        let pricingProvider = options.pricingProvider;

        if (!pricingProvider) {
            // Lookup pricing_provider from ticker_registry
            pricingProvider = await this._lookupPricingProvider(normalizedTicker, normalizedType);
        }

        if (!pricingProvider) {
            // Fallback to default routing based on security_type
            pricingProvider = this._getDefaultProvider(normalizedType);
        }

        console.log(`[PriceRouter] Routing ${normalizedTicker} (${normalizedType}) to ${pricingProvider}`);

        // Route to the appropriate provider
        const providerFunc = this.providers[pricingProvider];
        if (!providerFunc) {
            throw new Error(`Unknown pricing provider: ${pricingProvider}`);
        }

        try {
            const result = await providerFunc(normalizedTicker, normalizedType, options);
            return {
                ...result,
                ticker: normalizedTicker,
                security_type: normalizedType,
                pricing_provider: pricingProvider
            };
        } catch (error) {
            console.error(`[PriceRouter] Error fetching from ${pricingProvider}:`, error.message);

            // Attempt fallback if enabled
            if (options.allowFallback !== false) {
                return await this._attemptFallback(normalizedTicker, normalizedType, pricingProvider, options);
            }

            throw error;
        }
    }

    /**
     * Lookup pricing_provider from ticker_registry
     */
    async _lookupPricingProvider(ticker, securityType) {
        if (!this.pool) return null;

        try {
            const [rows] = await this.pool.execute(`
                SELECT pricing_provider
                FROM ticker_registry
                WHERE ticker = ? AND security_type = ?
                LIMIT 1
            `, [ticker, securityType.toUpperCase()]);

            return rows.length > 0 ? rows[0].pricing_provider : null;
        } catch (error) {
            console.error(`[PriceRouter] Error looking up pricing provider:`, error.message);
            return null;
        }
    }

    /**
     * Get default provider based on security type
     */
    _getDefaultProvider(securityType) {
        const typeMap = {
            'stock': 'YAHOO',
            'etf': 'YAHOO',
            'bond': 'TREASURY_GOV',
            'us_treasury': 'TREASURY_GOV',
            'crypto': 'INVESTING_COM',
            'cash': null, // Cash doesn't need price fetching
            'other': 'YAHOO'
        };

        return typeMap[securityType] || 'YAHOO';
    }

    /**
     * Attempt fallback to alternative provider
     */
    async _attemptFallback(ticker, securityType, failedProvider, options) {
        console.log(`[PriceRouter] Attempting fallback for ${ticker} (${securityType})`);

        // Define fallback chains
        const fallbackChains = {
            'YAHOO': ['INVESTING_COM'],
            'INVESTING_COM': ['YAHOO'],
            'TREASURY_GOV': [] // No fallback for treasuries
        };

        const fallbacks = fallbackChains[failedProvider] || [];

        for (const fallbackProvider of fallbacks) {
            try {
                console.log(`[PriceRouter] Trying fallback provider: ${fallbackProvider}`);
                const providerFunc = this.providers[fallbackProvider];
                const result = await providerFunc(ticker, securityType, options);

                return {
                    ...result,
                    ticker: ticker,
                    security_type: securityType,
                    pricing_provider: fallbackProvider,
                    fallback_from: failedProvider
                };
            } catch (fallbackError) {
                console.error(`[PriceRouter] Fallback ${fallbackProvider} failed:`, fallbackError.message);
            }
        }

        throw new Error(`All providers failed for ${ticker} (${securityType})`);
    }

    /**
     * Fetch price from Yahoo Finance
     */
    async _fetchFromYahoo(ticker, securityType, options) {
        // Load yahoo-finance2
        const YahooFinanceClass = require('yahoo-finance2').default || require('yahoo-finance2');
        const yahooFinance = new YahooFinanceClass({
            suppressNotices: ['yahooSurvey', 'rippieTip']
        });

        const quote = await yahooFinance.quote(ticker);

        if (!quote || !quote.regularMarketPrice) {
            throw new Error(`No price data from Yahoo for ${ticker}`);
        }

        const now = new Date().toISOString();

        return {
            price: quote.regularMarketPrice,
            previous_close_price: quote.regularMarketPreviousClose || null,
            prev_close_source: 'yahoo',
            prev_close_time: now,
            currency: quote.currency || 'USD',
            time: now,
            source: 'yahoo'
        };
    }

    /**
     * Fetch price from Treasury.gov
     * Note: Treasury prices are typically fetched via scraper daemon
     */
    async _fetchFromTreasury(ticker, securityType, options) {
        // Treasury prices are scraped asynchronously via Webull/scraper daemon
        // This method signals that the scraper should be triggered
        throw new Error(`Treasury prices require scraper daemon (ticker: ${ticker})`);
    }

    /**
     * Fetch price from Investing.com
     * Note: Investing.com typically requires web scraping
     */
    async _fetchFromInvesting(ticker, securityType, options) {
        // Investing.com prices would need to be scraped
        // For now, throw error indicating not yet implemented
        throw new Error(`Investing.com provider not yet implemented (ticker: ${ticker})`);
    }

    /**
     * Persist price to latest_prices table with security_type
     */
    async savePriceToDatabase(priceData) {
        if (!this.pool) {
            throw new Error('Database pool not configured');
        }

        const {
            ticker,
            security_type,
            price,
            previous_close_price,
            prev_close_source,
            prev_close_time,
            source,
            time
        } = priceData;

        try {
            // Use INSERT ... ON DUPLICATE KEY UPDATE for upsert behavior
            await this.pool.execute(`
                INSERT INTO latest_prices
                    (ticker, security_type, price, previous_close_price,
                     prev_close_source, prev_close_time, source, quote_time, capture_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    price = VALUES(price),
                    previous_close_price = VALUES(previous_close_price),
                    prev_close_source = VALUES(prev_close_source),
                    prev_close_time = VALUES(prev_close_time),
                    source = VALUES(source),
                    quote_time = VALUES(quote_time),
                    capture_time = NOW()
            `, [
                ticker,
                security_type.toUpperCase(),
                price,
                previous_close_price,
                prev_close_source,
                prev_close_time,
                source,
                time
            ]);

            console.log(`[PriceRouter] Saved price to database: ${ticker} (${security_type}) = ${price}`);
            return true;
        } catch (error) {
            console.error(`[PriceRouter] Error saving price to database:`, error.message);
            throw error;
        }
    }

    /**
     * Get price from database for ticker + security_type
     */
    async getPriceFromDatabase(ticker, securityType) {
        if (!this.pool) {
            throw new Error('Database pool not configured');
        }

        try {
            const [rows] = await this.pool.execute(`
                SELECT *
                FROM latest_prices
                WHERE ticker = ? AND security_type = ?
                LIMIT 1
            `, [ticker.toUpperCase(), securityType.toUpperCase()]);

            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error(`[PriceRouter] Error fetching price from database:`, error.message);
            throw error;
        }
    }
}

module.exports = PriceRouter;
