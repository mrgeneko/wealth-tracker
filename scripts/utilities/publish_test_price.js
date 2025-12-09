#!/usr/bin/env node
// scripts/publish_test_price.js
// Publish a single test price message for a position to the configured Kafka topic.

const { publishToKafka } = require('../scrapers/publish_to_kafka');
const dotenv = require('dotenv');

dotenv.config();

async function main() {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
  const topic = process.env.KAFKA_TOPIC || 'price_data';

  // Example: test with GC=F which historically caused issues
  const symbol = 'GC=F';
  const data = {
    // Don't set normalized_key explicitly here to test automatic normalization logic
    symbol: symbol,
    regular_price: 1862.25,
    previous_close_price: 1858.50,
    source: 'test-publisher',
    capture_time: new Date().toISOString()
  };

  console.log('Publishing test message for', symbol, ' -> topic', topic, 'brokers', brokers);
  await publishToKafka(data, topic, brokers);
  console.log('Published test message');
}

main().catch(err => { console.error('Error publishing test price:', err); process.exit(1); });
