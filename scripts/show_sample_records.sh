#!/bin/bash
# show_sample_records.sh
# Display sample records from metadata tables

source .env

echo "=========================================="
echo "SECURITIES_METADATA (Sample Records)"
echo "=========================================="
docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "
SELECT symbol, short_name, quote_type, exchange, currency, 
       ROUND(market_cap/1000000000, 2) as market_cap_b,
       ROUND(dividend_yield, 4) as div_yield,
       ROUND(trailing_pe, 2) as pe_ratio
FROM securities_metadata 
LIMIT 5;" 2>&1 | grep -v Warning

echo ""
echo "=========================================="
echo "SECURITIES_EARNINGS (Sample Records)"
echo "=========================================="
docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "
SELECT symbol, 
       DATE_FORMAT(earnings_date, '%Y-%m-%d') as earnings_date,
       eps_estimate, 
       ROUND(revenue_estimate/1000000, 2) as revenue_est_m,
       fiscal_quarter, 
       fiscal_year
FROM securities_earnings 
LIMIT 5;" 2>&1 | grep -v Warning

echo ""
echo "=========================================="
echo "SECURITIES_DIVIDENDS (Sample Records)"
echo "=========================================="
docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "
SELECT symbol, 
       DATE_FORMAT(ex_dividend_date, '%Y-%m-%d') as ex_div_date,
       dividend_amount, 
       dividend_type, 
       currency,
       status
FROM securities_dividends 
LIMIT 5;" 2>&1 | grep -v Warning

echo ""
echo "=========================================="
echo "RECORD COUNTS"
echo "=========================================="
docker exec wealth-tracker-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} -e "
SELECT 'securities_metadata' as table_name, COUNT(*) as count FROM securities_metadata
UNION ALL SELECT 'securities_earnings', COUNT(*) FROM securities_earnings
UNION ALL SELECT 'securities_dividends', COUNT(*) FROM securities_dividends
UNION ALL SELECT 'positions', COUNT(*) FROM positions;" 2>&1 | grep -v Warning
