const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG_DIR = path.join(__dirname, '../config');
const NASDAQ_URL = 'https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed.csv';
const NYSE_URL = 'https://raw.githubusercontent.com/datasets/nyse-other-listings/main/data/nyse-listed.csv';

const NASDAQ_FILE = path.join(CONFIG_DIR, 'nasdaq-listed.csv');
const NYSE_FILE = path.join(CONFIG_DIR, 'nyse-listed.csv');

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: Status Code ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(dest));
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {}); // Delete the file async
            reject(err);
        });
    });
}

async function updateListings() {
    try {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }

        console.log('Downloading NASDAQ listings...');
        await downloadFile(NASDAQ_URL, NASDAQ_FILE);
        console.log(`Saved to ${NASDAQ_FILE}`);

        console.log('Downloading NYSE listings...');
        await downloadFile(NYSE_URL, NYSE_FILE);
        console.log(`Saved to ${NYSE_FILE}`);

        console.log('Exchange listings updated successfully.');
    } catch (error) {
        console.error('Error updating listings:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    updateListings();
}

module.exports = { updateListings };
