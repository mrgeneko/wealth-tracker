# Git Commit Message

## fix: Consolidate Docker container file structure under /app for consistent path resolution

### Problem
When adding symbols from NASDAQ (e.g., AMN, AMZN, BLCN), prices displayed correctly but 
metadata (name, sector, dividend yield) remained empty. The `/api/metadata/prefetch` 
endpoint was failing with "Symbol not found in Yahoo Finance" even though the Yahoo 
Finance API was working correctly.

### Root Cause
The Docker container had an inconsistent file structure:
- `api/` was copied to `/api/` (at root)
- `services/` was copied to `/services/` (at root)  
- `scripts/` was copied to `/app/scripts/`

When `api/metadata.js` tried to execute the populate script using:
```javascript
{ cwd: __dirname + '/..' }  // __dirname = /api, so cwd = /
```

It resolved to `/` (root), but the script was at `/app/scripts/populate/...`, causing the 
script execution to fail silently.

### Solution
**Option A: Consolidated file structure** - All files now live under `/app`:
- `api/` → `/app/api/`
- `services/` → `/app/services/`
- `scripts/` → `/app/scripts/` (unchanged)

This allows consistent path resolution using `path.join(__dirname, '..')` which now 
correctly resolves to `/app` in Docker and the project root in local development.

### Changes

#### 1. dashboard/Dockerfile
```dockerfile
# Before
COPY api/ /api/
COPY services/ /services/

# After  
COPY api/ /app/api/
COPY services/ /app/services/
```

#### 2. dashboard/server.js
Updated all require paths from `../api/` and `../services/` to `./api/` and `./services/`:
- `require('../services/websocket-server')` → `require('./services/websocket-server')`
- `require('../api/metadata')` → `require('./api/metadata')`
- `require('../api/autocomplete')` → `require('./api/autocomplete')`
- `require('../api/cleanup')` → `require('./api/cleanup')`
- `require('../api/statistics')` → `require('./api/statistics')`
- `require('../api/metrics')` → `require('./api/metrics')`
- `require('../services/symbol-registry')` → `require('./services/symbol-registry')`

#### 3. api/metadata.js
Simplified path resolution to use standard `path.join()`:
```javascript
const scriptPath = path.join(__dirname, '..', 'scripts', 'populate', 'populate_securities_metadata.js');
const cwd = path.join(__dirname, '..');
```
Added logging for debugging script execution.

#### 4. tests/unit/dashboard/symbol-registry-init.test.js
Added 3 new tests for path resolution:
- `should resolve script path relative to api directory` - Verifies Docker paths
- `should resolve cwd relative to api directory` - Verifies working directory
- `should work with local development paths` - Verifies local dev compatibility

### Test Results
```
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total (3 new tests added)
```

### Verification
After the fix:
```bash
$ curl -X POST https://localhost:3001/api/metadata/prefetch -d '{"symbol":"AMN"}'
{"cached":false,"metadata":{"symbol":"AMN","short_name":"AMN Healthcare Services Inc","sector":"Healthcare",...}}

$ mysql -e "SELECT symbol, short_name, sector FROM securities_metadata WHERE symbol IN ('AMN','AMZN','BLCN')"
+--------+-----------------------------+-------------------+
| symbol | short_name                  | sector            |
+--------+-----------------------------+-------------------+
| AMN    | AMN Healthcare Services Inc | Healthcare        |
| AMZN   | Amazon.com, Inc.            | Consumer Cyclical |
| BLCN   | Siren Nasdaq NexGen Economy | NULL              |
+--------+-----------------------------+-------------------+
```

### Why This Is Best Practice
1. **Consistency**: All application code lives under a single root (`/app`)
2. **Predictability**: `path.join(__dirname, '..')` always resolves to `/app`
3. **Portability**: Same path logic works in Docker and local development
4. **Maintainability**: No special-case path handling or environment detection needed

---

**Commit command:**
```bash
git add dashboard/Dockerfile dashboard/server.js api/metadata.js \
        tests/unit/dashboard/symbol-registry-init.test.js

git commit -m "fix: Consolidate Docker file structure under /app for metadata prefetch

- Move api/ and services/ from root to /app/api and /app/services in Dockerfile
- Update server.js requires from ../api to ./api and ../services to ./services
- Simplify api/metadata.js path resolution using path.join(__dirname, '..')
- Add 3 unit tests for path resolution in Docker and local environments

Fixes: Metadata (name, sector, yield) not populating for newly added symbols
Root cause: Script path resolution failed due to inconsistent container structure"
```
