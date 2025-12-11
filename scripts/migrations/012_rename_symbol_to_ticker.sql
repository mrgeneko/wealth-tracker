-- Migration 012: Rename 'symbol' to 'ticker' for terminology standardization
-- 
-- This migration standardizes ticker terminology across the database.
-- Changes:
--   - positions.symbol -> positions.ticker
--   - securities_metadata.symbol -> securities_metadata.ticker
--   - symbol_registry.symbol -> symbol_registry.ticker
--   - securities_dividends.symbol -> securities_dividends.ticker
--   - Updates foreign key constraints
--   - Updates indexes and unique constraints
--
-- Rollback: Run 013_rollback_symbol_to_ticker.sql

SET FOREIGN_KEY_CHECKS=0;

-- ============================================================================
-- PHASE 1: Add ticker columns alongside existing symbol columns
-- ============================================================================

ALTER TABLE positions 
ADD COLUMN ticker VARCHAR(50) DEFAULT NULL AFTER symbol,
ADD KEY idx_positions_ticker (ticker);

ALTER TABLE securities_metadata 
ADD COLUMN ticker VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER symbol,
ADD UNIQUE KEY ticker (ticker);

ALTER TABLE symbol_registry 
ADD COLUMN ticker VARCHAR(50) DEFAULT NULL AFTER symbol,
ADD UNIQUE KEY ticker_unique (ticker),
ADD KEY idx_ticker (ticker);

ALTER TABLE securities_dividends 
ADD COLUMN ticker VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER symbol,
ADD KEY idx_ticker (ticker);

-- ============================================================================
-- PHASE 2: Copy data from symbol to ticker columns
-- ============================================================================

UPDATE positions SET ticker = symbol WHERE ticker IS NULL AND symbol IS NOT NULL;
UPDATE securities_metadata SET ticker = symbol WHERE ticker IS NULL AND symbol IS NOT NULL;
UPDATE symbol_registry SET ticker = symbol WHERE ticker IS NULL AND symbol IS NOT NULL;
UPDATE securities_dividends SET ticker = symbol WHERE ticker IS NULL AND symbol IS NOT NULL;

-- ============================================================================
-- PHASE 3: Update foreign key in symbol_registry (underlying_symbol)
-- ============================================================================

-- Drop old foreign key constraint
ALTER TABLE symbol_registry 
DROP FOREIGN KEY fk_underlying_symbol;

-- Add new foreign key referencing ticker instead of symbol
ALTER TABLE symbol_registry 
ADD CONSTRAINT fk_underlying_ticker FOREIGN KEY (underlying_symbol) REFERENCES symbol_registry (ticker) ON DELETE SET NULL;

-- ============================================================================
-- PHASE 4: Drop old symbol columns and constraints
-- ============================================================================

-- Drop unique constraint on symbol in securities_metadata
ALTER TABLE securities_metadata 
DROP KEY symbol;

-- Drop unique constraint on symbol in symbol_registry
ALTER TABLE symbol_registry 
DROP KEY symbol;

-- Drop unique constraint on symbol in securities_dividends
ALTER TABLE securities_dividends 
DROP KEY unique_dividend;

-- Drop index on symbol in securities_metadata
ALTER TABLE securities_metadata 
DROP KEY idx_symbol;

-- Drop index on symbol in symbol_registry
ALTER TABLE symbol_registry 
DROP KEY idx_symbol;

-- Drop index on symbol in securities_dividends
ALTER TABLE securities_dividends 
DROP KEY idx_symbol;

-- Drop symbol column from positions (no constraint, just column)
ALTER TABLE positions 
DROP COLUMN symbol;

-- Drop symbol column from securities_metadata
ALTER TABLE securities_metadata 
DROP COLUMN symbol;

-- Drop symbol column from symbol_registry
ALTER TABLE symbol_registry 
DROP COLUMN symbol;

-- Drop symbol column from securities_dividends
ALTER TABLE securities_dividends 
DROP COLUMN symbol;

-- ============================================================================
-- PHASE 5: Recreate unique and index constraints on ticker columns
-- ============================================================================

ALTER TABLE securities_metadata 
ADD UNIQUE KEY ticker_unique (ticker),
ADD KEY idx_ticker (ticker);

ALTER TABLE symbol_registry 
ADD UNIQUE KEY ticker_unique (ticker),
ADD KEY idx_ticker (ticker);

ALTER TABLE securities_dividends 
ADD UNIQUE KEY unique_dividend (ticker, ex_dividend_date, dividend_amount),
ADD KEY idx_ticker (ticker);

-- ============================================================================
-- PHASE 6: Re-enable foreign key checks
-- ============================================================================

SET FOREIGN_KEY_CHECKS=1;
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
