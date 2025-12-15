# Cron Job Installation Guide

## Overview

The `metadata_cron.conf` file contains template cron job definitions for automated metadata refresh. These jobs need to be installed into your system's crontab.

---

## Quick Install

### Automated Installation (Recommended)

```bash
# Install cron jobs
./scripts/install_cron_jobs.sh
```

This script will:
1. Replace `/path/to/wealth-tracker` with your actual project path
2. Show you the jobs that will be installed
3. Ask for confirmation
4. Backup your existing crontab
5. Add the jobs to your crontab

### Manual Installation

If you prefer to install manually:

```bash
# Edit your crontab
crontab -e

# Add these lines (replace /path/to/wealth-tracker with your actual path):
# Daily refresh of portfolio securities (2 AM)
0 2 * * * cd /Users/gene/VS\ Code/wealth-tracker && node scripts/populate_securities_metadata.js --all >> logs/metadata_daily.log 2>&1

# Weekly S&P 500 refresh (Sunday 3 AM)
0 3 * * 0 cd /Users/gene/VS\ Code/wealth-tracker && node scripts/populate_popular_securities.js --sp500 >> logs/metadata_sp500.log 2>&1

# Weekly ETF refresh (Sunday 4 AM)
0 4 * * 0 cd /Users/gene/VS\ Code/wealth-tracker && node scripts/populate_popular_securities.js --etfs >> logs/metadata_etfs.log 2>&1

# Daily trending refresh (5 AM)
0 5 * * * cd /Users/gene/VS\ Code/wealth-tracker && node scripts/populate_popular_securities.js --trending >> logs/metadata_trending.log 2>&1

# Monthly full refresh (1st of month, 1 AM)
0 1 1 * * cd /Users/gene/VS\ Code/wealth-tracker && node scripts/populate_popular_securities.js --all --force >> logs/metadata_monthly.log 2>&1
```

---

## Installed Jobs

Once installed, the following jobs will run automatically:

| Job | Schedule | Command | Log File |
|-----|----------|---------|----------|
| Portfolio Refresh | Daily 2 AM | `populate_securities_metadata.js --all` | `metadata_daily.log` |
| S&P 500 Refresh | Sunday 3 AM | `populate_popular_securities.js --sp500` | `metadata_sp500.log` |
| ETF Refresh | Sunday 4 AM | `populate_popular_securities.js --etfs` | `metadata_etfs.log` |
| Trending Refresh | Daily 5 AM | `populate_popular_securities.js --trending` | `metadata_trending.log` |
| Full Refresh | 1st of month 1 AM | `populate_popular_securities.js --all --force` | `metadata_monthly.log` |

---

## Verify Installation

```bash
# View your crontab
crontab -l

# You should see lines like:
# Wealth Tracker Metadata Refresh Jobs
# 0 2 * * * cd /Users/gene/VS Code/wealth-tracker && ...
```

---

## Monitor Logs

Logs are written to the `logs/` directory:

```bash
# View today's portfolio refresh log
tail -f logs/metadata_daily.log

# View S&P 500 refresh log
tail -f logs/metadata_sp500.log

# Check for errors
grep -i error logs/metadata_*.log
```

---

## Customize Schedule

To change the schedule, edit your crontab:

```bash
crontab -e
```

**Cron syntax:**
```
* * * * * command
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, 0 and 7 are Sunday)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

**Examples:**
```bash
# Every day at 3:30 AM
30 3 * * *

# Every Monday at 6 AM
0 6 * * 1

# First day of every month at midnight
0 0 1 * *

# Every 6 hours
0 */6 * * *
```

---

## Uninstall

### Automated Uninstallation

```bash
# Remove all metadata cron jobs
./scripts/uninstall_cron_jobs.sh
```

This will:
1. Show you the jobs that will be removed
2. Ask for confirmation
3. Backup your crontab
4. Remove the jobs

### Manual Uninstallation

```bash
# Edit your crontab
crontab -e

# Delete the lines under "# Wealth Tracker Metadata Refresh Jobs"
# Save and exit
```

---

## Troubleshooting

### Jobs Not Running

**Check if cron is running:**
```bash
# macOS
sudo launchctl list | grep cron

# Linux
systemctl status cron
```

**Check crontab syntax:**
```bash
crontab -l
# Look for syntax errors
```

**Check logs:**
```bash
# macOS system log
log show --predicate 'process == "cron"' --last 1h

# Linux
grep CRON /var/log/syslog
```

### Permission Issues

Make sure scripts are executable:
```bash
chmod +x scripts/populate_securities_metadata.js
chmod +x scripts/populate_popular_securities.js
```

### Path Issues

Cron runs with a limited PATH. Use absolute paths:
```bash
# Instead of:
node scripts/populate_securities_metadata.js

# Use:
/usr/local/bin/node /full/path/to/scripts/populate_securities_metadata.js
```

Or set PATH in crontab:
```bash
PATH=/usr/local/bin:/usr/bin:/bin
0 2 * * * cd /path/to/wealth-tracker && node scripts/...
```

### Environment Variables

Cron doesn't load your `.env` file automatically. Options:

**Option 1: Source .env in cron command**
```bash
0 2 * * * cd /path/to/wealth-tracker && source .env && node scripts/...
```

**Option 2: Use absolute path to .env**
```bash
0 2 * * * cd /path/to/wealth-tracker && export $(cat .env | xargs) && node scripts/...
```

**Option 3: Set variables in crontab**
```bash
MYSQL_USER=myuser
MYSQL_PASSWORD=mypass
MYSQL_DATABASE=mydb
0 2 * * * cd /path/to/wealth-tracker && node scripts/...
```

---

## Alternative: systemd Timers (Linux)

For Linux systems, you can use systemd timers instead of cron:

### Create Service File

`/etc/systemd/system/metadata-daily.service`:
```ini
[Unit]
Description=Wealth Tracker Daily Metadata Refresh

[Service]
Type=oneshot
User=youruser
WorkingDirectory=/path/to/wealth-tracker
EnvironmentFile=/path/to/wealth-tracker/.env
ExecStart=/usr/bin/node scripts/populate_securities_metadata.js --all
StandardOutput=append:/path/to/wealth-tracker/logs/metadata_daily.log
StandardError=append:/path/to/wealth-tracker/logs/metadata_daily.log
```

### Create Timer File

`/etc/systemd/system/metadata-daily.timer`:
```ini
[Unit]
Description=Run Wealth Tracker Daily Metadata Refresh

[Timer]
OnCalendar=daily
OnCalendar=02:00
Persistent=true

[Install]
WantedBy=timers.target
```

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable metadata-daily.timer
sudo systemctl start metadata-daily.timer

# Check status
sudo systemctl list-timers
```

---

## Best Practices

1. **Monitor logs regularly** - Check for errors weekly
2. **Adjust throttling** - If you hit rate limits, increase delay
3. **Stagger jobs** - Don't run all jobs at the same time
4. **Backup crontab** - Before making changes
5. **Test manually first** - Run scripts manually before scheduling
6. **Use log rotation** - Prevent logs from growing too large

---

## Log Rotation

Create `/etc/logrotate.d/wealth-tracker`:
```
/path/to/wealth-tracker/logs/metadata_*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
}
```

---

## Summary

- **Install:** `./scripts/install_cron_jobs.sh`
- **Verify:** `crontab -l`
- **Monitor:** `tail -f logs/metadata_daily.log`
- **Uninstall:** `./scripts/uninstall_cron_jobs.sh`
