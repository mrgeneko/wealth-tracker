
const { Kafka } = require('kafkajs');
const { logDebug } = require('./scraper_utils');

// Usage: publishToKafka({ key: 'AAPL', last_price: 123 }, 'my-topic', ['localhost:9094'])
async function publishToKafka(data, topic, brokers) {
  const kafka = new Kafka({ brokers });
  const producer = kafka.producer();
  await producer.connect();
  try {
    // Determine the message key (priority: normalized_key -> key -> symbol)
    let msgKey = undefined;
    if (data && data.normalized_key) msgKey = String(data.normalized_key);
    else if (data && data.key) msgKey = String(data.key);
    else if (data && data.symbol) msgKey = encodeURIComponent(String(data.symbol));

    // Safety guard: don't publish messages that still contain the placeholder
    // normalized_key 'temp'. This can happen when older in-memory code is still
    // running after an on-disk update; refuse to publish to avoid polluting
    // Kafka topic with an ambiguous key.
    if (msgKey === 'temp') {
      const blockMsg = `Blocking publish: message key is reserved placeholder 'temp' - not sending to Kafka (${topic})`;
      console.error(blockMsg);
      logDebug(blockMsg);
      return; // skip publishing
    }
    // Ensure we send a deterministic, reversible message key.
    // msgKey is already computed above.

    const message = { value: JSON.stringify(data) };
    if (msgKey) message.key = msgKey;

    await producer.send({ topic, messages: [ message ] });
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
