# Autocomplete API Documentation

## Overview

The autocomplete API provides ticker search functionality with source tracking metadata to help users distinguish between securities with the same ticker symbol.

## Endpoint

```
GET /api/autocomplete
```

## Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query (ticker symbol or company name) |
| `limit` | number | No | Maximum number of results (default: 20, max: 100) |
| `include_metadata` | boolean | No | Include detailed metadata in response (default: true) |

## Response Format

### Success Response (200)

```json
{
  "suggestions": [
    {
      "ticker": "BTC",
      "name": "Bitcoin",
      "security_type": "CRYPTO",
      "exchange": "CRYPTO",
      "source": "CRYPTO_INVESTING_FILE",
      "pricing_provider": "INVESTING_COM",
      "display_name": "BTC - Bitcoin (CRYPTO, investing.com)",
      "metadata": {
        "security_type": "CRYPTO",
        "source": "CRYPTO_INVESTING_FILE",
        "pricing_provider": "INVESTING_COM"
      }
    },
    {
      "ticker": "BTC",
      "name": "Valkyrie Bitcoin Strategy ETF",
      "security_type": "ETF",
      "exchange": "NASDAQ",
      "source": "NASDAQ_FILE",
      "pricing_provider": "YAHOO",
      "display_name": "BTC - Valkyrie Bitcoin Strategy ETF (ETF, nasdaq.com)",
      "metadata": {
        "security_type": "ETF",
        "source": "NASDAQ_FILE",
        "pricing_provider": "YAHOO"
      }
    }
  ]
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `ticker` | string | The ticker symbol |
| `name` | string | Full name of the security |
| `security_type` | string | Type of security (EQUITY, ETF, CRYPTO, etc.) |
| `exchange` | string | Trading exchange or platform |
| `source` | string | Data source origin |
| `pricing_provider` | string | Service providing price data |
| `display_name` | string | Formatted display string for UI |
| `metadata` | object | Structured metadata object |

## Source Types

| Source | Description | Domain |
|--------|-------------|--------|
| `NASDAQ_FILE` | NASDAQ exchange listings | nasdaq.com |
| `NYSE_FILE` | NYSE exchange listings | nyse.com |
| `OTHER_LISTED_FILE` | Other exchange listings | Various |
| `TREASURY_FILE` | US Treasury securities | treasury.gov |
| `CRYPTO_INVESTING_FILE` | Investing.com crypto data | investing.com |
| `YAHOO` | Yahoo Finance data | yahoo.com |
| `USER_ADDED` | Manually added by user | N/A |

## Security Types

| Type | Description | Example |
|------|-------------|---------|
| `EQUITY` | Individual company stocks | AAPL, MSFT |
| `ETF` | Exchange-traded funds | SPY, QQQ |
| `CRYPTO` | Cryptocurrencies | BTC, ETH |
| `BOND` | Fixed income securities | Corporate bonds |
| `US_TREASURY` | US Government debt | T-bills, T-bonds |
| `MUTUAL_FUND` | Mutual funds | VFIAX |
| `OPTION` | Options contracts | AAPL options |
| `FUTURES` | Futures contracts | E-mini S&P |
| `INDEX` | Market indices | S&P 500 |
| `OTHER` | Miscellaneous securities | Warrants, etc. |

## Pricing Providers

| Provider | Description | Used For |
|----------|-------------|----------|
| `YAHOO` | Yahoo Finance API | Stocks, ETFs, bonds |
| `INVESTING_COM` | Investing.com API | Crypto, alternatives |
| `TREASURY_GOV` | US Treasury Dept API | US Treasuries |

## Examples

### Basic Search
```bash
GET /api/autocomplete?q=BTC
```

### Limited Results
```bash
GET /api/autocomplete?q=AAPL&limit=5
```

### Search with Metadata
```bash
GET /api/autocomplete?q=TSLA&include_metadata=true
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Query parameter 'q' is required"
}
```

### 500 Internal Server Error
```json
{
  "error": "Database connection failed"
}
```

## Implementation Notes

- Results are ordered by `sort_rank` (Yahoo metadata availability, market cap, etc.)
- Search is case-insensitive and supports partial matches
- The `display_name` field is pre-formatted for UI display
- Metadata is included by default for source tracking functionality
- Rate limiting may apply for high-frequency requests