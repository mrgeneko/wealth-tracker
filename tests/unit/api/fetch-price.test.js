// tests/unit/api/fetch-price.test.js
// Unit tests for /api/fetch-price endpoint logic
// Tests: price fetching from Yahoo, cache update, socket.io broadcast, Kafka publishing

describe('Fetch Price API Endpoint', () => {
    let mockIo;
    let mockPriceCache;
    let mockYahooFinance;
    let mockKafkaProducer;
    let fetchPriceHandler;

    beforeEach(() => {
        // Reset mocks
        mockPriceCache = {};
        
        mockIo = {
            emit: jest.fn()
        };

        mockYahooFinance = {
            quote: jest.fn()
        };

        mockKafkaProducer = {
            connect: jest.fn().mockResolvedValue(undefined),
            send: jest.fn().mockResolvedValue(undefined),
            disconnect: jest.fn().mockResolvedValue(undefined)
        };

        // Create the handler that mimics the actual implementation
        fetchPriceHandler = async (symbol) => {
            if (!symbol || !symbol.trim()) {
                return { status: 400, body: { error: 'Symbol is required' } };
            }

            const cleanSymbol = symbol.trim().toUpperCase();

            try {
                // Simulate yahoo-finance2 call
                const quote = await mockYahooFinance.quote(cleanSymbol);

                if (!quote || !quote.regularMarketPrice) {
                    return {
                        status: 404,
                        body: {
                            error: 'No price data returned',
                            symbol: cleanSymbol
                        }
                    };
                }

                const price = quote.regularMarketPrice;
                const previousClose = quote.regularMarketPreviousClose || null;
                const now = new Date().toISOString();

                // Update the in-memory price cache
                mockPriceCache[cleanSymbol] = {
                    price: price,
                    previous_close_price: previousClose,
                    prev_close_source: 'yahoo',
                    prev_close_time: now,
                    currency: quote.currency || 'USD',
                    time: now,
                    source: 'yahoo'
                };

                // Broadcast to all connected clients
                mockIo.emit('price_update', mockPriceCache);

                // Publish to Kafka
                let kafkaPublished = false;
                try {
                    await mockKafkaProducer.connect();
                    await mockKafkaProducer.send({
                        topic: 'price_data',
                        messages: [{
                            key: cleanSymbol,
                            value: JSON.stringify({
                                key: cleanSymbol,
                                symbol: cleanSymbol,
                                normalized_key: cleanSymbol,
                                regular_price: price,
                                previous_close_price: previousClose,
                                currency: quote.currency || 'USD',
                                time: now,
                                source: 'yahoo',
                                scraper: 'dashboard-fetch'
                            })
                        }]
                    });
                    await mockKafkaProducer.disconnect();
                    kafkaPublished = true;
                } catch (kafkaErr) {
                    // Kafka failure shouldn't fail the request
                }

                return {
                    status: 200,
                    body: {
                        symbol: cleanSymbol,
                        price: price,
                        previousClose: previousClose,
                        currency: quote.currency || 'USD',
                        timestamp: now,
                        cached: true,
                        persisted: kafkaPublished
                    }
                };

            } catch (error) {
                return {
                    status: 500,
                    body: {
                        error: error.message,
                        symbol: cleanSymbol
                    }
                };
            }
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/fetch-price', () => {
        it('should return 400 if symbol is missing', async () => {
            const res = await fetchPriceHandler(null);

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Symbol is required');
        });

        it('should return 400 if symbol is empty string', async () => {
            const res = await fetchPriceHandler('   ');

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Symbol is required');
        });

        it('should uppercase the symbol', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                regularMarketPrice: 150.25,
                regularMarketPreviousClose: 149.50,
                currency: 'USD'
            });

            const res = await fetchPriceHandler('aapl');

            expect(res.status).toBe(200);
            expect(res.body.symbol).toBe('AAPL');
            expect(mockYahooFinance.quote).toHaveBeenCalledWith('AAPL');
        });

        it('should return price data from Yahoo Finance', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                regularMarketPrice: 183.78,
                regularMarketPreviousClose: 184.97,
                currency: 'USD'
            });

            const res = await fetchPriceHandler('NVDA');

            expect(res.status).toBe(200);
            expect(res.body.symbol).toBe('NVDA');
            expect(res.body.price).toBe(183.78);
            expect(res.body.previousClose).toBe(184.97);
            expect(res.body.currency).toBe('USD');
            expect(res.body.cached).toBe(true);
        });

        it('should update the price cache', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                regularMarketPrice: 478.56,
                regularMarketPreviousClose: 492.02,
                currency: 'USD'
            });

            await fetchPriceHandler('MSFT');

            expect(mockPriceCache['MSFT']).toBeDefined();
            expect(mockPriceCache['MSFT'].price).toBe(478.56);
            expect(mockPriceCache['MSFT'].previous_close_price).toBe(492.02);
            expect(mockPriceCache['MSFT'].source).toBe('yahoo');
        });

        it('should broadcast price update via socket.io', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                regularMarketPrice: 150.00,
                currency: 'USD'
            });

            await fetchPriceHandler('TEST');

            expect(mockIo.emit).toHaveBeenCalledWith('price_update', mockPriceCache);
        });

        it('should publish to Kafka with correct message format', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                regularMarketPrice: 100.00,
                regularMarketPreviousClose: 99.00,
                currency: 'USD'
            });

            const res = await fetchPriceHandler('TEST');

            expect(res.body.persisted).toBe(true);
            expect(mockKafkaProducer.connect).toHaveBeenCalled();
            expect(mockKafkaProducer.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    topic: 'price_data',
                    messages: expect.arrayContaining([
                        expect.objectContaining({
                            key: 'TEST'
                        })
                    ])
                })
            );
            expect(mockKafkaProducer.disconnect).toHaveBeenCalled();
        });

        it('should include "key" field in Kafka message for consumer compatibility', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                regularMarketPrice: 100.00,
                currency: 'USD'
            });

            await fetchPriceHandler('TEST');

            const sendCall = mockKafkaProducer.send.mock.calls[0][0];
            const messageValue = JSON.parse(sendCall.messages[0].value);
            
            // The Kafka consumer expects 'key' field in the message body
            expect(messageValue.key).toBe('TEST');
            expect(messageValue.symbol).toBe('TEST');
            expect(messageValue.normalized_key).toBe('TEST');
        });

        it('should return 404 if Yahoo returns no price', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                // No regularMarketPrice
                symbol: 'INVALID'
            });

            const res = await fetchPriceHandler('INVALID');

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('No price data returned');
        });

        it('should return 404 if Yahoo returns null', async () => {
            mockYahooFinance.quote.mockResolvedValue(null);

            const res = await fetchPriceHandler('INVALID');

            expect(res.status).toBe(404);
        });

        it('should handle Yahoo Finance errors gracefully', async () => {
            mockYahooFinance.quote.mockRejectedValue(new Error('Yahoo API error'));

            const res = await fetchPriceHandler('ERROR');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Yahoo API error');
            expect(res.body.symbol).toBe('ERROR');
        });

        it('should still return success if Kafka publish fails', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                regularMarketPrice: 100.00,
                currency: 'USD'
            });
            mockKafkaProducer.send.mockRejectedValue(new Error('Kafka error'));

            const res = await fetchPriceHandler('TEST');

            // Should still succeed - Kafka failure is non-blocking
            expect(res.status).toBe(200);
            expect(res.body.price).toBe(100.00);
            expect(res.body.persisted).toBe(false);
        });

        it('should default to USD if currency is not provided', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                regularMarketPrice: 100.00
                // No currency field
            });

            const res = await fetchPriceHandler('TEST');

            expect(res.status).toBe(200);
            expect(res.body.currency).toBe('USD');
        });

        it('should handle null previousClose', async () => {
            mockYahooFinance.quote.mockResolvedValue({
                regularMarketPrice: 100.00,
                regularMarketPreviousClose: null,
                currency: 'USD'
            });

            const res = await fetchPriceHandler('TEST');

            expect(res.status).toBe(200);
            expect(res.body.previousClose).toBeNull();
        });
    });
});

// ========== Bond Detection Tests ==========
describe('Bond Symbol Detection via Treasury Registry', () => {
    // Mock ticker registry data (simulates us-treasury-auctions.csv)
    const mockTickerRegistry = [
        { ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
        { ticker: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ' },
        { ticker: '912810EX2', name: 'Bond 30-Year | Issue: 2024-11-15 | Maturity: 2054-11-15', exchange: 'TREASURY' },
        { ticker: '912797SE8', name: 'Bill 4-Week | Issue: 2025-12-09 | Maturity: 2026-01-06', exchange: 'TREASURY' },
        { ticker: '91282CPM7', name: 'Note 7-Year | Issue: 2025-12-01 | Maturity: 2032-11-30', exchange: 'TREASURY' },
        { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'NYSE ARCA' }
    ];

    // Helper function matching server.js implementation
    function isBondTicker(ticker) {
        if (!ticker) return false;
        const clean = ticker.trim().toUpperCase();
        
        // Look up in ticker registry
        const tickerObj = mockTickerRegistry.find(t => t.ticker === clean);
        
        // If found and exchange is TREASURY, it's a bond
        if (tickerObj && tickerObj.exchange === 'TREASURY') {
            return true;
        }
        
        return false;
    }

    describe('isBondTicker', () => {
        it('should detect treasury bonds from registry (30-Year)', () => {
            expect(isBondTicker('912810EX2')).toBe(true);
        });

        it('should detect treasury bills from registry (4-Week)', () => {
            expect(isBondTicker('912797SE8')).toBe(true);
        });

        it('should detect treasury notes from registry (7-Year)', () => {
            expect(isBondTicker('91282CPM7')).toBe(true);
        });

        it('should be case-insensitive', () => {
            expect(isBondTicker('912810ex2')).toBe(true);
        });

        it('should NOT detect stock symbols as bonds', () => {
            expect(isBondTicker('AAPL')).toBe(false);
            expect(isBondTicker('MSFT')).toBe(false);
        });

        it('should NOT detect ETFs as bonds', () => {
            expect(isBondTicker('SPY')).toBe(false);
        });

        it('should NOT detect unknown 9-char symbols as bonds (not in registry)', () => {
            // Random 9-char string that looks like CUSIP but isn't in treasury file
            expect(isBondTicker('ABCDEF123')).toBe(false);
        });

        it('should handle null/undefined', () => {
            expect(isBondTicker(null)).toBe(false);
            expect(isBondTicker(undefined)).toBe(false);
        });

        it('should handle empty string', () => {
            expect(isBondTicker('')).toBe(false);
            expect(isBondTicker('   ')).toBe(false);
        });
    });
});

// ========== Bond Fetch Handler Tests ==========
describe('Bond Price Fetch Handler (Marker File Trigger)', () => {
    let mockFs;
    let bondFetchHandler;

    // Mock ticker registry (same as detection tests)
    const mockTickerRegistry = [
        { ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
        { ticker: '912810EX2', name: 'Bond 30-Year | Issue: 2024-11-15 | Maturity: 2054-11-15', exchange: 'TREASURY' },
        { ticker: '912797SE8', name: 'Bill 4-Week | Issue: 2025-12-09 | Maturity: 2026-01-06', exchange: 'TREASURY' }
    ];

    // Helper matching server.js implementation - treasury registry lookup only
    function isBondTicker(ticker) {
        if (!ticker) return false;
        const clean = ticker.trim().toUpperCase();
        const tickerObj = mockTickerRegistry.find(t => t.ticker === clean);
        return tickerObj && tickerObj.exchange === 'TREASURY';
    }

    beforeEach(() => {
        mockFs = {
            writeFileSync: jest.fn()
        };

        // Bond handler that mimics the new marker file trigger approach
        bondFetchHandler = async (symbol, type) => {
            if (!symbol || !symbol.trim()) {
                return { status: 400, body: { error: 'Symbol is required' } };
            }

            const cleanSymbol = symbol.trim().toUpperCase();
            
            // Detect bond by type parameter OR treasury registry lookup
            const isBond = type === 'bond' || isBondTicker(cleanSymbol);
            
            if (!isBond) {
                return { status: 400, body: { error: 'Not a bond' } };
            }

            // Trigger scrape daemon by touching marker file
            let triggered = false;
            try {
                mockFs.writeFileSync('/usr/src/app/logs/last.bond_positions.txt', '0\nTriggered by dashboard\n');
                triggered = true;
            } catch (err) {
                triggered = false;
            }

            return {
                status: 200,
                body: {
                    symbol: cleanSymbol,
                    isBond: true,
                    triggered: triggered,
                    message: triggered 
                        ? 'Bond price will be fetched by scrape daemon on next cycle'
                        : 'Failed to trigger scrape daemon, check logs',
                    note: 'Bond prices are scraped asynchronously via Webull'
                }
            };
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Bond trigger via marker file', () => {
        it('should detect bond and trigger scrape daemon', async () => {
            const res = await bondFetchHandler('912810EX2', 'bond');

            expect(res.status).toBe(200);
            expect(res.body.isBond).toBe(true);
            expect(res.body.triggered).toBe(true);
            expect(res.body.message).toContain('scrape daemon');
        });

        it('should detect bond by treasury registry lookup even without type', async () => {
            // 912810EX2 is in mockTickerRegistry with exchange: 'TREASURY'
            const res = await bondFetchHandler('912810EX2', null);

            expect(res.status).toBe(200);
            expect(res.body.isBond).toBe(true);
        });

        it('should write to marker file with timestamp 0', async () => {
            await bondFetchHandler('912810EX2', 'bond');

            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                '/usr/src/app/logs/last.bond_positions.txt',
                '0\nTriggered by dashboard\n'
            );
        });

        it('should return triggered=false if marker file write fails', async () => {
            mockFs.writeFileSync.mockImplementation(() => {
                throw new Error('Permission denied');
            });

            const res = await bondFetchHandler('912810EX2', 'bond');

            expect(res.status).toBe(200);
            expect(res.body.triggered).toBe(false);
            expect(res.body.message).toContain('Failed to trigger');
        });

        it('should NOT return price data (async scraping)', async () => {
            const res = await bondFetchHandler('912810EX2', 'bond');

            expect(res.body.price).toBeUndefined();
            expect(res.body.note).toContain('asynchronously');
        });

        it('should reject non-bond symbols', async () => {
            const res = await bondFetchHandler('AAPL', null);

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Not a bond');
        });
    });
});
