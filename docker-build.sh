#!/bin/bash
# Docker build script with BuildKit optimizations

# Enable BuildKit
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Build with docker-compose
echo "Building with BuildKit enabled..."
docker-compose build "$@"
