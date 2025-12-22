/**
 * Pricing utilities for mapping data sources to pricing classes
 * 
 * Pricing Class determines which scrapers can price a ticker:
 * - US_EQUITY: yahoo, cnbc, robinhood, google, investing.com, etc.
 * - US_TREASURY: webull (bond prices)
 * - CRYPTO_INVESTING: investing.com watchlist only
 * - UNKNOWN: fallback, try US_EQUITY scrapers
 */

// Map from source (data provenance) to pricing_class (pricing capability)
const SOURCE_TO_PRICING_CLASS = {
    // US equity listing files -> can be priced by many US-focused scrapers
    'NASDAQ_FILE': 'US_EQUITY',
    'NYSE_FILE': 'US_EQUITY',
    'OTHER_LISTED_FILE': 'US_EQUITY',
    
    // Treasury listings -> priced by Webull bond scraper
    'TREASURY_FILE': 'US_TREASURY',
    'TREASURY_HISTORICAL': 'US_TREASURY',
    'US_TREASURY_AUCTIONS': 'US_TREASURY',
    
    // Crypto from investing.com file -> only investing.com watchlist
    'CRYPTO_INVESTING_FILE': 'CRYPTO_INVESTING',
    
    // Yahoo-added tickers are typically US equities
    'YAHOO': 'US_EQUITY',
    
    // User-added tickers default to US_EQUITY
    'USER_ADDED': 'US_EQUITY',
    
    // Manual fetch from dashboard
    'MANUAL_FETCH': 'US_EQUITY'
};

// Map from pricing_provider (from ticker_registry) to pricing_class
const PROVIDER_TO_PRICING_CLASS = {
    'YAHOO': 'US_EQUITY',
    'TREASURY_GOV': 'US_TREASURY',
    'INVESTING_COM': 'CRYPTO_INVESTING'
};

// Valid pricing classes
const VALID_PRICING_CLASSES = ['US_EQUITY', 'US_TREASURY', 'CRYPTO_INVESTING', 'UNKNOWN'];

/**
 * Get pricing_class from source (data provenance)
 * @param {string} source - The source field (e.g., 'NASDAQ_FILE', 'CRYPTO_INVESTING_FILE')
 * @returns {string} The pricing class
 */
function getPricingClassFromSource(source) {
    if (!source) return 'US_EQUITY';
    const normalized = source.toUpperCase().trim();
    return SOURCE_TO_PRICING_CLASS[normalized] || 'US_EQUITY';
}

/**
 * Get pricing_class from pricing_provider (from ticker_registry)
 * @param {string} pricingProvider - The pricing_provider field
 * @returns {string} The pricing class
 */
function getPricingClassFromProvider(pricingProvider) {
    if (!pricingProvider) return 'US_EQUITY';
    const normalized = pricingProvider.toUpperCase().trim();
    return PROVIDER_TO_PRICING_CLASS[normalized] || 'US_EQUITY';
}

/**
 * Get pricing_class with fallback logic
 * Prefers pricing_provider if available, falls back to source mapping
 * @param {object} options - { source, pricingProvider, securityType }
 * @returns {string} The pricing class
 */
function getPricingClass({ source, pricingProvider, securityType }) {
    // If we have pricing_provider from ticker_registry, use it
    if (pricingProvider) {
        return getPricingClassFromProvider(pricingProvider);
    }
    
    // Fall back to source mapping
    if (source) {
        return getPricingClassFromSource(source);
    }
    
    // Default based on security type
    if (securityType) {
        const type = securityType.toLowerCase();
        if (type === 'bond' || type === 'us_treasury') {
            return 'US_TREASURY';
        }
        if (type === 'crypto') {
            return 'CRYPTO_INVESTING';
        }
    }
    
    return 'US_EQUITY';
}

/**
 * Normalize pricing_class to ensure it's a valid value
 * @param {string} pricingClass - The pricing class to normalize
 * @returns {string} A valid pricing class
 */
function normalizePricingClass(pricingClass) {
    if (!pricingClass) return 'US_EQUITY';
    const normalized = pricingClass.toUpperCase().trim();
    return VALID_PRICING_CLASSES.includes(normalized) ? normalized : 'US_EQUITY';
}

module.exports = {
    SOURCE_TO_PRICING_CLASS,
    PROVIDER_TO_PRICING_CLASS,
    VALID_PRICING_CLASSES,
    getPricingClassFromSource,
    getPricingClassFromProvider,
    getPricingClass,
    normalizePricingClass
};
