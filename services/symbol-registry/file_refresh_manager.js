/**
 * File Refresh Manager
 * 
 * Manages tracking and scheduling of file refresh operations (NASDAQ, NYSE, OTHER, TREASURY).
 * Tracks when files were last refreshed and determines if refresh is due based on
 * configurable interval. Operates independently from the scrape daemon.
 */

class FileRefreshManager {
  static CONFIG = {
    FILE_REFRESH_INTERVAL_HOURS: parseInt(process.env.FILE_REFRESH_INTERVAL_HOURS || '24', 10),
    FILE_TYPES: ['NASDAQ', 'NYSE', 'OTHER', 'TREASURY'],
    ENABLE_REFRESH_ON_STARTUP: process.env.FILE_REFRESH_ON_STARTUP !== 'false'
  };

  constructor(dbPool) {
    this.dbPool = dbPool;
    this.refreshInProgress = {};
    this.lastRefreshTime = {};
  }

  /**
   * Check if refresh is due for a specific file type
   */
  async isRefreshDue(fileType) {
    // Validate file type
    if (!this.constructor.CONFIG.FILE_TYPES.includes(fileType)) {
      throw new Error(`Invalid file type: ${fileType}`);
    }

    const conn = await this.dbPool.getConnection();
    try {
      const [results] = await conn.query(
        'SELECT next_refresh_due_at, last_refresh_status FROM file_refresh_status WHERE file_type = ?',
        [fileType]
      );

      // If no record exists, it's due for refresh
      if (results.length === 0) {
        return true;
      }

      const status = results[0];
      
      // If in progress, don't refresh again
      if (status.last_refresh_status === 'IN_PROGRESS') {
        return false;
      }

      // Check if next_refresh_due_at is in the past
      const nextDueAt = new Date(status.next_refresh_due_at);
      return new Date() >= nextDueAt;
    } finally {
      conn.release();
    }
  }

  /**
   * Check all file types and return those that are due for refresh
   */
  async getFilesDueForRefresh() {
    const dueFiles = [];
    
    for (const fileType of this.constructor.CONFIG.FILE_TYPES) {
      try {
        if (await this.isRefreshDue(fileType)) {
          dueFiles.push(fileType);
        }
      } catch (err) {
        console.error(`Error checking refresh status for ${fileType}:`, err.message);
      }
    }

    return dueFiles;
  }

  /**
   * Mark a refresh as in progress
   */
  async markRefreshInProgress(fileType) {
    this.refreshInProgress[fileType] = true;

    const conn = await this.dbPool.getConnection();
    try {
      await conn.query(
        `INSERT INTO file_refresh_status (file_type, last_refresh_status, updated_at)
         VALUES (?, 'IN_PROGRESS', CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
          last_refresh_status = 'IN_PROGRESS',
          updated_at = CURRENT_TIMESTAMP`,
        [fileType]
      );
    } finally {
      conn.release();
    }
  }

  /**
   * Mark a refresh as completed successfully
   */
  async markRefreshSuccess(fileType, durationMs, symbolsAdded, symbolsUpdated) {
    delete this.refreshInProgress[fileType];

    const conn = await this.dbPool.getConnection();
    try {
      await conn.query(
        `INSERT INTO file_refresh_status
         (file_type, last_refresh_at, last_refresh_duration_ms, last_refresh_status,
          symbols_added, symbols_updated, next_refresh_due_at, updated_at)
         VALUES (?, CURRENT_TIMESTAMP, ?, 'SUCCESS', ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR), CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
          last_refresh_at = CURRENT_TIMESTAMP,
          last_refresh_duration_ms = VALUES(last_refresh_duration_ms),
          last_refresh_status = 'SUCCESS',
          symbols_added = VALUES(symbols_added),
          symbols_updated = VALUES(symbols_updated),
          next_refresh_due_at = VALUES(next_refresh_due_at),
          last_error_message = NULL,
          updated_at = CURRENT_TIMESTAMP`,
        [fileType, durationMs, symbolsAdded, symbolsUpdated, this.constructor.CONFIG.FILE_REFRESH_INTERVAL_HOURS]
      );
    } finally {
      conn.release();
    }
  }

  /**
   * Mark a refresh as failed
   */
  async markRefreshFailed(fileType, errorMessage) {
    delete this.refreshInProgress[fileType];

    const conn = await this.dbPool.getConnection();
    try {
      await conn.query(
        `INSERT INTO file_refresh_status
         (file_type, last_refresh_status, last_error_message, updated_at)
         VALUES (?, 'FAILED', ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
          last_refresh_status = 'FAILED',
          last_error_message = VALUES(last_error_message),
          updated_at = CURRENT_TIMESTAMP`,
        [fileType, errorMessage]
      );
    } finally {
      conn.release();
    }
  }

  /**
   * Get refresh status for all file types
   */
  async getAllRefreshStatus() {
    const conn = await this.dbPool.getConnection();
    try {
      const [results] = await conn.query(
        `SELECT file_type, last_refresh_at, last_refresh_duration_ms,
                last_refresh_status, last_error_message, symbols_added,
                symbols_updated, next_refresh_due_at
         FROM file_refresh_status
         ORDER BY file_type`
      );

      return results;
    } finally {
      conn.release();
    }
  }

  /**
   * Get refresh status for a specific file type
   */
  async getRefreshStatus(fileType) {
    const conn = await this.dbPool.getConnection();
    try {
      const [results] = await conn.query(
        `SELECT file_type, last_refresh_at, last_refresh_duration_ms,
                last_refresh_status, last_error_message, symbols_added,
                symbols_updated, next_refresh_due_at
         FROM file_refresh_status
         WHERE file_type = ?`,
        [fileType]
      );

      return results.length > 0 ? results[0] : null;
    } finally {
      conn.release();
    }
  }

  /**
   * Check if a refresh is currently in progress
   */
  isRefreshInProgress(fileType) {
    return this.refreshInProgress[fileType] || false;
  }

  /**
   * Get all file types currently in progress
   */
  getRefreshesInProgress() {
    return Object.keys(this.refreshInProgress).filter(key => this.refreshInProgress[key]);
  }

  /**
   * Check if any refreshes are in progress
   */
  hasRefreshesInProgress() {
    return this.getRefreshesInProgress().length > 0;
  }

  /**
   * Check refresh status on container startup
   * Returns list of file types that should be refreshed
   */
  async checkRefreshNeededOnStartup() {
    const filesDue = await this.getFilesDueForRefresh();
    
    if (filesDue.length > 0) {
      console.log(`🔄 File refresh needed on startup for: ${filesDue.join(', ')}`);
      return filesDue;
    }
    
    return [];
  }

  /**
   * Cleanup: Remove stale IN_PROGRESS statuses (older than 1 hour)
   * This handles cases where a refresh crashed or was interrupted
   */
  async cleanupStaleInProgress() {
    const conn = await this.dbPool.getConnection();
    try {
      const [results] = await conn.query(
        `UPDATE file_refresh_status
         SET last_refresh_status = 'FAILED',
             last_error_message = 'Refresh interrupted or timed out',
             updated_at = CURRENT_TIMESTAMP
         WHERE last_refresh_status = 'IN_PROGRESS'
         AND (updated_at IS NULL OR updated_at < DATE_SUB(NOW(), INTERVAL 1 HOUR))`
      );

      if (results.affectedRows > 0) {
        console.warn(`⚠️  Cleaned up ${results.affectedRows} stale IN_PROGRESS refresh(es)`);
      }

      return results.affectedRows;
    } finally {
      conn.release();
    }
  }

  /**
   * Initialize the table with initial records if they don't exist
   */
  async initializeRefreshStatus() {
    const conn = await this.dbPool.getConnection();
    try {
      for (const fileType of this.constructor.CONFIG.FILE_TYPES) {
        await conn.query(
          `INSERT IGNORE INTO file_refresh_status (file_type, last_refresh_status)
           VALUES (?, 'SUCCESS')`,
          [fileType]
        );
      }
      return true;
    } finally {
      conn.release();
    }
  }
}

module.exports = FileRefreshManager;
