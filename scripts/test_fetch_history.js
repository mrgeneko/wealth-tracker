// Simple local test for fetch_history_yahoo helpers (no DB required)
const fs = require('fs');
const { normalizeDividendsInput } = require('./_test_helper_fetch');

// Simulate structured data returned by yahoo-finance2.dividends or history()
const sampleRows = [
	{ date: '2025-11-20', adjDividend: 0.12 },
	{ date: '2025-08-20', dividend: 0.11 },
	{ ex_dividend_date: '2024-12-20', dividend_amount: 0.105 }
];

const rows = normalizeDividendsInput(sampleRows);
console.log('Parsed dividend rows:', rows);
if (rows.length !== 3) process.exit(2);
if (rows[0].dividend_amount <= 0) process.exit(3);
console.log('OK: normalizeDividendsInput basic test');
