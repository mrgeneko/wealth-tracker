/**
 * SCENARIO: Adding Treasury Bond "91282CGE5" via "+" Button
 * 
 * BEFORE FIX:
 * 1. User clicks "+" button for "91282CGE5"
 * 2. Modal opens with hardcoded type: 'stock'
 * 3. posType hidden field has value='stock'
 * 4. User changes quantity to 100000, clicks Save
 * 5. Backend receives {ticker: '91282CGE5', type: 'stock', quantity: 100000}
 * 6. Position saved to database with WRONG type='stock'
 * 7. Bond displays and behaves as a stock (wrong pricing, formatting, etc)
 * 
 * AFTER FIX:
 * 1. User clicks "+" button for "91282CGE5"
 * 2. onclick="openPositionModalWithBondCheck({symbol:'91282CGE5', type:'stock', ...})"
 * 3. openPositionModalWithBondCheck() checks: if(pos.type !== 'bond')
 * 4. Since type='stock', calls: const isBond = await isBondTicker('91282CGE5')
 * 5. Frontend isBondTicker() calls: fetch('/api/is-bond/91282CGE5')
 * 6. Server /api/is-bond/91282CGE5 calls: isBondTicker('91282CGE5')
 * 7. Server isBondTicker() loads all tickers from ticker_registry
 * 8. Finds ticker obj: {ticker: '91282CGE5', exchange: 'TREASURY', ...}
 * 9. Since exchange === 'TREASURY', returns true
 * 10. API response: {ticker: '91282CGE5', isBond: true}
 * 11. Frontend receives isBond=true
 * 12. Sets pos.type = 'bond'
 * 13. Calls openPositionModal({symbol:'91282CGE5', type:'bond', ...})
 * 14. Modal opens with type='bond' in hidden field
 * 15. posTypeDisplay shows "Bond" (read-only)
 * 16. User changes quantity to 100000, clicks Save
 * 17. Backend receives {ticker: '91282CGE5', type: 'bond', quantity: 100000}
 * 18. Position saved to database with CORRECT type='bond'
 * 19. Bond displays and behaves correctly (bond pricing, formatting, etc)
 * 
 * KEY ADVANTAGES OF THIS APPROACH:
 * ✓ Reuses existing isBondTicker() function from server
 * ✓ Checks against live treasury registry (not hardcoded list)
 * ✓ Works for new bonds not yet in portfolio holdings
 * ✓ Handles both existing bonds (from holdings) and new bonds (from registry)
 * ✓ No code duplication between frontend and backend
 * ✓ Graceful fallback if API is slow/unavailable (uses initial type)
 * ✓ Case-insensitive ticker matching
 * ✓ URL-safe encoding for CUSIP special characters
 */

// VERIFICATION: Check treasury data in positions table
// Run: node query_positions.js (with MYSQL_HOST=localhost)
//
// Expected output shows bonds with correct types:
// ┌────┬──────────────────┬─────────┐
// │ id │ ticker           │ type    │
// ├────┼──────────────────┼─────────┤
// │ 15 │ '91282CGA3'      │ 'bond'  │ ✓ Correct
// │ 16 │ '91282CGE5'      │ 'stock' │ ✗ OLD (should be 'bond')
// │ 17 │ '91282CKS9'      │ 'stock' │ ✗ OLD (should be 'bond')
// │ 18 │ '91282CET4'      │ 'stock' │ ✗ OLD (should be 'bond')
// │ 19 │ 'AAPL'           │ 'stock' │ ✓ Correct
// └────┴──────────────────┴─────────┘
//
// NEW POSITIONS added after fix will have correct type='bond'
// EXISTING POSITIONS (16, 17, 18) need manual correction if needed:
//   UPDATE positions SET type='bond' WHERE ticker IN ('91282CGE5', '91282CKS9', '91282CET4');
