# ADR 004 — Stratégie d'identité : Cloudflare Access ↔ Plex ↔ Overseerr

- **Statut :** `PROPOSED FOR G2`
- **Date :** 2026-10-30
- **Décideurs :** Architecte & Propriétaire Homelab

## 1. Contexte
Le portail Askarr est exposé aux proches via **Cloudflare Access** (application `askarr`, policy `allow askarr-user`). Lorsqu'un utilisateur accède au portail, Cloudflare Access l'authentifie et injecte l'en-tête signé `Cf-Access-Jwt-Assertion` contenant son adresse e-mail vérifiée.

Par ailleurs, la qualification G1 sur Overseerr (`nucbuntu:5055`) a montré que 33 des 34 utilisateurs d'Overseerr sont des comptes Plex importés (`userType: 1`), et le propriétaire a fixé la règle métier suivante : **tout ami utilisant Askarr doit obligatoirement être client Plex et donc exister dans Overseerr**.

## 2. Options considérées

| Option | Avantages | Inconvénients |
|---|---|---|
| **Option A : Mapping strict 1-à-1 par e-mail (Cloudflare JWT → Compte Plex/Overseerr `userType: 1`) + Attribution `userId` Overseerr** | Zéro double authentification pour l'ami, chaque demande créée dans Overseerr est rattachée au vrai compte Plex/Overseerr de l'ami (`requestedBy`), respect des quotas Overseerr individuels, blocage propre si l'e-mail n'est pas encore client Plex. | Nécessite que l'ami utilise la même adresse e-mail dans Cloudflare Access et sur son compte Plex (ou une table de correspondance d'alias admin). |
| **Option B : Compte de service unique partagé pour toutes les demandes** | Fonctionne même sans compte Plex. | Contredit la règle du propriétaire (un ami sans compte Plex ne pourrait de toute façon pas regarder le média demandé) et perd la traçabilité individuelle dans Overseerr. |

## 3. Décision retenue
Nous retenons **l'Option A : Mapping strict 1-à-1 par e-mail avec table d'alias optionnelle gérée par l'admin**.

### Flux de résolution d'identité sur chaque requête :
1. **Validation cryptographique Cloudflare Access :**
   - Vérification de la signature RS256 de `Cf-Access-Jwt-Assertion` contre le JWKS public `https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, de l'audience (`aud === CF_ACCESS_AUD`), de l'émetteur (`iss`) et de l'expiration (`exp`).
   - Extraction de l'adresse e-mail normalisée (`email.trim().toLowerCase()`).
2. **Résolution du rôle Askarr :**
   - Si l'e-mail appartient à la liste `ADMIN_EMAILS` (variable d'environnement), le rôle est `admin`.
   - Sinon, le rôle est `friend`.
3. **Rattachement au compte Plex / Overseerr :**
   - Le backend recherche l'e-mail (ou son alias configuré par l'admin dans la table locale `user_identity_links`) parmi les utilisateurs Overseerr (`GET /api/v1/user`, mis en cache mémoire 5 minutes et rafraîchi à la demande).
   - **Si le compte Overseerr est trouvé (`overseerrUserId`) :**
     - Ses demandes (« Mes demandes ») sont filtrées sur `requestedBy.id === overseerrUserId`.
     - Lors d'une création de demande confirmée (`POST /api/v1/request`), le backend transmet explicitement `userId: overseerrUserId` afin qu'Overseerr attribue la demande au compte Plex de l'ami et applique ses permissions/quotas.
   - **Si aucun compte Overseerr ne correspond à l'e-mail :**
     - Le statut de profil renvoie `overseerrLinked: false`.
     - La consultation du catalogue en lecture reste possible (ou restreinte selon choix), mais **toute création de demande est bloquée** avec un message explicite non technique : *« Ton adresse e-mail n'est pas encore rattachée à un compte Plex sur le serveur. Contacte l'administrateur pour activer ton compte Plex. »*
4. **Vérification préventive côté Admin Cloudflare Access :**
   - Lorsque l'admin ajoute l'e-mail d'un ami dans la policy `allow askarr-user` depuis l'interface Admin d'Askarr, le backend vérifie simultanément si cet e-mail existe dans Overseerr (`userType: 1`) et affiche un badge **`Client Plex reconnu`** ou **`Attention : e-mail inconnu dans Overseerr/Plex`** (avec possibilité de lier un alias si l'ami a un e-mail Plex différent de son e-mail de connexion Cloudflare).

## 4. Conséquences
- **Positives :** Zéro demande orpheline, traçabilité parfaite dans Overseerr et Askarr, expérience transparente sans second mot de passe.
- **Négatives / Garde-fous :** En développement local uniquement (`NODE_ENV=development` sur `127.0.0.1` avec `ALLOW_DEV_AUTH_HEADER=true`), un en-tête simulé est toléré ; en production (`NODE_ENV=production`), le démarrage échoue (`fail-fast`) si `CF_ACCESS_TEAM_DOMAIN` ou `CF_ACCESS_AUD` est manquant ou si `ALLOW_DEV_AUTH_HEADER` est activé.
