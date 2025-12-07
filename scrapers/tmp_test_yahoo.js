const s = require('./scrape_yahoo');
(async () => {
  try {
    const { normalizedKey } = require('./scraper_utils');
    const securities = [
      { key: 'AAPL', yahoo: 'AAPL', normalized_key: normalizedKey('AAPL') },
      { key: 'AMZN', yahoo: 'AMZN', normalized_key: normalizedKey('AMZN') }
    ];
    const out = await s.scrapeYahooBatch(null, securities, '/tmp', { chunkSize: 2, delayMs: 5000 });
    console.log('RESULTS', JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('ERROR', e && (e.stack || e.message || e));
    process.exit(1);
  }
})();
