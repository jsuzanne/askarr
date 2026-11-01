# Quick Start Guide — Askarr

This guide walks you through setting up and running **Askarr** on your own hardware using Docker Compose or Node.js.

---

## 1. Prerequisites

Before installing Askarr, ensure you have:

- **Docker Engine 24+** and **Docker Compose v2+** (recommended), or **Node.js 22 LTS** for a bare-metal setup.
- At least one active **Plex Media Server** with an administrator token (`X-Plex-Token`).
- An active instance of **Overseerr** (or Jellyseerr) with an API key.
- At least one **LLM API key** from a supported provider:
  - **Google Gemini** (Gemini 2.5 Flash)
  - **Groq Cloud** (Llama 3.3 70B Versatile)
  - **Mistral AI** (Mistral Small)
  - **OpenRouter** (OpenRouter free or paid models)
  - **DeepSeek** (DeepSeek Chat `deepseek-chat`)

> **Note**: Optional integrations such as Radarr, Sonarr, Prowlarr, Tracearr, Cloudflare Access, and Discord can be connected later via the Admin UI.

---

## 2. Docker Compose Installation (Recommended)

### Step 1: Clone the Repository

```bash
git clone https://github.com/jsuzanne/askarr.git
cd askarr
```

### Step 2: Prepare Environment File

```bash
cp .env.example .env
```

Edit `.env` with your preferred text editor (`nano .env` or `vim .env`) and configure the minimal variables:

```ini
# Core
NODE_ENV=production
PORT=4880
SQLITE_DB_PATH=/app/data/askarr.db

# Administrator Email (must match your Plex/Cloudflare email)
ADMIN_EMAILS=admin@yourdomain.com

# Local LAN access without Cloudflare Access
ALLOW_LAN_ADMIN_FALLBACK=true

# Plex Media Server (format: Name|URL separated by commas)
PLEX_SERVERS=Plex-Main|http://192.168.1.50:32400
PLEX_TOKEN=your_plex_token_here

# Overseerr
OVERSEERR_BASE_URL=http://192.168.1.60:5055
OVERSEERR_API_KEY=your_overseerr_api_key_here

# At least one AI Provider Key (example with Gemini and DeepSeek)
GEMINI_API_KEY=your_gemini_api_key_here
DEEPSEEK_API_KEY=your_deepseek_api_key_here
```

### Step 3: Create the Data Directory and Launch

```bash
mkdir -p data
docker compose up -d --build
```

> **Pre-built Images**: A pre-built Docker image for `linux/amd64` is published to GitHub Container Registry at `ghcr.io/jsuzanne/askarr:latest`. On ARM64 hardware (such as Raspberry Pi 5 or Apple Silicon), `docker compose up -d --build` compiles the image locally in approximately 60 seconds.

### Step 4: Verify Installation

Open your browser and navigate to:
```
http://localhost:4880
```

Verify that the health check responds with HTTP 200:
```bash
curl -f http://localhost:4880/api/health/live
```
Expected output:
```json
{"status":"ok","service":"askarr","phase":"G4_FULL_WRITE_AND_CF_SYNC","timestamp":"..."}
```

---

## 3. Initial Configuration & First Steps

1. **Access the Admin Interface**:
   - Because `ALLOW_LAN_ADMIN_FALLBACK=true` is enabled for local networks, you will automatically log in as the email defined in `ADMIN_EMAILS`.
   - Click **🎬 RÉGIE ADMIN** in the top navigation bar.

2. **Check Connected Services ("Santé Projecteurs")**:
   - Open the **Santé Projecteurs** tab.
   - Verify that your Plex server(s) and Overseerr show green status badges with low latency.

3. **Configure Additional Services ("Paramètres & Identités")**:
   - Add Radarr, Sonarr, Prowlarr, or Tracearr URLs and API keys directly in the web UI.
   - Click **Enregistrer** to persist settings into SQLite. Changes take effect immediately without restarting the container.

4. **Test the Conversational Chat**:
   - Switch back to **🍿 GRAND CINÉMA** mode.
   - Ask a question such as: *"Quels sont les derniers films primés à Cannes ?"* or *"As-tu Inception sur Plex ?"*.

---

## 4. Bare-Metal Development Setup

If you prefer running Askarr directly with Node.js:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Start development servers
# Terminal 1: Backend Fastify server (port 4880)
npm run dev

# Terminal 2: Frontend Vite dev server (port 5173 with HMR)
npm run dev:client
```

Open `http://localhost:5173` to access the Vite development environment.

---

## 5. Troubleshooting Common Issues

| Issue | Likely Cause | Resolution |
| :--- | :--- | :--- |
| `HTTP 401: AUTH_REQUIRED` | Cloudflare header missing and LAN fallback disabled | Set `ALLOW_LAN_ADMIN_FALLBACK=true` in `.env` if testing on a local LAN without Cloudflare Access. |
| `Plex servers unreachable` | Incorrect URL or token | Ensure the URL includes `http://` and port `:32400`. Verify `X-Plex-Token` in Plex Web settings. |
| `Overseerr 401 Unauthorized` | Invalid API key | Generate a fresh API key in Overseerr under **Settings → General → API Key**. |
| `LLM rate limit (HTTP 429)` | Free-tier quota exceeded | Configure multiple providers (Gemini, Groq, Mistral) with `cascade_free_first` routing mode so Askarr automatically fails over to the next provider. |
| `Port 4880 already in use` | Another service is using port 4880 | Set `ASKARR_PORT=4881` in your `.env` file and restart. |
