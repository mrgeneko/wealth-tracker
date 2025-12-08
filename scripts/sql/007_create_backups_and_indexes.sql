-- Migration: Create backup tables and helpful composite indexes
-- Date: 2025-12-08

-- Create backup tables to allow safe archival of duplicates before destructive steps
CREATE TABLE IF NOT EXISTS securities_dividends_backup LIKE securities_dividends;
CREATE TABLE IF NOT EXISTS securities_earnings_backup LIKE securities_earnings;

-- Add composite indexes for common TTM queries (non-destructive)
-- Dividends: queries often filter by symbol AND ex_dividend_date +/- status
CREATE INDEX IF NOT EXISTS idx_div_symbol_date_status ON securities_dividends (symbol, ex_dividend_date, status);

-- Earnings: queries often filter by symbol AND earnings_date and eps_actual
CREATE INDEX IF NOT EXISTS idx_earn_symbol_date_eps ON securities_earnings (symbol, earnings_date, eps_actual);

-- Do NOT drop or replace existing unique constraints in this migration. Deduplication must occur in controlled staged operations.
