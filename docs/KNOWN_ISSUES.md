# Known Issues & TODO Items

## Current Backlog

### High Priority
- **Symbol/Exchange Handling**: Currently assumes US stock markets. Need strategy for handling other exchanges
- **New Ticker Integration**: When adding new tickers to dashboard, need to check UST, NYSE, NASDAQ
  - If not a bond, call Yahoo to get price and stock/ETF flag
  - Test with BRK-B and BRK.b edge cases
  - Explore if `getConstructibleUrls` can be improved with stock/ETF/bond flag

### Medium Priority
- **Mutual Fund Listings**: Find current mutual fund listing (existing data from 2020)
- **Comprehensive Security Data Storage**: 
  - When making Yahoo calls, store entire response including:
    - ticker, exchange (yahoo, google, etc.), type
    - price_quoted/yield_quoted, issue date, maturity date, coupon, coupon dates
    - dividend dates (ex date, pay date, amount, real/estimate)
    - price_urls, dividend_urls, news_urls
    - trading_sessions (regular, pre_market, after_hours, overnight)
- **Price History Stream**: Store stream of price updates to database keyed by ticker + source + capture_time
- **Scraper Modernization**: Convert scrapers to work with ticker without URL where possible (partially done)

### Lower Priority
- **Bond Price Modeling**: BKLC price modeling
- **Intraday History**: Create intraday history of total net worth with graphing capability
- **Asset History**: Track history of assets over time
- **Price Retrieval Integration**: When new ticker added from web UI, retrieve pricing via daemon or direct DB update
- **Data Export**: Export data from web interface or MySQL database
- **Multiple Logins**: Determine if system should support multiple user logins

---

## Data Source Capabilities Matrix

| Source | Pre-Market | After Hours | Real-Time | Delayed | Bond Prices | Prev Close | Change $ | Change % |
|--------|:----------:|:-----------:|:---------:|:-------:|:-----------:|:----------:|:--------:|:--------:|
| Yahoo | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Webull | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Trading View | ✅ | ⚠️ (til 8p) | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Investing.com | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Google | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| YCharts | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Moomoo | ⚠️ (no ETF) | ⚠️ (no ETF) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| MarketBeat | ❓ | ⚠️ (some) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| NASDAQ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| CNBC | ❓ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MarketWatch | ⚠️ (limited) | ⚠️ (limited) | ✅ | ❌ | ⚠️ (IAUM has no price data) | ❌ | ❌ | ❌ |

**Legend**: ✅ = Available | ❌ = Not Available | ⚠️ = Limited/Conditional | ❓ = Unknown

---

## Notes

- Some tickers (e.g., IAUM) have limited price data availability - only available in TradingView chart widgets
- Trading View offers after-hours data only until 8pm ET
- MarketWatch and similar financial sites have variable coverage by ticker type
- Webull and Investing.com have most comprehensive data across market hours

---

## Research Resources

- NASDAQ Data API: https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true
- Polygon/Free Account: polygon/massive free account?
- Yahoo Finance Tickers: https://investexcel.net/all-yahoo-finance-stock-tickers/
- Public APIs: https://publicapis.io/nasdaq-data-link-api

---

**Last Updated**: December 15, 2025  
**Status**: Active - Items tracked for future implementation
