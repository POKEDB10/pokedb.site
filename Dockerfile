FROM node:20-alpine

WORKDIR /app

# Copy root package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy all application files (index.html, server.js, tools/)
COPY . .

EXPOSE 5050

ENV NODE_ENV=production
ENV PORT=5050

CMD ["node", "server.js"]
