# 00 — Découverte et cadrage initial (G0)

- **Statut :** `READY FOR REVIEW (G0)`
- **Date :** 2026-10-30
- **Sources analysées :** `PRD/STEP0_PRD.md`, `PRD/ANTIGRAVITY_START_PROMPT.md`, contexte initial fourni par le propriétaire.

---

## 1. Inspection du workspace et de l'existant

### 1.1 Contenu du dépôt à l'état initial
L'inspection sans modification du répertoire de travail (`/Users/jsuzanne/Github/askarr`) révèle :
- `PRD/STEP0_PRD.md` : spécification initiale complète (STEP 0).
- `PRD/ANTIGRAVITY_START_PROMPT.md` : directives de gouvernance, portes de validation (`G0` à `G5`) et règles non négociables.
- Aucun code applicatif, aucun conteneur ni fichier de secret n'est présent dans le workspace initial.
- Un fichier `.gitignore` a été mis en place dès G0 afin de garantir qu'aucun fichier `.env*`, clé ou réponse brute de qualification (`qualification/raw/`) ne puisse être versionné par erreur.

### 1.2 Contexte d'infrastructure communiqué par le propriétaire
En complément du PRD, le propriétaire a précisé les éléments suivants concernant son homelab :
- Les conteneurs de la stack tournent sur deux hôtes du réseau local (LAN) : **`nucbuntu`** et **`nucvillers`** (adresses IP privées RFC1918 connues de l'environnement d'exécution).
- Le ou les serveurs **Plex** sont accessibles sur le LAN.
- En plus de la stack cible du PRD (**Plex**, **Overseerr**, **Radarr**, **Sonarr**, **Prowlarr**, **Cloudflare Access**), le propriétaire dispose également d'outils complémentaires déjà installés tels que **Tautulli** et **Tracearr** (et a la capacité d'installer d'autres briques `*arr` si un besoin prouvé le justifie).
- **Cible utilisateur réaffirmée :** le portail s'adresse en priorité à des **proches non-techniques** (« qui ne comprennent pas tout ça ») souhaitant interagir simplement en lecture (savoir si un film/série est disponible ou où en est une demande) et en écriture contrôlée (demander l'ajout d'une œuvre).

> **Règle appliquée :** Conformément aux règles de G0, aucune requête réseau n'a été émise vers `nucbuntu`, `nucvillers` ou les serveurs Plex avant validation du plan de test (`docs/01-api-validation-plan.md`). Par ailleurs, aucun outil additionnel (Tautulli, Tracearr ou autre `*arr`) n'est intégré au périmètre sans manque constaté lors de G1 et validation explicite du propriétaire.

---

## 2. Synthèse du PRD : Objectif, Confirmé, Proposé, Inconnu

### 2.1 Objectif du produit
Construire **Media Copilot** (nom de travail), un portail web et conversationnel en français destiné aux amis/proches non-techniques du propriétaire et à l'administrateur :
1. **Répondre avec exactitude et traçabilité** aux questions de disponibilité et de suivi d'œuvres (films et séries) en interrogeant les API réelles, sans jamais confondre :
   - la **disponibilité réelle dans Plex** (complète ou partielle par saison/épisode),
   - l'état d'une **demande dans Overseerr** (en attente, approuvée, refusée…),
   - la **surveillance dans Radarr/Sonarr** (suivi, profil, file de téléchargement, historique),
   - la présence d'un **résultat sur les indexeurs via Prowlarr** (qui ne garantit ni la conformité aux profils Radarr/Sonarr ni un téléchargement effectif).
2. **Permettre des demandes d'ajout sécurisées** via Overseerr après résolution des homonymes, vérification des doublons et confirmation explicite côté serveur.
3. **Offrir à l'administrateur** un diagnostic technique fidèle (« Pourquoi ce n'est pas disponible ? ») et une gestion simplifiée et sûre des e-mails autorisés dans **Cloudflare Access**, sans jamais écraser ni altérer les règles de sécurité existantes.
4. **Garantir par construction** que le modèle d'IA (DeepSeek) n'est jamais décisionnaire des permissions, des quotas ou des écritures : le backend valide systématiquement les droits, les arguments et les jetons de confirmation à usage unique.

### 2.2 Exigences confirmées par le propriétaire
- **Déploiement :** Conteneurisé via Docker / Docker Compose dans le homelab.
- **Stack Frontend :** React 19, TypeScript, Vite, Tailwind CSS v4.
- **Fournisseur IA :** API DeepSeek avec contrôle strict des coûts (budgets, plafonds de jetons et de tours d'outils).
- **Services cibles du MVP :** Plex, Overseerr, Radarr, Sonarr, Prowlarr, Cloudflare Access.
- **Modèle de rôles :** Deux rôles stricts gérés côté serveur : `administrateur` (propriétaire) et `utilisateur` (amis non-techniques).
- **Authentification et gestion d'accès :** Protection par Cloudflare Access ; possibilité pour l'administrateur d'ajouter/retirer des adresses e-mail autorisées via l'API Cloudflare (après qualification de la structure exacte des politiques/listes existantes).
- **Fonctionnalités cœur :** Consultation des disponibilités, diagnostic d'état, recherche indexeurs via Prowlarr, création de demandes via Overseerr.
- **Méthode :** Qualification obligatoire des API réelles sur les versions installées (G1) avant toute implémentation de connecteur produit.

### 2.3 Propositions du PRD restant à valider par le propriétaire
Ces éléments sont proposés dans le PRD (§2) mais **ne sont pas encore considérés comme des décisions figées** :
1. **Interface hybride :** Chat conversationnel accompagné de fiches visuelles structurées (poster, titre, année, badges d'état multidimensionnels) et d'une page dédiée « Mes demandes ».
2. **Backend en TypeScript :** Choix du framework web, de la base de données locale (ex. SQLite vs PostgreSQL) et des bibliothèques à trancher via les ADR en phase G2.
3. **Flux de confirmation obligatoire :** Chaque écriture (création de demande Overseerr, modification d'accès Cloudflare) exige une étape de préparation (`prepare_*`) suivie d'une confirmation explicite (`confirm_*`) par bouton/action UI liée à un jeton serveur à usage unique (jamais un simple « oui » interprété librement par le LLM).
4. **Restrictions de sécurité du MVP :** Aucun déclenchement direct d'un téléchargement de release dans Radarr/Sonarr, aucune modification de profil de qualité, aucune suppression de média depuis le portail.
5. **Cloisonnement du diagnostic technique :** Les détails techniques d'acquisition (noms d'indexeurs, motifs de rejet techniques Radarr/Sonarr, files d'attente détaillées) sont réservés au rôle `administrateur` ; l'utilisateur non-technique reçoit une explication vulgarisée et honnête (ex. « Demandé et en cours de recherche automatisée », « En cours de téléchargement », « Introuvable pour le moment »).
6. **Approche Mobile-First :** Interface pensée en priorité pour un usage sur smartphone par les proches.
7. **Extensibilité future vers Seerr :** Architecture à adaptateurs permettant d'évoluer vers Seerr ultérieurement, mais **aucun développement Seerr dans le MVP** (cible exclusive : Overseerr installé).

### 2.4 Inconnues techniques et fonctionnelles à lever (en G0 / G1)
1. **Topologie et versions exactes :** Répartition exacte des conteneurs entre `nucbuntu` et `nucvillers`, ports/URLs internes, présence éventuelle de plusieurs instances (ex. Radarr HD + Radarr 4K, ou plusieurs serveurs Plex).
2. **Identité et correspondance des comptes :** Comment un utilisateur authentifié par son e-mail dans Cloudflare Access est-il associé à un utilisateur Overseerr (et éventuellement Plex) ? Les amis ont-ils tous un compte Plex/Overseerr correspondant au même e-mail, ou les demandes Overseerr doivent-elles être rattachées via l'API key admin avec l'attribut `userId` d'Overseerr ?
3. **Politique d'approbation Overseerr :** Les demandes créées via le portail doivent-elles suivre les permissions/quotas propres à chaque utilisateur dans Overseerr (approbation automatique vs validation manuelle par le propriétaire) ?
4. **Portée des séries dans Overseerr :** Comportement exact de la version d'Overseerr installée lors d'une demande de série (toutes les saisons, saisons spécifiques, saison en cours) et gestion des doublons partiels.
5. **Structure actuelle de Cloudflare Access :** L'accès actuel repose-t-il sur une *Access Policy* intégrée à l'application ou sur une *Access Group / Zero Trust List* d'e-mails réutilisable ? Quelles sont les permissions exactes du token API Cloudflare disponible ?
6. **Pertinence éventuelle de Tautulli / Tracearr :** Les API de Plex, Overseerr, Radarr, Sonarr et Prowlarr suffisent-elles à couvrir 100 % des besoins du PRD, ou Tracearr/Tautulli apportent-ils une information indispensable non disponible directement (à vérifier uniquement si un manque est constaté en G1) ?

---

## 3. Risques majeurs identifiés et stratégies de maîtrise

| ID | Risque majeur | Impact | Stratégie de maîtrise dès G0/G1 |
|---|---|---|---|
| **R1** | **Confusion entre résultat Prowlarr et disponibilité/téléchargement** : l'IA ou l'utilisateur croit qu'un titre trouvé sur un indexeur va être téléchargé ou est déjà accepté par Radarr/Sonarr. | Faux positifs, frustration des utilisateurs non-techniques, mauvais diagnostic. | Modèle d'état à 8 dimensions indépendantes (PRD §7) ; interdiction formelle dans les contrats d'outils et le prompt système de déduire l'acceptabilité Radarr/Sonarr à partir de Prowlarr. |
| **R2** | **Confusion entre erreur technique (API indisponible / timeout) et absence d'œuvre** : un service injoignable renvoie un résultat interprété comme « Ce film n'est pas sur Plex ». | Demandes en doublon ou fausses réponses aux utilisateurs. | Typage strict des retours d'outils : un connecteur en erreur renvoie `UNKNOWN` / `SERVICE_UNAVAILABLE` avec preuve d'erreur, jamais une liste vide `[]`. |
| **R3** | **Altération accidentelle d'une politique Cloudflare Access** : une mise à jour API remplace une règle complexe (MFA, pays, bypass service token) par une simple liste d'e-mails. | Coupure d'accès administrateur (lockout) ou affaiblissement de la sécurité périmétrique. | Inspection en lecture seule obligatoire en G1 ; manipulation ciblée d'une liste ou règle dédiée ; conservation intacte des autres règles ; maintien d'une voie de secours administrateur. |
| **R4** | **Sollicitation excessive des indexeurs via Prowlarr** : des recherches répétées ou trop larges déclenchées par le chat consomment les quotas d'API des indexeurs privés/semi-privés ou entraînent un bannissement. | Perte d'accès aux indexeurs du homelab. | Quotas stricts côté serveur, cache de courte durée, limitation de la recherche Prowlarr aux cas nécessaires (diagnostic ou vérification ciblée), un seul appel limité en G1 après accord. |
| **R5** | **Action d'écriture déclenchée sans intention claire ou par injection de prompt** : un titre ou résumé de média malveillant, ou une hallucination du modèle, déclenche une demande Overseerr. | Pollution d'Overseerr/Radarr/Sonarr, contournement de règles. | Séparation `prepare_request` (lecture/validation) et `confirm_request` (jeton cryptographique ou UUID à usage unique validé par clic UI côté serveur). Le LLM ne peut jamais appeler `confirm_request` de lui-même. |
| **R6** | **Fuite d'informations techniques ou sensibles vers les utilisateurs non-techniques** : exposition des URLs LAN (`nucbuntu`/`nucvillers`), clés API, passkeys de trackers ou demandes privées d'autres amis. | Risque de sécurité et d'atteinte à la confidentialité entre proches. | Sanitisation côté serveur avant envoi au LLM et au frontend ; RBAC strict sur l'historique des demandes ; masquage complet des URLs d'indexeurs et de téléchargement. |
| **R7** | **Dérive des coûts ou boucles d'appels DeepSeek** : conversations longues ou boucles d'outils non bornées. | Facturation imprévue et latence élevée. | Plafond de tours d'outils par message (ex. max 3-4 étapes), budget journalier/mensuel configurable en base, et possibilité de court-circuiter l'IA pour les actions purement déterministes (clic de confirmation, consultation « Mes demandes »). |

---

## 4. Prochaines étapes immédiates (Porte G0)

1. Prendre connaissance des questions priorisées dans [`docs/11-open-questions.md`](./11-open-questions.md) (en particulier les questions **P0** nécessaires pour lancer la qualification).
2. Renseigner les coordonnées et clés de lecture dans un fichier local non versionné (voir procédure dans [`docs/01-api-validation-plan.md`](./01-api-validation-plan.md)).
3. Valider le plan de test initial en lecture seule pour autoriser le passage à l'exécution **G1**.
