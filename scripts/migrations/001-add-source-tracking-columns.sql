-- Migration: Add source tracking columns to positions table
-- This migration adds security_type, source, and pricing_provider columns
-- and migrates data from the old 'type' enum column

-- Step 1: Add new columns
ALTER TABLE positions
ADD COLUMN security_type VARCHAR(20) DEFAULT NULL AFTER ticker,
ADD COLUMN source VARCHAR(255) DEFAULT NULL AFTER security_type,
ADD COLUMN pricing_provider VARCHAR(50) DEFAULT NULL AFTER source;

-- Step 2: Migrate existing data from 'type' to 'security_type'
UPDATE positions
SET security_type = UPPER(type);

-- Step 3: Set NOT NULL constraint and default after data migration
ALTER TABLE positions
MODIFY COLUMN security_type VARCHAR(20) NOT NULL DEFAULT 'NOT_SET';

-- Step 4: Add index on security_type for performance
ALTER TABLE positions
ADD INDEX idx_security_type (security_type);

-- Note: We keep the old 'type' column for now for backward compatibility
-- It can be dropped in a future migration after confirming everything works
