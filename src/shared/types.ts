export type MediaType = 'movie' | 'tv';

export type UserRole = 'friend' | 'admin';

export interface ProvenanceEntry {
  source: string; // ex: 'overseerr', 'plex:NucVillers', 'plex:NucBuntu', 'radarr', 'sonarr', 'prowlarr'
  status: 'ok' | 'error' | 'timeout' | 'skipped';
  latencyMs: number;
  detail?: string;
}

export interface PlexMatchedItem {
  serverName: string;          // ex: "NucVillers", "NucBuntu", "EQ12buntu", "MacMini", "Macmini4"
  ratingKey: string;
  libraryTitle: string;        // ex: "Films", "Séries TV", "Cinephile", "Films 4K", "Horror", "Musical"
  isSharedAcrossAllServers: boolean;
  title: string;
  originalTitle?: string | null;
  year: number | null;
  machineIdentifier?: string;
  plexWebUrl?: string;
  plexIosDeepLink?: string;
}

export interface SeasonCoverageItem {
  seasonNumber: number;
  state: 'available_on_plex' | 'partially_available' | 'requested_or_monitored' | 'not_requested';
  plexEpisodeCount: number;
  sonarrEpisodeFileCount: number;
  totalEpisodeCount: number;
  monitoredInSonarr: boolean;
  requestedInOverseerr: boolean;
  availableOnPlexServers: string[];
}

export interface MediaEvidence {
  /** 1. Identité canonique & Métadonnées d'aide au choix */
  identity: {
    mediaType: MediaType;
    tmdbId: number;
    tvdbId: number | null;
    imdbId: string | null;
    titleFr: string;
    originalTitle: string;
    year: number | null;
    overviewFr: string | null;
    posterUrl: string | null;
    genres: string[];
    runtimeMinutes: number | null;
    directorOrCreator: string | null;
    topCast: string[];
    ratings: {
      imdbOrAudienceRating: number | null;
      tmdbVoteAverage: number | null;
      criticRating: number | null;
    };
    releaseDates: {
      inCinemas: string | null;
      digitalRelease: string | null;
      physicalRelease: string | null;
      estimatedVodOrDvdDate: string | null;
      isEstimatedDate: boolean;
      nextAiring: string | null;
    };
  };

  /** 2. Présence réelle au catalogue Plex multi-serveurs */
  catalogPresence: {
    state: 'available_now' | 'partially_available' | 'not_in_catalog' | 'unknown';
    serversQueried: string[];
    matchedItems: PlexMatchedItem[];
    availableServers?: string[];
    userAccessibleServers?: string[];
    userAllowedServers?: string[];
    accessibleToCurrentUser?: boolean;
  };

  /** 3. État de la demande dans Overseerr & origine d'ajout */
  requestState: {
    state: 'not_requested' | 'pending_approval' | 'approved_processing' | 'available' | 'declined' | 'unknown';
    requestId: number | null;
    requestedAt: string | null;
    requestedByCurrentUser: boolean;
    requestedByDisplayName: string | null;
    sourceOrigin?: 'overseerr_user' | 'auto_list' | null;
  };

  /** 4. Pipeline d'acquisition dans Radarr / Sonarr */
  acquisitionPipeline: {
    state:
      | 'not_in_arr'
      | 'unmonitored_no_file'
      | 'monitored_waiting_release'
      | 'monitored_searching'
      | 'downloading'
      | 'imported_on_disk'
      | 'download_warning_or_error'
      | 'unknown';
    externalServiceId: number | null;
    monitored: boolean | null;
    hasFile: boolean | null;
    addedAt?: string | null;
    estimatedAvailabilityDate: string | null;
    estimatedAvailabilityReason: 'digital_release' | 'physical_release' | 'cinema_release' | 'estimated_from_cinema' | 'next_airing' | null;
    queueProgressPercent: number | null;
    queueTimeleft: string | null;
  };

  /** 5. Couverture par saison et épisode (Séries TV) */
  episodeCoverage: {
    totalSeasons: number;
    seasons: SeasonCoverageItem[];
  } | null;

  /** 6. Disponibilité sur les indexeurs (Prowlarr — uniquement à la demande, max 1/tour) */
  indexerSearch: {
    queried: boolean;
    state: 'not_queried' | 'releases_found' | 'no_release_found' | 'indexer_error';
    matchingReleasesCount: number;
    bestQualityHint: string | null;
    activeIndexersCount: number | null;
  };

  /** 7. Éligibilité à une action pour l'utilisateur courant */
  actionability: {
    canRequestNow: boolean;
    requestableSeasons: number[];
    blockReason:
      | null
      | 'ALREADY_AVAILABLE_ON_PLEX'
      | 'ALREADY_REQUESTED_OR_MONITORED'
      | 'UNLINKED_PLEX_USER'
      | 'QUOTA_EXCEEDED'
      | 'READ_ONLY_MODE_G3';
    userFriendlyStatusLabel: string;
    userFriendlyExplanationFr: string;
    statusTone: 'emerald' | 'sky' | 'indigo' | 'amber' | 'slate' | 'rose';
  };

  /** 8. Provenance et traçabilité */
  provenance: ProvenanceEntry[];
}

export interface PlexSharedUserDTO {
  plexUserId: number;
  username: string;
  title: string;
  email: string;
  thumb: string | null;
  overseerrUserId: number | null;
  allServerNames: string[];
  askarrServerNames: string[];
  inCloudflareAccess: boolean;
  tracearrActivity?: {
    recentPlaysCount: number;
    lastWatchedTitle: string;
    lastWatchedAt: string;
    lastServerName: string;
    lastDevice: string | null;
  } | null;
}

export interface SmtpSettingsDTO {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  hasSmtpPassword: boolean;
  smtpConfigured: boolean;
  senderName: string;
  publicAppUrl: string;
}

export interface UserSessionInfo {
  email: string;
  role: UserRole;
  authSource: 'cloudflare_jwt' | 'dev_header';
  overseerr: {
    linked: boolean;
    overseerrUserId: number | null;
    plexUsername: string | null;
    userType: number | null;
  };
  plexAccess?: {
    plexUserId: number | null;
    plexUsername: string | null;
    allServerNames: string[];
    askarrServerNames: string[];
    configuredServerNames: string[];
  };
  aiMode: 'active' | 'direct_search_fallback';
}

export interface PreparedActionDTO {
  actionId: string;
  actionType: 'OVERSEERR_REQUEST_MOVIE' | 'OVERSEERR_REQUEST_TV';
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  year: number | null;
  seasons?: number[];
  summaryFr: string;
  expiresAt: string;
  status: 'PENDING' | 'EXECUTED' | 'EXPIRED' | 'SUPERSEDED' | 'FAILED';
}

export interface ApiTraceEntryDTO {
  id: string;
  timestamp: string;
  service: 'plex' | 'overseerr' | 'radarr' | 'sonarr' | 'prowlarr' | 'tracearr' | 'deepseek' | 'cloudflare' | 'smtp' | 'other';
  serverLabel?: string;
  method: string;
  url: string;
  statusCode: number | null;
  ok: boolean;
  latencyMs: number;
  requestSummary?: string;
  responseSummary?: string;
  error?: string;
}

export interface DeepSeekBalanceDTO {
  available: boolean;
  currency: string;
  totalBalance: string;
  toppedUpBalance: string;
  grantedBalance: string;
  checkedAt: string;
  error?: string;
}

export type LlmProviderId = 'deepseek' | 'gemini' | 'groq' | 'mistral' | 'openrouter';
export type LlmRoutingMode = 'manual' | 'priority_cascade' | 'load_balance';

export interface LlmProviderStatusDTO {
  id: LlmProviderId;
  label: string;
  baseUrl: string;
  model: string;
  isFree: boolean;
  configured: boolean;
  keyPortalUrl: string;
  descriptionFr: string;
}

export interface LlmModelBenchmarkDTO {
  model: string;
  callsCount: number;
  avgLatencyMs: number;
  totalTokens: number;
  totalCostUsd: number;
}

export interface LlmTurnUsageDTO {
  providerId?: LlmProviderId;
  providerLabel?: string;
  model?: string;
  isFreeProvider?: boolean;
  failoverFrom?: string;
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  toolRounds: number;
  latencyMs: number;
}

export interface LlmUsageCallEntryDTO {
  id: number;
  timestamp: string;
  userEmail: string;
  model: string;
  toolRounds: number;
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  fallbackUsed: boolean;
}

export interface AdminEditableSettingsDTO {
  adminEmailsRaw: string;
  cfAccessTeamDomain: string;
  cfAccessAud: string;
  plexServersRaw: string;
  plexTokenMasked: string;
  plexTokenConfigured?: boolean;
  overseerrBaseUrl: string;
  overseerrApiKeyMasked: string;
  overseerrApiKeyConfigured?: boolean;
  radarrBaseUrl: string;
  radarrApiKeyMasked: string;
  radarrApiKeyConfigured?: boolean;
  sonarrBaseUrl: string;
  sonarrApiKeyMasked: string;
  sonarrApiKeyConfigured?: boolean;
  prowlarrBaseUrl: string;
  prowlarrApiKeyMasked: string;
  prowlarrApiKeyConfigured?: boolean;
  tracearrBaseUrl?: string;
  tracearrApiKeyMasked?: string;
  tracearrApiKeyConfigured?: boolean;
  cloudflareAccountId: string;
  cloudflareApiTokenMasked: string;
  cloudflareApiTokenConfigured?: boolean;
  cfAccessTargetMode: 'policy' | 'group';
  cfAccessTargetId: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekApiKeyMasked: string;
  deepseekApiKeyConfigured?: boolean;
  llmRoutingMode?: LlmRoutingMode;
  llmManualProvider?: LlmProviderId;
  geminiModel?: string;
  geminiApiKeyMasked?: string;
  geminiApiKeyConfigured?: boolean;
  groqModel?: string;
  groqApiKeyMasked?: string;
  groqApiKeyConfigured?: boolean;
  mistralModel?: string;
  mistralApiKeyMasked?: string;
  mistralApiKeyConfigured?: boolean;
  openrouterModel?: string;
  openrouterApiKeyMasked?: string;
  openrouterApiKeyConfigured?: boolean;
  aiDailyTokenCap: number;
  aiMonthlyBudgetUsd: number;
}

export interface AdminSettingsDTO {
  nodeEnv: string;
  port: number;
  editableValues?: AdminEditableSettingsDTO;
  auth: {
    cfAccessTeamDomain: string;
    cfAccessAudConfigured: boolean;
    cfAccessAudPreview: string;
    allowDevAuthHeader: boolean;
    adminEmailsCount: number;
  };
  smtp?: SmtpSettingsDTO;
  connectors: {
    plexServers: Array<{ name: string; baseUrl: string; configured: boolean }>;
    overseerr: { baseUrl: string; configured: boolean };
    radarr: { baseUrl: string; configured: boolean };
    sonarr: { baseUrl: string; configured: boolean };
    prowlarr: { baseUrl: string; configured: boolean };
    tracearr?: { baseUrl: string; configured: boolean };
    cloudflareAccess: {
      accountIdConfigured: boolean;
      apiTokenConfigured: boolean;
      targetMode: 'policy' | 'group';
      targetId: string;
    };
    deepseek: {
      baseUrl: string;
      model: string;
      configured: boolean;
      dailyTokenCap: number;
      monthlyBudgetUsd: number;
      pricing?: {
        inputCacheMissPer1M: number;
        inputCacheHitPer1M: number;
        outputPer1M: number;
      };
      accountBalance?: DeepSeekBalanceDTO;
      usageStats?: {
        dailyTokensUsed: number;
        monthlyCostUsd: number;
        totalCallsCount: number;
        averageCostPerRequestUsd: number;
        averageTokensPerRequest: number;
        lastRequestCostUsd: number | null;
        cacheHitRatioPercent: number;
        isOverQuota: boolean;
        recentCalls: LlmUsageCallEntryDTO[];
        modelBenchmarks?: LlmModelBenchmarkDTO[];
      };
    };
    llmRouter?: {
      routingMode: LlmRoutingMode;
      manualProvider: LlmProviderId;
      activeProvidersCount: number;
      providers: LlmProviderStatusDTO[];
    };
  };
}

export interface ChatMessageDTO {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mediaCards?: MediaEvidence[];
  preparedAction?: PreparedActionDTO;
  provenance?: ProvenanceEntry[];
  apiTraces?: ApiTraceEntryDTO[];
  llmUsage?: LlmTurnUsageDTO;
  feedback?: {
    rating: number;
    quickTag?: string | null;
    comment?: string | null;
  };
  createdAt: string;
}

export interface ResponseFeedbackDTO {
  id: number;
  createdAt: string;
  userEmail: string;
  conversationId: string | null;
  messageId: string;
  rating: number;
  quickTag: string | null;
  comment: string | null;
  userPrompt: string;
  assistantReply: string;
  mediaCardsSummary: Array<{
    tmdbId: number;
    mediaType: string;
    titleFr: string;
    year: number | null;
    plexState: string;
  }>;
}

export interface FeedbackStatsDTO {
  totalCount: number;
  averageRating: number;
  lowRatingCount: number;
  items: ResponseFeedbackDTO[];
}

export type QaReviewStatus = 'unreviewed' | 'to_fix' | 'validated';

export interface AdminInteractionEntryDTO {
  messageId: string;
  conversationId: string;
  userEmail: string;
  createdAt: string;
  userPrompt: string;
  assistantReply: string;
  mediaCardsCount: number;
  mediaCardsSummary: Array<{
    tmdbId: number;
    mediaType: string;
    titleFr: string;
    year: number | null;
    plexState: string;
  }>;
  autoFlagReason: string | null;
  reviewStatus: QaReviewStatus;
  adminNote: string | null;
  reviewedAt: string | null;
  feedback: {
    id: number;
    rating: number;
    quickTag: string | null;
    comment: string | null;
  } | null;
}

export interface AdminInteractionsJournalDTO {
  totalInteractions: number;
  last7DaysCount: number;
  flaggedOrToFixCount: number;
  validatedCount: number;
  ratedCount: number;
  averageRating: number;
  items: AdminInteractionEntryDTO[];
}
