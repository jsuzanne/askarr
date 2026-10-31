export interface RadarrMovieStatus {
  id: number;
  tmdbId: number;
  title: string;
  year: number | null;
  status: string; // 'announced' | 'inCinemas' | 'released' | 'deleted'
  monitored: boolean;
  minimumAvailability: string;
  hasFile: boolean;
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

  public async getMovieByTmdbId(tmdbId: number): Promise<{ movie: RadarrMovieStatus | null; latencyMs: number }> {
    const t0 = Date.now();
    const items = await this.getJson<Array<Record<string, unknown>>>(`/api/v3/movie?tmdbId=${encodeURIComponent(String(tmdbId))}`);
    const raw = items[0];
    if (!raw) {
      return { movie: null, latencyMs: Date.now() - t0 };
    }
    return {
      movie: {
        id: Number(raw.id),
        tmdbId: Number(raw.tmdbId || tmdbId),
        title: String(raw.title || ''),
        year: typeof raw.year === 'number' ? raw.year : null,
        status: String(raw.status || 'released'),
        monitored: Boolean(raw.monitored),
        minimumAvailability: String(raw.minimumAvailability || 'released'),
        hasFile: Boolean(raw.hasFile),
        inCinemas: typeof raw.inCinemas === 'string' ? raw.inCinemas.slice(0, 10) : null,
        digitalRelease: typeof raw.digitalRelease === 'string' ? raw.digitalRelease.slice(0, 10) : null,
        physicalRelease: typeof raw.physicalRelease === 'string' ? raw.physicalRelease.slice(0, 10) : null
      },
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
