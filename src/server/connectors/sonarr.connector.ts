export interface SonarrSeasonStatus {
  seasonNumber: number;
  monitored: boolean;
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
  percentOfEpisodes: number;
}

export interface SonarrSeriesStatus {
  id: number;
  tvdbId: number;
  title: string;
  year: number | null;
  status: string;
  monitored: boolean;
  added?: string | null;
  nextAiring: string | null;
  seasons: SonarrSeasonStatus[];
}

export interface SonarrQueueItem {
  seriesId: number;
  title: string;
  status: string;
  trackedDownloadState: string | null;
  trackedDownloadStatus: string | null;
  size: number;
  sizeleft: number;
  timeleft: string | null;
}

export class SonarrConnector {
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
        throw new Error(`SONARR_HTTP_${res.status}`);
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

  public async getSeriesByTvdbId(tvdbId: number): Promise<{ series: SonarrSeriesStatus | null; latencyMs: number }> {
    const t0 = Date.now();
    const items = await this.getJson<Array<Record<string, unknown>>>(`/api/v3/series?tvdbId=${encodeURIComponent(String(tvdbId))}`);
    const raw = items[0];
    if (!raw) {
      return { series: null, latencyMs: Date.now() - t0 };
    }

    const rawSeasons = (raw.seasons as Array<Record<string, unknown>> | undefined) || [];
    const seasons: SonarrSeasonStatus[] = rawSeasons
      .filter((s) => typeof s.seasonNumber === 'number' && s.seasonNumber > 0)
      .map((s) => {
        const stats = (s.statistics as Record<string, unknown> | undefined) || {};
        return {
          seasonNumber: Number(s.seasonNumber),
          monitored: Boolean(s.monitored),
          episodeFileCount: Number(stats.episodeFileCount || 0),
          episodeCount: Number(stats.episodeCount || 0),
          totalEpisodeCount: Number(stats.totalEpisodeCount || stats.episodeCount || 0),
          percentOfEpisodes: Number(stats.percentOfEpisodes || 0)
        };
      });

    return {
      series: {
        id: Number(raw.id),
        tvdbId: Number(raw.tvdbId || tvdbId),
        title: String(raw.title || ''),
        year: typeof raw.year === 'number' ? raw.year : null,
        status: String(raw.status || 'continuing'),
        monitored: Boolean(raw.monitored),
        added: typeof raw.added === 'string' && raw.added.length >= 10 ? raw.added.slice(0, 10) : null,
        nextAiring: typeof raw.nextAiring === 'string' ? raw.nextAiring.slice(0, 10) : null,
        seasons
      },
      latencyMs: Date.now() - t0
    };
  }

  public async getQueueForSeries(sonarrSeriesId: number): Promise<SonarrQueueItem | null> {
    const data = await this.getJson<{ records?: Array<Record<string, unknown>> }>('/api/v3/queue?page=1&pageSize=50');
    const rec = (data.records || []).find((r) => Number(r.seriesId) === sonarrSeriesId);
    if (!rec) return null;
    return {
      seriesId: sonarrSeriesId,
      title: String(rec.title || ''),
      status: String(rec.status || ''),
      trackedDownloadState: typeof rec.trackedDownloadState === 'string' ? rec.trackedDownloadState : null,
      trackedDownloadStatus: typeof rec.trackedDownloadStatus === 'string' ? rec.trackedDownloadStatus : null,
      size: Number(rec.size || 0),
      sizeleft: Number(rec.sizeleft || 0),
      timeleft: typeof rec.timeleft === 'string' ? rec.timeleft : null
    };
  }

  public async setSeriesMonitored(sonarrSeriesId: number, monitored = true): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/v3/series/editor`, {
        method: 'PUT',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          seriesIds: [sonarrSeriesId],
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
