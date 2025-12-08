#!/bin/bash
# run_tests.sh
# Test runner script for metadata system
# Usage: ./scripts/run_tests.sh [--unit] [--integration] [--all]

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=================================="
echo "Metadata System Test Runner"
echo "=================================="
echo ""

# Parse arguments
RUN_UNIT=false
RUN_INTEGRATION=false

if [[ "$*" == *"--unit"* ]] || [[ "$*" == *"--all"* ]] || [[ $# -eq 0 ]]; then
  RUN_UNIT=true
fi

if [[ "$*" == *"--integration"* ]] || [[ "$*" == *"--all"* ]]; then
  RUN_INTEGRATION=true
fi

# Check if .env exists
if [ ! -f .env ]; then
  echo -e "${RED}Error: .env file not found${NC}"
  echo "Please create .env with database credentials"
  exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Run unit tests
if [ "$RUN_UNIT" = true ]; then
  echo -e "${YELLOW}Running Unit Tests...${NC}"
  echo ""
  
  if node tests/metadata_api.test.js; then
    echo -e "${GREEN}✓ Unit tests passed${NC}"
    echo ""
  else
    echo -e "${RED}✗ Unit tests failed${NC}"
    exit 1
  fi
fi

# Run integration tests
if [ "$RUN_INTEGRATION" = true ]; then
  echo -e "${YELLOW}Running Integration Tests...${NC}"
  echo ""
  
  if node tests/integration/metadata_population.test.js; then
    echo -e "${GREEN}✓ Integration tests passed${NC}"
    echo ""
  else
    echo -e "${RED}✗ Integration tests failed${NC}"
    exit 1
  fi
fi

echo "=================================="
echo -e "${GREEN}All tests passed!${NC}"
echo "=================================="
