-- Migration: Create securities_earnings table
-- Purpose: Store earnings calendar events and results
-- Author: System
-- Date: 2025-12-07

CREATE TABLE IF NOT EXISTS securities_earnings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    
    -- Earnings Event Info
    earnings_date DATETIME NOT NULL,
    earnings_date_end DATETIME,          -- If range provided
    is_estimate BOOLEAN DEFAULT TRUE,    -- vs confirmed
    
    -- Actual Results (populated after earnings)
    eps_actual DECIMAL(10, 4),
    eps_estimate DECIMAL(10, 4),
    revenue_actual BIGINT,
    revenue_estimate BIGINT,
    
    -- Metadata
    fiscal_quarter VARCHAR(10),          -- Q1, Q2, Q3, Q4
    fiscal_year INT,
    data_source VARCHAR(50) DEFAULT 'yahoo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_earnings (symbol, earnings_date, fiscal_quarter, fiscal_year),
    INDEX idx_symbol (symbol),
    INDEX idx_earnings_date (earnings_date),
    FOREIGN KEY (symbol) REFERENCES securities_metadata(symbol) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
