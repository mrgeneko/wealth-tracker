-- Add a reversible normalized_key column to positions for safe, reversible keys
-- This script is idempotent (it checks for the column before adding)

/*
Run inside MySQL (adjust DB name if needed):
  mysql -u <user> -p -h <host> <database> < /path/to/001_add_positions_normalized_key.sql
*/

SET @db_name = DATABASE();

SELECT
    COUNT(*) INTO @has_col
FROM
    information_schema.columns
WHERE
    table_schema = @db_name
    AND table_name = 'positions'
    AND column_name = 'normalized_key';

-- Add column only if missing (older MySQL may not support ADD COLUMN IF NOT EXISTS)
SET @sql_col = IF(@has_col = 0, 'ALTER TABLE positions ADD COLUMN normalized_key VARCHAR(128) DEFAULT NULL', 'SELECT "normalized_key column already exists"');
PREPARE stmt_col FROM @sql_col;
EXECUTE stmt_col;
DEALLOCATE PREPARE stmt_col;

-- Check if index exists and add it only when missing (use prepared statement for conditional execution)
SELECT COUNT(*) INTO @has_idx FROM information_schema.statistics
WHERE table_schema = @db_name
    AND table_name = 'positions'
    AND index_name = 'idx_positions_normalized_key';

SET @sql_idx = IF(@has_idx = 0, 'ALTER TABLE positions ADD INDEX idx_positions_normalized_key (normalized_key)', 'SELECT "idx_positions_normalized_key already exists"');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- End of script
