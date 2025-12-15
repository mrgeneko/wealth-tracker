# Phase 8 Implementation Plan - Advanced Features & Cleanup

## Overview
Phase 8 adds production-ready features to the wealth-tracker system, including cleanup operations, scheduled refresh, and performance metrics.

## Deliverables

### 1. Cleanup Expired Securities
**Location**: API Endpoint + Dashboard UI
- **Endpoint**: `POST /api/autocomplete/cleanup`
- **Database Operation**: Remove symbols with no metadata and no holdings
- **Parameters**: 
  - `security_type` (optional) - filter by type
  - `days_since_update` (optional) - symbols not updated in X days
- **Response**: Count of cleaned symbols
- **Frontend**: Dashboard button connects to endpoint

### 2. Scheduled Metadata Refresh
**Location**: Dashboard + Backend Scheduler
- **Feature**: Auto-refresh metadata on configurable interval
- **Implementation**:
  - Add refresh interval selector to Settings
  - Background job runs every X hours
  - Calls bulk-refresh endpoint automatically
  - Updates statistics in real-time
- **Configuration**:
  - Default: Every 6 hours
  - Options: 1hr, 3hr, 6hr, 12hr, 24hr, Never
  - Stored in localStorage

### 3. Advanced Statistics Filtering
**Location**: Settings Modal + API
- **Feature**: Filter statistics by security type
- **Types**: STOCK, ETF, BOND, CRYPTO, MUTUAL_FUND, TREASURY
- **Display**: Tabs or dropdown to switch between types
- **Stats per type**:
  - Count total
  - Count with metadata
  - Completion percentage
  - Last updated time

### 4. Performance Metrics Dashboard
**Location**: New Stats Panel
- **Metrics**:
  - Last refresh time
  - Average refresh duration
  - Success rate (X% of symbols updated)
  - API response times
  - Error counts by type
- **Display**: Small chart/gauge showing health

### 5. Cleanup Operations
**Location**: API Endpoint
- **Methods**:
  - `resetAllMetadata()` - Clear all metadata for re-fetch
  - `deleteSymbolsByType()` - Remove symbols by type
  - `archiveOldMetadata()` - Move old metadata to archive table
  - `vacuumDatabase()` - Optimize tables
- **Safety**:
  - Require confirmation in UI
  - Soft deletes with restore option
  - Audit logging

## Testing Strategy

### Unit Tests (Phase 8)
- **Cleanup Endpoint** (8 tests)
  - Delete expired symbols
  - Filter by security type
  - Validate cleanup safety
  - Connection management
  
- **Scheduled Refresh** (6 tests)
  - Schedule creation/update
  - Interval validation
  - Persistence to localStorage
  - Trigger execution
  
- **Advanced Statistics** (6 tests)
  - Filter by type
  - Calculate per-type stats
  - Aggregate results
  - Handle empty results
  
- **Performance Metrics** (4 tests)
  - Track refresh times
  - Calculate success rates
  - Store metrics in DB
  - Retrieve historical data

**Total Phase 8 Tests**: 24 new tests
**Total Suite After Phase 8**: 410 tests

### Manual Testing
- Dashboard functionality for all new features
- API endpoint error handling
- Data consistency after cleanup
- Schedule creation and execution
- Metrics accuracy

## Files to Create/Modify

### New Files
- `api/cleanup.js` (150 lines) - Cleanup endpoints
- `api/scheduler.js` (200 lines) - Scheduled refresh logic
- `tests/unit/api/cleanup.test.js` (200 lines) - Cleanup tests
- `tests/unit/api/scheduler.test.js` (200 lines) - Scheduler tests
- `PHASE_8_COMMIT_MESSAGE.txt` (documentation)
- `PHASE_8_COMPLETE.txt` (completion record)

### Modified Files
- `dashboard/public/index.html` (UI for all features)
- `dashboard/server.js` (Mount new endpoints)
- `services/symbol-registry/metadata_autocomplete_service.js` (New methods)
- `.github/workflows/unit-tests.yml` (Include Phase 8 tests)

## Implementation Order

1. **API Cleanup Endpoint** (Day 1)
   - POST /api/autocomplete/cleanup
   - Database cleanup logic
   - Safety validations
   - Unit tests (8 tests)

2. **Cleanup Dashboard UI** (Day 1)
   - Wire cleanup button to API
   - Confirmation dialog
   - Success/error messages
   - Manual testing

3. **Scheduled Refresh Backend** (Day 2)
   - Background scheduler service
   - Interval configuration
   - Cron job management
   - Unit tests (6 tests)

4. **Scheduled Refresh Dashboard UI** (Day 2)
   - Refresh interval selector
   - Schedule creation/update
   - Display next refresh time
   - Manual testing

5. **Advanced Statistics API** (Day 3)
   - Filter queries by security type
   - Per-type aggregations
   - Response formatting
   - Unit tests (6 tests)

6. **Advanced Statistics UI** (Day 3)
   - Type filter in Settings
   - Display per-type stats
   - Tab/dropdown switching
   - Manual testing

7. **Performance Metrics** (Day 4)
   - Metrics collection
   - Database storage
   - Retrieval and display
   - Unit tests (4 tests)
   - Manual testing

## Success Criteria

✅ All 24 new tests passing
✅ All 386 existing tests still passing (no regressions)
✅ Cleanup operation safely removes expired data
✅ Scheduled refresh works on configured intervals
✅ Statistics filters work correctly by type
✅ Performance metrics display accurately
✅ Dashboard UI fully functional
✅ All error cases handled gracefully
✅ Full documentation provided

## Phase 8 Completion
- Total backend tests: 303 (279 + 24)
- Total workspace tests: 410 (386 + 24)
- No breaking changes
- Backward compatible
- Ready for Phase 9 (if needed)

---

**Status**: Starting Phase 8 ✓
**Start Date**: December 9, 2025
