-- Migration: Create securities_metadata table
-- Purpose: Store static/semi-static metadata about each security
-- Author: System
-- Date: 2025-12-07

CREATE TABLE IF NOT EXISTS securities_metadata (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL UNIQUE,
    
    -- Basic Info (from quote/quoteSummary)
    quote_type VARCHAR(50),              -- ETF, EQUITY, MUTUALFUND, FUTURE, etc.
    type_display VARCHAR(50),            -- User-friendly type
    short_name VARCHAR(255),
    long_name VARCHAR(500),
    
    -- Geographic & Exchange Info
    region VARCHAR(10),                  -- US, GB, etc.
    exchange VARCHAR(50),                -- PCX, NGM, NYSE, etc.
    full_exchange_name VARCHAR(255),     -- "New York Stock Exchange"
    currency VARCHAR(10),                -- USD, EUR, GBP, etc.
    timezone_name VARCHAR(100),          -- America/New_York
    timezone_short VARCHAR(10),          -- EST, PST, etc.
    
    -- Market Info
    market VARCHAR(50),                  -- us_market, etc.
    market_state VARCHAR(20),            -- REGULAR, CLOSED, PRE, POST
    tradeable BOOLEAN DEFAULT TRUE,
    
    -- Asset-Specific Fields (nullable for non-applicable types)
    -- ETF/Fund specific
    net_assets DECIMAL(20, 2),
    net_expense_ratio DECIMAL(8, 4),
    
    -- Equity/Fund specific
    shares_outstanding BIGINT,
    market_cap BIGINT,
    
    -- Dividend Info (latest known)
    dividend_rate DECIMAL(10, 4),
    dividend_yield DECIMAL(8, 4),
    trailing_annual_dividend_rate DECIMAL(10, 4),
    trailing_annual_dividend_yield DECIMAL(8, 4),
    
    -- Fundamental Ratios (latest)
    trailing_pe DECIMAL(10, 4),
    forward_pe DECIMAL(10, 4),
    price_to_book DECIMAL(10, 4),
    beta DECIMAL(10, 6),
    
    -- 52-Week Range
    fifty_two_week_low DECIMAL(18, 4),
    fifty_two_week_high DECIMAL(18, 4),
    
    -- Metadata
    first_trade_date DATETIME,
    data_source VARCHAR(50) DEFAULT 'yahoo',
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_symbol (symbol),
    INDEX idx_quote_type (quote_type),
    INDEX idx_exchange (exchange),
    INDEX idx_currency (currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
