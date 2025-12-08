-- Migration: Add sector and industry to securities_metadata
-- Purpose: Store sector and industry classifications
-- Date: 2025-12-08

ALTER TABLE securities_metadata
ADD COLUMN sector VARCHAR(100) AFTER long_name,
ADD COLUMN industry VARCHAR(100) AFTER sector;

-- Add index for filtering
CREATE INDEX idx_sector ON securities_metadata(sector);
CREATE INDEX idx_industry ON securities_metadata(industry);
