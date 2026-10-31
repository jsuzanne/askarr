# 08 — Plan de Tests & Stratégie de Recette (Porte G2)

- **Statut :** `READY FOR REVIEW (G2)`
- **Date de mise à jour :** 2026-10-30
- **Périmètre :** Tests unitaires, tests de contrat sur fixtures réelles G1 anonymisées, tests d'intégration SQLite/Idempotence, tests E2E et tests de sécurité.

---

## 1. Pyramide de tests et outillage

| Niveau | Outil | Cible | Exécution |
|---|---|---|---|
| **1. Tests Unitaires** | `Vitest` | Agrégateur 8 dimensions, calcul de dates de sortie (`digitalRelease`/`physicalRelease`), encodage RFC 3986 Overseerr, filtre de redaction Pino, calculateur de budget DeepSeek. | À chaque commit (`npm run test:unit`, < 2 s) |
| **2. Tests de Contrat (Fixtures G1)** | `Vitest` + `MSW` (Mock Service Worker) | Validation des connecteurs (`plex`, `overseerr`, `radarr`, `sonarr`, `prowlarr`, `cloudflare`, `deepseek`) contre les réponses JSON réelles anonymisées capturées lors de la porte G1. | À chaque commit (`npm run test:contract`, < 3 s) |
| **3. Tests d'Intégration Backend** | `Vitest` + `Fastify.inject()` + SQLite en mémoire/fichier tmp | Cycle de vie des jetons `prepared_actions`, double-clic, course entre 2 amis (`SUPERSEDED`), vérification post-timeout Overseerr, RBAC, rollback Cloudflare Access. | À chaque commit (`npm run test:integration`, < 5 s) |
| **4. Tests de Sécurité** | `Vitest` | Rejet JWT invalide/expiré/mauvais `aud`, fail-fast `ALLOW_DEV_AUTH_HEADER` en prod, absence de fuite `guid`/`downloadUrl` Prowlarr, résistance aux injections de prompt dans les synopsis TMDB. | À chaque commit (`npm run test:security`) |
| **5. Tests E2E & Recette Homelab** | `Playwright` / Scripts de qualification G3-G5 | Parcours complets en français (Recherche disponible, Recherche en liste d'attente Radarr avec date VOD, Désambiguïsation homonymes, Sélection saisons, Confirmation 1-clic, Admin Cloudflare). | Portes G3, G4 et G5 |

---

## 2. Catalogue des Fixtures Réelles Anonymisées Issues de G1 (`tests/fixtures/g1/`)

Toutes les fixtures proviennent des réponses réelles observées sur `nucvillers` (`192.168.1.163`) et `nucbuntu` (`192.168.1.154`) en G1, expurgées de tout secret :

1. `plex-nucvillers-dune-search.json` : Réponse de `/hubs/search?query=Dune` et `/library/metadata/23011` sur `nucvillers:32400` (*Dune : Deuxième partie*, bibliothèque `Films`, `Guid: ["imdb://tt15239678", "tmdb://693134", "tvdb://290272"]`).
2. `plex-nucvillers-enforcer-bilingual.json` : Résolution bilingue VO/VF (*The Enforcer* → *L'inspecteur ne renonce jamais*, `1976`, `tmdb://10649`).
3. `overseerr-search-dune-fr.json` : Réponse de `/api/v1/search?query=Dune&language=fr` avec les homonymes (*Dune* 1984, *Dune* 2021, *Dune : Deuxième partie* 2024, *Dune : Troisième partie* 2026, *Dune : Prophecy* 2024).
4. `radarr-movie-monitored-waiting-vod.json` : Réponse réelle `/api/v3/movie?tmdbId=1012611` (*Vitrival*, `monitored: true`, `hasFile: false`, `inCinemas: "2025-11-26T00:00:00Z"`, `digitalRelease: "2026-06-17T00:00:00Z"`).
5. `sonarr-series-partial-seasons.json` : Réponse réelle `/api/v3/series?tvdbId=81797` (*One Piece*) et *Dune : Prophecy* (`tvdbId: 367118`, Saison 1 disponible sur Plex `nucvillers`, Saison 2 non disponible).
6. `prowlarr-search-mixed-categories.json` : Réponse contenant des résultats `PC/Games` (*Dune: Awakening*) et des `guid` sensibles pour vérifier le filtrage obligatoire `categories=2000|5000` et la suppression de `guid`/`downloadUrl`/`infoUrl`.
7. `deepseek-tool-call-search.json` : Réponse `finish_reason: "tool_calls"` avec `usage` (`prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`).

---

## 3. Scénarios de tests critiques (Unitaires, Intégration & Sécurité)

### 3.1 Scénarios fonctionnels & Agrégation (G3)
- **T-FUNC-01 (Bilingue VF/VO & Vérité Plex `nucvillers`) :** Recherche `"Dune Part Two"` ou `"The Enforcer"` → résout le `tmdbId` via Overseerr, vérifie le `Guid` `tmdb://` sur `nucvillers:32400`, et retourne `catalogPresence.state === 'available_now'` même si la bibliothèque `Films` est désactivée dans Overseerr.
- **T-FUNC-02 (Pas sur Plex mais dans Radarr + Date de sortie estimée) :** Recherche `"Vitrival"` (`tmdbId: 1012611`) → absent de Plex `nucvillers`, présent dans Radarr avec `monitored: true, hasFile: false, digitalRelease: "2026-06-17"` → retourne `acquisitionPipeline.state === 'monitored_waiting_release'`, `estimatedAvailabilityDate === '2026-06-17'`, `canRequestNow === false` (évite tout doublon).
- **T-FUNC-03 (Homonymes & Désambiguïsation) :** Recherche `"Dune"` sans année → `disambiguationRequired === true`, retourne les cartes distinctes sans préparer d'action d'écriture tant que l'utilisateur n'a pas choisi.
- **T-FUNC-04 (Série partiellement disponible) :** Recherche `"Dune : Prophecy"` → Saison 1 marquée `available_on_plex` (`6/6` épisodes sur `nucvillers`), Saison 2 proposée dans `requestableSeasons: [2]`.

### 3.2 Scénarios d'Écriture, Idempotence, Concurrence et Timeout (G4)
- **T-WRITE-01 (Jeton à usage unique & Double-clic) :** Deux appels simultanés `POST /api/actions/:token/confirm` avec le même jeton → exactement **1 seul** appel `POST /api/v1/request` est émis vers Overseerr ; le second reçoit le résultat idempotent (`idempotentReplay: true`).
- **T-WRITE-02 (Course entre deux amis — Revalidation pré-écriture) :** Ami A et Ami B préparent chacun un jeton pour le même film non demandé. Ami A confirme en premier (`COMPLETED`). Ami B confirme 2 secondes plus tard → la revalidation pré-écriture détecte que le film est désormais demandé dans Overseerr, marque le jeton d'Ami B `SUPERSEDED` et n'émet **aucun** second `POST` vers Overseerr.
- **T-WRITE-03 (Reprise sûre après timeout d'écriture) :** `POST /api/v1/request` vers Overseerr tombe en timeout à `8 000 ms`, mais Overseerr a en réalité enregistré la demande. Le backend exécute `GET /api/v1/movie/:tmdbId`, constate `mediaInfo.status >= 2`, marque l'action `COMPLETED` et ne renvoie pas de `POST` en doublon.
- **T-WRITE-04 (Blocage d'un utilisateur non client Plex) :** Un utilisateur dont l'e-mail Cloudflare n'existe pas dans Overseerr tente `POST /api/actions/prepare` → rejeté avec `403 UNLINKED_PLEX_USER`.
- **T-WRITE-05 (Protection Admin Cloudflare Access & Rollback) :**
  - Tentative de suppression d'un e-mail présent dans `ADMIN_EMAILS` → rejetée (`400 ADMIN_LOCKOUT_PREVENTED`).
  - Ajout d'un e-mail dans `allow askarr-user` → crée un snapshot avant/après dans `cf_policy_revisions`, conserve intactes les règles non-email, et vérifie la restauration exacte via `POST /api/admin/cloudflare/access/rollback/:id`.

---

## 4. Couverture des 15 Critères d'Acceptation du PRD (`CA-01` à `CA-15`)

| Code PRD | Critère d'acceptation | Tests associés | Porte de validation |
|---|---|---|---|
| **CA-01** | Qualifications API exécutées et documentées avec preuves réelles | `docs/02-api-validation-report.md` (10/10 PASS) | Validé en **G1** |
| **CA-02** | Conteneur Docker démarre proprement avec healthcheck | `T-OPS-01` (`docker compose up` + `/api/health/live`) | **G3 / G5** |
| **CA-03** | Authentification Cloudflare Access réelle + rejet des accès non autorisés | `T-SEC-01`, `T-SEC-02`, `T-SEC-03` | **G3** |
| **CA-04** | Vérification fiable de disponibilité dans Plex (`nucvillers`) en VF et VO | `T-FUNC-01` (Fixtures `Dune` & `The Enforcer`) | **G3** |
| **CA-05** | Vérification de l'état des demandes existantes dans Overseerr | `T-FUNC-02`, `T-FUNC-05` (`GET /api/requests/mine`) | **G3** |
| **CA-06** | Vérification de l'état dans Radarr / Sonarr + estimation date de sortie | `T-FUNC-02` (Fixture `Vitrival` VOD) & `T-FUNC-04` | **G3** |
| **CA-07** | Vérification de la présence sur les indexeurs via Prowlarr (filtrée, sans fuite) | `T-FUNC-06`, `T-SEC-05` (`categories=2000\|5000`, purge `guid`) | **G3** |
| **CA-08** | Désambiguïsation obligatoire des titres proches / homonymes avant action | `T-FUNC-03` | **G3** |
| **CA-09** | Création de demande Overseerr uniquement après confirmation explicite | `T-WRITE-01`, `T-WRITE-02`, `T-WRITE-03` | **G4-A** |
| **CA-10** | Gestion d'accès Cloudflare Access par l'admin avec confirmation, audit et rollback | `T-WRITE-05` | **G4-B** |
| **CA-11** | Refus strict des fonctions admin pour un utilisateur `friend` | `T-SEC-04` (RBAC HTTP + exclusion outils LLM) | **G3 / G4** |
| **CA-12** | Aucune clé secrète ni passkey exposée côté client ou dans les logs | `T-SEC-05`, `T-SEC-06` (audit bundle Vite + redaction Pino) | **G3 / G5** |
| **CA-13** | Journal d'audit fonctionnel pour toutes les actions sensibles | `T-WRITE-01`, `T-WRITE-05`, `T-ADMIN-02` | **G4** |
| **CA-14** | Mode dégradé propre si un service aval ou DeepSeek est indisponible | `T-RESIL-01` (Prowlarr down), `T-RESIL-02` (DeepSeek fallback) | **G3 / G5** |
| **CA-15** | Consommation DeepSeek bornée, mesurée et consultable par l'admin | `T-COST-01`, `T-COST-02` (`llm_usage_ledger` + quotas) | **G3 / G5** |
