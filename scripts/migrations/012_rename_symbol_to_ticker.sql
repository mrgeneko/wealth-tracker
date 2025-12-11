/**
 * Database Migration Script: Symbol to Ticker Standardization
 * File: scripts/migrations/012_rename_symbol_to_ticker.sql
 * 
 * This migration:
 * 1. Adds 'ticker' column to affected tables
 * 2. Copies data from 'symbol' to 'ticker'
 * 3. Creates indexes on 'ticker' column
 * 4. Maintains backward compatibility
 * 5. Allows rollback by preserving 'symbol' column
 * 
 * Duration: ~30 seconds (depending on data volume)
 * Reversible: Yes (can restore from backup if needed)
 */

-- Step 1: Add ticker column to positions table
ALTER TABLE positions
ADD COLUMN ticker VARCHAR(20) NULL
AFTER symbol,
ADD INDEX idx_ticker (ticker);

-- Step 2: Add ticker column to symbol_registry table
ALTER TABLE symbol_registry
ADD COLUMN ticker VARCHAR(20) NULL UNIQUE
AFTER symbol,
ADD INDEX idx_ticker (ticker);

-- Step 3: Add ticker column to securities_metadata table (if exists)
ALTER TABLE securities_metadata
ADD COLUMN ticker VARCHAR(20) NULL
AFTER symbol,
ADD INDEX idx_ticker (ticker);

-- Step 4: Copy symbol data to ticker column for positions
UPDATE positions
SET ticker = symbol
WHERE symbol IS NOT NULL AND symbol != '';

-- Step 5: Copy symbol data to ticker column for symbol_registry
UPDATE symbol_registry
SET ticker = symbol
WHERE symbol IS NOT NULL AND symbol != '';

-- Step 6: Copy symbol data to ticker column for securities_metadata
UPDATE securities_metadata
SET ticker = symbol
WHERE symbol IS NOT NULL AND symbol != '';

-- Step 7: Verify data integrity
-- This will be checked in tests, but here's the SQL:
-- SELECT COUNT(*) FROM positions WHERE symbol != ticker;
-- SELECT COUNT(*) FROM symbol_registry WHERE symbol != ticker;
-- SELECT COUNT(*) FROM securities_metadata WHERE symbol != ticker;

-- Step 8: Create composite indexes if needed
ALTER TABLE positions
ADD INDEX idx_ticker_quantity (ticker, quantity);

ALTER TABLE symbol_registry
ADD INDEX idx_ticker_type (ticker, asset_type);

-- Step 9: Update any views if they exist
-- (This would be specific to your implementation)

-- Note: The 'symbol' column is NOT dropped yet to maintain backward compatibility
-- It will be dropped in a future migration after code is fully transitioned

-- Rollback instructions (if needed):
-- ALTER TABLE positions DROP COLUMN ticker, DROP INDEX idx_ticker, DROP INDEX idx_ticker_quantity;
-- ALTER TABLE symbol_registry DROP COLUMN ticker, DROP INDEX idx_ticker, DROP INDEX idx_ticker_type;
-- ALTER TABLE securities_metadata DROP COLUMN ticker, DROP INDEX idx_ticker;
