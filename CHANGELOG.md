# Journal des modifications (Changelog)

Toutes les modifications notables apportées au projet **Askarr** sont documentées dans ce fichier.
Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et ce projet adhère au [Versionnage Sémantique (SemVer)](https://semver.org/lang/fr/).

---

## [1.2.0] - 2026-10-31

### Ajouté
- **Routeur Multi-LLM Intelligent (4 Fournisseurs Gratuits + DeepSeek avec Secours Automatique)** :
  - Prise en charge native de **Google Gemini AI Studio** (`gemini-2.5-flash`), **Groq Cloud LPU** (`llama-3.3-70b-versatile`), **Mistral AI La Plateforme** (`mistral-small-latest`), **OpenRouter Free** (`deepseek/deepseek-chat-v3-0324:free`) et **DeepSeek Officiel** (`deepseek-chat`).
  - **3 stratégies de sélection configurables à chaud** dans la Régie Admin (persistées dans SQLite) :
    1. **Cascade Prioritaire (`priority_cascade`, par défaut)** : interroge les LLM gratuits configurés en priorité ($0 dépensé) et bascule automatiquement en $< 100\text{ ms}$ sur le fournisseur suivant (puis DeepSeek en secours ultime) en cas de limite de quota (`HTTP 429`) ou d'indisponibilité.
    2. **Load-Balancing (`load_balance`)** : alterne chaque requête en *Round-Robin* entre tous les fournisseurs actifs pour cumuler les quotas gratuits et comparer les modèles en conditions réelles.
    3. **Manuel / Fixe (`manual`)** : cible un fournisseur précis en priorité pour le tester en direct tout en conservant le basculement de secours automatique.
  - **Normalisation universelle des schémas d'outils (`sanitizeToolsForProvider`)** : nettoyage automatique des clés JSON Schema (`additionalProperties`, `default`) pour garantir une compatibilité 100 % sans erreur avec le *Function Calling* strict de Gemini, Groq et Mistral.
  - **Panneau de configuration & Test en 1 clic par LLM** : liens directs pour générer les clés gratuites, champs dédiés dans la Régie Admin et bouton `Tester` individuel (`llm:gemini`, `llm:groq`, `llm:mistral`, `llm:openrouter`, `llm:deepseek`).
- **Cockpit Financier DeepSeek & Benchmark Multi-Modèles** :
  - Récupération en direct du solde du compte DeepSeek (`GET /user/balance`), calcul du coût moyen par requête (tarif Cache Hit $-90\,\%$ vs Cache Miss) et estimation de l'autonomie restante en nombre de requêtes.
  - Tableau de **Benchmark comparatif par modèle** (`modelBenchmarks`) dans la Régie Admin (nombre d'appels, latence moyenne en ms, tokens consommés et coût `$0.00 Gratuit` vs payant).
  - Badge sous chaque réponse du chat indiquant quel fournisseur/modèle a répondu, son coût exact (`Gratuit $0.00` ou coût DeepSeek) et l'éventuelle bascule de secours automatique (`[Secours auto ← ...]`).

---

## [1.1.1] - 2026-10-31

### Ajouté
- **Origine et Demandeur des films/séries (`sourceOrigin` & `requestedByDisplayName`)** :
  - Distinction explicite entre une demande effectuée par un **utilisateur Overseerr** (`sourceOrigin: 'overseerr_user'`, ex: *« Demandé par jsuzanne le 31 octobre 2026 »*) et un film ajouté automatiquement via une **liste d'import Radarr/Sonarr** (`sourceOrigin: 'auto_list'`, ex: *« Ajouté automatiquement (liste) le 25 octobre 2026 »*).
  - Résolution enrichie du nom d'utilisateur Overseerr (`plexUsername`, `displayName`, `username`, cache d'utilisateurs Overseerr par `id` ou préfixe d'email) dans `OverseerrConnector.getMediaDetail` et `getRequests`.
  - Affichage du demandeur ou de l'origine automatique sur les fiches visuelles (`MediaCandidateCard.tsx`) ainsi que dans les réponses de l'assistant.

### Corrigé
- **Fin des listes de films systématiques dans les réponses de l'assistant (`DeepSeekOrchestratorService`)** :
  - Suppression du ré-attachement automatique des cartes du tour précédent lorsque aucun outil média n'est appelé (`toolRounds === 0`), évitant d'afficher des fiches de films sous une réponse conversationnelle ou une question sur les accès serveurs.
  - Ajout du paramètre `limit` sur `discover_and_recommend_media` et consignes explicites Singulier vs Pluriel dans `STATIC_FRENCH_SYSTEM_PROMPT` (*« conseille-moi un film »* ou *« quel est le dernier film ajouté »* renvoie désormais **1 seul film** au lieu d'une liste de 5).
  - Désambiguïsation automatique des homonymes par année dans `filterRelevantCardsForReply` (ex: *Le Comte de Monte-Cristo (2024)* n'affiche plus simultanément les adaptations de 1954 et 1975 lorsque seule la version 2024 est citée).

---

## [1.1.0] - 2026-10-31

### Ajouté
- **File d'attente unifiée Radarr & Overseerr (`getWaitingListAndRequests`)** :
  - Interrogation parallèle de l'API Radarr (`/api/v3/wanted/missing` et `/api/v3/calendar`) et d'Overseerr (`/api/v1/request`) pour lister l'ensemble des films en attente de fichier (`!hasFile`), qu'ils aient été demandés par un utilisateur sur Overseerr ou ajoutés automatiquement par une liste Radarr.
  - Extraction de la date d'ajout Radarr/Sonarr (`added`) fusionnée avec la date de demande Overseerr (`requestedAt`).
  - Affichage explicite des **3 états de disponibilité** pour chaque film ou série :
    1. **Disponible sur Plex** (`available_now`) avec boutons de lecture directe Web et iOS.
    2. **Déjà en liste d'attente** (`monitored_waiting_release` / `monitored_searching` / `already_requested`) avec **date de mise en attente** et **date de sortie VOD/DVD estimée**.
    3. **Non listé / Demandable** (`canRequestNow = true`) avec proposition de programmation en 2 clics.
- **Intégration Tracearr API v2 (`/api/v1/public/*`)** :
  - Nouveaux outils IA `get_recent_plex_additions`, `get_watch_history` et `get_active_streams`.
  - Suivi des derniers films/séries ajoutés sur les serveurs Plex (`NucVillers`, `NucBuntu`, etc.), de l'historique de lecture et des sessions en direct.
  - Panneau de supervision Tracearr dans la **Régie Admin** (`Santé Projecteurs` et `Paramètres & Identités`).
- **Système de versionnage sémantique incrémental** :
  - Source de vérité centralisée dans `src/shared/version.ts` et `package.json`.
  - Affichage du badge `v1.1.0` dans le fronton de l'application et exposition dans la sonde `/api/health/live`.
  - Scripts `npm run version:patch`, `npm run version:minor` et `npm run version:major` pour incrémenter automatiquement la version.

### Optimisé
- **Cache KV Préfixe DeepSeek & Compaction des Payloads LLM** :
  - Prompt système français 100 % statique en préfixe et injection du contexte dynamique utilisateur dans le message utilisateur afin de maximiser le taux de *Prompt Cache Hit* sur DeepSeek (`deepseek-chat`).
  - Compaction des cartes médias envoyées au LLM (`compactCardsForLlm`) : réduction de ~75 % des tokens d'entrée par tour de tool-calling.
  - Court-circuit des requêtes Radarr/Sonarr/Prowlarr redondantes pour les médias issus de Tracearr déjà présents sur Plex.

### Corrigé
- **Ergonomie & Interface Grand Cinéma** :
  - Ajout d'un dock inférieur opaque sous la barre de saisie du chat pour masquer proprement le défilement des messages et cartes en arrière-plan.
  - Suppression du bouton redondant « Nouvelle discussion » en bas de page (conservé dans la barre de sous-navigation supérieure).
  - Déduplication de la liste des serveurs Plex dans l'en-tête utilisateur et correction de l'alignement des boutons de suggestions rapides.

---

## [1.0.0] - 2026-10-31

### Ajouté
- **Version initiale d'Askarr « Grand Cinéma »** :
  - Copilote conversationnel IA propulsé par **DeepSeek** (`deepseek-chat`) avec orchestration multi-outils et garde-fous anti-hallucination.
  - **Fédération Multi-Serveurs Plex** : interrogation simultanée des serveurs configurés ou auto-découverts via `plex.tv`, vérification des permissions par ami Plex, et liens profonds directs (`app.plex.tv` + `plex://preplay/...` sur iOS).
  - **Connecteurs Overseerr, Radarr, Sonarr & Prowlarr** : enrichissement croisé (notes IMDb/TMDB, dates de sortie cinéma et VOD/DVD, estimation +4 mois après sortie salle, surveillance `monitored`, recherche d'indexeurs).
  - **Programmation en 2 clics** : jeton de confirmation idempotent à durée de vie limitée (`prepared_actions`) pour lancer une demande Overseerr et réactiver automatiquement le suivi Radarr/Sonarr.
  - **Authentification Zero Trust Cloudflare Access** : vérification cryptographique RS256 des JWT `Cf-Access-Jwt-Assertion`, synchronisation de l'annuaire `plex.tv` avec les règles/groupes Cloudflare Access et historique de révisions avec rollback SQLite.
  - **Invitations VIP par Email (Google SMTP)** : envoi de billets d'invitation HTML au design Grand Cinéma aux nouveaux membres ajoutés.
  - **Régie Admin complète** : gestion des accès VIP, tableau de bord de santé des connecteurs, traceur d'appels API en temps réel, suivi de consommation/solde DeepSeek, retours utilisateurs et configuration à chaud persistée dans SQLite.
  - **Conteneurisation Docker** : image multi-stage Node 22 sur le port `4880` avec sonde `HEALTHCHECK`.
