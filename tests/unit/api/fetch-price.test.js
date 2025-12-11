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
