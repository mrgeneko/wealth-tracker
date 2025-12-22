# Adding Pricing Providers

## Overview

The wealth-tracker system supports pluggable pricing providers to fetch price data from different financial data sources. This guide explains how to add a new pricing provider to the system.

## Architecture

### PriceRouter Service

The `PriceRouter` service is responsible for routing price requests to the appropriate provider based on the `pricing_provider` field in position/ ticker records.

**Location**: `services/price-router.js`

```javascript
class PriceRouter {
  async getPrice(position) {
    const { ticker, security_type, pricing_provider } = position;

    switch (pricing_provider) {
      case 'YAHOO':
        return await this.fetchFromYahoo(ticker, security_type);
      case 'INVESTING_COM':
        return await this.fetchFromInvesting(ticker, security_type);
      case 'YOUR_NEW_PROVIDER':  // Add your provider here
        return await this.fetchFromYourProvider(ticker, security_type);
      default:
        return await this.fetchWithFallback(ticker, security_type);
    }
  }
}
```

## Steps to Add a New Provider

### 1. Create Provider Integration Module

Create a new file in `services/integrations/` for your provider.

**Example**: `services/integrations/your-provider.js`

```javascript
class YourProviderAPI {
  constructor() {
    // Initialize API client, set credentials, etc.
    this.baseURL = 'https://api.your-provider.com';
    this.apiKey = process.env.YOUR_PROVIDER_API_KEY;
  }

  async getPrice(ticker, security_type) {
    try {
      const response = await fetch(`${this.baseURL}/prices/${ticker}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      return {
        ticker,
        security_type,
        price: data.price,
        previous_close_price: data.previousClose,
        source: 'YOUR_PROVIDER',
        quote_time: new Date(data.timestamp)
      };
    } catch (error) {
      console.error(`YourProvider API error for ${ticker}:`, error.message);
      throw error;
    }
  }

  // Add other methods as needed (historical data, etc.)
}

module.exports = new YourProviderAPI();
```

### 2. Update PriceRouter

Add your provider to the routing logic in `services/price-router.js`.

```javascript
const yourProvider = require('./integrations/your-provider');

class PriceRouter {
  async getPrice(position) {
    const { ticker, security_type, pricing_provider } = position;

    switch (pricing_provider) {
      case 'YAHOO':
        return await this.fetchFromYahoo(ticker, security_type);
      case 'INVESTING_COM':
        return await this.fetchFromInvesting(ticker, security_type);
      case 'YOUR_PROVIDER':  // Your new provider
        return await this.fetchFromYourProvider(ticker, security_type);
      default:
        return await this.fetchWithFallback(ticker, security_type);
    }
  }

  async fetchFromYourProvider(ticker, security_type) {
    try {
      const priceData = await yourProvider.getPrice(ticker, security_type);
      return priceData;
    } catch (error) {
      console.error(`YourProvider fetch failed for ${ticker}:`, error);
      throw error;
    }
  }
}
```

### 3. Update Fallback Logic

Consider adding your provider to the fallback chain in `fetchWithFallback()`.

```javascript
async fetchWithFallback(ticker, security_type) {
  const providerMap = {
    'EQUITY': 'YAHOO',
    'ETF': 'YAHOO',
    'CRYPTO': 'YOUR_PROVIDER',  // Use your provider as crypto fallback
    'BOND': 'YAHOO'
  };

  const provider = providerMap[security_type] || 'YAHOO';
  console.warn(`No pricing_provider for ${ticker}, using ${provider}`);

  return await this.getPrice({ ticker, security_type, pricing_provider: provider });
}
```

### 4. Update Database Schema

Add your provider to the seed data in `scripts/init-db/000-base-schema.sql`.

```sql
-- Add pricing_provider population for your source
UPDATE ticker_registry
SET pricing_provider = 'YOUR_PROVIDER'
WHERE source = 'YOUR_SOURCE_FILE'
  AND security_type IN ('CRYPTO', 'OTHER')
  AND pricing_provider IS NULL;
```

### 5. Add Environment Variables

Document required environment variables in the README and add them to `.env.example`.

```env
# Your Provider API
YOUR_PROVIDER_API_KEY=your_api_key_here
YOUR_PROVIDER_BASE_URL=https://api.your-provider.com
```

### 6. Update Documentation

Update the pricing providers table in `README.md`:

```markdown
### Supported Pricing Providers

- **YAHOO**: Stocks, ETFs, bonds
- **INVESTING_COM**: Cryptocurrencies and alternative pricing
- **TREASURY_GOV**: US Treasury securities
- **YOUR_PROVIDER**: [Description of what it provides]
```

### 7. Add Unit Tests

Create comprehensive unit tests for your provider integration.

**File**: `tests/unit/services/integrations/your-provider.test.js`

```javascript
const yourProvider = require('../../../../services/integrations/your-provider');

describe('YourProviderAPI', () => {
  beforeEach(() => {
    // Mock fetch, set up test data
  });

  test('should fetch price successfully', async () => {
    const result = await yourProvider.getPrice('BTC', 'CRYPTO');

    expect(result).toEqual({
      ticker: 'BTC',
      security_type: 'CRYPTO',
      price: expect.any(Number),
      previous_close_price: expect.any(Number),
      source: 'YOUR_PROVIDER',
      quote_time: expect.any(Date)
    });
  });

  test('should handle API errors gracefully', async () => {
    // Mock API failure
    await expect(yourProvider.getPrice('INVALID', 'CRYPTO'))
      .rejects.toThrow();
  });

  test('should handle network timeouts', async () => {
    // Mock timeout scenario
  });
});
```

### 8. Add Integration Tests

Add integration tests that use the PriceRouter with your provider.

**File**: `tests/integration/price-router-your-provider.test.js`

```javascript
describe('PriceRouter with YourProvider', () => {
  test('should route to YourProvider for YOUR_PROVIDER pricing_provider', async () => {
    const position = {
      ticker: 'SOME_CRYPTO',
      security_type: 'CRYPTO',
      pricing_provider: 'YOUR_PROVIDER'
    };

    const priceData = await priceRouter.getPrice(position);

    expect(priceData.source).toBe('YOUR_PROVIDER');
    expect(priceData.ticker).toBe('SOME_CRYPTO');
  });

  test('should fallback to YourProvider for crypto without provider', async () => {
    const position = {
      ticker: 'NEW_CRYPTO',
      security_type: 'CRYPTO'
      // No pricing_provider specified
    };

    const priceData = await priceRouter.getPrice(position);

    expect(priceData.source).toBe('YOUR_PROVIDER');
  });
});
```

### 9. Update CI/CD Pipeline

Add your provider to the test matrix if it requires special setup.

**File**: `.github/workflows/ci.yml`

```yaml
jobs:
  integration-tests:
    services:
      mysql:
        # ... existing mysql service
    env:
      YOUR_PROVIDER_API_KEY: ${{ secrets.YOUR_PROVIDER_API_KEY }}
```

## Provider Requirements

### API Response Format

Your provider must return data in the standard format:

```javascript
{
  ticker: string,           // The ticker symbol
  security_type: string,    // Security type (CRYPTO, EQUITY, etc.)
  price: number,           // Current price
  previous_close_price: number, // Previous close (optional)
  source: string,          // Your provider name
  quote_time: Date         // When the price was quoted
}
```

### Error Handling

- Throw descriptive errors for API failures
- Handle rate limiting gracefully
- Provide meaningful error messages for debugging

### Rate Limiting

- Implement appropriate delays between requests
- Handle rate limit responses (429 status)
- Consider implementing request queuing for high-volume scenarios

### Data Quality

- Validate price data before returning
- Handle missing or invalid data gracefully
- Provide fallbacks for partial failures

## Example Implementation: CoinMarketCap Provider

Here's a complete example of adding CoinMarketCap as a provider:

### 1. Integration Module

```javascript
// services/integrations/coinmarketcap.js
class CoinMarketCapAPI {
  constructor() {
    this.baseURL = 'https://pro-api.coinmarketcap.com';
    this.apiKey = process.env.CMC_API_KEY;
  }

  async getPrice(ticker, security_type) {
    // Map ticker to CoinMarketCap ID
    const coinId = await this.mapTickerToCoinId(ticker);

    const response = await fetch(
      `${this.baseURL}/v2/cryptocurrency/quotes/latest?id=${coinId}`,
      {
        headers: {
          'X-CMC_PRO_API_KEY': this.apiKey
        }
      }
    );

    const data = await response.json();
    const quote = data.data[coinId].quote.USD;

    return {
      ticker,
      security_type,
      price: quote.price,
      previous_close_price: null, // CMC doesn't provide this
      source: 'COINMARKETCAP',
      quote_time: new Date(quote.last_updated)
    };
  }

  async mapTickerToCoinId(ticker) {
    // Implementation to map BTC -> 1, ETH -> 1027, etc.
  }
}

module.exports = new CoinMarketCapAPI();
```

### 2. Update PriceRouter

```javascript
case 'COINMARKETCAP':
  return await this.fetchFromCoinMarketCap(ticker, security_type);
```

### 3. Database Updates

```sql
UPDATE ticker_registry
SET pricing_provider = 'COINMARKETCAP'
WHERE source = 'CRYPTO_CMC_FILE'
  AND security_type = 'CRYPTO';
```

## Testing Your Provider

### Manual Testing

1. **Unit Tests**: Run your provider tests
   ```bash
   npm test -- tests/unit/services/integrations/your-provider.test.js
   ```

2. **Integration Tests**: Test with PriceRouter
   ```bash
   npm run test:integration -- --testPathPattern=price-router-your-provider
   ```

3. **Manual Price Fetch**: Test real price fetching
   ```javascript
   const priceRouter = require('./services/price-router');
   const result = await priceRouter.getPrice({
     ticker: 'BTC',
     security_type: 'CRYPTO',
     pricing_provider: 'YOUR_PROVIDER'
   });
   console.log(result);
   ```

### Production Readiness Checklist

- [ ] Provider integration module implemented
- [ ] PriceRouter updated with routing logic
- [ ] Database seed data updated
- [ ] Environment variables documented
- [ ] Unit tests passing (100% coverage)
- [ ] Integration tests passing
- [ ] Error handling implemented
- [ ] Rate limiting handled
- [ ] Documentation updated
- [ ] CI/CD pipeline updated
- [ ] Manual testing completed

## Troubleshooting

### Common Issues

1. **API Key Issues**: Verify environment variables are set correctly
2. **Rate Limiting**: Implement exponential backoff
3. **Data Format Changes**: Monitor API responses for breaking changes
4. **Network Timeouts**: Add retry logic with timeouts

### Debugging

Enable debug logging in your provider:

```javascript
console.log(`Fetching ${ticker} from YourProvider API...`);
// ... API call ...
console.log(`Received response:`, responseData);
```

### Monitoring

Add metrics to track provider performance:

```javascript
// Track success/failure rates
// Monitor response times
// Alert on consecutive failures
```