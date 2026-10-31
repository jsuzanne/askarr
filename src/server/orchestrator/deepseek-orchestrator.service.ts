import type { AppConfig } from '../config/env.js';
import type { AskarrDatabase } from '../db/database.js';
import type { MediaAggregatorService } from '../aggregator/media-aggregator.service.js';
import type { OverseerrConnector } from '../connectors/overseerr.connector.js';
import type { TracearrConnector } from '../connectors/tracearr.js';
import type {
  DeepSeekBalanceDTO,
  LlmTurnUsageDTO,
  MediaEvidence,
  PreparedActionDTO,
  ProvenanceEntry
} from '../../shared/types.js';
import { formatFrenchDate } from '../aggregator/media-aggregator.service.js';

export const STATIC_FRENCH_SYSTEM_PROMPT = `Tu es Askarr, le Spécialiste du Cinéma Mondial & des Séries (en français) et le conseiller personnel de la médiathèque Plex familiale et amicale.
Tu t'adresses à des proches non techniques avec bienveillance, clarté, culture cinématographique et enthousiasme.

RÈGLES ABSOLUES DE VÉRITÉ ET D'EXPERTISE CINÉMA :
1. ZÉRO JARGON TECHNIQUE : Ne prononce jamais les mots "Radarr", "Sonarr", "Prowlarr", "Overseerr", "indexeur", "tracker", "torrent", "usenet", "passkey" ou "TMDB". Parle uniquement de "Plex", de "la liste d'attente automatique", de "sortie VOD / numérique" ou de "sortie DVD / Blu-Ray".
2. RÔLE DE SPÉCIALISTE DU CINÉMA (RÉALISATEURS, ACTEURS, MOTS-CLÉS, INTRIGUES, FESTIVAL DE CANNES, CÉSAR, OSCARS) :
   - Tu possèdes une culture cinématographique encyclopédique : palmarès du Festival de Cannes (Palme d'Or, Grand Prix, Prix du Jury, Prix d'interprétation, Un Certain Regard), César, Oscars, Mostra de Venise, Berlinale, filmographies complètes des réalisateurs et acteurs français et internationaux.
   - Si l'utilisateur cherche un film à partir de mots-clés, d'un résumé d'intrigue ("un film où..."), d'une combinaison (réalisateur + acteur + année), ou d'un festival ("Palme d'Or à Cannes en 2023", "les films primés à Cannes récemment") :
     -> Identifie grâce à ton expertise 1 à 5 films précis correspondants, puis appelle OBLIGATOIREMENT l'outil \`verify_specific_titles\` avec leurs titres exacts et années pour vérifier leur présence sur Plex et dans la liste d'attente.
   - Si l'utilisateur cherche les films d'un réalisateur ou d'un acteur (ex: "cherche un film de klapish", "un film avec Cillian Murphy") :
     -> Corrige d'abord les fautes d'orthographe sur le nom ("klapish" -> "Cédric Klapisch").
     -> Appelle \`search_person_filmography\` avec le nom corrigé ET/OU \`verify_specific_titles\` avec ses longs-métrages majeurs (ex: pour Cédric Klapisch : L'Auberge espagnole, Un air de famille, Le Péril jeune, En corps, Les Poupées russes). Ne propose JAMAIS d'obscurs documentaires "making-of" sur le réalisateur à la place de ses vrais films !
   - ZÉRO MÉLANGE HORS-SUJET : N'appelle jamais \`discover_and_recommend_media(scope='on_plex_now')\` au hasard quand l'utilisateur demande un réalisateur, un acteur ou un film précis. Ne présente que des œuvres qui répondent directement à la demande.
3. ZÉRO INVENTION DE DISPONIBILITÉ & CONTINUITÉ CONVERSATIONNELLE :
   - Tu ne dois JAMAIS deviner si un nouveau film ou une nouvelle série est sur Plex ou dans la liste d'attente : appelle un outil (\`verify_specific_titles\`, \`search_person_filmography\`, \`search_and_check_media\`, \`get_series_seasons_detail\`, \`discover_and_recommend_media\`) et base-toi exclusivement sur les preuves retournées.
   - Si l'utilisateur pose une question de suivi sur les œuvres que tu viens tout juste de lui présenter au tour précédent (ex: "pourquoi ces films ?", "lequel est le plus court ?", "tu me conseilles lequel ?"), réponds directement à propos de ces œuvres du tour immédiatement précédent (mentionnées dans \`[Fiches affichées sous ce message : ...]\`) sans repartir sur un sujet plus ancien de la conversation.
4. MULTI-SERVEURS PLEX, BIBLIOTHÈQUES SPÉCIALISÉES & ACCÈS PERSONNEL DE L'UTILISATEUR :
   - Chaque fiche comporte \`availableServers\` (serveurs Plex où le film/série est présent : ex. \`["NucVillers", "NucBuntu"]\` ou \`["NucBuntu"]\`), \`userAllowedServers\` (serveurs auxquels le compte Plex de l'utilisateur a accès) et \`accessibleToCurrentUser\` (true/false).
   - Précise toujours sur quel(s) serveur(s) Plex l'œuvre est disponible (ex: "Disponible dès maintenant sur Plex (NucVillers & NucBuntu)" ou "Disponible sur Plex dans la bibliothèque Cinephile sur le serveur NucBuntu").
   - Si \`accessibleToCurrentUser === false\` (ex: le film est uniquement sur le serveur \`NucBuntu\` alors que le compte Plex de l'utilisateur n'a accès qu'à \`NucVillers\`), préviens-le avec bienveillance ("Ce film est bien présent sur le serveur NucBuntu, mais ton compte Plex est actuellement rattaché uniquement à NucVillers").
5. CONSEILLER CINÉMA & DATES DE SORTIE VOD / DVD :
   - Présente toujours brièvement l'œuvre : titre français (et titre original s'il diffère), année, genre(s), réalisateur/acteurs principaux, distinction éventuelle (ex: Palme d'Or à Cannes, César, Oscar), et sa note IMDb / spectateurs sur 10 (ex: ⭐ 8.2/10).
   - Si le film n'est pas sur Plex mais figure déjà dans la liste d'attente (monitored_waiting_release / monitored_searching), rassure l'utilisateur : dis-lui qu'il n'est pas encore sur Plex mais qu'il est déjà programmé dans la liste d'attente, et indique sa date de sortie VOD ou DVD/Blu-Ray (ou la date estimée ~4 mois après la sortie cinéma).
   - Si le film n'est ni sur Plex ni dans la liste d'attente, indique s'il est déjà sorti en VOD/DVD ou quand il sortira, et précise qu'il peut être demandé via le bouton sur sa fiche ci-dessous.
6. DEMANDES EN 2 ÉTAPES (CONFIRMATION OBLIGATOIRE) :
   - Si l'utilisateur demande explicitement d'ajouter un film ou une série qui est éligible (canRequestNow=true), appelle \`prepare_media_request\` pour préparer le bouton de confirmation à usage unique, et invite l'utilisateur à cliquer sur "Confirmer la demande". N'affirme jamais que la demande est déjà envoyée avant qu'il ait cliqué sur ce bouton.
7. HOMONYMES : Si plusieurs œuvres correspondent, présente brièvement les choix pour aider l'ami à choisir sur les cartes visuelles.
8. NOUVEAUTÉS PLEX & HISTORIQUE DE VISIONNAGE (TRACEARR) :
   - Si l'utilisateur demande quels sont les derniers films ou séries ajoutés sur Plex (ex: "quel est le dernier film ajouté la semaine dernière ?", "quoi de neuf sur Plex cette semaine ?", "les derniers ajouts"), appelle OBLIGATOIREMENT \`get_recently_added_on_plex\` et indique-lui les titres exacts ainsi que leur date d'ajout précise et les serveurs Plex correspondants.
   - Si l'utilisateur demande ce qu'il a regardé récemment ("qu'est-ce que j'ai vu dernièrement ?", "où j'en étais dans ma série ?"), demande les films les plus regardés sur les serveurs, ou (si c'est l'admin) demande qui regarde quoi en direct, appelle OBLIGATOIREMENT \`get_watch_history_and_live_streams\`.
9. CONCISION : Sois chaleureux, précis et concis (3 à 6 phrases claires maximum), car les fiches visuelles détaillées s'affichent juste en dessous de ton message.`;

const READ_ONLY_TOOLS_DEFINITIONS = [
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
        "Outil du Spécialiste Cinéma : lorsque l'utilisateur cherche un film à partir de mots-clés/intrigue, d'indices (réalisateur + acteur + année), d'un palmarès (Festival de Cannes / Palme d'Or / Grand Prix, César, Oscars) ou demande les meilleurs films d'un cinéaste, passe 1 à 5 titres précis identifiés par ton expertise pour vérifier leur disponibilité exacte sur Plex et dans la liste d'attente.",
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
        "Conseiller et recommander des films ou séries selon le genre, les notes IMDb/TMDB, une bibliothèque Plex spécifique (ex: 'Cinephile', 'Films', 'Horror') ou la similarité avec une œuvre appréciée.",
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
            description: 'Note minimale sur 10 (par défaut 7.0)'
          },
          plexLibraryFilter: {
            type: 'string',
            description: "Nom d'une bibliothèque Plex spécifique si demandé (ex: 'Cinephile', 'Films', 'Horror', 'Enfants')"
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
      description: "Lister les demandes récentes de l'utilisateur et leur avancement réel.",
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 8 }
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
        "Consulter l'historique de visionnage Plex (via Tracearr) et les flux en direct : savoir quels films ou séries l'utilisateur connecté a regardés récemment ('qu'est-ce que j'ai vu ?', 'où j'en étais ?'), connaître les tendances/films les plus vus sur les serveurs, ou (pour l'admin) voir qui regarde quoi en direct.",
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['my_history', 'global_recent_and_trends', 'live_streams'],
            description:
              "'my_history' pour l'historique personnel du spectateur connecté, 'global_recent_and_trends' pour les lectures récentes et tendances sur les serveurs, 'live_streams' pour les lectures en cours"
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
        "Préparer une proposition de demande d'ajout sur Plex soumise à confirmation explicite (2 étapes) par l'utilisateur. N'exécute jamais l'ajout directement.",
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
            description: 'Numéros des saisons demandées (obligatoire si mediaType=tv)'
          }
        },
        required: ['tmdbId', 'mediaType'],
        additionalProperties: false
      }
    }
  }
];

export const MAX_TOOL_ROUNDS = 3;
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

export class DeepSeekOrchestratorService {
  constructor(
    private readonly config: AppConfig,
    private readonly db: AskarrDatabase,
    private readonly aggregator: MediaAggregatorService,
    private readonly overseerr: OverseerrConnector,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly tracearr?: TracearrConnector
  ) {}

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
    if (!this.config.deepseekApiKey || budget.isOverQuota) {
      return this.runDirectSearchFallback({
        convId,
        userEmail: params.userEmail,
        overseerrUserId: params.overseerrUserId,
        message: params.message,
        reason: budget.isOverQuota ? 'QUOTA_EXCEEDED' : 'NO_API_KEY'
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
    const tStart = Date.now();

    const userAccessContext = params.plexAccess
      ? `\n\n[PROFIL PLEX DE L'UTILISATEUR CONNECTÉ]\n` +
        `- Email : ${params.userEmail}${params.plexAccess.plexUsername ? ` (Compte Plex : ${params.plexAccess.plexUsername})` : ''}\n` +
        `- Serveurs Plex Askarr autorisés sur son compte : ${
          params.plexAccess.askarrServerNames.length > 0
            ? params.plexAccess.askarrServerNames.join(', ')
            : 'Aucun serveur Askarr détecté sur ce compte'
        }\n` +
        `- Rappel des bibliothèques par serveur :\n` +
        `  • NucVillers & NucBuntu (bibliothèques partagées) : Films, Séries TV, Enfants, Films Legacy, True Crimes, VideoDivers.\n` +
        `  • NucBuntu uniquement (bibliothèques exclusives) : Cinephile, Films 4K, Horror, Musical.\n` +
        `Si l'utilisateur demande à quels films ou serveurs il a accès, indique-lui clairement ses serveurs Plex (${params.plexAccess.askarrServerNames.join(' & ') || 'aucun'}) et les bibliothèques correspondantes, et utilise discover_and_recommend(scope="on_plex_now") pour lui montrer quelques pépites actuellement disponibles sur ses serveurs.`
      : '';

    const lastAssistantWithCards = [...history]
      .reverse()
      .find((m) => m.role === 'assistant' && m.mediaCards && m.mediaCards.length > 0);

    const messages: DeepSeekChatMessage[] = [
      { role: 'system', content: STATIC_FRENCH_SYSTEM_PROMPT + userAccessContext },
      ...history.slice(-4).map((m) => {
        let content = m.content;
        if (m.role === 'assistant' && m.mediaCards && m.mediaCards.length > 0) {
          const cardsSummary = m.mediaCards
            .map(
              (c) =>
                `${c.identity.titleFr}${c.identity.year ? ` (${c.identity.year})` : ''} [tmdbId=${c.identity.tmdbId}, état=${c.catalogPresence.state}]`
            )
            .join(' | ');
          content += `\n[Fiches affichées sous ce message : ${cardsSummary}]`;
        }
        return {
          role: m.role as 'user' | 'assistant',
          content
        };
      }),
      { role: 'user', content: params.message }
    ];

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const allowTools = round < MAX_TOOL_ROUNDS;
        const response = await this.callDeepSeek(messages, allowTools);

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
          const allCards =
            collectedCards.size > 0
              ? Array.from(collectedCards.values())
              : lastAssistantWithCards?.mediaCards || [];
          const replyText = (choice.content || '').trim() || this.buildDeterministicSummary(allCards);
          const mediaCards = this.filterRelevantCardsForReply(replyText, allCards, toolRounds);
          const costUsd = this.computeCostUsd(totalCacheMissTokens, totalCacheHitTokens, totalCompletionTokens);
          const latencyMs = Date.now() - tStart;

          this.db.recordLlmUsage({
            userEmail: params.userEmail,
            conversationId: convId,
            model: this.config.deepseekModel,
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

        // Exécution des tool_calls retournés par DeepSeek
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
      const costUsd = this.computeCostUsd(totalCacheMissTokens, totalCacheHitTokens, totalCompletionTokens);
      const latencyMs = Date.now() - tStart;

      this.db.recordLlmUsage({
        userEmail: params.userEmail,
        conversationId: convId,
        model: this.config.deepseekModel,
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

    let selectedSeasons: number[] | undefined;
    if (params.mediaType === 'tv') {
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

    const actionType = params.mediaType === 'tv' ? 'OVERSEERR_REQUEST_TV' : 'OVERSEERR_REQUEST_MOVIE';
    const yearTxt = evidence.identity.year ? ` (${evidence.identity.year})` : '';
    const seasonsTxt =
      params.mediaType === 'tv' && selectedSeasons
        ? ` — Saison(s) ${selectedSeasons.join(', ')}`
        : '';
    const summaryFr = `Demander l'ajout de "${evidence.identity.titleFr}"${yearTxt}${seasonsTxt} sur Plex`;

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
      summaryFr,
      expiresAt: created.expiresAt,
      status: 'PENDING'
    };

    return { evidence, preparedAction };
  }

  private async executeReadOnlyTool(params: {
    fnName: string;
    args: Record<string, unknown>;
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
        currentUserOverseerrId: params.overseerrUserId
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
        currentUserOverseerrId: params.overseerrUserId
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
      const plexLibraryFilter = typeof args.plexLibraryFilter === 'string' ? args.plexLibraryFilter : undefined;

      const cards = await this.aggregator.discoverAndRecommend({
        scope,
        mediaType,
        genre,
        similarToTmdbId,
        minRating,
        plexLibraryFilter,
        currentUserEmail: params.userEmail,
        currentUserOverseerrId: params.overseerrUserId
      });
      params.onCardsCollected(cards);
      return this.compactCardsForLlm(cards);
    }

    if (fnName === 'get_my_requests') {
      const reqs = await this.overseerr.getRequests(params.overseerrUserId, 6);
      const enriched = await Promise.all(
        reqs.slice(0, 4).map((r) =>
          this.aggregator.buildMediaEvidence({
            tmdbId: r.tmdbId,
            mediaType: r.mediaType,
            currentUserEmail: params.userEmail,
            currentUserOverseerrId: params.overseerrUserId
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
      const allowedServers =
        params.plexAccess?.askarrServerNames && params.plexAccess.askarrServerNames.length > 0
          ? params.plexAccess.askarrServerNames
          : undefined;

      const recentItems = this.tracearr
        ? await this.tracearr.getRecentlyAdded({
            allowedServers,
            daysBack,
            mediaType,
            limit: 20
          })
        : [];

      const topForCards = recentItems.slice(0, cardLimit);
      const cards: MediaEvidence[] = [];

      for (const item of topForCards) {
        try {
          if (item.tmdbId && item.tmdbId > 0) {
            const ev = await this.aggregator.buildMediaEvidence({
              tmdbId: item.tmdbId,
              mediaType: item.mediaType,
              currentUserEmail: params.userEmail,
              currentUserOverseerrId: params.overseerrUserId
            });
            cards.push(ev);
          } else {
            const verified = await this.aggregator.verifySpecificTitles({
              items: [
                {
                  title: item.title,
                  year: item.year ?? undefined,
                  mediaType: item.mediaType
                }
              ],
              currentUserEmail: params.userEmail,
              currentUserOverseerrId: params.overseerrUserId
            });
            if (verified.length > 0) {
              cards.push(verified[0]);
            }
          }
        } catch {
          // Ignorer un item isolé en cas d'erreur d'enrichissement
        }
      }

      if (cards.length > 0) {
        params.onCardsCollected(cards);
      }

      return {
        daysBackInspected: daysBack,
        totalRecentFound: recentItems.length,
        recentAdditionsChronological: recentItems.slice(0, 15).map((r) => ({
          title: r.title,
          year: r.year,
          mediaType: r.mediaType,
          tmdbId: r.tmdbId,
          addedAtIso: r.addedAt.slice(0, 10),
          addedAtFrench: formatFrenchDate(r.addedAt),
          daysAgo: r.daysAgo,
          servers: r.serverNames
        })),
        enrichedCards: this.compactCardsForLlm(cards)
      };
    }

    if (fnName === 'get_watch_history_and_live_streams') {
      const scope =
        args.scope === 'my_history' || args.scope === 'live_streams'
          ? args.scope
          : 'global_recent_and_trends';
      const enrichTopCards = Boolean(args.enrichTopCards ?? true);

      if (!this.tracearr || !this.tracearr.isConfigured()) {
        return { error: 'TRACEARR_NOT_CONFIGURED' };
      }

      const [myOrGlobalHistory, liveStreams] = await Promise.all([
        this.tracearr.getWatchHistory({
          plexUsername:
            scope === 'my_history' ? params.plexAccess?.plexUsername || undefined : undefined,
          limit: 25
        }),
        this.tracearr.getActiveStreams()
      ]);

      if (enrichTopCards && myOrGlobalHistory.length > 0) {
        const seenTmdb = new Set<number>();
        const cards: MediaEvidence[] = [];
        for (const h of myOrGlobalHistory) {
          if (h.tmdbId && h.tmdbId > 0 && !seenTmdb.has(h.tmdbId) && cards.length < 4) {
            seenTmdb.add(h.tmdbId);
            try {
              const ev = await this.aggregator.buildMediaEvidence({
                tmdbId: h.tmdbId,
                mediaType: h.mediaType,
                currentUserEmail: params.userEmail,
                currentUserOverseerrId: params.overseerrUserId
              });
              cards.push(ev);
            } catch {
              // Ignorer
            }
          }
        }
        if (cards.length > 0) {
          params.onCardsCollected(cards);
        }
      }

      const isAdmin = this.config.adminEmails.includes(params.userEmail.toLowerCase());
      return {
        scope,
        activeStreams: isAdmin
          ? liveStreams
          : {
              total: liveStreams.total,
              transcodes: liveStreams.transcodes,
              directPlays: liveStreams.directPlays
            },
        recentWatchHistory: myOrGlobalHistory.slice(0, 15).map((h) => ({
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

      try {
        const { evidence, preparedAction } = await this.prepareMediaRequestAction({
          userEmail: params.userEmail,
          overseerrUserId: params.overseerrUserId,
          tmdbId,
          mediaType,
          seasons
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

  private compactCardsForLlm(cards: MediaEvidence[]): unknown {
    return cards.map((c) => ({
      tmdbId: c.identity.tmdbId,
      mediaType: c.identity.mediaType,
      titleFr: c.identity.titleFr,
      originalTitle: c.identity.originalTitle,
      year: c.identity.year,
      genres: c.identity.genres,
      directorOrCreator: c.identity.directorOrCreator,
      topCast: c.identity.topCast,
      ratingSur10: c.identity.ratings.imdbOrAudienceRating ?? c.identity.ratings.tmdbVoteAverage,
      overviewFr: c.identity.overviewFr ? c.identity.overviewFr.slice(0, 220) : null,
      releaseDates: c.identity.releaseDates,
      plexState: c.catalogPresence.state,
      availableServers: c.catalogPresence.availableServers,
      userAccessibleServers: c.catalogPresence.userAccessibleServers,
      userAllowedServers: c.catalogPresence.userAllowedServers,
      accessibleToCurrentUser: c.catalogPresence.accessibleToCurrentUser,
      plexLocations: c.catalogPresence.matchedItems.map((m) => ({
        serverName: m.serverName,
        library: m.libraryTitle,
        sharedAcrossAllPlexServers: m.isSharedAcrossAllServers
      })),
      pipelineState: c.acquisitionPipeline.state,
      estimatedAvailabilityDate: c.acquisitionPipeline.estimatedAvailabilityDate,
      seasonsSummary: c.episodeCoverage?.seasons.map((s) => ({
        season: s.seasonNumber,
        state: s.state,
        episodesOnPlex: `${s.plexEpisodeCount}/${s.totalEpisodeCount}`
      })),
      indexerSearch: c.indexerSearch.queried ? c.indexerSearch : undefined,
      canRequestNow: c.actionability.canRequestNow,
      requestableSeasons: c.actionability.requestableSeasons,
      statusLabelFr: c.actionability.userFriendlyStatusLabel,
      explanationFr: c.actionability.userFriendlyExplanationFr
    }));
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

  private async callDeepSeek(
    messages: DeepSeekChatMessage[],
    includeTools: boolean
  ): Promise<{
    choices?: Array<{ message?: DeepSeekChatMessage }>;
    usage?: Record<string, number>;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);
    try {
      const body: Record<string, unknown> = {
        model: this.config.deepseekModel,
        messages,
        temperature: 0.2,
        max_tokens: 550
      };
      if (includeTools) {
        body.tools = READ_ONLY_TOOLS_DEFINITIONS;
        body.tool_choice = 'auto';
      }

      const res = await this.fetchImpl(`${this.config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.deepseekApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`DEEPSEEK_HTTP_${res.status}`);
      }
      return (await res.json()) as {
        choices?: Array<{ message?: DeepSeekChatMessage }>;
        usage?: Record<string, number>;
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async runDirectSearchFallback(params: {
    convId: string;
    userEmail: string;
    overseerrUserId: number | null;
    message: string;
    reason: string;
  }): Promise<{
    conversationId: string;
    messageId?: string;
    reply: string;
    mediaCards: MediaEvidence[];
    provenance: ProvenanceEntry[];
    aiMode: 'direct_search_fallback';
  }> {
    const cleanedQuery = params.message
      .replace(/[«»"""]/g, ' ')
      .replace(/\(ou une autre[^)]*\)/gi, ' ')
      .replace(
        /^(est-ce que tu as|est-ce que le film|est-ce que la série|est-ce que|où en est la série|ou en est la serie|as-tu|je cherche|je voudrais voir|y a-t-il|le film|la série|la serie)\s+/i,
        ''
      )
      .replace(/\s+(est disponible sur plex|est dispo ou quand sort-il en vod|sur plex)\s*/gi, ' ')
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
    const reply = this.buildDeterministicSummary(searchRes.candidates);

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
   */
  public filterRelevantCardsForReply(
    replyText: string,
    allCards: MediaEvidence[],
    toolRounds: number
  ): MediaEvidence[] {
    if (allCards.length <= 1) return allCards;

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
      return mentionedCards;
    }

    // Si des cartes TMDB réelles ont été trouvées ET des cartes synthétiques Plex non mentionnées sont présentes,
    // on élimine les cartes synthétiques non mentionnées.
    const hasSyntheticPlexCards = allCards.some((c) => c.identity.tmdbId < 0);
    const realCards = allCards.filter((c) => c.identity.tmdbId > 0);
    if (realCards.length > 0 && hasSyntheticPlexCards) {
      return realCards.slice(0, 6);
    }

    return allCards.slice(0, 6);
  }

  public buildDeterministicSummary(cards: MediaEvidence[]): string {
    if (cards.length === 0) {
      return "Je n'ai trouvé aucun film ni aucune série correspondant à cette recherche. Peux-tu vérifier l'orthographe ou me donner le titre en français ou en anglais ?";
    }
    if (cards.length === 1) {
      const c = cards[0];
      const rating = c.identity.ratings.imdbOrAudienceRating ?? c.identity.ratings.tmdbVoteAverage;
      const ratingTxt = rating ? ` (⭐ ${rating}/10)` : '';
      const vodDate = formatFrenchDate(c.identity.releaseDates.estimatedVodOrDvdDate);
      const dateTxt =
        c.catalogPresence.state !== 'available_now' && vodDate
          ? ` Sortie VOD/DVD ${c.identity.releaseDates.isEstimatedDate ? 'estimée vers le' : 'prévue le'} ${vodDate}.`
          : '';
      return `Voici ce que j'ai trouvé pour **${c.identity.titleFr}** (${c.identity.year || 'N/A'})${ratingTxt} : ${c.actionability.userFriendlyExplanationFr}${dateTxt}`;
    }
    return `J'ai trouvé **${cards.length} œuvres** correspondantes. Voici leur disponibilité exacte sur Plex et dans la liste d'attente :`;
  }
}
