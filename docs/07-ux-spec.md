# 07 — Spécification UX & Parcours Utilisateurs en Français (Porte G2)

- **Statut :** `READY FOR REVIEW (G2)`
- **Date de mise à jour :** 2026-10-30
- **Périmètre :** Design d'expérience utilisateur (mobile-first et desktop), dictionnaire de traduction non technique, composants interactifs et parcours Ami / Admin.

---

## 1. Philosophie UX : Zéro Jargon Technique pour les Proches

Les amis et membres de la famille qui utilisent Askarr ne connaissent ni `Radarr`, ni `Sonarr`, ni `Overseerr`, ni `Prowlarr`, ni `TMDB`. L'interface et le copilot appliquent un **dictionnaire de traduction systématique** :

| État technique interne (`MediaEvidence`) | Badge visuel & Formulation affichée à l'ami (Français) | Couleur du badge |
|---|---|---|
| `catalogPresence: 'available_now'` (bibliothèque commune `Films` / `Séries TV`) | **Disponible sur Plex** *(Bibliothèque : Films / Séries TV — tous serveurs)* | Vert émeraude |
| `catalogPresence: 'available_now'` (bibliothèque dédiée, ex. `Cinephile` sur `NucBuntu`) | **Disponible sur Plex** *(Bibliothèque : Cinephile — serveur NucBuntu)* | Vert émeraude |
| `catalogPresence: 'partially_available'` | **Partiellement disponible sur Plex** *(ex. Saison 1 présente, Saison 2 absente)* | Bleu ciel |
| `acquisitionPipeline: 'downloading'` | **Téléchargement en cours** *(avec barre de progression %)* | Indigo animé |
| `acquisitionPipeline: 'monitored_waiting_release'` (dans Radarr, `hasFile: false` + `digitalRelease` / `physicalRelease` futur) | **Déjà dans la liste d'attente** — *Sortie numérique/DVD estimée le JJ/MM/AAAA* | Ambre |
| `acquisitionPipeline: 'monitored_searching'` (sorti, surveillé dans Radarr/Sonarr, 0 release trouvée) | **En recherche automatique** *(Déjà demandé, le serveur surveille sa disponibilité)* | Ambre |
| `catalogPresence: 'not_in_catalog'` + `canRequestNow: true` | **Pas encore sur Plex** — Bouton **« Demander l'ajout »** | Neutre / Action |
| `blockReason: 'UNLINKED_PLEX_USER'` | **Compte Plex non relié** — *Demande à l'administrateur d'associer ton e-mail Plex* | Rouge doux |
| `provenance` partiellement en erreur (`unknown`) | **Vérification partielle** — *Certains services répondent lentement, état confirmé sur les sources disponibles* | Gris ardoise |

---

## 2. Architecture de navigation (Mobile-First & Desktop)

L'application utilise une barre de navigation épurée en haut (et barre d'onglets basse sur mobile) avec 2 onglets pour un `friend` et 3 onglets pour un `admin` :

1. **Copilot & Recherche (`/`)** :
   - En-tête d'accueil personnalisé (*« Bonjour [Prénom/Pseudo Plex], quel film ou série cherches-tu ? »*).
   - Barre de saisie universelle en bas (permettant à la fois de poser une question libre en français/anglais ou de lancer une recherche directe instantanée).
   - Suggestions rapides au démarrage :
     - *« Conseille-moi un très bon film déjà dispo sur Plex (note > 7.5) »*
     - *« Est-ce que ce film est sur Plex ou bientôt dispo en VOD/DVD ? »*
     - *« Qu'est-ce qu'il y a de bien dans la bibliothèque Cinéphile ? »*
     - *« Où en sont mes demandes récentes ? »*
2. **Mes demandes (`/requests`)** :
   - Liste visuelle des demandes de l'ami avec leur statut enrichi en direct (disponibilité Plex `nucvillers`, progression de téléchargement ou date de sortie VOD/DVD attendue).
3. **Administration (`/admin` — visible uniquement si `role === 'admin'`)** :
   - Sous-onglets : **Accès Amis (Cloudflare)** | **Santé Services** | **Budget IA DeepSeek** | **Journal d'Audit**.

---

## 3. Composants d'interface structurants

### 3.1 Carte Média, Conseil & Désambiguïsation (`MediaCandidateCard`)
Lorsqu'une recherche ou une recommandation retourne une ou plusieurs œuvres (ex. `"Dune"`, un titre en anglais comme `"The Enforcer"`, ou une demande de conseil par genre/note), Askarr affiche des cartes visuelles complètes :
- **Affiche TMDB/Plex** (ou placeholder élégant si absente) ;
- **Titre français** en gras + **Titre original (VO)** en sous-titre italique s'il diffère (ex. *L'inspecteur ne renonce jamais* — *VO : The Enforcer*) ;
- **Note IMDb / TMDB** mise en valeur (ex. `⭐ 8.5/10`), **Année**, **Durée** (`2h46`), **Genres** (*Science-Fiction, Aventure*) et **Réalisateur / Acteurs principaux** ;
- **Synopsis court en français** (2 lignes extensibles) ;
- **Badge de disponibilité immédiate ou future** (calculé depuis `Plex multi-serveurs` + `Radarr/Sonarr` + `Overseerr/TMDB`) :
  - Si déjà sur Plex dans une bibliothèque commune : badge vert **« Disponible sur Plex (Films / Séries TV) »**.
  - Si déjà sur Plex dans un partage spécialisé : badge vert **« Disponible sur Plex (Bibliothèque Cinephile — serveur NucBuntu) »**.
  - Si dans Radarr/Overseerr en attente de sortie : badge ambre **« Dans la liste d'attente — Sortie VOD/DVD prévue le 17/06/2026 »**.
  - Si pas encore demandé mais encore au cinéma : indication **« En salle — Sortie VOD/DVD prévue vers le ... »** + bouton **« Programmer l'ajout automatique »**.
  - Si déjà sorti en VOD/DVD et absent de Plex : bouton primaire **« Demander ce film »** (appelle directement `POST /api/actions/prepare`, `0 token IA`).
  - Si série TV : bouton **« Choisir les saisons »** ouvrant le sélecteur de saisons.

### 3.2 Sélecteur de Saisons Interactif (`SeasonPickerModal`)
Pour toute série TV, l'utilisateur visualise l'état exact de chaque saison (fusion `Plex nucvillers` + `Sonarr` + `Overseerr`) :
- **Saison 1 (6/6 épisodes) :** Grisée avec coche verte *« Déjà sur Plex »*.
- **Saison 2 (En cours de suivi) :** Grisée avec badge ambre *« Déjà dans la liste d'attente »*.
- **Saison 3 (10 épisodes) :** Case à cocher active *« Demander la saison 3 »*.
- Bouton **« Préparer la demande »** qui génère la carte de confirmation sans solliciter le LLM.

### 3.3 Carte de Confirmation à Usage Unique (`ActionConfirmationCard`)
Avant toute écriture dans Overseerr ou Cloudflare Access, l'interface présente un encart mis en évidence :
- Récapitulatif clair : **Titre FR + VO**, **Année**, **Type**, **Saisons sélectionnées**, **Compte Plex bénéficiaire** ;
- Compteur de validité du jeton (*« Valable 10 min »*) ;
- Bouton vert **« Confirmer la demande »** (désactivé dès le premier clic avec spinner *« Enregistrement... »* pour empêcher tout double-clic) ;
- Bouton secondaire **« Annuler »**.

### 3.4 Panneau Admin : Gestion des Accès Cloudflare (`askarr` / `allow askarr-user`)
Conçu pour gérer la policy `allow askarr-user` en toute sécurité :
- Liste des adresses e-mail actuellement autorisées dans Cloudflare Access ;
- En face de chaque e-mail, indicateur automatique de rattachement Plex/Overseerr :
  - Badge vert : **`Client Plex vérifié (@PseudoPlex)`**
  - Badge orange : **`Absent d'Overseerr/Plex`** (avec bouton pour associer un alias si l'e-mail Plex de l'ami diffère de son e-mail Cloudflare) ;
- Formulaire **« Ajouter un ami »** : saisit l'e-mail, vérifie instantanément s'il existe dans Overseerr, affiche l'aperçu du diff (`+nouvel.ami@mail.fr`), et demande confirmation en 1 clic ;
- Protection visuelle : l'e-mail de l'administrateur porte un cadenas **« Admin (protégé) »** et son bouton de suppression est désactivé ;
- Historique des révisions locales avec bouton **« Restaurer cette version (Rollback) »**.
