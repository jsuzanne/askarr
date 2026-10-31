# 10 — Runbook d'Exploitation, Déploiement & Reprise d'Urgence (Porte G2)

- **Statut :** `READY FOR REVIEW (G2)`
- **Date de mise à jour :** 2026-10-30
- **Périmètre :** Installation Docker, variables d'environnement, supervision, sauvegardes SQLite et procédures de rollback (Cloudflare Access & Base de données).

---

## 1. Déploiement Docker sur le Homelab (`nucvillers` recommandé)

À l'image de `transistor` (`:4870`) et `potecast` (`:3000`), le conteneur **Askarr** est conçu pour tourner sur **`nucvillers` (`192.168.1.163`)** sur un port dédié (par exemple **`4880`**) derrière votre tunnel/reverse-proxy Cloudflare Access (`askarr`).

### 1.1 Structure type du `docker-compose.yml` (cible G5)
```yaml
services:
  askarr:
    image: ghcr.io/jsuzanne/askarr:latest
    container_name: askarr
    restart: unless-stopped
    user: "1000:1000"
    ports:
      - "4880:4880"
    env_file:
      - .env
    volumes:
      - ./data:/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4880/api/health/live"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

---

## 2. Référentiel des Variables d'Environnement (`.env.example`)

Aucun secret n'est codé en dur. Le serveur vérifie la présence et le format des variables au démarrage avec Zod :

| Variable | Obligatoire | Valeur par défaut / Exemple Homelab | Description |
|---|---|---|---|
| `NODE_ENV` | Oui | `production` | Mode d'exécution (`production` bloque tout bypass d'auth). |
| `PORT` | Non | `4880` | Port HTTP d'écoute du conteneur. |
| `SQLITE_DB_PATH` | Non | `/data/askarr.db` | Chemin du fichier SQLite (mode WAL). |
| `CF_ACCESS_TEAM_DOMAIN` | Oui (Prod) | `<team>.cloudflareaccess.com` | Domaine Cloudflare Zero Trust (sert à récupérer `/cdn-cgi/access/certs`). |
| `CF_ACCESS_AUD` | Oui (Prod) | `<AUD_TAG_APP_ASKARR>` | Tag Audience (`AUD`) de l'application Cloudflare Access `askarr`. |
| `ADMIN_EMAILS` | Oui | `<email_admin_1>` | Liste d'e-mails administrateurs séparés par virgule (protégés contre le retrait). |
| `PLEX_SERVERS` | Oui | `NucVillers\|http://192.168.1.163:32400,NucBuntu\|http://192.168.1.154:32400` | Liste ordonnée de N serveurs Plex (`Nom\|URL`, extensible à `MacMini`, `EQ12`, etc.). `NucVillers` est interrogé en priorité 1 pour les bibliothèques communes (`Films`, `Séries TV`), et `NucBuntu` (et les suivants) pour les bibliothèques spécialisées (`Cinephile`, `Films 4K`, `Horror`, `Musical`) ou en fallback. |
| `PLEX_BASE_URL` | Non (Rétrocompat.) | `http://192.168.1.163:32400` | Fallback simple si `PLEX_SERVERS` n'est pas renseigné. |
| `PLEX_TOKEN` | Oui | `<SECRET>` | Jeton X-Plex-Token (lecture seule). |
| `OVERSEERR_BASE_URL` | Oui | `http://192.168.1.154:5055` | URL LAN d'Overseerr sur `nucbuntu`. |
| `OVERSEERR_API_KEY` | Oui | `<SECRET>` | Clé API Overseerr. |
| `RADARR_BASE_URL` | Oui | `http://192.168.1.154:7878` | URL LAN de Radarr sur `nucbuntu`. |
| `RADARR_API_KEY` | Oui | `<SECRET>` | Clé API Radarr v3. |
| `SONARR_BASE_URL` | Oui | `http://192.168.1.154:8989` | URL LAN de Sonarr sur `nucbuntu`. |
| `SONARR_API_KEY` | Oui | `<SECRET>` | Clé API Sonarr v3. |
| `PROWLARR_BASE_URL` | Oui | `http://192.168.1.154:9696` | URL LAN de Prowlarr sur `nucbuntu`. |
| `PROWLARR_API_KEY` | Oui | `<SECRET>` | Clé API Prowlarr v1. |
| `CLOUDFLARE_ACCOUNT_ID` | Oui (G4-B) | `<ACCOUNT_ID>` | Identifiant du compte Cloudflare. |
| `CLOUDFLARE_API_TOKEN` | Oui (G4-B) | `<SECRET>` | Jeton API Cloudflare (scope Access Groups / Access Apps). |
| `CF_ACCESS_TARGET_MODE` | Non | `policy` (ou `group`) | Indique si l'admin modifie la policy `allow askarr-user` ou un Access Group dédié. |
| `CF_ACCESS_TARGET_ID` | Oui (G4-B) | `<POLICY_OR_GROUP_UUID>` | UUID de la policy `allow askarr-user` ou du groupe associé. |
| `DEEPSEEK_BASE_URL` | Non | `https://api.deepseek.com` | URL de base de l'API DeepSeek. |
| `DEEPSEEK_API_KEY` | Oui | `<SECRET>` | Clé API DeepSeek. |
| `DEEPSEEK_MODEL` | Non | `deepseek-chat` | Modèle utilisé pour le *tool-calling*. |
| `DEEPSEEK_DAILY_TOKEN_BUDGET` | Non | `250000` | Plafond global de tokens par jour avant bascule en Mode Recherche Directe. |

---

## 3. Supervision & Sondes de Santé (Healthchecks)

1. **`GET /api/health/live` (Public local / Docker Healthcheck) :**
   - Vérifie que le serveur HTTP et la connexion SQLite `/data/askarr.db` répondent en `< 10 ms`.
   - Ne divulgue aucune information sur l'infrastructure (`{"status":"ok"}`).
2. **`GET /api/admin/health` (Réservé `admin`) :**
   - Teste en parallèle (`Promise.allSettled`) :
     - `plex_nucvillers` (`192.168.1.163:32400/identity`)
     - `overseerr` (`192.168.1.154:5055/api/v1/status`)
     - `radarr` (`192.168.1.154:7878/api/v3/system/status`)
     - `sonarr` (`192.168.1.154:8989/api/v3/system/status`)
     - `prowlarr` (`192.168.1.154:9696/api/v1/system/status` + nombre d'indexeurs en backoff)
     - `cloudflare_jwks` & `cloudflare_api`
     - `deepseek` (état du budget quotidien et latence du dernier appel)

---

## 4. Procédures de Sauvegarde, Restauration et Rollback d'Urgence

### 4.1 Sauvegarde et restauration SQLite (`/data/askarr.db`)
- **Sauvegarde automatique :** À chaque démarrage du conteneur avant l'exécution des migrations Drizzle, ainsi que quotidiennement à 04h00, Askarr crée une copie propre via l'API `backup()` de `better-sqlite3` dans `/data/backups/askarr-YYYYMMDD-HHMMSS.db` (conservation des 14 derniers snapshots).
- **Restauration manuelle en 30 secondes :**
  ```bash
  docker stop askarr
  cp ./data/backups/askarr-YYYYMMDD-HHMMSS.db ./data/askarr.db
  rm -f ./data/askarr.db-wal ./data/askarr.db-shm
  docker start askarr
  ```

### 4.2 Rollback d'une modification Cloudflare Access (`allow askarr-user`)
- **Depuis l'interface Admin Askarr (`/admin`) :**
  - Dans l'onglet **Accès Amis (Cloudflare)**, cliquer sur **« Restaurer cette version »** en face de la révision souhaitée dans le tableau `Historique des modifications`. Le backend ré-applique exactement le snapshot JSON `snapshot_before_json` enregistré dans `cf_policy_revisions`.
- **En ligne de commande (si l'interface web est inaccessible) :**
  - Le dernier snapshot complet avant modification est toujours lisible dans SQLite :
    ```bash
    sqlite3 ./data/askarr.db "SELECT snapshot_before_json FROM cf_policy_revisions ORDER BY id DESC LIMIT 1;" > rollback_payload.json
    ```

### 4.3 Désactivation d'urgence de l'IA (Mode Recherche Directe 0 €)
- Si vous souhaitez couper temporairement tout appel vers DeepSeek sans arrêter le portail pour vos amis :
  - Passer `AI_ENABLED=false` dans `.env` (ou via le bouton coupe-circuit dans `/admin`).
  - Le portail reste 100 % fonctionnel en **Mode Recherche Directe** (recherche FR/VO Overseerr + vérification Plex `nucvillers` + dates Radarr/Sonarr + demandes en 1 clic).
