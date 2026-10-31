# ADR 007 — Jetons de confirmation à usage unique, revalidation et idempotence des écritures

- **Statut :** `PROPOSED FOR G2`
- **Date :** 2026-10-30
- **Décideurs :** Architecte & Propriétaire Homelab

## 1. Contexte
Le PRD impose qu'**aucune action d'écriture** (création d'une demande dans Overseerr ou ajout/retrait d'un e-mail dans Cloudflare Access) ne puisse être exécutée :
1. Sans une confirmation explicite de l'utilisateur sur la cible exacte désambiguïsée (titre, année, identifiant TMDB, saisons exactes pour une série) ;
2. Par simple génération de texte ou d'appel d'outil par le LLM ;
3. En doublon en cas de double-clic, de requêtes concurrentes ou de timeout réseau.

## 2. Options considérées

| Option | Avantages | Inconvénients |
|---|---|---|
| **Option A : Table SQLite `prepared_actions` à machine à états atomique + Revalidation serveur juste avant écriture + Vérification post-timeout** | Séparation physique entre la préparation (lecture/calcul) et l'exécution (clic HTTP sur `/api/actions/:token/confirm`), immutabilité garantie par empreinte `SHA-256`, protection anti-double-clic par transaction SQLite synchrone, prévention des doublons concurrents. | Ajoute une table SQLite dédiée et une étape de revalidation. |
| **Option B : Confirmation conversationnelle (« Oui, vas-y » dans le chat)** | Aucune route dédiée. | Vulnérable aux hallucinations du LLM, aux ambiguïtés de contexte, aux injections de prompt et consomme des tokens DeepSeek inutilement. |

## 3. Décision retenue
Nous retenons **l'Option A : Protocole d'écriture en 2 phases basé sur un jeton serveur à usage unique (`actionToken`) stocké dans `prepared_actions`**.

### Spécification du cycle de vie d'un jeton `prepared_action` :
1. **Phase 1 — Préparation (sans effet de bord) :**
   - Déclenchée soit par l'outil IA `prepare_media_request` (après résolution unique de l'œuvre), soit par l'API REST `POST /api/actions/prepare` (lorsque l'utilisateur clique « Demander » sur une carte).
   - Le serveur vérifie que :
     - L'utilisateur est rattaché à un compte client Plex dans Overseerr (`overseerrUserId != null`) ;
     - Le média (ou les saisons sélectionnées) n'est **ni déjà présent sur Plex (`nucvillers`)**, **ni déjà demandé/en cours dans Overseerr/Radarr/Sonarr**.
   - Le serveur insère une ligne dans `prepared_actions` :
     - `token` : UUID v4 cryptographique (`crypto.randomUUID()`) ;
     - `action_type` : `'OVERSEERR_REQUEST_MOVIE' | 'OVERSEERR_REQUEST_TV' | 'CF_ACCESS_ADD_EMAIL' | 'CF_ACCESS_REMOVE_EMAIL'` ;
     - `actor_email` & `actor_overseerr_id` : identité du demandeur ;
     - `payload_json` : paramètres exacts verrouillés (`tmdbId`, `tvdbId`, `title`, `year`, `seasons: number[]`) ;
     - `payload_hash` : `SHA-256(actor_email + action_type + canonical(payload_json))` ;
     - `status` : `'PENDING'` ;
     - `expires_at` : `now + 10 minutes`.
2. **Phase 2 — Confirmation et Verrouillage Atomique (`POST /api/actions/:token/confirm`) :**
   - Vérifie que `actor_email` de la session courante est strictement identique au créateur du jeton et que `now < expires_at`.
   - Exécute une transition SQLite atomique :
     ```sql
     UPDATE prepared_actions
     SET status = 'EXECUTING', updated_at = CURRENT_TIMESTAMP
     WHERE token = :token AND actor_email = :email AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP;
     ```
   - Si `changes === 0` :
     - Si le jeton est déjà `'COMPLETED'`, renvoie de manière idempotente le résultat existant (`200 OK`, `alreadyCompleted: true`) sans rappeler Overseerr.
     - Si `'EXECUTING'`, renvoie `409 Conflict` (*Action déjà en cours de traitement*).
     - Si expiré ou annulé, renvoie `410 Gone`.
3. **Phase 3 — Revalidation juste avant écriture (Anti-Course / Anti-Doublon) :**
   - Avant d'envoyer le `POST /api/v1/request` à Overseerr, le serveur ré-interroge en direct `Plex (nucvillers)` et `Overseerr` pour ce `tmdbId` (et ces `seasons`).
   - Si un autre ami a demandé le même film 5 secondes plus tôt, le serveur passe le jeton à `'SUPERSEDED'`, n'envoie **pas** de doublon à Overseerr, et répond positivement à l'utilisateur : *« Bonne nouvelle : ce titre vient tout juste d'être demandé, il est déjà dans la file d'attente ! »*
4. **Phase 4 — Gestion sûre des timeouts d'écriture (Vérification post-timeout) :**
   - Si l'appel `POST /api/v1/request` vers Overseerr expire (timeout réseau `> 8 000 ms`) ou renvoie une erreur réseau ambiguë (`ECONNRESET`), le backend **ne relance jamais aveuglément le POST**.
   - Il effectue immédiatement un `GET /api/v1/movie/:tmdbId` (ou `GET /api/v1/tv/:tmdbId`) sur Overseerr :
     - Si la demande a bien été créée côté Overseerr, le jeton passe à `'COMPLETED'` et l'audit log trace la récupération post-timeout.
     - Si la demande n'existe pas côté Overseerr, le jeton passe à `'FAILED_RETRYABLE'` et l'erreur est expliquée proprement à l'utilisateur.

## 4. Conséquences
- **Positives :** Impossibilité mathématique pour le LLM de déclencher une écriture non confirmée ; résistance totale aux doubles clics mobiles et aux courses entre utilisateurs ; zéro doublon en cas de timeout réseau.
- **Négatives / Garde-fous :** Un job interne de nettoyage purgera ou marquera `'EXPIRED'` les jetons `'PENDING'` dépassant leur `expires_at` (10 minutes).
