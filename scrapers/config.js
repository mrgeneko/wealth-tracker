// Scraper Configuration

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9093').split(',');
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'price_data';

module.exports = {
    KAFKA_BROKERS,
    KAFKA_TOPIC
};
