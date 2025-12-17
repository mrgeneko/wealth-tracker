FROM node:22-alpine

# Install PM2 globally
RUN npm install -g pm2

WORKDIR /app

# Copy package files first for better caching
COPY dashboard/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
	npm install

# Copy application files - all under /app for consistent paths
COPY dashboard/ .
COPY api/ /app/api/
COPY services/ /app/services/
COPY scripts/ /app/scripts/
COPY ecosystem.config.json /app/

# Create logs directory
RUN mkdir -p /app/logs

ENV NODE_PATH=/app/node_modules

EXPOSE 3001

# Start both dashboard server and PM2 metadata worker
CMD ["sh", "-c", "pm2-runtime start ecosystem.config.json --env production & node server.js"]
