// Dashboard Configuration

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9093').split(',');
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'price_data';
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || 'dashboard-group';

module.exports = {
    KAFKA_BROKERS,
    KAFKA_TOPIC,
    KAFKA_GROUP_ID
};
