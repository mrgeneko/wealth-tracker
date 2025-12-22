# Source Tracking Testing Strategy

This document outlines the testing strategy for the source tracking implementation in the Wealth Tracker application.

## Overview

Source tracking ensures that every position and price in the system can be traced back to its origin (`source`) and the service used to retrieve its price (`pricing_provider`). This is critical for data integrity and debugging.

## Testing Layers

### 1. Unit Testing (`PriceRouter`)

The `PriceRouter` service is the core of the intelligent routing logic. Unit tests cover:
- **Default Provider Selection**: Ensuring the correct default provider is chosen based on `security_type` (e.g., YAHOO for stocks, INVESTING_COM for crypto).
- **Database Lookup**: Verifying that the router correctly queries the `ticker_registry` for preferred providers.
- **Intelligent Routing**: Testing the `fetchPrice` method to ensure it routes to the correct provider function.
- **Fallback Logic**: Verifying that if a preferred provider fails, the router attempts fallback to alternative providers (e.g., YAHOO -> INVESTING_COM).
- **Normalization**: Ensuring tickers are uppercased and security types are lowercased consistently.

**Test File**: `tests/unit/services/price-router.test.js`

### 2. Integration Testing (API Flow)

Integration tests verify the end-to-end flow through the Express API and database.

#### Positions API
- **Creation**: Verifying that `POST /api/positions` correctly saves `source` and `pricing_provider` to the database.
- **Updates**: Verifying that `PUT /api/positions/:id` allows updating these fields.
- **Retrieval**: Verifying that `GET /api/assets` returns the source tracking metadata for each position.

#### Fetch Price API
- **Routing**: Verifying that `POST /api/fetch-price` respects the `pricing_provider` passed in the request body.
- **Security Type**: Ensuring `security_type` is passed correctly to the `PriceRouter`.

**Test File**: `tests/integration/source-tracking.integration.test.js`

### 3. Multi-type Ticker Support

A key requirement was supporting the same ticker symbol with different security types (e.g., BTC as a cryptocurrency vs. BTC as an ETF).
- **Unit tests** verify that `PriceRouter` can fetch different prices for the same ticker based on `security_type`.
- **Integration tests** verify that the database can store multiple positions for the same ticker if they have different `security_type` or `source`.

## Running Tests

### Unit Tests
```bash
npx jest tests/unit/services/price-router.test.js
```

### Integration Tests
```bash
TEST_TYPE=integration npx jest tests/integration/source-tracking.integration.test.js
```

## Key Components Tested
- `PriceRouter` service
- `POST /api/positions`
- `PUT /api/positions/:id`
- `GET /api/assets`
- `POST /api/fetch-price`
- Database schema compatibility for `source` and `pricing_provider` columns
