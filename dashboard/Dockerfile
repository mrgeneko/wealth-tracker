FROM node:22-alpine

# Install PM2 globally
RUN npm install -g pm2

WORKDIR /app

COPY dashboard/package*.json ./
RUN npm install

# Copy application files
COPY dashboard/ .
COPY api/ /api/
COPY services/ /services/
COPY scripts/ /app/scripts/
COPY ecosystem.config.json /app/

# Create logs directory
RUN mkdir -p /app/logs

ENV NODE_PATH=/app/node_modules

EXPOSE 3001

# Start both dashboard server and PM2 metadata worker
CMD ["sh", "-c", "pm2-runtime start ecosystem.config.json --env production & node server.js"]
