# pokedb.site — High-Performance Developer Tools & Drop Storage Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-black.svg)](https://expressjs.com/)

A modern, terminal-themed developer suite and file storage platform built with Node.js, Express, and Vanilla CSS/JS. Features high-speed URL shortening, QR code generation, and 25 GB file transfer storage powered by Rootz API streaming.

---

## 🚀 Features Showcase

### 1. ⚡ TinyURL Shortener (`/tools/tinyurl/`)
- Custom URL alias claiming with conflict protection (`/Idk-what-this-is`).
- Expiration control (1 Day, 7 Days, 30 Days [Default], or Permanent).
- Non-sequential hash generation & rate limiting.
- Automatic vector QR Code generator with SVG & PNG instant downloads.

### 2. 📦 Drop Storage Gateway (`/tools/drop/`)
- **Rootz API Streaming**: Direct memory-to-cloud streaming (`multer.memoryStorage()`) — zero local disk caching.
- **25 GB File Transfers**: Supports large file uploads with password protection for files > 1 GB.
- **Upload Telemetry**: Real-time upload speed (`⚡ MB/s`), transfer percentage, ETA, and drop-box file status badge.
- **Media Landing Page (`/v/:fileId`)**: Sleek media viewer card featuring direct download, mobile QR modal, and download counter telemetry.

### 3. 🎨 QR Studio (`/tools/qr/`)
- Custom foreground and background color pickers.
- High-resolution SVG and PNG export engine.
- Instant live preview with custom scale controls.

### 4. 🌓 12 Dynamic UI Design Themes
- Includes 12 hand-crafted color palettes: *Paper (Light)*, *Matrix (Green)*, *Cyberpunk (Cyan)*, *Synthwave (80s)*, *Nordic (Ice)*, *Dracula (Violet)*, *Gruvbox (Retro)*, *Emerald*, *Sunset*, *Solarized*, *OLED Pitch Black*, and *Tokyo Neon*.

---

## 🔒 Security & Privacy Built-in

- 🛡️ **Zero Disk Storage**: Files uploaded to Drop Storage stream directly to cloud storage; no temporary files remain on the web server.
- 🔑 **Secrets Isolation**: `data/config.json`, `data/store.json`, and `.env` are protected in `.gitignore`.
- 🌐 **SSRF & Path Traversal Protection**: Remote URL fetches strictly block private IPs (`localhost`, `127.0.0.1`, `10.x.x.x`, `192.168.x.x`).
- ⚡ **Rate Limiting & Security Headers**: Helmet HTTP security headers, CORS origin controls, and Express rate limiting.

---

## 🛠️ Quickstart / Local Setup

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/pokedb.site.git
cd pokedb.site
npm install
```

### 2. Configure Environment
Create `data/config.json` (or copy `.env.example` to `.env`):
```json
{
  "BASE_URL": "https://pokedb.site",
  "ROOTZ_API_KEY": "YOUR_ROOTZ_API_KEY_HERE",
  "LARGE_FILE_PASSWORD": "YOUR_PASSWORD_HERE"
}
```

### 3. Start Development Server
```bash
npm start
```
Open **[http://localhost:5050](http://localhost:5050)** in your browser.

---

## 🐳 Docker Deployment

Run with Docker Compose:
```bash
docker-compose up -d --build
```

---

## 🌐 Deploy to Production (Render / Koyeb / Railway)

1. Push your code to your GitHub repository.
2. Connect your repo on [Render](https://render.com) or [Koyeb](https://koyeb.com).
3. Set Environment Variables:
   - `BASE_URL`: `https://pokedb.site`
   - `ROOTZ_API_KEY`: `your-rootz-api-key`
   - `LARGE_FILE_PASSWORD`: `your-password`
4. Attach your custom domain (`pokedb.site`) in platform settings.

---

## 📜 License
Released under the [MIT License](LICENSE). Created by [POKEDB10](https://github.com/POKEDB10).
