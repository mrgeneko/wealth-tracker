#!/bin/bash
# install_cron_jobs.sh
# Install metadata refresh cron jobs
# Usage: ./scripts/install_cron_jobs.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "=================================="
echo "Metadata Cron Jobs Installer"
echo "=================================="
echo ""

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRON_TEMPLATE="$PROJECT_DIR/config/metadata_cron.conf"

if [ ! -f "$CRON_TEMPLATE" ]; then
  echo -e "${RED}Error: Cron template not found at $CRON_TEMPLATE${NC}"
  exit 1
fi

# Check if crontab exists
if ! command -v crontab &> /dev/null; then
  echo -e "${RED}Error: crontab command not found${NC}"
  echo "Please install cron on your system"
  exit 1
fi

# Create a temporary file with the cron jobs, replacing /path/to/wealth-tracker with actual path
TEMP_CRON=$(mktemp)
sed "s|/path/to/wealth-tracker|$PROJECT_DIR|g" "$CRON_TEMPLATE" > "$TEMP_CRON"

# Remove comment lines for the actual crontab
grep -v '^#' "$TEMP_CRON" | grep -v '^$' > "${TEMP_CRON}.clean"

echo -e "${YELLOW}The following cron jobs will be installed:${NC}"
echo ""
cat "${TEMP_CRON}.clean"
echo ""

# Check if jobs already exist
EXISTING_JOBS=$(crontab -l 2>/dev/null | grep -c "Wealth Tracker Metadata" || true)

if [ "$EXISTING_JOBS" -gt 0 ]; then
  echo -e "${YELLOW}Found existing Wealth Tracker cron jobs.${NC}"
  echo ""
  read -p "Do you want to replace them with the new schedule? (y/n) " -n 1 -r
  echo ""
  
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation cancelled"
    rm -f "$TEMP_CRON" "${TEMP_CRON}.clean"
    exit 0
  fi
  
  # Remove existing jobs first
  echo -e "${YELLOW}Removing existing jobs...${NC}"
  crontab -l 2>/dev/null | grep -v "Wealth Tracker Metadata" | grep -v "metadata_.*\.log" > "${TEMP_CRON}.existing"
  cat "${TEMP_CRON}.existing" | crontab -
  rm -f "${TEMP_CRON}.existing"
else
  # Ask for confirmation for new installation
  read -p "Do you want to install these cron jobs? (y/n) " -n 1 -r
  echo ""
  
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation cancelled"
    rm -f "$TEMP_CRON" "${TEMP_CRON}.clean"
    exit 0
  fi
fi

# Backup existing crontab
echo -e "${YELLOW}Backing up existing crontab...${NC}"
crontab -l > "$PROJECT_DIR/config/crontab.backup.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true

# Add new cron jobs (append to existing crontab)
echo -e "${YELLOW}Installing cron jobs...${NC}"
(crontab -l 2>/dev/null || true; echo ""; echo "# Wealth Tracker Metadata Refresh Jobs"; cat "${TEMP_CRON}.clean") | crontab -

# Cleanup
rm -f "$TEMP_CRON" "${TEMP_CRON}.clean"

echo ""
echo -e "${GREEN}✓ Cron jobs installed successfully!${NC}"
echo ""
echo "Installed jobs:"
echo "  - Daily portfolio refresh (2 AM)"
echo "  - Weekly S&P 500 refresh (Sunday 3 AM)"
echo "  - Weekly ETF refresh (Sunday 4 AM)"
echo "  - Daily trending refresh (5 AM)"
echo "  - Monthly full refresh (1st of month, 1 AM)"
echo ""
echo "To view your crontab:"
echo "  crontab -l"
echo ""
echo "To remove these jobs:"
echo "  crontab -e"
echo "  (then delete the lines under '# Wealth Tracker Metadata Refresh Jobs')"
echo ""
echo "Logs will be written to:"
echo "  $PROJECT_DIR/logs/metadata_*.log"
