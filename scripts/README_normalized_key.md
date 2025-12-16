Migration and Backfill: Add reversible normalized_key for positions

Goal
- Add a reversible, safe key (percent-encoded) and backfill existing rows.
- Use normalized_key for messaging and internal indexing while keeping symbol as canonical display value.

Files added
- scripts/sql/001_add_positions_normalized_key.sql  (Idempotent SQL to add column + index)
- scripts/backfill_normalized_key.js               (Idempotent Node.js backfill)
- scripts/check_normalized_key.js                  (Verification script)

How it works (recommended flow)
1) Add the column in the DB
   - Run the SQL migration (inside MySQL container or direct DB connection):

```bash
# from host (example using docker container name from compose)
docker compose exec -T mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} ${MYSQL_DATABASE} < scripts/sql/001_add_positions_normalized_key.sql
```

2) Backfill normalized_key for existing positions
   - Ensure your environment variables in `.env` or environment are set: DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT.
   - Run the backfill script (this is idempotent):

```bash
# install deps if needed (use project node environment)
cd /path/to/repo
npm install mysql2 dotenv # if not already installed globally

# run backfill
node scripts/backfill_normalized_key.js
```

3) Verify results
   - Quick verification of counts and mismatches:

```bash
node scripts/check_normalized_key.js
```

4) Update producers & consumers (recommended next changes, not auto-run here)
   - Scraper producers should publish and/or set message.key = encodeURIComponent(symbol) and include symbol in payload. (Example: key = encodeURIComponent('GC=F') -> 'GC%3DF')
   - Server should index priceCache by recv.key (normalized) and preserve recv.symbol for display.
   - UI should prefer the normalized_key for lookups and still show symbol for display.

Notes & safety
- The percent-encoding approach is reversible and avoids collisions that just replacing punctuation with '_' might cause.
- Backfill script is idempotent — re-running is safe.
- If you prefer a different reversible mapping (token-mapping or hex), adapt `encodeURIComponent` usage accordingly.

Next steps you may want me to help with:
- Update scrapers to publish normalized message.key and ensure server consumes normalized key consistently.
- Add a unique constraint on normalized_key (if you want to prevent duplicates) after confirming backfill and uniqueness.
- Small end-to-end test to publish a test Kafka message and confirm server & UI show the updated price for a DB position that stored a raw symbol like 'GC=F'.
