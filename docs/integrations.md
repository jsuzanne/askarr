# Integrations Matrix & Connector Guide — Askarr

Askarr acts as an intelligent discovery layer and request gateway between your users and your existing media infrastructure. It does not replace your services; rather, it coordinates with them via official REST APIs.

---

## 1. Connector Overview & Requirements Matrix

| Service | Role in Askarr | Status | Impact if Not Configured |
| :--- | :--- | :--- | :--- |
| **Plex Media Server** | Library indexing, live availability verification, user library scoping, direct watch links | **Mandatory** | The application cannot verify media presence or generate watch links. |
| **Overseerr / Jellyseerr** | Search queries, request submission, quota enforcement, request status tracking | **Mandatory** | Users cannot search metadata or submit media requests. |
| **AI Providers** *(Gemini, Groq, Mistral, OpenRouter, DeepSeek)* | Conversational search interpretation, intent parsing, semantic recommendations | **Mandatory** *(≥1)* | Askarr activates `runDirectSearchFallback` (deterministic keyword search via TMDB & Plex/Overseerr). |
| **Radarr** | Movie release tracking, monitored status verification, root folder availability | **Optional** | Askarr queries Overseerr for movie state; cinema release dates and granular file tracking unavailable. |
| **Sonarr** | Television episode monitoring, missing season breakdown, per-season request routing | **Optional** | Askarr treats TV shows at the series level via Overseerr rather than per-season status. |
| **Prowlarr** | Indexer health checking and tracker connectivity diagnostics | **Optional** | Admin diagnostics will omit indexer operational status. |
| **Tracearr** | Active stream monitoring, playback telemetry, personalized recommendations based on Plex watch history | **Optional** | Recommendations rely strictly on LLM semantic matching and Overseerr trending data. |
| **Cloudflare Access** | Zero Trust user authentication, identity header verification, JWT signature validation | **Optional** | Askarr operates in LAN fallback mode (`ALLOW_LAN_ADMIN_FALLBACK=true`) or dev mode (`ALLOW_DEV_AUTH_HEADER=true`). |
| **Discord** | Webhook notifications for new requests, fulfilled media, and administrative alerts | **Optional** | Notifications are retained in the internal database log only. |
| **Google SMTP** | Automated delivery of VIP cinema tickets and invitation emails with access links | **Optional** | Admin must manually share access links with family and friends. |

---

## 2. Mandatory Connectors

### Plex Media Server
Askarr connects to one or more Plex Media Servers using an administrator token.
- **Environment Variables**:
  ```ini
  # Pipe-delimited Name|URL pairs, comma-separated for multi-server setups
  PLEX_SERVERS=Plex-Main|http://192.168.1.50:32400,Plex-4K|http://192.168.1.51:32400
  PLEX_TOKEN=your_plex_token_here
  ```
- **Operational Scope**:
  - Fetches server machine identifiers and section metadata.
  - Queries `plex.tv` friend lists to inspect which specific servers a requesting user is permitted to view.
  - Generates direct deep links to the Plex web or client application.
  - **Security Guarantee**: A user is *never* shown that a title is available on a server they do not have explicit Plex permission to access.

### Overseerr / Jellyseerr
Overseerr serves as the central metadata hub (interfacing with TMDB) and request state machine.
- **Environment Variables**:
  ```ini
  OVERSEERR_BASE_URL=http://192.168.1.60:5055
  OVERSEERR_API_KEY=your_overseerr_api_key_here
  ```
- **Operational Scope**:
  - Resolves search queries to verified TMDB/TVDB IDs.
  - Handles the two-step confirmation request lifecycle.
  - Reports processing, downloading, and available statuses.

### AI Providers (LLM)
Askarr uses LLMs strictly for understanding conversational language, matching user queries against cinema genres and plot points, and presenting findings with theatrical personality.
- **Configuration**:
  - At least one valid API key in `.env`: `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, or `DEEPSEEK_API_KEY`.
  - Additional keys can be updated at runtime in SQLite via the Admin UI.
  - See [AI Providers Guide](file:///Users/jsuzanne/Github/askarr/docs/ai-providers.md) for routing strategies and resilience controls.

---

## 3. Optional Media Management Connectors

### Radarr (Movies)
- **Environment Variables**:
  ```ini
  RADARR_BASE_URL=http://192.168.1.70:7878
  RADARR_API_KEY=your_radarr_api_key_here
  ```
- **Behavior**:
  - When present, Askarr inspects whether a requested movie is already tracked, monitored, or in the download queue.
  - Displays cinema release dates, digital release dates, and quality profile status in the Admin dashboard.

### Sonarr (TV Shows)
- **Environment Variables**:
  ```ini
  SONARR_BASE_URL=http://192.168.1.71:8989
  SONARR_API_KEY=your_sonarr_api_key_here
  ```
- **Behavior**:
  - Enables granular season-level queries: e.g., identifying that Season 1 is available on Plex while Season 2 is currently missing or downloading.

### Prowlarr (Indexers)
- **Environment Variables**:
  ```ini
  PROWLARR_BASE_URL=http://192.168.1.72:9696
  PROWLARR_API_KEY=your_prowlarr_api_key_here
  ```
- **Behavior**:
  - Provides health metrics and response latency for configured Usenet and torrent indexers in the Admin dashboard.

---

## 4. Optional Telemetry & Notification Connectors

### Tracearr (Telemetry & History)
- **Environment Variables**:
  ```ini
  TRACEARR_BASE_URL=http://192.168.1.75:3000
  TRACEARR_API_KEY=your_tracearr_api_key_here
  ```
- **Behavior**:
  - Pulls Plex viewing patterns and active streams to feed personalized conversational suggestions (e.g., "Because you recently watched Inception...").

### Discord Webhooks
- **Environment Variables**:
  ```ini
  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your/webhook/url
  ```
- **Behavior**:
  - Emits formatted notifications with posters, user metadata, and action links when a request is submitted, approved, or fulfilled.

### Google SMTP (VIP Tickets)
- **Environment Variables**:
  ```ini
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USER=your_email@gmail.com
  SMTP_PASS=your_app_specific_password
  SMTP_FROM="Askarr Cinema <your_email@gmail.com>"
  ```
- **Behavior**:
  - Sends branded "VIP Cinema Ticket" invitations containing personalized access tokens and onboarding guides to invited family members.

---

## 5. Runtime Configuration via Admin UI

All connector URLs, tokens, and credentials can be initialized in `.env` and subsequently fine-tuned at runtime in the **Régie (Admin UI)**.

- **Storage**: Runtime overrides are stored in the local SQLite database (`askarr.db`).
- **Precedence**: SQLite database values override `.env` defaults without requiring container restarts.
- **Redaction**: API keys and tokens are masked with SHA-256 hashes in API responses, ensuring credentials are never exposed in browser inspector tools.
