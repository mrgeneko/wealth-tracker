/**
 * Statistics Filter Component for Dashboard
 * 
 * Provides UI for filtering and displaying per-type metadata statistics
 */

class StatisticsFilter {
    constructor() {
        this.selectedType = null;
        this.statsCache = null;
        this.availableTypes = [];
        this.load();
    }

    /**
     * Load available security types
     */
    async loadAvailableTypes() {
        try {
            const res = await fetch('/api/statistics/available-types');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            this.availableTypes = data.types || [];
            
            return this.availableTypes;
        } catch (error) {
            console.error('[StatisticsFilter] Error loading available types:', error);
            return [];
        }
    }

    /**
     * Get statistics for a specific type
     */
    async getTypeStats(type) {
        try {
            const res = await fetch(`/api/statistics/type/${encodeURIComponent(type)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            return data.data || null;
        } catch (error) {
            console.error('[StatisticsFilter] Error fetching type stats:', error);
            return null;
        }
    }

    /**
     * Get all statistics broken down by type
     */
    async getAllStats() {
        try {
            const res = await fetch('/api/statistics/by-type');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            this.statsCache = data;
            
            return data;
        } catch (error) {
            console.error('[StatisticsFilter] Error fetching all stats:', error);
            return null;
        }
    }

    /**
     * Filter overall statistics by type
     */
    async getFilteredStats(types) {
        try {
            const typeStr = types.join(',');
            const res = await fetch(`/api/statistics?type=${encodeURIComponent(typeStr)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            return data.summary || null;
        } catch (error) {
            console.error('[StatisticsFilter] Error fetching filtered stats:', error);
            return null;
        }
    }

    /**
     * Trigger metadata refresh for a type
     */
    async refreshType(type) {
        try {
            const res = await fetch('/api/statistics/refresh-type', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            return data;
        } catch (error) {
            console.error('[StatisticsFilter] Error triggering refresh:', error);
            return null;
        }
    }

    /**
     * Reset metadata for a type (archive and clear)
     */
    async resetType(type) {
        try {
            const res = await fetch('/api/statistics/reset-type', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            return data;
        } catch (error) {
            console.error('[StatisticsFilter] Error resetting type:', error);
            return null;
        }
    }

    /**
     * Load persisted state
     */
    load() {
        try {
            const saved = localStorage.getItem('statisticsFilterState');
            if (saved) {
                const state = JSON.parse(saved);
                this.selectedType = state.selectedType;
            }
        } catch (error) {
            console.error('[StatisticsFilter] Error loading state:', error);
        }
    }

    /**
     * Save state to localStorage
     */
    save() {
        try {
            const state = {
                selectedType: this.selectedType
            };
            localStorage.setItem('statisticsFilterState', JSON.stringify(state));
        } catch (error) {
            console.error('[StatisticsFilter] Error saving state:', error);
        }
    }

    /**
     * Format stats for display
     */
    formatStats(stats) {
        if (!stats) return null;
        
        return {
            type: stats.security_type || 'Unknown',
            total: stats.total_symbols || 0,
            withMetadata: stats.with_metadata || 0,
            withoutMetadata: stats.without_metadata || 0,
            completion: stats.completion_percentage || 0
        };
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StatisticsFilter;
}
