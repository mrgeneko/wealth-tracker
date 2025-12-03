# Exchange Data Update Script

This script automatically checks for and updates NASDAQ and NYSE listing data from the official GitHub repositories.

## Overview

The script downloads the latest CSV files from:
- **NASDAQ**: https://github.com/datasets/nasdaq-listings
- **NYSE**: https://github.com/datasets/nyse-other-listings

## Features

- ✅ Automatically detects when updates are needed by comparing line counts
- ✅ Creates backups of existing files before updating
- ✅ Provides detailed information about current and updated files
- ✅ Handles download errors gracefully
- ✅ Simple command-line interface

## Usage

### Check Current File Information
```bash
node scripts/update_exchange_data.js info
```

### Check for and Apply Updates
```bash
node scripts/update_exchange_data.js update
```

### Show Help
```bash
node scripts/update_exchange_data.js help
```

## File Locations

- **NASDAQ data**: `config/nasdaq-listed.csv`
- **NYSE data**: `config/nyse-listed.csv`
- **Backups**: Created with timestamp in `config/` directory (e.g., `nasdaq-listed.csv.backup.17647729312093`)

## Update Detection

The script determines if an update is needed by:
1. Comparing the number of lines in the local vs remote files
2. If the line counts differ, the file is considered outdated
3. The script will then download the new version and replace the local file

## Automatic Updates

To set up automatic updates, you can:

### Using cron (Linux/macOS)
Add this to your crontab (`crontab -e`) to run weekly:
```bash
# Update exchange data every Sunday at 2 AM
0 2 * * 0 cd /Users/gene/VS Code/wealth-tracker && node scripts/update_exchange_data.js update
```

### Using launchd (macOS)
Create a plist file at `~/Library/LaunchAgents/com.wealth-tracker.exchange-data-updater.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.wealth-tracker.exchange-data-updater</string>
    <key>ProgramArguments</key>
    <array>
        <string>node</string>
        <string>/Users/gene/VS Code/wealth-tracker/scripts/update_exchange_data.js</string>
        <string>update</string>
    </array>
    <key>StartInterval</key>
    <integer>604800</integer> <!-- 7 days in seconds -->
    <key>WorkingDirectory</key>
    <string>/Users/gene/VS Code/wealth-tracker</string>
</dict>
</plist>
```

Then load it with:
```bash
launchctl load ~/Library/LaunchAgents/com.wealth-tracker.exchange-data-updater.plist
```

## Integration with Application

The updated files are automatically used by the `exchange_registry.js` module. After running the update script, the exchange data will be available immediately to your application.

## Troubleshooting

### Network Issues
If you encounter network errors, the script will report them and continue with the next file. You can run the script again later.

### Permission Issues
Ensure the script has write permissions to the `config/` directory.

### Large File Sizes
The script handles files of reasonable size. If you encounter issues with very large files, consider implementing incremental updates or using a different approach.