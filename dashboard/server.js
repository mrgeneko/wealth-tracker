const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Kafka } = require('kafkajs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const mysql = require('mysql2/promise');
const basicAuth = require('express-basic-auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3001;
// Path to assets file - adjust relative to where you run the script
const ASSETS_FILE = path.join(__dirname, '../assets_liabilities.json');

// Basic Auth Configuration
const AUTH_USER = process.env.BASIC_AUTH_USER || 'admin';
const AUTH_PASS = process.env.BASIC_AUTH_PASSWORD || 'admin';

// Apply Basic Auth middleware
app.use(basicAuth({
    users: { [AUTH_USER]: AUTH_PASS },
    challenge: true,
    realm: 'Wealth Tracker Dashboard'
}));

// Kafka Configuration
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'price_data';
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || 'dashboard-group';

// MySQL Configuration
const MYSQL_HOST = process.env.MYSQL_HOST || 'mysql';
const MYSQL_PORT = process.env.MYSQL_PORT || 3306;
const MYSQL_USER = process.env.MYSQL_USER || 'test';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'test';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'testdb';

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory cache for latest prices: { "AAPL": { price: 150.00, currency: "USD", time: "..." } }
const priceCache = {};
let assetsCache = null;

async function fetchInitialPrices() {
    try {
        console.log(`Connecting to MySQL at ${MYSQL_HOST}:${MYSQL_PORT}...`);
        const connection = await mysql.createConnection({
            host: MYSQL_HOST,
            port: MYSQL_PORT,
            user: MYSQL_USER,
            password: MYSQL_PASSWORD,
            database: MYSQL_DATABASE
        });

        const [rows] = await connection.execute('SELECT * FROM latest_prices');
        console.log(`Loaded ${rows.length} prices from MySQL`);

        rows.forEach(row => {
            // row.price is likely a string or number depending on driver config, ensure float
            const priceVal = parseFloat(row.price);
            if (!isNaN(priceVal)) {
                priceCache[row.ticker] = {
                    price: priceVal,
                    change: row.change_decimal ? parseFloat(row.change_decimal) : null,
                    change_percent: row.change_percent,
                    currency: 'USD',
                    time: row.capture_time,
                    source: row.source
                };
            }
        });
        
        await connection.end();
    } catch (err) {
        console.error('Error fetching initial prices from MySQL:', err.message);
        // Don't crash, just continue with empty cache
    }
}

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
server.listen(PORT, async () => {
    console.log(`Dashboard server running on http://localhost:${PORT}`);
    await fetchInitialPrices();
    startKafkaConsumer();
});
