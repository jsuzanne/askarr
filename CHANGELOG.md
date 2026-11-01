# Journal des modifications (Changelog)

Toutes les modifications notables apportées au projet **Askarr** sont documentées dans ce fichier.
Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et ce projet adhère au [Versionnage Sémantique (SemVer)](https://semver.org/lang/fr/).

---

## [1.2.9] - 2026-11-01

### Ajouté
- **Complétion des épisodes manquants pour les séries TV partiellement disponibles (`partially_available`) via Sonarr & Overseerr** :
  - Lorsqu'une série TV est incomplète sur Plex (ex: *The Staircase* avec `1/8 ép.` présents et `7` épisodes manquants), les saisons en état `partially_available` sont désormais éligibles à l'action (`canRequestNow: true`, `requestableSeasons`).
  - Ajout de `SonarrConnector.monitorAndSearchSeasons` : lors de la confirmation d'une demande sur une série déjà présente dans Sonarr, Askarr active la surveillance (`monitored: true`) sur la série, la saison ciblée et les épisodes manquants (`PUT /api/v3/episode/monitor`), puis déclenche immédiatement une recherche d'indexeurs (`POST /api/v3/command` `SeasonSearch`) en parallèle d'Overseerr.
  - Le Projectionniste propose désormais spontanément de lancer le téléchargement des épisodes manquants et prépare le jeton de confirmation en 1 clic.

### Modifié
- **Refonte Ergonomique « Fiche-Séance Tout-en-Un » (Proposition A)** :
  - **Fusion des blocs** : la fiche média (`MediaCandidateCard`) est désormais intégrée **à l'intérieur** du conteneur `.cinema-screen-card` du Projectionniste, juste au-dessus de la barre de notation 5 étoiles (`Note cette séance :`), supprimant le double bloc séparé.
  - **Bandeau de métadonnées unifié** : fusion des 4 lignes empilées (statut, serveurs Plex, accès utilisateur, origine Overseerr) en une seule ligne de badges compacts et lisibles.
  - **Synopsis repliable (`+ Synopsis`)** dans les cartes intégrées au chat pour éviter la redondance avec le commentaire du Projectionniste.
  - **Barre d'actions horizontale unifiée** regroupant `Ouvrir sur Plex`, `Lancer sur Apple TV`, `📥 Compléter Saison X (Y ép. manquants)` / `Demander sur Plex` et `Séries/Films similaires`.

---

## [1.2.8] - 2026-11-01

### Modifié
- **DeepSeek V3 (`deepseek-chat`) défini comme LLM principal par défaut (`llmRoutingMode: 'manual'`, `llmManualProvider: 'deepseek'`)** :
  - Positionne `deepseek-chat` en tête du routeur multi-LLM pour bénéficier de sa précision de suivi d'instructions et de sa culture cinéma francophone, tout en conservant le basculement automatique (`failover`) vers les fournisseurs gratuits (Gemini, Groq, Mistral, OpenRouter) en cas d'indisponibilité.

### Corrigé
- **Fenêtre glissante de l'historique de conversation SQLite (`getConversationMessages`)** :
  - Correction de la requête SQL (`ORDER BY created_at DESC, rowid DESC LIMIT ?` puis `.reverse()`) qui retournait auparavant les 6 premiers messages de la conversation au lieu des plus récents dès qu'une discussion dépassait 3 échanges, ce qui polluait le contexte du LLM avec d'anciens sujets résolus.
- **Priorisation automatique des sorties cinéma récentes (2025/2026/2027) et homonymes (`verifySpecificTitles`, `searchAndCheckMedia`, `discoverByGenreOrTrending`)** :
  - Lorsqu'un utilisateur demande un film actuellement à l'affiche sans préciser d'ancienne année (ex: *« Le Fantôme de l'Opéra »* 2026 vs 2004), Askarr interroge TMDB/Overseerr en temps réel et remonte systématiquement la sortie récente ($\ge N-1$) en priorité, même si le LLM a transmis une année antérieure issue de sa coupure d'entraînement.
  - Prise en charge de `yearFilter` (`primaryReleaseDateGte` / `primaryReleaseDateLte`) sur la découverte TMDB/Overseerr.
- **Historique de visionnage personnel Tracearr (`get_watch_history_and_live_streams`)** :
  - Augmentation de la profondeur de récupération Tracearr (`limit=250`), ajout du filtre `mediaType` (`'movie' | 'tv'`) et enrichissement automatique par titre (`verifySpecificTitles`) lorsque `tmdbId` est absent dans Tracearr, évitant toute confusion avec les visionnages d'autres membres du foyer et garantissant l'affichage de l'affiche.

---

## [1.2.7] - 2026-11-01

### Ajouté
- **Détection Automatique des Lecteurs Plex (`Plex Players`) & Lancement Direct sur Apple TV / Smart TV (`📺 Lancer sur Apple TV`)** :
  - **Découverte hybride en temps réel (`GET /api/plex/players`)** combinant 4 sources en parallèle :
    1. `plex.tv/devices.xml` et `plex.tv/api/v2/resources` (`presence="1"`, `lastSeenAt`, URI locales `http://192.168.x.x:32500`).
    2. `GET /clients` sur les 5 serveurs Plex configurés (`NucVillers`, `NucBuntu`, `EQ12buntu`, `MacMini`, `Macmini4`).
    3. `GET /status/sessions` sur tous les serveurs pour identifier les lecteurs en cours de lecture active.
    4. Scan réseau local **Plex GDM** (UDP port `32412` `M-SEARCH * HTTP/1.1` broadcast + unicast inter-VLAN `192.168.1.x` / `192.168.10.x`) + sonde HTTP directe `GET http://<ip>:32500/resources` (650 ms) pour vérifier instantanément si une Apple TV ou Smart TV est allumée.
  - **Indicateur de présence TV dans la barre de salle (`📺 Apple TV ...`)** avec pastille verte pulsante dès qu'un lecteur est détecté en ligne, polling automatique en arrière-plan (15 s) et menu déroulant permettant de choisir le téléviseur cible ou de relancer un scan réseau.
  - **Bouton `📺 Lancer sur <Apple TV / TV>` sur chaque affiche disponible dans Plex** :
    - Création automatique d'une **PlayQueue officielle Plex** (`POST /playQueues?type=video`) sur le serveur hébergeant le média (avec résolution automatique du 1er épisode pour les séries TV).
    - Envoi de la commande `playMedia` via cascade multi-canal : (1) **LAN Direct** vers le port `:32500` de l'Apple TV avec sélection automatique de l'IP du serveur Plex sur le même VLAN (`192.168.10.210` / `192.168.1.163`), (2) **Proxy PMS** (`/player/playback/playMedia`), (3) **Relais Cloud PubSub `plex.tv`**.
    - Mini-télécommande intégrée sous l'affiche après le lancement (**Pause**, **Reprendre**, **Stop**, **Début** via `POST /api/plex/cast/control`).

---

## [1.2.6] - 2026-11-01

### Ajouté
- **Mode Viewer (User) pour l'Administrateur (`Vue User` dans le fronton de la salle)** :
  - Permet à l'administrateur de basculer en 1 clic (`Salle Ciné` | `👁️ Vue User` | `Régie Admin`) sur l'interface exacte d'un spectateur invité sans avoir à créer un second compte.
  - Masque intégralement les traces techniques d'appels API, les compteurs de tokens/coûts LLM, les traces sur les affiches de films et le bouton `Traces : ON`.
  - Bandeau de simulation de profil permettant de tester le rendu et les permissions serveur comme un **Spectateur Standard (NucVillers)**, un **Membre Cinéphile (NucVillers + NucBuntu)** ou n'importe quel **ami Plex réel** de l'annuaire (`viewerSimulation` transmis à `POST /api/chat/messages`).
  - Option **Plein écran 100% User** masquant même la bascule Admin du header avec une pilule flottante `Retour Admin ✕`.

### Corrigé
- **Migration automatique des modèles LLM Gratuits dépréciés (HTTP 404 sur Gemini, Groq et OpenRouter)** :
  - Remplacement et auto-migration à chaud (`normalizeLlmModelSlug` + `PROVIDER_MODEL_FALLBACKS`) des anciens slugs retirés par les fournisseurs :
    - **Google Gemini AI Studio** : `gemini-2.5-flash` (HTTP 404 pour les nouveaux projets) $\rightarrow$ **`gemini-3.5-flash-lite`** (repli auto sur `gemini-3.6-flash`).
    - **Groq Cloud LPU** : `llama-3.3-70b-versatile` (HTTP 404) $\rightarrow$ **`openai/gpt-oss-120b`** (repli auto sur `qwen/qwen3.8-27b`, `openai/gpt-oss-20b`).
    - **OpenRouter Free** : `deepseek/deepseek-chat-v3-0324:free` (HTTP 404) $\rightarrow$ **`openrouter/free`** (routeur officiel OpenRouter vers les modèles `:free` actifs avec support tool-calling).
  - Nettoyage inter-fournisseurs des métadonnées propriétaires (`sanitizeMessagesForProvider` retire `extra_content` / `thought_signature` de Gemini lors d'un basculement vers Groq/Mistral/OpenRouter/DeepSeek).

---

## [1.2.5] - 2026-11-01

### Corrigé
- **Sauvegarde automatique à chaud lors du clic sur `Tester Gemini / Groq / Mistral / OpenRouter`** (`POST /api/admin/settings/test-service`) :
  - Auparavant, saisir une nouvelle clé API dans un champ puis cliquer directement sur `Tester Gemini` ou `Tester Groq` sans avoir cliqué au préalable sur le bouton `Enregistrer dans SQLite` en haut de la page testait l'état précédent (`Clé API non configurée (0 ms)`).
  - Désormais, tout clic sur un bouton `Tester ...` envoie et persiste automatiquement les clés saisies dans SQLite (`draftConfig`), recharge les connecteurs à chaud, exécute le test réel contre l'API LLM, et met à jour le compteur `X LLM actif(s)` en temps réel.
  - Augmentation du plafond `max_tokens` de test (`10` $\rightarrow$ `80`) pour supporter les modèles à raisonnement interne comme `gemini-2.5-flash` sans troncature et affichage détaillé du message d'erreur HTTP éventuel.
  - Ajout d'un bouton dédié **`Enregistrer les clés LLM`** directement dans l'en-tête du Routeur Multi-LLM.

---

## [1.2.4] - 2026-11-01

### Corrigé
- **Injection du contexte utilisateur dans `verify_specific_titles` (`userQueryContext`)** :
  - Lorsqu'un utilisateur décrit un film par son intrigue (ex: *« film français récent qui raconte l'histoire de deux Français devenus agents de joueurs NBA comme Wembanyama »*), le LLM appelle souvent `verify_specific_titles` avec sa propre hypothèse issue de sa coupure de connaissance (ex: *Un1que, Victor Wembanyama*).
  - Désormais, `verifySpecificTitles` interroge aussi en parallèle l'index RAM local Radarr/Sonarr (`searchLocalCatalogByKeywords`) avec le message complet de l'utilisateur (`userQueryContext`) et injecte en tête de résultat toute correspondance locale à score élevé ($\ge 35$, comme ***Le rêve américain* (2026)**, `tmdbId: 1365378`), permettant au LLM de l'identifier dès le 1er tour d'outil.

---

## [1.2.3] - 2026-11-01

### Ajouté
- **Index Catalogue Local RAM Ultra-Rapide (`< 2 ms`, 0 appel Plex pendant le scan) pour Radarr (1 400+ films) & Sonarr (`searchLocalCatalogByKeywords`)** :
  - Mise en cache mémoire (TTL 10 min) du catalogue complet Radarr (`GET /api/v3/movie`) et Sonarr (`GET /api/v3/series`) incluant synopsis (`overview`), titres alternatifs, langue originale (`originalLanguage`) et genres.
  - Lors d'une recherche descriptive par sujet ou mots-clés (ex: *« film français sur 2 agents de NBA / Wembanyama »* $\rightarrow$ ***Le Rêve américain* (2026)**, ou *« film de zombie coréen »*), Askarr scanne les 1 400 synopsis/titres en RAM en moins de 2 ms et fusionne les meilleurs candidats avec Overseerr sans jamais interroger Plex 1 400 fois.
  - Enrichissement du résumé compact envoyé au LLM (`compactCardsForLlm`) avec un extrait du synopsis (`overviewFr`) et 4 acteurs principaux pour permettre la validation sémantique immédiate.
- **Journal Complet des Interactions Utilisateurs & Validation QA dans La Régie (`GET /api/admin/interactions`, `POST /api/admin/interactions/review`)** :
  - Traçabilité intégrale de **toutes les questions/réponses** enregistrées dans SQLite (`messages` + `conversations` + `response_feedback` + nouvelle table `qa_reviews`), même lorsqu'aucune note étoilée n'a été cliquée.
  - Détection automatique des questions en échec (`Aucune affiche (0 carte média)`, `Aucun film/série trouvé`, `Note spectateur basse 1-3 ★`).
  - Workflow hebdomadaire d'amélioration continue : filtres par période (`7 derniers jours`, `30 jours`, `Tout`) et par statut (`Toutes`, `⚠️ À analyser / À corriger`, `✅ Validées`, `⭐ Notées`), boutons `🛠️ À corriger` / `✅ Validé`, bouton **`▶️ Re-tester en direct`** (relance la question en 1 clic dans la Salle Ciné), note d'analyse Admin et export JSON en 1 clic.

### Corrigé
- **Historique Tracearr du compte Admin (`resolveUserPlexServerAccess`)** : utilisation du vrai pseudo Plex (`overseerrPlexUsername` / préfixe email, ex: `Jerome`) au lieu du libellé générique `'Admin Propriétaire Plex'` qui empêchait `my_history` de retrouver les visionnages de l'administrateur.
- **Optimisation de la latence de recherche Plex sur `NucBuntu` & `NucVillers` (`searchOnSingleServer`)** : pré-filtrage immédiat des GUIDs (`tmdb://`, `tvdb://`, `imdb://`) retournés par `/hubs/search?includeGuids=1`, éliminant jusqu'à 5 appels HTTP `getMetadataByRatingKey` inutiles par serveur lorsqu'un film est absent de Plex (gain de ~3,5 s par serveur).

---

## [1.2.2] - 2026-11-01

### Ajouté
- **Projecteur Rétro 16mm/35mm pendant l'attente de réponse (`startRetroProjectorSpin` / `stopRetroProjectorSpin`)** :
  - Synthèse procédurale du mécanisme intermittent à croix de Malte (double cliquetis griffe + obturateur à 20 img/s, frottement cyclique de bobine celluloïd et moteur synchrone) avec inertie mécanique au démarrage (`0.55x` $\rightarrow$ `1.0x`) et freinage de bobine à l'arrivée de la réponse (`1.0x` $\rightarrow$ `0.42x`).
  - Bouton rapide `Bobine 35mm ON / Son muet` directement dans la carte de chargement du chat et bouton de test `📽️ Projecteur (2s)` dans le menu `Ambiance`.
- **Mode `🎷 Radio FIP Jazz (Foyer Ciné-Club)` (`fip_jazz`)** :
  - Intégration en *lazy streaming* (`preload="none"`, 0 octet consommé hors écoute, coupure automatique du flux en arrière-plan) de la webradio officielle **Radio France — FIP Autour du Jazz** (`icecast.radiofrance.fr/fipjazz-midfi.mp3`).
  - **Auto-Ducking ciné-club** : atténuation automatique du volume de FIP Jazz pendant que le projecteur rétro 35mm tourne lors d'une recherche, puis retour au volume normal dès l'affichage de la réponse.

---

## [1.2.1] - 2026-11-01

### Ajouté
- **Ambiance Sonore de Salle de Cinéma & Micro-Bruitages (`src/client/utils/cinema-audio.ts`)** :
  - Moteur de synthèse procédurale **Web Audio API 100 % natif** (0 octet de fichier audio externe téléchargé, 0 % d'impact CPU/React grâce à une boucle matérielle de 4 secondes et mise en veille automatique `AudioContext.suspend()` dès que l'onglet passe en arrière-plan ou est muet).
  - Sélecteur **`🔊 Ambiance`** dans le fronton supérieur avec 4 modes mémorisés dans `localStorage` (`Muet`, `Bruitages Cinéma seuls (SFX)`, `Cabine 35mm + SFX`, `Prélude Grand Cinéma + 35mm`), curseur de volume et boutons de test.
  - **3 micro-bruitages synchronisés aux actions** : cliquetis mécanique de bobine 35mm à l'envoi d'un message, accord cristallin d'ouverture de rideau à l'affichage des affiches, et poinçon de billet de cinéma à la confirmation d'une demande Overseerr.

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
