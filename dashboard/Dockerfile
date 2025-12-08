FROM node:18-alpine

WORKDIR /app

COPY dashboard/package*.json ./
RUN npm install

COPY dashboard/ .
COPY api/ /api/

ENV NODE_PATH=/app/node_modules

EXPOSE 3001

CMD ["node", "server.js"]
