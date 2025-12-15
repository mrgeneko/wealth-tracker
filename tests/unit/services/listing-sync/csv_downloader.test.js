const path = require('path');

jest.mock('fs/promises');
const fs = require('fs/promises');

const { CsvDownloader, needsUpdate } = require('../../../../services/listing-sync/csv_downloader');

describe('CsvDownloader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('needsUpdate returns true when file missing', async () => {
    fs.stat.mockRejectedValueOnce(new Error('ENOENT'));
    const out = await needsUpdate('/tmp/missing.csv', 'a\nb\n');
    expect(out).toBe(true);
  });

  test('needsUpdate returns false when remote is significantly smaller', async () => {
    fs.stat.mockResolvedValueOnce({});
    fs.readFile.mockResolvedValueOnce('X'.repeat(1000));
    const out = await needsUpdate('/tmp/file.csv', 'X'.repeat(900), { minSizeRatio: 0.99 });
    expect(out).toBe(false);
  });

  test('downloadAndUpdate writes file when update needed', async () => {
    const fetch = jest.fn().mockResolvedValue('h1,h2\nA,B\n');
    const downloader = new CsvDownloader({
      configDir: '/app/config',
      fetch,
      sources: {
        NASDAQ: { url: 'https://example.com/nasdaq.csv', fileName: 'nasdaq-listed.csv' }
      }
    });

    fs.mkdir.mockResolvedValue(undefined);
    fs.stat.mockRejectedValueOnce(new Error('ENOENT')); // file missing
    fs.writeFile.mockResolvedValue(undefined);

    const res = await downloader.downloadAndUpdate('NASDAQ');

    expect(fetch).toHaveBeenCalledWith('https://example.com/nasdaq.csv');
    expect(fs.writeFile).toHaveBeenCalled();
    expect(res.updated).toBe(true);
    expect(res.path).toBe(path.join('/app/config', 'nasdaq-listed.csv'));
  });

  test('downloadAndUpdate creates backup when overwriting', async () => {
    const fetch = jest.fn().mockResolvedValue('a\nb\nc\n');
    const downloader = new CsvDownloader({
      configDir: '/app/config',
      fetch,
      sources: {
        NYSE: { url: 'https://example.com/nyse.csv', fileName: 'nyse-listed.csv' }
      }
    });

    fs.mkdir.mockResolvedValue(undefined);

    // needsUpdate path:
    // - file exists
    // - read local content
    fs.stat
      .mockResolvedValueOnce({}) // fileExists in needsUpdate
      .mockResolvedValueOnce({}); // fileExists before backup

    fs.readFile.mockResolvedValueOnce('a\nb\n');
    fs.copyFile.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);

    const res = await downloader.downloadAndUpdate('NYSE');

    expect(res.updated).toBe(true);
    expect(fs.copyFile).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalled();
  });
});
