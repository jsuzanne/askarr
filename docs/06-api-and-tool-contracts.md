# 06 — Contrats d'API REST & Contrats d'Outils IA (Porte G2)

- **Statut :** `READY FOR REVIEW (G2)`
- **Date de mise à jour :** 2026-10-30
- **Périmètre :** Spécification formelle des outils exposés à `DeepSeek` (*Function Calling*) et des endpoints HTTP REST du backend Askarr, incluant la gestion des états `unknown`, des disponibilités partielles, de la provenance, des jetons à usage unique et de la reprise sur timeout.

---

## 1. Principes transverses des contrats

1. **Plafonds d'appels par tour utilisateur :**
   - Nombre maximal de tours d'outils IA par message : **`MAX_TOOL_ROUNDS = 3`**.
   - Nombre maximal d'appels Prowlarr par tour : **`MAX_PROWLARR_CALLS_PER_TURN = 1`**.
   - Nombre maximal d'écritures directes par le LLM : **`0` (strictement interdit)**.
2. **Représentation explicite de l'incertitude (`unknown`) et du partiel (`partially_available`) :**
   - Si un connecteur expire ou renvoie une erreur (`5xx`/`401`), le champ d'état correspondant dans `MediaEvidence` vaut `'unknown'` et `provenance[]` indique `status: 'error' | 'timeout'`. Le LLM a l'interdiction formelle d'assimiler `'unknown'` à `'not_in_catalog'`.
   - Pour les séries, chaque saison porte son propre état (`available_on_plex`, `partially_available`, `requested_or_monitored`, `not_requested`).
3. **Provenance obligatoire :**
   - Toute réponse d'outil retourne le tableau `provenance` listant les sources réellement interrogées (`overseerr`, `plex_nucvillers`, `radarr`, `sonarr`, `prowlarr`) avec leur temps de réponse.

---

## 2. Contrats des Outils IA (`DeepSeek Tool Calling`)

### 2.1 `search_and_check_media`
- **Objectif :** Rechercher un film ou une série (en français ou en VO) et récupérer simultanément sa disponibilité réelle sur le Plex de référence (`nucvillers:32400`), l'état de demande dans `Overseerr` (`nucbuntu:5055`) et l'état de surveillance + dates de sortie dans `Radarr`/`Sonarr` (`nucbuntu:7878`/`:8989`).
- **Permission requise :** `friend` ou `admin` (authentifié via Cloudflare Access).
- **Limite d'appel :** Max `2` par tour utilisateur.
- **Schéma d'entrée (JSON Schema / Zod) :**
  ```json
  {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "minLength": 1,
        "maxLength": 120,
        "description": "Titre du film ou de la série recherché (FR ou VO)"
      },
      "mediaType": {
        "type": "string",
        "enum": ["movie", "tv", "auto"],
        "description": "Type de média si précisé par l'utilisateur, sinon 'auto'"
      },
      "year": {
        "type": "integer",
        "description": "Année de sortie optionnelle pour départager des homonymes"
      }
    },
    "required": ["query", "mediaType"],
    "additionalProperties": false
  }
  ```
- **Schéma de sortie :**
  ```typescript
  interface SearchAndCheckMediaOutput {
    query: string;
     exactMatchFound: boolean;
    disambiguationRequired: boolean; // true si >1 candidat pertinent
    candidates: MediaEvidence[];     // Maximum 5 candidats enrichis (modèle 8 dimensions)
  }
  ```
- **Comportement sur homonymes :** Si plusieurs œuvres correspondent (ex. *Dune* 1984, *Dune : Première Partie* 2021, *Dune : Deuxième partie* 2024, *Dune : Prophecy* 2024), `disambiguationRequired` vaut `true` et le frontend affiche automatiquement les cartes visuelles de sélection.

---

### 2.2 `get_series_seasons_detail`
- **Objectif :** Obtenir le détail exact saison par saison et épisode par épisode d'une série identifiée par son `tmdbId` en croisant `Overseerr`, `Plex nucvillers` (`/library/metadata/:rk/children`) et `Sonarr` (`/api/v3/series?tvdbId=...`).
- **Permission requise :** `friend` ou `admin`.
- **Limite d'appel :** Max `2` par tour.
- **Schéma d'entrée :**
  ```json
  {
    "type": "object",
    "properties": {
      "tmdbId": { "type": "integer", "description": "Identifiant TMDB de la série" }
    },
    "required": ["tmdbId"],
    "additionalProperties": false
  }
  ```
- **Schéma de sortie :** Objet `MediaEvidence` complet avec `episodeCoverage.seasons[]` détaillé et `actionability.requestableSeasons`.

---

### 2.3 `diagnose_media_acquisition`
- **Objectif :** Expliquer pourquoi un film ou une série déjà demandé n'est pas encore sur Plex (vérifie la file d'attente `queue` et l'historique `history` de Radarr/Sonarr, les dates de sortie `inCinemas`/`digitalRelease`/`physicalRelease`, et exécute si pertinent **1 recherche filtrée Prowlarr** `categories=2000|5000`).
- **Permission requise :** `friend` (vue résumée non technique) ou `admin` (vue détaillée).
- **Limite d'appel :** **Max `1` par tour utilisateur** (`MAX_PROWLARR_CALLS_PER_TURN = 1`).
- **Schéma d'entrée :**
  ```json
  {
    "type": "object",
    "properties": {
      "tmdbId": { "type": "integer" },
      "mediaType": { "type": "string", "enum": ["movie", "tv"] },
      "checkIndexers": {
        "type": "boolean",
        "description": "True uniquement si le média est déjà sorti mais non trouvé par Radarr/Sonarr"
      }
    },
    "required": ["tmdbId", "mediaType", "checkIndexers"],
    "additionalProperties": false
  }
  ```
- **Garantie de sécurité :** Les champs `guid`, `downloadUrl` et `infoUrl` de Prowlarr sont purgés par le connecteur avant le retour de l'outil.

---

### 2.4 `get_my_requests`
- **Objectif :** Lister les demandes Overseerr de l'utilisateur courant enrichies avec leur état réel dans Plex (multi-serveurs `NucVillers` / `NucBuntu`) et Radarr/Sonarr (progression de téléchargement ou date de sortie VOD/DVD estimée).
- **Permission requise :** `friend` (uniquement ses demandes via son `overseerrUserId`) ou `admin`.
- **Limite d'appel :** Max `1` par tour.
- **Schéma d'entrée :** `{ "limit": { "type": "integer", "default": 10 } }`.

---

### 2.4b `discover_and_recommend_media`
- **Objectif :** Conseiller l'ami sur des films ou séries selon ses goûts (genre, ambiance, note IMDb/TMDB minimale, similarité avec une œuvre appréciée), soit parmi **les films/séries déjà présents sur les serveurs Plex** (ex. bibliothèque `Films`, `Cinephile`, `Séries TV`, `Horror`...), soit parmi les nouveautés/tendances TMDB via Overseerr, tout en vérifiant systématiquement leur disponibilité immédiate (Plex) ou future (Radarr/Overseerr + date de sortie VOD/DVD).
- **Permission requise :** `friend` ou `admin`.
- **Limite d'appel :** Max `1` par tour.
- **Schéma d'entrée :**
  ```json
  {
    "type": "object",
    "properties": {
      "scope": {
        "type": "string",
        "enum": ["on_plex_now", "similar_to_title", "discover_by_genre_or_trending"],
        "description": "'on_plex_now' pour conseiller des œuvres déjà sur Plex, 'similar_to_title' pour des recommandations proches d'un titre, 'discover_by_genre_or_trending' pour explorer par genre/tendance"
      },
      "mediaType": {
        "type": "string",
        "enum": ["movie", "tv", "auto"]
      },
      "genre": {
        "type": "string",
        "description": "Genre recherché en français ou anglais (ex: 'Science-Fiction', 'Thriller', 'Comédie', 'Horreur', 'Cinéphile')"
      },
      "similarToTmdbId": {
        "type": "integer",
        "description": "ID TMDB de l'œuvre de référence si scope='similar_to_title'"
      },
      "minRating": {
        "type": "number",
        "default": 7.0,
        "description": "Note minimale souhaitée sur 10 (IMDb / TMDB)"
      },
      "plexLibraryFilter": {
        "type": "string",
        "description": "Filtre optionnel sur une bibliothèque Plex spécifique (ex: 'Cinephile', 'Films', 'Horror', 'Enfants')"
      }
    },
    "required": ["scope", "mediaType"],
    "additionalProperties": false
  }
  ```
- **Schéma de sortie :** Liste de `MediaEvidence[]` (max 6 suggestions) triées par pertinence/note (`ratings.imdbOrAudienceRating` / `ratings.tmdbVoteAverage`), chacune enrichie avec ses genres, son casting, son synopsis FR, sa disponibilité Plex exacte (serveur + bibliothèque) ou sa date de sortie VOD/DVD.

---

### 2.5 `prepare_media_request`
- **Objectif :** Préparer une carte de confirmation à usage unique pour un film ou des saisons précises d'une série **uniquement après désambiguïsation complète**.
- **Permission requise :** `friend` ou `admin` **avec compte Plex lié dans Overseerr (`overseerrUserId != null`)**.
- **Limite d'appel :** Max `1` par tour. **N'exécute aucune écriture dans Overseerr.**
- **Schéma d'entrée :**
  ```json
  {
    "type": "object",
    "properties": {
      "tmdbId": { "type": "integer", "description": "ID TMDB unique confirmé" },
      "mediaType": { "type": "string", "enum": ["movie", "tv"] },
      "seasons": {
        "type": "array",
        "items": { "type": "integer", "minimum": 1 },
        "description": "Numéros des saisons demandées (obligatoire si mediaType='tv', vide si 'movie')"
      }
    },
    "required": ["tmdbId", "mediaType", "seasons"],
    "additionalProperties": false
  }
  ```
- **Règles de refus immédiat lors de la préparation :**
  - Si l'utilisateur n'est pas rattaché à un client Plex dans Overseerr → retourne `status: "BLOCKED_UNLINKED_USER"`.
  - Si le film ou toutes les saisons demandées sont déjà sur Plex (`nucvillers`) → retourne `status: "BLOCKED_ALREADY_AVAILABLE"`.
  - Si le film ou les saisons sont déjà demandés dans Overseerr ou déjà `monitored: true` dans Radarr/Sonarr → retourne `status: "BLOCKED_ALREADY_REQUESTED"` avec la date de sortie estimée.
  - Si valide → insère une ligne `PENDING` dans `prepared_actions` (TTL 10 minutes) et retourne l'objet `ConfirmationCardPayload` contenant `actionToken`.

---

## 3. Contrats des Endpoints HTTP REST (`/api/*`)

### 3.1 Identité & Session
- **`GET /api/me`**
  - **Auth :** JWT Cloudflare Access (`Cf-Access-Jwt-Assertion`).
  - **Réponse `200 OK` :**
    ```json
    {
      "email": "ami@exemple.fr",
      "role": "friend",
      "overseerr": {
        "linked": true,
        "overseerrUserId": 22,
        "plexUsername": "AmiPlex",
        "userType": 1
      },
      "aiMode": "active"
    }
    ```

### 3.2 Conversation & Recherche Directe (Mode Hybride)
- **`POST /api/chat/messages`**
  - **Corps :** `{ "conversationId"?: string, "message": string }`
  - **Réponse `200 OK` :**
    ```json
    {
      "conversationId": "uuid",
      "reply": "Réponse en français naturel...",
      "mediaCards": [ /* MediaEvidence[] */ ],
      "confirmationCard": {
        "actionToken": "uuid-v4-single-use",
        "actionType": "OVERSEERR_REQUEST_MOVIE",
        "titleFr": "Dune : Troisième partie",
        "originalTitle": "Dune: Part Three",
        "year": 2026,
        "tmdbId": 1170608,
        "seasons": [],
        "expiresAt": "2026-10-30T23:05:00.000Z"
      },
      "provenance": [
        { "source": "overseerr", "status": "ok", "latencyMs": 210 },
        { "source": "plex_nucvillers", "status": "ok", "latencyMs": 52 },
        { "source": "radarr", "status": "ok", "latencyMs": 48 }
      ]
    }
    ```
- **`GET /api/media/search?q=...&type=auto`**
  - Endpoint déterministe (0 token IA) interrogeant directement l'agrégateur (`Overseerr` + `Plex nucvillers` + `Radarr/Sonarr`). Utilisé par la barre de recherche rapide et en fallback automatique si DeepSeek est indisponible.

### 3.3 Préparation, Confirmation à usage unique, Concurrence et Reprise sur Timeout
- **`POST /api/actions/prepare`** *(0 token IA — clic direct sur une carte média ou sélecteur de saisons)*
  - **Corps :** `{ "actionType": "OVERSEERR_REQUEST_MOVIE" | "OVERSEERR_REQUEST_TV", "tmdbId": number, "seasons"?: number[] }`
  - **Réponse `201 Created` :** Retourne la `confirmationCard` avec son `actionToken` UUID v4 valable 10 minutes.

- **`POST /api/actions/:token/confirm`** *(Exécution de l'écriture — 0 token IA)*
  - **Protocole serveur complet :**
    1. **Vérification d'identité et de propriété :** `req.user.email === prepared_action.actor_email`.
    2. **Verrouillage atomique SQLite :** Transition `PENDING -> EXECUTING`.
       - Si déjà `COMPLETED` (ex. double clic mobile) : renvoie **`200 OK`** avec `{ "status": "COMPLETED", "idempotentReplay": true, "result": ... }`.
       - Si déjà `EXECUTING` : renvoie **`409 Conflict`**.
       - Si `EXPIRED` ou `CANCELLED` : renvoie **`410 Gone`**.
    3. **Revalidation serveur juste avant écriture :**
       - Ré-interroge en direct `Plex (nucvillers:32400)` et `Overseerr (nucbuntu:5055)` (ainsi que `Radarr`/`Sonarr`).
       - Si l'œuvre a été demandée ou ajoutée entre le moment de la préparation et le clic de confirmation, passe le jeton à `SUPERSEDED` et retourne **`200 OK`** `{ "status": "SUPERSEDED", "messageFr": "Bonne nouvelle : ce média vient tout juste d'être demandé, aucun doublon n'a été créé." }`.
    4. **Exécution vers Overseerr :**
       - `POST http://192.168.1.154:5055/api/v1/request` avec `{ "mediaType": "movie"|"tv", "mediaId": tmdbId, "seasons": seasons, "userId": actorOverseerrId }`.
    5. **Gestion sûre des timeouts post-écriture :**
       - Si l'appel HTTP vers Overseerr expire (`TimeoutError`) ou coupe la connexion, le serveur **ne réessaie pas le `POST`**. Il interroge `GET /api/v1/movie/:tmdbId` (ou `/tv/:tmdbId`) pour vérifier si la demande a été enregistrée :
         - Si oui → marque `COMPLETED` et journalise la récupération post-timeout.
         - Si non → marque `FAILED_RETRYABLE` et invite l'utilisateur à réessayer proprement.

- **`POST /api/actions/:token/cancel`**
  - Marque le jeton `CANCELLED` (`200 OK`).

### 3.4 Suivi des demandes
- **`GET /api/requests/mine`**
  - Retourne les demandes de l'ami connecté (`requestedBy.id === user.overseerrUserId`), enrichies en temps réel avec le statut Radarr/Sonarr (`downloading`, `monitored_waiting_release` avec `digitalRelease`/`physicalRelease`) et la présence sur `Plex nucvillers`.

### 3.5 Administration (`admin` uniquement — RBAC strict)
- **`GET /api/admin/health`** : État détaillé et latence de `plex_nucvillers`, `overseerr`, `radarr`, `sonarr`, `prowlarr`, `cloudflare`, `deepseek`.
- **`GET /api/admin/cloudflare/access`** : Liste les e-mails actuellement autorisés dans la policy/groupe `askarr-user`, enrichis du statut de correspondance Overseerr/Plex (`linkedPlexUser: true/false`, `plexUsername`).
- **`POST /api/admin/cloudflare/access/prepare`** : Prépare l'ajout ou le retrait d'un e-mail (`CF_ACCESS_ADD_EMAIL` / `CF_ACCESS_REMOVE_EMAIL`), bloque toute suppression d'un e-mail `ADMIN_EMAILS`, vérifie si l'e-mail existe dans Overseerr (`userType: 1`), et renvoie un `actionToken` de confirmation avec aperçu du diff (`+ami@exemple.fr` ou `-ami@exemple.fr`).
- **`POST /api/admin/cloudflare/access/rollback/:revisionId`** : Restaure atomiquement le snapshot JSON d'une révision précédente de `cf_policy_revisions`.
- **`GET /api/admin/audit`** & **`GET /api/admin/llm-usage`** : Journal d'audit complet et statistiques de consommation de tokens DeepSeek.
