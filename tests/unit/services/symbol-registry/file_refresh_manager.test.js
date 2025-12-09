/**
 * Unit Tests for FileRefreshManager
 */

const FileRefreshManager = require('../../../../services/symbol-registry/file_refresh_manager');

describe('FileRefreshManager', () => {
  let manager;
  let mockPool;
  let mockConnection;

  beforeEach(() => {
    // Mock connection
    mockConnection = {
      query: jest.fn(),
      release: jest.fn()
    };

    // Mock pool
    mockPool = {
      getConnection: jest.fn(async () => mockConnection)
    };

    manager = new FileRefreshManager(mockPool);
  });

  describe('Configuration', () => {
    test('CONFIG should have FILE_REFRESH_INTERVAL_HOURS', () => {
      expect(FileRefreshManager.CONFIG).toHaveProperty('FILE_REFRESH_INTERVAL_HOURS');
      expect(typeof FileRefreshManager.CONFIG.FILE_REFRESH_INTERVAL_HOURS).toBe('number');
    });

    test('CONFIG should list all file types', () => {
      expect(FileRefreshManager.CONFIG.FILE_TYPES).toEqual(
        expect.arrayContaining(['NASDAQ', 'NYSE', 'OTHER', 'TREASURY'])
      );
      expect(FileRefreshManager.CONFIG.FILE_TYPES.length).toBe(4);
    });

    test('CONFIG should have ENABLE_REFRESH_ON_STARTUP flag', () => {
      expect(FileRefreshManager.CONFIG).toHaveProperty('ENABLE_REFRESH_ON_STARTUP');
      expect(typeof FileRefreshManager.CONFIG.ENABLE_REFRESH_ON_STARTUP).toBe('boolean');
    });
  });

  describe('Constructor', () => {
    test('constructor should store database pool reference', () => {
      expect(manager.dbPool).toBe(mockPool);
    });

    test('constructor should initialize empty tracking objects', () => {
      expect(manager.refreshInProgress).toEqual({});
      expect(manager.lastRefreshTime).toEqual({});
    });
  });

  describe('Refresh Status Tracking', () => {
    test('isRefreshInProgress should return false initially', () => {
      expect(manager.isRefreshInProgress('NASDAQ')).toBe(false);
    });

    test('isRefreshInProgress should return true when refresh marked in progress', async () => {
      mockConnection.query.mockResolvedValueOnce([{}]);
      manager.refreshInProgress['NASDAQ'] = true;
      expect(manager.isRefreshInProgress('NASDAQ')).toBe(true);
    });

    test('getRefreshesInProgress should return empty array initially', () => {
      expect(manager.getRefreshesInProgress()).toEqual([]);
    });

    test('getRefreshesInProgress should list all in-progress refreshes', () => {
      manager.refreshInProgress['NASDAQ'] = true;
      manager.refreshInProgress['NYSE'] = true;
      const inProgress = manager.getRefreshesInProgress();
      expect(inProgress).toContain('NASDAQ');
      expect(inProgress).toContain('NYSE');
      expect(inProgress.length).toBe(2);
    });

    test('hasRefreshesInProgress should return false when none in progress', () => {
      expect(manager.hasRefreshesInProgress()).toBe(false);
    });

    test('hasRefreshesInProgress should return true when any in progress', () => {
      manager.refreshInProgress['NASDAQ'] = true;
      expect(manager.hasRefreshesInProgress()).toBe(true);
    });
  });

  describe('Mark Refresh Status', () => {
    test('markRefreshInProgress should update database and set flag', async () => {
      mockConnection.query.mockResolvedValueOnce([{}]);
      
      await manager.markRefreshInProgress('NASDAQ');
      
      expect(mockPool.getConnection).toHaveBeenCalled();
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('IN_PROGRESS'),
        ['NASDAQ']
      );
      expect(manager.refreshInProgress['NASDAQ']).toBe(true);
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('markRefreshSuccess should update database and clear flag', async () => {
      mockConnection.query.mockResolvedValueOnce([{}]);
      manager.refreshInProgress['NASDAQ'] = true;
      
      await manager.markRefreshSuccess('NASDAQ', 5000, 100, 50);
      
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('SUCCESS'),
        expect.arrayContaining(['NASDAQ', 5000, 100, 50])
      );
      expect(manager.refreshInProgress['NASDAQ']).toBeFalsy();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('markRefreshFailed should update database with error and clear flag', async () => {
      mockConnection.query.mockResolvedValueOnce([{}]);
      manager.refreshInProgress['NYSE'] = true;
      const errorMsg = 'Network timeout';
      
      await manager.markRefreshFailed('NYSE', errorMsg);
      
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('FAILED'),
        expect.arrayContaining(['NYSE', errorMsg])
      );
      expect(manager.refreshInProgress['NYSE']).toBeFalsy();
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  describe('File Type Validation', () => {
    test('isRefreshDue should throw error for invalid file type', async () => {
      await expect(manager.isRefreshDue('INVALID_TYPE')).rejects.toThrow(
        'Invalid file type: INVALID_TYPE'
      );
    });

    test('isRefreshDue should accept valid file types', async () => {
      mockConnection.query.mockResolvedValue([[]]);
      
      const fileTypes = ['NASDAQ', 'NYSE', 'OTHER', 'TREASURY'];
      for (const fileType of fileTypes) {
        const isDue = await manager.isRefreshDue(fileType);
        expect(typeof isDue).toBe('boolean');
      }
    });
  });

  describe('Refresh Due Detection', () => {
    test('isRefreshDue should return true when no record exists', async () => {
      mockConnection.query.mockResolvedValueOnce([[]]);
      
      const isDue = await manager.isRefreshDue('NASDAQ');
      
      expect(isDue).toBe(true);
    });

    test('isRefreshDue should return false when IN_PROGRESS', async () => {
      mockConnection.query.mockResolvedValueOnce([
        [{ last_refresh_status: 'IN_PROGRESS', next_refresh_due_at: new Date() }]
      ]);
      
      const isDue = await manager.isRefreshDue('NASDAQ');
      
      expect(isDue).toBe(false);
    });

    test('isRefreshDue should return true when next_refresh_due_at is in past', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 2); // 2 hours ago
      
      mockConnection.query.mockResolvedValueOnce([
        [{ last_refresh_status: 'SUCCESS', next_refresh_due_at: pastDate }]
      ]);
      
      const isDue = await manager.isRefreshDue('NASDAQ');
      
      expect(isDue).toBe(true);
    });

    test('isRefreshDue should return false when next_refresh_due_at is in future', async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 2); // 2 hours from now
      
      mockConnection.query.mockResolvedValueOnce([
        [{ last_refresh_status: 'SUCCESS', next_refresh_due_at: futureDate }]
      ]);
      
      const isDue = await manager.isRefreshDue('NASDAQ');
      
      expect(isDue).toBe(false);
    });

    test('isRefreshDue should handle FAILED status as eligible for retry', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 2);
      
      mockConnection.query.mockResolvedValueOnce([
        [{ last_refresh_status: 'FAILED', next_refresh_due_at: pastDate }]
      ]);
      
      const isDue = await manager.isRefreshDue('NASDAQ');
      
      expect(isDue).toBe(true);
    });
  });

  describe('Get Files Due for Refresh', () => {
    test('getFilesDueForRefresh should return empty array when nothing due', async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 2);
      
      mockConnection.query.mockResolvedValue([
        [{ last_refresh_status: 'SUCCESS', next_refresh_due_at: futureDate }]
      ]);
      
      const dueFiles = await manager.getFilesDueForRefresh();
      
      expect(dueFiles).toEqual([]);
      expect(mockPool.getConnection).toHaveBeenCalledTimes(4); // 4 file types
    });

    test('getFilesDueForRefresh should return files due for refresh', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 2);
      
      mockConnection.query
        .mockResolvedValueOnce([
          [{ last_refresh_status: 'SUCCESS', next_refresh_due_at: pastDate }]
        ]) // NASDAQ - due
        .mockResolvedValueOnce([[]]) // NYSE - no record (due)
        .mockResolvedValueOnce([
          [{ last_refresh_status: 'SUCCESS', next_refresh_due_at: new Date(Date.now() + 7200000) }]
        ]) // OTHER - not due
        .mockResolvedValueOnce([
          [{ last_refresh_status: 'FAILED', next_refresh_due_at: pastDate }]
        ]); // TREASURY - due
      
      const dueFiles = await manager.getFilesDueForRefresh();
      
      expect(dueFiles).toContain('NASDAQ');
      expect(dueFiles).toContain('NYSE');
      expect(dueFiles).toContain('TREASURY');
      expect(dueFiles).not.toContain('OTHER');
    });

    test('getFilesDueForRefresh should handle errors gracefully', async () => {
      mockConnection.query.mockRejectedValueOnce(new Error('Database error'));
      mockConnection.query.mockResolvedValueOnce([[]]); // NYSE
      mockConnection.query.mockResolvedValueOnce([[]]); // OTHER
      mockConnection.query.mockResolvedValueOnce([[]]); // TREASURY
      
      const dueFiles = await manager.getFilesDueForRefresh();
      
      // Should still return other files even if one fails
      expect(Array.isArray(dueFiles)).toBe(true);
      expect(mockPool.getConnection).toHaveBeenCalledTimes(4);
    });
  });

  describe('Get Refresh Status', () => {
    test('getAllRefreshStatus should return status for all file types', async () => {
      const mockStatuses = [
        { file_type: 'NASDAQ', last_refresh_status: 'SUCCESS' },
        { file_type: 'NYSE', last_refresh_status: 'SUCCESS' },
        { file_type: 'OTHER', last_refresh_status: 'FAILED' },
        { file_type: 'TREASURY', last_refresh_status: 'IN_PROGRESS' }
      ];
      
      mockConnection.query.mockResolvedValueOnce([mockStatuses]);
      
      const statuses = await manager.getAllRefreshStatus();
      
      expect(statuses).toHaveLength(4);
      expect(statuses[0].file_type).toBe('NASDAQ');
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('getRefreshStatus should return status for specific file type', async () => {
      const mockStatus = { file_type: 'NASDAQ', last_refresh_status: 'SUCCESS' };
      mockConnection.query.mockResolvedValueOnce([[mockStatus]]);
      
      const status = await manager.getRefreshStatus('NASDAQ');
      
      expect(status.file_type).toBe('NASDAQ');
      expect(status.last_refresh_status).toBe('SUCCESS');
    });

    test('getRefreshStatus should return null when file type not found', async () => {
      mockConnection.query.mockResolvedValueOnce([[]]);
      
      const status = await manager.getRefreshStatus('NASDAQ');
      
      expect(status).toBeNull();
    });
  });

  describe('Startup Refresh Check', () => {
    test('checkRefreshNeededOnStartup should return files due', async () => {
      mockConnection.query
        .mockResolvedValueOnce([[{ last_refresh_status: 'SUCCESS', next_refresh_due_at: new Date(0) }]]) // NASDAQ
        .mockResolvedValueOnce([[]]) // NYSE
        .mockResolvedValueOnce([[]]) // OTHER
        .mockResolvedValueOnce([[]]); // TREASURY
      
      const filesDue = await manager.checkRefreshNeededOnStartup();
      
      expect(Array.isArray(filesDue)).toBe(true);
      expect(filesDue.length).toBeGreaterThan(0);
    });

    test('checkRefreshNeededOnStartup should return empty array when nothing due', async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 24);
      
      mockConnection.query
        .mockResolvedValueOnce([[{ last_refresh_status: 'SUCCESS', next_refresh_due_at: futureDate }]])
        .mockResolvedValueOnce([[{ last_refresh_status: 'SUCCESS', next_refresh_due_at: futureDate }]])
        .mockResolvedValueOnce([[{ last_refresh_status: 'SUCCESS', next_refresh_due_at: futureDate }]])
        .mockResolvedValueOnce([[{ last_refresh_status: 'SUCCESS', next_refresh_due_at: futureDate }]]);
      
      const filesDue = await manager.checkRefreshNeededOnStartup();
      
      expect(filesDue).toEqual([]);
    });
  });

  describe('Stale In-Progress Cleanup', () => {
    test('cleanupStaleInProgress should update old IN_PROGRESS records', async () => {
      mockConnection.query.mockResolvedValueOnce([{ affectedRows: 2 }]);
      
      const cleaned = await manager.cleanupStaleInProgress();
      
      expect(cleaned).toBe(2);
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('IN_PROGRESS')
      );
    });

    test('cleanupStaleInProgress should return 0 when no stale records', async () => {
      mockConnection.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
      
      const cleaned = await manager.cleanupStaleInProgress();
      
      expect(cleaned).toBe(0);
    });
  });

  describe('Initialize Refresh Status', () => {
    test('initializeRefreshStatus should create records for all file types', async () => {
      mockConnection.query.mockResolvedValue([{}]);
      
      await manager.initializeRefreshStatus();
      
      expect(mockConnection.query).toHaveBeenCalledTimes(4); // One per file type
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT IGNORE'),
        expect.arrayContaining(['NASDAQ'])
      );
    });
  });

  describe('Database Connection Management', () => {
    test('all async methods should release connection after use', async () => {
      mockConnection.query.mockResolvedValueOnce([[]]);
      
      await manager.isRefreshDue('NASDAQ');
      
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('connection should be released even on query error', async () => {
      mockConnection.query.mockRejectedValueOnce(new Error('Query failed'));
      
      try {
        await manager.getRefreshStatus('NASDAQ');
      } catch (e) {
        // Expected error
      }
      
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('getConnection should be called for each operation', async () => {
      mockConnection.query.mockResolvedValueOnce([[]]);
      
      await manager.getAllRefreshStatus();
      
      expect(mockPool.getConnection).toHaveBeenCalled();
    });
  });

  describe('Integration Scenarios', () => {
    test('typical refresh workflow: mark in progress -> success', async () => {
      mockConnection.query.mockResolvedValue([{}]);
      
      await manager.markRefreshInProgress('NASDAQ');
      expect(manager.isRefreshInProgress('NASDAQ')).toBe(true);
      
      await manager.markRefreshSuccess('NASDAQ', 10000, 500, 100);
      expect(manager.isRefreshInProgress('NASDAQ')).toBeFalsy();
    });

    test('typical refresh workflow: mark in progress -> failure -> retry', async () => {
      mockConnection.query.mockResolvedValue([{}]);
      
      await manager.markRefreshInProgress('NYSE');
      await manager.markRefreshFailed('NYSE', 'Connection timeout');
      expect(manager.isRefreshInProgress('NYSE')).toBeFalsy();
      
      // Later, check if due again
      mockConnection.query.mockResolvedValueOnce([
        [{ last_refresh_status: 'FAILED', next_refresh_due_at: new Date(0) }]
      ]);
      const isDue = await manager.isRefreshDue('NYSE');
      expect(isDue).toBe(true);
    });
  });
});
