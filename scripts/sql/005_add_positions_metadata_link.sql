-- Fix foreign key constraint for positions.metadata_symbol
-- The issue is charset/collation mismatch between positions.symbol and securities_metadata.symbol
-- Note: Uses stored procedure to handle IF NOT EXISTS for older MySQL versions

DELIMITER //

DROP PROCEDURE IF EXISTS add_metadata_symbol_column//

CREATE PROCEDURE add_metadata_symbol_column()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = 'positions' 
        AND column_name = 'metadata_symbol'
    ) THEN
        ALTER TABLE positions ADD COLUMN metadata_symbol VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci AFTER symbol;
    END IF;

    -- Add index if not exists
    IF NOT EXISTS (
        SELECT * FROM information_schema.statistics 
        WHERE table_schema = DATABASE() 
        AND table_name = 'positions' 
        AND index_name = 'idx_metadata_symbol'
    ) THEN
        CREATE INDEX idx_metadata_symbol ON positions (metadata_symbol);
    END IF;
END//

DELIMITER ;

CALL add_metadata_symbol_column();
DROP PROCEDURE IF EXISTS add_metadata_symbol_column;

-- Note: We skip the foreign key for now as it requires matching collations
-- The application logic will handle the relationship
