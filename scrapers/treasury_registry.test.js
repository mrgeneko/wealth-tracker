const { isTreasury, reloadTreasuryData, loadTreasuryData } = require('./treasury_registry');
const path = require('path');
const fs = require('fs');

const CONFIG_DIR = path.join(__dirname, '../config');
const TREASURY_FILE = path.join(CONFIG_DIR, 'us-treasury-auctions.csv');

describe('treasury_registry', () => {
    beforeAll(() => {
        // Optionally, reload cache before tests
        reloadTreasuryData();
    });

    test('should load treasury data and find known CUSIP', () => {
        if (!fs.existsSync(TREASURY_FILE)) {
            console.warn('Treasury CSV file not found, skipping test.');
            return;
        }
        const data = loadTreasuryData();
        expect(data.size).toBeGreaterThan(0);
        // Pick a CUSIP from the file for testing
        const content = fs.readFileSync(TREASURY_FILE, 'utf8');
        const lines = content.split('\n');
        if (lines.length < 2) {
            console.warn('Treasury CSV file has no data rows, skipping test.');
            return;
        }
        const header = lines[0].split(',');
        const cusipIdx = header.findIndex(h => h.toLowerCase().includes('cusip'));
        if (cusipIdx < 0) {
            console.warn('No CUSIP column found, skipping test.');
            return;
        }
        const firstCusip = lines[1].split(',')[cusipIdx].replace(/"/g, '').trim();
        expect(isTreasury(firstCusip)).toBe(true);
    });

    test('should return false for random non-treasury CUSIP', () => {
        expect(isTreasury('FAKECUSIP')).toBe(false);
        expect(isTreasury('')).toBe(false);
        expect(isTreasury(null)).toBe(false);
    });
});
