# Source Tracking Architecture Overview

## Problem Statement

The wealth-tracker system faced a critical issue where the same ticker symbol could represent different securities, leading to price confusion and incorrect portfolio valuations. For example:

- **BTC** could refer to Bitcoin cryptocurrency OR a BTC ETF
- **TSLA** could refer to Tesla stock OR a TSLA options contract
- **AAPL** could refer to Apple stock OR an AAPL ETF

Without proper disambiguation, the system would fetch prices from the wrong data source, resulting in inaccurate portfolio tracking.

## Solution: Source Tracking

Source tracking implements a three-tier metadata system to uniquely identify and price each security:

### Core Metadata Fields

1. **security_type**: The fundamental type of security
   - `EQUITY` - Individual company stocks
   - `ETF` - Exchange-traded funds
   - `CRYPTO` - Cryptocurrencies
   - `BOND` - Fixed income securities
   - `US_TREASURY` - US Government debt
   - `MUTUAL_FUND` - Mutual funds
   - `OPTION` - Options contracts
   - `FUTURES` - Futures contracts
   - `INDEX` - Market indices
   - `OTHER` - Miscellaneous securities

2. **source**: The origin of the ticker data
   - `NASDAQ_FILE` - NASDAQ exchange listings
   - `NYSE_FILE` - NYSE exchange listings
   - `OTHER_LISTED_FILE` - Other exchange listings
   - `TREASURY_FILE` - US Treasury auctions
   - `CRYPTO_INVESTING_FILE` - Investing.com crypto data
   - `YAHOO` - Yahoo Finance API
   - `USER_ADDED` - Manually added by user

3. **pricing_provider**: The service responsible for price data
   - `YAHOO` - Yahoo Finance API (stocks, ETFs, bonds)
   - `INVESTING_COM` - Investing.com API (crypto, alternatives)
   - `TREASURY_GOV` - US Treasury Department API

## Data Flow Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Ticker        │    │   Position       │    │   Price         │
│   Registry      │───▶│   Creation       │───▶│   Fetching      │
│   (DB)          │    │   (API)          │    │   (Router)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
   ┌─────────────┐    ┌──────────────────┐    ┌─────────────┐
   │  Autocomplete│    │  Dashboard      │    │  latest_   │
   │  API         │    │  Display        │    │  prices    │
   │              │    │                  │    │  (DB)      │
   └─────────────┘    └──────────────────┘    └─────────────┘
```

### 1. Ticker Registry Population

The `ticker_registry` table serves as the authoritative source of security metadata:

```sql
CREATE TABLE ticker_registry (
  ticker VARCHAR(50) NOT NULL,
  security_type ENUM(...),
  source ENUM(...),
  pricing_provider VARCHAR(50),
  display_name VARCHAR(200),
  -- ... other fields
  UNIQUE KEY unique_ticker_context (ticker, exchange, security_type)
);
```

**Key Constraint**: The composite unique key `(ticker, exchange, security_type)` ensures that the same ticker can exist for different security types without conflict.

### 2. Autocomplete Enhancement

The autocomplete API now returns rich metadata to help users distinguish between securities:

```javascript
// Before
{ ticker: "BTC", name: "Bitcoin" }

// After
{
  ticker: "BTC",
  name: "Bitcoin",
  security_type: "CRYPTO",
  source: "CRYPTO_INVESTING_FILE",
  pricing_provider: "INVESTING_COM",
  display: "BTC - Bitcoin (CRYPTO, investing.com)"
}
```

### 3. Position Creation with Metadata

When creating positions, all three metadata fields are captured:

```javascript
const position = {
  ticker: "BTC",
  quantity: 0.5,
  security_type: "CRYPTO",        // Required
  source: "CRYPTO_INVESTING_FILE", // Required
  pricing_provider: "INVESTING_COM" // Required
};
```

### 4. Price Routing System

The `PriceRouter` service routes price requests to the appropriate provider:

```javascript
class PriceRouter {
  async getPrice(position) {
    const { pricing_provider } = position;

    switch (pricing_provider) {
      case 'YAHOO':
        return yahooFinance.getQuote(ticker);
      case 'INVESTING_COM':
        return investingComScraper.getPrice(ticker);
      case 'TREASURY_GOV':
        return treasuryGovAPI.getPrice(ticker);
    }
  }
}
```

### 5. Dashboard Display

Positions are displayed with source context:

```javascript
function formatPositionDisplay(position) {
  const sourceDomain = getSourceDomain(position.source);
  return `${position.ticker} (${position.security_type} - ${sourceDomain})`;
}

// Examples:
// "BTC (Crypto - investing.com)"
// "AAPL (Equity - nasdaq.com)"
// "TLT (ETF - nasdaq.com)"
```

## Database Schema Changes

### Positions Table

```sql
ALTER TABLE positions
ADD COLUMN security_type VARCHAR(20) NOT NULL DEFAULT 'EQUITY',
ADD COLUMN source VARCHAR(50),
ADD COLUMN pricing_provider VARCHAR(50),
ADD INDEX idx_positions_ticker_security_type (ticker, security_type),
ADD INDEX idx_positions_pricing_provider (pricing_provider);
```

### Latest Prices Table

```sql
-- Changed from PRIMARY KEY (ticker) to composite key
ALTER TABLE latest_prices
ADD COLUMN security_type VARCHAR(20) NOT NULL DEFAULT 'EQUITY',
DROP PRIMARY KEY,
ADD PRIMARY KEY (ticker, security_type),
ADD KEY idx_latest_prices_ticker (ticker);
```

### Ticker Registry Table

```sql
ALTER TABLE ticker_registry
ADD COLUMN pricing_provider VARCHAR(50),
ADD COLUMN display_name VARCHAR(200),
ADD INDEX idx_pricing_provider (pricing_provider);
```

## API Changes

### Autocomplete API

**Endpoint**: `GET /api/autocomplete?q={query}`

**Response Format**:
```json
{
  "suggestions": [
    {
      "ticker": "BTC",
      "name": "Bitcoin",
      "security_type": "CRYPTO",
      "source": "CRYPTO_INVESTING_FILE",
      "pricing_provider": "INVESTING_COM",
      "display": "BTC - Bitcoin (CRYPTO, investing.com)",
      "metadata": {
        "security_type": "CRYPTO",
        "source": "CRYPTO_INVESTING_FILE",
        "pricing_provider": "INVESTING_COM"
      }
    }
  ]
}
```

### Position APIs

**Create Position**: `POST /api/positions`

**Request Body** (new required fields):
```json
{
  "account_id": 1,
  "ticker": "BTC",
  "quantity": 0.5,
  "security_type": "CRYPTO",
  "source": "CRYPTO_INVESTING_FILE",
  "pricing_provider": "INVESTING_COM"
}
```

**Get Positions**: `GET /api/positions`

**Response Format** (includes metadata):
```json
{
  "positions": [
    {
      "id": 1,
      "ticker": "BTC",
      "quantity": 0.5,
      "security_type": "CRYPTO",
      "source": "CRYPTO_INVESTING_FILE",
      "pricing_provider": "INVESTING_COM"
    }
  ]
}
```

## Benefits

### 1. Price Accuracy
- BTC crypto fetches from Investing.com, not Yahoo Finance
- BTC ETF fetches from Yahoo Finance with correct context
- No more cross-contamination between security types

### 2. User Experience
- Clear disambiguation in autocomplete suggestions
- Source visibility in dashboard display
- Confidence in price data provenance

### 3. System Extensibility
- Easy addition of new security types
- Pluggable pricing provider architecture
- Future-proof for new data sources

### 4. Data Integrity
- Database constraints prevent ambiguous ticker assignments
- Composite keys ensure unique security identification
- Audit trail of data sources and pricing methods

## Implementation Status

- ✅ Database schema updates
- ✅ Backend API modifications
- ✅ Price routing system
- ✅ Frontend autocomplete updates
- ✅ Dashboard display enhancements
- ✅ Comprehensive test coverage
- ✅ Documentation (in progress)

## Future Enhancements

1. **Provider Health Monitoring**: Track pricing provider reliability and auto-failover
2. **User-Selectable Providers**: Allow users to choose preferred pricing sources
3. **Multi-Source Price Comparison**: Show prices from multiple providers
4. **Historical Price Tracking**: Maintain price history with security_type context