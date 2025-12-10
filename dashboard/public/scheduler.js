/**
 * Scheduler Service for Metadata Refresh
 * 
 * Manages scheduled refresh of symbol metadata
 * - Configurable intervals (1hr, 3hr, 6hr, 12hr, 24hr, Never)
 * - Background job execution
 * - Persistence to localStorage
 * - Real-time stats updates
 */

class MetadataRefreshScheduler {
    constructor() {
        this.config = {
            intervals: [
                { label: 'Every Hour', value: 3600000 },      // 1 hour
                { label: 'Every 3 Hours', value: 10800000 },   // 3 hours
                { label: 'Every 6 Hours', value: 21600000 },   // 6 hours
                { label: 'Every 12 Hours', value: 43200000 },  // 12 hours
                { label: 'Every 24 Hours', value: 86400000 },  // 24 hours
                { label: 'Never', value: null }
            ]
        };
        
        this.currentInterval = null;
        this.jobId = null;
        this.lastRefresh = null;
        this.nextRefresh = null;
        this.isRunning = false;
        
        this.load();
    }

    /**
     * Load scheduler config from localStorage
     */
    load() {
        try {
            const saved = localStorage.getItem('metadataRefreshSchedule');
            if (saved) {
                const config = JSON.parse(saved);
                this.currentInterval = config.interval;
                this.lastRefresh = config.lastRefresh ? new Date(config.lastRefresh) : null;
                this.nextRefresh = config.nextRefresh ? new Date(config.nextRefresh) : null;
            }
        } catch (error) {
            console.error('[MetadataRefreshScheduler] Error loading config:', error);
        }
    }

    /**
     * Save scheduler config to localStorage
     */
    save() {
        try {
            const config = {
                interval: this.currentInterval,
                lastRefresh: this.lastRefresh?.toISOString(),
                nextRefresh: this.nextRefresh?.toISOString()
            };
            localStorage.setItem('metadataRefreshSchedule', JSON.stringify(config));
        } catch (error) {
            console.error('[MetadataRefreshScheduler] Error saving config:', error);
        }
    }

    /**
     * Start scheduled refresh with given interval
     * @param {number} intervalMs - Interval in milliseconds (null = never)
     */
    start(intervalMs) {
        if (this.isRunning && this.jobId) {
            this.stop();
        }

        this.currentInterval = intervalMs;
        this.save();

        if (!intervalMs) {
            console.log('[MetadataRefreshScheduler] Scheduled refresh disabled');
            this.isRunning = false;
            return;
        }

        this.isRunning = true;
        this.scheduleNext();
        console.log(`[MetadataRefreshScheduler] Started with interval ${intervalMs}ms`);
    }

    /**
     * Schedule the next refresh
     */
    scheduleNext() {
        if (!this.currentInterval) {
            this.isRunning = false;
            return;
        }

        // Calculate next refresh time
        this.nextRefresh = new Date(Date.now() + this.currentInterval);
        this.save();

        // Clear existing job
        if (this.jobId) {
            clearTimeout(this.jobId);
        }

        // Schedule next refresh
        this.jobId = setTimeout(() => {
            this.executeRefresh();
        }, this.currentInterval);

        console.log('[MetadataRefreshScheduler] Next refresh scheduled for:', this.nextRefresh.toISOString());
    }

    /**
     * Execute the refresh operation
     */
    async executeRefresh() {
        try {
            console.log('[MetadataRefreshScheduler] Executing scheduled refresh...');
            
            // Call the dashboard refresh function if available
            if (typeof window.refreshMetadata === 'function') {
                await window.refreshMetadata();
                this.lastRefresh = new Date();
                this.save();
                console.log('[MetadataRefreshScheduler] Refresh completed successfully');
            }
        } catch (error) {
            console.error('[MetadataRefreshScheduler] Error executing refresh:', error);
        } finally {
            // Schedule next refresh
            this.scheduleNext();
        }
    }

    /**
     * Stop scheduled refresh
     */
    stop() {
        if (this.jobId) {
            clearTimeout(this.jobId);
            this.jobId = null;
        }
        this.isRunning = false;
        this.currentInterval = null;
        this.nextRefresh = null;
        this.save();
        console.log('[MetadataRefreshScheduler] Stopped');
    }

    /**
     * Get current schedule status
     */
    getStatus() {
        const intervalLabel = this.getIntervalLabel(this.currentInterval);
        return {
            enabled: this.isRunning,
            interval: this.currentInterval,
            intervalLabel: intervalLabel,
            lastRefresh: this.lastRefresh,
            nextRefresh: this.nextRefresh,
            isScheduled: this.jobId !== null
        };
    }

    /**
     * Get label for interval value
     */
    getIntervalLabel(interval) {
        const found = this.config.intervals.find(i => i.value === interval);
        return found ? found.label : 'Never';
    }

    /**
     * Get all available intervals
     */
    getIntervals() {
        return this.config.intervals;
    }

    /**
     * Format time until next refresh
     */
    getTimeUntilNextRefresh() {
        if (!this.nextRefresh) return null;
        
        const now = new Date();
        const ms = this.nextRefresh - now;
        
        if (ms <= 0) return 'Soon';
        
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MetadataRefreshScheduler;
}
