const { execSync } = require('child_process');
const fs = require('fs');

function clean(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[^0-9.\-]/g, '');
}

try {
  const infoRaw = execSync("curl -s -A 'Mozilla/5.0' 'https://api.nasdaq.com/api/quote/QQQ/info?assetclass=etf'");
  const summaryRaw = execSync("curl -s -A 'Mozilla/5.0' 'https://api.nasdaq.com/api/quote/QQQ/summary?assetclass=etf'");
  const info = JSON.parse(infoRaw.toString());
  let summary = {};
  try { summary = JSON.parse(summaryRaw.toString()); } catch (e) {}

  const id = (info && info.data && info.data.symbol) || 'QQQ';
  const primary = (info && info.data && info.data.primaryData) || {};
  const prev = (summary && summary.data && summary.data.summaryData && summary.data.summaryData.PreviousClose && summary.data.summaryData.PreviousClose.value) ? summary.data.summaryData.PreviousClose.value : '';

  const out = {
    key: id,
    last_price: clean(primary.lastSalePrice),
    price_change_decimal: clean(primary.netChange),
    price_change_percent: primary.percentageChange || '',
    previous_close_price: clean(prev),
    after_hours_price: '',
    after_hours_change_decimal: '',
    after_hours_change_percent: '',
    source: 'nasdaq',
    capture_time: new Date().toISOString().replace('T', ' ').replace('Z', ' UTC'),
    quote_time: primary.lastTradeTimestamp || ''
  };

  console.log(JSON.stringify(out, null, 2));

  const pad = (n) => String(n).padStart(2, '0');
  const dt = new Date();
  const fn = dt.getFullYear() + '' + pad(dt.getMonth() + 1) + '' + pad(dt.getDate()) + '_' + pad(dt.getHours()) + '' + pad(dt.getMinutes()) + '' + pad(dt.getSeconds());
  const outPath = '/usr/src/app/logs/' + id + '.nasdaq.' + fn + '.json';
  try {
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log('Wrote', outPath);
  } catch (e) { console.error('Error writing file', e); }

} catch (e) {
  console.error('Error fetching Nasdaq API:', e);
  process.exit(1);
}
