# ADR 002 — Persistance locale, migrations et sauvegarde

- **Statut :** `PROPOSED FOR G2`
- **Date :** 2026-10-30
- **Décideurs :** Architecte & Propriétaire Homelab

## 1. Contexte
Le portail Askarr doit persister localement :
- Les sessions et messages de conversation (avec contexte court) ;
- Les jetons d'actions préparées à usage unique (`prepared_actions`) garantissant l'idempotence et la sécurité des écritures ;
- Le journal d'audit complet des actions (création de demandes Overseerr, modifications Cloudflare Access) ;
- L'historique des révisions de la policy/groupe Cloudflare Access pour permettre un rollback immédiat ;
- Les compteurs de consommation de tokens DeepSeek (`llm_usage_ledger`) par utilisateur et par jour/mois.

Le nombre d'utilisateurs simultanés est celui d'un cercle familial/amical (~35 utilisateurs Plex/Overseerr).

## 2. Options considérées

| Option | Avantages | Inconvénients |
|---|---|---|
| **Option A : SQLite 3 (mode WAL) via `better-sqlite3` + Drizzle ORM** | Zéro conteneur de base de données externe, transactions ACID synchrones ultra-rapides (< 1 ms) idéales pour le verrouillage atomique des jetons de confirmation à usage unique, sauvegarde par simple copie/commande `.backup` d'un fichier `/data/askarr.db`, déjà utilisé avec succès par `potecast` et `transistor` sur `nucvillers`. | Mono-instance (parfaitement adapté à un déploiement homelab). |
| **Option B : PostgreSQL 16 en conteneur séparé** | Concurrence multi-nœuds. | Alourdit le déploiement (`docker-compose` multi-conteneurs), consommation RAM inutile (~150 Mo), complexifie les sauvegardes/restaurations pour un outil homelab. |

## 3. Décision retenue
Nous retenons **l'Option A : SQLite 3 en mode `WAL` (`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`) via `better-sqlite3` et `drizzle-orm`**.

- **Emplacement :** `/data/askarr.db` monté sur un volume Docker persistant.
- **Migrations :** Gérées par `drizzle-kit` sous forme de fichiers SQL versionnés dans `drizzle/migrations/` et appliquées automatiquement au démarrage du serveur après création d'un snapshot de sécurité `/data/backups/askarr-pre-migrate-<timestamp>.db`.

## 4. Conséquences
- **Positives :** Exploitation triviale (un seul fichier), atomicité garantie sur la consommation des jetons d'écriture (`UPDATE prepared_actions SET status = 'EXECUTING' WHERE token = ? AND status = 'PENDING'`), coût mémoire quasi nul.
- **Négatives / Garde-fous :** Le volume `/data` doit être monté sur un stockage local hôte (`nucvillers` ou `nucbuntu`) et non sur un montage NFS distant pour éviter les verrous POSIX réseau de SQLite.
