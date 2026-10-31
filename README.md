# 🎬 Askarr — Grand Cinéma & Séries (Copilote IA Plex, Overseerr & *arr)

**Askarr** est une salle de cinéma virtuelle et un copilote conversationnel IA conçu pour accompagner une fédération de serveurs **Plex Media Server**, **Overseerr**, **Radarr**, **Sonarr**, **Prowlarr**, **Cloudflare Zero Trust Access** et **Google SMTP**.

---

## ✨ Fonctionnalités Principales

- **🍿 Salle Ciné & Recherche Hybride (DeepSeek + TMDB/IMDb)** :
  - Recherche en langage naturel (par souvenir d'intrigue, réalisateur, acteur, année ou palmarès comme le Festival de Cannes / César / Oscars).
  - Affichage des notes **IMDb** et **TMDB**, résumés complets en français, statut cinéma / VOD / DVD.
- **🎞️ Fédération Multi-Serveurs Plex & Deep Links Directs** :
  - Interrogation simultanée de tous vos serveurs Plex configurés (ou auto-découverts via `plex.tv`).
  - Vérification personnalisée des accès de chaque ami Plex serveur par serveur.
  - **Boutons de lecture directe** : ouverture directe de la fiche du film dans **Plex Web** (`app.plex.tv`) sur PC/Mac ou dans l'**application native Plex iOS** (`plex://preplay/...`) sur iPhone/iPad.
- **📥 Programmation en 2 Clics (Overseerr + Radarr/Sonarr)** :
  - Création de demandes Overseerr avec jeton de confirmation idempotent et réactivation automatique de la surveillance (`monitored=true`) dans Radarr/Sonarr.
- **🎟️ Annuaire Plex.tv, Cloudflare Zero Trust & Billets VIP par Email** :
  - Synchronisation de l'annuaire des amis partagés sur `plex.tv` avec leurs accès serveurs respectifs.
  - Import en 1 clic dans les groupes/policies **Cloudflare Access** avec historique et rollback SQLite.
  - Envoi automatique de **Billets d'Invitation VIP** au design Grand Cinéma via **Google SMTP** (Mot de passe d'application).
- **⚙️ 100 % Paramétrable à Chaud (Web UI + SQLite)** :
  - Édition des URLs, clés API, tokens et auto-découverte des serveurs Plex directement depuis `Régie Admin` → `Paramètres & Identités`, sans redémarrer le conteneur.

---

## 🚀 Déploiement Docker (Port `4880`)

```bash
mkdir -p /storage/Docker/Askarr/data
cd /storage/Docker/Askarr
cp .env.example .env
# Renseignez vos clés dans .env (ou configurez-les ensuite dans l'interface Régie Admin)
docker compose up -d
```

L'application est alors accessible sur **`http://localhost:4880`** (sonde de santé : `GET /api/health/live`).
