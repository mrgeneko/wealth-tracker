# Operations Runbook: Pricing Provider Monitoring

## Overview

This runbook provides operational procedures for monitoring pricing provider health, handling failures, and maintaining the source tracking system.

## Key Metrics to Monitor

### Provider Health Metrics

1. **Success Rate by Provider**
   ```sql
   SELECT
     pricing_provider,
     COUNT(*) as total_requests,
     SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_requests,
     ROUND(
       SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2
     ) as success_rate
   FROM price_fetch_metrics
   WHERE created_at >= NOW() - INTERVAL 1 HOUR
   GROUP BY pricing_provider;
   ```

2. **Average Response Time**
   ```sql
   SELECT
     pricing_provider,
     AVG(response_time_ms) as avg_response_time,
     MIN(response_time_ms) as min_response_time,
     MAX(response_time_ms) as max_response_time
   FROM price_fetch_metrics
   WHERE created_at >= NOW() - INTERVAL 1 HOUR
   GROUP BY pricing_provider;
   ```

3. **Error Rate by Error Type**
   ```sql
   SELECT
     pricing_provider,
     error_type,
     COUNT(*) as error_count
   FROM price_fetch_errors
   WHERE created_at >= NOW() - INTERVAL 1 HOUR
   GROUP BY pricing_provider, error_type;
   ```

### System Health Metrics

1. **Positions Without Pricing Providers**
   ```sql
   SELECT COUNT(*) as positions_without_provider
   FROM positions
   WHERE pricing_provider IS NULL OR pricing_provider = '';
   ```

2. **Stale Price Data**
   ```sql
   SELECT
     security_type,
     COUNT(*) as stale_prices
   FROM latest_prices
   WHERE updated_at < NOW() - INTERVAL 1 HOUR;
   ```

3. **Provider Usage Distribution**
   ```sql
   SELECT
     pricing_provider,
     COUNT(*) as position_count
   FROM positions
   WHERE pricing_provider IS NOT NULL
   GROUP BY pricing_provider;
   ```

## Monitoring Dashboard

### Grafana Dashboard Setup

Create a dashboard with the following panels:

1. **Provider Success Rates** (Time Series)
   - Query: Success rate by provider over time
   - Alert: Success rate < 95% for 5 minutes

2. **Response Time Trends** (Time Series)
   - Query: Average response time by provider
   - Alert: Response time > 5000ms for 10 minutes

3. **Error Rate by Type** (Table)
   - Query: Error counts by provider and error type
   - Alert: Rate limit errors > 10 in 5 minutes

4. **Position Coverage** (Gauge)
   - Query: Percentage of positions with pricing providers
   - Alert: Coverage < 99%

## Alert Configuration

### Critical Alerts

1. **Provider Down**
   - Condition: Success rate = 0% for 10 minutes
   - Action: Page on-call engineer
   - Escalation: Switch to fallback provider

2. **High Error Rate**
   - Condition: Success rate < 80% for 15 minutes
   - Action: Create incident ticket
   - Investigation: Check provider API status

3. **Rate Limiting**
   - Condition: Rate limit errors > 50 in 10 minutes
   - Action: Reduce request frequency
   - Mitigation: Implement backoff strategy

### Warning Alerts

1. **Slow Response Times**
   - Condition: Average response time > 3000ms for 5 minutes
   - Action: Monitor trending
   - Investigation: Check network latency

2. **Missing Providers**
   - Condition: Positions without pricing_provider > 1% of total
   - Action: Review recent position additions
   - Fix: Update positions with appropriate providers

## Incident Response

### Provider Failure Response

1. **Detection**
   - Alert triggers from monitoring system
   - Check provider status page/API documentation

2. **Assessment**
   - Confirm outage scope (single provider vs. all providers)
   - Check if fallback providers are working
   - Assess impact on portfolio calculations

3. **Mitigation**
   - Enable fallback provider routing
   - Update pricing_provider assignments if needed
   - Communicate with users about delays

4. **Recovery**
   - Monitor provider restoration
   - Gradually shift traffic back
   - Update incident documentation

### Runbook: Switching to Fallback Provider

```bash
# 1. Check current provider status
curl -s https://api.your-provider.com/status

# 2. Update positions to use fallback
mysql -e "
  UPDATE positions
  SET pricing_provider = 'FALLBACK_PROVIDER'
  WHERE pricing_provider = 'FAILED_PROVIDER'
    AND security_type IN ('CRYPTO', 'OTHER');
"

# 3. Clear stale price cache
mysql -e "
  DELETE FROM latest_prices
  WHERE source = 'FAILED_PROVIDER'
    AND updated_at < NOW() - INTERVAL 1 HOUR;
"

# 4. Trigger price refresh
curl -X POST http://localhost:3001/api/prices/refresh

# 5. Monitor recovery
watch -n 60 "mysql -e 'SELECT pricing_provider, COUNT(*) FROM positions GROUP BY pricing_provider;'"
```

## Maintenance Procedures

### Weekly Tasks

1. **Review Provider Performance**
   ```bash
   # Generate weekly report
   ./scripts/generate-provider-report.sh --week
   ```

2. **Update Provider Credentials**
   - Rotate API keys before expiration
   - Test new credentials in staging

3. **Clean Up Failed Records**
   ```sql
   DELETE FROM price_fetch_errors
   WHERE created_at < NOW() - INTERVAL 30 DAY;
   ```

### Monthly Tasks

1. **Provider Cost Analysis**
   - Review API usage vs. billing
   - Optimize request patterns

2. **Security Audit**
   - Review API key access logs
   - Update security headers

3. **Performance Tuning**
   - Analyze slow queries
   - Optimize database indices

## Troubleshooting Guide

### Provider Returns 429 (Rate Limited)

**Symptoms:**
- Increased error rate
- "Rate limit exceeded" messages

**Solution:**
```javascript
// Implement exponential backoff in provider
async function fetchWithBackoff(url, options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return response;
    } catch (error) {
      if (attempt === maxRetries) throw error;
    }
  }
}
```

### Provider Returns Invalid Data

**Symptoms:**
- Prices are null or zero
- Unexpected data formats

**Solution:**
1. Check API documentation for format changes
2. Add data validation before processing
3. Implement fallback data sources

```javascript
function validatePriceData(data) {
  if (!data.price || data.price <= 0) {
    throw new Error('Invalid price data received');
  }
  return data;
}
```

### Database Connection Issues

**Symptoms:**
- Price updates failing
- "Connection timeout" errors

**Solution:**
1. Check database connection pool
2. Verify connection limits
3. Implement connection retry logic

### High Memory Usage

**Symptoms:**
- Application consuming excessive memory
- Slow response times

**Solution:**
1. Monitor heap usage
2. Implement memory limits
3. Add garbage collection hints

## Disaster Recovery

### Complete Provider Outage

1. **Immediate Actions**
   - Switch all affected positions to fallback provider
   - Disable automatic price updates
   - Notify users of manual price entry requirement

2. **Recovery Steps**
   ```bash
   # Create backup of current prices
   mysqldump wealth_tracker latest_prices > prices_backup.sql

   # Switch to manual mode
   export PRICE_UPDATE_MODE=manual

   # Update positions
   mysql -e "
     UPDATE positions
     SET pricing_provider = 'MANUAL'
     WHERE pricing_provider = 'FAILED_PROVIDER';
   "
   ```

3. **Restoration**
   - Monitor provider status
   - Gradually re-enable automatic updates
   - Validate price data integrity

### Data Corruption Recovery

1. **Detection**
   - Monitor for negative prices
   - Check for unrealistic price changes

2. **Recovery**
   ```sql
   -- Remove corrupted data
   DELETE FROM latest_prices
   WHERE price <= 0
      OR price > 1000000  -- Unrealistic price threshold
      OR updated_at < '2025-01-01'; -- Old data

   -- Trigger fresh price fetch
   UPDATE positions SET updated_at = NOW() WHERE pricing_provider IS NOT NULL;
   ```

## Performance Optimization

### Database Optimization

1. **Index Maintenance**
   ```sql
   ANALYZE TABLE positions, latest_prices, ticker_registry;
   OPTIMIZE TABLE positions, latest_prices, ticker_registry;
   ```

2. **Query Optimization**
   - Use composite indices for common queries
   - Implement query result caching
   - Add database connection pooling

### Application Optimization

1. **Request Batching**
   ```javascript
   // Batch price requests to reduce API calls
   async function batchPriceRequests(positions, batchSize = 10) {
     const batches = [];
     for (let i = 0; i < positions.length; i += batchSize) {
       batches.push(positions.slice(i, i + batchSize));
     }

     const results = [];
     for (const batch of batches) {
       const batchResults = await Promise.all(
         batch.map(pos => priceRouter.getPrice(pos))
       );
       results.push(...batchResults);
       await delay(1000); // Rate limiting
     }
     return results;
   }
   ```

2. **Caching Strategy**
   - Cache successful API responses
   - Implement Redis for shared caching
   - Set appropriate TTL values

## Contact Information

- **On-call Engineer**: pager@company.com
- **DevOps Team**: devops@company.com
- **Provider Support**:
  - Yahoo Finance: api-support@yahoo.com
  - Investing.com: support@investing.com
  - Treasury.gov: No direct support, monitor status.gov

## Related Documentation

- [Adding Pricing Providers](../development/adding-pricing-providers.md)
- [Database Schema](../database/schema.md)
- [API Documentation](../api/)
- [CI/CD Pipeline](../../.github/workflows/ci.yml)