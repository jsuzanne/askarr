export interface RadarrMovieStatus {
  id: number;
  tmdbId: number;
  title: string;
  originalTitle?: string;
  alternateTitles?: string[];
  overview?: string | null;
  originalLanguage?: string | null;
  genres?: string[];
  year: number | null;
  status: string; // 'announced' | 'inCinemas' | 'released' | 'deleted'
  monitored: boolean;
  minimumAvailability: string;
  hasFile: boolean;
  added?: string | null;
  inCinemas: string | null;
  digitalRelease: string | null;
  physicalRelease: string | null;
}

export interface RadarrQueueItem {
  movieId: number;
  title: string;
  status: string;
  trackedDownloadState: string | null;
  trackedDownloadStatus: string | null;
  size: number;
  sizeleft: number;
  timeleft: string | null;
}

export class RadarrConnector {
  private catalogCache: {
    expiresAt: number;
    movies: RadarrMovieStatus[];
    byTmdbId: Map<number, RadarrMovieStatus>;
  } | null = null;

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
    this.catalogCache = null;
  }

  private async getJson<T>(pathWithQuery: string, timeoutMs = 4500): Promise<T> {
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
        throw new Error(`RADARR_HTTP_${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  public async checkHealth(): Promise<{ ok: boolean; version?: string; latencyMs: number; error?: string }> {
    const t0 = Date.now();
    try {
      const data = await this.getJson<{ version?: string }>('/api/v3/system/status');
      return { ok: true, version: data.version, latencyMs: Date.now() - t0 };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : 'UNKNOWN_ERROR'
      };
    }
  }

  private mapRawMovie(raw: Record<string, unknown>, fallbackTmdbId?: number): RadarrMovieStatus {
    const rawAlt = Array.isArray(raw.alternateTitles)
      ? (raw.alternateTitles as Array<Record<string, unknown>>)
      : [];
    const alternateTitles = rawAlt
      .map((a) => (typeof a?.title === 'string' ? a.title.trim() : ''))
      .filter((t) => t.length > 0);
    const origLangObj = raw.originalLanguage as Record<string, unknown> | undefined;
    const originalLanguage =
      typeof origLangObj?.name === 'string'
        ? origLangObj.name.trim()
        : typeof raw.originalLanguage === 'string'
          ? raw.originalLanguage.trim()
          : null;
    const genres = Array.isArray(raw.genres)
      ? (raw.genres as unknown[]).filter((g): g is string => typeof g === 'string')
      : [];

    return {
      id: Number(raw.id),
      tmdbId: Number(raw.tmdbId || fallbackTmdbId || 0),
      title: String(raw.title || ''),
      originalTitle: typeof raw.originalTitle === 'string' ? raw.originalTitle : String(raw.title || ''),
      alternateTitles,
      overview: typeof raw.overview === 'string' ? raw.overview : '',
      originalLanguage,
      genres,
      year: typeof raw.year === 'number' ? raw.year : null,
      status: String(raw.status || 'released'),
      monitored: Boolean(raw.monitored),
      minimumAvailability: String(raw.minimumAvailability || 'released'),
      hasFile: Boolean(raw.hasFile),
      added: typeof raw.added === 'string' && raw.added.length >= 10 ? raw.added.slice(0, 10) : null,
      inCinemas: typeof raw.inCinemas === 'string' ? raw.inCinemas.slice(0, 10) : null,
      digitalRelease: typeof raw.digitalRelease === 'string' ? raw.digitalRelease.slice(0, 10) : null,
      physicalRelease: typeof raw.physicalRelease === 'string' ? raw.physicalRelease.slice(0, 10) : null
    };
  }

  public async getCatalogIndex(forceRefresh = false): Promise<{
    movies: RadarrMovieStatus[];
    byTmdbId: Map<number, RadarrMovieStatus>;
    latencyMs: number;
  }> {
    const t0 = Date.now();
    const now = Date.now();
    if (!forceRefresh && this.catalogCache && this.catalogCache.expiresAt > now) {
      return {
        movies: this.catalogCache.movies,
        byTmdbId: this.catalogCache.byTmdbId,
        latencyMs: Date.now() - t0
      };
    }

    const rawItems = await this.getJson<Array<Record<string, unknown>>>('/api/v3/movie', 6000);
    const items: RadarrMovieStatus[] = [];
    const byTmdbId = new Map<number, RadarrMovieStatus>();
    for (const raw of rawItems || []) {
      const m = this.mapRawMovie(raw);
      if (m.tmdbId > 0) {
        items.push(m);
        byTmdbId.set(m.tmdbId, m);
      }
    }
    this.catalogCache = {
      expiresAt: now + 10 * 60 * 1000,
      movies: items,
      byTmdbId
    };
    return {
      movies: items,
      byTmdbId,
      latencyMs: Date.now() - t0
    };
  }

  public async getMovieByTmdbId(tmdbId: number): Promise<{ movie: RadarrMovieStatus | null; latencyMs: number }> {
    const t0 = Date.now();
    if (this.catalogCache && this.catalogCache.expiresAt > Date.now()) {
      const cached = this.catalogCache.byTmdbId.get(tmdbId) || null;
      if (cached) {
        return { movie: cached, latencyMs: Date.now() - t0 };
      }
    }
    const items = await this.getJson<Array<Record<string, unknown>>>(`/api/v3/movie?tmdbId=${encodeURIComponent(String(tmdbId))}`);
    const raw = items[0];
    if (!raw) {
      return { movie: null, latencyMs: Date.now() - t0 };
    }
    return {
      movie: this.mapRawMovie(raw, tmdbId),
      latencyMs: Date.now() - t0
    };
  }

  public async getRecentWaitingMovies(limit = 6): Promise<{ movies: RadarrMovieStatus[]; latencyMs: number }> {
    const t0 = Date.now();
    const collected = new Map<number, RadarrMovieStatus>();

    const startIso = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endIso = new Date(Date.now() + 270 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [wantedRes, calendarRes] = await Promise.allSettled([
      this.getJson<{ records?: Array<Record<string, unknown>> }>(
        `/api/v3/wanted/missing?page=1&pageSize=${encodeURIComponent(String(Math.max(limit * 2, 12)))}&sortKey=added&sortDirection=descending&monitored=true`
      ),
      this.getJson<Array<Record<string, unknown>>>(
        `/api/v3/calendar?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&unmonitored=false`
      )
    ]);

    if (wantedRes.status === 'fulfilled' && Array.isArray(wantedRes.value?.records)) {
      for (const raw of wantedRes.value.records) {
        const mapped = this.mapRawMovie(raw);
        if (mapped.tmdbId > 0 && mapped.monitored && !mapped.hasFile) {
          collected.set(mapped.tmdbId, mapped);
        }
      }
    }

    if (calendarRes.status === 'fulfilled' && Array.isArray(calendarRes.value)) {
      for (const raw of calendarRes.value) {
        const mapped = this.mapRawMovie(raw);
        if (mapped.tmdbId > 0 && mapped.monitored && !mapped.hasFile && !collected.has(mapped.tmdbId)) {
          collected.set(mapped.tmdbId, mapped);
        }
      }
    }

    const sorted = Array.from(collected.values()).sort((a, b) => {
      const aDate = a.added || '';
      const bDate = b.added || '';
      return bDate.localeCompare(aDate);
    });

    return {
      movies: sorted.slice(0, limit),
      latencyMs: Date.now() - t0
    };
  }

  public async getQueueForMovie(radarrMovieId: number): Promise<RadarrQueueItem | null> {
    const data = await this.getJson<{ records?: Array<Record<string, unknown>> }>('/api/v3/queue?page=1&pageSize=50');
    const rec = (data.records || []).find((r) => Number(r.movieId) === radarrMovieId);
    if (!rec) return null;
    return {
      movieId: radarrMovieId,
      title: String(rec.title || ''),
      status: String(rec.status || ''),
      trackedDownloadState: typeof rec.trackedDownloadState === 'string' ? rec.trackedDownloadState : null,
      trackedDownloadStatus: typeof rec.trackedDownloadStatus === 'string' ? rec.trackedDownloadStatus : null,
      size: Number(rec.size || 0),
      sizeleft: Number(rec.sizeleft || 0),
      timeleft: typeof rec.timeleft === 'string' ? rec.timeleft : null
    };
  }

  public async setMovieMonitored(radarrMovieId: number, monitored = true): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/v3/movie/editor`, {
        method: 'PUT',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          movieIds: [radarrMovieId],
          monitored
        }),
        signal: controller.signal
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
