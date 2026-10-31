# ADR 001 — Choix du langage et du framework backend

- **Statut :** `PROPOSED FOR G2`
- **Date :** 2026-10-30
- **Décideurs :** Architecte & Propriétaire Homelab

## 1. Contexte
Le frontend est imposé par le PRD en **React 19 + TypeScript + Vite + Tailwind CSS v4**. Le backend doit quant à lui :
- Vérifier les jetons JWT Cloudflare Access (`Cf-Access-Jwt-Assertion`) via JWKS ;
- Interroger en parallèle plusieurs API HTTP JSON/XML du LAN (`Plex nucvillers`, `Overseerr`, `Radarr`, `Sonarr`, `Prowlarr`) avec des timeouts courts ;
- Valider strictement les schémas d'entrée/sortie des outils IA (`DeepSeek`) et des routes REST ;
- Être simple à déployer dans un conteneur Docker unique et cohérent avec les applications existantes du homelab (`transistor`, `potecast` qui tournent sous Node.js en conteneur sur `nucvillers`).

## 2. Options considérées

| Option | Avantages | Inconvénients |
|---|---|---|
| **Option A : Node.js 22 LTS + TypeScript 5 + Fastify 5 + Zod** | Partage de types 100 % natif entre frontend React et backend, validation JSON Schema / Zod native pour le *tool-calling* DeepSeek, empreinte mémoire faible (~60 Mo RAM), excellente gestion de l'I/O asynchrone concurrent (`Promise.allSettled`), aligné avec `transistor` et `potecast`. | Nécessite une discipline stricte sur les timeouts d'appels HTTP (`AbortSignal.timeout`). |
| **Option B : Python 3.12 + FastAPI + Pydantic** | Très bon support Pydantic/OpenAI SDK. | Double stack langage (TypeScript côté client, Python côté serveur), duplication des schémas de types entre le frontend et le backend, image Docker multi-runtime plus lourde. |
| **Option C : Next.js Fullstack (App Router / Server Actions)** | Un seul framework. | Couplage fort entre rendu UI et logique métier, gestion plus opaque des middlewares Zero Trust, des tâches de fond et de SQLite embarqué. |

## 3. Décision retenue
Nous retenons **l'Option A : Node.js 22 LTS + TypeScript 5 (strict mode) + Fastify 5 + Zod (`fastify-type-provider-zod`)**.

- Les contrats Zod définis dans `src/shared/schemas/` servent à la fois :
  1. À typer le frontend React 19 ;
  2. À valider les requêtes/réponses Fastify ;
  3. À générer automatiquement les définitions JSON Schema passées au paramètre `tools` de l'API `DeepSeek`.

## 4. Conséquences
- **Positives :** Zéro dérive de typage entre l'UI, l'API REST et les outils du LLM ; démarrage du conteneur en moins d'une seconde ; empreinte CPU/RAM minimale sur le homelab.
- **Négatives / Garde-fous :** Tous les appels HTTP sortants vers le LAN et le Cloud doivent utiliser un client HTTP centralisé avec `AbortSignal.timeout` explicite et expurgation automatique des secrets dans les logs Pino de Fastify.
