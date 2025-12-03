-- Migration: Update latest_prices table
-- Add previous_close_price and quote_time columns
-- Remove change_decimal and change_percent columns

-- Add new columns
ALTER TABLE latest_prices ADD COLUMN previous_close_price DECIMAL(18,4) DEFAULT NULL AFTER price;
ALTER TABLE latest_prices ADD COLUMN quote_time DATETIME DEFAULT NULL AFTER source;

-- Remove old columns
ALTER TABLE latest_prices DROP COLUMN change_decimal;
ALTER TABLE latest_prices DROP COLUMN change_percent;
