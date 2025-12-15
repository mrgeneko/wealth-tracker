-- Init Script: Listing Sync + Watchlist Management Tables
--
-- This script is automatically executed by Docker MySQL on container initialization
-- (first time only, placed in /docker-entrypoint-initdb.d/)
--
-- Creates tables for:
-- - Listing sync service status tracking (optional)
-- - Watchlist provider and instance management
-- - Time-based update windows

-- ============================================================================
-- LISTING SYNC TABLES
-- ============================================================================

-- Track listing sync status per source
CREATE TABLE IF NOT EXISTS listing_sync_status (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source VARCHAR(50) NOT NULL,
    last_sync_at TIMESTAMP NULL,
    last_success_at TIMESTAMP NULL,
    records_synced INT DEFAULT 0,
    status ENUM('pending', 'running', 'success', 'failed') DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================================
-- WATCHLIST MANAGEMENT TABLES
-- ============================================================================

-- Watchlist providers (Investing.com, TradingView, etc.)
CREATE TABLE IF NOT EXISTS watchlist_providers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_id VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    enabled TINYINT(1) DEFAULT 1,

    -- Authentication method
    auth_method ENUM('credentials', 'cookie', 'oauth', 'none') DEFAULT 'credentials',

    -- Default scrape settings
    default_interval_seconds INT DEFAULT 300,

    -- Supported asset types (JSON array)
    supported_asset_types JSON,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY idx_provider_id (provider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Individual watchlist instances within providers
CREATE TABLE IF NOT EXISTS watchlist_instances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_id INT NOT NULL,

    -- Watchlist identification
    watchlist_key VARCHAR(100) NOT NULL,
    watchlist_name VARCHAR(200),
    watchlist_url VARCHAR(500) NOT NULL,

    -- Asset type constraints for this watchlist
    allowed_asset_types JSON,

    -- Scrape settings (override provider defaults)
    interval_seconds INT,
    enabled TINYINT(1) DEFAULT 1,

    -- Metadata
    last_scraped_at TIMESTAMP NULL,
    ticker_count INT DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY idx_provider_watchlist (provider_id, watchlist_key),
    INDEX idx_enabled (enabled),
    FOREIGN KEY (provider_id) REFERENCES watchlist_providers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Time-based update windows for scraping control
CREATE TABLE IF NOT EXISTS update_windows (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Scope: can apply to provider, watchlist instance, or specific ticker
    provider_id VARCHAR(50),
    watchlist_key VARCHAR(100),
    ticker VARCHAR(20),

    -- Time window definition
    days JSON NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    timezone VARCHAR(50) DEFAULT 'America/New_York',

    -- Control
    enabled TINYINT(1) DEFAULT 1,
    priority INT DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_provider (provider_id),
    INDEX idx_ticker (ticker)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================================
-- METRICS TABLES (optional; for monitoring)
-- ============================================================================

CREATE TABLE IF NOT EXISTS listing_sync_metrics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source VARCHAR(50) NOT NULL,
    sync_started_at TIMESTAMP NOT NULL,
    sync_completed_at TIMESTAMP NULL,
    duration_ms INT,
    records_processed INT DEFAULT 0,
    records_inserted INT DEFAULT 0,
    records_updated INT DEFAULT 0,
    records_failed INT DEFAULT 0,
    status ENUM('success', 'partial', 'failed') DEFAULT 'success',
    error_details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_source_time (source, sync_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS page_pool_snapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pool_size INT,
    active_pages INT,
    available_pages INT,
    waiting_requests INT,
    total_acquisitions BIGINT,
    total_releases BIGINT,
    avg_wait_time_ms INT,
    memory_usage_mb INT,
    INDEX idx_snapshot_time (snapshot_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================================
-- SEED DATA
-- ============================================================================

INSERT INTO watchlist_providers (provider_id, display_name, enabled, auth_method, default_interval_seconds, supported_asset_types) VALUES
('investingcom', 'Investing.com', 1, 'credentials', 300, '["stock", "etf"]'),
('tradingview', 'TradingView', 0, 'credentials', 300, '["stock", "etf", "bond", "treasury", "crypto"]')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- Default update windows (market hours for stocks)
-- Default update windows (market hours for stocks)
INSERT INTO update_windows (provider_id, watchlist_key, ticker, days, start_time, end_time, timezone, priority) VALUES
(NULL, NULL, 'default', '["mon", "tue", "wed", "thu", "fri"]', '00:00:00', '04:00:00', 'America/New_York', 0),
(NULL, NULL, 'default', '["mon", "tue", "wed", "thu", "fri"]', '04:00:00', '09:30:00', 'America/New_York', 0),
(NULL, NULL, 'default', '["mon", "tue", "wed", "thu", "fri"]', '09:30:00', '16:00:00', 'America/New_York', 0),
(NULL, NULL, 'default', '["mon", "tue", "wed", "thu", "fri"]', '16:00:00', '20:00:00', 'America/New_York', 0),
(NULL, NULL, 'default', '["mon", "tue", "wed", "thu", "fri"]', '20:00:00', '23:59:59', 'America/New_York', 0),
('investingcom', NULL, 'BKLC', '["mon", "tue", "wed", "thu", "fri"]', '09:31:00', '16:00:00', 'America/New_York', 10)
ON DUPLICATE KEY UPDATE days = VALUES(days), start_time = VALUES(start_time), end_time = VALUES(end_time), priority = VALUES(priority);
