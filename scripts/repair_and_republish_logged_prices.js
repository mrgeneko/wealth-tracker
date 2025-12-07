#!/usr/bin/env node
// Repair saved JSON price files (logs/*.yahoo.json, etc.) where normalized_key=="temp"
// and optionally republish them to Kafka with corrected normalized_key.

const fs = require('fs');
const path = require('path');
const { publishToKafka } = require('../scrapers/publish_to_kafka');
const { normalizedKey } = require('../scrapers/scraper_utils');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const dryRun = process.argv.includes('--dry-run');
// support --no-publish to avoid republishing and only overwrite local files
const noPublish = process.argv.includes('--no-publish');
// Option to force normalized_key to the encoded form if a matching encoded
// value exists elsewhere (useful for sanitized file keys like GC_F -> GC%3DF).
const forceEncode = process.argv.includes('--force-encode');
// support --symbols=SYM1,SYM2 filter list to only process those symbol files
const symbolsArg = process.argv.find(a => a && a.startsWith('--symbols='));
const symbolsFilter = symbolsArg ? symbolsArg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean) : null;

function findLogFiles() {
  const names = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.yahoo.json') || f.endsWith('.json'));
  if (!symbolsFilter || symbolsFilter.length === 0) return names.map(n => path.join(LOG_DIR, n));

  // Filter by filename using a best-effort heuristic: many log files are
  // <timestamp>.<SYMBOL>.<source>.json — check the middle component or filename
  return names.filter(fname => {
    const base = path.basename(fname);
    const parts = base.split('.');
    if (parts.length >= 3) {
      const maybeSymbol = parts[1];
      if (symbolsFilter.includes(maybeSymbol)) return true;
    }
    // fallback: check if any of the symbols appears in the filename
    for (const sym of symbolsFilter) if (base.includes(sym)) return true;
    return false;
  }).map(n => path.join(LOG_DIR, n));
}

async function processFile(p) {
  try {
    const txt = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(txt);
    if (!obj || typeof obj !== 'object') return;
    const key = obj.key || obj.symbol || obj.ticker;
    if (!key) return;
    if (obj.normalized_key && obj.normalized_key !== 'temp' && !forceEncode) {
      console.log(`[SKIP] ${path.basename(p)} already has normalized_key=${obj.normalized_key}`);
      return;
    }
    // Prefer any existing normalized_key value already present for the same
    // sanitized key which looks like a percent-encoded form (e.g., GC%3DF).
    // This handles cases where `key` is a sanitized filename (GC_F) but the
    // canonical symbol used by positions is GC=F, and another file already
    // contains the correct percent-encoded normalized_key.
    const existingNormalized = findExistingNormalizedForKey(key);
    const fixed = existingNormalized || normalizedKey(key);
    console.log(`[FIX] ${path.basename(p)} -> setting normalized_key=${fixed}`);
    obj.normalized_key = fixed;

    if (!dryRun) {
      // always overwrite file with the corrected normalized_key so logs are consistent
      fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
      console.log(`  saved ${path.basename(p)}`);

      if (!noPublish) {
        // Optionally overwrite sanitized normalized_key values with any known
        // encoded form if --force-encode is set and an encoded candidate exists.
        if (forceEncode && obj.normalized_key && !String(obj.normalized_key).includes('%')) {
          const candidate = findExistingNormalizedForKey(key);
          if (candidate && String(candidate).includes('%')) {
            console.log(`  --force-encode: updating ${path.basename(p)} normalized_key ${obj.normalized_key} -> ${candidate}`);
            obj.normalized_key = candidate;
            fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
            console.log(`  saved ${path.basename(p)} (force-encoded)`);
          }
        }
        // republish to Kafka
        const brokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
        const topic = process.env.KAFKA_TOPIC || 'price_data';
        await publishToKafka(obj, topic, brokers);
        console.log(`  republished ${path.basename(p)} to ${topic} @ ${brokers.join(',')}`);
      } else {
        console.log('  skipping republish (--no-publish)');
      }
    }
  } catch (e) {
    console.error(`Error processing ${p}: ${e && e.message ? e.message : e}`);
  }
}

// Search the logs directory for any file whose `key` matches `searchKey` and
// which already has a non-placeholder `normalized_key` (prefer a percent-
// encoded value when possible). Returns the first match or null.
function findExistingNormalizedForKey(searchKey) {
  try {
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.json'));
    for (const fname of files) {
      try {
        const p = path.join(LOG_DIR, fname);
        const txt = fs.readFileSync(p, 'utf8');
        if (!txt) continue;
        const obj = JSON.parse(txt);
        if (!obj || typeof obj !== 'object') continue;
        if (obj.key && String(obj.key) === String(searchKey) && obj.normalized_key && obj.normalized_key !== 'temp') {
          // Prefer percent-encoded values when available (contains %)
          if (String(obj.normalized_key).includes('%')) return obj.normalized_key;
          // Otherwise return (but keep scanning in case we find an encoded form)
          const candidate = obj.normalized_key;
          // look ahead for an encoded form in other files
          const encoded = files.map(f => {
            try { const o = JSON.parse(fs.readFileSync(path.join(LOG_DIR, f), 'utf8')); return (o && o.key === searchKey && o.normalized_key && o.normalized_key.includes('%')) ? o.normalized_key : null; } catch (e) { return null; }
          }).find(Boolean);
          return encoded || candidate;
        }
      } catch (e) { continue; }
    }
  } catch (e) { /* ignore read errors */ }
  return null;
}

async function main() {
  const files = findLogFiles();
  if (!files.length) {
    console.log('No log files found under', LOG_DIR);
    return;
  }
  console.log('Found', files.length, 'files - dryRun=', dryRun);
  for (const f of files) await processFile(f);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
