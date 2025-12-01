
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ASSETS_FILE = path.join(__dirname, '../config/assets_liabilities.json');

async function migrate() {
    console.log('Starting migration...');

    // Read JSON file
    let assetsData;
    try {
        const rawData = fs.readFileSync(ASSETS_FILE, 'utf8');
        assetsData = JSON.parse(rawData);
        console.log('Loaded assets_liabilities.json');
    } catch (err) {
        console.error('Error reading assets file:', err);
        process.exit(1);
    }

    // Connect to MySQL
    const connection = await mysql.createConnection({
        host: 'localhost', // Assuming running from host machine
        port: 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    console.log('Connected to MySQL');

    try {
        // 1. Create Tables
        console.log('Creating tables...');

        // Accounts Table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS accounts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(50),
                category ENUM('bank', 'investment') NOT NULL,
                display_order INT DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'USD',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Positions Table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS positions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                account_id INT NOT NULL,
                symbol VARCHAR(20),
                description VARCHAR(255),
                quantity DECIMAL(20, 8),
                type ENUM('stock', 'etf', 'bond', 'cash', 'crypto', 'other') NOT NULL,
                exchange VARCHAR(50),
                currency VARCHAR(10) DEFAULT 'USD',
                maturity_date DATE,
                coupon DECIMAL(10, 4),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
        `);

        // Fixed Assets Table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS fixed_assets (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type ENUM('real_estate', 'vehicle', 'other') NOT NULL,
                value DECIMAL(20, 2),
                currency VARCHAR(10) DEFAULT 'USD',
                display_order INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        console.log('Tables created/verified.');

        // 2. Migrate Data

        // Clear existing data to avoid duplicates if run multiple times
        console.log('Clearing existing data...');
        await connection.execute('DELETE FROM positions');
        await connection.execute('DELETE FROM accounts');
        await connection.execute('DELETE FROM fixed_assets');
        console.log('Cleared existing data.');

        // Migrate Fixed Assets (Real Estate)
        if (assetsData.real_estate) {
            for (let i = 0; i < assetsData.real_estate.length; i++) {
                const item = assetsData.real_estate[i];
                await connection.execute(
                    'INSERT INTO fixed_assets (name, type, value, currency, display_order) VALUES (?, ?, ?, ?, ?)',
                    [item.description, 'real_estate', item.value, item.currency || 'USD', i]
                );
            }
            console.log(`Migrated ${assetsData.real_estate.length} real estate items.`);
        }

        // Migrate Fixed Assets (Vehicles)
        if (assetsData.vehicles) {
            for (let i = 0; i < assetsData.vehicles.length; i++) {
                const item = assetsData.vehicles[i];
                await connection.execute(
                    'INSERT INTO fixed_assets (name, type, value, currency, display_order) VALUES (?, ?, ?, ?, ?)',
                    [item.description, 'vehicle', item.value, item.currency || 'USD', i]
                );
            }
            console.log(`Migrated ${assetsData.vehicles.length} vehicles.`);
        }

        // Migrate Accounts
        if (assetsData.accounts) {
            let bankOrder = 0;
            let investOrder = 0;

            for (const acc of assetsData.accounts) {
                // Determine category
                // Logic: if it has stocks or bonds, it's investment. Else if type suggests bank, it's bank.
                let category = 'bank';
                const hasStocks = acc.holdings && acc.holdings.stocks && acc.holdings.stocks.length > 0;
                const hasBonds = acc.holdings && acc.holdings.bonds && acc.holdings.bonds.length > 0;
                
                if (hasStocks || hasBonds || ['individual brokerage', '529c', '401k', 'ira', 'roth ira'].includes(acc.type?.toLowerCase())) {
                    category = 'investment';
                }

                const displayOrder = category === 'bank' ? bankOrder++ : investOrder++;

                const [result] = await connection.execute(
                    'INSERT INTO accounts (name, type, category, display_order, currency) VALUES (?, ?, ?, ?, ?)',
                    [acc.name, acc.type, category, displayOrder, 'USD']
                );
                const accountId = result.insertId;

                // Migrate Holdings
                if (acc.holdings) {
                    // Cash
                    if (acc.holdings.cash) {
                        await connection.execute(
                            'INSERT INTO positions (account_id, symbol, type, quantity, currency) VALUES (?, ?, ?, ?, ?)',
                            [accountId, 'CASH', 'cash', acc.holdings.cash.value, acc.holdings.cash.currency || 'USD']
                        );
                    }

                    // Stocks
                    if (acc.holdings.stocks) {
                        for (const stock of acc.holdings.stocks) {
                            await connection.execute(
                                'INSERT INTO positions (account_id, symbol, type, quantity, currency, exchange) VALUES (?, ?, ?, ?, ?, ?)',
                                [accountId, stock.ticker, 'stock', stock.shares, stock.currency || 'USD', null] // Exchange is null initially
                            );
                        }
                    }

                    // Bonds
                    if (acc.holdings.bonds) {
                        for (const bond of acc.holdings.bonds) {
                            await connection.execute(
                                'INSERT INTO positions (account_id, symbol, type, quantity, currency, maturity_date, coupon) VALUES (?, ?, ?, ?, ?, ?, ?)',
                                [accountId, bond.ticker, 'bond', bond.shares, bond.currency || 'USD', bond.maturity_date, bond.coupon]
                            );
                        }
                    }
                }
            }
            console.log(`Migrated ${assetsData.accounts.length} accounts.`);
        }

        console.log('Migration completed successfully.');

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await connection.end();
    }
}

migrate();
