const { Kafka } = require('kafkajs');

// Usage: publishToKafka({ key: 'AAPL', last_price: 123 }, 'my-topic', ['localhost:9092'])
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
    console.log(`Published to Kafka topic ${topic}:`, data);
  } catch (err) {
    console.error('Kafka publish error:', err);
  } finally {
    await producer.disconnect();
  }
}

module.exports = { publishToKafka };
