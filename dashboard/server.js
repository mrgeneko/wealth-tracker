const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Kafka } = require('kafkajs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3001;
// Path to assets file - adjust relative to where you run the script
const ASSETS_FILE = path.join(__dirname, '../assets_liabilities.json');

// Kafka Configuration
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'price_data';
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || 'dashboard-group';

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory cache for latest prices: { "AAPL": { price: 150.00, currency: "USD", time: "..." } }
const priceCache = {};
let assetsCache = null;

function loadAssets() {
    if (fs.existsSync(ASSETS_FILE)) {
        try {
            const data = fs.readFileSync(ASSETS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (JSON.stringify(parsed) !== JSON.stringify(assetsCache)) {
                console.log('Assets updated, broadcasting to clients');
                assetsCache = parsed;
                io.emit('assets_update', assetsCache);
            }
        } catch (e) {
            console.error('Failed to read assets file:', e.message);
        }
    }
}

// Poll assets every 30 seconds
setInterval(loadAssets, 30000);
// Initial load
loadAssets();

// Helper to update cache from price data object
function updatePriceCache(item) {
    if (item.key && item.last_price) {
        // Clean price string (remove $ and commas)
        const priceVal = parseFloat(String(item.last_price).replace(/[$,]/g, ''));
        
        if (!isNaN(priceVal)) {
            priceCache[item.key] = {
                price: priceVal,
                change: item.price_change_decimal,
                change_percent: item.price_change_percent,
                currency: 'USD', // Defaulting to USD as scrapers seem to be US-centric mostly
                time: item.capture_time || new Date().toISOString(),
                source: item.source
            };
            return true;
        }
    }
    return false;
}

// Kafka Consumer Setup
const kafka = new Kafka({
    clientId: 'wealth-tracker-dashboard',
    brokers: KAFKA_BROKERS
});

const consumer = kafka.consumer({ groupId: KAFKA_GROUP_ID });

async function startKafkaConsumer() {
    try {
        console.log(`Connecting to Kafka brokers: ${KAFKA_BROKERS.join(',')}`);
        await consumer.connect();
        console.log('Connected to Kafka');
        
        await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });
        console.log(`Subscribed to topic: ${KAFKA_TOPIC}`);

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const value = message.value.toString();
                    const data = JSON.parse(value);
                    console.log(`Received update for ${data.key}`);
                    
                    if (updatePriceCache(data)) {
                        // Broadcast updated prices to all connected clients
                        io.emit('price_update', priceCache);
                    }
                } catch (err) {
                    console.error('Error processing Kafka message:', err.message);
                }
            },
        });
    } catch (err) {
        console.error('Error starting Kafka consumer:', err);
        // Retry logic could go here
        setTimeout(startKafkaConsumer, 5000);
    }
}

// API to get assets
app.get('/api/assets', (req, res) => {
    if (assetsCache) {
        res.json(assetsCache);
        return;
    }
    if (fs.existsSync(ASSETS_FILE)) {
        try {
            const data = fs.readFileSync(ASSETS_FILE, 'utf8');
            res.json(JSON.parse(data));
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse assets file' });
        }
    } else {
        res.status(404).json({ error: 'Assets file not found' });
    }
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected');
    // Send current prices immediately
    socket.emit('price_update', priceCache);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Start
server.listen(PORT, () => {
    console.log(`Dashboard server running on http://localhost:${PORT}`);
    startKafkaConsumer();
});
