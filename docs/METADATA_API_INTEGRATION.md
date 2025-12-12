# Metadata API Integration Guide

## Overview

This guide explains how to integrate the security metadata API endpoints into your dashboard for real-time ticker lookup and metadata prefetching.

## API Endpoints

### 1. Ticker Lookup (Non-blocking)

**Endpoint:** `GET /api/metadata/lookup/:ticker`

**Use Case:** Quick check if metadata exists, triggers background fetch if not

**Example:**
```javascript
const response = await fetch('/api/metadata/lookup/AAPL');
const data = await response.json();

if (data.exists) {
  console.log('Metadata:', data.metadata);
} else {
  console.log('Fetching in background...');
}
```

---

### 2. Prefetch Metadata (Blocking)

**Endpoint:** `POST /api/metadata/prefetch`

**Use Case:** Fetch metadata when user selects ticker (waits 1-2 seconds)

**Example:**
```javascript
const response = await fetch('/api/metadata/prefetch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ticker: 'NVDA' })
});

const data = await response.json();
// data.cached: true if already existed
// data.metadata: full security metadata
```

---

### 3. Autocomplete Search

**Endpoint:** `GET /api/metadata/autocomplete?q=AAPL`

**Use Case:** Ticker search as user types

**Example:**
```javascript
const response = await fetch('/api/metadata/autocomplete?q=APP');
const data = await response.json();

// data.results: [
//   { ticker: 'AAPL', name: 'Apple Inc.', type: 'EQUITY', exchange: 'NASDAQ' },
//   { ticker: 'APPN', name: 'Appian Corporation', type: 'EQUITY', exchange: 'NASDAQ' }
// ]
```

---

### 4. Batch Prefetch (For Imports)

**Endpoint:** `POST /api/metadata/batch-prefetch`

**Use Case:** Import positions from CSV/JSON

**Example:**
```javascript
const response = await fetch('/api/metadata/batch-prefetch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    tickers: ['AAPL', 'NVDA', 'TSLA', 'INVALID-TICKER'] 
  })
});

const data = await response.json();
// data.summary: { total: 4, cached: 1, fetched: 2, failed: 1 }
// data.results: detailed status for each ticker
```

---

### 5. Check Missing Metadata

**Endpoint:** `GET /api/metadata/check-missing`

**Use Case:** Health check, find positions without metadata

**Example:**
```javascript
const response = await fetch('/api/metadata/check-missing');
const data = await response.json();

// data.count: 3
// data.tickers: ['PRIVATE-CO', 'BOND-2025', '912828YK0']
```

---

## Integration Workflows

### Workflow 1: Add Position Modal

```
1. User opens "Add Position" modal
2. User types in ticker field → autocomplete triggers
3. User selects "NVDA" from autocomplete
4. Frontend calls /api/metadata/prefetch (blocks 1-2s)
5. Form auto-fills with: "NVIDIA Corporation | EQUITY | NASDAQ"
6. User enters quantity and clicks "Add"
7. Position inserted with metadata_ticker = 'NVDA'
```

**Code:**
```javascript
// Step 2: Autocomplete
<input 
  type="text" 
  onInput={(e) => handleAutocomplete(e.target.value)}
/>

async function handleAutocomplete(query) {
  const res = await fetch(`/api/metadata/autocomplete?q=${query}`);
  const data = await res.json();
  showDropdown(data.results);
}

// Step 3-5: Ticker selected
async function onTickerSelected(ticker) {
  showLoading();
  const res = await fetch('/api/metadata/prefetch', {
    method: 'POST',
    body: JSON.stringify({ ticker })
  });
  const data = await res.json();
  
  if (data.metadata) {
    autoFillForm(data.metadata);
  }
  hideLoading();
}
```

---

### Workflow 2: Import Positions

```
1. User uploads CSV with 50 positions
2. Frontend extracts unique tickers (e.g., 30 unique)
3. Frontend calls /api/metadata/batch-prefetch
4. API fetches missing metadata (may take 15-30 seconds)
5. API returns summary: "25 cached, 3 fetched, 2 failed"
6. Frontend shows summary modal
7. Frontend inserts all 50 positions
8. Positions with failed metadata have metadata_ticker = NULL
```

**Code:**
```javascript
async function importPositions(csvData) {
  const positions = parseCSV(csvData);
  const tickers = [...new Set(positions.map(p => p.ticker))];
  
  // Show progress
  showProgress(`Checking ${tickers.length} tickers...`);
  
  // Batch prefetch
  const res = await fetch('/api/metadata/batch-prefetch', {
    method: 'POST',
    body: JSON.stringify({ tickers })
  });
  const data = await res.json();
  
  // Show summary
  alert(`
    Metadata Status:
    ✓ Cached: ${data.summary.cached}
    ✓ Fetched: ${data.summary.fetched}
    ✗ Failed: ${data.summary.failed}
  `);
  
  // Insert positions
  await bulkInsertPositions(positions);
}
```

---

### Workflow 3: Dashboard Display

```sql
-- Query with graceful fallbacks
SELECT 
  p.symbol,
  p.quantity,
  COALESCE(sm.long_name, p.symbol) as display_name,
  COALESCE(sm.quote_type, 'Unknown') as type,
  sm.exchange,
  lp.price
FROM positions p
LEFT JOIN securities_metadata sm ON p.metadata_symbol = sm.symbol
LEFT JOIN latest_prices lp ON p.symbol = lp.ticker
WHERE p.account_id = ?
```

**Result:**
```
symbol        display_name                    type        price
----------    ----------------------------    ---------   ------
AAPL          Apple Inc.                      EQUITY      150.00
NVDA          NVIDIA Corporation              EQUITY      875.50
PRIVATE-CO    PRIVATE-CO                      Unknown     NULL
```

---

## Performance Considerations

### Autocomplete
- **Debounce:** 300ms delay before API call
- **Limit:** 20 results max
- **Cache:** Results cached in frontend for 5 minutes

### Prefetch
- **Timeout:** 5 seconds max (Yahoo API usually responds in 1-2s)
- **Fallback:** If timeout, allow position creation without metadata
- **Retry:** Don't retry on failure, user can manually refresh later

### Batch Prefetch
- **Rate Limiting:** 500ms delay between symbols
- **Progress:** Show progress bar (e.g., "Fetching 15/30...")
- **Partial Success:** Continue even if some symbols fail

---

## Error Handling

### Symbol Not Found
```javascript
if (response.status === 404) {
  showWarning('Symbol not found in Yahoo Finance. Position will be created without enriched metadata.');
  // Allow user to continue
}
```

### Network Error
```javascript
try {
  await fetch('/api/metadata/prefetch', ...);
} catch (error) {
  showError('Network error. Position will be created without metadata.');
  // Fallback: create position anyway
}
```

### Timeout
```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
  await fetch('/api/metadata/prefetch', {
    signal: controller.signal,
    ...
  });
} catch (error) {
  if (error.name === 'AbortError') {
    showWarning('Metadata fetch timed out. Continuing without metadata.');
  }
}
```

---

## Testing

### Test Symbol Lookup
```bash
curl http://localhost:3000/api/metadata/lookup/AAPL
```

### Test Prefetch
```bash
curl -X POST http://localhost:3000/api/metadata/prefetch \
  -H "Content-Type: application/json" \
  -d '{"symbol":"NVDA"}'
```

### Test Batch Prefetch
```bash
curl -X POST http://localhost:3000/api/metadata/batch-prefetch \
  -H "Content-Type: application/json" \
  -d '{"symbols":["AAPL","NVDA","TSLA"]}'
```

---

## Maintenance

### Daily Health Check
```javascript
// Run daily to find positions without metadata
const res = await fetch('/api/metadata/check-missing');
const data = await res.json();

if (data.count > 0) {
  console.log(`${data.count} positions missing metadata:`, data.symbols);
  // Optionally trigger batch prefetch
}
```

### Manual Refresh
```javascript
// Allow users to manually refresh metadata for a position
async function refreshMetadata(symbol) {
  await fetch('/api/metadata/prefetch', {
    method: 'POST',
    body: JSON.stringify({ symbol })
  });
  reloadPosition(symbol);
}
```
