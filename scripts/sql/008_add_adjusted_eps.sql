-- Migration: Add adjusted_eps to securities_earnings
-- Date: 2025-12-08
-- Note: Uses stored procedure to handle IF NOT EXISTS for older MySQL versions

DELIMITER //

DROP PROCEDURE IF EXISTS add_adjusted_eps_column//

CREATE PROCEDURE add_adjusted_eps_column()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = 'securities_earnings' 
        AND column_name = 'adjusted_eps'
    ) THEN
        ALTER TABLE securities_earnings ADD COLUMN adjusted_eps DECIMAL(12,6) NULL;
    END IF;
END//

DELIMITER ;

CALL add_adjusted_eps_column();
DROP PROCEDURE IF EXISTS add_adjusted_eps_column;

-- Note: adjusted_eps will be populated via backfill using security_splits (if available)
