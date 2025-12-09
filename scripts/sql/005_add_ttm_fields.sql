-- Migration: Add TTM dividend/earnings fields to securities_metadata
-- Date: 2025-12-08
-- Note: Uses stored procedure to handle IF NOT EXISTS for older MySQL versions

DELIMITER //

DROP PROCEDURE IF EXISTS add_ttm_columns//

CREATE PROCEDURE add_ttm_columns()
BEGIN
    -- Add ttm_dividend_amount if not exists
    IF NOT EXISTS (
        SELECT * FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = 'securities_metadata' 
        AND column_name = 'ttm_dividend_amount'
    ) THEN
        ALTER TABLE securities_metadata ADD COLUMN ttm_dividend_amount DECIMAL(12,4) NULL;
    END IF;

    -- Add ttm_eps if not exists
    IF NOT EXISTS (
        SELECT * FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = 'securities_metadata' 
        AND column_name = 'ttm_eps'
    ) THEN
        ALTER TABLE securities_metadata ADD COLUMN ttm_eps DECIMAL(12,4) NULL;
    END IF;
END//

DELIMITER ;

CALL add_ttm_columns();
DROP PROCEDURE IF EXISTS add_ttm_columns;
