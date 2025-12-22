# Positions API Documentation

## Overview

The positions API manages portfolio positions with comprehensive source tracking metadata to ensure accurate pricing and prevent confusion between securities with identical ticker symbols.

## Endpoints

### Create Position
```
POST /api/positions
```

### Get Positions
```
GET /api/positions
```

### Update Position
```
PUT /api/positions/:id
```

### Delete Position
```
DELETE /api/positions/:id
```

## Create Position

### Request

**Method**: `POST`  
**Endpoint**: `/api/positions`  
**Content-Type**: `application/json`

**Request Body**:
```json
{
  "account_id": 1,
  "ticker": "BTC",
  "description": "Bitcoin",
  "quantity": 0.5,
  "security_type": "CRYPTO",
  "source": "CRYPTO_INVESTING_FILE",
  "pricing_provider": "INVESTING_COM",
  "exchange": "CRYPTO",
  "currency": "USD"
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `account_id` | number | ID of the account holding this position |
| `ticker` | string | Ticker symbol (max 50 chars) |
| `security_type` | string | Type of security (see security types below) |
| `source` | string | Data source origin (see source types below) |
| `pricing_provider` | string | Pricing service to use |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string | null | Human-readable description |
| `quantity` | number | null | Number of shares/units held |
| `exchange` | string | null | Trading exchange/platform |
| `currency` | string | "USD" | Currency denomination |

### Response

**Success (201)**:
```json
{
  "id": 123,
  "account_id": 1,
  "ticker": "BTC",
  "description": "Bitcoin",
  "quantity": 0.5,
  "security_type": "CRYPTO",
  "source": "CRYPTO_INVESTING_FILE",
  "pricing_provider": "INVESTING_COM",
  "exchange": "CRYPTO",
  "currency": "USD",
  "created_at": "2025-12-22T10:30:00Z",
  "updated_at": "2025-12-22T10:30:00Z"
}
```

**Error (400)**:
```json
{
  "error": "security_type, source, and pricing_provider are required"
}
```

## Get Positions

### Request

**Method**: `GET`  
**Endpoint**: `/api/positions`

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `account_id` | number | Filter by account ID |
| `ticker` | string | Filter by ticker symbol |
| `security_type` | string | Filter by security type |

### Response

**Success (200)**:
```json
{
  "positions": [
    {
      "id": 123,
      "account_id": 1,
      "ticker": "BTC",
      "description": "Bitcoin",
      "quantity": 0.5,
      "security_type": "CRYPTO",
      "source": "CRYPTO_INVESTING_FILE",
      "pricing_provider": "INVESTING_COM",
      "exchange": "CRYPTO",
      "currency": "USD",
      "account_name": "My Crypto Wallet",
      "created_at": "2025-12-22T10:30:00Z",
      "updated_at": "2025-12-22T10:30:00Z"
    }
  ]
}
```

## Update Position

### Request

**Method**: `PUT`  
**Endpoint**: `/api/positions/:id`  
**Content-Type**: `application/json`

**Request Body**: Same as create, but all fields optional except the metadata fields remain required for data integrity.

```json
{
  "quantity": 1.0,
  "description": "Updated Bitcoin holding"
}
```

### Response

**Success (200)**: Updated position object  
**Error (404)**: Position not found  
**Error (400)**: Invalid data

## Delete Position

### Request

**Method**: `DELETE`  
**Endpoint**: `/api/positions/:id`

### Response

**Success (200)**:
```json
{
  "success": true,
  "message": "Position deleted successfully"
}
```

**Error (404)**: Position not found

## Security Types

| Type | Description | Examples |
|------|-------------|----------|
| `EQUITY` | Individual company stocks | AAPL, MSFT, TSLA |
| `ETF` | Exchange-traded funds | SPY, QQQ, VTI |
| `CRYPTO` | Cryptocurrencies | BTC, ETH, SOL |
| `BOND` | Fixed income securities | Corporate/government bonds |
| `US_TREASURY` | US Government debt | T-bills, T-notes, T-bonds |
| `MUTUAL_FUND` | Mutual funds | VFIAX, VGHCX |
| `OPTION` | Options contracts | AAPL calls/puts |
| `FUTURES` | Futures contracts | E-mini S&P, crude oil |
| `INDEX` | Market indices | S&P 500, NASDAQ 100 |
| `OTHER` | Miscellaneous | Warrants, preferreds |

## Source Types

| Source | Description | Domain |
|--------|-------------|--------|
| `NASDAQ_FILE` | NASDAQ exchange data | nasdaq.com |
| `NYSE_FILE` | NYSE exchange data | nyse.com |
| `OTHER_LISTED_FILE` | Other exchange listings | Various |
| `TREASURY_FILE` | US Treasury auctions | treasury.gov |
| `CRYPTO_INVESTING_FILE` | Investing.com crypto | investing.com |
| `YAHOO` | Yahoo Finance API | yahoo.com |
| `USER_ADDED` | Manually added | N/A |

## Pricing Providers

| Provider | Description | Used For |
|----------|-------------|----------|
| `YAHOO` | Yahoo Finance API | Stocks, ETFs, bonds |
| `INVESTING_COM` | Investing.com API | Crypto, alternatives |
| `TREASURY_GOV` | Treasury Dept API | US Treasuries |

## Examples

### Create Crypto Position
```javascript
const response = await fetch('/api/positions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    account_id: 1,
    ticker: 'BTC',
    quantity: 0.5,
    security_type: 'CRYPTO',
    source: 'CRYPTO_INVESTING_FILE',
    pricing_provider: 'INVESTING_COM'
  })
});
```

### Create Stock Position
```javascript
const response = await fetch('/api/positions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    account_id: 2,
    ticker: 'AAPL',
    quantity: 10,
    security_type: 'EQUITY',
    source: 'NASDAQ_FILE',
    pricing_provider: 'YAHOO',
    exchange: 'NASDAQ'
  })
});
```

### Get Positions by Account
```javascript
const response = await fetch('/api/positions?account_id=1');
const data = await response.json();
console.log(data.positions); // Array of positions
```

## Data Validation

- **ticker**: Required, max 50 characters, uppercase normalized
- **security_type**: Required, must be valid enum value
- **source**: Required, must be valid source type
- **pricing_provider**: Required, must be valid provider
- **quantity**: Optional, must be valid number if provided
- **account_id**: Required, must reference existing account

## Error Handling

### Common Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `security_type, source, and pricing_provider are required` | Missing required metadata |
| 400 | `Invalid security_type` | Unknown security type |
| 404 | `Position not found` | Invalid position ID |
| 500 | `Database error` | Internal server error |

## Implementation Notes

- All position mutations trigger asset cache invalidation
- Price fetching uses the `pricing_provider` to route requests correctly
- The dashboard displays positions as: `"BTC (Crypto - investing.com)"`
- Source tracking prevents price confusion between same-ticker securities