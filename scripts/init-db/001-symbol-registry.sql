-- Init Script: Create Symbol Registry Tables
-- 
-- This script is automatically executed by Docker MySQL on container initialization
-- (first time only, placed in /docker-entrypoint-initdb.d/)
--
-- Creates the symbol registry system for autocomplete and metadata tracking
-- Note: Table is named symbol_registry for historical reasons but uses 'ticker' column

CREATE TABLE IF NOT EXISTS symbol_registry (
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
  CONSTRAINT fk_underlying_ticker FOREIGN KEY (underlying_ticker) REFERENCES symbol_registry (ticker) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS symbol_registry_metrics (
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
