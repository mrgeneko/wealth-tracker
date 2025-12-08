# Cron Job Re-installation Guide

## Adjusting the Schedule

If you want to change when the metadata refresh jobs run, you have two options:

### Option 1: Edit Template and Re-run Installer (Recommended)

1. **Edit the template:**
   ```bash
   nano config/metadata_cron.conf
   ```

2. **Change the schedule** (see cron syntax below)

3. **Re-run the installer:**
   ```bash
   ./scripts/install_cron_jobs.sh
   ```
   
   The script will:
   - Detect existing jobs
   - Ask if you want to replace them
   - Remove old jobs
   - Install new jobs with updated schedule

### Option 2: Edit Crontab Directly

```bash
# Edit your crontab
crontab -e

# Find the lines under "# Wealth Tracker Metadata Refresh Jobs"
# Change the schedule
# Save and exit
```

---

## Cron Syntax Reference

```
* * * * * command
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, Sunday is 0 or 7)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

### Common Examples

```bash
# Every day at 3:30 AM
30 3 * * *

# Every Monday at 6 AM
0 6 * * 1

# Every 6 hours
0 */6 * * *

# Twice a day (6 AM and 6 PM)
0 6,18 * * *

# First day of every month
0 0 1 * *

# Every weekday at 9 AM
0 9 * * 1-5

# Every 30 minutes
*/30 * * * *
```

---

## Example Schedule Adjustments

### Current Default Schedule

```
0 2 * * *   Daily portfolio (2 AM)
0 3 * * 0   S&P 500 (Sunday 3 AM)
0 4 * * 0   ETFs (Sunday 4 AM)
0 5 * * *   Trending (5 AM)
0 1 1 * *   Full refresh (1st of month, 1 AM)
```

### Example: More Frequent Updates

```
0 */6 * * *   Portfolio every 6 hours
0 6 * * *     S&P 500 daily at 6 AM
0 7 * * *     ETFs daily at 7 AM
0 */4 * * *   Trending every 4 hours
0 0 1 * *     Full refresh (unchanged)
```

### Example: Less Frequent (Lower Load)

```
0 3 * * *     Portfolio daily at 3 AM
0 4 * * 0,3   S&P 500 twice a week (Sun, Wed)
0 5 * * 0     ETFs weekly (Sunday)
0 6 * * *     Trending daily at 6 AM
0 2 1 * *     Full refresh (unchanged)
```

### Example: Business Hours Only

```
0 9 * * 1-5   Portfolio weekdays at 9 AM
0 10 * * 1    S&P 500 Monday at 10 AM
0 11 * * 1    ETFs Monday at 11 AM
0 */2 9-17 * * 1-5  Trending every 2 hours during business hours
0 8 1 * *     Full refresh (unchanged)
```

---

## Testing Your Changes

After updating the schedule:

1. **Verify installation:**
   ```bash
   crontab -l
   ```

2. **Test manually first:**
   ```bash
   # Run the command that will be executed by cron
   cd /path/to/wealth-tracker && node scripts/populate_securities_metadata.js --all
   ```

3. **Monitor the next scheduled run:**
   ```bash
   # Check when jobs will run next
   # (macOS/Linux may vary)
   crontab -l | grep -v "^#"
   
   # Watch the log file
   tail -f logs/metadata_daily.log
   ```

---

## Rollback

If you need to restore a previous schedule:

```bash
# List available backups
ls -lt config/crontab.backup.*

# Restore a backup
crontab config/crontab.backup.20251207_203000

# Verify
crontab -l
```

---

## Best Practices

1. **Always backup** - The installer does this automatically
2. **Test manually first** - Ensure the command works before scheduling
3. **Stagger jobs** - Don't run all jobs at the same time
4. **Consider API limits** - More frequent = more API calls
5. **Monitor logs** - Check for errors after schedule changes
6. **Document changes** - Note why you changed the schedule

---

## Troubleshooting

### Jobs Running Too Frequently

**Symptom:** Rate limiting errors in logs

**Solution:**
- Reduce frequency
- Increase `POPULAR_SECURITIES_DELAY_MS`
- Stagger job times

### Jobs Not Running

**Check crontab syntax:**
```bash
crontab -l
# Look for typos
```

**Check system time:**
```bash
date
# Ensure timezone is correct
```

**Check cron daemon:**
```bash
# macOS
sudo launchctl list | grep cron

# Linux
systemctl status cron
```

---

## Quick Reference

```bash
# Edit template
nano config/metadata_cron.conf

# Re-install (safe to re-run)
./scripts/install_cron_jobs.sh

# Verify
crontab -l

# View logs
tail -f logs/metadata_daily.log

# Uninstall
./scripts/uninstall_cron_jobs.sh
```
