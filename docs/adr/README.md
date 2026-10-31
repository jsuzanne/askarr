# Registre des Décisions d'Architecture (ADR) — Askarr

- **Statut :** `READY FOR REVIEW (G2)`
- **Date :** 2026-10-30

Ce répertoire contient les 7 décisions d'architecture structurantes du projet **Askarr / Media Copilot** produites pour la porte de validation **G2** :

| ID | Titre | Décision retenue | Statut |
|---|---|---|---|
| [ADR-001](file:///Users/jsuzanne/Github/askarr/docs/adr/001-backend-framework.md) | **Choix du langage et du framework backend** | Node.js 22 LTS + TypeScript 5 + Fastify 5 + Zod (types partagés avec React 19 et JSON Schema DeepSeek) | `PROPOSED FOR G2` |
| [ADR-002](file:///Users/jsuzanne/Github/askarr/docs/adr/002-persistence-and-migrations.md) | **Persistance locale, migrations et sauvegarde** | SQLite 3 (mode WAL) via `better-sqlite3` + Drizzle ORM dans `/data/askarr.db` + backup automatique avant migration | `PROPOSED FOR G2` |
| [ADR-003](file:///Users/jsuzanne/Github/askarr/docs/adr/003-orchestration-engine.md) | **Moteur d'orchestration IA et garde-fous** | Boucle serveur déterministe bornée (`MAX_TOOL_ROUNDS=3`, `MAX_PROWLARR=1`), agrégation parallèle et court-circuit UI sans IA | `PROPOSED FOR G2` |
| [ADR-004](file:///Users/jsuzanne/Github/askarr/docs/adr/004-identity-strategy.md) | **Stratégie d'identité Cloudflare ↔ Plex ↔ Overseerr** | Validation JWKS Cloudflare Access + mapping strict 1-à-1 par e-mail avec les clients Plex présents dans Overseerr (`userType: 1`) | `PROPOSED FOR G2` |
| [ADR-005](file:///Users/jsuzanne/Github/askarr/docs/adr/005-ai-provider-deepseek.md) | **Intégration DeepSeek, contrôle des tokens et coûts** | `deepseek-chat`, préfixe statique pour Context Caching (`prompt_cache_hit_tokens`), tarifs/quotas configurables, bascule Mode Recherche Directe | `PROPOSED FOR G2` |
| [ADR-006](file:///Users/jsuzanne/Github/askarr/docs/adr/006-deployment-and-network-exposure.md) | **Déploiement Docker et exposition réseau** | Conteneur unique `askarr` non-root derrière Cloudflare Access (`askarr` / policy `allow askarr-user`), Plex de référence sur `nucvillers:32400` | `PROPOSED FOR G2` |
| [ADR-007](file:///Users/jsuzanne/Github/askarr/docs/adr/007-confirmations-and-idempotency.md) | **Jetons de confirmation, revalidation et idempotence** | Table `prepared_actions` à usage unique (TTL 10 min, hash SHA-256), verrouillage SQLite atomique, revalidation pré-écriture et vérification post-timeout | `PROPOSED FOR G2` |
