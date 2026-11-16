# Backend Dockerfile
FROM node:24-alpine

WORKDIR /app

COPY backend/package*.json ./

RUN npm ci --omit=dev

COPY backend/ .

# Ensure uploads directory exists
RUN mkdir -p /app/uploads

EXPOSE 5001

CMD ["node", "server.js"]
