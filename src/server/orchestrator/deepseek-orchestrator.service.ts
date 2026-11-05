import type { AppConfig } from '../config/env.js';
import type { AskarrDatabase } from '../db/database.js';
import type { MediaAggregatorService } from '../aggregator/media-aggregator.service.js';
import type { OverseerrConnector } from '../connectors/overseerr.connector.js';
import type { TracearrConnector } from '../connectors/tracearr.js';
import { logger } from '../utils/logger.js';
import {
  mergeFollowUpCriteria,
  type NormalizedDiscoveryCriteria
} from '../connectors/mdblist-criteria.schema.js';
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

PRINCIPE DIRECTEUR — CONCISION & NATUREL :
- Sois chaleureux, complice, cinéphile et TRÈS CONCIS (2 à 4 phrases fluides maximum).
- Les fiches visuelles détaillées s'affichent sous ton message : ne récite pas les résumés, les notes ou les détails techniques qui y figurent déjà.
- N'écris JAMAIS dans ta réponse de balises internes entre crochets comme "[Fiches affichées : ...]" ou "[Critères MDBList appliqués : ...]".

RÈGLES ABSOLUES :
1. ZÉRO JARGON TECHNIQUE : Ne prononce jamais les mots "Radarr", "Sonarr", "Prowlarr", "Overseerr", "indexeur", "tracker", "torrent", "usenet", "passkey" ou "TMDB". Parle uniquement de "Plex", de "la liste d'attente automatique", de "sortie VOD / numérique" ou de "sortie DVD / Blu-Ray".
2. ZÉRO INVENTION DE DISPONIBILITÉ : Ne devine jamais si une œuvre est sur Plex ou en attente. Base-toi exclusivement sur les preuves retournées par tes outils. Interdiction de citer des films comme "absents" ou "à ajouter" sans fiche vérifiée.
3. ADAPTATION DU VOLUME :
   - Demande au singulier ("un film", "une comédie", "as-tu Inception ?") -> Réponds sur UN SEUL film (limit: 1), jamais une liste.
   - Demande au pluriel ("des thrillers", "5 films") -> Présente 3 à 5 films de façon fluide, sans liste à puces répétitive.
   - Suivi conversationnel ("pourquoi ce choix ?", "lequel est le plus court ?") -> Réponds en prose directe sur les fiches déjà affichées au tour précédent sans relancer d'outil.
   - Salutations, compte ou accès -> Réponds directement sans appeler d'outil de découverte.

TABLE DE DÉCISION DE ROUTAGE DES OUTILS :
- Conseil ouvert / populaire sur le serveur ("tu me conseilles quoi ce soir ?", "un bon film récent") -> discover_and_recommend_media (scope: 'on_plex_now', limit: 4)
- Critères de catalogue précis (genre, note min, période/années, durée max, VO) -> discover_media_by_criteria (ajoute inheritPreviousCriteria: true si suivi affineur)
- Titre précis nommé par l'utilisateur ("as-tu Gladiator ?") -> search_and_check_media (omets year pour les nouveautés récentes 2025/2026/2027)
- Intrigue, indices, palmarès sans titre direct ("le film où...", "Palme d'Or 2023") -> verify_specific_titles (1 à 5 titres déduits par ton expertise)
- Filmographie d'un réalisateur ou d'un acteur ("films de Klapisch") -> search_person_filmography (corrige l'orthographe du nom)
- Derniers ajouts sur Plex ("quoi de neuf cette semaine ?") -> get_recently_added_on_plex
- Historique personnel de visionnage ("qu'est-ce que j'ai vu récemment ?") -> get_watch_history_and_live_streams (scope: 'my_history')
- État des demandes / file d'attente ("où en est mon film ?") -> get_my_requests
- Panne ou blocage de téléchargement -> diagnose_media_acquisition

DIVULGATIONS SOBRES ET CONDITIONNELLES :
- Disponibilité Plex : Confirme simplement avec chaleur que le film est disponible sur Plex. Ne cite la liste nominative des serveurs (NucBuntu...) QUE si l'utilisateur demande expressément "sur quel serveur ?", ou si son compte n'a pas accès au serveur où se trouve le film.
- File d'attente & Origine : Indique qu'il est en cours d'acquisition dans la liste d'attente. Ne précise qui l'a demandé (requestedBy) ou la liste auto QUE si l'utilisateur le demande ("qui a demandé ça ?") ou via get_my_requests.
- Sorties VOD/DVD : Si la date est passée, parle au passé ("déjà sorti en VOD le [date], en attente d'une version pour Plex"). Si elle est future, parle au futur ("sortie VOD prévue le [date]").
- Séries incomplètes : Si une saison est partielle (ex: 3/8 épisodes), signale brièvement les épisodes présents et propose de compléter la saison.`;

export const STATIC_ENGLISH_SYSTEM_PROMPT = `You are Askarr, the World Cinema & Series Specialist (in English) and the personal advisor for our family and friends Plex media library.
You speak to non-technical users with warmth, clarity, cinema culture, and enthusiasm.

ABSOLUTE RULES OF TRUTH, RELEVANCE, AND CINEMA EXPERTISE:
1. ZERO TECHNICAL JARGON: Never say words like "Radarr", "Sonarr", "Prowlarr", "Overseerr", "indexer", "tracker", "torrent", "usenet", "passkey", or "TMDB". Talk only about "Plex", "the automated waiting list", "digital / VOD release", or "Blu-Ray / DVD release".
2. ZERO SYSTEMATIC MOVIE LISTS — PROPORTIONATE ANSWERS:
   - You are NOT required to answer with a list of movies! Always adapt your answer to the user's actual intent:
   - Account, Plex server access, how things work, or greetings (e.g. "which servers do I have access to?", "how does this work?", "thank you"): answer directly in prose using '[Connected Plex Profile: ...]' WITHOUT calling random discovery tools and WITHOUT listing movies.
   - Follow-up conversational questions about already displayed cards (e.g. "why these films?", "which one is shortest?", "what do you recommend for tonight?"): answer directly in a few natural sentences based on the titles already displayed in the previous turn ('[Displayed Cards: ...]'), WITHOUT re-reciting the bullet list.
   - Singular requests ("recommend a great movie", "a comedy under 100 minutes", "what's the latest film added?", "do you have Inception?"): answer about ONE SINGLE movie (pass 'limit: 1' to the tool or present only the specific requested title), never a list of 5!
   - Plural requests ("suggest five thrillers", "recommend some movies", "what's new this week?", "films by Nolan"): present the requested number of titles (or 3 to 5 by default) smoothly. Avoid long repetitive bullet points since rich visual cards appear right below your message.
3. ROUTING STRUCTURED CRITERIA SEARCHES ('discover_media_by_criteria') VS CINEMA SPECIALIST ('verify_specific_titles'):
   - **Structured search by criteria (genre, release period/year/decade, runtime in minutes, rating threshold & source like IMDb/Metacritic/Rotten Tomatoes/Letterboxd, vote count, original language, unwatched filter, Plex scope 'on_plex_now' vs 'missing_on_plex' vs 'any')**:
     -> Examples: "Suggest five thrillers between 2010 and 2020 with an IMDb rating above 8", "A comedy under 100 minutes", "1990s sci-fi movies I haven't watched", "Only those available on my Plex servers", "You can also suggest movies missing from Plex that I could request".
     -> ALWAYS call 'discover_media_by_criteria' with structured arguments ('ratingComparison: "gt"' for strictly above vs '"gte"' for at least, 'maxRuntimeComparison: "lt"' for under X minutes, 'scope: "on_plex_now"' for Plex only, 'scope: "missing_on_plex"' for missing on Plex, 'scope: "any"' otherwise).
     -> NEVER pick 4 or 5 titles from memory via 'verify_specific_titles' when 'discover_media_by_criteria' covers the structured criteria.
     -> Present ONLY the verified titles returned by 'discover_media_by_criteria' and their cards. If fewer titles than requested match (or 0 match), return only those verified titles and honestly explain the limit ('shortfallReasonFr') without padding with out-of-criteria titles or relaxing criteria without permission.
     -> If the tool reports unsupported constraints ('unsupportedConstraints', e.g., audio dub language, Netflix availability, unsupported rating source) or unavailable watch history ('watchHistoryWarningFr'), state it explicitly and honestly.
     -> Only summarize applied filters as verified facts if all those properties were verified by the tool.
   - **Conversational follow-ups modifying previous criteria** (e.g. "Only on Plex", "Rather comedies", "And under 90 minutes", "Actually from 2000 onwards"):
     -> Reuse '[Critères MDBList appliqués à ce tour : ...]' from the recent history, pass 'inheritPreviousCriteria: true' to 'discover_media_by_criteria', and update the modified criterion in a controlled way.
   - **Descriptive plot, keyword, or festival/award searches ('verify_specific_titles')**:
     -> If the user searches by plot ("a movie where..."), director + actor combination, or awards ("2023 Cannes Palme d'Or", "Oscar winners"), identify 1 to 5 specific titles and call 'verify_specific_titles'.
   - **Director or actor filmography ('search_person_filmography')**:
     -> Correct spelling errors first and call 'search_person_filmography'. Never propose obscure "making-of" documentaries instead of feature films!
   - ZERO OFF-TOPIC MIXING: Never call 'discover_and_recommend_media(scope="on_plex_now")' randomly when the user asks about their servers or searches for a specific director, actor, title, or structured criteria.
4. ZERO AVAILABILITY INVENTIONS:
   - Never guess whether a film or series is on Plex or in the waiting list: call a tool ('discover_media_by_criteria', 'verify_specific_titles', 'search_person_filmography', 'search_and_check_media', 'get_series_seasons_detail', 'discover_and_recommend_media') and rely strictly on the returned evidence.
5. MULTI-PLEX SERVERS & USER ACCESS:
   - What the user wants to know above all is whether they can watch it and on WHICH Plex servers THEY have personal access to ('userAccessibleServers').
   - When a title is available ('accessibleToCurrentUser !== false'), cite ONLY their accessible servers ('userAccessibleServers'). Never cite a Plex server the user does not have permission to access!
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
9. RECENT PLEX ADDITIONS, WATCH HISTORY & OPEN RECOMMENDATIONS (TRACEARR):
   - For recent additions, call 'get_recently_added_on_plex'.
   - For user history, call 'get_watch_history_and_live_streams' with 'scope: "my_history"'.
   - For open personalized recommendations on Plex ("what do you recommend tonight?"), call 'discover_and_recommend_media' (excluding already watched titles and highlighting popular community choices).
10. EFFICIENCY & CONCISENESS: Be warm, natural, and concise (2 to 5 fluid sentences maximum), as rich visual cards appear right underneath your message. NEVER output internal bracketed context tags such as "[Fiches affichées : ...]" or "[Critères MDBList appliqués à ce tour : ...]" in your final reply.`;

export interface ParsedDsmlToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

const DSML_NUMERIC_PARAM_KEYS = new Set([
  'year',
  'tmdbId',
  'limit',
  'daysBack',
  'minRating',
  'maxRating',
  'minYear',
  'maxYear',
  'yearFrom',
  'yearTo',
  'similarToTmdbId',
  'maxRuntimeMinutes',
  'minRuntimeMinutes',
  'minVotes'
]);

function coerceDsmlParamValue(key: string, rawVal: string, explicitStringAttr?: string): unknown {
  const trimmed = rawVal.trim();
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }
  if (
    /^-?\d+(?:\.\d+)?$/.test(trimmed) &&
    (DSML_NUMERIC_PARAM_KEYS.has(key) || explicitStringAttr === 'false' || !explicitStringAttr)
  ) {
    if (key !== 'query' && key !== 'personName' && key !== 'title' && key !== 'genre') {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Intercepte et nettoie les balises brutes DeepSeek DSML (`<|DSML|...>`, `< | DSML | ...>`, `<｜DSML｜...>`)
 * parfois émises directement dans `message.content` par DeepSeek V3/R1 au lieu de `message.tool_calls`.
 */
export function parseAndStripDsmlToolCalls(rawContent: string | null | undefined): {
  cleanedContent: string;
  toolCalls: ParsedDsmlToolCall[];
} {
  if (!rawContent) {
    return { cleanedContent: '', toolCalls: [] };
  }

  const hasDsml = /<\s*\/?\s*[|｜]\s*DSML\s*[|｜]/i.test(rawContent);
  if (!hasDsml) {
    return { cleanedContent: rawContent, toolCalls: [] };
  }

  // Normalise toutes les variantes (`< | DSML | `, `<｜DSML｜`, `</ | DSML | `) en `<|DSML|` / `</|DSML|`
  const normalized = rawContent.replace(/<\s*(\/?)\s*[|｜]\s*DSML\s*[|｜]\s*/gi, '<$1|DSML|');

  const toolCalls: ParsedDsmlToolCall[] = [];
  const invokeRegex = /<\|DSML\|invoke\b([^>]*)>([\s\S]*?)(?:<\/\|DSML\|invoke>|(?=<\|DSML\|invoke\b)|<\/\|DSML\|(?:function_calls|calls)>|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = invokeRegex.exec(normalized)) !== null) {
    const invokeAttrs = match[1] || '';
    const invokeBody = match[2] || '';

    const nameMatch = invokeAttrs.match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i);
    const fnName = (nameMatch?.[1] || nameMatch?.[2] || nameMatch?.[3] || '').trim();
    if (!fnName) continue;

    const args: Record<string, unknown> = {};

    // 1. Attributs inline éventuels sur la balise invoke (ex: < | DSML | invoke name="search_and_check_media" query="Obsession" mediaType="auto">)
    const attrRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(invokeAttrs)) !== null) {
      const k = attrMatch[1];
      if (k === 'name' || k === 'type' || k === 'string') continue;
      const v = attrMatch[2] ?? attrMatch[3] ?? '';
      args[k] = coerceDsmlParamValue(k, v);
    }

    // 2. Balises enfants <|DSML|parameter name="...">...</|DSML|parameter>
    const paramRegex = /<\|DSML\|(?:parameter|param)\b([^>]*)>([\s\S]*?)(?:<\/\|DSML\|(?:parameter|param)>|(?=<\|DSML\|(?:parameter|param)\b)|$)/gi;
    let paramMatch: RegExpExecArray | null;
    let foundParamTags = false;
    while ((paramMatch = paramRegex.exec(invokeBody)) !== null) {
      const pAttrs = paramMatch[1] || '';
      const pValRaw = paramMatch[2] || '';
      const pNameMatch = pAttrs.match(/\b(?:name|key)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i);
      const pName = (pNameMatch?.[1] || pNameMatch?.[2] || pNameMatch?.[3] || '').trim();
      if (!pName) continue;
      foundParamTags = true;
      const strAttrMatch = pAttrs.match(/\bstring\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const explicitStringAttr = (strAttrMatch?.[1] || strAttrMatch?.[2] || '').toLowerCase();
      args[pName] = coerceDsmlParamValue(pName, pValRaw, explicitStringAttr);
    }

    // 3. Corps JSON direct dans invoke si aucune balise parameter n'est présente
    if (!foundParamTags) {
      const trimmedBody = invokeBody.replace(/<\/?\|DSML\|[^>]*>/gi, '').trim();
      if (trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) {
        try {
          const parsedJson = JSON.parse(trimmedBody) as Record<string, unknown>;
          if (parsedJson && typeof parsedJson === 'object') {
            Object.assign(args, parsedJson);
          }
        } catch {
          // Ignorer si JSON partiel/invalide
        }
      }
    }

    toolCalls.push({
      id: `dsml_call_${toolCalls.length + 1}`,
      type: 'function',
      function: {
        name: fnName,
        arguments: JSON.stringify(args)
      }
    });
  }

  const cleanedContent = normalized
    .replace(/<\|DSML\|(?:function_calls|calls)\b[\s\S]*?<\/\|DSML\|(?:function_calls|calls)>/gi, '')
    .replace(/<\|DSML\|invoke\b[\s\S]*?<\/\|DSML\|invoke>/gi, '')
    .replace(/<\|DSML\|(?:function_calls|calls|invoke)\b[\s\S]*$/gi, '')
    .replace(/<\/?\|DSML\|[^>]*>/gi, '')
    .trim();

  return { cleanedContent, toolCalls };
}

function sanitizeInternalContextTags(text: string): string {
  if (!text) return '';
  const withoutDsml = parseAndStripDsmlToolCalls(text).cleanedContent;
  return withoutDsml
    .replace(/\n*\[Fiches affichées\s*:[\s\S]*$/i, '')
    .replace(/\n*\[Displayed Cards\s*:[\s\S]*$/i, '')
    .replace(/\n*\[Critères MDBList appliqués[^\n]*$/gim, '')
    .replace(/\n*\[Profil Plex connecté\s*:[^\n]*\]/gi, '')
    .replace(/\n*\[Connected Plex Profile\s*:[^\n]*\]/gi, '')
    .trim();
}

/**
 * Sécurise une complétion tronquée par dépassement de tokens (finish_reason === 'length')
 * afin de ne jamais enregistrer ou afficher une réponse coupée au milieu d'un mot ou d'une phrase.
 */
export function handleTruncatedCompletion(content: string): string {
  const trimmed = content.trimEnd();
  if (!trimmed) return trimmed;
  if (/[.!?»"]$/.test(trimmed)) {
    return trimmed;
  }
  const lastPunctuation = Math.max(
    trimmed.lastIndexOf('.'),
    trimmed.lastIndexOf('!'),
    trimmed.lastIndexOf('?')
  );
  if (lastPunctuation > 0 && lastPunctuation >= trimmed.length * 0.4) {
    return trimmed.slice(0, lastPunctuation + 1);
  }
  return `${trimmed}…`;
}

export const READ_ONLY_TOOLS_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_and_check_media',
      description:
        "Rechercher un film ou une série par son titre exact (en français ou titre original anglais) et vérifier sa disponibilité immédiate sur les serveurs Plex (NucVillers, NucBuntu...), sa présence dans la liste d'attente, ses notes IMDb/TMDB et ses dates de sortie Cinéma/VOD/DVD. N'utilise PAS cet outil si l'utilisateur ne nomme pas directement l'œuvre (intrigue, indices, palmarès) : utilise 'verify_specific_titles' pour vérifier les titres déduits à la place.",
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
      name: 'discover_media_by_criteria',
      description:
        "Rechercher dynamiquement des films ou séries par critères structurés via le catalogue MDBList, puis vérifier chaque candidat dans l'infrastructure Askarr (disponibilité Plex sur les serveurs autorisés de l'utilisateur, liste d'attente, exclusion des titres déjà vus) : genre(s), période/années (yearFrom, yearTo, isRecent), seuil et source de note (imdb, tmdb, mdblist, metacritic, rotten_tomatoes, popcorn, letterboxd, mal), opérateur strict ('gt' pour > vs 'gte' pour >=), durée en minutes (maxRuntimeMinutes / minRuntimeMinutes), langue originale VO, périmètre ('on_plex_now', 'missing_on_plex' ou 'any') et suivi conversationnel (inheritPreviousCriteria). N'utilise PAS cet outil pour une recommandation ouverte ou spontanée sans critères de catalogue précis : utilise 'discover_and_recommend_media' à la place.",
      parameters: {
        type: 'object',
        properties: {
          mediaType: {
            type: 'string',
            enum: ['movie', 'tv'],
            description: "'movie' pour des films, 'tv' pour des séries"
          },
          genres: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Genres recherchés (ex: ['thriller'], ['comedy'], ['sci-fi'], ['drama'], ['horror'], ['crime'], ['animation'], ['documentary']...)"
          },
          genreOperator: {
            type: 'string',
            enum: ['and', 'or'],
            description: "'and' (par défaut) si tous les genres doivent être présents, 'or' si l'utilisateur dit explicitement OU"
          },
          yearFrom: {
            type: 'integer',
            description: 'Année minimale de sortie incluse (ex: 2010 pour "entre 2010 et 2020" ou 1990 pour "années 1990")'
          },
          yearTo: {
            type: 'integer',
            description: 'Année maximale de sortie incluse (ex: 2020 pour "entre 2010 et 2020" ou 1999 pour "années 1990")'
          },
          isRecent: {
            type: 'boolean',
            description: "True si l'utilisateur demande un film/série 'récent' sans préciser d'année exacte"
          },
          ratingSource: {
            type: 'string',
            enum: [
              'imdb',
              'tmdb',
              'mdblist',
              'metacritic',
              'rotten_tomatoes',
              'popcorn',
              'letterboxd',
              'mal'
            ],
            description:
              'Source explicite de la note UNIQUEMENT si l’utilisateur mentionne une source ou un seuil précis (ex: "imdb" pour "note IMDb > 8"). Laisser omis si l’utilisateur demande simplement "les meilleurs films" afin d’utiliser le score multi-critiques MDBList.'
          },
          minRating: {
            type: 'number',
            description:
              'Seuil minimal de note UNIQUEMENT si l’utilisateur précise une valeur numérique (ex: 8 sur 10 pour "note supérieure à 8"). Ne pas inventer de seuil si non demandé.'
          },
          maxRating: {
            type: 'number',
            description: 'Seuil maximal éventuel de note'
          },
          ratingComparison: {
            type: 'string',
            enum: ['gt', 'gte'],
            description:
              "'gt' pour strictement supérieur ('supérieure à 8' / '> 8'), 'gte' pour supérieur ou égal ('au moins 8' / '>= 8')"
          },
          minVotes: {
            type: 'integer',
            description: 'Nombre minimal de votes si demandé'
          },
          minRuntimeMinutes: {
            type: 'integer',
            description: 'Durée minimale en minutes si demandée'
          },
          maxRuntimeMinutes: {
            type: 'integer',
            description: 'Durée maximale en minutes (ex: 100 pour "moins de 100 minutes")'
          },
          minRuntimeComparison: {
            type: 'string',
            enum: ['gt', 'gte'],
            description: "'gt' pour strictement plus de X minutes, 'gte' pour au moins X minutes"
          },
          maxRuntimeComparison: {
            type: 'string',
            enum: ['lt', 'lte'],
            description: "'lt' pour strictement moins de X minutes ('moins de 100 minutes'), 'lte' pour au maximum X minutes"
          },
          originalLanguage: {
            type: 'string',
            description: 'Langue originale de production (VO) en code ISO ou nom (ex: "fr", "en", "ko", "ja")'
          },
          audioLanguage: {
            type: 'string',
            description: "À renseigner UNIQUEMENT si l'utilisateur exige une piste de doublage audio spécifique (ex: doublé VF) afin de signaler proprement que le catalogue filtre uniquement la VO"
          },
          externalStreamingPlatform: {
            type: 'string',
            description: "À renseigner UNIQUEMENT si l'utilisateur demande la disponibilité sur un service tiers externe (ex: Netflix, Prime Video, Disney+) afin de distinguer de Plex"
          },
          excludeWatched: {
            type: 'boolean',
            description: 'True (par défaut) pour exclure les titres déjà vus par l’utilisateur connecté'
          },
          scope: {
            type: 'string',
            enum: ['any', 'on_plex_now', 'missing_on_plex'],
            description:
              "'on_plex_now' pour uniquement ceux disponibles sur les serveurs Plex autorisés de l'utilisateur, 'missing_on_plex' pour uniquement ceux absents de Plex à demander, 'any' pour tous (sur Plex et demandables)"
          },
          inheritPreviousCriteria: {
            type: 'boolean',
            description:
              "True si la demande est un suivi conversationnel modifiant les critères du tour précédent ('Seulement sur Plex', 'Plutôt des comédies', 'Et moins de 90 minutes', 'Finalement à partir de 2000')"
          },
          limit: {
            type: 'integer',
            description: 'Nombre de titres souhaités (1 si demande au singulier, 3 à 5 par défaut, max 12)'
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
      name: 'verify_specific_titles',
      description:
        "Outil du Spécialiste Cinéma pour les recherches descriptives : lorsque l'utilisateur cherche un film à partir d'un résumé d'intrigue ('un film où...'), d'indices (réalisateur + acteur + année), ou d'un palmarès de festival (Festival de Cannes / Palme d'Or / Grand Prix, César, Oscars), passe 1 à 5 titres précis identifiés par ton expertise pour vérifier s'ils sont déjà sur Plex et générer leur fiche visuelle. N'utilise PAS cet outil si l'utilisateur nomme déjà directement le titre de l'œuvre : utilise 'search_and_check_media' à la place.",
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
        "Vérifier pourquoi un film ou une série déjà dans la liste d'attente n'est pas encore disponible (téléchargement en cours, attente de sortie VOD/DVD, ou vérification de disponibilité des sources). N'utilise PAS cet outil pour simplement lister la liste d'attente ou savoir qui a fait une demande : utilise 'get_my_requests' à la place.",
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
        "Conseiller et recommander des films ou séries personnalisés : croise automatiquement avec l'historique de visionnage du spectateur connecté (pour exclure ce qu'il a déjà vu et tenir compte de ses goûts récents) ainsi qu'avec les films/séries populaires bien notés que les autres membres ont regardés sur les serveurs Plex. N'utilise PAS cet outil pour une recherche par critères précis de catalogue (durée, note chiffrée, année exacte, filtres avancés) : utilise 'discover_media_by_criteria' à la place si disponible.",
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
            description: "Nombre d'œuvres à recommander : 1 si l'utilisateur demande UN film/série au singulier, 3 à 5 s'il demande des recommandations au pluriel (max 12)"
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
        "Lister les films et séries actuellement dans la liste d'attente automatique (ajoutés par un utilisateur Overseerr ou via une liste automatique Radarr) ainsi que les demandes récentes, avec le nom du demandeur (requestedBy), l'origine (sourceOrigin: 'overseerr_user' ou 'auto_list'), la date de demande/d'ajout (requestedOrAddedAt) et la date de sortie VOD/DVD estimée. N'utilise PAS cet outil pour analyser un blocage technique de téléchargement sur un média précis : utilise 'diagnose_media_acquisition' à la place.",
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
        "Obtenir les derniers films ou séries ajoutés sur les serveurs Plex (aujourd'hui, cette semaine, la semaine dernière, ce mois-ci...) via Tracearr et Plex, avec leurs dates exactes d'ajout et générer leurs fiches visuelles avec le lien direct 'Ouvrir dans Plex'. N'utilise PAS cet outil pour savoir ce que les utilisateurs ont regardé ou connaître les tendances de visionnage : utilise 'get_watch_history_and_live_streams' à la place.",
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
            description: 'Nombre de fiches visuelles à afficher (par défaut 5, max 12)'
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
        "Consulter l'historique de visionnage Plex (via Tracearr) et les flux en direct : savoir quels films ou séries l'utilisateur connecté a regardés récemment ('qu'est-ce que j'ai vu ?', 'quel est le dernier film que j'ai vu ?', 'où j'en étais ?'), connaître les tendances/films les plus vus sur les serveurs, ou (pour l'admin) voir qui regarde quoi en direct. N'utilise PAS cet outil pour lister les nouveaux médias fraîchement ajoutés au catalogue Plex : utilise 'get_recently_added_on_plex' à la place.",
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

    const todayIso = new Date().toISOString().slice(0, 10);
    const allowedSrvList =
      params.plexAccess && params.plexAccess.askarrServerNames.length > 0
        ? params.plexAccess.askarrServerNames.join(', ')
        : isEn ? 'None' : 'Aucun';
    const userAccessContext = params.plexAccess
      ? isEn
        ? `\n[Current Date: ${todayIso} | Connected Plex Profile: ${params.plexAccess.plexUsername || params.userEmail} | Plex servers this user has access to: ${allowedSrvList} — IMPORTANT: in your reply, indicate availability ONLY with respect to this user's accessible Plex servers (${allowedSrvList}) and never use the word "room" for a server.]`
        : `\n[Date du jour : ${todayIso} | Profil Plex connecté : ${params.plexAccess.plexUsername || params.userEmail} | Serveurs Plex auxquels cet utilisateur a accès : ${allowedSrvList} — IMPORTANT : dans ta réponse, indique la disponibilité UNIQUEMENT par rapport aux serveurs Plex de cet utilisateur (${allowedSrvList}) et n'utilise jamais le mot "salle".]`
      : isEn
        ? `\n[Current Date: ${todayIso}]`
        : `\n[Date du jour : ${todayIso}]`;

    let lastAppliedCriteria: NormalizedDiscoveryCriteria | null = null;
    for (const m of history) {
      if (m.role === 'assistant' && Array.isArray(m.provenance)) {
        const critEntry = m.provenance.find((p) => p.source === 'mdblist:criteria' && p.detail);
        if (critEntry?.detail) {
          try {
            lastAppliedCriteria = JSON.parse(critEntry.detail) as NormalizedDiscoveryCriteria;
          } catch {
            // Ignorer si JSON malformé
          }
        }
      }
    }

    // Le message system reste 100% statique et immuable par langue pour garantir un Cache Hit maximal sur le préfixe KV
    const systemPrompt = isEn ? STATIC_ENGLISH_SYSTEM_PROMPT : STATIC_FRENCH_SYSTEM_PROMPT;
    const messages: DeepSeekChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-4).map((m) => {
        let content = sanitizeInternalContextTags(m.content);
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
        if (m.role === 'assistant' && Array.isArray(m.provenance)) {
          const critEntry = m.provenance.find((p) => p.source === 'mdblist:criteria' && p.detail);
          if (critEntry?.detail) {
            content += `\n[Critères MDBList appliqués à ce tour : ${critEntry.detail}]`;
          }
        }
        return {
          role: m.role as 'user' | 'assistant',
          content
        };
      }),
      { role: 'user', content: params.message + userAccessContext }
    ];

    let preserveAllToolCards = false;

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

        const firstChoice = response.choices?.[0];
        const choice = firstChoice?.message;
        const finishReason = firstChoice?.finish_reason;
        if (!choice) {
          throw new Error('DEEPSEEK_EMPTY_CHOICE');
        }

        if (finishReason === 'length') {
          logger.warn(
            {
              provider: usedProvider.id,
              model: usedProvider.model,
              round,
              completionTokens: cTokens
            },
            'LLM generation truncated by max_tokens limit (finish_reason=length)'
          );
        }

        // Fallback parser/stripper DeepSeek V3/R1 : intercepte les blocs < | DSML | invoke ...> ou <|DSML|invoke...>
        // émis par erreur dans `choice.content` (ex: sur iPhone / Safari) au lieu de `choice.tool_calls`
        if (choice.content && /<\s*\/?\s*[|｜]\s*DSML\s*[|｜]/i.test(choice.content)) {
          const dsmlParsed = parseAndStripDsmlToolCalls(choice.content);
          choice.content = dsmlParsed.cleanedContent || null;
          if ((!choice.tool_calls || choice.tool_calls.length === 0) && dsmlParsed.toolCalls.length > 0) {
            choice.tool_calls = dsmlParsed.toolCalls;
          }
        }

        if (!choice.tool_calls || choice.tool_calls.length === 0) {
          let allCards = collectedCards.size > 0 ? Array.from(collectedCards.values()) : [];
          let rawContent = choice.content || '';
          if (finishReason === 'length' && rawContent) {
            rawContent = handleTruncatedCompletion(rawContent);
          }
          const replyText =
            sanitizeInternalContextTags(rawContent) || this.buildDeterministicSummary(allCards);

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
              ? this.filterRelevantCardsForReply(
                  replyText,
                  allCards,
                  toolRounds,
                  false,
                  preserveAllToolCards
                ).map((c) => this.adaptCardToUserAccess(c, params.plexAccess?.askarrServerNames))
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
          if (
            fnName === 'discover_media_by_criteria' ||
            fnName === 'discover_and_recommend_media' ||
            fnName === 'get_recently_added_on_plex' ||
            fnName === 'get_my_requests' ||
            fnName === 'search_person_filmography'
          ) {
            preserveAllToolCards = true;
          }
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
            previousCriteria: lastAppliedCriteria,
            onCriteriaApplied: (c) => {
              lastAppliedCriteria = c;
            },
            onProvenanceCollected: (entries) => {
              for (const p of entries) {
                collectedProvenance.push(p);
              }
            },
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
      const mediaCards = this.filterRelevantCardsForReply(
        replyText,
        allCards,
        toolRounds,
        false,
        preserveAllToolCards
      );
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

    const isRadarrRetrigger =
      params.mediaType === 'movie' &&
      !evidence.actionability.canRequestNow &&
      Boolean(evidence.acquisitionPipeline.canRetriggerSearch);

    if (!evidence.actionability.canRequestNow && !isRadarrRetrigger) {
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

    const actionType: PreparedActionDTO['actionType'] = isRadarrRetrigger
      ? 'RADARR_MOVIE_SEARCH'
      : hasSpecificEpisodes && isKnownInSonarr
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
      actionType === 'RADARR_MOVIE_SEARCH'
        ? `Relancer immédiatement la recherche Radarr pour "${evidence.identity.titleFr}"${yearTxt}`
        : actionType === 'SONARR_EPISODE_SEARCH'
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
    previousCriteria?: NormalizedDiscoveryCriteria | null;
    onCriteriaApplied?: (criteria: NormalizedDiscoveryCriteria) => void;
    onProvenanceCollected?: (entries: MediaEvidence['provenance']) => void;
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

    if (fnName === 'discover_media_by_criteria') {
      const shouldInherit = Boolean(args.inheritPreviousCriteria) && Boolean(params.previousCriteria);
      let rawCriteriaInput: Record<string, unknown> = { ...args };
      delete rawCriteriaInput.inheritPreviousCriteria;

      if (shouldInherit && params.previousCriteria) {
        const prev = params.previousCriteria;
        rawCriteriaInput = {
          mediaType: args.mediaType !== undefined ? args.mediaType : prev.mediaType,
          genres: args.genres !== undefined ? args.genres : prev.genres,
          genreOperator:
            args.genresOperator !== undefined
              ? args.genresOperator
              : args.genreOperator !== undefined
                ? args.genreOperator
                : prev.genreOperator,
          keywords: args.keywords,
          yearFrom: args.yearFrom !== undefined ? args.yearFrom : prev.yearFrom ?? undefined,
          yearTo: args.yearTo !== undefined ? args.yearTo : prev.yearTo ?? undefined,
          isRecent: args.isRecent !== undefined ? args.isRecent : undefined,
          ratingSource: args.ratingSource !== undefined ? args.ratingSource : prev.ratingSource ?? undefined,
          minRating: args.minRating !== undefined ? args.minRating : prev.minRating ?? undefined,
          maxRating: args.maxRating !== undefined ? args.maxRating : prev.maxRating ?? undefined,
          ratingComparison:
            args.ratingComparison !== undefined ? args.ratingComparison : prev.ratingComparison,
          minVotes: args.minVotes !== undefined ? args.minVotes : prev.minVotes ?? undefined,
          minRuntimeMinutes:
            args.minRuntimeMinutes !== undefined ? args.minRuntimeMinutes : prev.minRuntimeMinutes ?? undefined,
          maxRuntimeMinutes:
            args.maxRuntimeMinutes !== undefined ? args.maxRuntimeMinutes : prev.maxRuntimeMinutes ?? undefined,
          originalLanguage:
            args.originalLanguage !== undefined ? args.originalLanguage : prev.originalLanguage ?? undefined,
          spokenLanguage: args.spokenLanguage,
          audioDubbingLanguage: args.audioDubbingLanguage,
          externalStreamingService: args.externalStreamingService,
          sort: args.sort !== undefined ? args.sort : prev.sort,
          order: args.order !== undefined ? args.order : prev.order,
          excludeWatched: args.excludeWatched !== undefined ? args.excludeWatched : prev.excludeWatched,
          scope: args.scope !== undefined ? args.scope : prev.scope,
          limit: args.limit !== undefined ? args.limit : prev.limit,
          unmappedConstraintNotes: args.unmappedConstraintNotes
        };
      } else if (rawCriteriaInput.genresOperator !== undefined && rawCriteriaInput.genreOperator === undefined) {
        rawCriteriaInput.genreOperator = rawCriteriaInput.genresOperator;
      }

      const wantExcludeWatched =
        typeof rawCriteriaInput.excludeWatched === 'boolean' ? rawCriteriaInput.excludeWatched : true;

      let watchedFilter:
        | {
            status: 'verified' | 'unavailable';
            watchedTmdbIds?: ReadonlySet<number>;
            watchedNormTitles?: ReadonlySet<string>;
          }
        | undefined;

      if (wantExcludeWatched) {
        if (
          this.tracearr &&
          this.tracearr.isConfigured() &&
          typeof this.tracearr.getUserTasteAndCommunityTrends === 'function'
        ) {
          try {
            const mediaTypeArg =
              rawCriteriaInput.mediaType === 'tv'
                ? 'tv'
                : rawCriteriaInput.mediaType === 'movie'
                  ? 'movie'
                  : undefined;
            const taste = await this.tracearr.getUserTasteAndCommunityTrends({
              plexUsername: params.plexAccess?.plexUsername || undefined,
              allowedServers: userAllowedServers,
              mediaType: mediaTypeArg
            });
            if (taste) {
              watchedFilter = {
                status: 'verified',
                watchedTmdbIds: taste.watchedTmdbIds,
                watchedNormTitles: taste.watchedNormTitles
              };
            } else {
              watchedFilter = {
                status: 'unavailable'
              };
            }
          } catch {
            watchedFilter = {
              status: 'unavailable'
            };
          }
        } else {
          watchedFilter = {
            status: 'unavailable'
          };
        }
      }

      const res = await this.aggregator.discoverMediaByCriteria({
        rawCriteria: rawCriteriaInput,
        currentUserEmail: params.userEmail,
        currentUserOverseerrId: params.overseerrUserId,
        userAllowedServers,
        watchedFilter,
        recentYearsWindow: this.config.mdblistRecentYearsWindow
      });

      // Repli transparent si MDBList n'est pas configuré sur l'instance : bascule automatique sur le moteur natif Askarr (Plex + Overseerr/TMDb)
      if (res.status === 'connector_error' && res.errorCode === 'MDBLIST_NOT_CONFIGURED') {
        const genresArr = Array.isArray(rawCriteriaInput.genres) ? rawCriteriaInput.genres : [];
        return this.executeReadOnlyTool({
          ...params,
          fnName: 'discover_and_recommend_media',
          args: {
            scope: rawCriteriaInput.scope === 'on_plex_now' ? 'on_plex_now' : 'discover_by_genre_or_trending',
            mediaType: rawCriteriaInput.mediaType === 'tv' ? 'tv' : 'movie',
            genre: genresArr[0] ? String(genresArr[0]) : undefined,
            minRating: typeof rawCriteriaInput.minRating === 'number' ? rawCriteriaInput.minRating : undefined,
            minYear: typeof rawCriteriaInput.yearFrom === 'number' ? rawCriteriaInput.yearFrom : undefined,
            maxYear: typeof rawCriteriaInput.yearTo === 'number' ? rawCriteriaInput.yearTo : undefined,
            limit: typeof rawCriteriaInput.limit === 'number' ? rawCriteriaInput.limit : 5
          }
        });
      }

      if (res.cards.length > 0) {
        params.onCardsCollected(res.cards);
      }
      if (res.provenance.length > 0) {
        params.onProvenanceCollected?.(res.provenance);
      }
      if (res.appliedCriteria) {
        params.onCriteriaApplied?.(res.appliedCriteria);
        params.onProvenanceCollected?.([
          {
            source: 'mdblist:criteria',
            status: 'ok',
            latencyMs: 0,
            detail: JSON.stringify(res.appliedCriteria)
          }
        ]);
      }

      return {
        status: res.status,
        appliedCriteriaSummaryFr: res.appliedCriteria?.appliedCriteriaSummaryFr,
        appliedCriteria: res.appliedCriteria,
        watchHistoryStatus: res.watchHistoryStatus,
        watchHistoryWarningFr: res.watchHistoryWarningFr,
        unsupportedConstraints: res.unsupportedConstraints,
        shortfallReasonFr: res.shortfallReasonFr,
        errorCode: res.errorCode,
        errorMessageFr: res.errorMessageFr,
        stats: res.stats,
        results: this.compactCardsForLlm(res.cards)
      };
    }

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
        maxCandidates: 6
      });
      params.onCardsCollected(res.candidates);
      const compacted = this.compactCardsForLlm(res.candidates);
      const currentYear = new Date().getFullYear();
      const recentFilms = compacted.filter((c) => typeof c.year === 'number' && c.year >= currentYear - 4);
      const classicFilms = compacted.filter((c) => typeof c.year !== 'number' || c.year < currentYear - 4);
      return {
        personName: res.personName,
        sortedBy: 'release_date_desc',
        recentFilms,
        classicFilms,
        results: compacted
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
      const targetLimit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(12, args.limit) : 4;
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
          limit: Math.min(12, targetLimit + 3),
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
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(12, args.limit) : 5;
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
      let mediaType: 'movie' | 'tv' | undefined =
        args.mediaType === 'movie' || args.mediaType === 'tv' ? args.mediaType : undefined;
      if (!mediaType && params.userMessage) {
        const lowerMsg = params.userMessage.toLowerCase();
        // Gère aussi la faute de frappe fréquente "fils" pour "films" ("les 10 dernires fils telechargé")
        const mentionsMovie = /\b(films?|fils|longs?[\s-]m[eé]trages?)\b/i.test(lowerMsg);
        const mentionsTv = /\b(s[eé]ries?)\b/i.test(lowerMsg);
        if (mentionsMovie && !mentionsTv) {
          mediaType = 'movie';
        } else if (mentionsTv && !mentionsMovie) {
          mediaType = 'tv';
        }
      }

      const daysBack = typeof args.daysBack === 'number' && args.daysBack > 0 ? args.daysBack : 21;
      const cardLimit = Math.min(12, Math.max(1, typeof args.limit === 'number' ? args.limit : 5));
      const allowedServers = userAllowedServers;

      const normTitleKey = (s: string) =>
        s
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

      // Exclure les enregistrements TV quotidiens (ProgTV / DVR) lorsqu'on demande des films
      const isTvRecordingTitle = (title: string): boolean => {
        const t = normTitleKey(title);
        return (
          t.includes('late football club') ||
          t.includes('canal football club') ||
          t.includes('l amour est dans le pre') ||
          t.includes('new york unite speciale') ||
          t.includes('journal de 20h') ||
          t.includes('telefoot') ||
          t.includes('enquete exclusive') ||
          t.includes('zone interdite') ||
          t.includes('capital') ||
          t.includes('quotidien') ||
          t.includes('touche pas a mon poste')
        );
      };

      const [tracearrItems, plexDirectItems] = await Promise.all([
        this.tracearr
          ? this.tracearr.getRecentlyAdded({
              allowedServers,
              daysBack,
              mediaType,
              limit: Math.max(25, cardLimit * 3)
            })
          : Promise.resolve([]),
        typeof this.aggregator.getRecentlyAddedFromPlex === 'function'
          ? this.aggregator.getRecentlyAddedFromPlex({
              mediaType,
              limit: Math.max(15, cardLimit * 2),
              allowedServers
            })
          : Promise.resolve([])
      ]);

      type RecentMergedItem = {
        title: string;
        year: number | null;
        mediaType: 'movie' | 'tv';
        tmdbId: number | null;
        addedAt: string;
        daysAgo: number;
        serverNames: string[];
      };

      const mergedByKey = new Map<string, RecentMergedItem>();
      const addMergedItem = (it: RecentMergedItem) => {
        if (mediaType && it.mediaType !== mediaType) return;
        if (mediaType === 'movie' && isTvRecordingTitle(it.title)) return;
        const key =
          it.tmdbId && it.tmdbId > 0
            ? `${it.mediaType}:tmdb:${it.tmdbId}`
            : `${it.mediaType}:${normTitleKey(it.title)}`;
        const existing = mergedByKey.get(key);
        if (!existing) {
          mergedByKey.set(key, {
            ...it,
            serverNames: [...it.serverNames]
          });
        } else {
          if (!existing.tmdbId && it.tmdbId) existing.tmdbId = it.tmdbId;
          if (!existing.year && it.year) existing.year = it.year;
          for (const srv of it.serverNames) {
            if (!existing.serverNames.includes(srv)) {
              existing.serverNames.push(srv);
            }
          }
        }
      };

      // Prioriser les vrais ajouts des bibliothèques Films / Séries TV de Plex, complétés par Tracearr
      for (const pItem of plexDirectItems) {
        addMergedItem(pItem);
      }
      for (const tItem of tracearrItems) {
        addMergedItem(tItem);
      }

      const recentItems = Array.from(mergedByKey.values()).sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
      );

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
    const todayIso = new Date().toISOString().slice(0, 10);
    return cards.map((c) => {
      const libs = Array.from(
        new Set(c.catalogPresence.matchedItems.map((m) => m.libraryTitle).filter(Boolean))
      );
      const vodIso =
        c.acquisitionPipeline.estimatedAvailabilityDate ||
        c.identity.releaseDates.estimatedVodOrDvdDate ||
        null;
      const isVodAlreadyReleased = vodIso ? vodIso.slice(0, 10) <= todayIso : undefined;
      return {
        tmdbId: c.identity.tmdbId,
        mediaType: c.identity.mediaType,
        titleFr: c.identity.titleFr,
        originalTitle:
          c.identity.originalTitle !== c.identity.titleFr ? c.identity.originalTitle : undefined,
        year: c.identity.year,
        runtimeMinutes: c.identity.runtimeMinutes || undefined,
        genres: c.identity.genres.slice(0, 3),
        directorOrCreator: c.identity.directorOrCreator || undefined,
        topCast: c.identity.topCast.slice(0, 4),
        overviewFr: c.identity.overviewFr
          ? c.identity.overviewFr.slice(0, 200)
          : undefined,
        ratingSur10:
          c.identity.ratings.imdbOrAudienceRating ?? c.identity.ratings.tmdbVoteAverage ?? undefined,
        imdbRating: c.identity.ratings.imdbRating ?? undefined,
        imdbVotes: c.identity.ratings.imdbVotes ?? undefined,
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
        todayDate: todayIso,
        vodOrDvdReleaseDate: vodIso || undefined,
        isVodAlreadyReleased,
        estimatedAvailabilityDate:
          !isVodAlreadyReleased && vodIso ? vodIso : undefined,
        lastSearchAt: c.acquisitionPipeline.lastSearchAt || undefined,
        lastSearchBy: c.acquisitionPipeline.lastSearchBy || undefined,
        lastSearchReportsDownloaded:
          c.acquisitionPipeline.lastSearchReportsDownloaded ?? undefined,
        canRetriggerSearch: c.acquisitionPipeline.canRetriggerSearch || undefined,
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
      choices?: Array<{ message?: DeepSeekChatMessage; finish_reason?: string }>;
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
    choices?: Array<{ message?: DeepSeekChatMessage; finish_reason?: string }>;
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
          max_tokens: 900
        };

        const activeTools = (this.config.mdblistApiKey || '').trim()
          ? READ_ONLY_TOOLS_DEFINITIONS
          : READ_ONLY_TOOLS_DEFINITIONS.filter((t) => t.function.name !== 'discover_media_by_criteria');

        if (provider.id === 'deepseek') {
          body.tools = activeTools;
          body.tool_choice = includeTools ? 'auto' : 'none';
        } else if (includeTools) {
          body.tools = sanitizeToolsForProvider(activeTools, provider.id);
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
          choices?: Array<{ message?: DeepSeekChatMessage; finish_reason?: string }>;
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
    requireMention = false,
    preserveAllToolCards = false
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

    // Pour une recherche par critères, une recommandation de liste, les derniers ajouts Plex ou une filmographie
    // (`preserveAllToolCards === true` ou sélection >= 4 titres distincts), le prompt système demande au LLM
    // de faire une synthèse fluide sans réciter les 10 titres un par un dans son texte.
    // On conserve donc TOUTES les fiches vérifiées par l'outil (jusqu'à 12), en plaçant en tête celles mises en avant dans la réponse.
    if (!requireMention && (preserveAllToolCards || allCards.length >= 4)) {
      const hasRealCards = allCards.some((c) => c.identity.tmdbId > 0);
      const eligibleCards = hasRealCards
        ? allCards.filter((c) => c.identity.tmdbId > 0 || isCardMentioned(c))
        : allCards;

      // Vérifier s'il ne s'agit pas uniquement d'homonymes d'un même titre (ex: 4 versions du Comte de Monte-Cristo)
      const distinctNormTitles = new Set(eligibleCards.map((c) => norm(c.identity.titleFr)));
      if (preserveAllToolCards || distinctNormTitles.size >= 3) {
        const mentionedSet = new Set(mentionedCards);
        const unmentioned = eligibleCards.filter((c) => !mentionedSet.has(c));
        return [...mentionedCards, ...unmentioned].slice(0, 12);
      }
    }

    // Dès que la réponse finale cite explicitement au moins un titre parmi les cartes collectées
    // (cas d'une recherche unitaire ou descriptive type `search_and_check_media` / `verify_specific_titles`),
    // on n'affiche QUE les cartes réellement mentionnées dans la réponse (évite d'afficher un homonyme
    // ou un 3e titre vérifié en coulisse mais écarté par l'IA, ex: Boogie Nights ou Goliath non retenu).
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
      return realCards.slice(0, 12);
    }

    return allCards.slice(0, 12);
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
      const vodIso = c.identity.releaseDates.estimatedVodOrDvdDate;
      const todayIso = new Date().toISOString().slice(0, 10);
      const isVodPast = Boolean(vodIso && vodIso.slice(0, 10) <= todayIso);
      const vodDate = isEn
        ? (vodIso || '')
        : formatFrenchDate(vodIso);
      const dateTxt =
        c.catalogPresence.state !== 'available_now' && vodDate
          ? isVodPast
            ? isEn
              ? ` Already released on digital/DVD on ${vodDate} (awaiting available version).`
              : ` Déjà sorti en VOD/DVD le ${vodDate} (en attente d'une version disponible).`
            : isEn
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
