-- Migration: Create securities_dividends table
-- Purpose: Store historical and upcoming dividend payments
-- Author: System
-- Date: 2025-12-07

CREATE TABLE IF NOT EXISTS securities_dividends (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    
    -- Dividend Event Info
    ex_dividend_date DATE NOT NULL,      -- Date to own stock by
    payment_date DATE,                   -- Actual payment date
    record_date DATE,                    -- Record date
    declaration_date DATE,               -- Announcement date
    
    -- Dividend Details
    dividend_amount DECIMAL(10, 4) NOT NULL,
    dividend_type VARCHAR(50),           -- CASH, STOCK, SPECIAL
    currency VARCHAR(10) DEFAULT 'USD',
    
    -- Status
    is_estimate BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'confirmed', -- confirmed, estimated, paid
    
    -- Metadata
    data_source VARCHAR(50) DEFAULT 'yahoo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_dividend (symbol, ex_dividend_date, dividend_amount),
    INDEX idx_symbol (symbol),
    INDEX idx_ex_date (ex_dividend_date),
    INDEX idx_payment_date (payment_date),
    FOREIGN KEY (symbol) REFERENCES securities_metadata(symbol) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
