-- Migration: Add pricing_provider and display_name to ticker_registry
-- This migration adds columns needed for source tracking in autocomplete

-- Step 1: Add pricing_provider column
ALTER TABLE ticker_registry
ADD COLUMN pricing_provider VARCHAR(50) DEFAULT NULL AFTER source;

-- Step 2: Add display_name column
ALTER TABLE ticker_registry
ADD COLUMN display_name VARCHAR(500) DEFAULT NULL AFTER pricing_provider;

-- Step 3: Populate pricing_provider based on source
-- NASDAQ/NYSE/OTHER_LISTED files -> YAHOO
UPDATE ticker_registry
SET pricing_provider = 'YAHOO'
WHERE source IN ('NASDAQ_FILE', 'NYSE_FILE', 'OTHER_LISTED_FILE')
  AND pricing_provider IS NULL;

-- Treasury files -> TREASURY_GOV
UPDATE ticker_registry
SET pricing_provider = 'TREASURY_GOV'
WHERE source IN ('TREASURY_FILE', 'TREASURY_HISTORICAL')
  AND pricing_provider IS NULL;

-- Crypto files -> INVESTING_COM
UPDATE ticker_registry
SET pricing_provider = 'INVESTING_COM'
WHERE source = 'CRYPTO_INVESTING_FILE'
  AND pricing_provider IS NULL;

-- Yahoo added tickers -> YAHOO (generic)
UPDATE ticker_registry
SET pricing_provider = 'YAHOO'
WHERE source = 'YAHOO'
  AND pricing_provider IS NULL;

-- Step 4: Generate display_name for all entries
-- Format: "TICKER - Name (SECURITY_TYPE, source_domain)"
UPDATE ticker_registry
SET display_name = CONCAT(
    ticker, ' - ',
    COALESCE(name, 'Unknown'), ' (',
    security_type, ', ',
    CASE source
        WHEN 'NASDAQ_FILE' THEN 'NASDAQ'
        WHEN 'NYSE_FILE' THEN 'NYSE'
        WHEN 'OTHER_LISTED_FILE' THEN 'Other Exchange'
        WHEN 'TREASURY_FILE' THEN 'Treasury.gov'
        WHEN 'TREASURY_HISTORICAL' THEN 'Treasury Historical'
        WHEN 'YAHOO' THEN 'Yahoo Finance'
        WHEN 'CRYPTO_INVESTING_FILE' THEN 'Investing.com'
        WHEN 'USER_ADDED' THEN 'User Added'
        ELSE source
    END, ')'
)
WHERE display_name IS NULL;

-- Step 5: Add index on pricing_provider for query performance
ALTER TABLE ticker_registry
ADD INDEX idx_pricing_provider (pricing_provider);
