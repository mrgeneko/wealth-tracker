/*
 * Test harness for previous_close_price preservation and source-priority merging
 *
 * Purpose:
 *   Simulate updatePriceCache behavior to ensure that when an incoming update
 *   lacks a valid `previous_close_price` (empty string, zero, or invalid), the
 *   system preserves an already-cached previous_close_price instead of
 *   overwriting it with null/0.
 *
 *   Also tests source-priority merging: higher-priority sources (e.g., google)
 *   should be preferred over lower-priority sources (e.g., stocktwits).
 *
 * How to run:
 *   node scripts/test_prev_close_preserve.js
 *
 * Expected behavior:
 *   - If cache contains a prev-close and incoming item has an empty prev-close,
 *     the cached prev-close should be preserved.
 *   - If incoming item has a valid prev-close value, it should replace the cache
 *     only if it has higher or equal source priority.
 *   - Lower-priority sources should not overwrite higher-priority cached values.
 */

// Source priority configuration (mirrors server config)
const sourcePriorityConfig = {
    priority: ['google', 'nasdaq', 'cnbc', 'wsj', 'ycharts', 'marketbeat', 'stockanalysis', 'moomoo', 'robinhood', 'investingcom', 'stockmarketwatch', 'stocktwits'],
    default_weight: 0.5,
    recency_threshold_minutes: 60
};

function getSourcePriorityRank(source) {
    if (!source) return 999;
    const baseSource = source.toLowerCase().split(' ')[0].split('(')[0].trim();
    const idx = sourcePriorityConfig.priority.indexOf(baseSource);
    return idx >= 0 ? idx : 999;
}

function shouldAcceptIncomingPrevClose(incoming, cached) {
    if (!cached || !cached.previous_close_price) return true;
    if (!incoming.previousClosePrice) return false;

    const incomingRank = getSourcePriorityRank(incoming.source);
    const cachedRank = getSourcePriorityRank(cached.prev_close_source);

    if (incomingRank < cachedRank) return true;
    if (incomingRank > cachedRank) {
        const cachedTime = cached.prev_close_time ? new Date(cached.prev_close_time) : null;
        const incomingTime = incoming.time ? new Date(incoming.time) : new Date();
        if (cachedTime && incomingTime) {
            const diffMinutes = (incomingTime - cachedTime) / (1000 * 60);
            if (diffMinutes > sourcePriorityConfig.recency_threshold_minutes) return true;
        }
        return false;
    }
    // Same priority: use recency
    const cachedTime = cached.prev_close_time ? new Date(cached.prev_close_time) : null;
    const incomingTime = incoming.time ? new Date(incoming.time) : new Date();
    return cachedTime && incomingTime && incomingTime > cachedTime;
}
function simulateUpdatePriceCache(priceCache, item) {
    // Reproduction of the updated logic in server.updatePriceCache with source-priority merging
    const key = item.key;

    // Parse incoming prev-close and metadata
    let incomingPrevClosePrice = null;
    let incomingPrevSource = null;
    let incomingPrevTime = null;

    if (item.previous_close_price) {
        const parsed = parseFloat(String(item.previous_close_price).replace(/[$,]/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
            incomingPrevClosePrice = parsed;
            incomingPrevSource = item.previous_close_source || item.source || null;
            incomingPrevTime = item.previous_close_time || item.capture_time || new Date().toISOString();
        }
    }

    priceCache[key] = priceCache[key] || {};
    const cached = priceCache[key];

    // Prepare final values
    let previousClosePrice = null;
    let prevCloseSource = null;
    let prevCloseTime = null;

    // Use source-priority merge logic
    const incomingData = {
        previousClosePrice: incomingPrevClosePrice,
        source: incomingPrevSource,
        time: incomingPrevTime
    };

    if (shouldAcceptIncomingPrevClose(incomingData, cached)) {
        if (incomingPrevClosePrice !== null) {
            previousClosePrice = incomingPrevClosePrice;
            prevCloseSource = incomingPrevSource;
            prevCloseTime = incomingPrevTime;
            if (cached.previous_close_price && cached.previous_close_price !== incomingPrevClosePrice) {
                console.log(`[PrevClose] ${key}: Updated from ${cached.previous_close_price} (${cached.prev_close_source}) to ${previousClosePrice} (${prevCloseSource})`);
            }
        }
    } else {
        if (cached.previous_close_price) {
            previousClosePrice = cached.previous_close_price;
            prevCloseSource = cached.prev_close_source || null;
            prevCloseTime = cached.prev_close_time || null;
            if (incomingPrevClosePrice !== null) {
                console.log(`[PrevClose] ${key}: Rejected ${incomingPrevClosePrice} from ${incomingPrevSource}, keeping ${previousClosePrice} from ${prevCloseSource}`);
            } else {
                console.warn(`Preserving existing previous_close_price for ${key} (incoming update had none)`);
            }
        }
    }

    priceCache[key].previous_close_price = previousClosePrice;
    priceCache[key].prev_close_source = prevCloseSource;
    priceCache[key].prev_close_time = prevCloseTime;
    return priceCache[key];
}

// ========== TESTS ==========
console.log('\n=== Test 1: Preserve cached prev-close when incoming has none ===');
const priceCache1 = {
    'FOO': { previous_close_price: 123.45, prev_close_source: 'google', prev_close_time: '2025-12-04T21:00:00.000Z' }
};
console.log('Before:', priceCache1['FOO']);
const itemNoPrev = { key: 'FOO', price: 125.00, previous_close_price: '', source: 'stocktwits' };
simulateUpdatePriceCache(priceCache1, itemNoPrev);
console.log('After:', priceCache1['FOO']);
console.assert(priceCache1['FOO'].previous_close_price === 123.45, 'Should preserve cached value');
console.assert(priceCache1['FOO'].prev_close_source === 'google', 'Should preserve cached source');

console.log('\n=== Test 2: Accept higher-priority source (google > stocktwits) ===');
const priceCache2 = {
    'BAR': { previous_close_price: 100.00, prev_close_source: 'stocktwits', prev_close_time: '2025-12-04T20:00:00.000Z' }
};
console.log('Before:', priceCache2['BAR']);
const itemHigherPriority = { key: 'BAR', price: 102.00, previous_close_price: '99.50', source: 'google', capture_time: '2025-12-05T10:00:00.000Z' };
simulateUpdatePriceCache(priceCache2, itemHigherPriority);
console.log('After:', priceCache2['BAR']);
console.assert(priceCache2['BAR'].previous_close_price === 99.50, 'Should accept higher-priority source');
console.assert(priceCache2['BAR'].prev_close_source === 'google', 'Source should be google');

console.log('\n=== Test 3: Reject lower-priority source (stocktwits < google) ===');
const priceCache3 = {
    'BAZ': { previous_close_price: 200.00, prev_close_source: 'google', prev_close_time: '2025-12-05T09:00:00.000Z' }
};
console.log('Before:', priceCache3['BAZ']);
const itemLowerPriority = { key: 'BAZ', price: 205.00, previous_close_price: '198.00', source: 'stocktwits', capture_time: '2025-12-05T09:30:00.000Z' };
simulateUpdatePriceCache(priceCache3, itemLowerPriority);
console.log('After:', priceCache3['BAZ']);
console.assert(priceCache3['BAZ'].previous_close_price === 200.00, 'Should reject lower-priority source');
console.assert(priceCache3['BAZ'].prev_close_source === 'google', 'Source should remain google');

console.log('\n=== Test 4: Accept lower-priority if significantly fresher (>60 min) ===');
const priceCache4 = {
    'QUX': { previous_close_price: 50.00, prev_close_source: 'google', prev_close_time: '2025-12-04T10:00:00.000Z' }
};
console.log('Before:', priceCache4['QUX']);
// Incoming is 2 hours later
const itemFresher = { key: 'QUX', price: 52.00, previous_close_price: '49.50', source: 'stocktwits', capture_time: '2025-12-04T12:30:00.000Z' };
simulateUpdatePriceCache(priceCache4, itemFresher);
console.log('After:', priceCache4['QUX']);
console.assert(priceCache4['QUX'].previous_close_price === 49.50, 'Should accept fresher lower-priority source');

console.log('\n=== All tests completed ===');
process.exit(0);
