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
  tmdbId?: number;
  title: string;
  alternateTitles?: string[];
  overview?: string;
  genres?: string[];
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
  private catalogCache: {
    expiresAt: number;
    items: SonarrSeriesStatus[];
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

  private mapRawSeries(raw: Record<string, unknown>, fallbackTvdbId?: number): SonarrSeriesStatus {
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

    const rawAlt = Array.isArray(raw.alternateTitles)
      ? (raw.alternateTitles as Array<Record<string, unknown>>)
      : [];
    const alternateTitles = rawAlt
      .map((a) => (typeof a?.title === 'string' ? a.title.trim() : ''))
      .filter((t) => t.length > 0);
    const genres = Array.isArray(raw.genres)
      ? (raw.genres as unknown[]).filter((g): g is string => typeof g === 'string')
      : [];

    return {
      id: Number(raw.id),
      tvdbId: Number(raw.tvdbId || fallbackTvdbId || 0),
      tmdbId: typeof raw.tmdbId === 'number' ? raw.tmdbId : undefined,
      title: String(raw.title || ''),
      alternateTitles,
      overview: typeof raw.overview === 'string' ? raw.overview : '',
      genres,
      year: typeof raw.year === 'number' ? raw.year : null,
      status: String(raw.status || 'continuing'),
      monitored: Boolean(raw.monitored),
      added: typeof raw.added === 'string' && raw.added.length >= 10 ? raw.added.slice(0, 10) : null,
      nextAiring: typeof raw.nextAiring === 'string' ? raw.nextAiring.slice(0, 10) : null,
      seasons
    };
  }

  public async getCatalogIndex(forceRefresh = false): Promise<{
    series: SonarrSeriesStatus[];
    latencyMs: number;
  }> {
    const t0 = Date.now();
    const now = Date.now();
    if (!forceRefresh && this.catalogCache && this.catalogCache.expiresAt > now) {
      return {
        series: this.catalogCache.items,
        latencyMs: Date.now() - t0
      };
    }
    const rawItems = await this.getJson<Array<Record<string, unknown>>>('/api/v3/series', 6000);
    const items = (rawItems || []).map((r) => this.mapRawSeries(r));
    this.catalogCache = {
      expiresAt: now + 10 * 60 * 1000,
      items
    };
    return {
      series: items,
      latencyMs: Date.now() - t0
    };
  }

  public async getSeriesByTvdbId(tvdbId: number): Promise<{ series: SonarrSeriesStatus | null; latencyMs: number }> {
    const t0 = Date.now();
    const items = await this.getJson<Array<Record<string, unknown>>>(`/api/v3/series?tvdbId=${encodeURIComponent(String(tvdbId))}`);
    const raw = items[0];
    if (!raw) {
      return { series: null, latencyMs: Date.now() - t0 };
    }

    return {
      series: this.mapRawSeries(raw, tvdbId),
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
      this.catalogCache = null;
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Active la surveillance (série + saisons ciblées + épisodes manquants de ces saisons)
   * et déclenche immédiatement une recherche d'indexeurs (SeasonSearch) dans Sonarr.
   * Idéal lorsqu'une série est incomplète sur Plex (ex: 1/8 épisodes présents).
   */
  public async monitorAndSearchSeasons(params: {
    sonarrSeriesId?: number | null;
    tvdbId?: number | null;
    seasons: number[];
  }): Promise<{
    ok: boolean;
    seriesId: number | null;
    monitoredEpisodesCount: number;
    searchedSeasons: number[];
  }> {
    const targetSeasons = Array.from(
      new Set((params.seasons || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))
    );
    if (targetSeasons.length === 0) {
      return { ok: false, seriesId: null, monitoredEpisodesCount: 0, searchedSeasons: [] };
    }

    try {
      let rawSeries: Record<string, unknown> | null = null;
      if (params.sonarrSeriesId && params.sonarrSeriesId > 0) {
        rawSeries = await this.getJson<Record<string, unknown>>(
          `/api/v3/series/${encodeURIComponent(String(params.sonarrSeriesId))}`
        ).catch(() => null);
      }
      if (!rawSeries && params.tvdbId && params.tvdbId > 0) {
        const list = await this.getJson<Array<Record<string, unknown>>>(
          `/api/v3/series?tvdbId=${encodeURIComponent(String(params.tvdbId))}`
        ).catch(() => []);
        rawSeries = list[0] || null;
      }

      if (!rawSeries || !rawSeries.id) {
        return { ok: false, seriesId: null, monitoredEpisodesCount: 0, searchedSeasons: [] };
      }

      const seriesId = Number(rawSeries.id);
      const rawSeasons = Array.isArray(rawSeries.seasons)
        ? (rawSeries.seasons as Array<Record<string, unknown>>)
        : [];

      const updatedSeasons = rawSeasons.map((s) => {
        const sNum = Number(s.seasonNumber);
        if (targetSeasons.includes(sNum)) {
          return { ...s, monitored: true };
        }
        return s;
      });

      const updatedSeriesPayload = {
        ...rawSeries,
        monitored: true,
        seasons: updatedSeasons
      };

      await this.fetchImpl(`${this.baseUrl}/api/v3/series/${seriesId}`, {
        method: 'PUT',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(updatedSeriesPayload)
      }).catch(() => null);

      // Activer aussi monitored=true sur tous les épisodes des saisons demandées
      let monitoredEpisodesCount = 0;
      const episodes = await this.getJson<Array<Record<string, unknown>>>(
        `/api/v3/episode?seriesId=${seriesId}`,
        6000
      ).catch(() => []);

      const episodeIdsToMonitor = episodes
        .filter((ep) => {
          const sNum = Number(ep.seasonNumber);
          const hasFile = Boolean(ep.hasFile);
          const isMonitored = Boolean(ep.monitored);
          return targetSeasons.includes(sNum) && (!isMonitored || !hasFile);
        })
        .map((ep) => Number(ep.id))
        .filter((id) => id > 0);

      if (episodeIdsToMonitor.length > 0) {
        const epRes = await this.fetchImpl(`${this.baseUrl}/api/v3/episode/monitor`, {
          method: 'PUT',
          headers: {
            'X-Api-Key': this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            episodeIds: episodeIdsToMonitor,
            monitored: true
          })
        }).catch(() => null);
        if (epRes?.ok) {
          monitoredEpisodesCount = episodeIdsToMonitor.length;
        }
      }

      // Déclencher SeasonSearch dans Sonarr pour chaque saison demandée
      const searchedSeasons: number[] = [];
      for (const seasonNumber of targetSeasons) {
        const cmdRes = await this.fetchImpl(`${this.baseUrl}/api/v3/command`, {
          method: 'POST',
          headers: {
            'X-Api-Key': this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            name: 'SeasonSearch',
            seriesId,
            seasonNumber
          })
        }).catch(() => null);
        if (cmdRes?.ok) {
          searchedSeasons.push(seasonNumber);
        }
      }

      this.catalogCache = null;
      return {
        ok: searchedSeasons.length > 0 || monitoredEpisodesCount > 0,
        seriesId,
        monitoredEpisodesCount,
        searchedSeasons
      };
    } catch {
      return { ok: false, seriesId: null, monitoredEpisodesCount: 0, searchedSeasons: [] };
    }
  }
}
