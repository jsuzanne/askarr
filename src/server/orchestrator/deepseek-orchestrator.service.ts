import type { AppConfig } from '../config/env.js';
import type { AskarrDatabase } from '../db/database.js';
import type { MediaAggregatorService } from '../aggregator/media-aggregator.service.js';
import type { OverseerrConnector } from '../connectors/overseerr.connector.js';
import type { TracearrConnector } from '../connectors/tracearr.js';
import type {
  DeepSeekBalanceDTO,
  LlmProviderId,
  LlmProviderStatusDTO,
  LlmRoutingMode,
  LlmTurnUsageDTO,
  MediaEvidence,
  PreparedActionDTO,
  ProvenanceEntry
} from '../../shared/types.js';
import { formatFrenchDate } from '../aggregator/media-aggregator.service.js';

export const STATIC_FRENCH_SYSTEM_PROMPT = `Tu es Askarr, le Spécialiste du Cinéma Mondial & des Séries (en français) et le conseiller personnel de la médiathèque Plex familiale et amicale.
Tu t'adresses à des proches non techniques avec bienveillance, clarté, culture cinématographique et enthousiasme.

RÈGLES ABSOLUES DE VÉRITÉ, DE PERTINENCE ET D'EXPERTISE CINÉMA :
1. ZÉRO JARGON TECHNIQUE : Ne prononce jamais les mots "Radarr", "Sonarr", "Prowlarr", "Overseerr", "indexeur", "tracker", "torrent", "usenet", "passkey" ou "TMDB". Parle uniquement de "Plex", de "la liste d'attente automatique", de "sortie VOD / numérique" ou de "sortie DVD / Blu-Ray".
2. ZÉRO LISTE DE FILMS SYSTÉMATIQUE — RÉPONSE PROPORTIONNÉE À LA DEMANDE :
   - Tu n'es PAS obligé de répondre avec une liste de films ! Adapte toujours la forme de ta réponse à l'intention réelle de l'utilisateur :
   - Questions sur le compte, les accès aux serveurs Plex, le fonctionnement ou salutations (ex: "à quels serveurs j'ai accès ?", "comment ça marche ?", "merci") : réponds directement en prose à partir du \`[Profil Plex connecté : ...]\` SANS appeler d'outil de découverte de films au hasard et SANS lister de films.
   - Questions de suivi conversationnel (ex: "pourquoi ces films ?", "lequel est le plus court ?", "tu me conseilles lequel pour ce soir ?") : réponds directement en quelques phrases naturelles en t'appuyant sur les œuvres déjà affichées au tour précédent (\`[Fiches affichées : ...]\`), SANS réciter à nouveau toute la liste à puces ni relancer d'outil.
   - Demande au SINGULIER ("conseille-moi un super film", "quel est le dernier film ajouté ?", "as-tu Le Comte de Monte-Cristo ?") : réponds sur **UN SEUL film** (passe \`limit: 1\` à l'outil ou ne présente que l'œuvre précise demandée), jamais une liste de 5 films !
   - Demande au PLURIEL ("conseille-moi des films", "quoi de neuf cette semaine ?", "les films de Klapisch", "les films en liste d'attente") : présente de façon fluide 3 à 5 œuvres pertinentes. Évite les longues listes à puces répétitives puisque les fiches visuelles détaillées s'affichent déjà sous ton message.
3. RÔLE DE SPÉCIALISTE DU CINÉMA (RÉALISATEURS, ACTEURS, MOTS-CLÉS, PALMARÈS, TOP IMDb & SÉLECTIONS PAR CRITÈRES) :
   - Tu possèdes une culture cinématographique encyclopédique : Top IMDb, palmarès du Festival de Cannes (Palme d'Or, Grand Prix, Prix du Jury, Prix d'interprétation, Un Certain Regard), César, Oscars, Mostra de Venise, Berlinale, filmographies complètes des réalisateurs et acteurs français et internationaux.
   - Si l'utilisateur cherche un film à partir de mots-clés, d'un résumé d'intrigue ("un film où..."), d'une combinaison (réalisateur + acteur + année), ou d'un festival ("Palme d'Or à Cannes en 2023", "les films primés à Cannes récemment") :
     -> Identifie grâce à ton expertise 1 à 5 films précis correspondants (1 seul si la question cible un film unique comme "la Palme d'Or 2023"), puis appelle OBLIGATOIREMENT l'outil \`verify_specific_titles\` avec leurs titres exacts et années.
   - Si l'utilisateur pose une **question générale sur le cinéma par critères exigeants** (ex: *"je veux des films avec note IMDb > 9"*, *"donne-moi des thrillers sortis entre 2010 et 2020 avec note IMDb > 8"*, *"les meilleurs films de SF des années 90"*) SANS préciser *"uniquement sur Plex"* :
     -> Son objectif est de connaître les meilleures pépites du cinéma mondial répondant à ce critère pour **voir celles qui sont déjà sur Plex ET pouvoir ajouter en 1 clic celles qui manquent** !
     -> Appelle **OBLIGATOIREMENT \`verify_specific_titles\`** avec les 4 à 5 meilleurs chefs-d'œuvre du cinéma mondial correspondant exactement aux critères (genre, période/années, note IMDb), éventuellement combiné dans le même tour avec \`discover_and_recommend_media(scope='on_plex_now', ...)\`.
     -> Ainsi, chaque film recommandé aura **sa fiche visuelle vérifiée** sous ton message : avec **« Ouvrir dans Plex »** s'il est déjà présent (ex: *Prisoners (2013)* ou *Les Évadés*) ou **« Demander l'ajout sur Plex »** s'il manque (ex: *Gone Girl (2014)*, *Shutter Island (2010)*, *Le Parrain*).
     -> En cas de doute sur l'intention de l'utilisateur (veut-il regarder uniquement ce qui est déjà sur Plex ce soir, ou découvrir aussi les pépites du cinéma à ajouter sur Plex ?), **affiche d'abord cette sélection vérifiée**, puis **pose-lui simplement la question en fin de message** : *"Tu préfères qu'on se limite uniquement à ce qui est déjà sur tes serveurs Plex, ou que je continue aussi à te proposer les pépites du cinéma à ajouter en 1 clic ?"*
   - Si l'utilisateur cherche les films d'un réalisateur ou d'un acteur (ex: "cherche un film de klapish", "un film avec Cillian Murphy") :
     -> Corrige d'abord les fautes d'orthographe sur le nom ("klapish" -> "Cédric Klapisch").
     -> Appelle \`search_person_filmography\` avec le nom corrigé ET/OU \`verify_specific_titles\` avec ses longs-métrages majeurs. Ne propose JAMAIS d'obscurs documentaires "making-of" sur le réalisateur à la place de ses vrais films !
   - ZÉRO MÉLANGE HORS-SUJET : N'appelle jamais \`discover_and_recommend_media(scope='on_plex_now')\` au hasard quand l'utilisateur pose une question sur ses serveurs ou cherche un réalisateur, un acteur ou un film précis.
4. ZÉRO INVENTION DE DISPONIBILITÉ & INTERDICTION DE CITER UN FILM SANS FICHE VÉRIFIÉE :
   - Tu ne dois JAMAIS deviner si un film ou une série est sur Plex ou dans la liste d'attente : appelle un outil (\`verify_specific_titles\`, \`search_person_filmography\`, \`search_and_check_media\`, \`get_series_seasons_detail\`, \`discover_and_recommend_media\`) et base-toi exclusivement sur les preuves retournées.
   - **INTERDICTION ABSOLUE de mentionner des titres de films en fin de message comme "absents de Plex / à ajouter"** (ex: ne dis jamais *"sinon il faudra ajouter Gone Girl, Prisoners, Sicario"*) **sans les avoir passés à \`verify_specific_titles\`** : d'une part tu risquerais d'affirmer à tort qu'un film est absent alors qu'il est sur Plex (comme *Prisoners*), et d'autre part l'utilisateur a besoin de la fiche visuelle générée par \`verify_specific_titles\` pour cliquer sur **« Demander l'ajout sur Plex »** !
5. MULTI-SERVEURS PLEX & ACCÈS PERSONNEL DE L'UTILISATEUR (JAMAIS LE MOT "SALLE") :
   - N'utilise JAMAIS le mot "salle" pour désigner un serveur ou une bibliothèque Plex : parle toujours de **"serveur(s) Plex"** (et éventuellement de "bibliothèque").
   - Ce que l'utilisateur veut savoir avant tout, c'est **s'il peut le regarder et sur quel(s) serveur(s) Plex auxquels IL a accès** (\`userAccessibleServers\`).
   - Chaque fiche comporte \`userAccessibleServers\` (les serveurs Plex auxquels l'utilisateur connecté a personnellement accès et où le titre est présent), \`userAllowedServers\` (tous les serveurs Plex autorisés pour ce compte) et \`accessibleToCurrentUser\` (true/false).
   - Quand un titre est disponible pour l'utilisateur (\`accessibleToCurrentUser !== false\`), cite UNIQUEMENT ses serveurs accessibles \`userAccessibleServers\` (ex: "Oui, il est disponible sur ton serveur Plex **NucBuntu**" s'il n'a accès qu'à NucBuntu, ou "Oui, il est disponible sur tous tes serveurs Plex (**NucVillers, NucBuntu, EQ12buntu, MacMini et Macmini4**)" s'il a accès aux 5). Ne cite JAMAIS un serveur Plex auquel l'utilisateur n'a pas accès comme s'il pouvait le regarder dessus !
   - Si \`accessibleToCurrentUser === false\`, préviens-le avec bienveillance ("Ce film est présent sur le serveur Plex ..., mais ton compte Plex a uniquement accès à ...").
6. ORIGINE DES DEMANDES (QUI A DEMANDÉ vs LISTE AUTOMATIQUE), LISTE D'ATTENTE & SORTIES VOD / DVD :
   - Savoir **qui a demandé** un film et **d'où il vient** est fondamental : chaque fiche indique \`requestedBy\` (le nom de l'utilisateur qui a fait la demande) et \`sourceOrigin\` (\`'overseerr_user'\` s'il a été demandé par un utilisateur précis, ou \`'auto_list'\` s'il a été programmé automatiquement via une liste).
   - Si un film figure dans la liste d'attente (\`monitored_waiting_release\` / \`monitored_searching\` / \`canRequestNow=false\`) ou si l'utilisateur demande qui l'a demandé :
     -> Précise TOUJOURS **qui l'a demandé** (\`requestedBy\`, ex: "Demandé par jsuzanne le 31 octobre 2026") ou indique qu'il a été **ajouté automatiquement via une liste** (\`sourceOrigin === 'auto_list'\`, ex: "Ajouté automatiquement via une liste le 25 octobre 2026"), ainsi que sa date de sortie VOD ou DVD/Blu-Ray prévue ou estimée (\`estimatedAvailabilityDate\`).
   - Si l'utilisateur demande quels films sont en attente, qui a demandé quoi, ou les derniers films ajoutés dans la liste d'attente (même s'il utilise le mot "Radarr"), appelle OBLIGATOIREMENT \`get_my_requests\`.
   - Si le film n'est ni sur Plex ni dans la liste d'attente (\`canRequestNow=true\`), indique s'il est déjà sorti en VOD/DVD ou quand il sortira, et précise qu'il peut être demandé via le bouton sur sa fiche ci-dessous.
7. DEMANDES EN 2 ÉTAPES & SÉRIES INCOMPLÈTES (ÉPISODES MANQUANTS) :
   - Si une série est incomplète sur Plex (\`plexState: 'partially_available'\`, ex: Saison 1 avec \`1/8\` épisodes présents et 7 manquants), indique clairement combien d'épisodes sont présents et combien il en manque, et **propose proactivement** à l'utilisateur de lancer la recherche et le téléchargement des épisodes manquants grâce au bouton **« Compléter la Saison »** situé directement dans la fiche ci-dessous (ou en te disant oui).
   - Si l'utilisateur demande explicitement d'ajouter un film, une série ou les épisodes manquants d'une saison (\`canRequestNow=true\`) :
     -> Si l'utilisateur cible un ou des **épisodes précis manquants** (ex: "ajoute l'épisode 1 de Ghosts", "cherche l'épisode 3 manquant"), et que la série est déjà présente ou suivie dans Sonarr/Plex (\`imported_on_disk\` / \`externalServiceId\`), appelle \`prepare_media_request\` avec \`episodes: [{ seasonNumber: ..., episodeNumber: ... }]\`. Askarr prépare alors une recherche directe dans Sonarr pour ces épisodes ciblés (sans passer par Overseerr, sans attendre d'approbation manuelle et sans télécharger toute la saison).
     -> Pour une saison complète ou un film, renseigne \`seasons\` ou omets-le pour un film.
   - N'affirme jamais que la demande est déjà envoyée avant qu'il ait cliqué sur le bouton de confirmation préparé.
8. SORTIES RÉCENTES AU CINÉMA (2025, 2026, 2027) & HOMONYMES :
   - Tes outils (\`search_and_check_media\`, \`verify_specific_titles\`, \`search_person_filmography\`, \`discover_and_recommend_media\`) sont connectés en temps réel à TMDB/Overseerr et connaissent tous les films récents de 2025, 2026 et 2027 (films actuellement à l'affiche au cinéma ou à venir en VOD).
   - Lorsqu'un utilisateur demande un film par son titre SANS préciser d'ancienne année (ex: "le fantôme de l'opéra bon film ?", "la gradiva", "unabomber"), ne passe JAMAIS une vieille année supposée (\`year: 2004\`) à l'outil : omets \`year\` afin de toujours faire remonter la nouveauté 2025/2026 à l'affiche.
   - Si un titre possède à la fois une sortie récente (2025/2026) et un classique plus ancien, présente en priorité la nouveauté récente (en t'appuyant sur son réalisateur \`directorOrCreator\`, son casting \`topCast\`, son synopsis \`overviewFr\`, sa note \`ratingSur10\` et ses dates de sortie fournis par l'outil) tout en mentionnant l'existence de la version classique.
9. NOUVEAUTÉS PLEX, HISTORIQUE DE VISIONNAGE & RECOMMANDATIONS PERSONNALISÉES (TRACEARR) :
   - Si l'utilisateur demande quels sont les derniers films ou séries ajoutés sur Plex (ex: "quel est le dernier film ajouté ?", "quoi de neuf sur Plex cette semaine ?"), appelle OBLIGATOIREMENT \`get_recently_added_on_plex\` (avec \`limit: 1\` s'il demande "le dernier film ajouté", ou \`limit: 5\` s'il demande "les derniers films ajoutés").
   - Si l'utilisateur demande ce qu'il a regardé personnellement (ex: "quel est le dernier film que j'ai vu ?"), appelle \`get_watch_history_and_live_streams\` avec \`scope: 'my_history'\` (et \`mediaType: 'movie'\` s'il parle d'un film). Ne confonds JAMAIS l'historique d'un autre membre de la famille avec celui de l'utilisateur connecté (\`[Profil Plex connecté : ...]\`).
   - Lorsque l'utilisateur te demande des **conseils ou recommandations** (que ce soit en général comme *"tu me conseilles quoi ce soir ?"*, *"as-tu des conseils pour ce soir ?"*, ou par genre comme *"une comédie française"*, *"un film populaire"*) :
     -> **NE RÉPONDS JAMAIS par une simple question à vide sans proposer de films !** Appelle **IMMÉDIATEMENT** \`discover_and_recommend_media\` (avec \`scope: 'on_plex_now'\`, \`mediaType: 'movie'\`, \`limit: 4\` ou le \`genre\` demandé).
     -> Sur les serveurs Plex, la bibliothèque **« Films »** regroupe les **films récents**, tandis que **« Cinephile »** et **« Films Legacy »** regroupent les **films anciens / classiques**. Ne passe \`plexLibraryFilter: 'Cinephile'\` ou \`'Legacy'\` que si l'utilisateur demande explicitement un vieux classique ou un film ancien.
     -> L'outil \`discover_and_recommend_media\` croise automatiquement avec l'historique Tracearr pour (a) **exclure d'office les titres que l'utilisateur a déjà vus**, (b) te fournir ses derniers films/séries vus (\`userTasteProfile.recentlyWatchedByCurrentUser\`), et (c) **placer EN PREMIER ce que les autres membres regardent récemment sur le serveur Plex** (\`popularAmongOtherMembers\`), suivi des films récents bien notés de la bibliothèque « Films ».
     -> Commence toujours ta recommandation par **ce que les autres membres ont regardé récemment sur le serveur Plex** en précisant qu'ils ont été sélectionnés et vus par d'autres membres et qu'ils ont une très bonne note (sans jamais citer le pseudo privé des autres spectateurs, ex: dis *"vu récemment par d'autres membres sur le serveur"* et non *"vu par omercier"*). Si la demande était générale, termine par une phrase ouverte (*"Si tu préfères un genre précis comme une comédie ou un thriller, dis-le-moi !"*).
10. EFFICACITÉ & CONCISION : Regroupe tous tes appels d'outils en UN SEUL tour et réponds immédiatement dès le retour des outils. Sois chaleureux, naturel et concis (2 à 5 phrases fluides maximum), car les fiches visuelles détaillées s'affichent juste en dessous de ton message.`;

export const STATIC_ENGLISH_SYSTEM_PROMPT = `You are Askarr, the World Cinema & Series Specialist (in English) and the personal advisor for our family and friends Plex media library.
You speak to non-technical users with warmth, clarity, cinema culture, and enthusiasm.

ABSOLUTE RULES OF TRUTH, RELEVANCE, AND CINEMA EXPERTISE:
1. ZERO TECHNICAL JARGON: Never say words like "Radarr", "Sonarr", "Prowlarr", "Overseerr", "indexer", "tracker", "torrent", "usenet", "passkey", or "TMDB". Talk only about "Plex", "the automated waiting list", "digital / VOD release", or "Blu-Ray / DVD release".
2. ZERO SYSTEMATIC MOVIE LISTS — PROPORTIONATE ANSWERS:
   - You are NOT required to answer with a list of movies! Always adapt your answer to the user's actual intent:
   - Account, Plex server access, how things work, or greetings (e.g. "which servers do I have access to?", "how does this work?", "thank you"): answer directly in prose using '[Connected Plex Profile: ...]' WITHOUT calling random discovery tools and WITHOUT listing movies.
   - Follow-up conversational questions (e.g. "why these films?", "which one is shortest?", "what do you recommend for tonight?"): answer directly in a few natural sentences based on the titles already displayed in the previous turn ('[Displayed Cards: ...]'), WITHOUT re-reciting the bullet list.
   - Singular requests ("recommend a great movie", "what's the latest film added?", "do you have Inception?"): answer about ONE SINGLE movie (pass 'limit: 1' to the tool or present only the specific requested title), never a list of 5!
   - Plural requests ("recommend some movies", "what's new this week?", "films by Nolan", "movies in the waiting list"): present 3 to 5 relevant titles smoothly. Avoid long repetitive bullet points since rich visual cards appear right below your message.
3. CINEMA SPECIALIST EXPERTISE (DIRECTORS, ACTORS, KEYWORDS, PLOTS, OSCARS, CANNES, BAFTAs):
   - You possess encyclopedic cinema knowledge: Cannes Film Festival (Palme d'Or, Grand Prix, Jury Prize), Oscars, BAFTAs, Golden Globes, Venice, Berlinale, and complete filmographies of international and national directors and actors.
   - If the user searches by plot ("a movie where..."), keywords, combination (director + actor + year), or awards ("2023 Cannes Palme d'Or", "recent Oscar winners"):
     -> Identify 1 to 5 specific corresponding titles with your expertise (only 1 if singular), then ALWAYS call 'verify_specific_titles' with their exact titles and years.
   - If the user asks for works by a director or actor (e.g. "search a film by Denis Villeneuve", "a movie with Cillian Murphy"):
     -> Correct any spelling errors first.
     -> Call 'search_person_filmography' with the corrected name AND/OR 'verify_specific_titles' with their major feature films. Never propose obscure "making-of" documentaries instead of real movies!
   - ZERO OFF-TOPIC MIXING: Never call 'discover_and_recommend_media(scope="on_plex_now")' randomly when the user asks about their servers or searches for a specific director, actor, or title.
4. ZERO AVAILABILITY INVENTIONS:
   - Never guess whether a film or series is on Plex or in the waiting list: call a tool ('verify_specific_titles', 'search_person_filmography', 'search_and_check_media', 'get_series_seasons_detail', 'discover_and_recommend_media') and rely strictly on the returned evidence.
5. MULTI-PLEX SERVERS & USER ACCESS:
   - What the user wants to know above all is whether they can watch it and on WHICH Plex servers THEY have personal access to ('userAccessibleServers').
   - When a title is available ('accessibleToCurrentUser !== false'), cite ONLY their accessible servers ('userAccessibleServers') (e.g. "Yes, it is available on your Plex server Plex-Main"). Never cite a Plex server the user does not have permission to access!
   - If 'accessibleToCurrentUser === false', kindly inform them ("This title is on Plex server ..., but your Plex account only has access to ...").
6. REQUEST ORIGIN, WAITING LIST & DIGITAL/DVD RELEASES:
   - Knowing who requested a title is key: each card shows 'requestedBy' and 'sourceOrigin'.
   - If a title is in the waiting list ('monitored_waiting_release' / 'monitored_searching' / 'canRequestNow=false'):
     -> Always specify who requested it or if it was added automatically via a list, along with the estimated digital/VOD release date.
   - If not on Plex and not in the queue ('canRequestNow=true'), indicate whether it is already released or when it will be released, and mention it can be requested via the button on its card.
7. TWO-STEP REQUESTS, INCOMPLETE TV SEASONS & MISSING EPISODES:
   - If a TV show is partially available on Plex (e.g. Season 1 with 1/8 episodes), clearly state missing episodes and invite the user to complete the season via the card button.
   - If the user specifically asks for missing or failed episodes (e.g. "add episode 1 of Ghosts", "download missing S02E05") and the show is already tracked in Sonarr/Plex:
     -> Call 'prepare_media_request' with 'episodes: [{ seasonNumber: ..., episodeNumber: ... }]'. Askarr will trigger a direct Sonarr search (bypassing Overseerr full-season approval).
     -> For full seasons or new series, provide 'seasons: [...]'.
   - Never claim it is requested before they click the prepared confirmation button.
8. RECENT THEATRICAL RELEASES & HOMONYMS:
   - When an unspecific title is requested without an old year, prioritize recent 2025/2026/2027 theatrical releases while noting the classic version if applicable.
9. RECENT PLEX ADDITIONS, WATCH HISTORY & RECOMMENDATIONS (TRACEARR):
   - For recent additions, call 'get_recently_added_on_plex'.
   - For user history, call 'get_watch_history_and_live_streams' with 'scope: "my_history"'.
   - For recommendations, call 'discover_and_recommend_media' (excluding already watched titles and highlighting popular community choices).
10. EFFICIENCY & CONCISENESS: Batch tool calls in ONE single turn. Be warm, natural, and concise (2 to 5 fluid sentences maximum), as rich visual cards appear right underneath your message.`;

export const READ_ONLY_TOOLS_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_and_check_media',
      description:
        "Rechercher un film ou une série par son titre exact (en français ou titre original anglais) et vérifier sa disponibilité immédiate sur les serveurs Plex (NucVillers, NucBuntu...), sa présence dans la liste d'attente, ses notes IMDb/TMDB et ses dates de sortie Cinéma/VOD/DVD.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Titre du film ou de la série recherché'
          },
          mediaType: {
            type: 'string',
            enum: ['movie', 'tv', 'auto'],
            description: "Type de média ('movie', 'tv' ou 'auto')"
          },
          year: {
            type: 'integer',
            description: 'Année de sortie optionnelle si précisée'
          }
        },
        required: ['query', 'mediaType'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_person_filmography',
      description:
        "Rechercher la filmographie d'un réalisateur ou d'un acteur/actrice (ex: Cédric Klapisch, Christopher Nolan, Denis Villeneuve, Justine Triet, Cillian Murphy...) et vérifier quels films ou séries de cette personne sont disponibles sur Plex ou dans la liste d'attente. Corrige l'orthographe du nom avant d'appeler cet outil (ex: 'klapish' -> 'Cédric Klapisch').",
      parameters: {
        type: 'object',
        properties: {
          personName: {
            type: 'string',
            description: 'Nom complet (orthographe corrigée) du réalisateur ou de l’acteur/actrice'
          },
          roleFilter: {
            type: 'string',
            enum: ['director', 'actor', 'any'],
            description: "'director' si on cherche les films réalisés par cette personne, 'actor' si elle y joue, 'any' sinon"
          },
          year: {
            type: 'integer',
            description: 'Année de sortie optionnelle si l’utilisateur cherche un film précis de cette personne'
          },
          mediaType: {
            type: 'string',
            enum: ['movie', 'tv', 'auto'],
            description: "Type de média ('movie', 'tv' ou 'auto')"
          }
        },
        required: ['personName', 'roleFilter'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify_specific_titles',
      description:
        "Outil du Spécialiste Cinéma : lorsque l'utilisateur cherche un film à partir de mots-clés/intrigue, d'indices (réalisateur + acteur + année), d'un palmarès (Festival de Cannes / Palme d'Or / Grand Prix, César, Oscars), demande les meilleurs films d'un cinéaste, OU pose une question cinéma générale par critères (ex: 'films avec note IMDb > 9', 'thrillers entre 2010 et 2020 avec note > 8'), passe 1 à 5 titres précis identifiés par ton expertise pour vérifier s'ils sont déjà sur Plex et générer leur fiche visuelle (avec bouton 'Ouvrir dans Plex' ou 'Demander l'ajout sur Plex').",
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Liste de 1 à 5 œuvres précises à vérifier sur Plex et dans la liste d’attente',
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Titre exact du film ou de la série (en français ou VO)'
                },
                year: {
                  type: 'integer',
                  description: 'Année de sortie'
                },
                mediaType: {
                  type: 'string',
                  enum: ['movie', 'tv', 'auto']
                }
              },
              required: ['title'],
              additionalProperties: false
            }
          }
        },
        required: ['items'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_series_seasons_detail',
      description:
        'Obtenir le détail exact saison par saison et épisode par épisode pour une série TV identifiée par son tmdbId.',
      parameters: {
        type: 'object',
        properties: {
          tmdbId: {
            type: 'integer',
            description: 'Identifiant TMDB de la série'
          }
        },
        required: ['tmdbId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'diagnose_media_acquisition',
      description:
        "Vérifier pourquoi un film ou une série déjà dans la liste d'attente n'est pas encore disponible (téléchargement en cours, attente de sortie VOD/DVD, ou vérification de disponibilité des sources).",
      parameters: {
        type: 'object',
        properties: {
          tmdbId: { type: 'integer' },
          mediaType: { type: 'string', enum: ['movie', 'tv'] },
          checkIndexers: {
            type: 'boolean',
            description: 'True uniquement si le média est déjà sorti mais pas encore trouvé'
          }
        },
        required: ['tmdbId', 'mediaType', 'checkIndexers'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'discover_and_recommend_media',
      description:
        "Conseiller et recommander des films ou séries personnalisés : croise automatiquement avec l'historique de visionnage du spectateur connecté (pour exclure ce qu'il a déjà vu et tenir compte de ses goûts récents) ainsi qu'avec les films/séries populaires bien notés que les autres membres ont regardés sur les serveurs Plex.",
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['on_plex_now', 'similar_to_title', 'discover_by_genre_or_trending'],
            description:
              "'on_plex_now' pour conseiller des films/séries déjà sur Plex, 'similar_to_title' pour des œuvres similaires à un tmdbId, 'discover_by_genre_or_trending' pour découvrir par genre ou tendance"
          },
          mediaType: {
            type: 'string',
            enum: ['movie', 'tv', 'auto']
          },
          genre: {
            type: 'string',
            description: "Genre souhaité (ex: 'Science-Fiction', 'Thriller', 'Drame', 'Comédie', 'Horreur')"
          },
          similarToTmdbId: {
            type: 'integer',
            description: 'tmdbId du film/série de référence si scope=similar_to_title'
          },
          minRating: {
            type: 'number',
            description: 'Note minimale sur 10 (par défaut 7.0, ou ex: 8.0 / 9.0 si demandé)'
          },
          minYear: {
            type: 'integer',
            description: "Année minimale de sortie si l'utilisateur cible une période (ex: 2010 pour 'entre 2010 et 2020' ou 2020 pour 'depuis 2020')"
          },
          maxYear: {
            type: 'integer',
            description: "Année maximale de sortie si l'utilisateur cible une période (ex: 2020 pour 'entre 2010 et 2020')"
          },
          plexLibraryFilter: {
            type: 'string',
            description: "Nom d'une bibliothèque Plex spécifique si demandé (ex: 'Cinephile', 'Films', 'Horror', 'Enfants')"
          },
          limit: {
            type: 'integer',
            description: "Nombre d'œuvres à recommander : 1 si l'utilisateur demande UN film/série au singulier, 3 à 5 s'il demande des recommandations au pluriel"
          }
        },
        required: ['scope', 'mediaType'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_my_requests',
      description:
        "Lister les films et séries actuellement dans la liste d'attente automatique (ajoutés par un utilisateur Overseerr ou via une liste automatique Radarr) ainsi que les demandes récentes, avec le nom du demandeur (requestedBy), l'origine (sourceOrigin: 'overseerr_user' ou 'auto_list'), la date de demande/d'ajout (requestedOrAddedAt) et la date de sortie VOD/DVD estimée.",
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['all_waiting_and_recent', 'mine_only'],
            description:
              "'all_waiting_and_recent' (par défaut) pour voir tous les derniers films/séries en liste d'attente et demandes récentes, 'mine_only' si l'utilisateur demande uniquement ses propres demandes"
          },
          limit: { type: 'integer', default: 6 }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recently_added_on_plex',
      description:
        "Obtenir les derniers films ou séries ajoutés sur les serveurs Plex (aujourd'hui, cette semaine, la semaine dernière, ce mois-ci...) via Tracearr et Plex, avec leurs dates exactes d'ajout et générer leurs fiches visuelles avec le lien direct 'Ouvrir dans Plex'.",
      parameters: {
        type: 'object',
        properties: {
          mediaType: {
            type: 'string',
            enum: ['movie', 'tv', 'auto'],
            description: "'movie' pour les derniers films ajoutés, 'tv' pour les séries, 'auto' pour les deux"
          },
          daysBack: {
            type: 'integer',
            description: 'Nombre de jours en arrière à inspecter (ex: 7 pour cette semaine, 15 pour la semaine dernière, 30 pour le mois dernier, par défaut 21)'
          },
          limit: {
            type: 'integer',
            description: 'Nombre de fiches visuelles à afficher (par défaut 5, max 8)'
          }
        },
        required: ['mediaType'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_watch_history_and_live_streams',
      description:
        "Consulter l'historique de visionnage Plex (via Tracearr) et les flux en direct : savoir quels films ou séries l'utilisateur connecté a regardés récemment ('qu'est-ce que j'ai vu ?', 'quel est le dernier film que j'ai vu ?', 'où j'en étais ?'), connaître les tendances/films les plus vus sur les serveurs, ou (pour l'admin) voir qui regarde quoi en direct.",
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['my_history', 'global_recent_and_trends', 'live_streams'],
            description:
              "'my_history' pour l'historique personnel du spectateur connecté, 'global_recent_and_trends' pour les lectures récentes et tendances sur les serveurs, 'live_streams' pour les lectures en cours"
          },
          mediaType: {
            type: 'string',
            enum: ['movie', 'tv', 'auto'],
            description:
              "'movie' si l'utilisateur demande spécifiquement le(s) dernier(s) film(s) vu(s), 'tv' pour les séries, 'auto' pour tout"
          },
          enrichTopCards: {
            type: 'boolean',
            description: 'True pour afficher les fiches visuelles des œuvres avec bouton Ouvrir dans Plex'
          }
        },
        required: ['scope'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'prepare_media_request',
      description:
        "Préparer une proposition de demande d'ajout sur Plex soumise à confirmation explicite (2 étapes) par l'utilisateur. Si l'utilisateur demande un ou plusieurs épisodes spécifiques manquants (ex: S01E01, épisode raté) d'une série déjà suivie dans Sonarr/Plex, renseigne 'episodes' pour lancer une recherche directe Sonarr sans passer par Overseerr.",
      parameters: {
        type: 'object',
        properties: {
          tmdbId: {
            type: 'integer',
            description: 'Identifiant TMDB du film ou de la série à demander'
          },
          mediaType: {
            type: 'string',
            enum: ['movie', 'tv']
          },
          seasons: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Numéros des saisons demandées (obligatoire si mediaType=tv et qu’aucun épisode précis n’est ciblé)'
          },
          episodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                seasonNumber: { type: 'integer', description: 'Numéro de la saison' },
                episodeNumber: { type: 'integer', description: 'Numéro de l’épisode' }
              },
              required: ['seasonNumber', 'episodeNumber']
            },
            description: 'Épisodes spécifiques manquants à rechercher directement dans Sonarr (ex: [{seasonNumber: 1, episodeNumber: 1}])'
          }
        },
        required: ['tmdbId', 'mediaType'],
        additionalProperties: false
      }
    }
  }
];

export const MAX_TOOL_ROUNDS = 2;
export const MAX_PROWLARR_CALLS_PER_TURN = 1;

interface DeepSeekChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface InternalLlmProvider {
  id: LlmProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  isFree: boolean;
  keyPortalUrl: string;
  descriptionFr: string;
}

function stripUnsupportedJsonSchemaKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(stripUnsupportedJsonSchemaKeys);
  }
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === 'additionalProperties' || k === 'default') {
        continue;
      }
      out[k] = stripUnsupportedJsonSchemaKeys(v);
    }
    return out;
  }
  return obj;
}

export function sanitizeToolsForProvider(
  tools: typeof READ_ONLY_TOOLS_DEFINITIONS,
  providerId: LlmProviderId
): unknown[] {
  if (providerId === 'deepseek') {
    return tools;
  }
  return stripUnsupportedJsonSchemaKeys(tools) as unknown[];
}

export const PROVIDER_MODEL_FALLBACKS: Record<LlmProviderId, string[]> = {
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash'],
  groq: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
  mistral: ['mistral-small-latest', 'open-mistral-nemo'],
  openrouter: [
    'openrouter/free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3.5-lightning:free'
  ],
  deepseek: ['deepseek-chat']
};

const RETIRED_MODEL_SLUGS: Record<LlmProviderId, Set<string>> = {
  gemini: new Set([
    'gemini-2.5-flash',
    'models/gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'models/gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ]),
  groq: new Set([
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama3-70b-8192',
    'mixtral-8x7b-32768'
  ]),
  mistral: new Set([]),
  openrouter: new Set([
    'deepseek/deepseek-chat-v3-0324:free',
    'deepseek/deepseek-r1:free',
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct:free'
  ]),
  deepseek: new Set([])
};

export function normalizeLlmModelSlug(providerId: LlmProviderId, rawModel?: string): string {
  const defaultModel = PROVIDER_MODEL_FALLBACKS[providerId][0];
  const trimmed = (rawModel || '').trim();
  if (!trimmed || RETIRED_MODEL_SLUGS[providerId].has(trimmed)) {
    return defaultModel;
  }
  return trimmed;
}

export class DeepSeekOrchestratorService {
  private roundRobinCounter = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly db: AskarrDatabase,
    private readonly aggregator: MediaAggregatorService,
    private readonly overseerr: OverseerrConnector,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly tracearr?: TracearrConnector
  ) {}

  public getAllProviders(): InternalLlmProvider[] {
    return [
      {
        id: 'gemini',
        label: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: (this.config.geminiApiKey || '').trim(),
        model: normalizeLlmModelSlug('gemini', this.config.geminiModel),
        isFree: true,
        keyPortalUrl: 'https://aistudio.google.com/apikey',
        descriptionFr: 'Google AI Studio — 100% Gratuit (sans CB), Gemini 3.5 Flash Lite (~600 ms), 1M contexte'
      },
      {
        id: 'groq',
        label: 'Groq Cloud',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: (this.config.groqApiKey || '').trim(),
        model: normalizeLlmModelSlug('groq', this.config.groqModel),
        isFree: true,
        keyPortalUrl: 'https://console.groq.com/keys',
        descriptionFr: 'Groq LPU — 100% Gratuit (sans CB), vitesse fulgurante (~500 ms), GPT-OSS 120B / Qwen 3.8'
      },
      {
        id: 'mistral',
        label: 'Mistral AI',
        baseUrl: 'https://api.mistral.ai/v1',
        apiKey: (this.config.mistralApiKey || '').trim(),
        model: normalizeLlmModelSlug('mistral', this.config.mistralModel),
        isFree: true,
        keyPortalUrl: 'https://console.mistral.ai/api-keys',
        descriptionFr: 'Mistral La Plateforme (Plan Experiment) — 100% Gratuit, plume française & cinéma européen'
      },
      {
        id: 'openrouter',
        label: 'OpenRouter Free',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: (this.config.openrouterApiKey || '').trim(),
        model: normalizeLlmModelSlug('openrouter', this.config.openrouterModel),
        isFree: true,
        keyPortalUrl: 'https://openrouter.ai/settings/keys',
        descriptionFr: 'OpenRouter — 100% Gratuit (openrouter/free sélectionne automatiquement le meilleur modèle :free actif)'
      },
      {
        id: 'deepseek',
        label: 'DeepSeek',
        baseUrl: (this.config.deepseekBaseUrl || 'https://api.deepseek.com').replace(/\/+$/, ''),
        apiKey: (this.config.deepseekApiKey || '').trim(),
        model: normalizeLlmModelSlug('deepseek', this.config.deepseekModel),
        isFree: false,
        keyPortalUrl: 'https://platform.deepseek.com/api_keys',
        descriptionFr: 'DeepSeek V3 Officiel — ~$0.0011/req avec Cache KV (-90%), secours haute fiabilité'
      }
    ];
  }

  public getProviderStatuses(): LlmProviderStatusDTO[] {
    return this.getAllProviders().map((p) => ({
      id: p.id,
      label: p.label,
      baseUrl: p.baseUrl,
      model: p.model,
      isFree: p.isFree,
      configured: Boolean(p.apiKey),
      keyPortalUrl: p.keyPortalUrl,
      descriptionFr: p.descriptionFr
    }));
  }

  public hasAnyConfiguredProvider(): boolean {
    return this.getAllProviders().some((p) => Boolean(p.apiKey));
  }

  public selectProviderCandidates(isOverPaidQuota = false): InternalLlmProvider[] {
    const configured = this.getAllProviders().filter(
      (p) => Boolean(p.apiKey) && (!isOverPaidQuota || p.isFree)
    );
    if (configured.length === 0) return [];

    const mode: LlmRoutingMode = this.config.llmRoutingMode || 'manual';
    if (mode === 'manual') {
      const targetId: LlmProviderId = this.config.llmManualProvider || 'deepseek';
      const primary = configured.find((p) => p.id === targetId);
      const others = configured.filter((p) => p.id !== targetId);
      return primary ? [primary, ...others] : configured;
    }

    if (mode === 'load_balance') {
      const idx = this.roundRobinCounter++ % configured.length;
      return [...configured.slice(idx), ...configured.slice(0, idx)];
    }

    // Mode 'priority_cascade' (par défaut) : Gratuit d'abord (Gemini -> Groq -> Mistral -> OpenRouter) puis DeepSeek en secours
    const priorityOrder: LlmProviderId[] = ['gemini', 'groq', 'mistral', 'openrouter', 'deepseek'];
    return [...configured].sort(
      (a, b) => priorityOrder.indexOf(a.id) - priorityOrder.indexOf(b.id)
    );
  }

  public async handleUserMessage(params: {
    userEmail: string;
    overseerrUserId: number | null;
    plexAccess?: {
      plexUserId: number | null;
      plexUsername: string | null;
      askarrServerNames: string[];
      allServerNames: string[];
    };
    conversationId?: string;
    message: string;
    lang?: 'fr' | 'en';
  }): Promise<{
    conversationId: string;
    messageId?: string;
    reply: string;
    mediaCards: MediaEvidence[];
    preparedAction?: PreparedActionDTO;
    provenance: ProvenanceEntry[];
    llmUsage?: LlmTurnUsageDTO;
    aiMode: 'active' | 'direct_search_fallback';
  }> {
    const convId = this.db.ensureConversation(
      params.userEmail,
      params.conversationId,
      params.message.slice(0, 60)
    );

    const history = this.db.getConversationMessages(convId, params.userEmail, 6);
    this.db.addMessage({
      conversationId: convId,
      role: 'user',
      content: params.message
    });

    const budget = this.db.getLlmBudgetStats(this.config.aiDailyTokenCap, this.config.aiMonthlyBudgetUsd);
    const candidateProviders = this.selectProviderCandidates(budget.isOverQuota);
    if (candidateProviders.length === 0) {
      return this.runDirectSearchFallback({
        convId,
        userEmail: params.userEmail,
        overseerrUserId: params.overseerrUserId,
        message: params.message,
        reason: budget.isOverQuota ? 'QUOTA_EXCEEDED' : 'NO_API_KEY',
        lang: params.lang
      });
    }

    const collectedCards = new Map<string, MediaEvidence>();
    const collectedProvenance: ProvenanceEntry[] = [];
    let latestPreparedAction: PreparedActionDTO | undefined;
    let prowlarrCallsThisTurn = 0;
    let totalPromptTokens = 0;
    let totalCacheHitTokens = 0;
    let totalCacheMissTokens = 0;
    let totalCompletionTokens = 0;
    let toolRounds = 0;
    let activeProviderIndex = 0;
    let usedProvider: InternalLlmProvider = candidateProviders[0];
    let failoverFromLabel: string | undefined;
    const tStart = Date.now();
    const isEn = params.lang === 'en';

    const allowedSrvList =
      params.plexAccess && params.plexAccess.askarrServerNames.length > 0
        ? params.plexAccess.askarrServerNames.join(', ')
        : isEn ? 'None' : 'Aucun';
    const userAccessContext = params.plexAccess
      ? isEn
        ? `\n[Connected Plex Profile: ${params.plexAccess.plexUsername || params.userEmail} | Plex servers this user has access to: ${allowedSrvList} — IMPORTANT: in your reply, indicate availability ONLY with respect to this user's accessible Plex servers (${allowedSrvList}) and never use the word "room" for a server.]`
        : `\n[Profil Plex connecté : ${params.plexAccess.plexUsername || params.userEmail} | Serveurs Plex auxquels cet utilisateur a accès : ${allowedSrvList} — IMPORTANT : dans ta réponse, indique la disponibilité UNIQUEMENT par rapport aux serveurs Plex de cet utilisateur (${allowedSrvList}) et n'utilise jamais le mot "salle".]`
      : '';

    // Le message system reste 100% statique et immuable par langue pour garantir un Cache Hit maximal sur le préfixe KV
    const systemPrompt = isEn ? STATIC_ENGLISH_SYSTEM_PROMPT : STATIC_FRENCH_SYSTEM_PROMPT;
    const messages: DeepSeekChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-4).map((m) => {
        let content = m.content;
        if (m.role === 'assistant' && m.mediaCards && m.mediaCards.length > 0) {
          const cardsSummary = m.mediaCards
            .map((c) => {
              const availSrvs = c.catalogPresence.availableServers || [];
              const userSrvs =
                params.plexAccess?.askarrServerNames && availSrvs.length > 0
                  ? availSrvs.filter((s) =>
                      params.plexAccess!.askarrServerNames.some((u) => u.toLowerCase() === s.toLowerCase())
                    )
                  : c.catalogPresence.userAccessibleServers || availSrvs;
              const srvNote =
                userSrvs.length > 0 ? `, serveurs_accessibles_user=${userSrvs.join(',')}` : '';
              return `${c.identity.titleFr}${c.identity.year ? ` (${c.identity.year})` : ''} [tmdbId=${c.identity.tmdbId}, état=${c.catalogPresence.state}${srvNote}]`;
            })
            .join(' | ');
          content += `\n[Fiches affichées : ${cardsSummary}]`;
        }
        return {
          role: m.role as 'user' | 'assistant',
          content
        };
      }),
      { role: 'user', content: params.message + userAccessContext }
    ];

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const allowTools = round < MAX_TOOL_ROUNDS;
        const callResult = await this.callLlmWithFailover(
          messages,
          allowTools,
          candidateProviders,
          activeProviderIndex
        );
        const response = callResult.response;
        activeProviderIndex = callResult.providerIndex;
        usedProvider = callResult.provider;
        if (callResult.failoverFrom && !failoverFromLabel) {
          failoverFromLabel = callResult.failoverFrom;
        }

        const usage = response.usage || {};
        const pTokens = Number(usage.prompt_tokens || 0);
        const cTokens = Number(usage.completion_tokens || 0);
        const hitTokens = Number(usage.prompt_cache_hit_tokens || 0);
        const missTokens = Number(usage.prompt_cache_miss_tokens ?? Math.max(0, pTokens - hitTokens));

        totalPromptTokens += pTokens;
        totalCompletionTokens += cTokens;
        totalCacheHitTokens += hitTokens;
        totalCacheMissTokens += missTokens;

        const choice = response.choices?.[0]?.message;
        if (!choice) {
          throw new Error('DEEPSEEK_EMPTY_CHOICE');
        }

        if (!choice.tool_calls || choice.tool_calls.length === 0) {
          let allCards = collectedCards.size > 0 ? Array.from(collectedCards.values()) : [];
          const replyText = (choice.content || '').trim() || this.buildDeterministicSummary(allCards);

          // Si le LLM a répondu sans appeler d'outil (car l'œuvre était déjà dans l'historique de la conversation),
          // récupérer les fiches de l'historique mentionnées dans sa réponse et les adapter aux serveurs Plex de l'utilisateur courant
          if (allCards.length === 0 && history.length > 0) {
            const historyCardsMap = new Map<string, MediaEvidence>();
            for (const m of history.slice(-6)) {
              for (const c of m.mediaCards || []) {
                historyCardsMap.set(
                  `${c.identity.mediaType}:${c.identity.tmdbId}`,
                  this.adaptCardToUserAccess(c, params.plexAccess?.askarrServerNames)
                );
              }
            }
            const historyCards = Array.from(historyCardsMap.values());
            if (historyCards.length > 0) {
              const matchedFromHistory = this.filterRelevantCardsForReply(
                replyText,
                historyCards,
                1,
                true
              );
              allCards = matchedFromHistory;
            }
          }

          const mediaCards =
            allCards.length > 0
              ? this.filterRelevantCardsForReply(replyText, allCards, toolRounds).map((c) =>
                  this.adaptCardToUserAccess(c, params.plexAccess?.askarrServerNames)
                )
              : [];
          const costUsd = usedProvider.isFree
            ? 0
            : this.computeCostUsd(totalCacheMissTokens, totalCacheHitTokens, totalCompletionTokens);
          const latencyMs = Date.now() - tStart;
          const ledgerModel =
            usedProvider.id === 'deepseek'
              ? usedProvider.model
              : `${usedProvider.id}/${usedProvider.model}`;

          this.db.recordLlmUsage({
            userEmail: params.userEmail,
            conversationId: convId,
            model: ledgerModel,
            toolRounds,
            promptTokens: totalPromptTokens,
            promptCacheHitTokens: totalCacheHitTokens,
            promptCacheMissTokens: totalCacheMissTokens,
            completionTokens: totalCompletionTokens,
            estimatedCostUsd: costUsd,
            latencyMs,
            fallbackUsed: false
          });

          const savedMsg = this.db.addMessage({
            conversationId: convId,
            role: 'assistant',
            content: replyText,
            mediaCards,
            provenance: collectedProvenance
          });

          return {
            conversationId: convId,
            messageId: savedMsg.id,
            reply: replyText,
            mediaCards,
            preparedAction: latestPreparedAction,
            provenance: collectedProvenance,
            llmUsage: {
              providerId: usedProvider.id,
              providerLabel: usedProvider.label,
              model: usedProvider.model,
              isFreeProvider: usedProvider.isFree,
              failoverFrom: failoverFromLabel,
              promptTokens: totalPromptTokens,
              cacheHitTokens: totalCacheHitTokens,
              cacheMissTokens: totalCacheMissTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
              estimatedCostUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
              toolRounds,
              latencyMs
            },
            aiMode: 'active'
          };
        }

        // Exécution des tool_calls retournés par le LLM actif
        toolRounds++;
        messages.push({
          role: 'assistant',
          content: choice.content || null,
          tool_calls: choice.tool_calls
        });

        for (const tc of choice.tool_calls) {
          const fnName = tc.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            args = {};
          }

          const toolResult = await this.executeReadOnlyTool({
            fnName,
            args,
            userMessage: params.message,
            userEmail: params.userEmail,
            overseerrUserId: params.overseerrUserId,
            plexAccess: params.plexAccess,
            prowlarrCallsThisTurn,
            onProwlarrCalled: () => {
              prowlarrCallsThisTurn++;
            },
            onCardsCollected: (cards) => {
              for (const c of cards) {
                collectedCards.set(`${c.identity.mediaType}:${c.identity.tmdbId}:${c.identity.titleFr}`, c);
                for (const p of c.provenance) {
                  collectedProvenance.push(p);
                }
              }
            },
            onPreparedActionCreated: (action) => {
              latestPreparedAction = action;
            }
          });

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult)
          });
        }
      }

      // Si le plafond MAX_TOOL_ROUNDS est atteint, synthèse déterministe immédiate
      const allCards = Array.from(collectedCards.values());
      const replyText = this.buildDeterministicSummary(allCards);
      const mediaCards = this.filterRelevantCardsForReply(replyText, allCards, toolRounds);
      const costUsd = usedProvider.isFree
        ? 0
        : this.computeCostUsd(totalCacheMissTokens, totalCacheHitTokens, totalCompletionTokens);
      const latencyMs = Date.now() - tStart;
      const ledgerModel =
        usedProvider.id === 'deepseek'
          ? usedProvider.model
          : `${usedProvider.id}/${usedProvider.model}`;

      this.db.recordLlmUsage({
        userEmail: params.userEmail,
        conversationId: convId,
        model: ledgerModel,
        toolRounds,
        promptTokens: totalPromptTokens,
        promptCacheHitTokens: totalCacheHitTokens,
        promptCacheMissTokens: totalCacheMissTokens,
        completionTokens: totalCompletionTokens,
        estimatedCostUsd: costUsd,
        latencyMs,
        fallbackUsed: false
      });

      const savedMsg = this.db.addMessage({
        conversationId: convId,
        role: 'assistant',
        content: replyText,
        mediaCards,
        provenance: collectedProvenance
      });

      return {
        conversationId: convId,
        messageId: savedMsg.id,
        reply: replyText,
        mediaCards,
        preparedAction: latestPreparedAction,
        provenance: collectedProvenance,
        llmUsage: {
          providerId: usedProvider.id,
          providerLabel: usedProvider.label,
          model: usedProvider.model,
          isFreeProvider: usedProvider.isFree,
          failoverFrom: failoverFromLabel,
          promptTokens: totalPromptTokens,
          cacheHitTokens: totalCacheHitTokens,
          cacheMissTokens: totalCacheMissTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
          estimatedCostUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
          toolRounds,
          latencyMs
        },
        aiMode: 'active'
      };
    } catch {
      return this.runDirectSearchFallback({
        convId,
        userEmail: params.userEmail,
        overseerrUserId: params.overseerrUserId,
        message: params.message,
        reason: 'DEEPSEEK_ERROR'
      });
    }
  }

  public async prepareMediaRequestAction(params: {
    userEmail: string;
    overseerrUserId: number | null;
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    seasons?: number[];
    episodes?: Array<{ seasonNumber: number; episodeNumber: number }>;
  }): Promise<{
    evidence: MediaEvidence;
    preparedAction: PreparedActionDTO;
  }> {
    const evidence = await this.aggregator.buildMediaEvidence({
      tmdbId: params.tmdbId,
      mediaType: params.mediaType,
      currentUserEmail: params.userEmail,
      currentUserOverseerrId: params.overseerrUserId,
      includeSeasons: params.mediaType === 'tv',
      checkIndexers: false
    });

    if (!evidence.actionability.canRequestNow) {
      throw new Error(
        `REQUEST_NOT_ELIGIBLE:${evidence.actionability.blockReason || 'ALREADY_HANDLED'}:${evidence.actionability.userFriendlyExplanationFr}`
      );
    }

    const hasSpecificEpisodes =
      params.mediaType === 'tv' &&
      Array.isArray(params.episodes) &&
      params.episodes.length > 0;

    let selectedSeasons: number[] | undefined;
    if (params.mediaType === 'tv' && !hasSpecificEpisodes) {
      const requested = Array.isArray(params.seasons) && params.seasons.length > 0
        ? params.seasons
        : evidence.actionability.requestableSeasons;
      selectedSeasons = requested.filter((s) => evidence.actionability.requestableSeasons.includes(s));
      if (selectedSeasons.length === 0) {
        throw new Error(
          `REQUEST_NOT_ELIGIBLE:NO_REQUESTABLE_SEASONS:Toutes les saisons sélectionnées sont déjà sur Plex ou dans la liste d'attente.`
        );
      }
    }

    const isKnownInSonarr = Boolean(
      evidence.acquisitionPipeline.externalServiceId || evidence.identity.tvdbId
    );

    const actionType: PreparedActionDTO['actionType'] =
      hasSpecificEpisodes && isKnownInSonarr
        ? 'SONARR_EPISODE_SEARCH'
        : params.mediaType === 'tv'
          ? 'OVERSEERR_REQUEST_TV'
          : 'OVERSEERR_REQUEST_MOVIE';

    const yearTxt = evidence.identity.year ? ` (${evidence.identity.year})` : '';
    const isCompletingPartialSeason =
      params.mediaType === 'tv' &&
      Boolean(
        selectedSeasons?.some((sNum) =>
          evidence.episodeCoverage?.seasons.some(
            (s) => s.seasonNumber === sNum && s.state === 'partially_available'
          )
        )
      );

    const episodesTxt = hasSpecificEpisodes
      ? ` — ${params.episodes!.map((e) => `S${e.seasonNumber}E${e.episodeNumber}`).join(', ')}`
      : '';

    const seasonsTxt =
      params.mediaType === 'tv' && selectedSeasons
        ? ` — Saison(s) ${selectedSeasons.join(', ')}`
        : '';

    const summaryFr =
      actionType === 'SONARR_EPISODE_SEARCH'
        ? `Recherche directe dans Sonarr pour "${evidence.identity.titleFr}"${yearTxt}${episodesTxt}`
        : isCompletingPartialSeason
          ? `Compléter les épisodes manquants de "${evidence.identity.titleFr}"${yearTxt}${seasonsTxt} sur Plex`
          : `Demander l'ajout de "${evidence.identity.titleFr}"${yearTxt}${seasonsTxt} sur Plex`;

    const created = this.db.createPreparedAction({
      userEmail: params.userEmail,
      overseerrUserId: params.overseerrUserId,
      actionType,
      payload: {
        mediaType: params.mediaType,
        tmdbId: params.tmdbId,
        title: evidence.identity.titleFr,
        year: evidence.identity.year,
        seasons: selectedSeasons,
        episodes: hasSpecificEpisodes ? params.episodes : undefined,
        summaryFr
      },
      ttlMinutes: 10
    });

    const preparedAction: PreparedActionDTO = {
      actionId: created.token,
      actionType,
      mediaType: params.mediaType,
      tmdbId: params.tmdbId,
      title: evidence.identity.titleFr,
      year: evidence.identity.year,
      seasons: selectedSeasons,
      episodes: hasSpecificEpisodes ? params.episodes : undefined,
      summaryFr,
      expiresAt: created.expiresAt,
      status: 'PENDING'
    };

    return { evidence, preparedAction };
  }

  private async executeReadOnlyTool(params: {
    fnName: string;
    args: Record<string, unknown>;
    userMessage?: string;
    userEmail: string;
    overseerrUserId: number | null;
    plexAccess?: {
      plexUserId: number | null;
      plexUsername: string | null;
      askarrServerNames: string[];
      allServerNames: string[];
    };
    prowlarrCallsThisTurn: number;
    onProwlarrCalled: () => void;
    onCardsCollected: (cards: MediaEvidence[]) => void;
    onPreparedActionCreated: (action: PreparedActionDTO) => void;
  }): Promise<unknown> {
    const { fnName, args } = params;

    const userAllowedServers =
      params.plexAccess?.askarrServerNames && params.plexAccess.askarrServerNames.length > 0
        ? params.plexAccess.askarrServerNames
        : undefined;

    if (fnName === 'search_and_check_media') {
      const query = String(args.query || '').trim();
      const mediaType =
        args.mediaType === 'movie' || args.mediaType === 'tv' ? args.mediaType : 'auto';
      const year = typeof args.year === 'number' ? args.year : undefined;

      const res = await this.aggregator.searchAndCheckMedia({
        query,
        mediaType,
        year,
        currentUserEmail: params.userEmail,
        currentUserOverseerrId: params.overseerrUserId,
        userAllowedServers,
        userQueryContext: params.userMessage
      });
      params.onCardsCollected(res.candidates);
      return this.compactCardsForLlm(res.candidates);
    }

    if (fnName === 'search_person_filmography') {
      const personName = String(args.personName || '').trim();
      const roleFilter =
        args.roleFilter === 'director' || args.roleFilter === 'actor' ? args.roleFilter : 'any';
      const year = typeof args.year === 'number' ? args.year : undefined;
      const mediaType =
        args.mediaType === 'movie' || args.mediaType === 'tv' ? args.mediaType : 'auto';

      const res = await this.aggregator.searchByPerson({
        personQuery: personName,
        roleFilter,
        year,
        mediaType,
        currentUserEmail: params.userEmail,
        currentUserOverseerrId: params.overseerrUserId,
        userAllowedServers,
        maxCandidates: 5
      });
      params.onCardsCollected(res.candidates);
      return {
        personName: res.personName,
        results: this.compactCardsForLlm(res.candidates)
      };
    }

    if (fnName === 'verify_specific_titles') {
      const rawItems = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
      const items = rawItems.map((it) => ({
        title: String(it.title || '').trim(),
        year: typeof it.year === 'number' ? it.year : undefined,
        mediaType: (it.mediaType === 'movie' || it.mediaType === 'tv' ? it.mediaType : 'auto') as
          | 'movie'
          | 'tv'
          | 'auto'
      }));

      const cards = await this.aggregator.verifySpecificTitles({
        items,
        currentUserEmail: params.userEmail,
        currentUserOverseerrId: params.overseerrUserId,
        userAllowedServers,
        userQueryContext: params.userMessage
      });
      params.onCardsCollected(cards);
      return this.compactCardsForLlm(cards);
    }

    if (fnName === 'get_series_seasons_detail') {
      const tmdbId = Number(args.tmdbId);
      const ev = await this.aggregator.buildMediaEvidence({
        tmdbId,
        mediaType: 'tv',
        currentUserEmail: params.userEmail,
        currentUserOverseerrId: params.overseerrUserId,
        userAllowedServers,
        includeSeasons: true,
        checkIndexers: false
      });
      params.onCardsCollected([ev]);
      return this.compactCardsForLlm([ev]);
    }

    if (fnName === 'diagnose_media_acquisition') {
      const tmdbId = Number(args.tmdbId);
      const mediaType = args.mediaType === 'tv' ? 'tv' : 'movie';
      const wantIndexers = Boolean(args.checkIndexers) && params.prowlarrCallsThisTurn < MAX_PROWLARR_CALLS_PER_TURN;
      if (wantIndexers) {
        params.onProwlarrCalled();
      }
      const ev = await this.aggregator.buildMediaEvidence({
        tmdbId,
        mediaType,
        currentUserEmail: params.userEmail,
        currentUserOverseerrId: params.overseerrUserId,
        userAllowedServers,
        includeSeasons: mediaType === 'tv',
        checkIndexers: wantIndexers
      });
      params.onCardsCollected([ev]);
      return this.compactCardsForLlm([ev]);
    }

    if (fnName === 'discover_and_recommend_media') {
      const scope =
        args.scope === 'on_plex_now' || args.scope === 'similar_to_title'
          ? args.scope
          : 'discover_by_genre_or_trending';
      const mediaType =
        args.mediaType === 'movie' || args.mediaType === 'tv' ? args.mediaType : 'auto';
      const genre = typeof args.genre === 'string' ? args.genre : undefined;
      const similarToTmdbId = typeof args.similarToTmdbId === 'number' ? args.similarToTmdbId : undefined;
      const minRating = typeof args.minRating === 'number' ? args.minRating : 7.0;
      const minYear = typeof args.minYear === 'number' ? args.minYear : undefined;
      const maxYear = typeof args.maxYear === 'number' ? args.maxYear : undefined;
      const plexLibraryFilter = typeof args.plexLibraryFilter === 'string' ? args.plexLibraryFilter : undefined;
      const targetLimit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(8, args.limit) : 4;
      const isStrictRatingOrYearQuery = Boolean(minRating >= 7.8 || minYear || maxYear);

      const normTitleFn = (s: string) =>
        s
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

      const [rawCards, tasteAndTrends] = await Promise.all([
        this.aggregator.discoverAndRecommend({
          scope,
          mediaType,
          genre,
          similarToTmdbId,
          minRating,
          minYear,
          maxYear,
          plexLibraryFilter,
          limit: Math.min(8, targetLimit + 3),
          currentUserEmail: params.userEmail,
          currentUserOverseerrId: params.overseerrUserId,
          userAllowedServers
        }),
        this.tracearr &&
        this.tracearr.isConfigured() &&
        typeof this.tracearr.getUserTasteAndCommunityTrends === 'function'
          ? this.tracearr.getUserTasteAndCommunityTrends({
              plexUsername: params.plexAccess?.plexUsername || undefined,
              allowedServers: userAllowedServers,
              mediaType: mediaType === 'auto' ? undefined : mediaType
            })
          : Promise.resolve(null)
      ]);

      const isAlreadyWatchedByUser = (c: MediaEvidence): boolean => {
        if (!tasteAndTrends) return false;
        if (c.identity.tmdbId > 0 && tasteAndTrends.watchedTmdbIds.has(c.identity.tmdbId)) {
          return true;
        }
        const nFr = normTitleFn(c.identity.titleFr);
        const nOrig = normTitleFn(c.identity.originalTitle);
        return (
          (Boolean(nFr) && tasteAndTrends.watchedNormTitles.has(nFr)) ||
          (Boolean(nOrig) && tasteAndTrends.watchedNormTitles.has(nOrig))
        );
      };

      const unwatchedCards = rawCards.filter((c) => !isAlreadyWatchedByUser(c));
      const baseCards = unwatchedCards.length > 0 ? unwatchedCards : rawCards;

      // Enrichissement des films/séries populaires vus par les AUTRES membres sur les serveurs Plex accessibles
      const communityWatchMetaByKey = new Map<
        string,
        { distinctViewersCount: number; totalPlays: number }
      >();
      const communityCards: MediaEvidence[] = [];

      if (
        tasteAndTrends &&
        tasteAndTrends.communityPopular.length > 0 &&
        scope !== 'similar_to_title'
      ) {
        for (const pop of tasteAndTrends.communityPopular) {
          if (pop.tmdbId && pop.tmdbId > 0) {
            communityWatchMetaByKey.set(`tmdb:${pop.tmdbId}`, {
              distinctViewersCount: pop.distinctViewersCount,
              totalPlays: pop.totalPlays
            });
          }
          communityWatchMetaByKey.set(`title:${normTitleFn(pop.title)}`, {
            distinctViewersCount: pop.distinctViewersCount,
            totalPlays: pop.totalPlays
          });
        }

        const genreMatchTerms = (gRaw?: string): string[] => {
          if (!gRaw) return [];
          const g = normTitleFn(gRaw);
          if (g.includes('comed')) return ['comedie', 'comedy'];
          if (g.includes('dram')) return ['drame', 'drama'];
          if (g.includes('horr') || g.includes('epouvant')) return ['horreur', 'epouvante', 'horror'];
          if (g.includes('science') || g.includes('sci')) return ['science fiction', 'sci fi'];
          if (g.includes('aventur') || g.includes('adventur')) return ['aventure', 'adventure'];
          if (g.includes('fantas')) return ['fantastique', 'fantasy'];
          if (g.includes('polic') || g.includes('crim')) return ['policier', 'crime', 'thriller'];
          return [g];
        };
        const targetGenreTerms = genreMatchTerms(genre);

        const topCommunityCandidates = tasteAndTrends.communityPopular.slice(0, 8);
        const enrichedCommunity = await Promise.all(
          topCommunityCandidates.map(async (pop) => {
            try {
              const knownPlexHint =
                pop.serverNames.length > 0 ? { serverNames: pop.serverNames } : undefined;
              if (pop.tmdbId && pop.tmdbId > 0) {
                return await this.aggregator.buildMediaEvidence({
                  tmdbId: pop.tmdbId,
                  mediaType: pop.mediaType,
                  currentUserEmail: params.userEmail,
                  currentUserOverseerrId: params.overseerrUserId,
                  userAllowedServers,
                  knownPlexHint
                });
              }
              const verified = await this.aggregator.verifySpecificTitles({
                items: [
                  {
                    title: pop.title,
                    year: pop.year ?? undefined,
                    mediaType: pop.mediaType,
                    knownPlexHint
                  }
                ],
                currentUserEmail: params.userEmail,
                currentUserOverseerrId: params.overseerrUserId,
                userAllowedServers
              });
              return verified[0] ?? null;
            } catch {
              return null;
            }
          })
        );

        for (const cc of enrichedCommunity) {
          if (!cc) continue;
          if (isAlreadyWatchedByUser(cc)) continue;
          if (cc.catalogPresence.accessibleToCurrentUser === false) continue;
          if (minYear && (!cc.identity.year || cc.identity.year < minYear)) continue;
          if (maxYear && (!cc.identity.year || cc.identity.year > maxYear)) continue;
          const cardRating =
            cc.identity.ratings.imdbOrAudienceRating ??
            cc.identity.ratings.tmdbVoteAverage ??
            7.0;
          const requiredRating = isStrictRatingOrYearQuery ? minRating : Math.min(minRating, 6.2);
          if (cardRating < requiredRating) continue;
          if (
            targetGenreTerms.length > 0 &&
            cc.identity.genres.length > 0 &&
            !cc.identity.genres.some((g) => {
              const ng = normTitleFn(g);
              return targetGenreTerms.some((term) => ng.includes(term));
            })
          ) {
            continue;
          }
          communityCards.push(cc);
        }
      }

      // Tri des cartes catalogue de secours : par note décroissante si critère IMDb/décennie strict, sinon films récents (2020+) d'abord
      const sortedBaseCards = [...baseCards].sort((a, b) => {
        if (isStrictRatingOrYearQuery) {
          const ra = a.identity.ratings.imdbOrAudienceRating ?? a.identity.ratings.tmdbVoteAverage ?? 0;
          const rb = b.identity.ratings.imdbOrAudienceRating ?? b.identity.ratings.tmdbVoteAverage ?? 0;
          return rb - ra;
        }
        const aRecent = (a.identity.year ?? 0) >= 2020 ? 1 : 0;
        const bRecent = (b.identity.year ?? 0) >= 2020 ? 1 : 0;
        if (bRecent !== aRecent) return bRecent - aRecent;
        return (b.identity.year ?? 0) - (a.identity.year ?? 0);
      });

      // Fusion sans doublons : on place EN PREMIER ce que les autres membres regardent sur Plex, puis le reste de la sélection
      const mergedMap = new Map<string, MediaEvidence>();
      const addCardUnique = (c: MediaEvidence) => {
        const key =
          c.identity.tmdbId > 0
            ? `${c.identity.mediaType}:${c.identity.tmdbId}`
            : `${c.identity.mediaType}:${normTitleFn(c.identity.titleFr)}`;
        if (!mergedMap.has(key)) {
          mergedMap.set(key, c);
        }
      };

      for (const cc of communityCards.slice(0, targetLimit)) {
        addCardUnique(cc);
      }
      for (const bc of sortedBaseCards) {
        if (mergedMap.size >= targetLimit) break;
        addCardUnique(bc);
      }

      const finalCards = Array.from(mergedMap.values()).slice(0, targetLimit);
      params.onCardsCollected(finalCards);

      const getCommunityMeta = (c: MediaEvidence) =>
        (c.identity.tmdbId > 0 ? communityWatchMetaByKey.get(`tmdb:${c.identity.tmdbId}`) : undefined) ||
        communityWatchMetaByKey.get(`title:${normTitleFn(c.identity.titleFr)}`) ||
        communityWatchMetaByKey.get(`title:${normTitleFn(c.identity.originalTitle)}`);

      const compacted = this.compactCardsForLlm(finalCards).map((item, idx) => {
        const card = finalCards[idx];
        const popMeta = card ? getCommunityMeta(card) : undefined;
        if (!popMeta) return item;
        return {
          ...item,
          popularAmongOtherMembers: {
            watchedByOtherMembersCount: popMeta.distinctViewersCount,
            totalPlaysOnServer: popMeta.totalPlays,
            badgeFr:
              popMeta.distinctViewersCount > 1
                ? `Populaire sur le serveur Plex : déjà vu par ${popMeta.distinctViewersCount} autres membres`
                : 'Populaire sur le serveur Plex : déjà sélectionné et vu par un autre membre'
          }
        };
      });

      if (!tasteAndTrends || (tasteAndTrends.myRecentWatched.length === 0 && communityCards.length === 0)) {
        return compacted;
      }

      return {
        userTasteProfile: {
          plexUsername: params.plexAccess?.plexUsername ?? null,
          recentlyWatchedByCurrentUser: tasteAndTrends.myRecentWatched.slice(0, 6).map((w) => ({
            title: w.title,
            year: w.year,
            mediaType: w.mediaType
          })),
          alreadyWatchedExcludedNote:
            'Les films et séries déjà vus par cet utilisateur ont été automatiquement écartés des recommandations ci-dessous.'
        },
        popularAmongOtherMembersSummary: communityCards.map((c) => {
          const meta = getCommunityMeta(c);
          return {
            titleFr: c.identity.titleFr,
            year: c.identity.year,
            ratingSur10:
              c.identity.ratings.imdbOrAudienceRating ?? c.identity.ratings.tmdbVoteAverage,
            watchedByOtherMembersCount: meta?.distinctViewersCount ?? 1,
            noteFr:
              "Ce titre a déjà été sélectionné et visionné par d'autres membres sur le serveur Plex et affiche une très bonne note."
          };
        }),
        recommendations: compacted
      };
    }

    if (fnName === 'get_my_requests') {
      const onlyCurrentUser = args.scope === 'mine_only';
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(8, args.limit) : 5;
      const enriched =
        typeof this.aggregator.getWaitingListAndRequests === 'function'
          ? await this.aggregator.getWaitingListAndRequests({
              currentUserEmail: params.userEmail,
              currentUserOverseerrId: params.overseerrUserId,
              userAllowedServers,
              onlyCurrentUser,
              limit
            })
          : await Promise.all(
              (await this.overseerr.getRequests(params.overseerrUserId, 6)).slice(0, 4).map((r) =>
                this.aggregator.buildMediaEvidence({
                  tmdbId: r.tmdbId,
                  mediaType: r.mediaType,
                  currentUserEmail: params.userEmail,
                  currentUserOverseerrId: params.overseerrUserId,
                  userAllowedServers
                })
              )
            );
      params.onCardsCollected(enriched);
      return this.compactCardsForLlm(enriched);
    }

    if (fnName === 'get_recently_added_on_plex') {
      const mediaType =
        args.mediaType === 'movie' || args.mediaType === 'tv' ? args.mediaType : undefined;
      const daysBack = typeof args.daysBack === 'number' && args.daysBack > 0 ? args.daysBack : 21;
      const cardLimit = Math.min(8, Math.max(1, typeof args.limit === 'number' ? args.limit : 5));
      const allowedServers = userAllowedServers;

      const recentItems = this.tracearr
        ? await this.tracearr.getRecentlyAdded({
            allowedServers,
            daysBack,
            mediaType,
            limit: 15
          })
        : [];

      const topForCards = recentItems.slice(0, cardLimit);

      // Enrichissement en parallèle en réutilisant directement les serveurs Plex fournis par Tracearr (zéro requête Plex/Radarr redondante)
      const enrichedResults = await Promise.all(
        topForCards.map(async (item) => {
          try {
            const knownPlexHint =
              item.serverNames && item.serverNames.length > 0
                ? { serverNames: item.serverNames }
                : undefined;

            if (item.tmdbId && item.tmdbId > 0) {
              return await this.aggregator.buildMediaEvidence({
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                currentUserEmail: params.userEmail,
                currentUserOverseerrId: params.overseerrUserId,
                userAllowedServers,
                knownPlexHint
              });
            }
            const verified = await this.aggregator.verifySpecificTitles({
              items: [
                {
                  title: item.title,
                  year: item.year ?? undefined,
                  mediaType: item.mediaType,
                  knownPlexHint
                }
              ],
              currentUserEmail: params.userEmail,
              currentUserOverseerrId: params.overseerrUserId,
              userAllowedServers
            });
            return verified[0] ?? null;
          } catch {
            return null;
          }
        })
      );

      const cards = enrichedResults.filter((c): c is MediaEvidence => c !== null);
      if (cards.length > 0) {
        params.onCardsCollected(cards);
      }

      const cardByTitle = new Map<string, MediaEvidence>();
      for (const c of cards) {
        cardByTitle.set(c.identity.titleFr.toLowerCase(), c);
        cardByTitle.set(c.identity.originalTitle.toLowerCase(), c);
      }

      return {
        daysBackInspected: daysBack,
        totalRecentFound: recentItems.length,
        recentAdditions: recentItems.slice(0, 12).map((r) => {
          const matchedCard =
            cards.find((c) => c.identity.tmdbId === r.tmdbId) ||
            cardByTitle.get(r.title.toLowerCase());
          return {
            titleFr: matchedCard?.identity.titleFr || r.title,
            year: matchedCard?.identity.year ?? r.year,
            mediaType: r.mediaType,
            tmdbId: matchedCard?.identity.tmdbId ?? r.tmdbId,
            director: matchedCard?.identity.directorOrCreator || undefined,
            topCast: matchedCard?.identity.topCast?.slice(0, 2) || undefined,
            ratingSur10:
              matchedCard?.identity.ratings.imdbOrAudienceRating ??
              matchedCard?.identity.ratings.tmdbVoteAverage ??
              undefined,
            addedAtFrench: formatFrenchDate(r.addedAt),
            daysAgo: r.daysAgo,
            servers: r.serverNames
          };
        })
      };
    }

    if (fnName === 'get_watch_history_and_live_streams') {
      const scope =
        args.scope === 'my_history' || args.scope === 'live_streams'
          ? args.scope
          : 'global_recent_and_trends';
      const mediaTypeFilter =
        args.mediaType === 'movie' || args.mediaType === 'tv' ? args.mediaType : undefined;
      const enrichTopCards = Boolean(args.enrichTopCards ?? true);

      if (!this.tracearr || !this.tracearr.isConfigured()) {
        return { error: 'TRACEARR_NOT_CONFIGURED' };
      }

      const connectedPlexUsername = params.plexAccess?.plexUsername || undefined;
      const [myOrGlobalHistory, liveStreams] = await Promise.all([
        this.tracearr.getWatchHistory({
          plexUsername: scope === 'my_history' ? connectedPlexUsername : undefined,
          allowedServers: userAllowedServers,
          mediaType: mediaTypeFilter,
          limit: 40
        }),
        this.tracearr.getActiveStreams()
      ]);

      if (enrichTopCards && myOrGlobalHistory.length > 0) {
        const seenKeys = new Set<string>();
        const toEnrich = myOrGlobalHistory.filter((h) => {
          const cleanTitle = (h.showTitle || h.title.replace(/\s*\(S\d+E\d+\)$/i, '')).trim();
          const key = h.tmdbId && h.tmdbId > 0 ? `tmdb:${h.tmdbId}` : `title:${cleanTitle.toLowerCase()}`;
          if (seenKeys.has(key) || seenKeys.size >= 4) {
            return false;
          }
          seenKeys.add(key);
          return true;
        });

        const enriched = await Promise.all(
          toEnrich.map(async (h) => {
            try {
              const knownPlexHint = h.serverName ? { serverNames: [h.serverName] } : undefined;
              if (h.tmdbId && h.tmdbId > 0) {
                return await this.aggregator.buildMediaEvidence({
                  tmdbId: h.tmdbId,
                  mediaType: h.mediaType,
                  currentUserEmail: params.userEmail,
                  currentUserOverseerrId: params.overseerrUserId,
                  userAllowedServers,
                  knownPlexHint
                });
              }
              const cleanTitle = (h.showTitle || h.title.replace(/\s*\(S\d+E\d+\)$/i, '')).trim();
              if (!cleanTitle) return null;
              const verified = await this.aggregator.verifySpecificTitles({
                items: [
                  {
                    title: cleanTitle,
                    year: h.year ?? undefined,
                    mediaType: h.mediaType,
                    knownPlexHint
                  }
                ],
                currentUserEmail: params.userEmail,
                currentUserOverseerrId: params.overseerrUserId,
                userAllowedServers
              });
              return verified[0] ?? null;
            } catch {
              return null;
            }
          })
        );
        const cards = enriched.filter((c): c is MediaEvidence => c !== null);
        if (cards.length > 0) {
          params.onCardsCollected(cards);
        }
      }

      const isAdmin = this.config.adminEmails.includes(params.userEmail.toLowerCase());
      return {
        scope,
        connectedUser: {
          email: params.userEmail,
          plexUsername: connectedPlexUsername ?? null
        },
        activeStreams: isAdmin
          ? liveStreams
          : {
              total: liveStreams.total,
              transcodes: liveStreams.transcodes,
              directPlays: liveStreams.directPlays
            },
        recentWatchHistory: myOrGlobalHistory.slice(0, 12).map((h) => ({
          title: h.title,
          year: h.year,
          mediaType: h.mediaType,
          tmdbId: h.tmdbId,
          serverName: h.serverName,
          startedAtFrench: formatFrenchDate(h.startedAt),
          percentComplete: h.percentComplete,
          watched: h.watched,
          device: h.device,
          username: isAdmin || scope === 'my_history' ? h.username : undefined
        }))
      };
    }

    if (fnName === 'prepare_media_request') {
      const tmdbId = Number(args.tmdbId);
      const mediaType = args.mediaType === 'tv' ? 'tv' : 'movie';
      const seasons = Array.isArray(args.seasons)
        ? args.seasons.map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0)
        : undefined;
      const episodes = Array.isArray(args.episodes)
        ? (args.episodes as Array<{ seasonNumber?: number; episodeNumber?: number }>)
            .map((e) => ({
              seasonNumber: Number(e.seasonNumber),
              episodeNumber: Number(e.episodeNumber)
            }))
            .filter(
              (e) =>
                Number.isInteger(e.seasonNumber) &&
                e.seasonNumber > 0 &&
                Number.isInteger(e.episodeNumber) &&
                e.episodeNumber > 0
            )
        : undefined;

      try {
        const { evidence, preparedAction } = await this.prepareMediaRequestAction({
          userEmail: params.userEmail,
          overseerrUserId: params.overseerrUserId,
          tmdbId,
          mediaType,
          seasons,
          episodes
        });
        params.onCardsCollected([evidence]);
        params.onPreparedActionCreated(preparedAction);
        return {
          status: 'PREPARED_FOR_CONFIRMATION',
          actionId: preparedAction.actionId,
          summaryFr: preparedAction.summaryFr,
          expiresAt: preparedAction.expiresAt,
          instructionForAssistant:
            "Le bouton de confirmation est maintenant affiché sous ton message. Invite l'utilisateur à cliquer sur 'Confirmer la demande' pour valider l'ajout."
        };
      } catch (err) {
        return {
          status: 'NOT_ELIGIBLE',
          reason: err instanceof Error ? err.message : 'UNKNOWN_ERROR'
        };
      }
    }

    return { error: `UNKNOWN_TOOL_${fnName}` };
  }

  private compactCardsForLlm(cards: MediaEvidence[]): Array<Record<string, unknown>> {
    return cards.map((c) => {
      const libs = Array.from(
        new Set(c.catalogPresence.matchedItems.map((m) => m.libraryTitle).filter(Boolean))
      );
      return {
        tmdbId: c.identity.tmdbId,
        mediaType: c.identity.mediaType,
        titleFr: c.identity.titleFr,
        originalTitle:
          c.identity.originalTitle !== c.identity.titleFr ? c.identity.originalTitle : undefined,
        year: c.identity.year,
        genres: c.identity.genres.slice(0, 3),
        directorOrCreator: c.identity.directorOrCreator || undefined,
        topCast: c.identity.topCast.slice(0, 4),
        overviewFr: c.identity.overviewFr
          ? c.identity.overviewFr.slice(0, 200)
          : undefined,
        ratingSur10:
          c.identity.ratings.imdbOrAudienceRating ?? c.identity.ratings.tmdbVoteAverage ?? undefined,
        plexState: c.catalogPresence.state,
        userAccessibleServers: c.catalogPresence.userAccessibleServers,
        userAllowedServers: c.catalogPresence.userAllowedServers,
        availableServers: c.catalogPresence.availableServers,
        plexLibraries: libs.length > 0 ? libs : undefined,
        accessibleToCurrentUser: c.catalogPresence.accessibleToCurrentUser,
        statusLabel: c.actionability.userFriendlyStatusLabel,
        pipelineState:
          c.acquisitionPipeline.state !== 'not_in_arr' ? c.acquisitionPipeline.state : undefined,
        requestedOrAddedAt: c.requestState.requestedAt
          ? c.requestState.requestedAt.slice(0, 10)
          : c.acquisitionPipeline.addedAt || undefined,
        requestedBy: c.requestState.requestedByDisplayName || undefined,
        sourceOrigin: c.requestState.sourceOrigin || undefined,
        estimatedAvailabilityDate:
          c.acquisitionPipeline.estimatedAvailabilityDate ||
          c.identity.releaseDates.estimatedVodOrDvdDate ||
          undefined,
        releaseDates:
          c.catalogPresence.state !== 'available_now' ? c.identity.releaseDates : undefined,
        seasonsSummary: c.episodeCoverage?.seasons.map((s) => ({
          s: s.seasonNumber,
          state: s.state,
          ep: `${s.plexEpisodeCount}/${s.totalEpisodeCount}`
        })),
        canRequestNow: c.actionability.canRequestNow,
        requestableSeasons:
          c.actionability.requestableSeasons.length > 0
            ? c.actionability.requestableSeasons
            : undefined
      };
    });
  }

  public async getAccountBalance(): Promise<DeepSeekBalanceDTO> {
    const checkedAt = new Date().toISOString();
    if (!this.config.deepseekApiKey) {
      return {
        available: false,
        currency: 'USD',
        totalBalance: '0.00',
        toppedUpBalance: '0.00',
        grantedBalance: '0.00',
        checkedAt,
        error: 'Clé API DeepSeek non configurée'
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await this.fetchImpl(`${this.config.deepseekBaseUrl}/user/balance`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.deepseekApiKey}`,
          Accept: 'application/json'
        },
        signal: controller.signal
      });

      if (!res.ok) {
        return {
          available: false,
          currency: 'USD',
          totalBalance: '0.00',
          toppedUpBalance: '0.00',
          grantedBalance: '0.00',
          checkedAt,
          error: `HTTP ${res.status}`
        };
      }

      const data = (await res.json()) as {
        is_available?: boolean;
        balance_infos?: Array<{
          currency?: string;
          total_balance?: string;
          granted_balance?: string;
          topped_up_balance?: string;
        }>;
      };

      const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
      const preferred = infos.find((b) => b.currency === 'USD') || infos[0];

      return {
        available: Boolean(data.is_available),
        currency: preferred?.currency || 'USD',
        totalBalance: preferred?.total_balance || '0.00',
        toppedUpBalance: preferred?.topped_up_balance || '0.00',
        grantedBalance: preferred?.granted_balance || '0.00',
        checkedAt
      };
    } catch (err) {
      return {
        available: false,
        currency: 'USD',
        totalBalance: '0.00',
        toppedUpBalance: '0.00',
        grantedBalance: '0.00',
        checkedAt,
        error: err instanceof Error ? err.message : 'Erreur réseau DeepSeek'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private computeCostUsd(cacheMissTokens: number, cacheHitTokens: number, completionTokens: number): number {
    return (
      (cacheMissTokens / 1_000_000) * this.config.deepseekPriceInputCacheMissPer1M +
      (cacheHitTokens / 1_000_000) * this.config.deepseekPriceInputCacheHitPer1M +
      (completionTokens / 1_000_000) * this.config.deepseekPriceOutputPer1M
    );
  }

  private async callLlmWithFailover(
    messages: DeepSeekChatMessage[],
    includeTools: boolean,
    candidates: InternalLlmProvider[],
    startIndex: number
  ): Promise<{
    response: {
      choices?: Array<{ message?: DeepSeekChatMessage }>;
      usage?: Record<string, number>;
    };
    provider: InternalLlmProvider;
    providerIndex: number;
    failoverFrom?: string;
  }> {
    let lastError: unknown;
    const initialProvider = candidates[startIndex] || candidates[0];

    for (let i = startIndex; i < candidates.length; i++) {
      const provider = candidates[i];
      try {
        const response = await this.callProviderEndpoint(provider, messages, includeTools);
        if (!response.choices || response.choices.length === 0 || !response.choices[0]?.message) {
          throw new Error(`${provider.id.toUpperCase()}_EMPTY_CHOICE`);
        }
        return {
          response,
          provider,
          providerIndex: i,
          failoverFrom: i > startIndex && initialProvider ? `${initialProvider.label} (${initialProvider.model})` : undefined
        };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('ALL_LLM_PROVIDERS_FAILED');
  }

  private persistActiveModelForProvider(providerId: LlmProviderId, model: string): void {
    try {
      if (providerId === 'gemini') {
        this.config.geminiModel = model;
        this.db.setAppSetting('cfg_gemini_model', model);
      } else if (providerId === 'groq') {
        this.config.groqModel = model;
        this.db.setAppSetting('cfg_groq_model', model);
      } else if (providerId === 'mistral') {
        this.config.mistralModel = model;
        this.db.setAppSetting('cfg_mistral_model', model);
      } else if (providerId === 'openrouter') {
        this.config.openrouterModel = model;
        this.db.setAppSetting('cfg_openrouter_model', model);
      } else if (providerId === 'deepseek') {
        this.config.deepseekModel = model;
        this.db.setAppSetting('cfg_deepseek_model', model);
      }
    } catch {
      // Ignore DB write error during read-only test mocks
    }
  }

  private getCandidateModelsForProvider(provider: InternalLlmProvider): string[] {
    const fallbacks = PROVIDER_MODEL_FALLBACKS[provider.id] || [];
    const primary = normalizeLlmModelSlug(provider.id, provider.model);
    return [primary, ...fallbacks.filter((m) => m !== primary)];
  }

  private sanitizeMessagesForProvider(
    messages: DeepSeekChatMessage[],
    providerId: LlmProviderId
  ): DeepSeekChatMessage[] {
    if (providerId === 'gemini') {
      return messages;
    }
    return messages.map((m) => {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        return {
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: tc.function
          }))
        };
      }
      return m;
    });
  }

  private async callProviderEndpoint(
    provider: InternalLlmProvider,
    messages: DeepSeekChatMessage[],
    includeTools: boolean
  ): Promise<{
    choices?: Array<{ message?: DeepSeekChatMessage }>;
    usage?: Record<string, number>;
  }> {
    const candidateModels = this.getCandidateModelsForProvider(provider);
    const sanitizedMessages = this.sanitizeMessagesForProvider(messages, provider.id);
    let lastError: unknown;

    for (let idx = 0; idx < candidateModels.length; idx++) {
      const candidateModel = candidateModels[idx];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const body: Record<string, unknown> = {
          model: candidateModel,
          messages: sanitizedMessages,
          temperature: 0.2,
          max_tokens: provider.id === 'deepseek' ? 500 : 900
        };

        if (provider.id === 'deepseek') {
          body.tools = READ_ONLY_TOOLS_DEFINITIONS;
          body.tool_choice = includeTools ? 'auto' : 'none';
        } else if (includeTools) {
          body.tools = sanitizeToolsForProvider(READ_ONLY_TOOLS_DEFINITIONS, provider.id);
          body.tool_choice = 'auto';
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json'
        };
        if (provider.id === 'openrouter') {
          headers['HTTP-Referer'] = 'https://askarr.local';
          headers['X-Title'] = 'Askarr Cinema Concierge';
        }

        const res = await this.fetchImpl(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!res.ok) {
          const status = res.status;
          // Si le modèle configuré retourne 404/400 (modèle déprécié/retiré) et qu'il existe un modèle de repli sur ce provider, on tente le suivant
          if ((status === 404 || status === 400) && idx + 1 < candidateModels.length) {
            lastError = new Error(`LLM_${provider.id.toUpperCase()}_HTTP_${status}`);
            continue;
          }
          throw new Error(`LLM_${provider.id.toUpperCase()}_HTTP_${status}`);
        }

        if (candidateModel !== provider.model) {
          provider.model = candidateModel;
          this.persistActiveModelForProvider(provider.id, candidateModel);
        }

        return (await res.json()) as {
          choices?: Array<{ message?: DeepSeekChatMessage }>;
          usage?: Record<string, number>;
        };
      } catch (err) {
        lastError = err;
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError || new Error(`LLM_${provider.id.toUpperCase()}_FAILED`);
  }

  public async testProviderConnection(providerId: LlmProviderId): Promise<{
    ok: boolean;
    latencyMs: number;
    detail: string;
    model: string;
  }> {
    const provider = this.getAllProviders().find((p) => p.id === providerId);
    if (!provider || !provider.apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        detail: `Clé API ${provider?.label || providerId} non configurée`,
        model: provider?.model || ''
      };
    }

    const candidateModels = this.getCandidateModelsForProvider(provider);
    let lastFailDetail = '';
    let lastLatencyMs = 0;

    for (let idx = 0; idx < candidateModels.length; idx++) {
      const candidateModel = candidateModels[idx];
      const t0 = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json'
        };
        if (provider.id === 'openrouter') {
          headers['HTTP-Referer'] = 'https://askarr.local';
          headers['X-Title'] = 'Askarr Cinema Concierge';
        }

        const res = await this.fetchImpl(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: candidateModel,
            messages: [{ role: 'user', content: 'Réponds uniquement par le mot OK.' }],
            max_tokens: 80,
            temperature: 0
          }),
          signal: controller.signal
        });

        const latencyMs = Date.now() - t0;
        lastLatencyMs = latencyMs;
        if (!res.ok) {
          let errSnippet = '';
          try {
            const errRaw = await res.text();
            const parsed = JSON.parse(errRaw) as {
              error?: { message?: string } | Array<{ error?: { message?: string } }>;
              message?: string;
            };
            const msg = Array.isArray(parsed.error)
              ? parsed.error[0]?.error?.message
              : parsed.error?.message || parsed.message;
            errSnippet = msg ? ` — ${String(msg).slice(0, 110)}` : '';
          } catch {
            // ignore
          }
          lastFailDetail = `HTTP ${res.status} sur ${provider.label} (${candidateModel})${errSnippet}`;
          if ((res.status === 404 || res.status === 400 || res.status === 429) && idx + 1 < candidateModels.length) {
            continue;
          }
          return {
            ok: false,
            latencyMs,
            detail: lastFailDetail,
            model: candidateModel
          };
        }

        if (candidateModel !== provider.model) {
          provider.model = candidateModel;
          this.persistActiveModelForProvider(provider.id, candidateModel);
        } else {
          this.persistActiveModelForProvider(provider.id, candidateModel);
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const reply = (data.choices?.[0]?.message?.content || 'OK').trim().slice(0, 30);
        return {
          ok: true,
          latencyMs,
          detail: `${provider.label} opérationnel (${candidateModel} • ${provider.isFree ? 'Gratuit $0' : 'Payant'}) — Réponse: "${reply}"`,
          model: candidateModel
        };
      } catch (err) {
        lastLatencyMs = Date.now() - t0;
        lastFailDetail = err instanceof Error ? err.message : `Erreur réseau ${provider.label}`;
        if (idx + 1 < candidateModels.length) {
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      ok: false,
      latencyMs: lastLatencyMs,
      detail: lastFailDetail || `Échec connexion ${provider.label}`,
      model: provider.model
    };
  }

  private async runDirectSearchFallback(params: {
    convId: string;
    userEmail: string;
    overseerrUserId: number | null;
    message: string;
    reason: string;
    lang?: 'fr' | 'en';
  }): Promise<{
    conversationId: string;
    messageId?: string;
    reply: string;
    mediaCards: MediaEvidence[];
    provenance: ProvenanceEntry[];
    aiMode: 'direct_search_fallback';
  }> {
    const isEn = params.lang === 'en';
    const cleanedQuery = params.message
      .replace(/[«»"""]/g, ' ')
      .replace(/\(ou une autre[^)]*\)/gi, ' ')
      .replace(
        /^(est-ce que tu as|est-ce que le film|est-ce que la série|est-ce que|où en est la série|ou en est la serie|as-tu|je cherche|je voudrais voir|y a-t-il|le film|la série|la serie|do you have|can i watch|is the movie|is the series|find me|looking for)\s+/i,
        ''
      )
      .replace(/\s+(est disponible sur plex|est dispo ou quand sort-il en vod|sur plex|on plex|available on plex)\s*/gi, ' ')
      .replace(/[?!.]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const searchRes = await this.aggregator.searchAndCheckMedia({
      query: cleanedQuery || params.message,
      mediaType: 'auto',
      currentUserEmail: params.userEmail,
      currentUserOverseerrId: params.overseerrUserId
    });

    const provenance = searchRes.candidates.flatMap((c) => c.provenance);
    const reply = this.buildDeterministicSummary(searchRes.candidates, isEn);

    this.db.recordLlmUsage({
      userEmail: params.userEmail,
      conversationId: params.convId,
      model: 'direct-search-fallback',
      toolRounds: 0,
      promptTokens: 0,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 0,
      fallbackUsed: true
    });

    const savedMsg = this.db.addMessage({
      conversationId: params.convId,
      role: 'assistant',
      content: reply,
      mediaCards: searchRes.candidates,
      provenance
    });

    return {
      conversationId: params.convId,
      messageId: savedMsg.id,
      reply,
      mediaCards: searchRes.candidates,
      provenance,
      aiMode: 'direct_search_fallback'
    };
  }

  /**
   * Évite le mélange de cartes hors-sujet (ex: Star Wars ou Raiders of the Lost Ark
   * issus d'un appel d'exploration Plex intermédiaire alors que la réponse porte sur Klapisch).
  /**
   * Adapte dynamiquement les libellés d'une carte média (ex: récupérée de l'historique)
   * aux serveurs Plex réellement accessibles par l'utilisateur courant.
   */
  public adaptCardToUserAccess(card: MediaEvidence, userAllowedServers?: string[]): MediaEvidence {
    if (card.catalogPresence.state !== 'available_now') {
      return card;
    }
    const allAvailable: string[] =
      card.catalogPresence.availableServers && card.catalogPresence.availableServers.length > 0
        ? card.catalogPresence.availableServers
        : Array.from(new Set(card.catalogPresence.matchedItems.map((m) => m.serverName)));

    const allowedNorm = new Set((userAllowedServers || []).map((s) => s.toLowerCase()));
    const userServers =
      allowedNorm.size > 0
        ? allAvailable.filter((s) => allowedNorm.has(s.toLowerCase()))
        : allAvailable;

    let statusLabel: string;
    let explanationFr: string;

    if (userServers.length > 0) {
      statusLabel =
        userServers.length === 1
          ? `Disponible sur ton serveur Plex (${userServers[0]})`
          : `Disponible sur tes serveurs Plex (${userServers.join(', ')})`;
      explanationFr = `Ce titre est déjà disponible sur ${
        userServers.length === 1
          ? `ton serveur Plex (${userServers[0]})`
          : `tes serveurs Plex (${userServers.join(', ')})`
      }. Tu peux le regarder tout de suite !`;
    } else if (allAvailable.length > 0) {
      statusLabel = `Disponible sur Plex (${allAvailable.join(', ')})`;
      explanationFr = `Ce titre est présent sur le serveur Plex ${allAvailable.join(', ')}.`;
    } else {
      statusLabel = 'Disponible sur Plex';
      explanationFr = 'Ce titre est déjà disponible sur Plex. Tu peux le regarder tout de suite !';
    }

    return {
      ...card,
      catalogPresence: {
        ...card.catalogPresence,
        availableServers: allAvailable,
        userAccessibleServers: userServers,
        userAllowedServers: userAllowedServers || [],
        accessibleToCurrentUser: userServers.length > 0
      },
      actionability: {
        ...card.actionability,
        userFriendlyStatusLabel: statusLabel,
        userFriendlyExplanationFr: explanationFr
      }
    };
  }

  public filterRelevantCardsForReply(
    replyText: string,
    allCards: MediaEvidence[],
    toolRounds: number,
    requireMention = false
  ): MediaEvidence[] {
    if (!requireMention && allCards.length <= 1) return allCards;

    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const normReply = norm(replyText);

    const isCardMentioned = (c: MediaEvidence): boolean => {
      const titles = [
        c.identity.titleFr,
        c.identity.originalTitle,
        c.identity.titleFr.split(/[:\-–]/)[0] || '',
        c.identity.originalTitle.split(/[:\-–]/)[0] || ''
      ]
        .map((t) => norm(t))
        .filter((t) => t.length >= 3);

      if (titles.some((t) => normReply.includes(t))) {
        return true;
      }

      // Si Plex stocke le titre en VO (ex: "Raiders of the Lost Ark", 1981, Steven Spielberg)
      // et que le LLM le traduit en français dans sa réponse ("Les Aventuriers de l'arche perdue (1981, Spielberg)"),
      // on reconnaît la carte si son année exacte est citée dans la réponse (ainsi que le réalisateur s'il est renseigné).
      if (c.identity.year && normReply.includes(String(c.identity.year))) {
        if (c.identity.tmdbId < 0) {
          return true;
        }
        const directorTokens = (c.identity.directorOrCreator || '')
          .split(/[\s,]+/)
          .map((tok) => norm(tok))
          .filter((tok) => tok.length >= 4);
        if (directorTokens.some((tok) => normReply.includes(tok))) {
          return true;
        }
      }

      return false;
    };

    const mentionedCards = allCards.filter(isCardMentioned);

    // Dès que la réponse finale cite explicitement au moins un titre parmi les cartes collectées,
    // on n'affiche QUE les cartes réellement mentionnées dans la réponse (évite d'afficher un 3e titre
    // vérifié en coulisse mais écarté par l'IA, ex: Boogie Nights ou Goliath non retenu).
    if (mentionedCards.length > 0) {
      // Si plusieurs cartes homonymes portent exactement le même titre normalisé (ex: "Le Comte de Monte-Cristo" 2024 vs 1954 vs 1975)
      // et que la réponse cite explicitement l'année d'une (ou plusieurs) de ces versions, on ne garde que la/les version(s) dont l'année est citée.
      const byNormTitle = new Map<string, MediaEvidence[]>();
      for (const c of mentionedCards) {
        const key = norm(c.identity.titleFr);
        const list = byNormTitle.get(key) || [];
        list.push(c);
        byNormTitle.set(key, list);
      }

      const disambiguated: MediaEvidence[] = [];
      for (const group of byNormTitle.values()) {
        if (group.length > 1) {
          const matchingYearCards = group.filter(
            (c) => c.identity.year && normReply.includes(String(c.identity.year))
          );
          if (matchingYearCards.length > 0) {
            disambiguated.push(...matchingYearCards);
            continue;
          }
        }
        disambiguated.push(...group);
      }
      return disambiguated;
    }

    // Si des cartes TMDB réelles ont été trouvées ET des cartes synthétiques Plex non mentionnées sont présentes,
    // on élimine les cartes synthétiques non mentionnées.
    if (requireMention) {
      return [];
    }
    const hasSyntheticPlexCards = allCards.some((c) => c.identity.tmdbId < 0);
    const realCards = allCards.filter((c) => c.identity.tmdbId > 0);
    if (realCards.length > 0 && hasSyntheticPlexCards) {
      return realCards.slice(0, 6);
    }

    return allCards.slice(0, 6);
  }

  public buildDeterministicSummary(cards: MediaEvidence[], isEn: boolean = false): string {
    if (cards.length === 0) {
      return isEn
        ? "I couldn't find any movie or series matching that search. Could you double-check the spelling or provide the English or French title?"
        : "Je n'ai trouvé aucun film ni aucune série correspondant à cette recherche. Peux-tu vérifier l'orthographe ou me donner le titre en français ou en anglais ?";
    }
    if (cards.length === 1) {
      const c = cards[0];
      const rating = c.identity.ratings.imdbOrAudienceRating ?? c.identity.ratings.tmdbVoteAverage;
      const ratingTxt = rating ? ` (⭐ ${rating}/10)` : '';
      const vodDate = isEn
        ? (c.identity.releaseDates.estimatedVodOrDvdDate || '')
        : formatFrenchDate(c.identity.releaseDates.estimatedVodOrDvdDate);
      const dateTxt =
        c.catalogPresence.state !== 'available_now' && vodDate
          ? isEn
            ? ` Digital/DVD release ${c.identity.releaseDates.isEstimatedDate ? 'estimated around' : 'scheduled for'} ${vodDate}.`
            : ` Sortie VOD/DVD ${c.identity.releaseDates.isEstimatedDate ? 'estimée vers le' : 'prévue le'} ${vodDate}.`
          : '';
      const expl = isEn && c.actionability.userFriendlyExplanationFr
        ? (c.catalogPresence.state === 'available_now' ? 'Available now on Plex.' : c.actionability.userFriendlyStatusLabel)
        : c.actionability.userFriendlyExplanationFr;
      return isEn
        ? `Here is what I found for **${c.identity.titleFr}** (${c.identity.year || 'N/A'})${ratingTxt} : ${expl}${dateTxt}`
        : `Voici ce que j'ai trouvé pour **${c.identity.titleFr}** (${c.identity.year || 'N/A'})${ratingTxt} : ${c.actionability.userFriendlyExplanationFr}${dateTxt}`;
    }
    return isEn
      ? `Found **${cards.length} matching titles**. Here is their exact availability on Plex and in the queue:`
      : `J'ai trouvé **${cards.length} œuvres** correspondantes. Voici leur disponibilité exacte sur Plex et dans la liste d'attente :`;
  }
}
