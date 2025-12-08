# Security Metadata System

## Overview

This system stores comprehensive metadata about securities (stocks, ETFs, bonds, etc.) to enrich dashboard functionality with information like quote types, exchanges, currencies, dividend history, and earnings calendars.

## Database Schema

### Tables Created

1. **`securities_metadata`** - Core metadata for each security
   - Basic info: symbol, names, type
   - Geographic: region, exchange, currency, timezone
   - Market data: market cap, shares outstanding, ratios
   - Dividends: rates and yields
   - 52-week ranges

2. **`securities_earnings`** - Earnings calendar and results
   - Upcoming earnings dates
   - EPS estimates and actuals
   - Revenue estimates and actuals
   - Fiscal quarter/year tracking

3. **`securities_dividends`** - Dividend payment history
   - Ex-dividend dates
   - Payment dates
   - Dividend amounts
   - Status tracking (estimated/confirmed/paid)

4. **`positions.metadata_symbol`** - Foreign key linking positions to metadata

## Setup Instructions

### 1. Run Database Migrations

Execute the SQL migration files in order:

```bash
# From your MySQL client or command line
mysql -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < scripts/sql/002_create_securities_metadata.sql
mysql -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < scripts/sql/003_create_securities_earnings.sql
mysql -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < scripts/sql/004_create_securities_dividends.sql
mysql -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < scripts/sql/005_add_positions_metadata_link.sql
```

Or run them all at once:

```bash
for file in scripts/sql/00{2,3,4,5}_*.sql; do
  echo "Running $file..."
  mysql -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < "$file"
done
```

### 2. Populate Metadata

#### For a Single Security

```bash
node scripts/populate_securities_metadata.js --symbol AAPL
```

#### For All Securities in Your Portfolio

```bash
node scripts/populate_securities_metadata.js --all
```

This will:
- Fetch metadata from Yahoo Finance for each unique symbol in the `positions` table
- Populate `securities_metadata` with comprehensive security information
- Extract and store upcoming earnings events in `securities_earnings`
- Extract and store dividend information in `securities_dividends`

**Note**: The script includes rate limiting (500ms delay between symbols) to avoid overwhelming Yahoo Finance API.

## Usage Examples

### Query 1: Get Portfolio with Enriched Metadata

```sql
SELECT 
    p.symbol,
    p.quantity,
    sm.long_name,
    sm.quote_type,
    sm.exchange,
    sm.currency,
    sm.dividend_yield,
    sm.trailing_pe,
    lp.price,
    (p.quantity * lp.price) as market_value
FROM positions p
LEFT JOIN securities_metadata sm ON p.metadata_symbol = sm.symbol
LEFT JOIN latest_prices lp ON p.symbol = lp.ticker
WHERE p.account_id = ?
ORDER BY market_value DESC;
```

### Query 2: Upcoming Earnings for Portfolio (Next 30 Days)

```sql
SELECT 
    se.symbol,
    sm.long_name,
    se.earnings_date,
    se.eps_estimate,
    se.revenue_estimate,
    p.quantity,
    (p.quantity * lp.price) as position_value
FROM securities_earnings se
JOIN securities_metadata sm ON se.symbol = sm.symbol
JOIN positions p ON p.metadata_symbol = sm.symbol
LEFT JOIN latest_prices lp ON p.symbol = lp.ticker
WHERE se.earnings_date >= CURDATE()
  AND se.earnings_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
  AND se.is_estimate = TRUE
ORDER BY se.earnings_date ASC;
```

### Query 3: Dividend Calendar (Upcoming Payments)

```sql
SELECT 
    sd.symbol,
    sm.long_name,
    sd.ex_dividend_date,
    sd.payment_date,
    sd.dividend_amount,
    sd.currency,
    p.quantity,
    (sd.dividend_amount * p.quantity) as expected_payment
FROM securities_dividends sd
JOIN securities_metadata sm ON sd.symbol = sm.symbol
JOIN positions p ON p.metadata_symbol = sm.symbol
WHERE sd.payment_date >= CURDATE()
  AND sd.status IN ('confirmed', 'estimated')
ORDER BY sd.payment_date ASC;
```

### Query 4: Portfolio Summary by Asset Type

```sql
SELECT 
    sm.quote_type,
    COUNT(DISTINCT p.symbol) as num_securities,
    SUM(p.quantity * lp.price) as total_value,
    AVG(sm.dividend_yield) as avg_dividend_yield,
    AVG(sm.trailing_pe) as avg_pe_ratio
FROM positions p
JOIN securities_metadata sm ON p.metadata_symbol = sm.symbol
LEFT JOIN latest_prices lp ON p.symbol = lp.ticker
WHERE p.type != 'cash'
GROUP BY sm.quote_type
ORDER BY total_value DESC;
```

## Maintenance

### Daily Refresh (Recommended)

Create a cron job to update metadata daily:

```bash
# Add to crontab
0 2 * * * cd /path/to/wealth-tracker && node scripts/populate_securities_metadata.js --all >> logs/metadata_refresh.log 2>&1
```

### On-Demand Updates

When adding new positions, immediately fetch their metadata:

```bash
node scripts/populate_securities_metadata.js --symbol <NEW_SYMBOL>
```

### Monitoring

Check the last update time for securities:

```sql
SELECT symbol, short_name, last_updated 
FROM securities_metadata 
ORDER BY last_updated DESC 
LIMIT 20;
```

## Data Sources

All metadata is sourced from Yahoo Finance via the `yahoo-finance2` npm package:
- **quoteSummary** API with modules: `price`, `summaryDetail`, `quoteType`, `calendarEvents`, `defaultKeyStatistics`

## Troubleshooting

### Symbol Not Found

If Yahoo Finance doesn't recognize a symbol:
- Verify the symbol is correct
- Check if it's delisted or merged
- Try alternative ticker formats (e.g., add exchange suffix)

### Missing Earnings/Dividends

Not all securities have earnings or dividend data:
- ETFs typically don't report earnings
- Some securities may not pay dividends
- Earnings dates may not be announced yet

### Rate Limiting

If you encounter rate limiting errors:
- Increase the delay in `populate_securities_metadata.js` (currently 500ms)
- Process symbols in smaller batches
- Run updates during off-peak hours

## Future Enhancements

Potential additions to consider:
- Historical dividend data (requires separate Yahoo Finance endpoint)
- Analyst recommendations and price targets
- Company profile and sector information
- ESG scores and ratings
- Options chain data
- Institutional ownership details
