const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const { Kafka } = require('kafkajs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const mysql = require('mysql2/promise');
const basicAuth = require('express-basic-auth');

const app = express();

// Load SSL Certificates if available
const keyPath = path.join(__dirname, 'certs', 'server.key');
const certPath = path.join(__dirname, 'certs', 'server.crt');
let server;
let protocol = 'http';

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    try {
        const privateKey = fs.readFileSync(keyPath, 'utf8');
        const certificate = fs.readFileSync(certPath, 'utf8');
        const credentials = { key: privateKey, cert: certificate };
        server = https.createServer(credentials, app);
        protocol = 'https';
        console.log('SSL certificates found. Starting HTTPS server.');
    } catch (e) {
        console.error('Error loading SSL certificates:', e);
        console.log('Falling back to HTTP.');
        server = http.createServer(app);
    }
} else {
    console.log('SSL certificates not found. Starting HTTP server.');
    server = http.createServer(app);
}
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

app.use(cors());
app.use(express.json());

// Kafka Configuration
// Kafka Configuration
const config = require('./config');
const KAFKA_BROKERS = config.KAFKA_BROKERS;
const KAFKA_TOPIC = config.KAFKA_TOPIC;
const KAFKA_GROUP_ID = config.KAFKA_GROUP_ID;

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
    let retries = 5;
    while (retries > 0) {
        try {
            console.log(`Connecting to MySQL at ${MYSQL_HOST}:${MYSQL_PORT} (Attempt ${6 - retries}/5)...`);
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
                        previous_close_price: row.previous_close_price ? parseFloat(row.previous_close_price) : null,
                        currency: 'USD',
                        time: row.capture_time,
                        source: row.source
                    };
                } else {
                    console.warn(`Invalid price for ${row.ticker}: ${row.price}`);
                }
            });

            await connection.end();
            return; // Success
        } catch (err) {
            console.error(`Error fetching initial prices from MySQL: ${err.message}`);
            retries--;
            if (retries > 0) {
                console.log('Retrying in 5 seconds...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    console.error('Failed to fetch initial prices after multiple attempts. Continuing with empty cache.');
}

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function fetchAssetsFromDB() {
    try {
        const [accounts] = await pool.query('SELECT * FROM accounts ORDER BY display_order');
        const [positions] = await pool.query('SELECT * FROM positions');
        const [fixedAssets] = await pool.query('SELECT * FROM fixed_assets ORDER BY display_order');

        const result = {
            real_estate: [],
            vehicles: [],
            accounts: []
        };

        // Process Fixed Assets
        for (const asset of fixedAssets) {
            const item = {
                id: asset.id,
                description: asset.name,
                value: parseFloat(asset.value),
                currency: asset.currency
            };
            if (asset.type === 'real_estate') {
                result.real_estate.push(item);
            } else if (asset.type === 'vehicle') {
                result.vehicles.push(item);
            }
        }

        // Process Accounts
        for (const acc of accounts) {
            const accountObj = {
                id: acc.id,
                name: acc.name,
                type: acc.type,
                category: acc.category,
                holdings: {
                    cash: null,
                    stocks: [],
                    bonds: []
                }
            };

            const accPositions = positions.filter(p => p.account_id === acc.id);

            for (const pos of accPositions) {
                if (pos.type === 'cash') {
                    accountObj.holdings.cash = {
                        id: pos.id,
                        value: parseFloat(pos.quantity),
                        currency: pos.currency
                    };
                } else if (pos.type === 'bond') {
                    accountObj.holdings.bonds.push({
                        id: pos.id,
                        symbol: pos.symbol,
                        quantity: parseFloat(pos.quantity)
                    });
                } else {
                    // Stocks, ETFs, Crypto, etc.
                    accountObj.holdings.stocks.push({
                        id: pos.id,
                        symbol: pos.symbol,
                        quantity: parseFloat(pos.quantity)
                    });
                }
            }

            result.accounts.push(accountObj);
        }

        return result;

    } catch (err) {
        console.error('Error fetching assets from DB:', err);
        return null;
    }
}

async function loadAssets() {
    const data = await fetchAssetsFromDB();
    if (data) {
        if (JSON.stringify(data) !== JSON.stringify(assetsCache)) {
            console.log('Assets updated from DB, broadcasting to clients');
            assetsCache = data;
            io.emit('assets_update', assetsCache);
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
            const nyString = dateObj.toLocaleString("en-US", { timeZone: "America/New_York" });
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
    const quoteTime = item.regular_quote_time ? new Date(item.regular_quote_time) : null;
    const preferRegular = isRegularHours(now) && quoteTime && isRegularHours(quoteTime);
    let foundPrice = false;

    // If in regular session, try regular price first
    if (preferRegular && item.regular_last_price && parseFloat(String(item.regular_last_price).replace(/[$,]/g, '')) > 0) {
        price = parseFloat(String(item.regular_last_price).replace(/[$,]/g, ''));
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
        else if (item.regular_last_price) {
            price = parseFloat(String(item.regular_last_price).replace(/[$,]/g, ''));
            priceSource = 'regular';
        }
    }

    if (isNaN(price) || price === 0) return false;

    // Get previous close price
    let previousClosePrice = null;
    if (item.previous_close_price) {
        previousClosePrice = parseFloat(String(item.previous_close_price).replace(/[$,]/g, ''));
        if (isNaN(previousClosePrice)) previousClosePrice = null;
    }

    priceCache[item.key] = {
        price: price,
        previous_close_price: previousClosePrice,
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
app.get('/api/assets', async (req, res) => {
    if (assetsCache) {
        res.json(assetsCache);
        return;
    }
    const data = await fetchAssetsFromDB();
    if (data) {
        assetsCache = data;
        res.json(data);
    } else {
        res.status(500).json({ error: 'Failed to fetch assets' });
    }
});

const LOGS_DIR = '/usr/src/app/logs';

app.get('/api/logs', async (req, res) => {
    try {
        if (!fs.existsSync(LOGS_DIR)) {
            return res.json([]);
        }
        const files = await fs.promises.readdir(LOGS_DIR);
        const fileStats = await Promise.all(files.map(async (file) => {
            const filePath = path.join(LOGS_DIR, file);
            const stats = await fs.promises.stat(filePath);
            return {
                name: file,
                timestamp: stats.mtime,
                size: stats.size
            };
        }));

        // Sort by timestamp descending (most recent first)
        fileStats.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json(fileStats);
    } catch (error) {
        console.error('Error reading logs directory:', error);
        res.status(500).json({ error: 'Failed to list logs' });
    }
});

app.get('/api/logs/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        // Basic security check to prevent directory traversal
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const filePath = path.join(LOGS_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (filename.endsWith('.gz')) {
            res.download(filePath);
        } else {
            res.sendFile(filePath);
        }
    } catch (error) {
        console.error('Error reading log file:', error);
        res.status(500).json({ error: 'Failed to read log file' });
    }
});

// CRUD Endpoints

// Accounts
app.post('/api/accounts', async (req, res) => {
    const { name, type, category, currency, display_order } = req.body;
    try {
        const [result] = await pool.execute(
            'INSERT INTO accounts (name, type, category, currency, display_order) VALUES (?, ?, ?, ?, ?)',
            [name, type, category, currency || 'USD', display_order || 0]
        );
        assetsCache = null;
        loadAssets();
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/accounts/:id', async (req, res) => {
    const { name, type, category, currency, display_order } = req.body;
    try {
        // Build dynamic update query to only update provided fields
        const updates = [];
        const params = [];
        if (name !== undefined) { updates.push('name=?'); params.push(name); }
        if (type !== undefined) { updates.push('type=?'); params.push(type); }
        if (category !== undefined) { updates.push('category=?'); params.push(category); }
        if (currency !== undefined) { updates.push('currency=?'); params.push(currency); }
        if (display_order !== undefined) { updates.push('display_order=?'); params.push(display_order); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(req.params.id);
        await pool.execute(
            `UPDATE accounts SET ${updates.join(', ')} WHERE id=?`,
            params
        );
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/accounts/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM positions WHERE account_id=?', [req.params.id]);
        await pool.execute('DELETE FROM accounts WHERE id=?', [req.params.id]);
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Positions
app.post('/api/positions', async (req, res) => {
    const { account_id, symbol, type, quantity, currency } = req.body;
    try {
        const [result] = await pool.execute(
            'INSERT INTO positions (account_id, symbol, type, quantity, currency) VALUES (?, ?, ?, ?, ?)',
            [account_id, symbol, type, quantity, currency || 'USD']
        );
        assetsCache = null;
        loadAssets();
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/positions/:id', async (req, res) => {
    const { symbol, type, quantity, currency } = req.body;
    try {
        await pool.execute(
            'UPDATE positions SET symbol=?, type=?, quantity=?, currency=? WHERE id=?',
            [symbol, type, quantity, currency || 'USD', req.params.id]
        );
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/positions/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM positions WHERE id=?', [req.params.id]);
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fixed Assets
app.post('/api/fixed_assets', async (req, res) => {
    const { name, type, value, currency, display_order } = req.body;
    try {
        const [result] = await pool.execute(
            'INSERT INTO fixed_assets (name, type, value, currency, display_order) VALUES (?, ?, ?, ?, ?)',
            [name, type, value, currency || 'USD', display_order || 0]
        );
        assetsCache = null;
        loadAssets();
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/fixed_assets/:id', async (req, res) => {
    const { name, type, value, currency, display_order } = req.body;
    try {
        await pool.execute(
            'UPDATE fixed_assets SET name=?, type=?, value=?, currency=?, display_order=? WHERE id=?',
            [name, type, value, currency, display_order, req.params.id]
        );
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/fixed_assets/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM fixed_assets WHERE id=?', [req.params.id]);
        assetsCache = null;
        loadAssets();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
    console.log(`Dashboard server running on ${protocol}://localhost:${PORT}`);
    await fetchInitialPrices();
    startKafkaConsumer();
});
