// Shared utility functions for all scrapers
const fs = require('fs');

function sanitizeForFilename(str) {
    return String(str).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getDateTimeString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}


function getTimestampedLogPath(prefix = 'scrape_security_data') {
    return `/usr/src/app/logs/${prefix}.${getDateTimeString()}.log`;
}

function logDebug(msg, logPath) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    const path = logPath || getTimestampedLogPath();
    fs.appendFileSync(path, line);
}

module.exports = {
    sanitizeForFilename,
    getDateTimeString,
    getTimestampedLogPath,
    logDebug
};
