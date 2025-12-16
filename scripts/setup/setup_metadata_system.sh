#!/bin/bash
# setup_metadata_system.sh
# Complete setup script for the security metadata system
# Includes error checking, logging, and verification
# Usage: ./scripts/setup_metadata_system.sh [--skip-migrations] [--skip-population] [--populate-popular]

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
SETUP_LOG="$LOG_DIR/metadata_setup_$(date +%Y%m%d_%H%M%S).log"
ERROR_LOG="$LOG_DIR/metadata_setup_errors_$(date +%Y%m%d_%H%M%S).log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Logging functions
log() {
  echo -e "$1" | tee -a "$SETUP_LOG"
}

log_error() {
  echo -e "${RED}$1${NC}" | tee -a "$SETUP_LOG" "$ERROR_LOG"
}

log_success() {
  echo -e "${GREEN}$1${NC}" | tee -a "$SETUP_LOG"
}

log_info() {
  echo -e "${BLUE}$1${NC}" | tee -a "$SETUP_LOG"
}

log_warning() {
  echo -e "${YELLOW}$1${NC}" | tee -a "$SETUP_LOG"
}

# Parse arguments
SKIP_MIGRATIONS=false
SKIP_POPULATION=false
POPULATE_POPULAR=false

for arg in "$@"; do
  case $arg in
    --skip-migrations)
      SKIP_MIGRATIONS=true
      ;;
    --skip-population)
      SKIP_POPULATION=true
      ;;
    --populate-popular)
      POPULATE_POPULAR=true
      ;;
  esac
done

# Header
log ""
log "================================================================"
log "Security Metadata System Setup"
log "================================================================"
log "Started: $(date)"
log "Log file: $SETUP_LOG"
log "Error log: $ERROR_LOG"
log ""

# Step 1: Check prerequisites
log_info "Step 1: Checking prerequisites..."

# Check if Docker is running
if ! docker ps &> /dev/null; then
  log_error "✗ Docker is not running"
  log_error "Please start Docker and try again"
  exit 1
fi
log_success "✓ Docker is running"

# Check if MySQL container is running
if [ -z "$(docker compose ps -q mysql)" ]; then
  log_error "✗ MySQL service/container is not running"
  log_error "Please run: docker compose up -d"
  exit 1
fi
log_success "✓ MySQL container is running"

# Check if Node.js is available
if ! command -v node &> /dev/null; then
  log_error "✗ Node.js is not installed"
  log_error "Please install Node.js and try again"
  exit 1
fi
log_success "✓ Node.js is installed ($(node --version))"

# Check if required scripts exist
REQUIRED_SCRIPTS=(
  "scripts/sql/002_create_securities_metadata.sql"
  "scripts/sql/003_create_securities_earnings.sql"
  "scripts/sql/004_create_securities_dividends.sql"
  "scripts/sql/005_add_positions_metadata_link.sql"
  "scripts/populate/populate_securities_metadata.js"
)

for script in "${REQUIRED_SCRIPTS[@]}"; do
  if [ ! -f "$PROJECT_DIR/$script" ]; then
    log_error "✗ Required file not found: $script"
    exit 1
  fi
done
log_success "✓ All required scripts found"

log ""

# Step 2: Run migrations
if [ "$SKIP_MIGRATIONS" = false ]; then
  log_info "Step 2: Running database migrations..."
  
  MIGRATION_FILES=(
    "scripts/sql/002_create_securities_metadata.sql"
    "scripts/sql/003_create_securities_earnings.sql"
    "scripts/sql/004_create_securities_dividends.sql"
    "scripts/sql/005_add_positions_metadata_link.sql"
  )
  
  for migration in "${MIGRATION_FILES[@]}"; do
    log "  Running $(basename $migration)..."
    
    if docker compose exec -T mysql mysql -uroot -proot wealth_tracker < "$PROJECT_DIR/$migration" >> "$SETUP_LOG" 2>> "$ERROR_LOG"; then
      log_success "  ✓ $(basename $migration) completed"
    else
      log_error "  ✗ $(basename $migration) failed"
      log_error "  Check error log: $ERROR_LOG"
      exit 1
    fi
  done
  
  log_success "✓ All migrations completed successfully"
else
  log_warning "⊘ Skipping migrations (--skip-migrations flag)"
fi

log ""

# Step 3: Verify tables were created
log_info "Step 3: Verifying database schema..."

EXPECTED_TABLES=(
  "securities_metadata"
  "securities_earnings"
  "securities_dividends"
)

TABLES_OUTPUT=$(docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SHOW TABLES;" 2>> "$ERROR_LOG")

for table in "${EXPECTED_TABLES[@]}"; do
  if echo "$TABLES_OUTPUT" | grep -q "$table"; then
    log_success "  ✓ Table '$table' exists"
  else
    log_error "  ✗ Table '$table' not found"
    exit 1
  fi
done

# Check if metadata_symbol column was added to positions
COLUMN_CHECK=$(docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SHOW COLUMNS FROM positions LIKE 'metadata_symbol';" 2>> "$ERROR_LOG")

if echo "$COLUMN_CHECK" | grep -q "metadata_symbol"; then
  log_success "  ✓ Column 'metadata_symbol' added to positions table"
else
  log_error "  ✗ Column 'metadata_symbol' not found in positions table"
  exit 1
fi

log_success "✓ Database schema verified"
log ""

# Step 4: Check existing data
log_info "Step 4: Checking existing data..."

POSITION_COUNT=$(docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SELECT COUNT(*) FROM positions;" 2>> "$ERROR_LOG" | tail -1)
log "  Positions in database: $POSITION_COUNT"

if [ "$POSITION_COUNT" -gt 0 ]; then
  UNIQUE_SYMBOLS=$(docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SELECT COUNT(DISTINCT ticker) FROM positions WHERE ticker IS NOT NULL AND ticker != 'CASH';" 2>> "$ERROR_LOG" | tail -1)
  log "  Unique symbols: $UNIQUE_SYMBOLS"
  
  # Show sample symbols
  log "  Sample symbols:"
  docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SELECT DISTINCT ticker FROM positions WHERE ticker IS NOT NULL AND ticker != 'CASH' LIMIT 5;" 2>> "$ERROR_LOG" | tail -n +2 | while read symbol; do
    log "    - $symbol"
  done
else
  log_warning "  No positions found in database"
fi

log ""

# Step 5: Populate metadata for existing positions
if [ "$SKIP_POPULATION" = false ] && [ "$POSITION_COUNT" -gt 0 ]; then
  log_info "Step 5: Populating metadata for existing positions..."
  log "  This may take a few minutes depending on the number of symbols..."
  log ""
  
  cd "$PROJECT_DIR"
  
  if node scripts/populate/populate_securities_metadata.js --all >> "$SETUP_LOG" 2>> "$ERROR_LOG"; then
    log_success "✓ Metadata population completed"
    
    # Check how many were populated
    METADATA_COUNT=$(docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SELECT COUNT(*) FROM securities_metadata;" 2>> "$ERROR_LOG" | tail -1)
    log "  Securities in metadata table: $METADATA_COUNT"
  else
    log_error "✗ Metadata population failed"
    log_error "Check error log: $ERROR_LOG"
    exit 1
  fi
else
  log_warning "⊘ Skipping metadata population"
fi

log ""

# Step 6: Optionally populate popular securities
if [ "$POPULATE_POPULAR" = true ]; then
  log_info "Step 6: Populating popular securities (S&P 500, ETFs, Trending)..."
  log "  This will take several minutes due to rate limiting..."
  log ""
  
  cd "$PROJECT_DIR"
  
  if node scripts/populate/populate_popular_securities.js --all >> "$SETUP_LOG" 2>> "$ERROR_LOG"; then
    log_success "✓ Popular securities population completed"
  else
    log_error "✗ Popular securities population failed"
    log_error "Check error log: $ERROR_LOG"
    # Don't exit - this is optional
  fi
else
  log_info "Step 6: Skipping popular securities population"
  log "  To populate later, run:"
  log "    node scripts/populate/populate_popular_securities.js --all"
fi

log ""

# Step 7: Final verification
log_info "Step 7: Final verification..."

# Check record counts
log "  Database record counts:"
docker compose exec mysql mysql -uroot -proot wealth_tracker -e "
  SELECT 'positions' as table_name, COUNT(*) as count FROM positions
  UNION ALL
  SELECT 'securities_metadata', COUNT(*) FROM securities_metadata
  UNION ALL
  SELECT 'securities_earnings', COUNT(*) FROM securities_earnings
  UNION ALL
  SELECT 'securities_dividends', COUNT(*) FROM securities_dividends;
" 2>> "$ERROR_LOG" | tee -a "$SETUP_LOG"

# Check positions linked to metadata
LINKED_COUNT=$(docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SELECT COUNT(*) FROM positions WHERE metadata_symbol IS NOT NULL;" 2>> "$ERROR_LOG" | tail -1)
log ""
log "  Positions linked to metadata: $LINKED_COUNT"

# Show sample metadata
log ""
log "  Sample metadata records:"
docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SELECT symbol, short_name, quote_type, exchange, currency FROM securities_metadata LIMIT 5;" 2>> "$ERROR_LOG" | tee -a "$SETUP_LOG"

log ""
log_success "✓ Final verification completed"

# Summary
log ""
log "================================================================"
log "Setup Complete!"
log "================================================================"
log "Completed: $(date)"
log ""
log_success "✓ Database migrations applied"
log_success "✓ Schema verified"
if [ "$SKIP_POPULATION" = false ] && [ "$POSITION_COUNT" -gt 0 ]; then
  log_success "✓ Metadata populated for existing positions"
fi
if [ "$POPULATE_POPULAR" = true ]; then
  log_success "✓ Popular securities populated"
fi
log ""
log "Logs saved to:"
log "  Setup log: $SETUP_LOG"
if [ -s "$ERROR_LOG" ]; then
  log_warning "  Error log: $ERROR_LOG (contains warnings/errors)"
else
  log "  Error log: $ERROR_LOG (empty - no errors)"
fi
log ""
log "Next steps:"
log "  1. Set up cron jobs: ./scripts/install_cron_jobs.sh"
log "  2. Integrate API endpoints into your dashboard"
log "  3. Run tests: ./scripts/run_tests.sh --all"
log ""
log "For more information, see:"
log "  - docs/METADATA_SYSTEM_COMPLETE.md"
log "  - docs/METADATA_API_INTEGRATION.md"
log ""
