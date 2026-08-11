FROM node:22-alpine

WORKDIR /app

# Copy root package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

RUN addgroup -S app && adduser -S app -G app

# Copy all application files (index.html, server.js, tools/)
COPY . .
RUN chown -R app:app /app

EXPOSE 5050

ENV NODE_ENV=production
ENV PORT=5050

USER app

CMD ["node", "server.js"]
