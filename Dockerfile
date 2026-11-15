# Backend Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY backend/package*.json ./

RUN npm install --production

COPY backend/ .

# Ensure uploads directory exists
RUN mkdir -p /app/uploads

EXPOSE 5001

CMD ["node", "server.js"]
