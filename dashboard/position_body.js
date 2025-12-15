'use strict';

function parseFiniteNumber(value) {
  if (value === null || value === undefined) return undefined;
  if (value === '') return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Normalizes request bodies for dashboard position endpoints.
 * Accepts both {ticker} and legacy {symbol} (ticker wins).
 * Ensures quantity is a finite number (0 allowed).
 */
function normalizePositionBody(body) {
  const safeBody = body && typeof body === 'object' ? body : {};
  const ticker = safeBody.ticker ?? safeBody.symbol;
  const quantity = parseFiniteNumber(safeBody.quantity);

  return {
    ...safeBody,
    ticker,
    quantity
  };
}

module.exports = {
  normalizePositionBody,
  parseFiniteNumber
};
