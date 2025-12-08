-- Migration: Add provenance columns and adjusted_dividend_amount + security_splits
-- Date: 2025-12-08

-- Non-destructive: add provenance columns to dividends and earnings
ALTER TABLE securities_dividends
  ADD COLUMN IF NOT EXISTS source_event_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS source_name VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS adjusted_dividend_amount DECIMAL(12,6) NULL;

ALTER TABLE securities_earnings
  ADD COLUMN IF NOT EXISTS source_event_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS source_name VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMP NULL;

ALTER TABLE securities_metadata
  ADD COLUMN IF NOT EXISTS ttm_last_calculated_at DATETIME NULL;

-- Track corporate splits separately so we can compute adjusted_dividend_amount
CREATE TABLE IF NOT EXISTS security_splits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL,
  split_date DATE NOT NULL,
  -- Represent split as ratio applied to historical amounts; examples: 0.5 for 2-for-1, 2.0 for 1-for-2
  split_ratio DECIMAL(16,8) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_splits_symbol_date (symbol, split_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
