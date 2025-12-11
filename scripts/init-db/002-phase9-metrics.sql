-- Init Script: Create Phase 9 WebSocket Real-time Metrics Tables
-- 
-- This script is automatically executed by Docker MySQL on container initialization
-- (first time only, placed in /docker-entrypoint-initdb.d/)
--
-- Creates the tables for real-time metrics collection and WebSocket dashboard visualization

CREATE TABLE IF NOT EXISTS scraper_page_performance (
  id INT NOT NULL AUTO_INCREMENT,
  scraper_source VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  metric_type VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  url VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  navigation_duration_ms INT DEFAULT NULL,
  scrape_duration_ms INT DEFAULT NULL,
  items_extracted INT DEFAULT NULL,
  success TINYINT(1) DEFAULT 1,
  error VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_source_time (scraper_source,created_at DESC),
  KEY idx_type_source (metric_type,scraper_source,created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scraper_daily_summary (
  scraper_source VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  metric_date DATE NOT NULL,
  metric_type VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  total_count INT DEFAULT NULL,
  success_count INT DEFAULT NULL,
  avg_duration_ms FLOAT DEFAULT NULL,
  total_items_extracted INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scraper_source,metric_date,metric_type),
  KEY idx_source_date (scraper_source,metric_date DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_metrics (
  id INT NOT NULL AUTO_INCREMENT,
  scraper_source VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  execution_duration_ms INT DEFAULT NULL,
  success TINYINT(1) DEFAULT 1,
  error VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_source_time (scraper_source,created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
