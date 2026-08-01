# self-hosted tools hub — pokedb.site

Part 1: Containerized URL Shortener + Dynamic QR Code Generator with shared 12-theme system.

---

## Architecture Overview

```
/tools
  /shared
    theme.css          <- 12 custom theme tokens & shared visual primitives
    theme-switcher.js  <- LocalStorage theme manager & themeChanged event emitter
  /shorten
    server.js          <- Express + Redis backend (app.set('trust proxy', 1))
    package.json
    Dockerfile
    public/
      index.html       <- Terminal UI (Shortener + Standalone QR generator)
      app.js           <- Client-side QRCode.js canvas/SVG rendering & API client
    tests/
      server.test.js   <- Jest + Supertest suite (7 assertion categories)
  docker-compose.yml   <- Node.js App + Redis 7 persistent storage
  README.md
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for Express server |
| `REDIS_URL` | `redis://redis:6379` | Connection URI for Redis instance |
| `BASE_URL` | `https://pokedb.site` | Domain prefix used to generate short URLs |

---

## Local Development & Container Launch

### 1. Run using Docker Compose (One-Command)

```bash
cd tools
docker-compose up -d --build
```

Access UI at `http://localhost:3000/tools/shorten/`.

### 2. Run Local Tests (Jest + Supertest)

```bash
cd tools/shorten
npm install
npm test
```

---

## Nginx Reverse Proxy Configuration

To serve the UI under `/tools/shorten/` while allowing short links to resolve directly at root (`pokedb.site/xyz`), configure your Nginx location blocks side-by-side:

```nginx
server {
    server_name pokedb.site;

    # 1. UI & API endpoints (prefix stripped via trailing slash)
    location /tools/shorten/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 2. Root static portfolio & short-link redirects (GET /:code)
    location / {
        # Try static homepage files first, fallback to shortener container for GET /:code
        try_files $uri $uri/ @shortener;
    }

    location @shortener {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
