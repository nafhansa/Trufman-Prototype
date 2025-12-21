FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production --no-audit --no-fund
COPY . .
EXPOSE 3001
CMD ["node", "index.js"]
