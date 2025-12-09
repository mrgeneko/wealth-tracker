-- Migration: Add provenance columns and adjusted_dividend_amount + security_splits
-- Date: 2025-12-08
-- Note: Uses stored procedure to handle IF NOT EXISTS for older MySQL versions

DELIMITER //

DROP PROCEDURE IF EXISTS add_provenance_columns//

CREATE PROCEDURE add_provenance_columns()
BEGIN
    -- securities_dividends columns
    IF NOT EXISTS (SELECT * FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'securities_dividends' AND column_name = 'source_event_id') THEN
        ALTER TABLE securities_dividends ADD COLUMN source_event_id VARCHAR(255) NULL;
    END IF;
    IF NOT EXISTS (SELECT * FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'securities_dividends' AND column_name = 'source_name') THEN
        ALTER TABLE securities_dividends ADD COLUMN source_name VARCHAR(100) NULL;
    END IF;
    IF NOT EXISTS (SELECT * FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'securities_dividends' AND column_name = 'ingested_at') THEN
        ALTER TABLE securities_dividends ADD COLUMN ingested_at TIMESTAMP NULL;
    END IF;
    IF NOT EXISTS (SELECT * FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'securities_dividends' AND column_name = 'adjusted_dividend_amount') THEN
        ALTER TABLE securities_dividends ADD COLUMN adjusted_dividend_amount DECIMAL(12,6) NULL;
    END IF;

    -- securities_earnings columns
    IF NOT EXISTS (SELECT * FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'securities_earnings' AND column_name = 'source_event_id') THEN
        ALTER TABLE securities_earnings ADD COLUMN source_event_id VARCHAR(255) NULL;
    END IF;
    IF NOT EXISTS (SELECT * FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'securities_earnings' AND column_name = 'source_name') THEN
        ALTER TABLE securities_earnings ADD COLUMN source_name VARCHAR(100) NULL;
    END IF;
    IF NOT EXISTS (SELECT * FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'securities_earnings' AND column_name = 'ingested_at') THEN
        ALTER TABLE securities_earnings ADD COLUMN ingested_at TIMESTAMP NULL;
    END IF;

    -- securities_metadata column
    IF NOT EXISTS (SELECT * FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'securities_metadata' AND column_name = 'ttm_last_calculated_at') THEN
        ALTER TABLE securities_metadata ADD COLUMN ttm_last_calculated_at DATETIME NULL;
    END IF;
END//

DELIMITER ;

CALL add_provenance_columns();
DROP PROCEDURE IF EXISTS add_provenance_columns;

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
