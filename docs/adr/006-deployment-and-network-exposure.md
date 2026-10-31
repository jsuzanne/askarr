# ADR 006 — Déploiement Docker, topologie LAN et exposition via Cloudflare Access

- **Statut :** `PROPOSED FOR G2`
- **Date :** 2026-10-30
- **Décideurs :** Architecte & Propriétaire Homelab

## 1. Contexte
L'infrastructure homelab est répartie sur deux hôtes Linux principaux sur le LAN `192.168.1.0/24` :
- **`nucvillers` (`192.168.1.163`)** : Héberge le serveur **Plex de référence** (`:32400`), moins chargé que `nucbuntu`, ainsi que les applications web existantes protégées par Cloudflare Access (`transistor` sur `:4870`, `potecast` sur `:3000`, `gazetflix-beta` sur `:8089`).
- **`nucbuntu` (`192.168.1.154`)** : Héberge la stack d'acquisition (`Overseerr` `:5055`, `Radarr` `:7878`, `Sonarr` `:8989`, `Prowlarr` `:9696`).
- Tous les serveurs Plex (`nucvillers`, `nucbuntu`, `macmini`, `macmini m4`, `eq12`) montent en NFS le même stockage Synology.

Le propriétaire souhaite exposer **Askarr** derrière une application **Cloudflare Access** dédiée nommée `askarr` avec une policy `allow askarr-user`.

## 2. Options considérées

| Option | Avantages | Inconvénients |
|---|---|---|
| **Option A : Conteneur Docker unique (`askarr`) déployable sur `nucvillers` (recommandé) ou `nucbuntu` derrière Cloudflare Tunnel / Reverse Proxy + Cloudflare Access** | Même modèle opérationnel que `transistor` et `potecast` sur `nucvillers`, un seul port HTTP interne (ex. `:4880`), accès direct ultra-rapide (`< 1 ms`) au Plex de référence sur `nucvillers:32400` et accès LAN (`< 2 ms`) à `nucbuntu:5055/7878/8989/9696`, aucune exposition publique des services internes. | Nécessite que l'hôte choisisse un port libre (ex. `4880`) relié à l'entrée Cloudflare Access `askarr`. |
| **Option B : Stack multi-conteneurs (Frontend Nginx + Backend Node + Redis + Postgres)** | Découplage théorique. | Complexité opérationnelle disproportionnée pour le homelab. |

## 3. Décision retenue
Nous retenons **l'Option A : Conteneur Docker monolithique léger `askarr` (multi-stage build Node 22 Alpine, exécuté en utilisateur non-root `node`)**, conçu pour tourner sur **`nucvillers` (`192.168.1.163`)** (ou `nucbuntu`) avec un fichier `docker-compose.yml` autonome.

### Configuration réseau et sécurité périmétrique :
1. **Serveur Plex de référence :** `PLEX_BASE_URL=http://192.168.1.163:32400` (`nucvillers`).
2. **Services d'acquisition :**
   - `OVERSEERR_BASE_URL=http://192.168.1.154:5055`
   - `RADARR_BASE_URL=http://192.168.1.154:7878`
   - `SONARR_BASE_URL=http://192.168.1.154:8989`
   - `PROWLARR_BASE_URL=http://192.168.1.154:9696`
3. **Protection Cloudflare Access (`askarr` / `allow askarr-user`) :**
   - Tout trafic externe passe par Cloudflare Access qui authentifie l'utilisateur et signe l'en-tête `Cf-Access-Jwt-Assertion`.
   - Le backend Askarr valide systématiquement ce JWT via `CF_ACCESS_TEAM_DOMAIN` et `CF_ACCESS_AUD` (aucune requête non signée n'est acceptée en production, à l'exception de l'endpoint minimal de sonde locale `GET /api/health/live` qui ne renvoie que `{"status":"ok"}`).

## 4. Conséquences
- **Positives :** Déploiement en une commande (`docker compose up -d`), alignement total avec l'architecture de `potecast` et `transistor`, décharge de `nucbuntu`.
- **Négatives / Garde-fous :** Le conteneur ne monte aucun partage NFS média (il n'a aucun besoin d'accéder aux fichiers vidéo bruts sur le Synology, tout passe par les API HTTP de `Plex`, `Overseerr`, `Radarr`, `Sonarr` et `Prowlarr`).
