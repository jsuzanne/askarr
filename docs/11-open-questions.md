# 11 — Journal des Décisions Utilisateur & Questions Ouvertes (Porte G2)

- **Statut :** `READY FOR REVIEW (G2)`
- **Date de mise à jour :** 2026-10-30
- **Synthèse :** Toutes les questions bloquantes `P0` et structurantes `P1` ont été tranchées par le propriétaire et intégrées dans l'architecture G2 ([`docs/03-architecture.md`](file:///Users/jsuzanne/Github/askarr/docs/03-architecture.md) et [`docs/adr/`](file:///Users/jsuzanne/Github/askarr/docs/adr/README.md)).

---

## 1. Décisions Tranchées (G0 → G2)

| Réf | Sujet | Décision validée par le propriétaire | Impact architectural (G2) |
|---|---|---|---|
| **Q-P0.1** | Accès de qualification (`.env.qualification`) | **Validé :** Extraction automatisée en lecture seule depuis `nucbuntu` et `nucvillers` + ajout de `DEEPSEEK_API_KEY` par le propriétaire. | 100 % des services (`Plex`, `Overseerr`, `Radarr`, `Sonarr`, `Prowlarr`, `Cloudflare`, `DeepSeek`) sont qualifiés en G1 (`PASS`). |
| **Q-P0.2** | Périmètre de tests G1 (Lot 1A & Lot 1B) | **Validé :** Exécution complète des Lots 1A et 1B sans aucune écriture externe. | Voir [`docs/02-api-validation-report.md`](file:///Users/jsuzanne/Github/askarr/docs/02-api-validation-report.md). |
| **Q-P0.3** | Fédération Multi-Serveurs Plex (`NucVillers`, `NucBuntu`, etc.) | **Validé :** Tous les serveurs Plex partagent **`Films`** et **`Séries TV`** sur le NAS Synology, mais certaines bibliothèques spécialisées (comme **`Cinephile`**, **`Films 4K`**, **`Horror`**, **`Musical`**) ne sont accessibles que sur certains serveurs (ex. `NucBuntu`). Askarr doit pouvoir interroger plusieurs serveurs Plex (`PLEX_SERVERS`), avec `NucVillers` (`192.168.1.163:32400`) en priorité 1 (moins chargé) et cascade/interrogation automatique sur `NucBuntu` (`192.168.1.154:32400`) et tout autre serveur configuré. | Connecteur `plex.connector.ts` multi-serveurs : recense les bibliothèques de chaque serveur au démarrage, interroge `NucVillers` en priorité 1 pour `Films`/`Séries TV`, puis `NucBuntu` (et suivants) pour les bibliothèques spécialisées (`Cinephile`, etc.) ou en haute disponibilité, en indiquant le serveur et la bibliothèque exacte à l'utilisateur. |
| **Q-P1.1** | Identité `Cloudflare Access` ↔ `Plex` ↔ `Overseerr` | **Validé :** Tout ami autorisé sur Askarr **doit être client Plex et donc exister dans Overseerr** (`userType: 1`). | Correspondance 1-à-1 par e-mail (avec table d'alias admin optionnelle `user_identity_links`) et attribution des demandes au `userId` Overseerr réel de l'ami (`ADR-004`). |
| **Q-P1.2** | Quotas et approbation dans Overseerr | **Validé :** En transmettant `userId: overseerrUserId` à Overseerr, Askarr respecte nativement les permissions et quotas configurés dans Overseerr. | Intégré dans `overseerr.connector.ts` et `POST /api/actions/:token/confirm`. |
| **Q-P1.3** | Traduction non-technique & estimation des dates de sortie | **Validé :** Zéro jargon technique pour les proches. Si un film n'est pas sur Plex mais est dans la liste `Radarr`, le copilot l'indique clairement et estime sa date de disponibilité à partir des dates de sortie VOD / DVD / Cinéma (`digitalRelease`, `physicalRelease`, `inCinemas`). | Modèle `MediaEvidence` à 8 dimensions ([`docs/05-data-model.md`](file:///Users/jsuzanne/Github/askarr/docs/05-data-model.md)) et dictionnaire UX ([`docs/07-ux-spec.md`](file:///Users/jsuzanne/Github/askarr/docs/07-ux-spec.md)). |
| **Q-P1.4** | Cible Cloudflare Access | **Validé :** Le propriétaire créera l'application **`askarr`** dans Cloudflare Access avec la policy **`allow askarr-user`** (groupe dédié ou liste d'e-mails dans la policy, selon le même modèle que `transistor` et `potecast`). | L'adaptateur Cloudflare Access supporte les deux modes (`CF_ACCESS_TARGET_MODE=policy\|group`) et préserve toutes les règles existantes (`ADR-006`, `docs/06`). |
| **Q-P1.5** | Rôle de Tautulli & Tracearr | **Validé :** `Plex` (`nucvillers`) + `Overseerr` + `Radarr` + `Sonarr` + `Prowlarr` suffisent à couvrir 100 % des besoins du MVP. | Aucune dépendance inutile à Tautulli/Tracearr dans le MVP. |

---

## 2. Paramètres opérationnels attendus uniquement pour le Jalon G4-B (Non bloquants pour G2 ni G3)

| Réf | Paramètre | Quand est-il nécessaire ? | Description |
|---|---|---|---|
| **OP-G4.1** | Création de l'app Cloudflare Access `askarr` + policy `allow askarr-user` | Uniquement au moment de tester le jalon **G4-B** (écriture Cloudflare Access) et la mise en production **G5**. | Une fois l'application `askarr` créée dans votre dashboard Cloudflare Zero Trust, nous récupérerons son `CF_ACCESS_AUD` et l'identifiant de la policy/groupe `allow askarr-user` (et si besoin un token Cloudflare incluant le scope `Access: Apps and Policies Write` si vous choisissez le mode policy directe plutôt qu'Access Group). |
