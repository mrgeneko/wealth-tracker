-- Migration: Add adjusted_eps to securities_earnings
-- Date: 2025-12-08

ALTER TABLE securities_earnings
  ADD COLUMN IF NOT EXISTS adjusted_eps DECIMAL(12,6) NULL;

-- Note: adjusted_eps will be populated via backfill using security_splits (if available)
