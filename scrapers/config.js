// Scraper Configuration

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9093').split(',');
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'price_data';
const { normalizedKey } = require('./scraper_utils');
// Provide a small example normalized key (non-critical) so this module
// contains an explicit call to the helper for quick verification.
const SAMPLE_NORMALIZED_KEY = normalizedKey('GC=F');

module.exports = {
    KAFKA_BROKERS,
    KAFKA_TOPIC
    , normalizedKey
    , SAMPLE_NORMALIZED_KEY
};
