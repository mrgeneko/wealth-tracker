
const { Kafka } = require('kafkajs');
const { logDebug } = require('./scraper_utils');

// Usage: publishToKafka({ key: 'AAPL', last_price: 123 }, 'my-topic', ['localhost:9094'])
async function publishToKafka(data, topic, brokers) {
  const kafka = new Kafka({ brokers });
  const producer = kafka.producer();
  await producer.connect();
  try {
    await producer.send({
      topic,
      messages: [
        { value: JSON.stringify(data) }
      ]
    });
    const msg = `Published to Kafka topic ${topic}: ${JSON.stringify(data)}`;
    //console.log(msg);
    logDebug(msg);
  } catch (err) {
    const errMsg = `Kafka publish error: ${err}`;
    console.error(errMsg);
    logDebug(errMsg);
  } finally {
    await producer.disconnect();
  }
}

module.exports = { publishToKafka };
