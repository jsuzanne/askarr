# STEP 0 — PRD : portail conversationnel de médiathèque

Statut : spécification initiale à qualifier, pas autorisation de développer.
Langue du produit et de la documentation : français.
Nom de travail : Media Copilot (modifiable).

## 1. Contexte et intention
Le propriétaire exploite Plex, Overseerr, Radarr, Sonarr et Prowlarr. Ses amis lui demandent fréquemment si un film ou une série est disponible et s'il peut l'ajouter. Le produit doit remplacer ces échanges par un portail conversationnel reposant sur les API des services existants.

L'application doit répondre à partir de données vérifiées, distinguer disponibilité, demande, suivi, recherche, téléchargement et import, puis permettre les actions explicitement autorisées. Elle ne remplace aucun des services existants.

Ce PRD est le STEP 0 d'un projet confié à Antigravity. Avant l'implémentation produit, l'agent doit produire les documents de cadrage, qualifier les API sur les versions installées et obtenir une validation humaine des décisions structurantes.

## 2. Exigences confirmées et hypothèses
### Confirmé par le propriétaire
- Déploiement Docker dans un environnement homelab.
- Frontend souhaité : React 19, TypeScript, Vite, Tailwind CSS v4.
- Copilote utilisant l'API DeepSeek avec maîtrise des coûts.
- Services existants : Plex, Overseerr, Radarr, Sonarr, Prowlarr.
- Deux rôles : administrateur (propriétaire) et utilisateur (amis).
- Accès via Cloudflare Access ; gestion d'e-mails autorisés depuis l'administration, avec modification API de la politique ou liste concernée après qualification.
- Consultation des disponibilités et création de demandes dans Overseerr.
- Recherche via Prowlarr pour examiner les résultats disponibles chez les indexeurs configurés.
- Test des API réelles avant implémentation des connecteurs produit.
- Possibilité d'intégrer d'autres outils uniquement si un besoin établi le justifie.

### Propositions à faire valider
- Chat accompagné de fiches de résultats et d'une page « Mes demandes ».
- Backend TypeScript ; framework, base de données et bibliothèques à décider dans des ADR.
- Confirmation explicite avant chaque création de demande.
- MVP sans lancement direct de téléchargement, modification des profils ou suppression de média.
- Diagnostic technique détaillé réservé à l'administrateur.
- Interface mobile-first.
- Adaptateur futur pour Seerr, sans support Seerr dans le MVP tant qu'il n'est pas demandé.

Aucune proposition ne doit être présentée comme une exigence déjà confirmée.

## 3. Objectifs et critères de réussite
- Réduire les interventions manuelles du propriétaire sur les questions courantes.
- Fournir une réponse traçable et compréhensible sur la disponibilité d'un titre.
- Éviter les doublons de demandes et les actions involontaires.
- Expliquer les blocages avec un niveau de certitude explicite.
- Ne jamais confondre défaut d'accès, erreur réseau et absence de contenu.
- Limiter le coût IA par des budgets, des plafonds et une orchestration déterministe.

Mesures à instrumenter : taux de résolution sans intervention administrateur, proportion de réponses avec sources, taux d'erreurs par connecteur, doublons évités, latence, consommation de jetons et coût estimé. Les objectifs numériques seront fixés après la qualification ; aucune performance ne doit être promise sans mesure.

## 4. Périmètre
### MVP
Authentification et rôles ; consultation Plex/Overseerr/Radarr/Sonarr ; recherche ciblée Prowlarr ; résolution d'identité des œuvres ; conversation avec preuves ; demande Overseerr après confirmation ; suivi des demandes selon droits ; administration des accès ; configuration sécurisée ; budgets IA ; audit ; installation Docker et documentation.

### Hors MVP sauf validation explicite
Téléchargement direct d'une release, suppression de contenu, changement de qualité ou profil, contournement d'une approbation, modification des indexeurs, automatisation de masse, installation d'outils externes, migration Overseerr vers Seerr, moteur de streaming, moteur de recherche de tout Internet, comptes et facturation publics.

## 5. Personae et autorisations
Utilisateur : poser une question, voir les résultats autorisés, demander un contenu selon politique, consulter ses propres demandes. Ne peut pas voir les secrets, gérer les utilisateurs ni modifier les paramètres techniques.
Administrateur : gérer les intégrations et les politiques, consulter les diagnostics et l'audit, gérer les accès, définir quotas et approbations.

Le backend applique toutes les permissions. Le modèle, le frontend et le texte des conversations ne sont jamais une autorité d'accès. L'association entre identité Cloudflare, utilisateur local et compte Plex/Overseerr doit être décidée et testée ; ne pas supposer qu'ils sont équivalents.

## 6. Parcours fonctionnels
### 6.1 Disponibilité
1. L'utilisateur nomme un titre.
2. Résoudre film/série, année et identifiants ; demander un choix en cas d'ambiguïté.
3. Consulter les sources nécessaires et autorisées.
4. Afficher un état synthétique, la couverture pour les séries et la fraîcheur des preuves.
5. Proposer les suites autorisées sans les exécuter automatiquement.

### 6.2 Demande
Identifier précisément l'œuvre et la portée (film/série/saisons). Vérifier les demandes existantes. Présenter le récapitulatif et demander confirmation. Revalider droits et doublons côté serveur. Soumettre via Overseerr avec la stratégie d'identité validée. Afficher la réponse réelle et enregistrer l'audit. En cas de timeout, vérifier l'existence d'une demande avant de réessayer.

### 6.3 Diagnostic « Pourquoi ce n'est pas disponible ? »
Croiser présence Plex, demande Overseerr, suivi et états Radarr/Sonarr, historique et informations de file accessibles. Une recherche Prowlarr peut compléter le diagnostic selon politique et quota.

La présence d'un résultat d'indexeur ne prouve pas qu'il est acceptable ou aurait dû être récupéré. Les rejets et raisons doivent venir d'informations validées de l'application concernée. Ne pas reproduire approximativement les règles de sélection de Radarr/Sonarr dans le modèle.

Afficher séparément : faits vérifiés, causes explicitement fournies par les API, hypothèses et données manquantes. Ne jamais affirmer qu'une recherche active, un téléchargement ou un import a eu lieu sans preuve.

### 6.4 Administration des accès
L'administrateur saisit un e-mail ; le backend vérifie son autorisation, montre l'opération exacte et demande confirmation. La stratégie Cloudflare (application, politique, liste ou autre objet pertinent) doit être validée sur la configuration réelle. Aucune modification globale ou destructive de politique existante.

Prévoir ajout, retrait, traitement des doublons, erreurs, synchronisation et audit. Une révocation doit aussi bloquer l'utilisateur local ; les implications de sessions Cloudflare existantes doivent être vérifiées et documentées, sans promettre de révocation immédiate non testée. Conserver une voie de récupération administrateur.

## 7. Modèle d'état et preuves
Éviter un statut unique trompeur. Maintenir plusieurs dimensions indépendantes :
- identité : type, titre, année, identifiants externes validés ;
- accès : visible pour cet utilisateur / non autorisé / inconnu ;
- Plex : disponible / partiel / absent / inconnu ;
- demande : aucune / en attente / approuvée / refusée / autre état réel / inconnu ;
- suivi : absent / ajouté non surveillé / surveillé / inconnu ;
- acquisition : non observée / en file / en cours / échec / import en attente / autre état vérifié / inconnu ;
- recherche : non effectuée / résultats / aucun résultat / échec ;
- diagnostic : cause vérifiée / hypothèse / indéterminé.

Chaque preuve contient source, date de collecte, portée, succès/erreur et référence interne. Les états normalisés doivent conserver le statut brut utile pour l'audit. Ne pas exposer URLs privées, clés, passkeys ou réponses brutes sensibles aux utilisateurs.

## 8. STEP 0A — Découverte et qualification API obligatoire
Cette phase peut contenir des scripts exploratoires isolés ; elle n'autorise pas la construction du backend ou frontend produit.

### 8.1 Inventaire
Recueillir versions exactes, URLs internes, mode Docker/réseau, authentification, permissions, documentation adaptée et données de test. Ne pas deviner les endpoints ou les noms de champs. Ne pas ajouter d'outil ou modifier un service sans accord.

### 8.2 Matrice de capacités à vérifier
| Service | Capacités à qualifier | Risques ou inconnues |
|---|---|---|
| Plex | recherche, bibliothèques, films/séries/saisons/épisodes, disponibilité, liens | visibilité par utilisateur, indexation, correspondance d'identifiants |
| Overseerr | recherche, requêtes existantes, état média, utilisateurs, création de demande | attribution, approbations, doublons, portée par saison |
| Radarr | œuvres suivies, surveillance, profils, file, historique, recherche/rejets si accessibles | sémantique des états, coût et effets des recherches |
| Sonarr | séries/saisons/épisodes, surveillance, file, historique, recherche/rejets si accessibles | disponibilité partielle, épisodes spéciaux, identifiants |
| Prowlarr | recherche des indexeurs et métadonnées des résultats, état des indexeurs si accessible | recherche pouvant générer du trafic externe, quotas, confidentialité |
| Cloudflare Access | identité vérifiable, objets de policy, ajout/retrait ciblés | permissions du jeton, conservation des règles, sessions |
| DeepSeek | authentification, modèle disponible, outils structurés et/ou sortie structurée, consommation | compatibilité réelle, tarifs à vérifier, contexte, timeout |

Les capacités ci-dessus sont des objectifs de test, pas des garanties de prise en charge.

### 8.3 Protocole
Commencer par les lectures à faible impact. Même une recherche sans écriture locale peut interroger des tiers : documenter ses effets, obtenir l'accord approprié et limiter sa fréquence. Aucun test de téléchargement ou d'ajout massif.

Tester : titre connu disponible ; absent ; homonymes ; demande existante ; suivi sans fichier ; série partielle ; résultat indexeur ; aucun résultat ; jeton invalide ; accès interdit ; timeout ; service indisponible ; réponse inattendue. Documenter les cas non reproductibles plutôt que les inventer.

Pour chaque capacité : documentation de référence, version, méthode/chemin réellement testés, paramètres expurgés, permissions, réponse anonymisée, mapping des champs, effets de bord, durée et statut PASS/FAIL/BLOCKED/NOT TESTED.

Les tests d'écriture sont séparés, avec accord humain préalable, cible de test et plan de nettoyage approuvé. Un nettoyage est lui-même une modification à autoriser.

### 8.4 Porte de validation G1
Aucune implémentation d'un connecteur produit avant validation de ses capacités essentielles. Toute capacité manquante entraîne une décision explicite : périmètre réduit, investigation supplémentaire ou abandon de la fonction. Pas d'endpoints fictifs ; mocks clairement identifiés uniquement après contrat validé.

## 9. Architecture cible à étudier
Frontend React 19 + TypeScript + Vite + Tailwind v4. Backend assurant authentification, RBAC, orchestration, API des services, fournisseur IA, confirmation des actions, quotas et audit. Secrets uniquement côté serveur. Aucun appel privilégié direct depuis le navigateur.

Définir des adaptateurs séparés par service et un modèle de domaine normalisé. La couche de conversation ne doit pas dépendre directement des réponses brutes de chaque fournisseur. Privilégier l'approche la plus simple adaptée à un homelab ; ne pas ajouter microservices, broker ou base vectorielle sans besoin démontré.

ADR obligatoires : backend/framework ; persistance et migrations ; moteur d'orchestration ; stratégie d'identité ; fournisseur IA ; déploiement et exposition réseau ; gestion des confirmations et de l'idempotence.

La matrice de compatibilité frontend doit être vérifiée avant scaffolding ; un changement de version majeure exige justification et validation.

## 10. Orchestration et sécurité IA
- Le modèle comprend l'intention, sélectionne des outils autorisés et rédige à partir des preuves.
- Le serveur valide tous les arguments et applique droits, budget, bornes et règles.
- Les réponses des services, titres de médias et descriptions sont des données non fiables, jamais des instructions.
- Ne pas transmettre clés, tokens, URLs de téléchargement ou dumps de bibliothèques au fournisseur IA.
- Minimiser les données envoyées ; documenter la politique de conservation du fournisseur vérifiée.
- Nombre maximal de tours d'outils, recherche ciblée, timeout global et arrêt sur budget.
- Aucun ordre en langage naturel ne peut contourner une confirmation ou une permission.
- Définir des erreurs structurées, un mode de réponse partielle et un mode sans IA pour les vérifications simples si retenu.
- L'estimation de coût est basée sur consommation et tarifs configurés vérifiés, pas sur un prix inscrit arbitrairement dans le code.

## 11. Contrat d'outils interne proposé
Noms conceptuels à finaliser après qualification : resolve_title, get_library_availability, get_requests, get_arr_status, search_indexers, get_acquisition_diagnostics, prepare_request, confirm_request.

Chaque outil définit schéma d'entrée, schéma de sortie, permissions, impact, délais, quotas et politique de journalisation. Les actions préparées sont liées à un utilisateur, une cible, des arguments immuables, une expiration et un identifiant à usage unique. La confirmation ne doit pas être un simple mot interprété librement par le modèle.

Un service indisponible retourne un état d'erreur, jamais une collection vide assimilée à une absence.

## 12. Sécurité et confidentialité
Valider cryptographiquement l'identité Cloudflare, les paramètres de confiance et l'audience sur la base de la documentation et de tests réels. Ne jamais faire confiance à un simple en-tête e-mail. Empêcher le contournement par accès direct au backend/origine.

RBAC serveur, moindre privilège, secrets hors dépôt, redaction des logs, protections de session/CSRF adaptées au mode d'authentification, limitation de débit et validation des entrées. Les URLs de connecteurs sont configurables uniquement par admin, avec restrictions réseau/SSRF adaptées au homelab et documentées.

Ne pas exposer aux utilisateurs les indexeurs, passkeys, chemins internes, autres comptes ou détails sensibles. Les liens Plex ne sont affichés que s'ils sont vérifiés et autorisés. Aucune garantie d'accès Plex ne découle de l'accès au portail.

Prévoir politique de conservation et suppression des conversations, e-mails et audits ; sauvegarde et restauration de la base ; journal des actions sans contenu secret. Utilisation pour des contenus et sources autorisés ; pas de mécanisme de contournement de droits.

## 13. UX attendue
Chat français responsive ; sélecteur d'œuvre en cas d'ambiguïté ; fiches titre/année/type ; badges de statut multidimensionnels ; sources lisibles et heure de vérification ; choix des saisons ; récapitulatif avant action ; liens disponibles ; page Mes demandes ; erreurs actionnables.

Côté admin : état des connexions, test de connexion contrôlé, diagnostics, gestion des utilisateurs, état de synchronisation Access, quotas, consommation IA, audit. Ne pas afficher de faux « connecté » à partir de la seule présence d'une clé.

## 14. Déploiement et exploitation
Livrer Dockerfile(s), Compose, configuration d'exemple sans secret, contrôles de santé, utilisateur non privilégié lorsque possible, volumes persistants, migrations, stratégie de versions, sauvegarde/restauration et procédure de retour arrière. Ne pas toucher aux déploiements arr existants.

Documenter exposition Cloudflare, résolution DNS/réseau Docker, validation de certificats et accès aux services privés. Aucun contournement TLS global par défaut. Dépendances et images choisies explicitement avec stratégie de mise à jour.

Logs structurés et identifiants de corrélation ; latence et erreurs par service ; budgets IA ; visibilité des échecs de synchronisation. Distinguer santé du portail et santé des intégrations.

## 15. Tests et critères d'acceptation
1. Un titre réellement présent est signalé disponible avec preuve Plex récente et portée correcte.
2. Une API en échec produit « impossible à vérifier », pas « absent ».
3. Des homonymes produisent une demande de clarification avant toute écriture.
4. Une série partielle n'est pas présentée comme intégralement disponible.
5. Une demande existante ne génère pas de doublon ; les courses et retries sont testés.
6. Une demande nouvelle n'est créée qu'après confirmation liée à la cible exacte et autorisation serveur.
7. Un résultat Prowlarr n'est jamais présenté comme preuve de téléchargement ni d'acceptabilité Radarr/Sonarr.
8. Un diagnostic sans raison vérifiée présente explicitement ses limites.
9. Un utilisateur ne peut pas accéder aux fonctions admin ni aux demandes privées d'autrui.
10. Une identité Cloudflare falsifiée ou une audience incorrecte est rejetée.
11. Ajout/retrait d'accès ne modifie que la règle ciblée et conserve les autres conditions ; échecs partiels visibles.
12. Aucun secret dans frontend, dépôt, réponses utilisateur ou logs.
13. Un prompt malveillant dans un titre ou une réponse API ne déclenche aucune action supplémentaire.
14. Les limites d'appels et de jetons interrompent proprement une boucle.
15. Installation, sauvegarde et restauration sont reproductibles suivant le runbook.

Prévoir tests unitaires, contrats basés sur fixtures anonymisées, intégration avec services de test autorisés, parcours E2E, sécurité et reprise sur panne. Les mocks ne constituent pas une validation d'API réelle.

## 16. Documents qu'Antigravity doit produire
- docs/00-discovery.md : existant, exigences confirmées, hypothèses et questions priorisées.
- docs/01-api-validation-plan.md : matrice et procédures sûres avant exécution.
- docs/02-api-validation-report.md : preuves réelles, versions, limites et verdicts ; jamais prérempli comme succès.
- docs/03-architecture.md : composants, frontières, flux et déploiement.
- docs/adr/ : décisions et alternatives, incluant celles citées au §9.
- docs/04-security-threat-model.md : actifs, menaces, contrôles, identité et matrice de droits.
- docs/05-data-model.md : entités, identifiants, provenance, rétention et migrations.
- docs/06-api-and-tool-contracts.md : contrats backend/outils et politique des erreurs/confirmations.
- docs/07-ux-spec.md : parcours, écrans et états d'erreur.
- docs/08-test-plan.md : tests traçables et critères d'acceptation.
- docs/09-implementation-plan.md : jalons, dépendances, périmètre et portes de validation.
- docs/10-operations-runbook.md : installation, configuration, sauvegarde, restauration et diagnostic.
- docs/11-open-questions.md : décisions attendues et conséquences.
- docs/12-requirements-traceability.md : exigence → capacité API → contrat → test → jalon.

Ces documents peuvent être initialement marqués DRAFT/BLOCKED. Les documents en aval ne doivent pas masquer une qualification manquante.

## 17. Jalons et portes humaines
G0 : lecture du PRD, découverte, plan de tests et questions ; pas de code produit.
G1 : qualification réelle des API et acceptation du périmètre réalisable.
G2 : validation architecture, sécurité, contrats, UX et plan d'implémentation.
G3 : MVP en lecture seule validé avant activation des écritures.
G4 : demandes Overseerr et gestion Access activées séparément après tests et approbations.
G5 : recette, runbook et déploiement validés.

Toute modification externe requiert une autorisation spécifique ; une validation documentaire n'est pas une autorisation générale de modifier la production.

## 18. Questions à résoudre sans bloquer la rédaction initiale
Versions et URLs des services ; client de téléchargement ; identité Plex/Overseerr des amis ; bibliothèques communes ou individuelles ; règles d'approbation ; quotas ; accès aux recherches indexeurs pour tous ou admins ; configuration Cloudflare existante et voie de récupération ; infrastructure hôte ; modèle DeepSeek et budget ; conservation des données.

L'agent doit grouper les questions par priorité, proposer des options sans les transformer en décisions et ne demander les secrets que via un canal/configuration sécurisé, jamais dans une conversation ou un document versionné.
