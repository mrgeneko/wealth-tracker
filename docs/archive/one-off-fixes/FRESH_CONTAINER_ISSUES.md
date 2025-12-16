# Fresh Container Initialization - Potential Issues & Solutions

## Critical Issues

### 1. ⚠️ Missing CSV Files for Symbol Registry
**Severity:** MEDIUM - Symbol registry initialization fails

**Files Required:**
- `config/nasdaq-listed.csv`
- `config/nyse-listed.csv`
- `config/other-listed.csv`
- `config/us-treasury-auctions.csv`
- `config/Auctions_Query_19791115_20251215.csv`

**Problem:**
- All mounted as read-only volumes
- Symbol registry sync fails if files missing
- Dashboard still works but autocomplete is empty
- Scraper metrics show 4 errors

**Current State:**
```
[SymbolRegistrySync] Error syncing NASDAQ: connect ECONNREFUSED
[SymbolRegistrySync] Error syncing NYSE: connect ECONNREFUSED
[SymbolRegistrySync] Error syncing OTHER: connect ECONNREFUSED
[SymbolRegistrySync] Error syncing TREASURY: connect ECONNREFUSED
```

**Status:** ⚠️ NEEDS BETTER ERROR HANDLING

---

### 3. ⚠️ Database Connection Race Condition
**Severity:** MEDIUM - Intermittent failures

**Problem:**
- Dashboard has `depends_on: [kafka, mysql]` but NO healthcheck dependency
- `depends_on` only waits for container to start, NOT for MySQL to be ready
- Dashboard tries to:
  1. Run migrations
  2. Load initial prices from DB
  3. Initialize symbol registry
  4. Connect to Kafka
  5. Start server

All BEFORE MySQL accepts connections

**Current Code:**
```javascript
async function fetchInitialPrices() {
    let retries = 5;
    while (retries > 0) {
        try {
            console.log(`Connecting to MySQL at ${MYSQL_HOST}:${MYSQL_PORT} (Attempt ${6 - retries}/5)...`);
            const connection = await mysql.createConnection({...});
            // ...
        } catch (err) {
            retries--;
            if (retries > 0) {
                console.log('Retrying in 5 seconds...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
}
```

**Status:** ✅ PROTECTED - Has retry logic with 5 attempts

---

### 4. ⚠️ Missing .env File
**Severity:** HIGH - Container doesn't start

**Problem:**
- Required environment variables not set:
  - `MYSQL_ROOT_PASSWORD`
  - `MYSQL_DATABASE`
  - `MYSQL_USER`
  - `MYSQL_PASSWORD`
  - `BASIC_AUTH_USER`
  - `BASIC_AUTH_PASSWORD`

**Error:**
```
ERROR: invalid interpolation format for "environment" option in service "dashboard": "MYSQL_USER: ${MYSQL_USER}"
```

**Current Protection:**
- `.env.example` exists with template values
- No validation

**Status:** ⚠️ NEEDS VALIDATION - Add pre-startup check

---

### 5. ⚠️ Kafka Not Ready
**Severity:** MEDIUM - Delayed startup, no real-time updates

**Problem:**
- Kafka takes time to elect leader
- Dashboard tries to subscribe immediately
- Causes error: `There is no leader for this topic-partition as we are in the middle of a leadership election`

**Current Code:**
```javascript
startKafkaConsumer();
// No error handling, just starts consumer
```

**Status:** ✅ TOLERATED - Kafka eventually comes online, consumer auto-recovers

---

### 6. ⚠️ Port Conflicts
**Severity:** MEDIUM - Startup fails

**Problem:**
- If ports are already in use:
  - 3001 (dashboard)
  - 3306 (MySQL)
  - 9092 (Kafka)
  - 2181 (Zookeeper)

**Error:** `bind: address already in use`

**Current Protection:** NONE

**Status:** ⚠️ NEEDS DOCUMENTATION

---

### 7. ⚠️ File System Permissions
**Severity:** LOW-MEDIUM - Intermittent failures

**Problem:**
- Volume mounts may have permission issues:
  - `./logs:/usr/src/app/logs` - write permission needed
  - `./mysql:/var/lib/mysql` - write permission needed
  - `./config:/app/config:ro` - read permission needed

**Error:**
```
docker: Error response from daemon: driver failed programming external connectivity
permission denied while trying to connect to Docker daemon
```

**Status:** ⚠️ SYSTEM DEPENDENT

---

## Non-Critical Issues

### 8. ℹ️ Metadata Worker Initialization Delay
**Severity:** LOW - Autocomplete delayed

**Problem:**
- Metadata worker starts in separate process (PM2)
- Takes 5-30 seconds to initialize
- During this time, no metadata is available
- Dashboard functions but fields aren't pre-populated

**Status:** ✅ EXPECTED BEHAVIOR

---

### 9. ℹ️ Empty Price Cache on Startup
**Severity:** LOW - Historical data missing

**Problem:**
- `fetchInitialPrices()` loads from DB
- On fresh container, DB is empty (no price history)
- Price cache is empty until first prices arrive via Kafka
- Dashboard shows no values until scraper runs

**Status:** ✅ EXPECTED BEHAVIOR

---

### 10. ℹ️ Scrapers May Not Start
**Severity:** MEDIUM - No new data collected

**Problem:**
- Scraper container starts but daemon may fail:
  - Missing Chrome profile
  - Headless browser initialization
  - Network issues

**Current Logs:**
- Scraper container is up but may not be scraping

**Status:** ⚠️ NEEDS BETTER LOGGING

---

## Summary Table

| Issue | Severity | Status | Action |
|-------|----------|--------|--------|
| Missing CSV files | MEDIUM | ⚠️ Needs handling | Better error messages |
| DB connection race | MEDIUM | ✅ Protected | Has retry logic |
| Missing .env | HIGH | ⚠️ Needs check | Add startup validation |
| Kafka not ready | MEDIUM | ✅ Tolerated | Auto-recovers |
| Port conflicts | MEDIUM | ⚠️ Needs docs | Document in README |
| File permissions | LOW-MEDIUM | ⚠️ System dependent | Case-by-case |
| Metadata delay | LOW | ✅ Expected | Normal behavior |
| Empty price cache | LOW | ✅ Expected | Normal behavior |
| Scraper startup | MEDIUM | ⚠️ Needs logging | Improve diagnostics |

---

## Recommended Fixes

### Priority 1: Add Startup Validation Script

```bash
#!/bin/bash
# scripts/validate-fresh-container.sh

set -e

echo "Validating fresh container setup..."

# Check .env exists
if [ ! -f .env ]; then
    echo "❌ ERROR: .env file not found"
    echo "   Copy from .env.example and configure:"
    echo "   cp .env.example .env"
    exit 1
fi

# Check required files
REQUIRED_FILES=(
    "config/nasdaq-listed.csv"
    "config/nyse-listed.csv"
    "config/other-listed.csv"
    "config/us-treasury-auctions.csv"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "⚠️  WARNING: $file not found"
        echo "    Symbol registry will not initialize"
    fi
done

echo "✅ Validation complete!"
```

### Priority 2: Enhanced Startup Logging

Add to dashboard startup:
```javascript
console.log('[Startup] Environment validation:');
console.log('  MYSQL_HOST:', process.env.MYSQL_HOST);
console.log('  MYSQL_DATABASE:', process.env.MYSQL_DATABASE);
console.log('  Assets file mounted:', fs.existsSync('/assets_liabilities.json'));
console.log('  Config files:');
console.log('    NASDAQ:', process.env.NASDAQ_FILE, fs.existsSync(process.env.NASDAQ_FILE) ? '✓' : '✗');
console.log('    NYSE:', process.env.NYSE_FILE, fs.existsSync(process.env.NYSE_FILE) ? '✓' : '✗');
// etc.
```

### Priority 3: Docker Compose Improvements

Add `service_healthy` healthcheck dependencies:
```yaml
depends_on:
  mysql:
    condition: service_healthy
  kafka:
    condition: service_started
```

---

## Testing Checklist for Fresh Container

- [ ] `.env` file exists with correct values
- [ ] All required CSV files in `config/` directory
- [ ] Ports 3001, 3306, 9092, 2181 are free
- [ ] File permissions allow Docker volume mounts
- [ ] Run: `docker compose down -v && docker compose up`
- [ ] Wait 30 seconds for initialization
- [ ] Check dashboard loads (http://localhost:3001)
- [ ] Verify accounts appear
- [ ] Check logs for errors: `docker compose logs dashboard | grep -i error`
