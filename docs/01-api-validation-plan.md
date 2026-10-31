# 01 — Plan de qualification et de validation des API (G0 → G1)

- **Statut :** `READY FOR REVIEW (G0)` — **En attente d'autorisation humaine avant toute exécution réseau.**
- **Date :** 2026-10-30
- **Objectif :** Vérifier sur l'installation réelle du homelab (`nucbuntu`, `nucvillers`, LAN) les versions, endpoints, schémas de réponse, permissions et comportements d'erreur de chaque service avant de rédiger les contrats finaux (G2) ou une seule ligne de code produit.

---

## 1. Principes de sécurité et de maîtrise des impacts

1. **Zéro secret dans le chat ou dans Git :**
   - Aucune clé API, aucun token Plex/Cloudflare/DeepSeek et aucune passkey d'indexeur ne doivent être collés dans la conversation ni enregistrés dans `docs/`.
   - La configuration de test passe exclusivement par un fichier local **`.env.qualification`** à la racine du workspace, protégé par `.gitignore`.
   - Un modèle vierge [`.env.qualification.example`](../.env.qualification.example) est fourni avec des placeholders.
2. **Pas de scan massif ni de dump de bibliothèque :**
   - Les appels sur Plex, Radarr, Sonarr et Overseerr utiliseront une pagination courte (`take=5` / `pageSize=5` ou filtrage par identifiant/terme précis) et un timeout strict (5 à 10 secondes maximum par requête).
3. **Séparation stricte entre Lecture locale (Lot 1A), Recherche indexeur externe (Lot 1B) et Écriture (Lot 1C) :**
   - Une recherche Prowlarr interroge des indexeurs tiers (risque de consommation de quota API ou de rate-limiting tracker) : elle est isolée dans le **Lot 1B** et limitée à 2 requêtes ciblées.
   - Aucune écriture (création de demande Overseerr, modification Cloudflare Access, ajout dans Radarr/Sonarr) n'est incluse dans les lots 1A et 1B. Le **Lot 1C** exige une validation séparée avec cible et plan de nettoyage explicites.
4. **Expurgation automatique avant documentation :**
   - Les réponses observées seront systématiquement nettoyées (masquage des IPs/noms d'hôtes internes si souhaité, suppression des `apikey`, `X-Plex-Token`, `downloadUrl`, `guid` contenant des passkeys, e-mails réels d'amis, identifiants de compte Cloudflare) avant d'être synthétisées dans `docs/02-api-validation-report.md`.

---

## 2. Prérequis sécurisés : Configuration de `.env.qualification`

Pour autoriser les tests sans exposer de secrets dans le chat, vous pouvez copier le fichier `.env.qualification.example` vers `.env.qualification` sur votre machine :

```bash
cp .env.qualification.example .env.qualification
```

Puis y renseigner les variables des services à tester (ou indiquer à l'agent sur quel hôte/chemin local autorisé il peut lire la configuration existante si vous préférez).

### Variables attendues dans `.env.qualification` (Placeholders uniquement)
- **Plex :** `PLEX_BASE_URL`, `PLEX_TOKEN`
- **Overseerr :** `OVERSEERR_BASE_URL`, `OVERSEERR_API_KEY`
- **Radarr :** `RADARR_BASE_URL`, `RADARR_API_KEY` (et éventuellement `RADARR_4K_BASE_URL` si plusieurs instances)
- **Sonarr :** `SONARR_BASE_URL`, `SONARR_API_KEY`
- **Prowlarr :** `PROWLARR_BASE_URL`, `PROWLARR_API_KEY`
- **Cloudflare Access (lecture seule pour Lot 1A) :** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCESS_APP_ID` (optionnel, peut être découvert par lecture de la liste des applications Access)
- **DeepSeek :** `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` (par défaut `https://api.deepseek.com`)

---

## 3. Découpage exact des tests initiaux et effets possibles

### Lot 1A — Lectures locales sans effet de bord externe (Recommandé pour démarrer G1)
*Effet sur le homelab : Lecture pure des métadonnées locales des conteneurs. Aucune modification d'état, aucun appel vers les indexeurs externes.*

| # | Service | Vérifications prévues (Méthode & Objectif) | Effet possible / Volume |
|---|---|---|---|
| **1A.1** | **Plex** | - `GET /identity` et `GET /` (version serveur, identifiant machine)<br>- `GET /library/sections` (liste des bibliothèques Films / Séries)<br>- Recherche ciblée d'un film présent, d'un film absent, d'homonymes et d'une série partielle (saisons/épisodes) + inspection des `Guid` externes (`tmdb://`, `tvdb://`, `imdb://`)<br>- Test avec jeton invalide (`401`) | Charge négligeable (5 à 8 requêtes HTTP GET locales). |
| **1A.2** | **Overseerr** | - `GET /api/v1/status` et `GET /api/v1/settings/public` (version et état)<br>- `GET /api/v1/search?query=...` (résolution film/série/homonymes et structure `mediaInfo`)<br>- `GET /api/v1/request?take=5` (structure des demandes existantes, statuts, saisons)<br>- `GET /api/v1/user?take=10` (structure des comptes utilisateurs, types Plex/local, permissions et quotas — e-mails expurgés dans le rapport)<br>- `GET /api/v1/movie/{tmdbId}` et `GET /api/v1/tv/{tmdbId}` (détail de couverture par saison et état des demandes) | Charge négligeable (6 à 8 requêtes HTTP GET locales). |
| **1A.3** | **Radarr** | - `GET /api/v3/system/status` (version exacte)<br>- `GET /api/v3/qualityprofile` et `GET /api/v3/rootfolder` (profils et dossiers racines)<br>- `GET /api/v3/movie?tmdbId=...` (état de suivi `monitored`, présence de fichier `hasFile`, statut de disponibilité)<br>- `GET /api/v3/queue?page=1&pageSize=5` (file d'acquisition en cours, messages d'état/avertissement `statusMessages`)<br>- `GET /api/v3/history?page=1&pageSize=5` (événements `grabbed`, `downloadFolderImported`, `downloadFailed`) | Charge négligeable (5 à 6 requêtes HTTP GET locales). |
| **1A.4** | **Sonarr** | - `GET /api/v3/system/status` (version exacte)<br>- `GET /api/v3/series/lookup?term=tvdb:...` ou filtrage local des séries suivies (structure des saisons `seasons[]`, `statistics.episodeFileCount`, `episodeCount`, épisodes spéciaux saison 0)<br>- `GET /api/v3/episode?seriesId=...` (détail par épisode sur une série partielle)<br>- `GET /api/v3/queue?page=1&pageSize=5` et `GET /api/v3/history?page=1&pageSize=5` | Charge négligeable (5 à 6 requêtes HTTP GET locales). |
| **1A.5** | **Prowlarr (Métadonnées seules)** | - `GET /api/v1/system/status` (version exacte)<br>- `GET /api/v1/indexer` et `GET /api/v1/indexerstatus` (liste des indexeurs actifs et état de santé/backoff local, **sans déclencher de recherche**) | Aucun appel vers les trackers/indexeurs externes (lecture de l'état en mémoire de Prowlarr). |
| **1A.6** | **Cloudflare Access (Lecture seule)** | - `GET /accounts/{account_id}/access/apps` (identification de l'application Access cible, de son `aud` tag et de sa configuration)<br>- `GET /accounts/{account_id}/access/apps/{app_id}/policies` (structure exacte des règles `include`/`require`/`exclude`)<br>- `GET /accounts/{account_id}/access/groups` et `/access/lists` (vérification de l'existence de groupes ou listes d'e-mails Zero Trust)<br>- `GET https://<team-domain>.cloudflareaccess.com/cdn-cgi/access/certs` (clés publiques JWKS de vérification JWT) | Lecture seule sur l'API Cloudflare (4 à 5 appels GET). Aucune modification de politique. |
| **1A.7** | **DeepSeek** | - `GET /models` (vérification des modèles disponibles : `deepseek-chat`, `deepseek-reasoner`)<br>- 1 appel minimal `POST /chat/completions` avec `tools` (1 outil fictif de test `resolve_title`, `max_tokens: 150`) pour valider le support du *function calling* structuré et mesurer les champs d'usage (`prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`). | Coût estimé : < 0,001 $ (< 300 jetons au total). |
| **1A.8** | **Tautulli / Tracearr (Optionnel, lecture seule)** | - Uniquement si renseignés dans `.env.qualification` : vérification de version/santé afin de documenter s'ils apportent une valeur ajoutée par rapport aux API natives (ex. historique de lecture ou corrélation d'état), sans les imposer dans l'architecture. | 1 à 2 appels GET locaux si activés. |

---

### Lot 1B — Recherches ciblées sur Prowlarr (Impact externe contrôlé)
*Effet sur le homelab et les tiers : Interroge les indexeurs configurés dans Prowlarr. Peut consommer 1 à 2 unités de quota API auprès des indexeurs.*

| # | Service | Vérifications prévues | Garde-fou appliqué |
|---|---|---|---|
| **1B.1** | **Prowlarr (Search)** | - 1 requête `GET /api/v1/search?query=<titre_connu>&type=search` (avec limite ou sélection d'un seul indexeur de test si souhaité via `indexerIds`)<br>- 1 requête sur une chaîne introuvable (ou vérification de réponse vide) pour valider le format d'absence de résultat.<br>- Inspection des champs de sortie (`title`, `size`, `seeders`, `indexerId`, `categories`, `protocol`) et **vérification des champs à expurger absolument** (`downloadUrl`, `infoUrl`, `guid` contenant des passkeys). | Maximum **2 appels de recherche** sur toute la phase G1. Aucune action de *grab* / envoi au client de téléchargement. |

---

### Lot 1C — Tests d'écriture et de cycle de vie (Non exécutés sans second accord spécifique)
Conformément aux règles non négociables :
- **Aucune écriture ne sera lancée pendant l'exécution initiale de G1.**
- Une fois les schémas de lecture (Lot 1A/1B) analysés, si un test d'écriture réel est jugé indispensable avant G2 (par exemple : créer puis supprimer immédiatement une demande Overseerr sur un média de test précis, ou ajouter/retirer un e-mail de test dans une liste Cloudflare dédiée), l'agent présentera une fiche d'autorisation unitaire détaillant :
  1. Le service et l'endpoint exacts,
  2. La charge utile exacte (`payload`),
  3. L'effet attendu (ex. déclenchement ou non d'un ajout dans Radarr/Sonarr selon l'auto-approbation),
  4. La procédure exacte de nettoyage immédiat (`DELETE`).

---

## 4. Cas fonctionnels et d'erreur à couvrir (PRD §8.3)

Lors de l'exécution du Lot 1A (et 1B si autorisé), chaque cas suivant sera documenté avec son statut réel (`PASS`, `FAIL`, `BLOCKED`, `NOT TESTED`) dans `docs/02-api-validation-report.md` :

1. **Titre connu disponible** (présence Plex confirmée + correspondance TMDB/TVDB/IMDB).
2. **Titre connu absent** (absent de Plex, d'Overseerr et de Radarr/Sonarr).
3. **Homonymes / titres proches** (ex. deux films portant le même titre d'années différentes, ou film vs série).
4. **Demande existante dans Overseerr** (identification de l'auteur de la demande, de la date et du statut : en attente / approuvée / disponible).
5. **Œuvre suivie dans Radarr/Sonarr mais sans fichier téléchargé** (`monitored: true`, `hasFile: false`).
6. **Série partiellement disponible** (certaines saisons ou certains épisodes présents dans Plex/Sonarr, d'autres manquants).
7. **Résultat d'indexeur présent vs absent** (via Lot 1B Prowlarr, et éventuellement lecture non-destructive des rejets d'historique/queue dans Radarr/Sonarr si déjà présents).
8. **Comportements d'erreur et de résilience** :
   - Jeton / clé API invalide (`401` / `403`),
   - Ressource inexistante (`404`),
   - Timeout court simulé ou service injoignable (distinction stricte entre `SERVICE_ERROR` et `ABSENT`).

---

## 5. Critères de réussite pour franchir la porte G1

La qualification G1 sera considérée comme complète lorsque :
- `docs/02-api-validation-report.md` contiendra, pour chaque service, la version exacte observée, les endpoints réellement testés, les temps de réponse constatés et des extraits de réponses anonymisés.
- Toute différence entre les attentes du PRD et la réalité des API installées sera explicitement signalée avec ses options d'arbitrage.
- Le propriétaire aura validé le rapport G1 et les compromis éventuels avant le passage à la rédaction de l'architecture et des contrats (G2).
