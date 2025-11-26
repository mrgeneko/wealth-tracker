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
            } else {
                console.warn(`Invalid price for ${row.ticker}: ${row.price}`);
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
// Supports extended hours pricing (pre-market, after-hours)
function updatePriceCache(item) {
    if (!item.key) return false;
    
    // Determine the best price to use
    // Prefer extended hours prices during pre/post market
    let price = 0;
    let priceSource = 'regular';
    
    // Helper to check if a time is within regular market hours (Mon-Fri 9:30-16:00 ET)
    const isRegularHours = (dateObj) => {
        try {
            const nyString = dateObj.toLocaleString("en-US", {timeZone: "America/New_York"});
            const nyDate = new Date(nyString);
            const day = nyDate.getDay();
            const hour = nyDate.getHours();
            const minute = nyDate.getMinutes();
            const timeInMinutes = hour * 60 + minute;
            // Mon (1) to Fri (5), 9:30 (570) to 16:00 (960)
            return (day >= 1 && day <= 5) && (timeInMinutes >= 570 && timeInMinutes < 960);
        } catch (e) {
            return false;
        }
    };

    const now = new Date();
    const quoteTime = item.last_price_quote_time ? new Date(item.last_price_quote_time) : null;
    const preferRegular = isRegularHours(now) && quoteTime && isRegularHours(quoteTime);
    let foundPrice = false;

    // If in regular session, try regular price first
    if (preferRegular && item.last_price && parseFloat(String(item.last_price).replace(/[$,]/g, '')) > 0) {
        price = parseFloat(String(item.last_price).replace(/[$,]/g, ''));
        priceSource = 'regular';
        foundPrice = true;
    }

    if (!foundPrice) {
        // Check for pre-market price first
        if (item.pre_market_price && parseFloat(String(item.pre_market_price).replace(/[$,]/g, '')) > 0) {
            price = parseFloat(String(item.pre_market_price).replace(/[$,]/g, ''));
            priceSource = 'pre-market';
        }
        // Then check for after-hours price
        else if (item.after_hours_price && parseFloat(String(item.after_hours_price).replace(/[$,]/g, '')) > 0) {
            price = parseFloat(String(item.after_hours_price).replace(/[$,]/g, ''));
            priceSource = 'after-hours';
        }
        // Then check for extended hours (generic)
        else if (item.extended_hours_price && parseFloat(String(item.extended_hours_price).replace(/[$,]/g, '')) > 0) {
            price = parseFloat(String(item.extended_hours_price).replace(/[$,]/g, ''));
            priceSource = 'extended';
        }
        // Fall back to regular last price
        else if (item.last_price) {
            price = parseFloat(String(item.last_price).replace(/[$,]/g, ''));
            priceSource = 'regular';
        }
    }
    
    if (isNaN(price) || price === 0) return false;
    
    // Determine the best change values based on price source
    let changeDecimal = 0;
    let changePercent = '0%';
    
    if (priceSource === 'pre-market' && item.pre_market_change) {
        changeDecimal = parseFloat(item.pre_market_change) || 0;
        changePercent = item.pre_market_change_percent || '0%';
    } else if (priceSource === 'after-hours' && item.after_hours_change) {
        changeDecimal = parseFloat(item.after_hours_change) || 0;
        changePercent = item.after_hours_change_percent || '0%';
    } else if (priceSource === 'extended' && item.extended_hours_change) {
        changeDecimal = parseFloat(item.extended_hours_change) || 0;
        changePercent = item.extended_hours_change_percent || '0%';
    } else {
        changeDecimal = parseFloat(item.price_change_decimal) || 0;
        changePercent = item.price_change_percent || '0%';
    }
    
    priceCache[item.key] = {
        price: price,
        change: changeDecimal,
        change_percent: changePercent,
        currency: 'USD',
        time: item.capture_time || new Date().toISOString(),
        source: item.source ? `${item.source} (${priceSource})` : priceSource
    };
    
    return true;
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
