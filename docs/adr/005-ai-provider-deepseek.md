# ADR 005 — Intégration DeepSeek, contrôle des tokens et maîtrise des coûts

- **Statut :** `PROPOSED FOR G2`
- **Date :** 2026-10-30
- **Décideurs :** Architecte & Propriétaire Homelab

## 1. Contexte
Le PRD impose **DeepSeek** comme fournisseur IA et exige une maîtrise stricte de la consommation de tokens et des coûts associés :
- Pas de tarifs codés en dur non configurables ;
- Suivi précis des tokens d'entrée (cache hit vs cache miss) et de sortie ;
- Plafonds configurables par tour, par utilisateur et par jour/mois ;
- Dégradation gracieuse en cas de dépassement de budget ou d'indisponibilité de l'API DeepSeek.

La qualification G1 (`verify_deepseek_g1.py`) a validé l'endpoint `https://api.deepseek.com/chat/completions` (`388 ms` de latence) avec le modèle `deepseek-chat` (et l'exposition de `deepseek-flash` / `deepseek-v4-pro`), le support natif de `tools` (`finish_reason: "tool_calls"`), et la présence des compteurs exacts dans `usage` :
- `prompt_tokens`
- `completion_tokens`
- `prompt_cache_hit_tokens`
- `prompt_cache_miss_tokens`

## 2. Options considérées

| Option | Avantages | Inconvénients |
|---|---|---|
| **Option A : Utilisation de `deepseek-chat` (non-reasoner) avec Context Caching natif + Court-circuit UI déterministe** | Latence faible (`~390 ms`), support *tool-calling* déterministe (`temperature: 0.1`), prompt système statique mis en cache automatiquement par DeepSeek (`prompt_cache_hit_tokens`), et 0 token dépensé sur tous les clics UI (confirmation, choix de saisons, suivi des demandes). | Nécessite de garder le préfixe du prompt système strictement statique pour maximiser le taux de *cache hit* DeepSeek. |
| **Option B : Utilisation de `deepseek-reasoner` sur chaque tour** | Raisonnement CoT détaillé. | Latence élevée (plusieurs secondes), coût en tokens de sortie 4x à 8x supérieur, inutile pour orchestrer des outils déterministes. |

## 3. Décision retenue
Nous retenons **l'Option A : Modèle configurable par défaut à `deepseek-chat` avec comptabilité granulaire en base SQLite (`llm_usage_ledger`) et plafonds coupe-circuit**.

### Mécanismes de maîtrise des coûts retenus :
1. **Prompt système compact et préfixe statique (Context Caching DeepSeek) :**
   - Le prompt système et les définitions JSON Schema des 5 outils totalisent **moins de 900 tokens** et sont placés en tête fixe de la requête afin de bénéficier du cache de préfixe automatique de DeepSeek (`prompt_cache_hit_tokens`).
2. **Fênetre d'historique glissante courte :**
   - Seuls les **6 derniers messages** de la conversation active sont transmis au modèle, et les réponses d'outils volumineuses des tours précédents sont résumées sous forme compacte (`tmdbId`, `title`, `year`, `status`).
3. **Zéro appel IA pour les interactions structurées :**
   - Désambiguïsation par clic sur une carte, sélection de saisons, confirmation d'une demande (`POST /api/actions/:token/confirm`) et consultation de « Mes demandes » passent exclusivement par les routes REST déterministes.
4. **Barème tarifaire et plafonds configurables par variables d'environnement :**
   - `DEEPSEEK_MODEL=deepseek-chat`
   - `DEEPSEEK_MAX_OUTPUT_TOKENS=500`
   - `DEEPSEEK_MAX_PROMPT_TOKENS_PER_TURN=4000`
   - `DEEPSEEK_DAILY_TOKEN_BUDGET=250000` (plafond global journalier)
   - `DEEPSEEK_USER_DAILY_MESSAGE_LIMIT=40` (plafond journalier par ami)
   - `DEEPSEEK_PRICE_INPUT_CACHE_MISS_PER_1M` / `DEEPSEEK_PRICE_INPUT_CACHE_HIT_PER_1M` / `DEEPSEEK_PRICE_OUTPUT_PER_1M` (modifiables sans recompiler le code).

## 4. Conséquences
- **Positives :** Coût d'exploitation mensuel négligeable (quelques centimes d'euro par mois pour 30 amis), visibilité complète dans le tableau de bord Admin, continuité de service garantie via le **Mode Recherche Directe** si le budget quotidien est atteint.
- **Négatives / Garde-fous :** Si une réponse d'outil dépasse 2 000 caractères (ex. longue liste de résultats), l'adaptateur serveur la tronque aux **5 candidats les plus pertinents** avant de l'envoyer à DeepSeek.
