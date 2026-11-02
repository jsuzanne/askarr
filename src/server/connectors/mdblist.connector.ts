import type { MediaType } from '../../shared/types.js';
import { logger } from '../utils/logger.js';
import {
  toMdblistRatingScale100,
  type MdblistRatingSource,
  type NormalizedDiscoveryCriteria
} from './mdblist-criteria.schema.js';

export type MdblistErrorCode =
  | 'NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_TIER'
  | 'RATE_LIMITED'
  | 'UPSTREAM_BUILDING'
  | 'TIMEOUT'
  | 'UPSTREAM_ERROR';

export class MdblistApiError extends Error {
  public readonly code: MdblistErrorCode;
  public readonly statusCode: number | null;
  public readonly retryAfterSeconds: number | null;

  constructor(
    code: MdblistErrorCode,
    message: string,
    options?: { statusCode?: number | null; retryAfterSeconds?: number | null }
  ) {
    super(message);
    this.name = 'MdblistApiError';
    this.code = code;
    this.statusCode = options?.statusCode ?? null;
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
  }
}

export interface MdblistExtractedRating {
  source: MdblistRatingSource;
  /** Note dans l'échelle native de la source (ex: 8.2 sur 10 pour IMDb, 85 sur 100 pour Metacritic, 4.1 sur 5 pour Letterboxd) */
  score: number | null;
  /** Note normalisée sur 0–100 fournie par MDBList */
  value100: number | null;
  votes: number | null;
}

export interface MdblistCatalogCandidate {
  tmdbId: number | null;
  imdbId: string | null;
  tvdbId: number | null;
  mdblistId: string | null;
  mediaType: MediaType;
  title: string;
  year: number | null;
  runtimeMinutes: number | null;
  originalLanguage: string | null;
  genres: string[];
  posterUrl: string | null;
  overview: string | null;
  mdblistScore: number | null;
  ratingsBySource: Partial<Record<MdblistRatingSource, MdblistExtractedRating>>;
}

export interface MdblistCatalogSearchResponse {
  candidates: MdblistCatalogCandidate[];
  nextCursor: string | null;
  hasMore: boolean;
  totalResults: number | null;
  fromCache: boolean;
  rateLimitRemaining: number | null;
}

export interface MdblistConnectorOptions {
  fetchImpl?: typeof fetch;
  cacheTtlSeconds?: number;
  maxCacheEntries?: number;
  requestTimeoutMs?: number;
  maxConcurrentRequests?: number;
  maxRetryAfterWaitMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

function mapCatalogSortField(criteria: NormalizedDiscoveryCriteria): string {
  if (criteria.sort && criteria.sort !== 'score') {
    if (criteria.sort === 'votes') return 'imdbvotes';
    if (criteria.sort === 'tmdbrating') return 'tmdbpopular';
    if (criteria.sort === 'runtime') return 'score';
    return criteria.sort;
  }
  switch (criteria.ratingSource) {
    case 'imdb':
      return 'imdbrating';
    case 'metacritic':
      return 'metacritic';
    case 'rotten_tomatoes':
      return 'rtomatoes';
    case 'popcorn':
      return 'rtaudience';
    case 'letterboxd':
      return 'letterrating';
    case 'tmdb':
      return 'tmdbpopular';
    default:
      return 'score';
  }
}

function mapMdblistRatingSourceName(rawSource: string): MdblistRatingSource | null {
  const norm = rawSource.trim().toLowerCase();
  if (norm === 'imdb') return 'imdb';
  if (norm === 'tmdb') return 'tmdb';
  if (norm === 'mdblist') return 'mdblist';
  if (norm === 'metacritic') return 'metacritic';
  if (norm === 'tomatoes' || norm === 'rotten_tomatoes' || norm === 'rottentomatoes') {
    return 'rotten_tomatoes';
  }
  if (
    norm === 'popcorn' ||
    norm === 'tomatoesaudience' ||
    norm === 'rotten_tomatoes_audience'
  ) {
    return 'popcorn';
  }
  if (norm === 'letterboxd') return 'letterboxd';
  if (norm === 'mal' || norm === 'myanimelist') return 'mal';
  return null;
}

function parseRetryAfterSeconds(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  const parsedInt = Number.parseInt(trimmed, 10);
  if (Number.isFinite(parsedInt) && parsedInt >= 0) {
    return parsedInt;
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    const diffSec = Math.ceil((parsedDate - Date.now()) / 1000);
    return Math.max(0, diffSec);
  }
  return null;
}

function redactApiKeyFromText(text: string): string {
  return text.replace(/([?&]apikey=)[^&\s]+/gi, '$1***REDACTED***');
}

function normalizeCandidateMediaType(rawType: unknown, fallback: MediaType): MediaType | null {
  if (typeof rawType !== 'string' || !rawType.trim()) {
    return fallback;
  }
  const lower = rawType.trim().toLowerCase();
  if (lower === 'movie' || lower === 'movies') return 'movie';
  if (lower === 'show' || lower === 'shows' || lower === 'tv' || lower === 'series') return 'tv';
  return null;
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim().length > 0) {
    const num = Number(val);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function toPositiveInt(val: unknown): number | null {
  const num = toFiniteNumber(val);
  if (num === null || num <= 0) return null;
  return Math.trunc(num);
}

/**
 * Connecteur serveur strictement en lecture seule pour l'API MDBList.
 * - N'effectue AUCUNE création, modification ou suppression de liste MDBList.
 * - Maintient un cache borné (LRU/TTL) indexé par critères normalisés.
 * - Limite la concurrence et gère explicitement 202, 401/403, 429 (Retry-After) et les timeouts.
 */
export class MdblistConnector {
  private baseUrl: string;
  private apiKey: string;
  private cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly requestTimeoutMs: number;
  private readonly maxConcurrentRequests: number;
  private readonly maxRetryAfterWaitMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;

  private readonly catalogCache = new Map<string, CacheEntry<MdblistCatalogSearchResponse>>();
  private readonly detailCache = new Map<string, CacheEntry<MdblistCatalogCandidate | null>>();

  private activeRequests = 0;
  private readonly requestQueue: Array<() => void> = [];

  constructor(
    baseUrl: string = 'https://api.mdblist.com',
    apiKey: string = '',
    options: MdblistConnectorOptions = {}
  ) {
    this.baseUrl = (baseUrl || 'https://api.mdblist.com').replace(/\/$/, '');
    this.apiKey = (apiKey || '').trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheTtlMs = Math.max(5_000, (options.cacheTtlSeconds ?? 900) * 1000);
    this.maxCacheEntries = Math.max(10, options.maxCacheEntries ?? 100);
    this.requestTimeoutMs = Math.max(1_000, options.requestTimeoutMs ?? 9_000);
    this.maxConcurrentRequests = Math.max(1, options.maxConcurrentRequests ?? 3);
    this.maxRetryAfterWaitMs = Math.max(0, options.maxRetryAfterWaitMs ?? 5_000);
    this.sleepFn =
      options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  public isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey && this.apiKey.trim().length > 0);
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public updateCredentials(baseUrl: string, apiKey: string, cacheTtlSeconds?: number): void {
    this.baseUrl = (baseUrl || 'https://api.mdblist.com').replace(/\/$/, '');
    this.apiKey = (apiKey || '').trim();
    if (cacheTtlSeconds !== undefined && Number.isFinite(cacheTtlSeconds)) {
      this.cacheTtlMs = Math.max(5_000, cacheTtlSeconds * 1000);
    }
    this.clearCache();
  }

  public clearCache(): void {
    this.catalogCache.clear();
    this.detailCache.clear();
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < this.maxConcurrentRequests) {
      this.activeRequests += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.requestQueue.push(() => {
        this.activeRequests += 1;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const next = this.requestQueue.shift();
    if (next) {
      next();
    }
  }

  private getFromMapCache<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
    const entry = map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      map.delete(key);
      return undefined;
    }
    // Refresh LRU order
    map.delete(key);
    map.set(key, entry);
    return entry.value;
  }

  private setInMapCache<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
    if (map.has(key)) {
      map.delete(key);
    } else if (map.size >= this.maxCacheEntries) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) {
        map.delete(oldestKey);
      }
    }
    map.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs
    });
  }

  /**
   * Construit une clé de cache déterministe à partir des critères normalisés et du curseur.
   */
  public buildCatalogCacheKey(
    criteria: NormalizedDiscoveryCriteria,
    cursor: string | null,
    pageLimit: number
  ): string {
    return JSON.stringify({
      mediaType: criteria.mediaType,
      genres: [...criteria.genres].sort(),
      genreOperator: criteria.genreOperator,
      yearFrom: criteria.yearFrom,
      yearTo: criteria.yearTo,
      ratingSource: criteria.ratingSource,
      minRating: criteria.minRating,
      maxRating: criteria.maxRating,
      ratingComparison: criteria.ratingComparison,
      maxRatingComparison: criteria.maxRatingComparison,
      minVotes: criteria.minVotes,
      minRuntimeMinutes: criteria.minRuntimeMinutes,
      maxRuntimeMinutes: criteria.maxRuntimeMinutes,
      minRuntimeComparison: criteria.minRuntimeComparison,
      maxRuntimeComparison: criteria.maxRuntimeComparison,
      originalLanguage: criteria.originalLanguage,
      sort: criteria.sort,
      order: criteria.order,
      cursor: cursor || null,
      pageLimit
    });
  }

  /**
   * Vérifie l'état du compte MDBList via `GET /user` sans exposer la clé API.
   */
  public async checkHealth(): Promise<{
    ok: boolean;
    latencyMs: number;
    patronStatus?: string | null;
    requestsRemaining?: number | null;
    error?: string;
  }> {
    if (!this.isConfigured()) {
      return { ok: false, latencyMs: 0, error: 'Non configuré (clé API MDBList absente)' };
    }
    const start = Date.now();
    try {
      const { data, headers } = await this.requestJson<Record<string, unknown>>('/user', {});
      const remainingHeader = headers.get('x-ratelimit-remaining');
      let requestsRemaining = remainingHeader ? Number.parseInt(remainingHeader, 10) : null;
      if (requestsRemaining === null || !Number.isFinite(requestsRemaining)) {
        const apiRequestsLimit = toFiniteNumber(data.api_requests);
        const apiRequestsUsed = toFiniteNumber(data.api_requests_count);
        if (apiRequestsLimit !== null && apiRequestsUsed !== null) {
          requestsRemaining = Math.max(0, Math.trunc(apiRequestsLimit - apiRequestsUsed));
        }
      }
      const patronStatus =
        typeof data.patron_status === 'string'
          ? data.patron_status
          : typeof data.is_supporter === 'boolean'
            ? data.is_supporter
              ? 'supporter'
              : 'free'
            : null;
      return {
        ok: true,
        latencyMs: Date.now() - start,
        patronStatus,
        requestsRemaining:
          requestsRemaining !== null && Number.isFinite(requestsRemaining)
            ? requestsRemaining
            : null
      };
    } catch (error) {
      const safeMsg = redactApiKeyFromText((error as Error).message || 'Erreur MDBList');
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: safeMsg
      };
    }
  }

  /**
   * Interroge le catalogue dynamique MDBList (`GET /catalog/movie` ou `GET /catalog/show`)
   * avec les paramètres exacts du schéma OpenAPI MDBList (`genre`, `genre_mode`, `year_min`,
   * `year_max`, `runtime_min`, `runtime_max`, `language`, `score_min`, `score_max`, `sort`,
   * `sort_order`, `append_to_response=genres,poster,description,ratings_all`), gestion de
   * `202 Accepted` / `429 Retry-After` et cache borné.
   */
  public async searchCatalog(
    criteria: NormalizedDiscoveryCriteria,
    options?: { cursor?: string | null; pageLimit?: number } | null
  ): Promise<MdblistCatalogSearchResponse> {
    if (!this.isConfigured()) {
      throw new MdblistApiError(
        'NOT_CONFIGURED',
        "Le connecteur MDBList n'est pas configuré (MDBLIST_API_KEY manquante côté serveur)."
      );
    }

    const cursor = options?.cursor ?? null;
    const pageLimit = Math.max(
      1,
      Math.min(100, options?.pageLimit ?? Math.max(25, criteria.limit * 5))
    );
    const cacheKey = this.buildCatalogCacheKey(criteria, cursor, pageLimit);

    const cached = this.getFromMapCache(this.catalogCache, cacheKey);
    if (cached) {
      return {
        ...cached,
        fromCache: true
      };
    }

    const endpointPath = criteria.mediaType === 'tv' ? '/catalog/show' : '/catalog/movie';
    const catalogSort = mapCatalogSortField(criteria);
    const queryParams: Record<string, string | number | string[]> = {
      limit: pageLimit,
      sort: catalogSort,
      sort_order: criteria.order,
      append_to_response: 'genres,poster,description,ratings_all'
    };

    if (cursor) {
      queryParams.cursor = cursor;
    }

    if (criteria.genres.length > 0) {
      queryParams.genre = criteria.genres;
      queryParams.genre_mode = criteria.genreOperator;
    }

    if (criteria.yearFrom !== null) {
      queryParams.year_min = criteria.yearFrom;
    }
    if (criteria.yearTo !== null) {
      queryParams.year_max = criteria.yearTo;
    }

    if (criteria.ratingSource === 'mdblist') {
      if (criteria.minRating !== null) {
        queryParams.score_min = toMdblistRatingScale100(
          criteria.minRating,
          'mdblist',
          criteria.ratingComparison
        );
      } else if (criteria.sort === 'score' && criteria.order === 'desc') {
        // Plancher qualité par défaut lors d'un tri par score composite descendant
        queryParams.score_min = 60;
      }
      if (criteria.maxRating !== null) {
        queryParams.score_max = toMdblistRatingScale100(
          criteria.maxRating,
          'mdblist',
          criteria.maxRatingComparison
        );
      }
    } else if (criteria.ratingSource && criteria.minRating !== null) {
      // Sur /catalog/{type}, un tri direct par note source (ex: sort=imdbrating) sans score_min
      // suffisant remonte des entrées régionales/non-indexées avec peu de consensus critique.
      // On applique un plancher qualitatif sur score_min tout en vérifiant
      // strictement la vraie note de la source demandée (ex: IMDb > 8) après réception.
      const scaledMin = toMdblistRatingScale100(
        criteria.minRating,
        criteria.ratingSource,
        criteria.ratingComparison
      );
      queryParams.score_min = Math.max(50, Math.min(72, scaledMin - 10));
    }

    if (criteria.minRuntimeMinutes !== null) {
      queryParams.runtime_min =
        criteria.minRuntimeComparison === 'gt'
          ? criteria.minRuntimeMinutes + 1
          : criteria.minRuntimeMinutes;
    } else if (
      criteria.mediaType === 'movie' &&
      (criteria.maxRuntimeMinutes === null || criteria.maxRuntimeMinutes >= 45)
    ) {
      // Exclure les courts-métrages (< 45 min) lorsqu'on cherche des longs-métrages
      queryParams.runtime_min = 45;
    }

    if (criteria.maxRuntimeMinutes !== null) {
      queryParams.runtime_max =
        criteria.maxRuntimeComparison === 'lt'
          ? Math.max(1, criteria.maxRuntimeMinutes - 1)
          : criteria.maxRuntimeMinutes;
    }

    if (criteria.originalLanguage) {
      queryParams.language = criteria.originalLanguage;
    }

    const { data, headers } = await this.requestJson<unknown>(endpointPath, queryParams);
    const parsed = this.parseCatalogPayload(data, criteria.mediaType);

    const remainingHeader = headers.get('x-ratelimit-remaining');
    const headerRemaining = remainingHeader ? Number.parseInt(remainingHeader, 10) : null;
    const rateLimitRemaining =
      headerRemaining !== null && Number.isFinite(headerRemaining)
        ? headerRemaining
        : parsed.quotaRemaining;

    const response: MdblistCatalogSearchResponse = {
      candidates: parsed.candidates,
      nextCursor: parsed.nextCursor,
      hasMore: parsed.hasMore,
      totalResults: parsed.totalResults,
      fromCache: false,
      rateLimitRemaining
    };

    this.setInMapCache(this.catalogCache, cacheKey, response);
    return response;
  }

  /**
   * Récupère les détails MDBList d'un média par son identifiant TMDb (`GET /tmdb/{movie|show}/{tmdbId}`)
   * pour enrichir ou vérifier les notes par source (ex: IMDb, Letterboxd, Metacritic) et la durée.
   */
  public async getMediaDetailByTmdbId(
    tmdbId: number,
    mediaType: MediaType
  ): Promise<MdblistCatalogCandidate | null> {
    if (!this.isConfigured() || !Number.isFinite(tmdbId) || tmdbId <= 0) {
      return null;
    }
    const cacheKey = `tmdb:${mediaType}:${tmdbId}`;
    const cached = this.getFromMapCache(this.detailCache, cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const endpointType = mediaType === 'tv' ? 'show' : 'movie';
    try {
      const { data } = await this.requestJson<Record<string, unknown>>(
        `/tmdb/${endpointType}/${tmdbId}`,
        {}
      );
      const candidate = this.parseCandidateItem(data, mediaType);
      this.setInMapCache(this.detailCache, cacheKey, candidate);
      return candidate;
    } catch (error) {
      if (error instanceof MdblistApiError && error.statusCode === 404) {
        this.setInMapCache(this.detailCache, cacheKey, null);
        return null;
      }
      logger.warn(
        {
          tmdbId,
          mediaType,
          err: redactApiKeyFromText((error as Error).message || 'Erreur détail MDBList')
        },
        'Failed to fetch MDBList media detail by TMDb ID'
      );
      return null;
    }
  }

  /**
   * Récupère les détails MDBList d'un média par son identifiant IMDb (`GET /imdb/{imdbId}`)
   * tout en vérifiant strictement la cohérence du type de média (`movie` vs `tv`).
   */
  public async getMediaDetailByImdbId(
    imdbId: string,
    expectedMediaType: MediaType
  ): Promise<MdblistCatalogCandidate | null> {
    const cleanImdb = (imdbId || '').trim();
    if (!this.isConfigured() || !/^tt\d+$/i.test(cleanImdb)) {
      return null;
    }
    const cacheKey = `imdb:${expectedMediaType}:${cleanImdb.toLowerCase()}`;
    const cached = this.getFromMapCache(this.detailCache, cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const { data } = await this.requestJson<Record<string, unknown>>(
        `/imdb/${encodeURIComponent(cleanImdb)}`,
        {}
      );
      const candidate = this.parseCandidateItem(data, expectedMediaType);
      this.setInMapCache(this.detailCache, cacheKey, candidate);
      return candidate;
    } catch (error) {
      if (error instanceof MdblistApiError && error.statusCode === 404) {
        this.setInMapCache(this.detailCache, cacheKey, null);
        return null;
      }
      logger.warn(
        {
          imdbId: cleanImdb,
          expectedMediaType,
          err: redactApiKeyFromText((error as Error).message || 'Erreur détail MDBList IMDb')
        },
        'Failed to fetch MDBList media detail by IMDb ID'
      );
      return null;
    }
  }

  private async requestJson<T>(
    path: string,
    queryParams: Record<string, string | number | string[]>,
    attempt: number = 0
  ): Promise<{ data: T; headers: Headers }> {
    await this.acquireSlot();
    try {
      const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
      url.searchParams.set('apikey', this.apiKey);

      for (const [key, value] of Object.entries(queryParams)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null && String(item).length > 0) {
              url.searchParams.append(key, String(item));
            }
          }
        } else if (value !== undefined && value !== null && String(value).length > 0) {
          url.searchParams.set(key, String(value));
        }
      }

      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          },
          signal: AbortSignal.timeout(this.requestTimeoutMs)
        });
      } catch (networkErr) {
        const errName = (networkErr as Error)?.name || '';
        const errMsg = redactApiKeyFromText((networkErr as Error)?.message || 'Network error');
        if (errName === 'TimeoutError' || errName === 'AbortError' || /timeout|aborted/i.test(errMsg)) {
          throw new MdblistApiError(
            'TIMEOUT',
            `Délai d'attente dépassé lors de l'appel à MDBList (${this.requestTimeoutMs} ms).`
          );
        }
        throw new MdblistApiError(
          'UPSTREAM_ERROR',
          `Impossible de joindre le service MDBList : ${errMsg}`
        );
      }

      // 202 Accepted : le catalogue MDBList construit son cache à la volée (Retry-After)
      if (response.status === 202) {
        const retryAfterSec = parseRetryAfterSeconds(response.headers.get('retry-after')) ?? 2;
        const waitMs = Math.min(this.maxRetryAfterWaitMs, Math.max(250, retryAfterSec * 1000));
        if (attempt < 1 && waitMs > 0 && retryAfterSec * 1000 <= this.maxRetryAfterWaitMs) {
          this.releaseSlot();
          await this.sleepFn(waitMs);
          return this.requestJson<T>(path, queryParams, attempt + 1);
        }
        throw new MdblistApiError(
          'UPSTREAM_BUILDING',
          'Le catalogue MDBList est en cours de préparation pour ces critères (202 Accepted). Réessaie dans quelques secondes.',
          { statusCode: 202, retryAfterSeconds: retryAfterSec }
        );
      }

      // 429 Too Many Requests : respect strict de Retry-After et aucun retry illimité
      if (response.status === 429) {
        const retryAfterSec = parseRetryAfterSeconds(response.headers.get('retry-after'));
        const waitMs =
          retryAfterSec !== null ? retryAfterSec * 1000 : 1_500;
        if (attempt < 1 && waitMs <= this.maxRetryAfterWaitMs) {
          this.releaseSlot();
          await this.sleepFn(Math.max(200, waitMs));
          return this.requestJson<T>(path, queryParams, attempt + 1);
        }
        throw new MdblistApiError(
          'RATE_LIMITED',
          retryAfterSec !== null
            ? `Quota ou limite de débit MDBList atteint (429). Réessaie après ${retryAfterSec} s.`
            : 'Quota ou limite de débit MDBList atteint (429 Too Many Requests).',
          { statusCode: 429, retryAfterSeconds: retryAfterSec }
        );
      }

      if (response.status === 401) {
        throw new MdblistApiError(
          'UNAUTHORIZED',
          'Clé API MDBList invalide ou non autorisée (401).',
          { statusCode: 401 }
        );
      }

      if (response.status === 403) {
        throw new MdblistApiError(
          'FORBIDDEN_TIER',
          "Accès refusé par MDBList (403) : cette fonctionnalité de filtrage du catalogue nécessite un niveau d'abonnement supérieur ou des droits Supporter.",
          { statusCode: 403 }
        );
      }

      if (!response.ok) {
        throw new MdblistApiError(
          'UPSTREAM_ERROR',
          `Erreur HTTP ${response.status} renvoyée par MDBList.`,
          { statusCode: response.status }
        );
      }

      const data = (await response.json()) as T;
      return { data, headers: response.headers };
    } finally {
      if (this.activeRequests > 0) {
        this.releaseSlot();
      }
    }
  }

  private parseCatalogPayload(
    payload: unknown,
    expectedMediaType: MediaType
  ): {
    candidates: MdblistCatalogCandidate[];
    nextCursor: string | null;
    hasMore: boolean;
    totalResults: number | null;
    quotaRemaining: number | null;
  } {
    let rawItems: unknown[] = [];
    let nextCursor: string | null = null;
    let hasMore = false;
    let totalResults: number | null = null;
    let quotaRemaining: number | null = null;

    if (Array.isArray(payload)) {
      rawItems = payload;
    } else if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>;
      if (Array.isArray(obj.items)) {
        rawItems = obj.items;
      } else if (Array.isArray(obj.results)) {
        rawItems = obj.results;
      } else if (Array.isArray(obj.movies)) {
        rawItems = obj.movies;
      } else if (Array.isArray(obj.shows)) {
        rawItems = obj.shows;
      } else if (Array.isArray(obj.data)) {
        rawItems = obj.data;
      }

      const paginationObj =
        obj.pagination && typeof obj.pagination === 'object'
          ? (obj.pagination as Record<string, unknown>)
          : null;

      const rawCursor =
        paginationObj?.next_cursor ??
        paginationObj?.nextCursor ??
        obj.next_cursor ??
        obj.nextCursor;
      if (typeof rawCursor === 'string' && rawCursor.trim().length > 0) {
        nextCursor = rawCursor.trim();
      }

      const rawHasMore =
        paginationObj?.has_more ?? paginationObj?.hasMore ?? obj.has_more ?? obj.hasMore;
      if (typeof rawHasMore === 'boolean') {
        hasMore = rawHasMore;
      } else {
        hasMore = Boolean(nextCursor);
      }

      totalResults = toFiniteNumber(
        paginationObj?.total_results ??
          paginationObj?.total ??
          obj.total_results ??
          obj.total ??
          obj.count
      );

      const quotaObj =
        obj.quota && typeof obj.quota === 'object'
          ? (obj.quota as Record<string, unknown>)
          : null;
      if (quotaObj) {
        const rem = toFiniteNumber(quotaObj.remaining);
        if (rem !== null && rem >= 0) {
          quotaRemaining = Math.trunc(rem);
        }
      }
    }

    const candidates: MdblistCatalogCandidate[] = [];
    for (const rawItem of rawItems) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const parsed = this.parseCandidateItem(rawItem as Record<string, unknown>, expectedMediaType);
      if (parsed) {
        candidates.push(parsed);
      }
    }

    return {
      candidates,
      nextCursor,
      hasMore,
      totalResults,
      quotaRemaining
    };
  }

  private parseCandidateItem(
    item: Record<string, unknown>,
    expectedMediaType: MediaType
  ): MdblistCatalogCandidate | null {
    // Vérification stricte du type de média (les identifiants de films et séries ne sont pas interchangeables)
    const candidateType = normalizeCandidateMediaType(
      item.type ?? item.mediatype ?? item.media_type,
      expectedMediaType
    );
    if (!candidateType || candidateType !== expectedMediaType) {
      return null;
    }

    const idsObj =
      item.ids && typeof item.ids === 'object' ? (item.ids as Record<string, unknown>) : null;

    const tmdbId = toPositiveInt(
      item.tmdbid ?? item.tmdb_id ?? idsObj?.tmdb ?? idsObj?.tmdbid ?? item.id
    );
    const rawImdb = item.imdbid ?? item.imdb_id ?? idsObj?.imdb ?? idsObj?.imdbid;
    const imdbId =
      typeof rawImdb === 'string' && /^tt\d+$/i.test(rawImdb.trim())
        ? rawImdb.trim()
        : null;
    const tvdbId = toPositiveInt(item.tvdbid ?? item.tvdb_id ?? idsObj?.tvdb ?? idsObj?.tvdbid);
    const rawMdblistId = item.mdblist_id ?? idsObj?.mdblist ?? (item.tmdbid ? null : item.id);
    const mdblistId =
      rawMdblistId !== undefined && rawMdblistId !== null && String(rawMdblistId).trim().length > 0
        ? String(rawMdblistId).trim()
        : null;

    // On exige au moins un identifiant stable TMDb ou IMDb pour le rapprochement d'identité
    if (tmdbId === null && imdbId === null) {
      return null;
    }

    const title = String(item.title ?? item.name ?? '').trim();
    if (!title) {
      return null;
    }

    const year = toPositiveInt(item.year ?? item.release_year);
    const runtimeMinutes = toPositiveInt(item.runtime);

    let originalLanguage: string | null = null;
    if (typeof item.language === 'string' && item.language.trim().length > 0) {
      originalLanguage = item.language.trim().toLowerCase();
    } else if (typeof item.original_language === 'string' && item.original_language.trim().length > 0) {
      originalLanguage = item.original_language.trim().toLowerCase();
    } else if (Array.isArray(item.spoken_languages) && item.spoken_languages.length > 0) {
      const firstLang = item.spoken_languages[0];
      if (typeof firstLang === 'string') {
        originalLanguage = firstLang.trim().toLowerCase();
      }
    }

    const genres: string[] = [];
    if (Array.isArray(item.genres)) {
      for (const g of item.genres) {
        if (typeof g === 'string' && g.trim()) {
          genres.push(g.trim().toLowerCase());
        } else if (g && typeof g === 'object') {
          const gObj = g as Record<string, unknown>;
          const gName = gObj.slug ?? gObj.name ?? gObj.title;
          if (typeof gName === 'string' && gName.trim()) {
            genres.push(gName.trim().toLowerCase());
          }
        }
      }
    }

    const posterUrl =
      typeof item.poster === 'string' && item.poster.trim().length > 0
        ? item.poster.trim()
        : null;
    const overview =
      typeof item.description === 'string' && item.description.trim().length > 0
        ? item.description.trim()
        : typeof item.overview === 'string' && item.overview.trim().length > 0
          ? item.overview.trim()
          : null;

    const mdblistScore = toFiniteNumber(item.score ?? item.score_average);

    const ratingsBySource: Partial<Record<MdblistRatingSource, MdblistExtractedRating>> = {};

    if (mdblistScore !== null && mdblistScore > 0) {
      ratingsBySource.mdblist = {
        source: 'mdblist',
        score: mdblistScore,
        value100: mdblistScore,
        votes: null
      };
    }

    // Champs directs éventuels sur l'item catalogue
    const directImdb = toFiniteNumber(item.imdbrating ?? item.imdb_rating);
    const directImdbVotes = toPositiveInt(item.imdbvotes ?? item.imdb_votes);
    if (directImdb !== null && directImdb > 0) {
      const normalizedImdb = directImdb > 10 ? directImdb / 10 : directImdb;
      ratingsBySource.imdb = {
        source: 'imdb',
        score: normalizedImdb,
        value100: Math.round(normalizedImdb * 10),
        votes: directImdbVotes
      };
    }

    const directTmdb = toFiniteNumber(item.tmdbrating ?? item.tmdb_rating);
    const directTmdbVotes = toPositiveInt(item.tmdbvotes ?? item.tmdb_votes);
    if (directTmdb !== null && directTmdb > 0) {
      const normalizedTmdb = directTmdb > 10 ? directTmdb / 10 : directTmdb;
      ratingsBySource.tmdb = {
        source: 'tmdb',
        score: normalizedTmdb,
        value100: Math.round(normalizedTmdb * 10),
        votes: directTmdbVotes
      };
    }

    // Tableau `ratings` ou `ratings_all` (renvoyé par /tmdb/{type}/{id}, /imdb/{id} ou append_to_response=ratings_all)
    const rawRatingsArray = Array.isArray(item.ratings)
      ? item.ratings
      : Array.isArray(item.ratings_all)
        ? item.ratings_all
        : null;
    if (rawRatingsArray) {
      for (const rawRating of rawRatingsArray) {
        if (!rawRating || typeof rawRating !== 'object') continue;
        const rObj = rawRating as Record<string, unknown>;
        const rawSource = typeof rObj.source === 'string' ? rObj.source : '';
        const mappedSource = mapMdblistRatingSourceName(rawSource);
        if (!mappedSource) continue;

        const rawScore = toFiniteNumber(rObj.score);
        const rawValue = toFiniteNumber(rObj.value);
        const votes = toPositiveInt(rObj.votes);

        let nativeScore: number | null = null;
        let value100: number | null = null;

        if (mappedSource === 'imdb' || mappedSource === 'tmdb' || mappedSource === 'mal') {
          // Dans MDBList, `value` est la note native (ex: 8.4) et `score` est sur 100 (ex: 84)
          if (rawValue !== null && rawValue > 0) {
            nativeScore = rawValue > 10 ? rawValue / 10 : rawValue;
          } else if (rawScore !== null && rawScore > 0) {
            nativeScore = rawScore > 10 ? rawScore / 10 : rawScore;
          }
          if (rawScore !== null && rawScore > 0) {
            value100 = rawScore <= 10 ? Math.round(rawScore * 10) : Math.round(rawScore);
          } else if (nativeScore !== null) {
            value100 = Math.round(nativeScore * 10);
          }
        } else if (mappedSource === 'letterboxd') {
          if (rawValue !== null && rawValue > 0) {
            nativeScore = rawValue > 5 ? rawValue / 20 : rawValue;
          } else if (rawScore !== null && rawScore > 0) {
            nativeScore = rawScore > 5 ? rawScore / 20 : rawScore;
          }
          if (rawScore !== null && rawScore > 0) {
            value100 = rawScore <= 5 ? Math.round(rawScore * 20) : Math.round(rawScore);
          } else if (nativeScore !== null) {
            value100 = Math.round(nativeScore * 20);
          }
        } else {
          // Sources sur 100 (mdblist, metacritic, rotten_tomatoes, popcorn)
          const chosen = rawScore !== null && rawScore > 0 ? rawScore : rawValue;
          if (chosen !== null && chosen > 0) {
            nativeScore = chosen;
            value100 = Math.round(chosen);
          }
        }

        if (nativeScore !== null && nativeScore > 0) {
          ratingsBySource[mappedSource] = {
            source: mappedSource,
            score: nativeScore,
            value100,
            votes
          };
        }
      }
    }

    return {
      tmdbId,
      imdbId,
      tvdbId,
      mdblistId,
      mediaType: candidateType,
      title,
      year,
      runtimeMinutes,
      originalLanguage,
      genres,
      posterUrl,
      overview,
      mdblistScore: ratingsBySource.mdblist?.score ?? mdblistScore,
      ratingsBySource
    };
  }
}
