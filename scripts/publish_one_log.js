#!/usr/bin/env node
// Publish a single JSON log file to Kafka. Usage:
//   node scripts/publish_one_log.js logs/20251206_145646_369.VGT.yahoo.json

const fs = require('fs');
const path = require('path');
const { publishToKafka } = require('../scrapers/publish_to_kafka');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/publish_one_log.js <path-to-log-file>');
    process.exit(2);
  }

  const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(txt);

    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
    const topic = process.env.KAFKA_TOPIC || 'price_data';

    console.log(`Publishing ${path.basename(filePath)} to topic ${topic} @ ${brokers.join(',')}`);
    await publishToKafka(obj, topic, brokers);
    console.log('Published successfully');
  } catch (err) {
    console.error('Error publishing file:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
