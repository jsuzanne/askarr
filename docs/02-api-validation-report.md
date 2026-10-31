# 02 — Rapport de qualification des API (Porte G1)

- **Statut global :** `VALIDATED (G1)`
- **Date d'exécution :** 2026-10-30
- **Environnement testé :** Homelab LAN (`nucvillers` `192.168.1.163` pour Plex de référence, `nucbuntu` `192.168.1.154` pour Overseerr/Radarr/Sonarr/Prowlarr) + API Cloudflare Zero Trust + API DeepSeek.
- **Périmètre exécuté :** **Lot 1A** (lectures locales + 1 appel de qualification tool-calling DeepSeek sans effet de bord) et **Lot 1B** (2 recherches ciblées Prowlarr), conformément aux autorisations humaines G0/G1. Aucune écriture (Lot 1C) n'a été déclenchée.
- **Confidentialité :** Toutes les clés API, jetons Plex/Cloudflare/DeepSeek, URLs de téléchargement, passkeys d'indexeurs et adresses e-mail personnelles ont été expurgés.

---

## 1. Synthèse de l'inventaire et verdicts par service

| Service | Hôte / Emplacement | Version exacte observée | Latence observée (LAN/API) | Verdict G1 (Lecture) | Verdict G1 (Écriture) | Commentaire synthétique |
|---|---|---|---|---|---|---|
| **Plex Media Server #1 (Priorité 1)** | `nucvillers` (`192.168.1.163:32400`) | `1.43.5.11029-6bf8af3f0` | `50 ms` (metadata) / `390 ms` (search) | **PASS** | N/A (Lecture seule) | Serveur Plex de priorité 1 (moins chargé que `nucbuntu`) pour les 7 bibliothèques vidéo communes (`Films`, `Séries TV`, `Videodivers`, `Enfants`, `Films Legacy`, `Séries TV Kids`, `True Crimes`). |
| **Plex Media Server #2 (Bibliothèques spécialisées & Fallback)** | `nucbuntu` (`192.168.1.154:32400`) | `1.43.5.11029-6bf8af3f0` | `48 ms` (metadata) / `475–601 ms` (search) | **PASS** | N/A | Expose en plus des bibliothèques communes **4 bibliothèques spécialisées** (`Cinephile`, `Films 4K`, `Horror`, `Musical`). Interrogation multi-serveurs activée dans l'architecture G2. |
| **Overseerr** | `nucbuntu` (`192.168.1.154:5055`) | `1.35.0` | `208–442 ms` | **PASS** | **NOT TESTED** *(Attente Lot 1C / G4)* | Recherche bilingue FR/VO opérationnelle, 128 demandes et 34 utilisateurs (33 clients Plex `userType: 1`, 1 local). Seules 3 bibliothèques Plex sont activées dans Overseerr (voir §3). |
| **Radarr** | `nucbuntu` (`192.168.1.154:7878`) | `6.4.4.10685` | `46–48 ms` (par `tmdbId`) / `1283 ms` (liste complète 1888 films) | **PASS** | N/A (via Overseerr) | Recherche directe `GET /api/v3/movie?tmdbId={id}` ultra-rapide (`48 ms`). Fournit `monitored`, `hasFile`, file d'attente (`queue`), historique (`history`) et dates de sortie (`inCinemas`, `digitalRelease`, `physicalRelease`). |
| **Sonarr** | `nucbuntu` (`192.168.1.154:8989` → `:6789` interne) | `4.0.20.3014` | `98 ms` (par `tvdbId`) / `347 ms` (liste 151 séries) | **PASS** | N/A (via Overseerr) | Recherche directe `GET /api/v3/series?tvdbId={id}` en `98 ms`. Fournit le détail exact par saison et épisode (`episodeFileCount`, `episodeCount`, `monitored`, `previousAiring`/`nextAiring`). |
| **Prowlarr** | `nucbuntu` (`192.168.1.154:9696`) | `2.7.0.5723` | `184 ms` (status) / `930–3296 ms` (search indexeurs) | **PASS** | N/A (Lecture seule) | 8 indexeurs configurés (6 actifs, 1 en backoff). Le filtrage par catégorie (`2000` Films / `5000` TV) est indispensable pour exclure les résultats hors-sujet (ex. jeux PC). |
| **Cloudflare Access** | API Cloudflare (`client/v4`) | API v4 | `1007 ms` | **PASS (Groupes/Listes/JWKS)** | **NOT TESTED** *(Attente Lot 1C / G4)* | Clés publiques JWKS (`/cdn-cgi/access/certs`, 2 clés RSA actives) et lecture des **Access Groups** (`Emaildesamis`, `Famille Suzanne`, `gazetflix`) validées. L'application `askarr` et sa policy `allow askarr-user` seront ciblées en G4. |
| **DeepSeek API** | `api.deepseek.com` | `deepseek-chat` (`deepseek-flash` / `deepseek-v4-pro`) | `388–408 ms` | **PASS** | N/A | `GET /models` (`200 OK`, `408 ms`) et `POST /chat/completions` avec *tool calling* structuré (`200 OK`, `388 ms`, `finish_reason: "tool_calls"`, compteurs `prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`) validés. Clé invalide → `401`. |
| **Tautulli** *(Optionnel)* | `nucvillers` (`:8181` à `:8185`) | `v2.18.2` | `49 ms` | **PASS** | N/A | 5 instances supervisant les 5 serveurs Plex (`NucBuntu`, `NucVillers`, `MacMini`, `ImacMaisonVerte`, `EQ12buntu`). Non requis pour le MVP. |

---

## 2. Preuves détaillées et observations par service

### 2.1 Fédération Multi-Serveurs Plex (`NucVillers:32400`, `NucBuntu:32400` et serveurs additionnels)
- **Documentation de référence :** Plex Media Server HTTP API (`/identity`, `/library/sections`, `/hubs/search`, `/library/metadata/{ratingKey}`, `/library/metadata/{ratingKey}/children`).
- **Décision propriétaire (G1 → G2 — Fédération Multi-Serveurs Plex) :**
  - Tous les serveurs Plex (`nucvillers`, `nucbuntu`, `macmini`, `macmini m4`, `eq12`) partagent les bibliothèques principales **`Films`** et **`Séries TV`** (montées en NFS depuis le NAS Synology).
  - En revanche, certaines bibliothèques spécialisées (comme **`Cinephile`**, **`Films 4K`**, **`Horror`** ou **`Musical`**) ne sont montées/exposées que sur certains serveurs (notamment **`NucBuntu`** `192.168.1.154:32400`).
  - **Répartition exacte observée en G1 sur `GET /library/sections` :**
    - **`NucVillers` (`192.168.1.163:32400`, priorité 1 — moins chargé)** : 7 bibliothèques vidéo (`Films` `key: 1`, `Séries TV` `key: 2`, `Videodivers` `key: 3`, `Enfants` `key: 4`, `Films Legacy` `key: 5`, `Séries TV Kids` `key: 6`, `True Crimes` `key: 7`).
    - **`NucBuntu` (`192.168.1.154:32400`, priorité 2 — bibliothèques spécialisées & haute disponibilité)** : 10 bibliothèques vidéo, incluant les bibliothèques communes (`Films`, `Séries TV`, `Enfants`, `Films Legacy`, `Séries Kids`, `True Crimes`) **plus 4 bibliothèques exclusives** : **`Cinephile` (`key: 3`)**, **`Films 4K` (`key: 29`)**, **`Horror` (`key: 37`)**, **`Musical` (`key: 5`)**.
  - **Architecture retenue :** Le connecteur Plex d'Askarr (`PlexMultiServerConnector`) supporte nativement **N serveurs Plex** configurables (`PLEX_SERVERS`). Il interroge `NucVillers` en priorité 1 pour toutes les recherches courantes (`Films` / `Séries TV` accessibles sur tous les serveurs), et interroge automatiquement `NucBuntu` (et tout autre serveur Plex configuré) dès qu'un média n'est pas dans les bibliothèques communes de `NucVillers` (ou si `NucVillers` est indisponible), en indiquant précisément à l'utilisateur dans quelle bibliothèque et sur quel serveur Plex (`ex. bibliothèque Cinephile sur le serveur NucBuntu`) le film est disponible.
- **Résultats observés sur `nucvillers:32400` :**
  - Authentification via en-tête `X-Plex-Token` + `Accept: application/json` : **`200 OK`** (`50 ms`).
  - Jeton invalide : **`401 Unauthorized`** (distinction nette avec une absence de média).
  - **Résolution bilingue FR / Anglais et homonymes (`PASS`) :**
    - Une recherche sur `"Dune"` (`GET /hubs/search?query=Dune&limit=10&includeGuids=1`) remonte les homonymes et œuvres liées avec leurs identifiants externes exacts dans `Guid` lors de l'appel `GET /library/metadata/{ratingKey}` :
      - *Dune* (1984, section `Films`, `ratingKey: "1"`) → `["imdb://tt0087182", "tmdb://841", "tvdb://1406"]`
      - *Dune : Première Partie* (2021, section `Films`, `ratingKey: "1202"`, `originalTitle: "Dune: Part One"`) → `["imdb://tt1160419", "tmdb://438631", "tvdb://6187"]`
      - *Dune : Deuxième partie* (2024, section `Films`, `ratingKey: "23011"`, `originalTitle: "Dune: Part Two"`) → `["imdb://tt15239678", "tmdb://693134", "tvdb://290272"]`
      - *Dune : Prophecy* (2024, série TV, section `Séries TV`, `ratingKey: "23749"`, `childCount: 1`, `leafCount: 6`) → `["imdb://tt10466872", "tmdb://90228", "tvdb://367118"]`
    - Une recherche sur le titre original anglais `"The Enforcer"` retrouve le film catalogué sous son titre français dans `Films Legacy` (`title: "L'inspecteur ne renonce jamais"`, `originalTitle: "The Enforcer"`, `year: 1976`, `tmdb://10649`).
  - **Observation technique importante sur le filtre `guid` :**
    - Avec le nouvel agent `tv.plex.agents.movie`, le champ racine `guid` vaut `plex://movie/...` tandis que `tmdb://...`, `imdb://...` et `tvdb://...` sont stockés dans le tableau enfant `Guid[]` de `/library/metadata/{ratingKey}`.
    - **Conséquence pour le connecteur Plex :** Pour vérifier de manière infaillible si une œuvre identifiée par son `tmdbId` est sur Plex (quelle que soit la langue saisie par l'utilisateur), le backend résout d'abord l'œuvre via Overseerr/TMDB (qui fournit `tmdbId`, `title` FR, `originalTitle` VO et `year`), interroge `/hubs/search` sur Plex `nucvillers:32400` avec le titre FR et/ou VO, puis vérifie la présence de `tmdb://{tmdbId}` (ou `tvdb://{tvdbId}`) dans `/library/metadata/{ratingKey}`.

```json
// Extrait réel expurgé — GET /library/metadata/23011 sur Plex NucVillers (192.168.1.163:32400)
{
  "ratingKey": "23011",
  "type": "movie",
  "title": "Dune : Deuxième partie",
  "originalTitle": "Dune: Part Two",
  "year": 2024,
  "librarySectionTitle": "Films",
  "librarySectionID": 1,
  "Guid": [
    { "id": "imdb://tt15239678" },
    { "id": "tmdb://693134" },
    { "id": "tvdb://290272" }
  ]
}
```

---

### 2.2 Overseerr (`nucbuntu:5055` — v1.35.0)
- **Documentation de référence :** Overseerr API v1 (`/api/v1/status`, `/api/v1/search`, `/api/v1/movie/{id}`, `/api/v1/tv/{id}`, `/api/v1/request`, `/api/v1/user`, `/api/v1/settings/plex`).
- **Résultats observés :**
  - Version `1.35.0`, connectée à Radarr (`192.168.1.154:7878`, profil `HD VO H265`, dossier `/movies`) et Sonarr (`192.168.1.154:8989`, profil `VO-1080P-H265`, dossier `/tv`).
  - Clé API invalide : retourne **`403 Forbidden`**.
  - **Recherche et désambiguïsation (`GET /api/v1/search?query=...&language=fr`) : `PASS` (`216 ms`)**
    - Retourne à la fois le titre français (`title` / `name`), le titre original (`originalTitle` / `originalName`), l'identifiant TMDB (`id`), le type (`movie` / `tv`), la date de sortie et l'objet `mediaInfo` s'il est connu d'Overseerr.
    - *Note d'encodage :* l'endpoint `/api/v1/search` d'Overseerr exige un encodage URL strict RFC 3986 (`%20` et non `+` pour les espaces).
  - **Utilisateurs (`GET /api/v1/user`) : `PASS`**
    - 34 comptes au total : 33 utilisateurs Plex (`userType: 1`) et 1 utilisateur local (`userType: 2`).
    - Chaque compte possède un `id` interne Overseerr, une adresse `email`, un masque binaire `permissions` et des quotas optionnels (`movieQuotaLimit`, `tvQuotaLimit`).
  - **Demandes existantes (`GET /api/v1/request`) : `PASS`**
    - 128 demandes enregistrées. Les statuts observés sur `request.status` (`2` = APPROVED, `5` = COMPLETED/AVAILABLE) et sur `media.status` (`3` = PROCESSING, `5` = AVAILABLE) distinguent clairement une demande en cours de traitement d'un média disponible, y compris saison par saison (`seasons[].status`).

```json
// Extrait réel expurgé — GET /api/v1/tv/90228?language=fr (Dune : Prophecy)
{
  "id": 90228,
  "name": "Dune : Prophecy",
  "originalName": "Dune: Prophecy",
  "numberOfSeasons": 2,
  "externalIds": {
    "imdbId": "tt10466872",
    "tvdbId": 367118
  },
  "mediaInfo": {
    "status": 5,
    "ratingKey": "81458",
    "externalServiceId": 272,
    "seasons": [
      { "seasonNumber": 0, "status": 1 },
      { "seasonNumber": 1, "status": 5 },
      { "seasonNumber": 2, "status": 1 }
    ]
  }
}
```

---

### 2.3 Radarr (`nucbuntu:7878` — v6.4.4.10685)
- **Documentation de référence :** Radarr API v3 (`/api/v3/system/status`, `/api/v3/movie?tmdbId={id}`, `/api/v3/queue`, `/api/v3/history`).
- **Résultats observés :**
  - **Lookup unitaire par `tmdbId` (`GET /api/v3/movie?tmdbId=22650`) : `PASS` (`48 ms`)**
    - Évite de charger la liste complète des 1 888 films (`1 283 ms`).
  - **Validation du cas d'usage propriétaire (« Pas sur Plex mais dans la liste Radarr + estimation de date de sortie ») : `PASS`**
    - Lorsqu'un film est suivi dans Radarr mais non encore téléchargé (`monitored: true`, `hasFile: false`), Radarr fournit directement :
      - `status` (`announced`, `inCinemas`, `released`),
      - `minimumAvailability` (ex. `released`),
      - `inCinemas` (date de sortie salle),
      - `digitalRelease` (date de sortie VOD / numérique),
      - `physicalRelease` (date de sortie Blu-Ray / DVD).
    - *Exemple réel observé dans votre Radarr :* le film `Vitrival` (`tmdbId: 1012611`) est à `monitored: true`, `hasFile: false`, avec `inCinemas: "2025-11-26T00:00:00Z"` et `digitalRelease: "2026-06-17T00:00:00Z"`. Le copilot pourra donc répondre avec certitude : *« Ce film n'est pas encore sur Plex, mais il est déjà programmé dans la liste d'attente (sortie numérique prévue le 17/06/2026). »*
  - **File d'attente (`GET /api/v3/queue`) et Historique (`GET /api/v3/history`) : `PASS`**
    - Permettent de vérifier si un téléchargement est actif (`trackedDownloadState: "downloading"`, `size`, `sizeleft`, `statusMessages`) ou récemment importé (`downloadFolderImported`, `grabbed`).

```json
// Extrait réel expurgé — Film suivi dans Radarr mais sans fichier (hasFile: false)
{
  "id": 3228,
  "title": "Vitrival",
  "year": 2025,
  "tmdbId": 1012611,
  "status": "released",
  "monitored": true,
  "minimumAvailability": "released",
  "hasFile": false,
  "inCinemas": "2025-11-26T00:00:00Z",
  "physicalRelease": null,
  "digitalRelease": "2026-06-17T00:00:00Z"
}
```

---

### 2.4 Sonarr (`nucbuntu:8989` — v4.0.20.3014)
- **Documentation de référence :** Sonarr API v3 (`/api/v3/system/status`, `/api/v3/series?tvdbId={id}`, `/api/v3/episode?seriesId={id}`, `/api/v3/queue`, `/api/v3/history`).
- **Particularité topologique notée :** Le conteneur `sonarr` écoute en interne sur le port `6789` et est publié sur le port hôte `8989` (`192.168.1.154:8989`).
- **Résultats observés :**
  - **Lookup direct par `tvdbId` (`GET /api/v3/series?tvdbId=81797`) : `PASS` (`98 ms`)**
    - Overseerr fournit `externalIds.tvdbId` lors de la résolution d'une série TMDB, ce qui permet d'interroger Sonarr directement par `tvdbId`.
  - **Couverture partielle par saison : `PASS`**
    - Chaque entrée de `seasons[]` indique `seasonNumber`, `monitored` et `statistics` (`episodeFileCount`, `episodeCount`, `totalEpisodeCount`, `percentOfEpisodes`, `previousAiring`, `nextAiring`).

---

### 2.5 Prowlarr (`nucbuntu:9696` — v2.7.0.5723)
- **Documentation de référence :** Prowlarr API v1 (`/api/v1/system/status`, `/api/v1/indexer`, `/api/v1/indexerstatus`, `/api/v1/search`).
- **Résultats observés :**
  - **Lot 1A (Métadonnées) : `PASS` (`184 ms`)** — 8 indexeurs configurés, 6 activés, 1 en état de backoff temporaire dans `/api/v1/indexerstatus`.
  - **Lot 1B (Recherche contrôlée) : `PASS` (`930 ms` avec résultats / `3 296 ms` sans résultat)**
    - **Observation critique 1 (Filtrage par catégorie) :** Sans paramètre `categories`, une recherche sur `"Dune"` renvoie en premier des jeux vidéo (`categories: ["PC/Games"]`, ex. *Dune: Awakening*). Dans les contrats d'outils G2, tout appel `search_indexers` devra obligatoirement passer `categories=2000` (Films) ou `categories=5000` (Séries TV).
    - **Observation critique 2 (Champs sensibles) :** Les objets retournés contiennent `guid` / `downloadUrl` / `infoUrl` susceptibles d'inclure des clés/passkeys d'indexeurs privés. Ces champs seront systématiquement supprimés par l'adaptateur backend avant tout passage au LLM ou au frontend.

---

### 2.6 Cloudflare Access (API v4)
- **Documentation de référence :** Cloudflare Zero Trust API (`/accounts/{account_id}/access/groups`, `/accounts/{account_id}/access/apps/{app_id}/policies`, `/accounts/{account_id}/rules/lists`, `/accounts/{account_id}/access/organizations`, `https://<auth_domain>/cdn-cgi/access/certs`).
- **Résultats observés :**
  - **Vérification JWKS (`GET https://<auth_domain>/cdn-cgi/access/certs`) : `PASS` (`200 OK`)** — 2 clés publiques RSA actives récupérées pour valider cryptographiquement l'en-tête `Cf-Access-Jwt-Assertion` (même pattern `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` que celui déjà en production sur votre conteneur `potecast` sur `nucvillers`).
  - **Lecture des Access Groups (`GET /accounts/{account_id}/access/groups`) : `PASS` (`200 OK`)**
    - Découverte des groupes d'e-mails existants sur votre compte Cloudflare :
      - `Emaildesamis` (22 adresses e-mail en règle `include`),
      - `Famille Suzanne` (4 adresses e-mail),
      - `gazetflix` (8 adresses e-mail),
      - `MyEmail` (1 adresse e-mail).
  - **Décision propriétaire (G1 → G2) :** Création d'une application Cloudflare Access dédiée `askarr` avec une policy `allow askarr-user` (pouvant s'appuyer soit sur un Access Group dédié, soit directement sur les règles `include: [{ email: { email } }]` de la policy `askarr-user`). Notre adaptateur Cloudflare Access supportera les deux modes par configuration (`CF_ACCESS_TARGET_MODE=group|policy`), tout en conservant intégralement les règles existantes non-email.

---

### 2.7 DeepSeek API (`api.deepseek.com` — `deepseek-chat`)
- **Documentation de référence :** DeepSeek API (compatible OpenAI Chat Completions v1 : `GET /models`, `POST /chat/completions`).
- **Résultats observés :**
  - **Liste des modèles (`GET /models`) : `PASS` (`200 OK`, `408 ms`)** — Modèles exposés : `deepseek-flash`, `deepseek-v4-pro` (et alias `deepseek-chat`).
  - **Qualification *Tool Calling* & Comptabilisation des tokens (`POST /chat/completions`) : `PASS` (`200 OK`, `388 ms`)**
    - Requête utilisateur test : *"Est-ce que tu as le film Dune : Deuxième partie ?"* avec l'outil `search_media` en `temperature: 0.0`.
    - Réponse déterministe : `finish_reason: "tool_calls"`, invocation de `search_media` avec les arguments JSON stricts `{"query": "Dune : Deuxième partie", "media_type": "movie"}`.
    - Objet `usage` complet retourné par l'API : `prompt_tokens: 363`, `completion_tokens: 60`, `total_tokens: 423`, `prompt_cache_hit_tokens: 0`, `prompt_cache_miss_tokens: 363`.
  - **Test négatif (clé invalide) : `PASS` (`401 Unauthorized`, `350 ms`)**.

```json
// Extrait réel — POST /chat/completions sur api.deepseek.com (test 1A.7)
{
  "finish_reason": "tool_calls",
  "tool_calls": [
    {
      "index": 0,
      "id": "call_00_dPA1d5ESIFgDpgZ4Euqo4940",
      "type": "function",
      "function": {
        "name": "search_media",
        "arguments": "{\"query\": \"Dune : Deuxième partie\", \"media_type\": \"movie\"}"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 363,
    "completion_tokens": 60,
    "total_tokens": 423,
    "prompt_tokens_details": { "cached_tokens": 0 },
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 363
  }
}
```

---

## 3. Écarts identifiés entre souhait produit et réalité installée (Arbitrages G1 validés)

| # | Écart observé en G1 | Impact sur le produit | Décision / Compromis retenu pour G2 |
|---|---|---|---|
| **E1** | **Désynchronisation partielle entre Overseerr et Plex** : Seules 3 bibliothèques (`Cinephile`, `Films 4K`, `Séries TV`) sont activées dans Overseerr (`/api/v1/settings/plex`), et certains `ratingKey` stockés dans Overseerr sont obsolètes. | Si le copilot se fiait uniquement à Overseerr, il ignorerait des films présents dans `Films` / `Films Legacy` / `Enfants` ou générerait des liens Plex morts (`404`). | **Retenu :** Overseerr sert à résoudre l'identité TMDB/TVDB (FR + VO) et l'état des demandes, tandis que le connecteur Plex interroge directement le serveur Plex de référence **`nucvillers` (`192.168.1.163:32400`)** (qui partage le même stockage NFS Synology et est moins chargé que `nucbuntu`) en validant le `Guid` `tmdb://{id}` / `tvdb://{id}`. |
| **E2** | **Recherche Prowlarr multi-catégories par défaut** : Une recherche texte simple sur Prowlarr remonte des résultats hors films/séries (`PC/Games`, `Audio`, etc.). | Risque de polluer le diagnostic avec des fichiers qui ne sont ni des films ni des séries. | **Retenu :** Forcer systématiquement le filtre `categories=[2000]` (Movie) ou `categories=[5000]` (TV) côté serveur dans le connecteur Prowlarr et purger `guid`, `downloadUrl`, `infoUrl`. |
| **E3** | **Ciblage Cloudflare Access (`askarr` / `askarr-user`)** : Le propriétaire va créer l'application `askarr` dans Cloudflare Access avec la policy `allow askarr-user` (groupe dédié ou liste d'e-mails sur la policy, comme pour `transistor` et `potecast`). | Le backend doit pouvoir lire et mettre à jour la liste d'e-mails autorisés sans jamais altérer les autres règles de sécurité. | **Retenu :** L'adaptateur Cloudflare Access supporte le mode Groupe (`PUT /accounts/{id}/access/groups/{group_id}`) et le mode Policy d'application (`PUT /accounts/{id}/access/apps/{app_id}/policies/{policy_id}`), et vérifie en amont que tout ami autorisé est bien un client Plex présent dans Overseerr. |
| **E4** | **Rattachement obligatoire de chaque ami à un client Plex / Overseerr** : Le propriétaire a confirmé que tout ami autorisé sur Askarr doit être client Plex et donc exister dans Overseerr (`userType: 1`). | Évite les demandes orphelines ou attribuées au compte admin. | **Retenu :** Correspondance stricte 1-à-1 par e-mail (insensible à la casse) entre le JWT Cloudflare Access (`email`) et l'utilisateur Overseerr (`GET /api/v1/user`). Lors de l'ajout d'un e-mail dans l'admin Cloudflare Access d'Askarr, le backend vérifie également si cet e-mail existe déjà dans Overseerr/Plex et affiche un avertissement clair s'il n'est pas encore invité sur Plex. |

---

## 4. Matrice récapitulative des cas de test G1 (PRD §8.3)

| Cas de test PRD §8.3 | Service(s) | Résultat réel observé | Verdict |
|---|---|---|---|
| **1. Titre connu disponible (FR & VO)** | Overseerr + Plex (`nucvillers`) + Radarr | *Dune : Deuxième partie* (`tmdb://693134`, `ratingKey: 23011` dans `Films` sur `nucvillers`) et *L'inspecteur ne renonce jamais / The Enforcer* (`tmdb://10649`) résolus en FR et en VO avec correspondance exacte des `Guid` dans Plex. | **PASS** |
| **2. Titre connu absent** | Overseerr + Plex + Prowlarr | Chaîne inexistante (`ZzXxNonExistent99998888`) → `200 OK` avec `results: []` (0 résultat, distinct d'une erreur HTTP). | **PASS** |
| **3. Homonymes / œuvres proches** | Overseerr + Plex (`nucvillers`) | Recherche `"Dune"` remonte distinctement *Dune* (1984, `tmdb:841`, `ratingKey: 1`), *Dune : Première Partie* (2021, `tmdb:438631`, `ratingKey: 1202`), *Dune : Deuxième partie* (2024, `tmdb:693134`, `ratingKey: 23011`), *Dune : Troisième partie* (2026, `tmdb:1170608`) et la série *Dune : Prophecy* (2024, `tmdb:90228`, `ratingKey: 23749`). | **PASS** |
| **4. Demande existante** | Overseerr | 128 demandes lues (`GET /api/v1/request`), distinction claire entre `status: 2` (approuvée, `media.status: 3` en traitement) et `status: 5` (disponible). | **PASS** |
| **5. Suivi sans fichier + dates de sortie** | Radarr | *Vitrival* (`tmdbId: 1012611`) observé avec `monitored: true`, `hasFile: false` et `digitalRelease: "2026-06-17T00:00:00Z"`. | **PASS** |
| **6. Série partiellement disponible** | Overseerr + Sonarr + Plex (`nucvillers`) | *Dune : Prophecy* (Saison 1 présente `leafCount: 6` sur `nucvillers`, Saison 2 non disponible) et *One Piece* dans Sonarr (`32/90` épisodes surveillés présents, détail par saison dans `seasons[]`). | **PASS** |
| **7. Résultat indexeur vs absence** | Prowlarr | `270` résultats sur `"Dune"` (`930 ms`) vs `0` résultat sur chaîne absente (`3296 ms`). Présence de `guid` sensible confirmée → expurgation obligatoire. | **PASS** |
| **8. Jeton invalide / accès interdit** | Plex, Overseerr, Radarr, DeepSeek | Retournent respectivement `401` (Plex), `403` (Overseerr), `401` (Radarr) et `401` (DeepSeek). | **PASS** |
| **9. Vérification identité & Groupes Cloudflare** | Cloudflare Access | JWKS public (`200 OK`, 2 clés RSA) et lecture des Access Groups (`Emaildesamis`, `Famille Suzanne`, `gazetflix`) validés. | **PASS** |
| **10. Tool-calling & usage DeepSeek** | DeepSeek API | `GET /models` (`200 OK`, `408 ms`) et `POST /chat/completions` (`200 OK`, `388 ms`) avec appel structuré `search_media` et compteurs `prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`. | **PASS** |
