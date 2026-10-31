# Index de la documentation — Media Copilot (Askarr)

> **Statut global du projet :** Jalon **G1 VALIDÉ** (Qualification API `10/10 PASS` incluant DeepSeek `deepseek-chat` et Plex de référence `nucvillers:32400`) & Jalon **G2 PRÊT POUR REVUE** (Conception complète d'architecture, 7 ADR, modèle de menaces, modèle de données 8D + SQLite, contrats d'outils/API, UX francophone, plan de tests, plan d'implémentation et runbook d'exploitation).  
> **Règle de gouvernance :** Aucune implémentation produit (`src/`, `package.json`, `Dockerfile`) n'est engagée avant la validation explicite de la porte **G2**.

---

## 1. État des livrables documentaires (PRD §16)

| Document | Rôle | Statut actuel | Dépendances amont | Porte de validation cible |
|---|---|---|---|---|
| [`docs/00-discovery.md`](./00-discovery.md) | État de l'existant, exigences confirmées, propositions, inconnues, risques et synthèse des questions | **VALIDATED (G0)** | `PRD/STEP0_PRD.md`, `PRD/ANTIGRAVITY_START_PROMPT.md` | **G0** |
| [`docs/01-api-validation-plan.md`](./01-api-validation-plan.md) | Matrice de capacités à vérifier, protocole de tests gradués et prérequis de sécurité | **VALIDATED & EXECUTED (G0 → G1)** | `docs/00-discovery.md` | **G0** |
| [`docs/02-api-validation-report.md`](./02-api-validation-report.md) | Preuves réelles, versions observées, schémas expurgés, Plex `nucvillers:32400`, qualification `DeepSeek` et verdicts (`10/10 PASS`) | **VALIDATED (G1)** | Exécution sur `nucbuntu`, `nucvillers`, Cloudflare Access & DeepSeek | **G1** |
| [`docs/03-architecture.md`](./03-architecture.md) | Composants, frontières de confiance, flux, adaptateurs, modèle normalisé et déploiement sur `nucvillers:4880` | **READY FOR REVIEW (G2)** | `docs/02-api-validation-report.md` | **G2** |
| [`docs/adr/README.md`](./adr/README.md) | Index des 7 Architecture Decision Records obligatoires du §9 du PRD | **READY FOR REVIEW (G2)** | `docs/03-architecture.md` | **G2** |
| [`docs/04-security-threat-model.md`](./04-security-threat-model.md) | Actifs, menaces, contrôles, identité Cloudflare Access ↔ Plex/Overseerr, RBAC, anti-prompt-injection et matrice de droits | **READY FOR REVIEW (G2)** | `docs/03-architecture.md` | **G2** |
| [`docs/05-data-model.md`](./05-data-model.md) | Entités SQLite, identifiants externes, modèle multidimensionnel de preuves (8 dimensions), rétention et migrations | **READY FOR REVIEW (G2)** | `docs/03-architecture.md` | **G2** |
| [`docs/06-api-and-tool-contracts.md`](./06-api-and-tool-contracts.md) | Contrats des 5 outils IA et endpoints REST, permissions, quotas, erreurs structurées, confirmations à usage unique et idempotence | **READY FOR REVIEW (G2)** | `docs/04-security-threat-model.md`, `docs/05-data-model.md` | **G2** |
| [`docs/07-ux-spec.md`](./07-ux-spec.md) | Parcours utilisateurs (non-techniques francophones) et administrateur, fiches de preuves, badges et états d'erreur | **READY FOR REVIEW (G2)** | `docs/06-api-and-tool-contracts.md` | **G2** |
| [`docs/08-test-plan.md`](./08-test-plan.md) | Stratégie de tests (unitaires, contrats sur fixtures G1 expurgées, intégration, E2E, sécurité) et 15 critères d'acceptation (`CA-01`..`CA-15`) | **READY FOR REVIEW (G2)** | `docs/06-api-and-tool-contracts.md`, `docs/07-ux-spec.md` | **G2** |
| [`docs/09-implementation-plan.md`](./09-implementation-plan.md) | Découpage en jalons courts et vérifiables (`G3.1`–`G3.4` lecture seule, `G4-A` écritures Overseerr, `G4-B` écritures Cloudflare, `G5` recette) | **READY FOR REVIEW (G2)** | `docs/03`..`docs/08` | **G2** |
| [`docs/10-operations-runbook.md`](./10-operations-runbook.md) | Installation Docker sur `nucvillers`, variables `.env`, sauvegarde/restauration SQLite, retour arrière et diagnostic | **READY FOR REVIEW (G2)** | `docs/03-architecture.md`, `docs/09-implementation-plan.md` | **G2** (finalisé en **G5**) |
| [`docs/11-open-questions.md`](./11-open-questions.md) | Journal des décisions et questions (toutes les questions P0 et P1 résolues) | **READY FOR REVIEW (G2)** | Retours utilisateur G0 → G2 | **G2** |
| [`docs/12-requirements-traceability.md`](./12-requirements-traceability.md) | Matrice de traçabilité de bout en bout : Exigence PRD → Preuve G1 (`15/15 PASS`) → Contrat G2 → Test → Jalon | **READY FOR REVIEW (G2)** | `docs/02`..`docs/09` | **G2** |

---

## 2. Liste des 7 ADR ([`docs/adr/`](./adr/README.md))

1. [`ADR-001`](./adr/001-backend-framework.md) — Choix du langage et du framework backend (`Node.js 22 LTS` + `TypeScript 5` + `Fastify 5` + `Zod`)
2. [`ADR-002`](./adr/002-persistence-and-migrations.md) — Choix de la persistance et des migrations (`SQLite 3 WAL` via `better-sqlite3` + `Drizzle ORM`)
3. [`ADR-003`](./adr/003-orchestration-engine.md) — Choix du moteur d'orchestration et des garde-fous d'exécution (Boucle déterministe bornée `MAX_TOOL_ROUNDS=3`, `MAX_PROWLARR=1`, bypass UI `0 token`)
4. [`ADR-004`](./adr/004-identity-strategy.md) — Stratégie d'identité et corrélation `Cloudflare Access` ↔ `Plex` ↔ `Overseerr` (Validation JWKS + correspondance e-mail 1-to-1 client Plex `userType: 1` + attribution `userId`)
5. [`ADR-005`](./adr/005-ai-provider-deepseek.md) — Intégration `DeepSeek` (`deepseek-chat`, Context Caching automatique, tarification configurable et mode dégradé *Recherche Directe*)
6. [`ADR-006`](./adr/006-deployment-and-network-exposure.md) — Modèle de déploiement et d'exposition réseau (Conteneur Docker unique non-root sur `nucvillers:4880` derrière Cloudflare Access `askarr` / `allow askarr-user`)
7. [`ADR-007`](./adr/007-confirmations-and-idempotency.md) — Stratégie de confirmation à usage unique et d'idempotence des écritures (`prepared_actions`, TTL 10 min, hash SHA-256, revalidation `SUPERSEDED` et vérification `GET` post-timeout)
