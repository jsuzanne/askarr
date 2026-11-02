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
      if (res.ok) {
        this.catalogCache = null;
      }
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  public async triggerMovieSearchCommand(radarrMovieId: number): Promise<{ commandId: number | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/v3/command`, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          name: 'MoviesSearch',
          movieIds: [radarrMovieId]
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Radarr MoviesSearch failed (${res.status}): ${txt.slice(0, 160)}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      return {
        commandId: typeof data.id === 'number' ? data.id : null
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async waitForCommandCompletion(
    commandId: number,
    maxWaitMs = 9500
  ): Promise<{
    commandStatus: string;
    commandMessage: string | null;
    reportsDownloaded: number | null;
    durationSeconds: number | null;
  }> {
    const startMs = Date.now();
    let lastStatus = 'queued';
    let lastMessage: string | null = null;
    let reportsDownloaded: number | null = null;
    let durationSeconds: number | null = null;

    while (Date.now() - startMs < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      try {
        const data = await this.getJson<Record<string, unknown>>(
          `/api/v3/command/${encodeURIComponent(String(commandId))}`
        );
        lastStatus = typeof data.status === 'string' ? data.status : lastStatus;
        lastMessage = typeof data.message === 'string' ? data.message : lastMessage;

        if (lastMessage) {
          const match = lastMessage.match(/(\d+)\s+reports?\s+downloaded/i);
          if (match) {
            reportsDownloaded = Number(match[1]);
          }
        }

        if (typeof data.started === 'string' && typeof data.ended === 'string') {
          const diffMs = new Date(data.ended).getTime() - new Date(data.started).getTime();
          if (Number.isFinite(diffMs) && diffMs >= 0) {
            durationSeconds = Math.round((diffMs / 1000) * 10) / 10;
          }
        }

        if (lastStatus === 'completed' || lastStatus === 'failed' || lastStatus === 'aborted') {
          break;
        }
      } catch {
        break;
      }
    }

    return {
      commandStatus: lastStatus,
      commandMessage: lastMessage,
      reportsDownloaded,
      durationSeconds
    };
  }

  public async monitorAndSearchMovie(params: {
    tmdbId: number;
  }): Promise<{
    radarrMovieId: number;
    commandId: number | null;
    commandStatus: string;
    commandMessage: string | null;
    reportsDownloaded: number | null;
    durationSeconds: number | null;
  }> {
    const { movie } = await this.getMovieByTmdbId(params.tmdbId);
    if (!movie) {
      throw new Error(`Film introuvable dans Radarr (TMDB ${params.tmdbId}).`);
    }
    if (!movie.monitored) {
      await this.setMovieMonitored(movie.id, true);
    }
    const { commandId } = await this.triggerMovieSearchCommand(movie.id);
    this.catalogCache = null;

    if (commandId !== null) {
      const completion = await this.waitForCommandCompletion(commandId, 9500);
      this.catalogCache = null;
      return {
        radarrMovieId: movie.id,
        commandId,
        ...completion
      };
    }

    return {
      radarrMovieId: movie.id,
      commandId: null,
      commandStatus: 'queued',
      commandMessage: null,
      reportsDownloaded: null,
      durationSeconds: null
    };
  }

  public async getMovieHistorySummary(radarrMovieId: number): Promise<{
    lastGrabbedAt: string | null;
    lastGrabbedRelease: string | null;
    lastFailedAt: string | null;
  }> {
    try {
      const items = await this.getJson<Array<Record<string, unknown>>>(
        `/api/v3/history/movie?movieId=${encodeURIComponent(String(radarrMovieId))}`
      );
      if (!Array.isArray(items) || items.length === 0) {
        return { lastGrabbedAt: null, lastGrabbedRelease: null, lastFailedAt: null };
      }
      let lastGrabbedAt: string | null = null;
      let lastGrabbedRelease: string | null = null;
      let lastFailedAt: string | null = null;

      for (const item of items) {
        const eventType = typeof item.eventType === 'string' ? item.eventType : '';
        const date = typeof item.date === 'string' ? item.date : null;
        if (!date) continue;
        if (eventType === 'grabbed' && (!lastGrabbedAt || date > lastGrabbedAt)) {
          lastGrabbedAt = date;
          lastGrabbedRelease = typeof item.sourceTitle === 'string' ? item.sourceTitle : null;
        } else if (eventType === 'downloadFailed' && (!lastFailedAt || date > lastFailedAt)) {
          lastFailedAt = date;
        }
      }

      return { lastGrabbedAt, lastGrabbedRelease, lastFailedAt };
    } catch {
      return { lastGrabbedAt: null, lastGrabbedRelease: null, lastFailedAt: null };
    }
  }
}
