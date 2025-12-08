-- Fix foreign key constraint for positions.metadata_symbol
-- The issue is charset/collation mismatch between positions.symbol and securities_metadata.symbol

-- First, add the metadata_symbol column without the foreign key
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS metadata_symbol VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci AFTER symbol;

-- Add index
CREATE INDEX IF NOT EXISTS idx_metadata_symbol ON positions (metadata_symbol);

-- Note: We skip the foreign key for now as it requires matching collations
-- The application logic will handle the relationship
