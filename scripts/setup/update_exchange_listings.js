const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const CONFIG_DIR = path.join(__dirname, '../config');
const NASDAQ_FILE = path.join(CONFIG_DIR, 'nasdaq-listed.csv');
const NYSE_FILE = path.join(CONFIG_DIR, 'nyse-listed.csv');
const OTHER_LISTED_FILE = path.join(CONFIG_DIR, 'other-listed.csv');

const REPOS = {
    NASDAQ: {
        url: 'https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed.csv',
        file: NASDAQ_FILE,
        repo: 'https://github.com/datasets/nasdaq-listings'
    },
    NYSE: {
        url: 'https://raw.githubusercontent.com/datasets/nyse-other-listings/main/data/nyse-listed.csv',
        file: NYSE_FILE,
        repo: 'https://github.com/datasets/nyse-other-listings'
    },
    OTHER_LISTED: {
        url: 'https://raw.githubusercontent.com/datasets/nyse-other-listings/main/data/other-listed.csv',
        file: OTHER_LISTED_FILE,
        repo: 'https://github.com/datasets/nyse-other-listings'
    }
};

/**
 * Downloads content from a URL
 * @param {string} url - The URL to download from
 * @returns {Promise<string>} - The downloaded content
 */
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download file. Status code: ${response.statusCode}`));
                return;
            }

            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                resolve(data);
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * Gets the last commit date for a file in a GitHub repository
 * @param {string} repo - GitHub repository URL
 * @param {string} filePath - Path to the file in the repository
 * @returns {Promise<string>} - Last commit date
 */
async function getLastCommitDate(repo, filePath) {
    const apiUrl = `${repo}/blob/main/${filePath}`;
    try {
        // This is a simplified approach - in a real implementation, you might want to use the GitHub API
        const content = await downloadFile(apiUrl);
        // Extract date from page content (this is a simplified approach)
        const dateMatch = content.match(/datetime="([^"]+)"/);
        return dateMatch ? dateMatch[1] : null;
    } catch (error) {
        console.log(`Could not get last commit date: ${error.message}`);
        return null;
    }
}

/**
 * Checks if a file needs to be updated by comparing line counts and file sizes
 * @param {string} localFile - Path to local file
 * @param {string} remoteContent - Remote file content
 * @returns {boolean} - True if update is needed
 */
function needsUpdate(localFile, remoteContent) {
    if (!fs.existsSync(localFile)) {
        return true;
    }

    const localContent = fs.readFileSync(localFile, 'utf8');
    const localLines = localContent.split('\n').length;
    const remoteLines = remoteContent.split('\n').length;
    
    const localSize = Buffer.byteLength(localContent, 'utf8');
    const remoteSize = Buffer.byteLength(remoteContent, 'utf8');

    // Check if file size is significantly smaller (more than 1% reduction)
    const sizeRatio = remoteSize / localSize;
    if (sizeRatio < 0.99) {
        console.log(`Warning: Remote file is ${Math.round((1 - sizeRatio) * 100)}% smaller than local file. Skipping update.`);
        console.log(`  Local size: ${localSize} bytes`);
        console.log(`  Remote size: ${remoteSize} bytes`);
        return false;
    }

    // Check if line count is significantly different
    const lineRatio = remoteLines / localLines;
    if (lineRatio < 0.95 || lineRatio > 1.05) {
        console.log(`Warning: Remote file has ${Math.round(Math.abs(lineRatio - 1) * 100)}% different line count. Manual review recommended.`);
        console.log(`  Local lines: ${localLines}`);
        console.log(`  Remote lines: ${remoteLines}`);
    }

    return localLines !== remoteLines;
}

/**
 * Downloads and updates exchange data files
 */
async function updateExchangeData() {
    console.log('Checking for exchange data updates...\n');

    for (const [exchange, config] of Object.entries(REPOS)) {
        try {
            console.log(`Checking ${exchange} data...`);
            
            // Get current file info
            const exists = fs.existsSync(config.file);
            const currentSize = exists ? fs.statSync(config.file).size : 0;
            
            // Download remote content
            console.log(`Downloading from: ${config.url}`);
            const remoteContent = await downloadFile(config.url);
            
            // Check if update is needed
            if (needsUpdate(config.file, remoteContent)) {
                console.log(`Update needed for ${exchange} data`);
                
                // Backup existing file if it exists
                if (exists) {
                    const backupFile = config.file + '.backup.' + Date.now();
                    fs.copyFileSync(config.file, backupFile);
                    console.log(`Backed up existing file to: ${backupFile}`);
                }
                
                // Write new content
                fs.writeFileSync(config.file, remoteContent, 'utf8');
                
                const newSize = remoteContent.length;
                console.log(`${exchange} data updated successfully!`);
                console.log(`  Size: ${currentSize} → ${newSize} bytes`);
                console.log(`  Lines: ${remoteContent.split('\n').length - 1} (excluding header)`);
                
            } else {
                console.log(`${exchange} data is up to date`);
                console.log(`  Size: ${currentSize} bytes`);
                console.log(`  Lines: ${remoteContent.split('\n').length - 1} (excluding header)`);
            }
            
            console.log(''); // Empty line for readability
            
        } catch (error) {
            console.error(`Error updating ${exchange} data: ${error.message}`);
            console.log('');
        }
    }

    console.log('Update check completed!');
    console.log('\nTo manually update the exchange data, run this script periodically.');
    console.log('You can also set up a cron job or schedule to run it automatically.');
}

/**
 * Gets information about current exchange data files
 */
function getCurrentFileInfo() {
    console.log('Current exchange data files:\n');

    for (const [exchange, config] of Object.entries(REPOS)) {
        const file = config.file;
        if (fs.existsSync(file)) {
            const stats = fs.statSync(file);
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n').length - 1; // Exclude header
            
            console.log(`${exchange}:`);
            console.log(`  File: ${file}`);
            console.log(`  Size: ${stats.size} bytes`);
            console.log(`  Lines: ${lines}`);
            console.log(`  Modified: ${stats.mtime.toISOString()}`);
            console.log(`  Repository: ${config.repo}`);
            console.log('');
        } else {
            console.log(`${exchange}: File not found at ${file}`);
            console.log('');
        }
    }
}

// Command line interface
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'update':
            updateExchangeData();
            break;
        case 'info':
            getCurrentFileInfo();
            break;
        case 'help':
        default:
            console.log('Exchange Data Update Script');
            console.log('');
            console.log('Usage:');
            console.log('  node update_exchange_listings.js update    - Check for and apply updates');
            console.log('  node update_exchange_listings.js info     - Show current file information');
            console.log('  node update_exchange_listings.js help     - Show this help message');
            console.log('');
            console.log('This script checks for updates to NASDAQ and NYSE listing data');
            console.log('from the official GitHub repositories and updates local files.');
            break;
    }
}

module.exports = {
    updateExchangeData,
    getCurrentFileInfo,
    downloadFile,
    needsUpdate
};
