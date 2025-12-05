-- Migration: Add prev_close_source and prev_close_time columns to latest_prices table
-- Run this migration to add metadata columns for previous_close_price tracking
-- These columns enable source-priority merging and audit trail for prev-close values

-- Add prev_close_source column (stores the source that provided the prev-close value)
ALTER TABLE latest_prices
ADD COLUMN IF NOT EXISTS prev_close_source VARCHAR(50) DEFAULT NULL
AFTER previous_close_price;

-- Add prev_close_time column (stores when the prev-close value was captured)
ALTER TABLE latest_prices
ADD COLUMN IF NOT EXISTS prev_close_time DATETIME DEFAULT NULL
AFTER prev_close_source;

-- Optional: Backfill existing rows with current source/time as prev_close metadata
-- Uncomment the following if you want to initialize metadata for existing records:
-- UPDATE latest_prices
-- SET prev_close_source = source,
--     prev_close_time = capture_time
-- WHERE previous_close_price IS NOT NULL
--   AND prev_close_source IS NULL;
