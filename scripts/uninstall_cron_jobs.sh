#!/bin/bash
# uninstall_cron_jobs.sh
# Remove metadata refresh cron jobs
# Usage: ./scripts/uninstall_cron_jobs.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "=================================="
echo "Metadata Cron Jobs Uninstaller"
echo "=================================="
echo ""

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Check if crontab exists
if ! command -v crontab &> /dev/null; then
  echo -e "${RED}Error: crontab command not found${NC}"
  exit 1
fi

# Check if there are any wealth tracker cron jobs
if ! crontab -l 2>/dev/null | grep -q "Wealth Tracker Metadata"; then
  echo -e "${YELLOW}No Wealth Tracker cron jobs found${NC}"
  exit 0
fi

echo -e "${YELLOW}Found Wealth Tracker cron jobs:${NC}"
echo ""
crontab -l 2>/dev/null | grep -A 10 "Wealth Tracker Metadata"
echo ""

# Ask for confirmation
read -p "Do you want to remove these cron jobs? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Uninstallation cancelled"
  exit 0
fi

# Backup existing crontab
echo -e "${YELLOW}Backing up existing crontab...${NC}"
crontab -l > "$PROJECT_DIR/config/crontab.backup.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true

# Remove the cron jobs
echo -e "${YELLOW}Removing cron jobs...${NC}"
crontab -l 2>/dev/null | grep -v "Wealth Tracker Metadata" | grep -v "metadata_.*\.log" | crontab -

echo ""
echo -e "${GREEN}✓ Cron jobs removed successfully!${NC}"
echo ""
echo "Backup saved to:"
echo "  $PROJECT_DIR/config/crontab.backup.*"
