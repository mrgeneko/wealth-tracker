-- Migration: Add TTM dividend/earnings fields to securities_metadata
-- Date: 2025-12-08

ALTER TABLE securities_metadata
  ADD COLUMN IF NOT EXISTS ttm_dividend_amount DECIMAL(12,4) NULL AFTER trailing_annual_dividend_yield,
  ADD COLUMN IF NOT EXISTS ttm_eps DECIMAL(12,4) NULL AFTER ttm_dividend_amount;
