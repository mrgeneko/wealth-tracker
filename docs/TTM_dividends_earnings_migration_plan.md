# Migration & Backfill Design: TTM Dividends and Earnings
Status: PROPOSAL (no code changes in this PR)

Purpose

CI: automated integration test workflow

I added a GitHub Actions workflow (`.github/workflows/ttm-integration-tests.yml`) and a helper script `scripts/ci/run_migrations_and_tests.sh` that the CI uses to apply migrations and run the integration tests in a clean test DB. This ensures the TTM migration/backfill/recompute scripts are executed in CI and validates the end-to-end behavior on each PR.
- Make schema and operational improvements to how historical dividends and earnings are stored, deduplicated, and used to compute TTM (Trailing 12 Months) metrics.
- Remove correctness/duplication issues, add audit metadata, and harden TTM computation for accurate yield and P/E calculations.

Scope
- Datamodel changes for `securities_dividends`, `securities_earnings`, and `securities_metadata`.
- Data migration/backfill steps to ensure historical rows are deduplicated and adjusted properly.
- Add indexes and operational procedures for TTM recomputation and validation.
- Tests and rollback strategy to prevent regressions.
High-level goals
1. Ensure event identity is immutable and amounts are mutable (avoid unique key based on amount).
2. Provide source event id / ingestion metadata to dedupe across providers.
3. Record TTM freshness so consumers can detect stale TTM values.
4. Support split-adjustments or otherwise store adjusted dividend amounts for correct per-share TTM.
5. Make TTM EPS calculation robust to irregular reporting cadence (prefer last 4 reported quarters over strict 12-month window for EPS where appropriate).

---

Migration steps (DDL only) — recommended ordering and rationale

1) Add supplemental columns and tables (non-destructive)

- Add `source_event_id`, `source_name`, `ingested_at` to both earnings/dividends so we can identify event provenance and dedupe.
- Add `adjusted_dividend_amount` to `securities_dividends` (nullable) — used to store split-adjusted per-share cash dividend (preferred), leaving `dividend_amount` unchanged.
 - Add `adjusted_dividend_amount` to `securities_dividends` (nullable) — used to store split-adjusted per-share cash dividend (preferred), leaving `dividend_amount` unchanged.
 - Add `adjusted_eps` to `securities_earnings` (nullable) — stores split-adjusted EPS (optional, recommended) so TTM EPS sums are computed on current share basis.
- Add `ttm_last_calculated_at` DATETIME NULL to `securities_metadata`.
- Add `security_splits` table to track corporate splits.

Example SQL (safe, additive):
```sql
ALTER TABLE securities_dividends
  ADD COLUMN source_event_id VARCHAR(255) NULL,
  ADD COLUMN source_name VARCHAR(100) NULL,
  ADD COLUMN ingested_at TIMESTAMP NULL,
  ADD COLUMN adjusted_dividend_amount DECIMAL(12,6) NULL;

ALTER TABLE securities_earnings
  ADD COLUMN source_event_id VARCHAR(255) NULL,
  ADD COLUMN source_name VARCHAR(100) NULL,
  ADD COLUMN ingested_at TIMESTAMP NULL;

ALTER TABLE securities_metadata
  ADD COLUMN ttm_last_calculated_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS security_splits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL,
  split_date DATE NOT NULL,
  split_ratio DECIMAL(16,8) NOT NULL, -- fraction GIGO (0.5 => 2-for-1)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_splits_symbol_date (symbol, split_date)
);
```

Why this order: Additive alterations avoid risk, allow new ingestion code to write provenance, and enable backfill logic to populate `adjusted_dividend_amount` from `security_splits` history.

---

2) Create / update indexes to support TTM queries (fast reads)

- TTM queries are frequently "WHERE symbol = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)". Add composite indexes for those common patterns.

Example:
```sql
CREATE INDEX idx_div_symbol_exdate_status ON securities_dividends(symbol, ex_dividend_date, status);
CREATE INDEX idx_earn_symbol_date_eps ON securities_earnings(symbol, earnings_date, eps_actual);
```

Note: These are additive and low-risk.

---

3) Resolve uniqueness semantics and deduping

- Current unique index on `securities_dividends (symbol, ex_dividend_date, dividend_amount)` is fragile — if amount changes you may insert a duplicate row instead of updating. Step plan:

  A. Add new uniqueness key (temporary) that identifies events by canonical identity: `(symbol, ex_dividend_date, dividend_type, source_event_id)`.
  B. Backfill `source_event_id` (when available) from historical ingestion logs or reconstruct a deterministic event-id (e.g., hash(symbol||ex_date||declaration_date||payment_date)).
  C. Deduplicate: Detect duplicates for the same symbol+ex_date (regardless of amount), choose canonical row (prefer most recent `ingested_at` and/or non-null payment_date and non-null adjusted_amount) and merge; mark older duplicates as `status='duplicate'` or delete after backup.
  D. When deduped, drop old fragile unique index and add new unique constraint: `UNIQUE (symbol, ex_dividend_date, dividend_type)` or include `source_event_id` if desired.

- For earnings: prefer `UNIQUE (symbol, earnings_date)` or `UNIQUE (symbol, fiscal_year, fiscal_quarter)` if fiscal fields are consistently available.

Important note: Do not drop the old index until duplicates are resolved and history backed up. Keep a snapshot of tables before destructive ops.

---

4) Backfill adjusted dividend amounts (split-normalization)

- Approach: If `security_splits` data is available (or can be reconstructed), compute `adjusted_dividend_amount` for historical rows as "dividend_amount * cumulative_adjustment_factor" where the factor is the product of splits that occurred after the dividend ex_date up to now (i.e., express all past dividends in today's share basis). Store the result in `adjusted_dividend_amount`.
- If we cannot reliably supply splits, keep `adjusted_dividend_amount` NULL and avoid automatically using unadjusted dividends for computed per-share yield — surface warning until adjusted amounts are present.

Example backfill logic (conceptual):
1. For each dividend row: compute cumulative_ratio = product of split_ratio values where split_date > ex_date AND split_date <= current_date.
2. adjusted = dividend_amount * cumulative_ratio
3. UPDATE securities_dividends SET adjusted_dividend_amount = adjusted WHERE id = ?

Note: Implementation depends on split semantics in provider data (Yahoo sometimes provides split events via history/chart); prefer deterministic backfill scripts and verify against known samples.

5) Backfill adjusted EPS

- For each earnings row with non-null `eps_actual`, compute cumulative split factor for splits after `earnings_date` up to now and store `adjusted_eps` = `eps_actual * factor`.
- Use the same `security_splits` table and approach as dividend backfill. If `adjusted_eps` cannot be computed due to missing splits, leave it NULL and log the issue.

Example backfill operation (conceptual):
```sql
UPDATE securities_earnings e
JOIN (
  SELECT id, symbol, earnings_date, eps_actual,
         EXP(SUM(LN(split_ratio))) OVER (PARTITION BY symbol ORDER BY split_date RANGE BETWEEN ???) AS factor
  FROM securities_earnings /* note: windowing depends on MySQL version, consider procedural script */
) computed ON e.id = computed.id
SET e.adjusted_eps = e.eps_actual * COALESCE(computed.factor, 1.0)
WHERE e.eps_actual IS NOT NULL;
```

Note: Production-ready backfill should be implemented as a safe Node.js script (sample backfill_adjusted_eps.js included in /scripts) rather than a single SQL statement to avoid complexity with window functions on older MySQL versions.

---

5) Compute TTM values robustly and update metadata

TTM Dividends:
- Use adjusted_cash_amount for computation of cash TTM (if adjusted_dividend_amount non-null)
- Exclude `dividend_type != 'CASH'` unless you intend to include stock/special with special handling
- Include only events with status in ("confirmed", "paid") by default
- Consider using `ex_dividend_date` or `payment_date` for window boundaries depending on business definition

TTM EPS:
- For EPS, prefer summing the last 4 completed reported quarters using `eps_actual` (recommended) rather than naive 365-day windows. This reduces ambiguities if reporting dates shift.
- In practical steps:
  1. Find last four earnings records with non-null eps_actual ordered by `earnings_date` DESC for each symbol
  2. Sum them and use that as `ttm_eps`

Write the TTM values atomically with `ttm_last_calculated_at` and optionally `ttm_source`:
```sql
UPDATE securities_metadata
 SET ttm_dividend_amount = ?, ttm_eps = ?, ttm_last_calculated_at = NOW()
 WHERE symbol = ?;
```

---

Data migration / backfill plan (non-destructive, staged)

Pre-check required: BACKUP or snapshot the DB (logical dump) and verify available disk/backup retention.

Stage 0 — audit (read-only)
- Run discovery queries to estimate duplicates and missing provenance
  - Count duplicates by (symbol, ex_date):
    ```sql
    SELECT symbol, ex_dividend_date, COUNT(*) AS cnt
    FROM securities_dividends
    GROUP BY symbol, ex_dividend_date
    HAVING cnt > 1;
    ```
  - Count earnings records missing fiscal data or eps_actual
    ```sql
    SELECT COUNT(*) FROM securities_earnings WHERE eps_actual IS NULL;
    ```
- Export samples with duplicates for manual review.

Stage 1 — add new columns & indexes (non-destructive)
- Apply the additive DDLs (columns, indexes, splits table).
- Confirm new columns are present and null-initialized.

Stage 2 — ingestion augmentation (non-destructive)
- Update ingestion jobs to write `source_event_id` and `ingested_at` on new rows — allow them to populate going forward only.
- If immediate ingestion changes are not possible now, create a deterministic `source_event_id` during backfill (see next stage).

Stage 3 — dedupe & canonicalize (careful & reversible)
- For each symbol/ex_date group with duplicates:
  1. Identify the canonical row per ordering rules (prefer larger `ingested_at`, non-null `payment_date`, larger `dividend_amount` if `adjusted_dividend_amount` present, or the row with status `paid` over `confirmed`).
  2. For each non-canonical row, either mark `status='duplicate'` and keep for audit, or move it to an archive table `securities_dividends_backup` with a migration timestamp.
- Example canonicalization pseudo-sql:
  ```sql
  CREATE TABLE IF NOT EXISTS securities_dividends_backup AS
    SELECT * FROM securities_dividends WHERE 1=0; -- empty template

  -- For each (symbol,ex_div_date) where duplicates exist
    -- Move older duplicates
  INSERT INTO securities_dividends_backup SELECT * FROM securities_dividends WHERE id IN (select problematic ids...);
  DELETE FROM securities_dividends WHERE id IN (select same ids...);
  ```

Stage 4 — update unique index
- After dedupe, drop the old `unique_dividend` index that depends on `dividend_amount` and recreate a stronger unique key, for example:
  ```sql
  ALTER TABLE securities_dividends
  DROP INDEX unique_dividend,
  ADD UNIQUE KEY unique_dividend_event (symbol, ex_dividend_date, dividend_type, COALESCE(source_event_id, ''));
  ```

Stage 5 — compute adjusted dividends & TTM
- Populate `adjusted_dividend_amount` using `security_splits` multiplied factor or set to `dividend_amount` if no splits are available.
- Perform a job to recompute TTM fields for all `securities_metadata`:
  - For each symbol, compute TTM dividend amount using `adjusted_dividend_amount` (or fallback) with a 12-month window and update `ttm_last_calculated_at`.
  - Compute TTM EPS using the last 4 reported quarters and set `ttm_last_calculated_at` atomically.

Stage 6 — verification and monitoring
- Run validation queries and checks (example SQL in "Verification" section below).
- Set up daily/cron TTM recalculation job and update dashboards to show `ttm_last_calculated_at` or an indicator if value is stale.

---

Verification queries (sanity checks)

- Check TTM update captured recent changes:
```sql
SELECT symbol, ttm_dividend_amount, ttm_eps, ttm_last_calculated_at
FROM securities_metadata
WHERE ttm_last_calculated_at IS NULL OR ttm_last_calculated_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
```

- Compare raw dividend SUM vs adjusted SUM for a symbol in last 12 months:
```sql
SELECT symbol,
  SUM(dividend_amount) AS raw_sum,
  SUM(COALESCE(adjusted_dividend_amount, dividend_amount)) AS adjusted_sum
FROM securities_dividends
WHERE ex_dividend_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND status IN ('confirmed','paid')
 GROUP BY symbol;
```

- Confirm dedupe removed ambiguous duplicates (count should equal distinct event count):
```sql
-- duplicates found previously should now be zero
SELECT symbol, ex_dividend_date, COUNT(*) cnt
FROM securities_dividends
GROUP BY symbol, ex_dividend_date
HAVING COUNT(*) > 1;
```

---

Tests and regression plans (automated + manual)

A. Unit tests (JS/Node) — ingestion/upsert logic
- Test case: estimate -> actual
  - Insert a dividend row with status='estimated' and amount X; then simulate an update with status='confirmed' and amount Y (Y != X). Expect a single DB row updated to show latest amount and status.
- Test case: duplicate detector
  - Create two ingest events with same symbol & ex_date but different amounts and no source_event_id; after dedupe job runs, expect a single canonical row and backup table contains the other.
- Test case: source_event_id dedupe
  - Insert two rows with same source_event_id; expect upsert to match and update the single row.

B. Integration test — TTM calculation
- Setup: create a symbol with 5 dividend rows in last 12 months including one stock dividend and one special cash dividend, plus a stock split event.
- Expected: TTM dividends sum of cash adjusted dividends only (if policy is to exclude stock dividends). If adjusted policy is to include stock as converted cash-equivalent, test that conversion method is applied.

C. Integration test — EPS (last 4 quarters)
- Setup: insert 5 quarterly eps_actual entries, verify TTM picks the latest 4 and sums them.
- Edge: if fewer than 4 quarters exist, TTM EPS should fall back to sum of available quarters and log a warning / set a flag to denote incompleteness.

D. Regression tests (startup & API)
- API tests verifying `ttm_dividend_amount` and `ttm_eps` fields are returned and consistent with DB.
- Dashboard unit/e2e checks to verify calculations for yield and P/E use the new TTM fields and show `ttm_last_calculated_at` in UI hover or tooltip.

E. Performance test
- Create synthetic data for 10,000+ symbols with multi-decade dividend history and run the backfill job to check throughput and database load.

F. Data-migration test harness
- Provide a dry-run mode for migration scripts that produces reports of pending dedupe actions, number of rows to rewrite, and sample rows to be moved to backup table.

---

Rollback & safety

- Always snapshot / dump table(s) before destructive DDL (e.g., drop unique index, delete rows).
- Keep an archive / backup table of any moved or deleted rows (`securities_dividends_backup`), with reason and timestamp.
- Run backfill and recompute in a staging environment first. Confirm dashboards and API are unaffected.
- Rollback plan examples:
  - If new unique constraint conflicts: re-enable old index and restore backed-up rows.
  - If TTM sums look wrong: revert `securities_metadata.ttm_*` from dump and verify backfill script logic.

---

Operational considerations and scheduling

- Prefer to run destructive / dedupe operations during off-peak hours.
- If the dataset is large, perform dedupe in batches and throttle to avoid DB impact.
- Add monitoring for TTM recomputation: how many symbols updated per run, time taken, failure rates.
- Keep ingestion running while migration is in flight and ensure ingestion writes `ingested_at` and `source_event_id` to speed final reconciliation.

---

Open questions / decisions needed

- Should TTM EPS always be computed as latest 4 quarters or allow 12-month rolling window as fallback? (Recommend latest 4 quarters for regular reporting symbols, fallback allowed for irregular issuers.)
- Policy on stock dividends / specials: include them (converted to cash-equivalent) or exclude from yield? (Recommend excluding non-cash dividends from dividend yield by default.)
- Are we going to migrate symbol-based FK to integer `security_id`? (This is higher-impact; consider for later stage.)

---

Appendix: sample verification script checklist
1. Run audit queries (duplicate counts / null rates).
2. Snapshot DB and take full dump.
3. Add columns & indexes in a migrational script (dry-run available).
4. Run dedupe dry-run (generate CSV of rows to be archived).
5. Execute dedupe in batches and validate sample symbols.
6. Update unique indexes.
7. Backfill `adjusted_dividend_amount` using `security_splits`.
8. Recompute TTM for all symbols and update `ttm_last_calculated_at`.
9. Run test-suite (unit + integration + API checks).
10. Push to production and monitor for anomalies.

---

If you'd like, my next steps can be:
- Create the migration SQL files, one by one, with safe backfills & dry-run mode.
- Propose changes to ingestion/upsert code to write `source_event_id` and `ingested_at`.
- Write node unit + integration tests for the scenarios above.

Which of these would you like me to do next?