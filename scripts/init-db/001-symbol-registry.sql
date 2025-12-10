-- Init Script: Create Symbol Registry Tables
-- 
-- This script is automatically executed by Docker MySQL on container initialization
-- (first time only, placed in /docker-entrypoint-initdb.d/)
--
-- Creates the symbol registry system for autocomplete and metadata tracking

CREATE TABLE IF NOT EXISTS symbol_registry (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(500),
  exchange VARCHAR(50),
  security_type ENUM('EQUITY', 'ETF', 'BOND', 'TREASURY', 'MUTUAL_FUND', 'OPTION', 'CRYPTO', 'FX', 'FUTURES', 'INDEX', 'OTHER') DEFAULT 'EQUITY',
  source ENUM('NASDAQ_FILE', 'NYSE_FILE', 'OTHER_FILE', 'TREASURY_FILE', 'TREASURY_HISTORICAL', 'YAHOO', 'USER_ADDED') NOT NULL,
  has_yahoo_metadata BOOLEAN DEFAULT FALSE,
  permanently_failed BOOLEAN DEFAULT FALSE,
  permanent_failure_reason VARCHAR(255) NULL,
  permanent_failure_at TIMESTAMP NULL,
  usd_trading_volume DECIMAL(20, 2) NULL,
  sort_rank INT DEFAULT 1000,
  
  -- Treasury-specific fields
  issue_date DATE NULL,
  maturity_date DATE NULL,
  security_term VARCHAR(50) NULL,
  
  -- Option-specific fields
  underlying_symbol VARCHAR(50) NULL,
  strike_price DECIMAL(18, 4) NULL,
  option_type ENUM('CALL', 'PUT') NULL,
  expiration_date DATE NULL,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY symbol (symbol),
  KEY idx_symbol (symbol),
  KEY idx_security_type (security_type),
  KEY idx_sort_rank (sort_rank),
  KEY idx_maturity_date (maturity_date),
  KEY idx_expiration_date (expiration_date),
  KEY idx_underlying_symbol (underlying_symbol),
  KEY idx_permanently_failed (permanently_failed),
  CONSTRAINT fk_underlying_symbol FOREIGN KEY (underlying_symbol) REFERENCES symbol_registry (symbol) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS symbol_registry_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  total_symbols INT DEFAULT 0,
  nasdaq_symbols INT DEFAULT 0,
  nyse_symbols INT DEFAULT 0,
  other_symbols INT DEFAULT 0,
  symbols_with_metadata INT DEFAULT 0,
  symbols_without_metadata INT DEFAULT 0,
  symbols_permanently_failed INT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_refresh_status (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_type ENUM('NASDAQ', 'NYSE', 'OTHER', 'TREASURY_AUCTIONS', 'TREASURY_HISTORICAL') NOT NULL UNIQUE,
  last_refreshed TIMESTAMP NULL,
  symbols_updated INT DEFAULT 0,
  next_refresh_due_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_file_type (file_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
