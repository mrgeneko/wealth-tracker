// Accept either a CSV string or an array of structured dividend rows and return
// a normalized array of objects: { ex_dividend_date: 'YYYY-MM-DD', dividend_amount: Number }
function normalizeDividendsInput(input) {
  if (!input) return [];

  // If input is already an array of objects, validate and normalize
  if (Array.isArray(input)) {
    const rows = [];
    for (const item of input) {
      if (!item) continue;
      // support both `{ date, dividend }` as produced by yahoo-finance2.history
      // and `{ ex_dividend_date, dividend_amount }` canonical shape
      const date = item.ex_dividend_date || item.date || item.exDate || null;
      const amt = (item.dividend_amount !== undefined) ? item.dividend_amount : (item.adjDividend !== undefined ? item.adjDividend : (item.dividend !== undefined ? item.dividend : null));
      if (!date || amt === null || amt === undefined) continue;
      const amount = parseFloat(amt);
      if (isNaN(amount) || amount <= 0) continue;
      rows.push({ ex_dividend_date: (new Date(date)).toISOString().slice(0,10), dividend_amount: amount });
    }
    return rows;
  }

  // Otherwise treat input as CSV text and parse the old-fashioned way
  const csvText = String(input);
  const lines = csvText.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];
  const header = lines[0].split(',').map(h=>h.trim());
  const dateIdx = header.indexOf('Date');
  const divIdx = header.indexOf('Dividends');
  if (dateIdx === -1 || divIdx === -1) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const date = cols[dateIdx];
    const val = cols[divIdx];
    if (!date || !val) continue;
    const amount = parseFloat(val);
    if (isNaN(amount) || amount <= 0) continue;
    rows.push({ ex_dividend_date: date, dividend_amount: amount });
  }
  return rows;
}

module.exports = { normalizeDividendsInput };
