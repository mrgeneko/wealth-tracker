#!/usr/bin/env node
// Debug script to check what yahoo-finance2 returns for sector

require('dotenv').config();

async function test() {
    try {
        console.log('Loading yahoo-finance2...');
        const imported = await import('yahoo-finance2');
        const YahooFinance = imported.default;
        console.log('YahooFinance constructor:', typeof YahooFinance);
        
        const yf = new YahooFinance();
        console.log('Instance created. Methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(yf)).slice(0, 10));
        
        console.log('\nFetching AAPL with quoteSummary...');
        const result = await yf.quoteSummary('AAPL', {
            modules: ['assetProfile', 'summaryProfile', 'price']
        });
        
        console.log('\nResponse structure:');
        console.log('Top-level keys:', Object.keys(result));
        
        if (result.assetProfile) {
            console.log('\nassetProfile keys:', Object.keys(result.assetProfile));
            console.log('assetProfile.sector:', result.assetProfile.sector);
        }
        
        if (result.summaryProfile) {
            console.log('\nsummaryProfile keys:', Object.keys(result.summaryProfile));
            console.log('summaryProfile.sector:', result.summaryProfile.sector);
        }
        
        if (result.price) {
            console.log('\nprice.sector:', result.price.sector);
        }
        
    } catch (err) {
        console.error('Error:', err.message);
        console.error(err.stack);
    }
}

test();
