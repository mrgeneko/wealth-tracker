/**
 * Unit Tests for MetadataRefreshScheduler
 * 
 * Tests scheduling logic, localStorage persistence, and refresh execution
 */

describe('MetadataRefreshScheduler', () => {
    let scheduler;
    let mockLocalStorage;

    beforeEach(() => {
        // Mock localStorage
        mockLocalStorage = {};
        global.localStorage = {
            getItem: jest.fn((key) => mockLocalStorage[key]),
            setItem: jest.fn((key, value) => {
                mockLocalStorage[key] = value;
            }),
            removeItem: jest.fn((key) => {
                delete mockLocalStorage[key];
            }),
            clear: jest.fn(() => {
                mockLocalStorage = {};
            })
        };

        // Mock timers
        jest.useFakeTimers();
        
        // Clear jest mocks
        jest.clearAllMocks();

        // Load the scheduler class
        const MetadataRefreshScheduler = require('../../../dashboard/public/scheduler.js');
        scheduler = new MetadataRefreshScheduler();
    });

    afterEach(() => {
        jest.useRealTimers();
        if (scheduler) {
            scheduler.stop();
        }
    });

    describe('Initialization', () => {
        test('should initialize with default values', () => {
            expect(scheduler.currentInterval).toBeNull();
            expect(scheduler.jobId).toBeNull();
            expect(scheduler.lastRefresh).toBeNull();
            expect(scheduler.nextRefresh).toBeNull();
            expect(scheduler.isRunning).toBe(false);
        });

        test('should have all interval options configured', () => {
            const intervals = scheduler.getIntervals();
            expect(intervals).toHaveLength(6);
            expect(intervals[0].label).toBe('Every Hour');
            expect(intervals[4].label).toBe('Every 24 Hours');
            expect(intervals[5].label).toBe('Never');
        });

        test('should restore config from localStorage', () => {
            const saved = {
                interval: 3600000,
                lastRefresh: new Date('2025-12-09T10:00:00Z').toISOString(),
                nextRefresh: new Date('2025-12-09T11:00:00Z').toISOString()
            };
            mockLocalStorage['metadataRefreshSchedule'] = JSON.stringify(saved);

            const newScheduler = require('../../../dashboard/public/scheduler.js');
            const restored = new newScheduler();
            
            expect(restored.currentInterval).toBe(3600000);
            expect(restored.lastRefresh).not.toBeNull();
            expect(restored.nextRefresh).not.toBeNull();
        });
    });

    describe('Schedule Management', () => {
        test('should start scheduler with interval', () => {
            scheduler.start(3600000);
            
            expect(scheduler.isRunning).toBe(true);
            expect(scheduler.currentInterval).toBe(3600000);
            expect(scheduler.jobId).not.toBeNull();
            expect(scheduler.nextRefresh).not.toBeNull();
        });

        test('should disable scheduler when interval is null', () => {
            scheduler.start(3600000);
            scheduler.start(null);
            
            expect(scheduler.isRunning).toBe(false);
            expect(scheduler.currentInterval).toBeNull();
            expect(scheduler.jobId).toBeNull();
        });

        test('should calculate next refresh time correctly', () => {
            const before = new Date();
            scheduler.start(3600000); // 1 hour
            const after = new Date();

            const nextRefresh = scheduler.nextRefresh;
            const expectedTime = 3600000;
            const actualTime = nextRefresh - new Date();

            // Allow 1 second tolerance
            expect(Math.abs(actualTime - expectedTime)).toBeLessThan(1000);
        });

        test('should stop scheduler', () => {
            scheduler.start(3600000);
            expect(scheduler.isRunning).toBe(true);

            scheduler.stop();
            
            expect(scheduler.isRunning).toBe(false);
            expect(scheduler.jobId).toBeNull();
            expect(scheduler.currentInterval).toBeNull();
            expect(scheduler.nextRefresh).toBeNull();
        });

        test('should clear existing job when starting new schedule', () => {
            scheduler.start(3600000);
            const firstJobId = scheduler.jobId;

            scheduler.start(1800000); // 30 minutes
            const secondJobId = scheduler.jobId;

            expect(firstJobId).not.toBe(secondJobId);
        });
    });

    describe('Persistence', () => {
        test('should save config to localStorage', () => {
            scheduler.start(3600000);

            expect(global.localStorage.setItem).toHaveBeenCalled();
            const saved = JSON.parse(mockLocalStorage['metadataRefreshSchedule']);
            expect(saved.interval).toBe(3600000);
        });

        test('should save lastRefresh timestamp', async () => {
            scheduler.start(3600000);
            
            // Mock window.refreshMetadata
            global.window = { refreshMetadata: jest.fn().mockResolvedValue(undefined) };

            // Execute refresh
            scheduler.lastRefresh = new Date();
            scheduler.save();

            const saved = JSON.parse(mockLocalStorage['metadataRefreshSchedule']);
            expect(saved.lastRefresh).not.toBeNull();
        });

        test('should handle localStorage errors gracefully', () => {
            global.localStorage.setItem.mockImplementation(() => {
                throw new Error('Storage quota exceeded');
            });

            expect(() => {
                scheduler.start(3600000);
            }).not.toThrow();
        });
    });

    describe('Refresh Execution', () => {
        test('should execute refresh when job triggers', async () => {
            global.window = { refreshMetadata: jest.fn().mockResolvedValue(undefined) };

            scheduler.start(3600000);
            expect(scheduler.jobId).not.toBeNull();

            // Simulate timeout
            jest.runOnlyPendingTimers();
            await Promise.resolve();

            expect(global.window.refreshMetadata).toHaveBeenCalled();
        });

        test('should update lastRefresh timestamp after execution', async () => {
            global.window = { refreshMetadata: jest.fn().mockResolvedValue(undefined) };

            scheduler.start(3600000);
            const before = new Date();

            jest.runOnlyPendingTimers();
            await Promise.resolve();

            expect(scheduler.lastRefresh).not.toBeNull();
            expect(scheduler.lastRefresh >= before).toBe(true);
        });

        test('should reschedule after refresh execution', async () => {
            global.window = { refreshMetadata: jest.fn().mockResolvedValue(undefined) };

            scheduler.start(3600000);
            const firstJobId = scheduler.jobId;

            jest.runOnlyPendingTimers();
            await Promise.resolve();

            const secondJobId = scheduler.jobId;
            expect(firstJobId).not.toBe(secondJobId);
            expect(secondJobId).not.toBeNull();
        });

        test('should handle refresh errors gracefully', async () => {
            global.window = { 
                refreshMetadata: jest.fn().mockRejectedValue(new Error('API Error'))
            };

            scheduler.start(3600000);
            
            jest.runOnlyPendingTimers();
            await Promise.resolve();

            // Should still reschedule after error
            expect(scheduler.jobId).not.toBeNull();
            expect(scheduler.isRunning).toBe(true);
        });

        test('should not execute if refreshMetadata is not available', async () => {
            global.window = {};

            scheduler.start(3600000);
            jest.runOnlyPendingTimers();
            await Promise.resolve();

            // Should still continue running without error
            expect(scheduler.isRunning).toBe(true);
        });
    });

    describe('Status Reporting', () => {
        test('should return current status', () => {
            scheduler.start(3600000);

            const status = scheduler.getStatus();

            expect(status.enabled).toBe(true);
            expect(status.interval).toBe(3600000);
            expect(status.intervalLabel).toBe('Every Hour');
            expect(status.lastRefresh).toBeNull();
            expect(status.nextRefresh).not.toBeNull();
            expect(status.isScheduled).toBe(true);
        });

        test('should return disabled status when not running', () => {
            const status = scheduler.getStatus();

            expect(status.enabled).toBe(false);
            expect(status.intervalLabel).toBe('Never');
            expect(status.isScheduled).toBe(false);
        });

        test('should format time until next refresh', () => {
            scheduler.start(3600000);

            const timeStr = scheduler.getTimeUntilNextRefresh();
            expect(timeStr).toMatch(/^\d+h \d+m$/);
        });

        test('should return "Soon" for imminent refresh', () => {
            scheduler.start(3600000);
            scheduler.nextRefresh = new Date(Date.now() - 1000); // Past time

            const timeStr = scheduler.getTimeUntilNextRefresh();
            expect(timeStr).toBe('Soon');
        });

        test('should get interval label for all values', () => {
            expect(scheduler.getIntervalLabel(3600000)).toBe('Every Hour');
            expect(scheduler.getIntervalLabel(10800000)).toBe('Every 3 Hours');
            expect(scheduler.getIntervalLabel(21600000)).toBe('Every 6 Hours');
            expect(scheduler.getIntervalLabel(43200000)).toBe('Every 12 Hours');
            expect(scheduler.getIntervalLabel(86400000)).toBe('Every 24 Hours');
            expect(scheduler.getIntervalLabel(null)).toBe('Never');
            expect(scheduler.getIntervalLabel(999999)).toBe('Never');
        });
    });

    describe('Edge Cases', () => {
        test('should handle rapid start/stop cycles', () => {
            for (let i = 0; i < 5; i++) {
                scheduler.start(3600000);
                scheduler.stop();
            }

            expect(scheduler.isRunning).toBe(false);
            expect(scheduler.jobId).toBeNull();
        });

        test('should not throw when stopping already stopped scheduler', () => {
            scheduler.start(3600000);
            scheduler.stop();
            
            expect(() => {
                scheduler.stop();
            }).not.toThrow();
        });

        test('should handle storage load errors', () => {
            global.localStorage.getItem.mockImplementation(() => {
                throw new Error('Storage error');
            });

            expect(() => {
                const newScheduler = require('../../../dashboard/public/scheduler.js');
                new newScheduler();
            }).not.toThrow();
        });

        test('should handle corrupted localStorage data', () => {
            mockLocalStorage['metadataRefreshSchedule'] = '{invalid json}';

            expect(() => {
                const newScheduler = require('../../../dashboard/public/scheduler.js');
                new newScheduler();
            }).not.toThrow();
        });
    });
});
