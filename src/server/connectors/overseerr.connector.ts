import type { MediaType } from '../../shared/types.js';

export interface OverseerrSearchCandidate {
  tmdbId: number;
  mediaType: MediaType;
  titleFr: string;
  originalTitle: string;
  year: number | null;
  overviewFr: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  mediaInfoStatus: number | null;
}

export interface OverseerrEnrichedDetail {
  tmdbId: number;
  mediaType: MediaType;
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
  voteAverage: number | null;
  tmdbReleases: {
    inCinemas: string | null;
    digitalRelease: string | null;
    physicalRelease: string | null;
  };
  totalSeasons: number;
  seasonsMeta: Array<{
    seasonNumber: number;
    episodeCount: number;
    overseerrStatus: number | null;
  }>;
  requestInfo: {
    mediaStatus: number | null;
    latestRequestId: number | null;
    latestRequestStatus: number | null;
    requestedAt: string | null;
    requestedByUserId: number | null;
    requestedByEmail: string | null;
    requestedByDisplayName: string | null;
    requestedSeasons: number[];
  };
}

export interface OverseerrUserSummary {
  id: number;
  email: string;
  plexUsername: string | null;
  displayName: string;
  userType: number; // 1 = PLEX USER, 2 = LOCAL USER
  permissions: number;
  requestCount: number;
}

const TMDB_GENRE_MAP_FR: Record<string, number> = {
  action: 28,
  aventure: 12,
  animation: 16,
  comedie: 35,
  comédie: 35,
  crime: 80,
  policier: 80,
  documentaire: 99,
  drame: 18,
  famille: 10751,
  fantastique: 14,
  histoire: 36,
  horreur: 27,
  horror: 27,
  musique: 10402,
  mystere: 9648,
  mystère: 9648,
  romance: 10749,
  'science-fiction': 878,
  'sci-fi': 878,
  sf: 878,
  thriller: 53,
  guerre: 10752,
  western: 37
};

export function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export class OverseerrConnector {
  private usersCache: { expiresAt: number; users: OverseerrUserSummary[] } | null = null;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  public updateConfig(baseUrl?: string, apiKey?: string): void {
    if (typeof baseUrl === 'string' && baseUrl.trim()) {
      this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    }
    if (typeof apiKey === 'string' && apiKey.trim() && !apiKey.includes('••••')) {
      this.apiKey = apiKey.trim();
    }
    this.usersCache = null;
  }

  private async getJson<T>(pathWithQuery: string, timeoutMs = 5000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${pathWithQuery}`, {
        method: 'GET',
        headers: {
          'X-Api-Key': this.apiKey,
          Accept: 'application/json'
        },
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`OVERSEERR_HTTP_${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  public async checkHealth(): Promise<{ ok: boolean; version?: string; latencyMs: number; error?: string }> {
    const t0 = Date.now();
    try {
      const data = await this.getJson<{ version?: string }>('/api/v1/status');
      return { ok: true, version: data.version, latencyMs: Date.now() - t0 };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : 'UNKNOWN_ERROR'
      };
    }
  }

  private mapRawMediaCandidate(r: Record<string, unknown>, fallbackType: MediaType = 'movie'): OverseerrSearchCandidate | null {
    const rawType = r.mediaType;
    const mType: MediaType = rawType === 'tv' ? 'tv' : rawType === 'movie' ? 'movie' : fallbackType;
    const id = Number(r.id);
    if (!Number.isFinite(id) || id <= 0) return null;

    const dateStr = String(r.releaseDate || r.firstAirDate || '');
    const year = dateStr.length >= 4 ? Number(dateStr.slice(0, 4)) || null : null;
    const posterPath =
      typeof r.posterPath === 'string' && r.posterPath.startsWith('/')
        ? `https://image.tmdb.org/t/p/w500${r.posterPath}`
        : null;
    const mediaInfo = r.mediaInfo as { status?: number } | undefined;

    return {
      tmdbId: id,
      mediaType: mType,
      titleFr: String(r.title || r.name || ''),
      originalTitle: String(r.originalTitle || r.originalName || r.title || r.name || ''),
      year,
      overviewFr: typeof r.overview === 'string' && r.overview.trim() ? r.overview.trim() : null,
      posterUrl: posterPath,
      voteAverage: typeof r.voteAverage === 'number' ? Math.round(r.voteAverage * 10) / 10 : null,
      mediaInfoStatus: typeof mediaInfo?.status === 'number' ? mediaInfo.status : null
    };
  }

  public async searchPersonFilmography(params: {
    personQuery: string;
    roleFilter?: 'director' | 'actor' | 'any';
    year?: number;
    mediaType?: 'movie' | 'tv' | 'auto';
  }): Promise<{
    personName: string | null;
    candidates: OverseerrSearchCandidate[];
  }> {
    const encoded = encodeRfc3986(params.personQuery.trim());
    const data = await this.getJson<{
      results?: Array<Record<string, unknown>>;
    }>(`/api/v1/search?query=${encoded}&page=1&language=fr`);

    const results = data.results || [];
    const personHit = results.find((r) => r.mediaType === 'person');
    if (!personHit) {
      return { personName: null, candidates: [] };
    }

    const personId = Number(personHit.id);
    const personName = String(personHit.name || params.personQuery);
    const personNameLower = personName.toLowerCase();
    const collected = new Map<string, { candidate: OverseerrSearchCandidate; score: number }>();

    const addRawItem = (raw: Record<string, unknown>, bonusScore = 0) => {
      const mType = raw.mediaType === 'tv' ? 'tv' : 'movie';
      if (params.mediaType && params.mediaType !== 'auto' && mType !== params.mediaType) return;
      const cand = this.mapRawMediaCandidate(raw, mType);
      if (!cand || !cand.titleFr) return;

      // Écarter les documentaires "making-of / portrait" qui portent le nom du réalisateur dans le titre
      const titleLower = cand.titleFr.toLowerCase();
      const isSelfDoc =
        titleLower.includes(personNameLower) ||
        titleLower.startsWith('cinéma par') ||
        titleLower.startsWith('pas de deux avec');

      if (params.year && cand.year && Math.abs(cand.year - params.year) > 1) {
        return;
      }

      const voteCount = Number(raw.voteCount || 0);
      const popularity = Number(raw.popularity || 0);
      const voteAvg = cand.voteAverage || 0;
      const score = (isSelfDoc ? -500 : 0) + bonusScore + Math.min(voteCount, 2000) * 0.1 + popularity + voteAvg * 15;
      const key = `${cand.mediaType}:${cand.tmdbId}`;
      const existing = collected.get(key);
      if (!existing || score > existing.score) {
        collected.set(key, { candidate: cand, score });
      }
    };

    // 1. Crédits complets via /api/v1/person/:id/combined_credits
    try {
      const credits = await this.getJson<{
        cast?: Array<Record<string, unknown>>;
        crew?: Array<Record<string, unknown>>;
      }>(`/api/v1/person/${personId}/combined_credits?language=fr`);

      const role = params.roleFilter || 'any';
      if (role === 'director' || role === 'any') {
        for (const c of credits.crew || []) {
          const job = String(c.job || '').toLowerCase();
          const dept = String(c.department || '').toLowerCase();
          if (job === 'director' || dept === 'directing' || job === 'creator' || job === 'writer') {
            addRawItem(c, job === 'director' ? 120 : 60);
          }
        }
      }
      if (role === 'actor' || role === 'any') {
        for (const c of credits.cast || []) {
          // Éviter les apparitions "Self / Lui-même" dans des documentaires
          const character = String(c.character || '').toLowerCase();
          const isSelf = character.includes('self') || character.includes('lui-même') || character.includes('elle-même');
          addRawItem(c, isSelf ? -200 : 80);
        }
      }
    } catch {
      // Fallback sur knownFor si combined_credits n'est pas disponible
    }

    // 2. Fallback / complément avec knownFor
    const knownFor = (personHit.knownFor as Array<Record<string, unknown>> | undefined) || [];
    for (const k of knownFor) {
      addRawItem(k, 100);
    }

    const sorted = Array.from(collected.values())
      .sort((a, b) => b.score - a.score)
      .map((x) => x.candidate);

    return {
      personName,
      candidates: sorted.slice(0, 8)
    };
  }

  public async search(
    query: string,
    mediaType: 'movie' | 'tv' | 'auto' = 'auto',
    options?: { includePersonFallback?: boolean }
  ): Promise<OverseerrSearchCandidate[]> {
    const encoded = encodeRfc3986(query.trim());
    const data = await this.getJson<{
      results?: Array<Record<string, unknown>>;
    }>(`/api/v1/search?query=${encoded}&page=1&language=fr`);

    const results = data.results || [];
    const candidates: OverseerrSearchCandidate[] = [];
    const personHits: Array<Record<string, unknown>> = [];

    for (const r of results) {
      const mType = r.mediaType;
      if (mType === 'person') {
        personHits.push(r);
        continue;
      }
      if (mType !== 'movie' && mType !== 'tv') continue;
      if (mediaType !== 'auto' && mType !== mediaType) continue;

      const mapped = this.mapRawMediaCandidate(r, mType);
      if (mapped) {
        candidates.push(mapped);
      }
    }

    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const normQuery = norm(query);

    // Vérifier si un film/série correspond déjà exactement au titre cherché (ex: "Goliath", "Titane")
    const hasExactMediaTitleMatch = candidates.some(
      (c) => norm(c.titleFr) === normQuery || norm(c.originalTitle) === normQuery
    );
    const isTopHitPerson = results[0]?.mediaType === 'person';
    const allowPersonFallback = options?.includePersonFallback ?? true;

    // On ne déclenche la filmographie d'une personne que si :
    // - le fallback personne est autorisé (pas lors d'une résolution stricte de titre verifySpecificTitles)
    // - aucun film/série ne porte exactement ce titre (évite qu'un figurant nommé "Goliath" ou "Titane" écrase le film)
    // - et le 1er résultat de recherche est bien une personne (ex: "Cédric Klapisch", "Pierre Niney")
    if (allowPersonFallback && personHits.length > 0 && isTopHitPerson && !hasExactMediaTitleMatch) {
      const filmography = await this.searchPersonFilmography({
        personQuery: String(personHits[0].name || query),
        roleFilter: 'any',
        mediaType
      });
      if (filmography.candidates.length > 0) {
        const personNameLower = String(personHits[0].name || query).toLowerCase();
        const nonDocDirectCandidates = candidates.filter(
          (c) => !c.titleFr.toLowerCase().includes(personNameLower)
        );
        const merged = new Map<string, OverseerrSearchCandidate>();
        for (const fc of filmography.candidates) {
          merged.set(`${fc.mediaType}:${fc.tmdbId}`, fc);
        }
        for (const dc of nonDocDirectCandidates) {
          const key = `${dc.mediaType}:${dc.tmdbId}`;
          if (!merged.has(key)) merged.set(key, dc);
        }
        return Array.from(merged.values());
      }
    }

    return candidates;
  }

  private extractTmdbReleaseDates(raw: Record<string, unknown>): {
    inCinemas: string | null;
    digitalRelease: string | null;
    physicalRelease: string | null;
  } {
    let inCinemas: string | null = null;
    let digitalRelease: string | null = null;
    let physicalRelease: string | null = null;

    const releasesObj = raw.releases as {
      results?: Array<{
        iso_3166_1?: string;
        release_dates?: Array<{ type?: number; release_date?: string }>;
      }>;
    } | undefined;

    const results = releasesObj?.results || [];
    // Priorité FR puis US puis premier pays disponible
    const prioritized = [
      ...results.filter((r) => r.iso_3166_1 === 'FR'),
      ...results.filter((r) => r.iso_3166_1 === 'US'),
      ...results.filter((r) => r.iso_3166_1 !== 'FR' && r.iso_3166_1 !== 'US')
    ];

    for (const country of prioritized) {
      for (const rd of country.release_dates || []) {
        const dStr = typeof rd.release_date === 'string' ? rd.release_date.slice(0, 10) : null;
        if (!dStr) continue;
        if ((rd.type === 3 || rd.type === 2) && !inCinemas) inCinemas = dStr;
        if (rd.type === 4 && !digitalRelease) digitalRelease = dStr;
        if (rd.type === 5 && !physicalRelease) physicalRelease = dStr;
      }
    }

    if (!inCinemas && typeof raw.releaseDate === 'string' && raw.releaseDate) {
      inCinemas = raw.releaseDate.slice(0, 10);
    }

    return { inCinemas, digitalRelease, physicalRelease };
  }

  public async getMediaDetail(tmdbId: number, mediaType: MediaType): Promise<OverseerrEnrichedDetail> {
    const endpoint = mediaType === 'movie' ? `/api/v1/movie/${tmdbId}?language=fr` : `/api/v1/tv/${tmdbId}?language=fr`;
    const raw = await this.getJson<Record<string, unknown>>(endpoint);

    const extIds = (raw.externalIds as Record<string, unknown> | undefined) || {};
    const imdbId =
      (typeof raw.imdbId === 'string' && raw.imdbId) ||
      (typeof extIds.imdbId === 'string' && extIds.imdbId) ||
      null;
    const tvdbId = typeof extIds.tvdbId === 'number' ? extIds.tvdbId : null;

    const dateStr = String(raw.releaseDate || raw.firstAirDate || '');
    const year = dateStr.length >= 4 ? Number(dateStr.slice(0, 4)) || null : null;
    const posterPath = typeof raw.posterPath === 'string' && raw.posterPath.startsWith('/')
      ? `https://image.tmdb.org/t/p/w500${raw.posterPath}`
      : null;

    const genres = ((raw.genres as Array<{ name?: string }> | undefined) || [])
      .map((g) => g.name || '')
      .filter(Boolean);

    const credits = (raw.credits as {
      cast?: Array<{ name?: string }>;
      crew?: Array<{ job?: string; name?: string }>;
    } | undefined) || {};

    const topCast = (credits.cast || [])
      .slice(0, 4)
      .map((c) => c.name || '')
      .filter(Boolean);

    const directors = (credits.crew || [])
      .filter((c) => c.job === 'Director')
      .map((c) => c.name || '')
      .filter(Boolean);

    const createdBy = ((raw.createdBy as Array<{ name?: string }> | undefined) || [])
      .map((c) => c.name || '')
      .filter(Boolean);

    const directorOrCreator = directors[0] || createdBy[0] || null;
    const runtimeMinutes =
      typeof raw.runtime === 'number'
        ? raw.runtime
        : Array.isArray(raw.episodeRunTime) && typeof raw.episodeRunTime[0] === 'number'
          ? Number(raw.episodeRunTime[0])
          : null;

    const mediaInfo = (raw.mediaInfo as Record<string, unknown> | undefined) || {};
    const requests = (mediaInfo.requests as Array<Record<string, unknown>> | undefined) || [];
    const latestReq = requests[requests.length - 1];
    const reqBy = (latestReq?.requestedBy as Record<string, unknown> | undefined) || {};

    const mediaInfoSeasons = (mediaInfo.seasons as Array<{ seasonNumber?: number; status?: number }> | undefined) || [];
    const statusBySeason = new Map<number, number>();
    for (const ms of mediaInfoSeasons) {
      if (typeof ms.seasonNumber === 'number' && typeof ms.status === 'number') {
        statusBySeason.set(ms.seasonNumber, ms.status);
      }
    }

    const rawSeasons = (raw.seasons as Array<{ seasonNumber?: number; episodeCount?: number }> | undefined) || [];
    const seasonsMeta = rawSeasons
      .filter((s) => typeof s.seasonNumber === 'number' && s.seasonNumber > 0)
      .map((s) => ({
        seasonNumber: Number(s.seasonNumber),
        episodeCount: Number(s.episodeCount || 0),
        overseerrStatus: statusBySeason.get(Number(s.seasonNumber)) ?? null
      }));

    const requestedSeasons: number[] = [];
    for (const req of requests) {
      const reqSeasons = (req.seasons as Array<{ seasonNumber?: number }> | undefined) || [];
      for (const rs of reqSeasons) {
        if (typeof rs.seasonNumber === 'number' && rs.seasonNumber > 0) {
          requestedSeasons.push(rs.seasonNumber);
        }
      }
    }

    return {
      tmdbId,
      mediaType,
      tvdbId,
      imdbId,
      titleFr: String(raw.title || raw.name || ''),
      originalTitle: String(raw.originalTitle || raw.originalName || raw.title || raw.name || ''),
      year,
      overviewFr: typeof raw.overview === 'string' && raw.overview.trim() ? raw.overview.trim() : null,
      posterUrl: posterPath,
      genres,
      runtimeMinutes,
      directorOrCreator,
      topCast,
      voteAverage: typeof raw.voteAverage === 'number' ? Math.round(raw.voteAverage * 10) / 10 : null,
      tmdbReleases: this.extractTmdbReleaseDates(raw),
      totalSeasons: typeof raw.numberOfSeasons === 'number' ? raw.numberOfSeasons : seasonsMeta.length,
      seasonsMeta,
      requestInfo: {
        mediaStatus: typeof mediaInfo.status === 'number' ? mediaInfo.status : null,
        latestRequestId: typeof latestReq?.id === 'number' ? latestReq.id : null,
        latestRequestStatus: typeof latestReq?.status === 'number' ? latestReq.status : null,
        requestedAt: typeof latestReq?.createdAt === 'string' ? latestReq.createdAt : null,
        requestedByUserId: typeof reqBy.id === 'number' ? reqBy.id : null,
        requestedByEmail: typeof reqBy.email === 'string' ? reqBy.email.toLowerCase() : null,
        requestedByDisplayName: String(reqBy.plexUsername || reqBy.displayName || '') || null,
        requestedSeasons: Array.from(new Set(requestedSeasons))
      }
    };
  }

  public async getRecommendations(tmdbId: number, mediaType: MediaType): Promise<OverseerrSearchCandidate[]> {
    const endpoint =
      mediaType === 'movie'
        ? `/api/v1/movie/${tmdbId}/recommendations?page=1&language=fr`
        : `/api/v1/tv/${tmdbId}/recommendations?page=1&language=fr`;
    const data = await this.getJson<{ results?: Array<Record<string, unknown>> }>(endpoint);
    return (data.results || []).slice(0, 6).map((r) => {
      const dateStr = String(r.releaseDate || r.firstAirDate || '');
      const year = dateStr.length >= 4 ? Number(dateStr.slice(0, 4)) || null : null;
      const posterPath = typeof r.posterPath === 'string' && r.posterPath.startsWith('/')
        ? `https://image.tmdb.org/t/p/w500${r.posterPath}`
        : null;
      const mediaInfo = r.mediaInfo as { status?: number } | undefined;
      return {
        tmdbId: Number(r.id),
        mediaType,
        titleFr: String(r.title || r.name || ''),
        originalTitle: String(r.originalTitle || r.originalName || r.title || r.name || ''),
        year,
        overviewFr: typeof r.overview === 'string' ? r.overview : null,
        posterUrl: posterPath,
        voteAverage: typeof r.voteAverage === 'number' ? Math.round(r.voteAverage * 10) / 10 : null,
        mediaInfoStatus: typeof mediaInfo?.status === 'number' ? mediaInfo.status : null
      };
    });
  }

  public async discoverByGenreOrTrending(mediaType: 'movie' | 'tv' | 'auto', genre?: string): Promise<OverseerrSearchCandidate[]> {
    const targetType: MediaType = mediaType === 'tv' ? 'tv' : 'movie';
    let endpoint = `/api/v1/discover/${targetType === 'movie' ? 'movies' : 'tv'}?page=1&language=fr`;
    if (genre) {
      const gId = TMDB_GENRE_MAP_FR[genre.trim().toLowerCase()];
      if (gId) {
        endpoint = `/api/v1/discover/${targetType === 'movie' ? 'movies' : 'tv'}/genre/${gId}?page=1&language=fr`;
      }
    }
    const data = await this.getJson<{ results?: Array<Record<string, unknown>> }>(endpoint);
    return (data.results || []).slice(0, 6).map((r) => {
      const dateStr = String(r.releaseDate || r.firstAirDate || '');
      const year = dateStr.length >= 4 ? Number(dateStr.slice(0, 4)) || null : null;
      const posterPath = typeof r.posterPath === 'string' && r.posterPath.startsWith('/')
        ? `https://image.tmdb.org/t/p/w500${r.posterPath}`
        : null;
      const mediaInfo = r.mediaInfo as { status?: number } | undefined;
      return {
        tmdbId: Number(r.id),
        mediaType: targetType,
        titleFr: String(r.title || r.name || ''),
        originalTitle: String(r.originalTitle || r.originalName || r.title || r.name || ''),
        year,
        overviewFr: typeof r.overview === 'string' ? r.overview : null,
        posterUrl: posterPath,
        voteAverage: typeof r.voteAverage === 'number' ? Math.round(r.voteAverage * 10) / 10 : null,
        mediaInfoStatus: typeof mediaInfo?.status === 'number' ? mediaInfo.status : null
      };
    });
  }

  public async getUsers(forceRefresh = false): Promise<OverseerrUserSummary[]> {
    if (!forceRefresh && this.usersCache && this.usersCache.expiresAt > Date.now()) {
      return this.usersCache.users;
    }
    const data = await this.getJson<{ results?: Array<Record<string, unknown>> }>('/api/v1/user?take=100&skip=0');
    const users: OverseerrUserSummary[] = (data.results || []).map((u) => ({
      id: Number(u.id),
      email: String(u.email || '').trim().toLowerCase(),
      plexUsername: typeof u.plexUsername === 'string' ? u.plexUsername : null,
      displayName: String(u.displayName || u.plexUsername || u.email || ''),
      userType: Number(u.userType || 1),
      permissions: Number(u.permissions || 0),
      requestCount: Number(u.requestCount || 0)
    }));
    this.usersCache = {
      expiresAt: Date.now() + 5 * 60 * 1000,
      users
    };
    return users;
  }

  public async resolvePlexUser(email: string, aliasEmail?: string | null): Promise<OverseerrUserSummary | null> {
    const users = await this.getUsers();
    const targetEmails = [aliasEmail, email]
      .filter((e): e is string => Boolean(e))
      .map((e) => e.trim().toLowerCase());

    for (const target of targetEmails) {
      const matched = users.find((u) => u.email === target && u.userType === 1);
      if (matched) return matched;
    }
    return null;
  }

  public async getRequests(filterByOverseerrUserId?: number | null, limit = 15): Promise<
    Array<{
      requestId: number;
      status: number;
      createdAt: string;
      mediaType: MediaType;
      tmdbId: number;
      mediaStatus: number;
      requestedByEmail: string | null;
      requestedByDisplayName: string;
      seasons: number[];
    }>
  > {
    const path = filterByOverseerrUserId
      ? `/api/v1/request?take=${limit}&skip=0&sort=added&requestedBy=${filterByOverseerrUserId}`
      : `/api/v1/request?take=${limit}&skip=0&sort=added`;
    const data = await this.getJson<{ results?: Array<Record<string, unknown>> }>(path);
    return (data.results || []).map((r) => {
      const media = (r.media as Record<string, unknown> | undefined) || {};
      const reqBy = (r.requestedBy as Record<string, unknown> | undefined) || {};
      const seasons = ((r.seasons as Array<{ seasonNumber?: number }> | undefined) || [])
        .map((s) => Number(s.seasonNumber || 0))
        .filter((n) => n > 0);
      return {
        requestId: Number(r.id),
        status: Number(r.status || 1),
        createdAt: String(r.createdAt || ''),
        mediaType: r.type === 'tv' ? 'tv' : 'movie',
        tmdbId: Number(media.tmdbId || 0),
        mediaStatus: Number(media.status || 1),
        requestedByEmail: typeof reqBy.email === 'string' ? reqBy.email.toLowerCase() : null,
        requestedByDisplayName: String(reqBy.plexUsername || reqBy.displayName || 'Ami'),
        seasons
      };
    });
  }

  public async createMediaRequest(params: {
    mediaType: MediaType;
    tmdbId: number;
    seasons?: number[];
    overseerrUserId?: number | null;
  }): Promise<{
    requestId: number;
    status: number;
    mediaStatus: number;
    createdAt: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const body: Record<string, unknown> = {
        mediaType: params.mediaType,
        mediaId: params.tmdbId,
        is4k: false
      };

      if (params.mediaType === 'tv') {
        const cleanSeasons = Array.from(
          new Set((params.seasons || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))
        ).sort((a, b) => a - b);
        if (cleanSeasons.length === 0) {
          throw new Error('TV_SEASONS_REQUIRED: Au moins une saison doit être sélectionnée pour une série.');
        }
        body.seasons = cleanSeasons;
      }

      if (typeof params.overseerrUserId === 'number' && params.overseerrUserId > 0) {
        body.userId = params.overseerrUserId;
      }

      const res = await this.fetchImpl(`${this.baseUrl}/api/v1/request`, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (res.status === 409) {
        return {
          requestId: 0,
          status: 2,
          mediaStatus: 3,
          createdAt: new Date().toISOString()
        };
      }

      if (!res.ok) {
        let detail = '';
        try {
          const errJson = (await res.json()) as { message?: string };
          if (errJson?.message) detail = `: ${errJson.message}`;
        } catch {
          // ignore
        }
        throw new Error(`OVERSEERR_REQUEST_HTTP_${res.status}${detail}`);
      }

      const raw = (await res.json()) as Record<string, unknown>;
      const media = (raw.media as Record<string, unknown> | undefined) || {};
      return {
        requestId: Number(raw.id || 0),
        status: Number(raw.status || 1),
        mediaStatus: Number(media.status || 2),
        createdAt: String(raw.createdAt || new Date().toISOString())
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
