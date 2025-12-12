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
  ticker VARCHAR(50) DEFAULT NULL,
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
  KEY idx_positions_ticker (ticker),
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
  ticker VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
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
  UNIQUE KEY ticker (ticker),
  KEY idx_ticker (ticker),
  KEY idx_quote_type (quote_type),
  KEY idx_exchange (exchange),
  KEY idx_currency (currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create securities_dividends table
CREATE TABLE IF NOT EXISTS securities_dividends (
  id INT NOT NULL AUTO_INCREMENT,
  ticker VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
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
  UNIQUE KEY unique_dividend (ticker,ex_dividend_date,dividend_amount),
  KEY idx_ticker (ticker),
  KEY idx_ex_date (ex_dividend_date),
  KEY idx_payment_date (payment_date),
  KEY idx_div_ticker_date_status (ticker,ex_dividend_date,status),
  CONSTRAINT securities_dividends_ibfk_1 FOREIGN KEY (ticker) REFERENCES securities_metadata (ticker) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create securities_dividends_backup table
CREATE TABLE IF NOT EXISTS securities_dividends_backup (
  id INT NOT NULL AUTO_INCREMENT,
  ticker VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
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
  UNIQUE KEY unique_dividend (ticker,ex_dividend_date,dividend_amount),
  KEY idx_ticker (ticker),
  KEY idx_ex_date (ex_dividend_date),
  KEY idx_payment_date (payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create securities_earnings table
CREATE TABLE IF NOT EXISTS securities_earnings (
  id INT NOT NULL AUTO_INCREMENT,
  ticker VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
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
  UNIQUE KEY unique_earnings (ticker,earnings_date,fiscal_quarter,fiscal_year),
  KEY idx_ticker (ticker),
  KEY idx_earnings_date (earnings_date),
  KEY idx_earn_ticker_date_eps (ticker,earnings_date,eps_actual),
  CONSTRAINT securities_earnings_ibfk_1 FOREIGN KEY (ticker) REFERENCES securities_metadata (ticker) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create securities_earnings_backup table
CREATE TABLE IF NOT EXISTS securities_earnings_backup (
  id INT NOT NULL AUTO_INCREMENT,
  ticker VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
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
  UNIQUE KEY unique_earnings (ticker,earnings_date,fiscal_quarter,fiscal_year),
  KEY idx_ticker (ticker),
  KEY idx_earnings_date (earnings_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create security_splits table
CREATE TABLE IF NOT EXISTS security_splits (
  id INT NOT NULL AUTO_INCREMENT,
  ticker VARCHAR(50) NOT NULL,
  split_date DATE NOT NULL,
  split_ratio DECIMAL(16,8) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_splits_ticker_date (ticker,split_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Symbol Registry Tables (consolidated from 001-symbol-registry.sql)
CREATE TABLE IF NOT EXISTS ticker_registry (
  id INT NOT NULL AUTO_INCREMENT,
  ticker VARCHAR(50) NOT NULL,
  name VARCHAR(500) DEFAULT NULL,
  exchange VARCHAR(50) DEFAULT NULL,
  security_type ENUM('EQUITY','ETF','BOND','TREASURY','MUTUAL_FUND','OPTION','CRYPTO','FX','FUTURES','INDEX','OTHER') DEFAULT 'EQUITY',
  source ENUM('NASDAQ_FILE','NYSE_FILE','OTHER_FILE','TREASURY_FILE','TREASURY_HISTORICAL','YAHOO','USER_ADDED') NOT NULL,
  has_yahoo_metadata TINYINT(1) DEFAULT 0,
  permanently_failed TINYINT(1) DEFAULT 0,
  permanent_failure_reason VARCHAR(255) DEFAULT NULL,
  permanent_failure_at TIMESTAMP NULL DEFAULT NULL,
  usd_trading_volume DECIMAL(20,2) DEFAULT NULL,
  sort_rank INT DEFAULT 1000,
  issue_date DATE DEFAULT NULL,
  maturity_date DATE DEFAULT NULL,
  security_term VARCHAR(50) DEFAULT NULL,
  underlying_ticker VARCHAR(50) DEFAULT NULL,
  strike_price DECIMAL(18,4) DEFAULT NULL,
  option_type ENUM('CALL','PUT') DEFAULT NULL,
  expiration_date DATE DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ticker (ticker),
  KEY idx_ticker (ticker),
  KEY idx_security_type (security_type),
  KEY idx_sort_rank (sort_rank),
  KEY idx_maturity_date (maturity_date),
  KEY idx_expiration_date (expiration_date),
  KEY idx_underlying_ticker (underlying_ticker),
  KEY idx_permanently_failed (permanently_failed),
  CONSTRAINT fk_underlying_ticker FOREIGN KEY (underlying_ticker) REFERENCES ticker_registry (ticker) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ticker_registry_metrics (
  id INT NOT NULL AUTO_INCREMENT,
  metric_date DATE NOT NULL,
  source VARCHAR(50) NOT NULL,
  total_tickers INT NOT NULL,
  tickers_with_yahoo_metadata INT NOT NULL,
  tickers_without_yahoo_metadata INT NOT NULL,
  last_file_refresh_at TIMESTAMP NULL DEFAULT NULL,
  file_download_duration_ms INT DEFAULT NULL,
  avg_yahoo_fetch_duration_ms INT DEFAULT NULL,
  errors_count INT DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_date_source (metric_date,source),
  KEY idx_metric_date (metric_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS file_refresh_status (
  id INT NOT NULL AUTO_INCREMENT,
  file_type ENUM('NASDAQ','NYSE','OTHER','TREASURY') NOT NULL,
  last_refresh_at TIMESTAMP NULL DEFAULT NULL,
  last_refresh_duration_ms INT DEFAULT NULL,
  last_refresh_status ENUM('SUCCESS','FAILED','IN_PROGRESS') DEFAULT 'SUCCESS',
  last_error_message TEXT,
  tickers_added INT DEFAULT 0,
  tickers_updated INT DEFAULT 0,
  next_refresh_due_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY file_type (file_type),
  KEY idx_file_type (file_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS symbol_yahoo_metrics (
  id INT NOT NULL AUTO_INCREMENT,
  symbol_id INT NOT NULL,
  ticker VARCHAR(50) NOT NULL,
  market_cap BIGINT DEFAULT NULL,
  trailing_pe DECIMAL(10,2) DEFAULT NULL,
  dividend_yield DECIMAL(8,4) DEFAULT NULL,
  fifty_two_week_high DECIMAL(18,4) DEFAULT NULL,
  fifty_two_week_low DECIMAL(18,4) DEFAULT NULL,
  beta DECIMAL(8,4) DEFAULT NULL,
  trailing_revenue BIGINT DEFAULT NULL,
  trailing_eps DECIMAL(10,4) DEFAULT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  recorded_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_symbol_id (symbol_id),
  KEY idx_ticker (ticker),
  KEY idx_recorded_at (recorded_at),
  CONSTRAINT fk_symbol_yahoo_metrics_symbol_id FOREIGN KEY (symbol_id) REFERENCES ticker_registry (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Phase 9 WebSocket Real-time Metrics Tables (consolidated from 002-phase9-metrics.sql)
CREATE TABLE IF NOT EXISTS scraper_page_performance (
  id INT NOT NULL AUTO_INCREMENT,
  scraper_source VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  metric_type VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  url VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  navigation_duration_ms INT DEFAULT NULL,
  scrape_duration_ms INT DEFAULT NULL,
  items_extracted INT DEFAULT NULL,
  success TINYINT(1) DEFAULT 1,
  error VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_source_time (scraper_source,created_at DESC),
  KEY idx_type_source (metric_type,scraper_source,created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scraper_daily_summary (
  scraper_source VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  metric_date DATE NOT NULL,
  metric_type VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  total_count INT DEFAULT NULL,
  success_count INT DEFAULT NULL,
  avg_duration_ms FLOAT DEFAULT NULL,
  total_items_extracted INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scraper_source,metric_date,metric_type),
  KEY idx_source_date (scraper_source,metric_date DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_metrics (
  id INT NOT NULL AUTO_INCREMENT,
  scraper_source VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  execution_duration_ms INT DEFAULT NULL,
  success TINYINT(1) DEFAULT 1,
  error VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_source_time (scraper_source,created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
