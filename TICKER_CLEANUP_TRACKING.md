# Ticker Standardization - Cleanup Tracking

## One-Time Scripts to Remove After Completion

These scripts are only needed during the migration phase and should be deleted once Phase 11 (completion) is done.

### Migration Infrastructure (Phase 2)
- [ ] `scripts/migrations/execute-migration-ticker.js` - Migration executor
- [ ] `scripts/migrations/execute-migration-ticker.sql` - Actually keep this? Or consolidate
- [ ] `scripts/backfill_ticker_terminology.js` - Backfill utility
- [ ] `scripts/migrations/012_rename_symbol_to_ticker.sql` - SQL migration (keep for reference/audit trail, or delete?)

### Phase 2 npm Scripts to Remove from package.json
- [ ] `migrate:execute` 
- [ ] `migrate:execute:verify-only`
- [ ] `migrate:rollback`
- [ ] `migrate:backfill`

### Test Files (Decide Per-Test)
- [ ] `tests/integration/migration/pre-migration-validation.test.js` - ONE-TIME (can delete after successful migration)
- [ ] `tests/integration/migration/migration-execution.test.js` - ONE-TIME (can delete after successful migration)
- [ ] `tests/integration/migration/post-migration-validation.test.js` - ONE-TIME (can delete after successful migration)
- [ ] `tests/integration/migration/performance-validation.test.js` - ONE-TIME (can delete after successful migration)

### GitHub Actions Workflows (Decide Per-Workflow)
- [ ] `.github/workflows/migration-validation.yml` - Can delete after migration completes
- [ ] May keep other workflows for future migrations

### Backup Files (Auto-Delete After Verification)
- [ ] `backup/migration_*.sql` - Delete after successful migration verified in production

---

## Cleanup Checklist

**Phase 11: Final Cleanup (Before Merging to Main)**

1. **Verify migration successful in production**
   - [ ] All tickers populated
   - [ ] No NULL values in ticker columns
   - [ ] Relationships intact
   - [ ] Performance validated

2. **Remove one-time scripts**
   - [ ] Delete migration executor script
   - [ ] Delete backfill script
   - [ ] Remove migration npm scripts from package.json
   - [ ] Delete migration test files
   - [ ] Delete migration-specific workflows

3. **Clean up documentation**
   - [ ] Remove this cleanup tracking file (or mark as completed)
   - [ ] Update TICKER_STANDARDIZATION_PLAN.md to reflect completion
   - [ ] Archive migration reports

4. **Final verification**
   - [ ] All code uses `ticker` consistently
   - [ ] No references to old migration scripts
   - [ ] Test suite runs cleanly
   - [ ] CI/CD pipeline updated to remove migration checks

---

## Notes

- Keep `scripts/migrations/012_rename_symbol_to_ticker.sql` for audit trail? (Recommend: DELETE)
- Rollback procedures: Document in case we need to reference them later
- Test files: Decide if worth keeping as regression tests (probably not needed)
