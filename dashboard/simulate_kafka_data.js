const { Kafka } = require('kafkajs');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'price_data';

const kafka = new Kafka({
    clientId: 'wealth-tracker-simulator',
    brokers: KAFKA_BROKERS
});

const producer = kafka.producer();

// Tickers from your assets_liabilities.json
const TICKERS = [
    'QQQ', 'SCHG', 'VTI', 'BKLC', '91282CGA3', '91282CGE5'
];

// Base prices for simulation (acting as Previous Close)
const PREV_CLOSE = {
    'QQQ': 605.50,
    'SCHG': 32.00,
    'VTI': 328.20,
    'BKLC': 128.10,
    '91282CGA3': 100.012,
    '91282CGE5': 100.012
};

// Current prices (starts at prev close)
const CURRENT_PRICES = { ...PREV_CLOSE };

function getRandomChange() {
    // Random change between -0.5% and +0.5%
    return 1 + (Math.random() * 0.01 - 0.005);
}

async function run() {
    try {
        await producer.connect();
        console.log('Connected to Kafka producer');

        console.log('Starting simulation. Press Ctrl+C to stop.');

        setInterval(async () => {
            const ticker = TICKERS[Math.floor(Math.random() * TICKERS.length)];
            
            // Update price with random walk
            const oldPrice = CURRENT_PRICES[ticker];
            const newPrice = parseFloat((oldPrice * getRandomChange()).toFixed(2));
            CURRENT_PRICES[ticker] = newPrice;

            // Calculate change from Prev Close
            const prevClose = PREV_CLOSE[ticker];
            const change = (newPrice - prevClose).toFixed(2);
            const changePct = ((change / prevClose) * 100).toFixed(2) + '%';

            const message = {
                key: ticker,
                last_price: newPrice,
                price_change_decimal: change,
                price_change_percent: changePct,
                source: 'simulator',
                capture_time: new Date().toISOString()
            };

            try {
                await producer.send({
                    topic: KAFKA_TOPIC,
                    messages: [
                        { value: JSON.stringify(message) }
                    ],
                });
                console.log(`Sent update: ${ticker} = $${newPrice} (Chg: ${change}, ${changePct})`);
            } catch (e) {
                console.error('Error sending message:', e.message);
            }

        }, 2000); // Send an update every 2 seconds

    } catch (e) {
        console.error('Error:', e);
    }
}

run();
