# Monitoring Guide

## Overview

This guide explains how to monitor the health and performance of the source tracking system and pricing providers.

## Key Metrics

### Pricing Provider Metrics

Monitor these metrics to ensure pricing providers are working correctly:

1. **Success Rate**: Percentage of successful price fetches per provider
2. **Response Time**: Average time to fetch prices from each provider
3. **Error Rate**: Rate of failures by error type (network, rate limit, API error)
4. **Coverage**: Percentage of positions with assigned pricing providers

### System Health Metrics

1. **Position Coverage**: Positions with complete source tracking metadata
2. **Price Freshness**: Age of price data in latest_prices table
3. **Database Performance**: Query execution times for price operations

## Monitoring Setup

### Basic Health Checks

#### Check Provider Status
```bash
# Test Yahoo Finance API
curl -s "https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL" | jq '.quoteResponse.result[0].regularMarketPrice'

# Test Investing.com API (if configured)
curl -s "https://api.investing.com/api/financialdata/1.1" | head -c 100

# Check database connectivity
mysql -e "SELECT COUNT(*) FROM positions WHERE pricing_provider IS NOT NULL;" wealth_tracker
```

#### Monitor Price Updates
```bash
# Check recent price updates
mysql -e "
  SELECT
    pricing_provider,
    COUNT(*) as positions,
    AVG(TIMESTAMPDIFF(MINUTE, updated_at, NOW())) as avg_age_minutes
  FROM positions p
  LEFT JOIN latest_prices lp ON p.ticker = lp.ticker AND p.security_type = lp.security_type
  WHERE p.pricing_provider IS NOT NULL
  GROUP BY pricing_provider;
" wealth_tracker
```

### Automated Monitoring

#### Cron Job for Health Checks
```bash
# Add to crontab for hourly checks
0 * * * * /path/to/wealth-tracker/scripts/health-check.sh >> /var/log/wealth-tracker/health.log 2>&1
```

#### Sample Health Check Script
```bash
#!/bin/bash
# scripts/health-check.sh

echo "$(date): Starting health check"

# Check database connectivity
if ! mysql -e "SELECT 1;" wealth_tracker > /dev/null 2>&1; then
  echo "CRITICAL: Database connection failed"
  exit 1
fi

# Check positions with providers
PROVIDER_COUNT=$(mysql -e "SELECT COUNT(*) FROM positions WHERE pricing_provider IS NOT NULL;" wealth_tracker -s -N)
TOTAL_POSITIONS=$(mysql -e "SELECT COUNT(*) FROM positions;" wealth_tracker -s -N)

if [ "$TOTAL_POSITIONS" -gt 0 ]; then
  COVERAGE=$(( PROVIDER_COUNT * 100 / TOTAL_POSITIONS ))
  if [ "$COVERAGE" -lt 95 ]; then
    echo "WARNING: Only ${COVERAGE}% of positions have pricing providers"
  fi
fi

# Check stale prices (older than 1 hour)
STALE_COUNT=$(mysql -e "SELECT COUNT(*) FROM latest_prices WHERE updated_at < NOW() - INTERVAL 1 HOUR;" wealth_tracker -s -N)
if [ "$STALE_COUNT" -gt 0 ]; then
  echo "WARNING: $STALE_COUNT prices are stale (>1 hour old)"
fi

echo "$(date): Health check completed"
```

## Alerting

### Email Alerts
```bash
# Send alert on critical failures
CRITICAL_ISSUES=$(grep "CRITICAL" /var/log/wealth-tracker/health.log | wc -l)
if [ "$CRITICAL_ISSUES" -gt 0 ]; then
  mail -s "Wealth Tracker - Critical Issues Detected" admin@company.com < /var/log/wealth-tracker/health.log
fi
```

### Slack Integration
```bash
# Post to Slack on warnings
WARNINGS=$(grep "WARNING" /var/log/wealth-tracker/health.log | wc -l)
if [ "$WARNINGS" -gt 0 ]; then
  curl -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"Wealth Tracker Warnings: $WARNINGS issues detected\"}" \
    $SLACK_WEBHOOK_URL
fi
```

## Troubleshooting

### Common Issues

#### High Error Rates
- Check provider API status pages
- Verify API credentials
- Review rate limiting

#### Stale Price Data
- Check if price update jobs are running
- Verify cron configuration
- Review error logs for fetch failures

#### Missing Pricing Providers
- Run position audit script
- Update positions with appropriate providers
- Check for new security types

### Diagnostic Queries

#### Find Positions Without Providers
```sql
SELECT
  p.id,
  p.ticker,
  p.security_type,
  p.source,
  tr.pricing_provider as suggested_provider
FROM positions p
LEFT JOIN ticker_registry tr ON p.ticker = tr.ticker
  AND p.security_type = tr.security_type
WHERE p.pricing_provider IS NULL
LIMIT 10;
```

#### Check Provider Performance
```sql
SELECT
  pricing_provider,
  COUNT(*) as total_positions,
  AVG(price) as avg_price,
  MAX(updated_at) as last_update,
  TIMESTAMPDIFF(MINUTE, MAX(updated_at), NOW()) as minutes_since_update
FROM positions p
JOIN latest_prices lp ON p.ticker = lp.ticker AND p.security_type = lp.security_type
WHERE p.pricing_provider IS NOT NULL
GROUP BY pricing_provider
ORDER BY minutes_since_update DESC;
```

#### Error Analysis
```sql
SELECT
  error_type,
  COUNT(*) as error_count,
  MAX(created_at) as last_error
FROM price_fetch_errors
WHERE created_at >= NOW() - INTERVAL 24 HOUR
GROUP BY error_type
ORDER BY error_count DESC;
```

## Performance Tuning

### Database Optimization
```sql
-- Analyze table statistics
ANALYZE TABLE positions, latest_prices, ticker_registry;

-- Check index usage
SHOW INDEX FROM positions;
SHOW INDEX FROM latest_prices;

-- Monitor slow queries
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;
```

### Application Tuning
- Increase database connection pool size for high load
- Implement request caching for frequently accessed prices
- Add circuit breakers for failing providers

## Logs and Debugging

### Log Locations
- Application logs: `logs/`
- Database logs: MySQL error log
- System logs: `/var/log/syslog`

### Debug Commands
```bash
# Enable verbose logging
export DEBUG=wealth-tracker:*

# Test individual provider
node -e "
const priceRouter = require('./services/price-router');
priceRouter.getPrice({
  ticker: 'AAPL',
  security_type: 'EQUITY',
  pricing_provider: 'YAHOO'
}).then(console.log).catch(console.error);
"

# Check database connections
mysql -e "SHOW PROCESSLIST;" wealth_tracker
```

## Maintenance

### Daily Checks
- Review error logs
- Check disk space
- Verify backup completion

### Weekly Tasks
- Analyze provider performance trends
- Review and rotate logs
- Update monitoring thresholds

### Monthly Tasks
- Full system health assessment
- Security updates
- Performance optimization review