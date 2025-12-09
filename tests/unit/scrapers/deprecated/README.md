# Deprecated Tests

This directory contains old test files that were moved from `scrapers/` directory during the Priority 3 test reorganization (December 8, 2025).

## Files

- `exchange_registry_old.test.js` - Old exchange registry tests (superseded by `../exchange_registry.unit.test.js`)
- `treasury_registry_old.test.js` - Old treasury registry tests

## Why They're Here

These tests were originally in the `scrapers/` directory alongside the source code. During Priority 3, we reorganized tests to:

1. Separate unit tests into `tests/unit/`
2. Keep integration tests in `tests/integration/`
3. Keep scrapers source code in `scrapers/`

## Deprecation Reason

The old tests had issues:
- Relied on module caching behavior that caused test failures
- Used file system mutations that interfered with cache reloading
- Tested implementation details rather than behavior

## Current Tests

The current unit tests are located at:
- `../exchange_registry.unit.test.js` - Comprehensive exchange registry tests
- `../scraper_utils.unit.test.js` - Scraper utilities tests

These new tests are:
- More comprehensive (24 tests vs old tests)
- More reliable (no caching issues)
- Better organized (Jest setup with custom matchers)
- Properly excluded from CI (in deprecated/ directory)

## If You Need These

If you need to reference the old test approaches:
1. Review the files in this directory
2. Copy relevant patterns to new comprehensive tests
3. Do NOT try to run these directly - they will fail due to module path issues

## Future Consideration

These files could be deleted after the new unit tests have been validated in production (suggested: after 1-2 weeks).
