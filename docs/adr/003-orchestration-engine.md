# ADR 003 — Moteur d'orchestration IA et garde-fous d'exécution

- **Statut :** `PROPOSED FOR G2`
- **Date :** 2026-10-30
- **Décideurs :** Architecte & Propriétaire Homelab

## 1. Contexte
Le copilot doit comprendre des demandes formulées en français courant (parfois approximatives, en VF ou en VO), appeler les bons outils pour vérifier l'état réel dans l'écosystème (`Overseerr`, `Plex nucvillers`, `Radarr`, `Sonarr`, `Prowlarr`), et formuler une réponse naturelle non technique, **sans jamais inventer de statut ni exécuter d'écriture sans confirmation**.

## 2. Options considérées

| Option | Avantages | Inconvénients |
|---|---|---|
| **Option A : Boucle d'orchestration déterministe sur mesure (SDK OpenAI compatible DeepSeek)** | Contrôle absolu sur chaque tour d'outil, application stricte des plafonds (`max_tool_turns = 3`, `max_prowlarr_searches = 1`), injection d'objets UI structurés (`cards`, `confirmation_prompt`) directement depuis les sorties d'outils sans repasser par la génération texte du LLM, zéro dépendance lourde. | ~150 lignes de code d'orchestration à écrire et tester. |
| **Option B : Framework d'agents générique (LangChain / LlamaIndex)** | Abstractions toutes faites. | Surcharge massive de dépendances, prompts internes opaques qui gonflent la consommation de tokens, gestion difficile des garde-fous stricts par outil. |

## 3. Décision retenue
Nous retenons **l'Option A : Boucle d'orchestration déterministe légère côté serveur** utilisant le client officiel `openai` pointé sur `https://api.deepseek.com` (`deepseek-chat`, `temperature: 0.1`).

### Règles d'exécution de la boucle :
1. **Court-circuit déterministe (0 token) :** Les clics UI explicites (sélection d'une œuvre parmi plusieurs cartes, choix de saisons, clic « Confirmer », clic « Annuler », consultation de « Mes demandes ») ne passent **pas** par DeepSeek ; ils appellent directement les services métiers.
2. **Agrégation atomique par outil :** Plutôt que de laisser le LLM enchaîner 4 appels successifs pour un même titre (Overseerr puis Plex puis Radarr puis Queue), l'outil principal `check_media_status` exécute ces vérifications **en parallèle côté serveur** (`Promise.allSettled`) et renvoie en un seul tour le dossier de preuves complet (`MediaEvidence`).
3. **Plafonds par tour utilisateur :**
   - `MAX_TOOL_ROUNDS = 3` (au-delà, arrêt forcé de la boucle d'outils et synthèse immédiate avec les preuves déjà collectées).
   - `MAX_PROWLARR_CALLS_PER_TURN = 1` (la recherche indexeur Prowlarr n'est déclenchée que si l'utilisateur demande explicitement pourquoi un média traîne ou si l'admin diagnostique un blocage).
   - `LLM_TIMEOUT_MS = 15000` par appel DeepSeek.
4. **Séparation données / instructions :** Toutes les métadonnées provenant des API externes (synopsis TMDB, titres de releases Prowlarr) sont encapsulées dans des messages `role: "tool"` JSON stricts avec consigne système explicite d'ignorer toute instruction textuelle contenue dans les données externes (protection anti-*prompt injection* indirecte).

## 4. Conséquences
- **Positives :** Latence réduite (1 seul aller-retour d'outil dans 95 % des cas), consommation de tokens minimale (~400 à 700 tokens par échange), comportement 100 % prévisible et testable avec des fixtures.
- **Négatives / Garde-fous :** Si DeepSeek est injoignable (`5xx` / timeout) ou si le plafond de budget est atteint, l'orchestrateur bascule automatiquement en **Mode Recherche Directe (sans IA)** qui retourne les cartes `MediaEvidence` directement à l'interface.
