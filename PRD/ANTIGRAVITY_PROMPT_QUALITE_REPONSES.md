# PROMPT — Antigravity : qualité des réponses de l'orchestrateur Askarr

Tu es l'ingénieur responsable de la qualité conversationnelle d'Askarr. Travaille en français. Le code est en TypeScript (Fastify 5 / React 19 / SQLite). Ne démarre aucune refonte : les corrections demandées ici sont ciblées et séquencées par portes de validation.

## Contexte

Askarr est un assistant cinéma conversationnel branché sur Plex, Overseerr, Radarr, Sonarr et MDBList. Un LLM (DeepSeek par défaut, avec bascule Gemini / Groq / Mistral / OpenRouter) choisit des outils en lecture seule, puis rédige une réponse en prose à partir des preuves retournées. Les fiches média visuelles s'affichent sous le message.

Le fichier central est **`src/server/orchestrator/deepseek-orchestrator.service.ts`** (~3100 lignes). Il contient :
- `STATIC_FRENCH_SYSTEM_PROMPT` et `STATIC_ENGLISH_SYSTEM_PROMPT` (début du fichier) ;
- `READ_ONLY_TOOLS_DEFINITIONS` : 11 outils décrits en français ;
- `MAX_TOOL_ROUNDS = 2` ;
- la boucle de conversation (construction des messages, exécution des tool_calls, synthèse) ;
- `callProviderEndpoint` : corps de la requête HTTP vers le provider.

**Langue de travail du produit : le français.** C'est la langue réellement utilisée par les utilisateurs. Le prompt anglais est une version abrégée et dégradée du prompt français ; il est hors périmètre de cette mission, ne le touche pas sauf instruction explicite.

## Symptômes constatés par le propriétaire

Les réponses sont correctes mais imparfaites, sur deux axes :
1. **Mauvais outil appelé / mauvais films proposés.**
2. **Réponses parfois trop longues.**

## Diagnostic déjà établi — ne le refais pas, vérifie-le

### A. Les descriptions d'outils ne sont pas disjointes

Le routage est traité en prose dans le prompt système (règle 3), mais le modèle choisit à partir du *schéma des outils*. Quatre paires sont indiscernables parce qu'aucune description ne dit ce que l'outil **n'est pas** :

| Paire ambiguë | Cause |
| :--- | :--- |
| `discover_media_by_criteria` vs `discover_and_recommend_media` | Les deux acceptent `mediaType`, genre, bornes d'années, note minimale, `limit`, et un périmètre « sur Plex ». *« Propose-moi des thrillers sur Plex »* correspond parfaitement aux deux. **Cause principale des mauvais appels.** |
| `search_and_check_media` vs `verify_specific_titles` | Les deux vérifient des titres nommés sur Plex. Rien ne distingue « un titre nommé par l'utilisateur » de « 1 à 5 titres déduits par le modèle ». |
| `get_recently_added_on_plex` vs `get_watch_history_and_live_streams(scope='global_recent_and_trends')` | *« Quoi de neuf »* et *« qu'est-ce qu'on regarde »* se recouvrent. |
| `get_my_requests` vs `diagnose_media_acquisition` | Les deux répondent à *« pourquoi X n'est pas encore là »*. |

### B. Contradiction interne du prompt français

La règle 3 interdit d'appeler `discover_and_recommend_media(scope='on_plex_now')` « au hasard ». La règle 9 ordonne de l'appeler « IMMÉDIATEMENT » avec `scope: 'on_plex_now'`. Les conditions diffèrent, mais pour un modèle de taille moyenne c'est du bruit — et précisément sur l'outil déjà le plus ambigu.

### C. La verbosité est structurelle, pas un réglage

La règle 10 demande 2 à 5 phrases. Mais les règles 2, 3, 5, 6 et 7 imposent chacune des divulgations : qui a demandé le titre, quels serveurs Plex sont accessibles, la date VOD au passé ou au futur, les contraintes non supportées, la raison d'un résultat incomplet, le décompte d'épisodes manquants, le bouton de relance. Le prompt exige six choses puis demande cinq phrases. Le modèle obéit aux obligations précises et abandonne la consigne vague.

### D. Plafond de tokens et troncature silencieuse

Dans `callProviderEndpoint`, le corps de requête fixe `max_tokens: provider.id === 'deepseek' ? 500 : 900`. 500 tokens ≈ 350 mots français, partagés avec le JSON des tool_calls. Aucun code ne lit `finish_reason` : une complétion tronquée est enregistrée telle quelle comme réponse finale.

## Contraintes non négociables

- **Le message système doit rester 100 % statique et immuable par langue.** Un commentaire du code le signale : c'est ce qui garantit le cache KV du préfixe chez DeepSeek. Tu peux réécrire le contenu de la constante, jamais y injecter de valeur dynamique.
- **Zéro jargon technique dans les réponses utilisateur.** Les mots « Radarr », « Sonarr », « Prowlarr », « Overseerr », « indexeur », « tracker », « torrent », « usenet », « passkey », « TMDB » ne doivent jamais apparaître. Cette règle est tenue par le prompt : ne l'affaiblis pas.
- **Ne jamais laisser le modèle inventer une disponibilité.** Toute affirmation sur la présence d'un titre sur Plex ou en liste d'attente doit venir d'un outil. Ne supprime aucune garde sur ce point.
- Les descriptions d'outils passent par `sanitizeToolsForProvider()` pour les providers non-DeepSeek : toute modification doit survivre à cette transformation. Vérifie-la avant de livrer.
- `discover_media_by_criteria` est **retiré de la liste des outils** quand `MDBLIST_API_KEY` est absent. Toute frontière négative qui renvoie vers cet outil doit se dégrader proprement dans ce cas, sans laisser le modèle sans issue.
- Ne touche pas au parseur DSML (interception des balises `<|DSML|invoke...>` émises dans `content` au lieu de `tool_calls`) : c'est un correctif de compatibilité, pas du code mort.
- Pas de changement de provider, de modèle par défaut, de stack ni de dépendance sans accord.
- Aucune écriture réelle vers Overseerr, Radarr ou Sonarr pendant les tests.

## État des tests

`tests/` ne couvre **ni le prompt ni le routage des outils** : seulement l'agrégateur, le schéma de critères MDBList et la surface API. Il n'existe donc aucun filet de régression sur ce que tu vas modifier. Tu devras en créer un.

---

## Lot 1 — correctif chirurgical (à faire maintenant)

### 1.1 Rendre les descriptions d'outils disjointes
Pour chacune des quatre paires du tableau A, ajoute en fin de `description` une frontière négative explicite et courte, de la forme : *« N'utilise PAS cet outil si … : utilise `<outil_frère>` à la place. »* Reste en français, reste bref — une description trop longue dilue le signal autant qu'une description trop vague.

Critère de distinction à encoder, à vérifier contre le code avant d'écrire :
- `discover_media_by_criteria` = critères structurés filtrables par le catalogue (genre, période, note, durée, langue).
- `discover_and_recommend_media` = recommandation ouverte croisée avec l'historique de visionnage, sans critère de filtrage catalogue.
- `search_and_check_media` = un titre précis nommé par l'utilisateur.
- `verify_specific_titles` = 1 à 5 titres déduits par le modèle à partir d'une intrigue, d'indices ou d'un palmarès.

### 1.2 Lever la contradiction B
Harmonise les règles 3 et 9 du prompt français pour que `discover_and_recommend_media` ait une condition d'appel unique et non ambiguë. Une seule formulation, à un seul endroit.

### 1.3 Plafond de tokens
Aligne `max_tokens` de DeepSeek sur les autres providers (900). Puis lis `finish_reason` dans la réponse : si la valeur vaut `length`, journalise-le via le logger existant et n'enregistre pas la réponse tronquée comme si elle était complète — décide d'un traitement et explique-le.

### 1.4 Filet de régression
Ajoute des tests unitaires de routage dans `tests/unit/` : pour un échantillon de messages utilisateur français représentatifs des quatre paires ambiguës, vérifie que l'outil attendu est bien celui sélectionné. Utilise un client LLM simulé — **aucun appel réseau réel dans les tests**. Si le routage ne peut pas être testé sans réseau, teste au minimum que les descriptions d'outils respectent les invariants (frontières présentes, outils cités existants, dégradation sans MDBList).

**Arrête-toi ici et présente un compte rendu.** Ne passe pas au lot 2 sans validation explicite.

---

## Lot 2 — après validation du lot 1 : restructuration du prompt français

Objectif : traiter la cause C sans abîmer la voix du produit.

1. Rendre les divulgations **conditionnelles** plutôt qu'inconditionnelles. Exemple : ne mentionner `requestedBy` que si l'utilisateur pose la question ou si le titre est effectivement en liste d'attente. Applique le même traitement aux autres obligations des règles 2, 3, 5, 6 et 7.
2. Remonter la consigne de concision des dernières lignes vers l'ouverture du prompt.
3. Regrouper les règles de routage en une table de décision compacte en tête de prompt, au lieu de prose dispersée.

**Avant d'appliquer**, présente côte à côte l'ancien et le nouveau texte des règles concernées, avec la justification de chaque suppression. La voix du produit — chaleureuse, cinéphile, destinée à des proches non techniques — appartient au propriétaire : elle se valide, elle ne se décide pas seule.

---

## Interdictions spécifiques à cette mission

- Ne réécris pas les 60 lignes du prompt français d'un bloc au lot 1. Les deux lots sont séparés pour qu'on puisse attribuer un éventuel effet de bord.
- N'ajoute pas de nouvel outil. Le problème est la frontière entre les outils existants, pas leur nombre.
- Ne modifie pas `MAX_TOOL_ROUNDS`, la fenêtre d'historique, la température ni le délai d'expiration sans accord : ce sont d'autres axes, diagnostiqués mais hors périmètre ici.
- Ne fabrique aucun résultat de test. Si tu ne peux pas exécuter quelque chose, marque BLOCKED et propose la procédure.

## Format du compte rendu

- Travail réalisé, fichiers modifiés.
- Pour chaque paire ambiguë : l'ancienne description, la nouvelle, la frontière ajoutée.
- Tests ajoutés et résultats réels d'exécution.
- Effets de bord possibles sur les providers non-DeepSeek et sans clé MDBList.
- Hypothèses restantes et blocages.
- Décision humaine attendue avant le lot 2.

## Versionnage

Ne bump la version que si le propriétaire le demande. Le cas échéant, suis la convention du dépôt : `scripts/bump-version.mjs`, entrée dans `CHANGELOG.md`, badges des deux README.

Commence maintenant par le lot 1 uniquement.
