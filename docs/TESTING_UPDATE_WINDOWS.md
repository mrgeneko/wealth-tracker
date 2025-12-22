# Testing Update Windows

## Overview

The wealth tracker uses `update_windows` (stored in the database) to control when tickers can be scraped. This prevents unnecessary scraping during off-market hours and weekends.

However, for **testing and development**, you may need to bypass these restrictions to scrape data at any time.

## Bypassing Update Windows

### Option 1: Environment Variable (Recommended for Testing)

Set the `IGNORE_UPDATE_WINDOWS` environment variable to `true`:

**In `.env` file:**
```bash
IGNORE_UPDATE_WINDOWS=true
```

**Restart the scrapers container:**
```bash
docker-compose restart scrapers
```

### Option 2: Docker Compose Override

If you don't want to modify `.env`, you can pass it directly:

```bash
IGNORE_UPDATE_WINDOWS=true docker-compose up -d scrapers
```

### Option 3: Temporarily for a Single Run

Export the variable in your shell before starting:

```bash
export IGNORE_UPDATE_WINDOWS=true
docker-compose up -d scrapers
```

## Verification

Check the scraper logs to confirm the bypass is active:

```bash
docker logs wealth-tracker-scrapers-1 2>&1 | grep "update_windows_disabled_by_env"
```

You should see messages like:
```
{ allowed: true, reason: 'update_windows_disabled_by_env' }
```

## Re-enabling Update Windows

To restore normal behavior, set the variable back to `false` (or remove it) and restart:

**In `.env` file:**
```bash
IGNORE_UPDATE_WINDOWS=false
```

**Restart:**
```bash
docker-compose restart scrapers
```

## How It Works

The `UpdateWindowService` checks this environment variable at the start of `isWithinUpdateWindow()`:

```javascript
if (process.env.IGNORE_UPDATE_WINDOWS === 'true') {
    return { allowed: true, reason: 'update_windows_disabled_by_env' };
}
```

This allows all tickers to be scraped regardless of:
- Day of week (including weekends)
- Time of day
- Specific ticker restrictions (like BKLC)
- Provider-specific windows

## Use Cases

- **Weekend testing**: Test crypto scraping on Saturday/Sunday
- **Off-hours development**: Work on the scraper outside market hours
- **Integration tests**: Run full scraping cycles without time restrictions
- **Demo/presentation**: Show live scraping at any time
