# Database Schema Documentation

## Overview

The wealth-tracker database schema has been enhanced with source tracking columns to uniquely identify securities and route price requests to appropriate providers.

## Core Tables

### positions

Stores portfolio positions with source tracking metadata.

```sql
CREATE TABLE positions (
  id INT NOT NULL AUTO_INCREMENT,
  account_id INT NOT NULL,
  ticker VARCHAR(50) DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  quantity DECIMAL(20,8) DEFAULT NULL,
  security_type VARCHAR(20) NOT NULL,           -- NEW: replaces 'type'
  source VARCHAR(50) DEFAULT NULL,               -- NEW: data source
  pricing_provider VARCHAR(50) DEFAULT NULL,     -- NEW: price provider
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
  KEY idx_positions_ticker_security_type (ticker, security_type),    -- NEW
  KEY idx_positions_pricing_provider (pricing_provider),             -- NEW
  CONSTRAINT positions_ibfk_1 FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

**New Columns**:
- `security_type`: Type of security (EQUITY, ETF, CRYPTO, etc.)
- `source`: Origin of ticker data (NASDAQ_FILE, CRYPTO_INVESTING_FILE, etc.)
- `pricing_provider`: Service providing price data (YAHOO, INVESTING_COM, etc.)

**New Indices**:
- `idx_positions_ticker_security_type`: Optimizes queries filtering by ticker + security_type
- `idx_positions_pricing_provider`: Optimizes price routing queries

### ticker_registry

Central registry of all known securities with metadata.

```sql
CREATE TABLE ticker_registry (
  id INT NOT NULL AUTO_INCREMENT,
  ticker VARCHAR(50) NOT NULL,
  name VARCHAR(500) DEFAULT NULL,
  exchange VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
  security_type ENUM('NOT_SET','EQUITY','ETF','BOND','US_TREASURY','MUTUAL_FUND','OPTION','CRYPTO','FX','FUTURES','INDEX','OTHER') NOT NULL DEFAULT 'NOT_SET',
  source ENUM('NASDAQ_FILE','NYSE_FILE','OTHER_LISTED_FILE','TREASURY_FILE','TREASURY_HISTORICAL','YAHOO','USER_ADDED','CRYPTO_INVESTING_FILE') NOT NULL,
  pricing_provider VARCHAR(50) DEFAULT NULL,     -- NEW
  display_name VARCHAR(200) DEFAULT NULL,        -- NEW
  has_yahoo_metadata TINYINT(1) DEFAULT 0,
  permanently_failed TINYINT(1) DEFAULT 0,
  permanent_failure_reason VARCHAR(255) DEFAULT NULL,
  permanent_failure_at TIMESTAMP NULL DEFAULT NULL,
  usd_trading_volume DECIMAL(20,2) DEFAULT NULL,
  market_cap DECIMAL(20, 2) DEFAULT NULL,
  sort_rank INT DEFAULT 1000,
  issue_date DATE DEFAULT NULL,
  maturity_date DATE DEFAULT NULL,
  security_term VARCHAR(50) DEFAULT NULL,
  underlying_ticker VARCHAR(50) DEFAULT NULL,
  underlying_exchange VARCHAR(50) DEFAULT NULL,
  underlying_security_type ENUM('NOT_SET','EQUITY','ETF','BOND','US_TREASURY','MUTUAL_FUND','OPTION','CRYPTO','FX','FUTURES','INDEX','OTHER') DEFAULT NULL,
  strike_price DECIMAL(18,4) DEFAULT NULL,
  option_type ENUM('CALL','PUT') DEFAULT NULL,
  expiration_date DATE DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_ticker_context (ticker, exchange, security_type),  -- CRITICAL
  KEY idx_ticker (ticker),
  KEY idx_security_type (security_type),
  KEY idx_sort_rank (sort_rank),
  KEY idx_maturity_date (maturity_date),
  KEY idx_expiration_date (expiration_date),
  KEY idx_underlying (underlying_ticker, underlying_exchange, underlying_security_type),
  KEY idx_permanently_failed (permanently_failed),
  KEY idx_pricing_provider (pricing_provider)   -- NEW
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

**New Columns**:
- `pricing_provider`: Which service provides pricing for this security
- `display_name`: Pre-formatted string for UI display

**Key Constraint**:
- `unique_ticker_context (ticker, exchange, security_type)`: Ensures the same ticker can exist for different security types without conflict

### latest_prices

Stores current price data with security type disambiguation.

```sql
CREATE TABLE latest_prices (
  ticker VARCHAR(50) NOT NULL,
  security_type VARCHAR(20) NOT NULL DEFAULT 'EQUITY',  -- NEW
  price DECIMAL(18,4) DEFAULT NULL,
  previous_close_price DECIMAL(18,4) DEFAULT NULL,
  prev_close_source VARCHAR(50) DEFAULT NULL,
  prev_close_time DATETIME DEFAULT NULL,
  source VARCHAR(50) DEFAULT NULL,
  quote_time DATETIME DEFAULT NULL,
  capture_time DATETIME DEFAULT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker, security_type),           -- CHANGED: composite key
  KEY idx_latest_prices_ticker (ticker)          -- NEW: for ticker-only lookups
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

**Schema Changes**:
- Added `security_type` column
- Changed primary key from `(ticker)` to `(ticker, security_type)`
- Added secondary index on `ticker` for backward compatibility

## Data Types and Constraints

### Security Types

| Value | Description |
|-------|-------------|
| `EQUITY` | Individual company stocks |
| `ETF` | Exchange-traded funds |
| `CRYPTO` | Cryptocurrencies |
| `BOND` | Fixed income securities |
| `US_TREASURY` | US Government debt |
| `MUTUAL_FUND` | Mutual funds |
| `OPTION` | Options contracts |
| `FUTURES` | Futures contracts |
| `INDEX` | Market indices |
| `OTHER` | Miscellaneous securities |

### Source Types

| Value | Description | Domain |
|-------|-------------|--------|
| `NASDAQ_FILE` | NASDAQ exchange listings | nasdaq.com |
| `NYSE_FILE` | NYSE exchange listings | nyse.com |
| `OTHER_LISTED_FILE` | Other exchange listings | Various |
| `TREASURY_FILE` | US Treasury auctions | treasury.gov |
| `CRYPTO_INVESTING_FILE` | Investing.com crypto data | investing.com |
| `YAHOO` | Yahoo Finance API | yahoo.com |
| `USER_ADDED` | Manually added by user | N/A |

### Pricing Providers

| Value | Description | Used For |
|-------|-------------|----------|
| `YAHOO` | Yahoo Finance API | Stocks, ETFs, bonds |
| `INVESTING_COM` | Investing.com API | Crypto, alternatives |
| `TREASURY_GOV` | US Treasury Dept API | US Treasuries |

## Migration Path

### From Legacy Schema

**Before** (single price per ticker):
```sql
-- Old: one price per ticker
PRIMARY KEY (ticker)
-- Example: BTC could only be one thing
```

**After** (multiple prices per ticker):
```sql
-- New: multiple prices per ticker
PRIMARY KEY (ticker, security_type)
-- Example: BTC crypto AND BTC ETF can coexist
```

### Data Migration Steps

1. **Add new columns** to existing tables
2. **Populate security_type** based on existing data patterns
3. **Set default pricing_providers** based on source
4. **Update composite primary key** on latest_prices
5. **Rebuild indices** for performance

### Backward Compatibility

- Existing API consumers continue to work
- Ticker-only queries still supported via secondary index
- Graceful fallback for missing metadata

## Query Patterns

### Find Positions by Security Type
```sql
SELECT * FROM positions
WHERE security_type = 'CRYPTO'
ORDER BY ticker;
```

### Get Price for Specific Security
```sql
SELECT * FROM latest_prices
WHERE ticker = 'BTC' AND security_type = 'CRYPTO';
```

### Route Price Requests
```sql
SELECT DISTINCT ticker, security_type, pricing_provider
FROM positions
WHERE pricing_provider IS NOT NULL;
```

### Autocomplete Search
```sql
SELECT ticker, name, security_type, source, pricing_provider, display_name
FROM ticker_registry
WHERE ticker LIKE ?
ORDER BY sort_rank
LIMIT 20;
```

## Performance Considerations

### Indices Added
- `idx_positions_ticker_security_type`: Composite index for position queries
- `idx_positions_pricing_provider`: Index for price routing
- `idx_ticker_registry_pricing_provider`: Index for provider-based queries
- `idx_latest_prices_ticker`: Secondary index for ticker-only lookups

### Query Optimization
- Composite primary key on latest_prices enables efficient security-specific price lookups
- Separate indices on commonly filtered columns
- Sort rank ordering for autocomplete performance

## Data Integrity

### Constraints
- `security_type` is required on positions (NOT NULL)
- `source` and `pricing_provider` are required for proper price routing
- Unique constraint prevents duplicate ticker+security_type combinations

### Validation Rules
- Security types must be from approved enum
- Pricing providers must be known services
- Source types must be valid origins

## Monitoring and Maintenance

### Key Metrics to Monitor
- Count of positions by security_type
- Pricing provider usage statistics
- Failed price fetch attempts by provider
- Database query performance

### Maintenance Tasks
- Regular cleanup of orphaned price records
- Validation of pricing_provider assignments
- Index maintenance and statistics updates