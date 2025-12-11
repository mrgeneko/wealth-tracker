-- Init Script: Create Phase 9 WebSocket Real-time Metrics Tables
-- 
-- This script is automatically executed by Docker MySQL on container initialization
-- (first time only, placed in /docker-entrypoint-initdb.d/)
--
-- Creates the tables for real-time metrics collection and WebSocket dashboard visualization

CREATE TABLE IF NOT EXISTS scraper_page_performance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scraper_source VARCHAR(50) NOT NULL,
  metric_type VARCHAR(50) NOT NULL,
  url VARCHAR(500),
  navigation_duration_ms INT,
  scrape_duration_ms INT,
  items_extracted INT,
  success BOOLEAN DEFAULT TRUE,
  error VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source_time (scraper_source, created_at DESC),
  INDEX idx_type_source (metric_type, scraper_source, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scraper_daily_summary (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scraper_source VARCHAR(50) NOT NULL,
  metric_date DATE NOT NULL,
  metric_type VARCHAR(50),
  total_count INT,
  success_count INT,
  avg_duration_ms FLOAT,
  total_items_extracted INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scraper_source, metric_date, metric_type),
  INDEX idx_source_date (scraper_source, metric_date DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scraper_source VARCHAR(50),
  execution_duration_ms INT,
  success BOOLEAN DEFAULT TRUE,
  error VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source_time (scraper_source, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
