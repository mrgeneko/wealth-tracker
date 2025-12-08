#!/usr/bin/env node
// scripts/check_scrapers_normalized_key.js
// Quick check: report which scrapers publish/produce `normalized_key` or call normalizedKey

const fs = require('fs');
const path = require('path');

const scrapersDir = path.join(__dirname, '..', 'scrapers');

function scan() {
  const files = fs.readdirSync(scrapersDir).filter(f => f.endsWith('.js'));
  const report = [];
  for (const f of files) {
    const p = path.join(scrapersDir, f);
    const txt = fs.readFileSync(p, 'utf8');
    const hasNormalizedKey = /normalized_key/.test(txt) || /normalizedKey\(/.test(txt);
    report.push({ file: f, hasNormalizedKey });
  }
  return report;
}

function main() {
  const r = scan();
  console.log('Scraper normalized_key scan report:\n');
  let missing = 0;
  for (const item of r) {
    console.log(`${item.hasNormalizedKey ? '✅' : '⚠️ '} ${item.file}`);
    if (!item.hasNormalizedKey) missing++;
  }
  console.log('\nSummary:');
  console.log(`Total scanned: ${r.length}`);
  console.log(`Missing normalized_key: ${missing}`);
  process.exit(missing === 0 ? 0 : 2);
}

main();
