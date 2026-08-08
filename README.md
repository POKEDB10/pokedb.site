# pokedb.site — Developer Tools & Storage Platform

A modular, high-performance web platform and API hub built with Node.js, Express, and Vanilla CSS/JS. Designed for seamless extensibility, `pokedb.site` provides high-speed URL shortening, vector QR code generation, and 25 GB file transfer storage powered by Rootz API.

---

## Core Suite

### 1. TinyURL Shortener (`/tools/tinyurl/`)
- Custom URL alias claiming with conflict handling (`/custom-alias`).
- Configurable link expiration rules (1 Day, 7 Days, 30 Days [Default], or Permanent).
- Non-sequential hash generation and rate limiting.
- Automatic vector QR Code generator with SVG and PNG export capabilities.

### 2. Drop Storage Gateway (`/tools/drop/`)
- **Rootz API Uploads**: Files are staged temporarily on local disk while being sent to Rootz, then removed in a `finally` cleanup step.
- **25 GB File Transfers**: Supports large file uploads with password protection for files exceeding 1 GB.
- **Upload Telemetry**: Real-time upload speed calculation (MB/s), transfer progress, estimated time remaining, and drop box status badge.
- **Media Landing Page (`/v/:fileId`)**: File transfer landing card featuring direct download, mobile QR modal, and download counter telemetry.

### 3. QR Studio (`/tools/qr/`)
- Custom foreground and background color selection.
- High-resolution SVG and PNG export engine.
- Instant live preview with custom scale controls.

### 4. Dynamic Theme Engine
- Includes 12 curated color palettes: Paper (Light), Matrix (Green), Cyberpunk (Cyan), Synthwave, Nordic Ice, Dracula, Gruvbox, Emerald, Sunset, Solarized, OLED Pitch Black, and Tokyo Neon.

---

## Modular Architecture: Adding New Tools

`pokedb.site` is architected as an expandable developer tool suite. Adding a new tool involves two main steps:

### 1. Frontend Tool Scaffold
Create a directory under `/tools/[your-tool-name]/public/`:
```text
tools/
├── [your-tool-name]/
│   └── public/
│       ├── index.html
│       └── app.js
```
Link shared resources in your HTML:
```html
<link rel="stylesheet" href="/shared/theme.css">
<script src="/shared/theme-switcher.js"></script>
```

### 2. Express Backend Integration
Register your tool routes and API endpoints in `server.js`:
```javascript
// Serve tool static frontend
app.use('/tools/[your-tool-name]', express.static(path.join(__dirname, 'tools/[your-tool-name]/public')));

// Define tool API endpoints
app.post('/api/[your-tool-name]/action', async (req, res) => {
  // Implementation logic
});
```

---

## Security & Privacy Standards

- **Temporary Upload Staging**: Files are deleted from local disk immediately after each Rootz upload attempt, including failures.
- **Secrets Isolation**: Environment variables and sensitive data (`data/config.json`, `data/store.json`, `.env`) are ignored via `.gitignore`.
- **SSRF & Path Traversal Protection**: Remote URL fetches strictly block private IPs (`localhost`, `127.0.0.1`, `10.x.x.x`, `192.168.x.x`).
- **Rate Limiting & Security Headers**: Includes Helmet HTTP security headers, CORS origin controls, and Express rate limiting.

---

## Local Development Setup

### 1. Clone & Install
```bash
git clone https://github.com/POKEDB10/pokedb.site.git
cd pokedb.site
npm install
```

### 2. Environment Configuration
Create `data/config.json` (or copy `.env.example` to `.env`):
```json
{
  "BASE_URL": "https://pokedb.site",
  "ROOTZ_API_KEY": "YOUR_ROOTZ_API_KEY_HERE",
  "LARGE_FILE_PASSWORD": "YOUR_PASSWORD_HERE"
}
```

### 3. Run Development Server
```bash
npm start
```
Access the application at `http://localhost:5050`.

---

## Docker Deployment

Run using Docker Compose:
```bash
docker-compose up -d --build
```

---

## Production Deployment (Render / Koyeb / Railway)

1. Push your repository to GitHub.
2. Connect your repository on Render or Koyeb.
3. Configure Environment Variables:
   - `BASE_URL`: `https://pokedb.site`
   - `ROOTZ_API_KEY`: `your-rootz-api-key`
   - `LARGE_FILE_PASSWORD`: `your-password`
4. Map your custom domain (`pokedb.site`) in platform settings.

### Render environment variables

Set these in Render's **Environment** panel; keep secrets out of the repository.

| Variable | Required | Value / purpose |
| --- | --- | --- |
| `NODE_ENV` | Yes | `production` |
| `BASE_URL` | Yes | `https://pokedb.site` |
| `ROOTZ_API_KEY` | For Drop | Your Rootz API key; required for direct and remote uploads. |
| `ADMIN_TOKEN` | For file manager | A long random secret. The Drop manager asks for it before listing account files. |
| `LARGE_FILE_PASSWORD` | For uploads over 1 GB | A strong owner-only password. |
| `ROOTZ_TIMEOUT_MS` | Recommended | `1200000` (20 minutes; max accepted value is 1 hour). |
| `ROOTZ_FOLDER_ID` | Optional | Default Rootz destination folder ID for uploads. |
| `ROOTZ_FOLDER_NAME` | Optional | Use only when a folder ID is unavailable; defaults to `pokedb.site`. |
| `REDIS_URL` | Recommended | Managed Redis connection URL. Without it, the app falls back to local JSON storage, which is not durable on Render. |
| `PORT` | No | Render supplies this automatically. Do not hard-code it. |

`REDIS_PASSWORD` is only needed by the local Docker Compose setup; when deploying to Render, place the password inside `REDIS_URL` instead.

---

## License
Released under the [MIT License](LICENSE). Created by [POKEDB10](https://github.com/POKEDB10).
