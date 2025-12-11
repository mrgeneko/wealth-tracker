-- Init Script: Create Base Schema Tables
-- 
-- This script is automatically executed by Docker MySQL on container initialization
-- (first time only, placed in /docker-entrypoint-initdb.d/)
--
-- Creates the core tables for the Wealth Tracker application:
-- - accounts: Investment and bank accounts
-- - positions: Holdings (stocks, bonds, cash) within accounts
-- - fixed_assets: Real estate and vehicles
-- - latest_prices: Current and historical pricing data
-- - securities_metadata: Metadata about securities
-- - securities_dividends: Dividend information
-- - securities_earnings: Earnings information
-- - security_splits: Stock split information

-- Create accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) DEFAULT NULL,
  category ENUM('bank','investment') NOT NULL,
  display_order INT DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'USD',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Create positions table (holdings in accounts)
CREATE TABLE IF NOT EXISTS positions (
  id INT NOT NULL AUTO_INCREMENT,
  account_id INT NOT NULL,
  symbol VARCHAR(50) DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  quantity DECIMAL(20,8) DEFAULT NULL,
  type ENUM('stock','etf','bond','cash','crypto','other') NOT NULL,
  exchange VARCHAR(50) DEFAULT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  maturity_date DATE DEFAULT NULL,
  coupon DECIMAL(10,4) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  normalized_key VARCHAR(128) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY account_id (account_id),
  KEY idx_positions_normalized_key (normalized_key),
  CONSTRAINT positions_ibfk_1 FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Create fixed_assets table
CREATE TABLE IF NOT EXISTS fixed_assets (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  type ENUM('real_estate','vehicle','other') NOT NULL,
  value DECIMAL(20,2) DEFAULT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  display_order INT DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Create latest_prices table
CREATE TABLE IF NOT EXISTS latest_prices (
  ticker VARCHAR(50) NOT NULL,
  price DECIMAL(18,4) DEFAULT NULL,
  previous_close_price DECIMAL(18,4) DEFAULT NULL,
  prev_close_source VARCHAR(50) DEFAULT NULL,
  prev_close_time DATETIME DEFAULT NULL,
  source VARCHAR(50) DEFAULT NULL,
  quote_time DATETIME DEFAULT NULL,
  capture_time DATETIME DEFAULT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Create securities_metadata table
CREATE TABLE IF NOT EXISTS securities_metadata (
  id INT NOT NULL AUTO_INCREMENT,
  symbol VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  quote_type VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  type_display VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  short_name VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  long_name VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  sector VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  industry VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  region VARCHAR(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  exchange VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  full_exchange_name VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  currency VARCHAR(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  timezone_name VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  timezone_short VARCHAR(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  market VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  market_state VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  tradeable TINYINT(1) DEFAULT 1,
  net_assets DECIMAL(20,2) DEFAULT NULL,
  net_expense_ratio DECIMAL(8,4) DEFAULT NULL,
  shares_outstanding BIGINT DEFAULT NULL,
  market_cap BIGINT DEFAULT NULL,
  dividend_rate DECIMAL(10,4) DEFAULT NULL,
  dividend_yield DECIMAL(8,4) DEFAULT NULL,
  trailing_annual_dividend_rate DECIMAL(10,4) DEFAULT NULL,
  trailing_annual_dividend_yield DECIMAL(8,4) DEFAULT NULL,
  trailing_pe DECIMAL(10,4) DEFAULT NULL,
  forward_pe DECIMAL(10,4) DEFAULT NULL,
  price_to_book DECIMAL(10,4) DEFAULT NULL,
  beta DECIMAL(10,6) DEFAULT NULL,
  fifty_two_week_low DECIMAL(18,4) DEFAULT NULL,
  fifty_two_week_high DECIMAL(18,4) DEFAULT NULL,
  first_trade_date DATETIME DEFAULT NULL,
  data_source VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT 'yahoo',
  last_updated TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  ttm_dividend_amount DECIMAL(12,4) DEFAULT NULL,
  ttm_eps DECIMAL(12,4) DEFAULT NULL,
  ttm_last_calculated_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY symbol (symbol),
  KEY idx_symbol (symbol),
  KEY idx_quote_type (quote_type),
  KEY idx_exchange (exchange),
  KEY idx_currency (currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create securities_dividends table
CREATE TABLE IF NOT EXISTS securities_dividends (
  id INT NOT NULL AUTO_INCREMENT,
  symbol VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  ex_dividend_date DATE NOT NULL,
  payment_date DATE DEFAULT NULL,
  record_date DATE DEFAULT NULL,
  declaration_date DATE DEFAULT NULL,
  dividend_amount DECIMAL(10,4) NOT NULL,
  dividend_type VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  currency VARCHAR(10) COLLATE utf8mb4_unicode_ci DEFAULT 'USD',
  is_estimate TINYINT(1) DEFAULT 0,
  status VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT 'confirmed',
  data_source VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT 'yahoo',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  source_event_id VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  source_name VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ingested_at TIMESTAMP NULL DEFAULT NULL,
  adjusted_dividend_amount DECIMAL(12,6) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY unique_dividend (symbol,ex_dividend_date,dividend_amount),
  KEY idx_symbol (symbol),
  KEY idx_ex_date (ex_dividend_date),
  KEY idx_payment_date (payment_date),
  KEY idx_div_symbol_date_status (symbol,ex_dividend_date,status),
  CONSTRAINT securities_dividends_ibfk_1 FOREIGN KEY (symbol) REFERENCES securities_metadata (symbol) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create securities_dividends_backup table
CREATE TABLE IF NOT EXISTS securities_dividends_backup (
  id INT NOT NULL AUTO_INCREMENT,
  symbol VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  ex_dividend_date DATE NOT NULL,
  payment_date DATE DEFAULT NULL,
  record_date DATE DEFAULT NULL,
  declaration_date DATE DEFAULT NULL,
  dividend_amount DECIMAL(10,4) NOT NULL,
  dividend_type VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  currency VARCHAR(10) COLLATE utf8mb4_unicode_ci DEFAULT 'USD',
  is_estimate TINYINT(1) DEFAULT 0,
  status VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT 'confirmed',
  data_source VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT 'yahoo',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  source_event_id VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  source_name VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ingested_at TIMESTAMP NULL DEFAULT NULL,
  adjusted_dividend_amount DECIMAL(12,6) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY unique_dividend (symbol,ex_dividend_date,dividend_amount),
  KEY idx_symbol (symbol),
  KEY idx_ex_date (ex_dividend_date),
  KEY idx_payment_date (payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create securities_earnings table
CREATE TABLE IF NOT EXISTS securities_earnings (
  id INT NOT NULL AUTO_INCREMENT,
  symbol VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  earnings_date DATETIME NOT NULL,
  earnings_date_end DATETIME DEFAULT NULL,
  is_estimate TINYINT(1) DEFAULT 1,
  eps_actual DECIMAL(10,4) DEFAULT NULL,
  eps_estimate DECIMAL(10,4) DEFAULT NULL,
  revenue_actual BIGINT DEFAULT NULL,
  revenue_estimate BIGINT DEFAULT NULL,
  fiscal_quarter VARCHAR(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  fiscal_year INT DEFAULT NULL,
  data_source VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT 'yahoo',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  source_event_id VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  source_name VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ingested_at TIMESTAMP NULL DEFAULT NULL,
  adjusted_eps DECIMAL(12,6) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY unique_earnings (symbol,earnings_date,fiscal_quarter,fiscal_year),
  KEY idx_symbol (symbol),
  KEY idx_earnings_date (earnings_date),
  KEY idx_earn_symbol_date_eps (symbol,earnings_date,eps_actual),
  CONSTRAINT securities_earnings_ibfk_1 FOREIGN KEY (symbol) REFERENCES securities_metadata (symbol) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create securities_earnings_backup table
CREATE TABLE IF NOT EXISTS securities_earnings_backup (
  id INT NOT NULL AUTO_INCREMENT,
  symbol VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  earnings_date DATETIME NOT NULL,
  earnings_date_end DATETIME DEFAULT NULL,
  is_estimate TINYINT(1) DEFAULT 1,
  eps_actual DECIMAL(10,4) DEFAULT NULL,
  eps_estimate DECIMAL(10,4) DEFAULT NULL,
  revenue_actual BIGINT DEFAULT NULL,
  revenue_estimate BIGINT DEFAULT NULL,
  fiscal_quarter VARCHAR(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  fiscal_year INT DEFAULT NULL,
  data_source VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT 'yahoo',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  source_event_id VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  source_name VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ingested_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY unique_earnings (symbol,earnings_date,fiscal_quarter,fiscal_year),
  KEY idx_symbol (symbol),
  KEY idx_earnings_date (earnings_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create security_splits table
CREATE TABLE IF NOT EXISTS security_splits (
  id INT NOT NULL AUTO_INCREMENT,
  symbol VARCHAR(50) NOT NULL,
  split_date DATE NOT NULL,
  split_ratio DECIMAL(16,8) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_splits_symbol_date (symbol,split_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
