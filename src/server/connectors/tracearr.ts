export interface TracearrRecentItem {
  title: string;
  year: number | null;
  mediaType: 'movie' | 'tv';
  rawMediaType: string;
  tmdbId: number | null;
  imdbId: string | null;
  addedAt: string;
  daysAgo: number;
  serverNames: string[];
  ratingKey: string | null;
}

export interface TracearrWatchHistoryItem {
  id: string;
  title: string;
  showTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  year: number | null;
  mediaType: 'movie' | 'tv';
  tmdbId: number | null;
  serverName: string;
  username: string;
  startedAt: string;
  stoppedAt: string | null;
  percentComplete: number;
  watched: boolean;
  device: string | null;
  platform: string | null;
  isTranscode: boolean;
  resolution: string | null;
}

export interface TracearrUserActivity {
  username: string;
  recentPlaysCount: number;
  lastWatchedTitle: string;
  lastWatchedAt: string;
  lastServerName: string;
  lastDevice: string | null;
}

export interface TracearrActiveStream {
  username: string;
  title: string;
  serverName: string;
  device: string | null;
  platform: string | null;
  isTranscode: boolean;
  percentComplete: number;
  resolution: string | null;
}

export interface TracearrHealthStatus {
  ok: boolean;
  latencyMs: number;
  monitoredServersCount?: number;
  serverNames?: string[];
  activeStreamsCount?: number;
  transcodesCount?: number;
  error?: string;
}

interface TracearrRawRecentEntry {
  server_id: string;
  media_type: string;
  title: string;
  year: number | null;
  added_at: string;
  removed_at: string | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  rating_key: string | null;
}

interface TracearrRawHistoryEntry {
  id: string;
  server_name?: string;
  media_type?: string;
  media_title?: string;
  show_title?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  year?: number | null;
  tmdb_id?: number | null;
  started_at?: string;
  stopped_at?: string | null;
  percent_complete?: number;
  watched?: boolean;
  device?: string | null;
  platform?: string | null;
  is_transcode?: boolean;
  resolution?: string | null;
  user?: { username?: string };
}

export interface TracearrCommunityPopularItem {
  title: string;
  year: number | null;
  mediaType: 'movie' | 'tv';
  tmdbId: number | null;
  serverNames: string[];
  distinctViewersCount: number;
  totalPlays: number;
  lastWatchedAt: string;
}

export interface TracearrUserTasteAndTrends {
  myRecentWatched: Array<{
    title: string;
    year: number | null;
    mediaType: 'movie' | 'tv';
    tmdbId: number | null;
    percentComplete: number;
    startedAt: string;
  }>;
  watchedTmdbIds: Set<number>;
  watchedNormTitles: Set<string>;
  communityPopular: TracearrCommunityPopularItem[];
}

export class TracearrConnector {
  private baseUrl: string;
  private apiKey: string;
  private readonly fetchFn: typeof fetch;
  private serverNameCache: { map: Map<string, string>; expiresAt: number } | null = null;
  private recentlyAddedRawCache: {
    items: TracearrRawRecentEntry[];
    expiresAt: number;
  } | null = null;
  private watchHistoryRawCache: {
    items: TracearrRawHistoryEntry[];
    expiresAt: number;
  } | null = null;

  constructor(baseUrl: string, apiKey: string, fetchFn: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey.trim();
    this.fetchFn = fetchFn;
  }

  updateConfig(baseUrl: string, apiKey: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey.trim();
    this.serverNameCache = null;
    this.recentlyAddedRawCache = null;
    this.watchHistoryRawCache = null;
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json'
    };
  }

  async getServerNameMap(): Promise<Map<string, string>> {
    if (this.serverNameCache && Date.now() < this.serverNameCache.expiresAt) {
      return this.serverNameCache.map;
    }
    const map = new Map<string, string>();
    if (!this.isConfigured()) return map;

    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/v2/public/servers`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(4500)
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{ server_id: string; server_name: string }>;
        };
        for (const s of json.data ?? []) {
          if (s.server_id && s.server_name) {
            map.set(s.server_id, s.server_name);
          }
        }
        this.serverNameCache = { map, expiresAt: Date.now() + 5 * 60_000 };
      }
    } catch {
      // Silencieux si hors ligne
    }
    return map;
  }

  async checkHealth(): Promise<TracearrHealthStatus> {
    const start = Date.now();
    if (!this.isConfigured()) {
      return {
        ok: false,
        latencyMs: 0,
        error: 'Tracearr non configuré (URL ou clé API manquante)'
      };
    }

    try {
      const [serversRes, streamsRes] = await Promise.all([
        this.fetchFn(`${this.baseUrl}/api/v2/public/servers`, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(5000)
        }),
        this.fetchFn(`${this.baseUrl}/api/v2/public/streams`, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(5000)
        })
      ]);

      if (!serversRes.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `HTTP ${serversRes.status}`
        };
      }

      const serversJson = (await serversRes.json()) as {
        data?: Array<{ server_id: string; server_name: string; status?: string }>;
      };
      const servers = serversJson.data ?? [];
      const serverNames = servers.map((s) => s.server_name).filter(Boolean);

      let activeStreamsCount = 0;
      let transcodesCount = 0;
      if (streamsRes.ok) {
        const streamsJson = (await streamsRes.json()) as {
          summary?: { total?: number; transcodes?: number };
        };
        activeStreamsCount = streamsJson.summary?.total ?? 0;
        transcodesCount = streamsJson.summary?.transcodes ?? 0;
      }

      return {
        ok: true,
        latencyMs: Date.now() - start,
        monitoredServersCount: serverNames.length,
        serverNames,
        activeStreamsCount,
        transcodesCount
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Erreur de connexion Tracearr'
      };
    }
  }

  async getRecentlyAdded(options?: {
    allowedServers?: string[];
    daysBack?: number;
    mediaType?: 'movie' | 'tv';
    limit?: number;
  }): Promise<TracearrRecentItem[]> {
    if (!this.isConfigured()) return [];

    try {
      const serverMapPromise = this.getServerNameMap();
      let rawItems: TracearrRawRecentEntry[];

      if (this.recentlyAddedRawCache && Date.now() < this.recentlyAddedRawCache.expiresAt) {
        rawItems = this.recentlyAddedRawCache.items;
      } else {
        const res = await this.fetchFn(`${this.baseUrl}/api/v2/public/recently-added?limit=100`, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(6000)
        });
        if (!res.ok) return [];
        const json = (await res.json()) as {
          data?: TracearrRawRecentEntry[];
        };
        rawItems = json.data ?? [];
        this.recentlyAddedRawCache = {
          items: rawItems,
          expiresAt: Date.now() + 3 * 60_000
        };
      }

      const serverMap = await serverMapPromise;
      const now = Date.now();
      const maxFutureMs = now + 24 * 3600_000; // Ignorer les fichiers avec mtime corrompu (ex: année 2098)
      const minPastMs = options?.daysBack ? now - options.daysBack * 86400_000 : 0;
      const allowedLower = options?.allowedServers?.map((s) => s.toLowerCase());

      const deduped = new Map<string, TracearrRecentItem>();

      for (const raw of rawItems) {
        if (raw.removed_at) continue;
        const addedMs = new Date(raw.added_at).getTime();
        if (!Number.isFinite(addedMs) || addedMs > maxFutureMs) continue;
        if (minPastMs > 0 && addedMs < minPastMs) continue;

        const serverName = serverMap.get(raw.server_id) || 'Plex';
        if (allowedLower && allowedLower.length > 0 && !allowedLower.includes(serverName.toLowerCase())) {
          continue;
        }

        const normType: 'movie' | 'tv' = raw.media_type === 'movie' ? 'movie' : 'tv';
        if (options?.mediaType && normType !== options.mediaType) continue;

        const key = `${normType}:${raw.tmdb_id || raw.title.toLowerCase().trim()}`;
        const daysAgo = Math.max(0, Math.floor((now - addedMs) / 86400_000));

        const existing = deduped.get(key);
        if (existing) {
          if (!existing.serverNames.includes(serverName)) {
            existing.serverNames.push(serverName);
          }
          if (new Date(raw.added_at).getTime() > new Date(existing.addedAt).getTime()) {
            existing.addedAt = raw.added_at;
            existing.daysAgo = daysAgo;
          }
        } else {
          deduped.set(key, {
            title: raw.title,
            year: raw.year ?? null,
            mediaType: normType,
            rawMediaType: raw.media_type,
            tmdbId: raw.tmdb_id ?? null,
            imdbId: raw.imdb_id ?? null,
            addedAt: raw.added_at,
            daysAgo,
            serverNames: [serverName],
            ratingKey: raw.rating_key ?? null
          });
        }
      }

      const sorted = Array.from(deduped.values()).sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
      );
      return sorted.slice(0, options?.limit ?? 30);
    } catch {
      return [];
    }
  }

  async getWatchHistory(options?: {
    plexUsername?: string;
    allowedServers?: string[];
    mediaType?: 'movie' | 'tv';
    limit?: number;
  }): Promise<TracearrWatchHistoryItem[]> {
    if (!this.isConfigured()) return [];

    try {
      let rawEntries: TracearrRawHistoryEntry[];
      if (this.watchHistoryRawCache && Date.now() < this.watchHistoryRawCache.expiresAt) {
        rawEntries = this.watchHistoryRawCache.items;
      } else {
        const res = await this.fetchFn(`${this.baseUrl}/api/v2/public/history?limit=250`, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(6000)
        });
        if (!res.ok) return [];

        const json = (await res.json()) as {
          data?: TracearrRawHistoryEntry[];
        };
        rawEntries = json.data ?? [];
        this.watchHistoryRawCache = {
          items: rawEntries,
          expiresAt: Date.now() + 2 * 60_000
        };
      }

      const targetUser = options?.plexUsername?.toLowerCase().trim();
      const allowedLower = options?.allowedServers?.map((s) => s.toLowerCase());
      const items: TracearrWatchHistoryItem[] = [];

      for (const raw of rawEntries) {
        const username = raw.user?.username || 'inconnu';
        if (targetUser && username.toLowerCase() !== targetUser) continue;

        const serverName = raw.server_name || 'Plex';
        if (allowedLower && allowedLower.length > 0 && !allowedLower.includes(serverName.toLowerCase())) {
          continue;
        }

        const itemMediaType: 'movie' | 'tv' =
          raw.show_title || raw.media_type === 'episode' || raw.media_type === 'show' ? 'tv' : 'movie';
        if (options?.mediaType && itemMediaType !== options.mediaType) {
          continue;
        }

        const displayTitle = raw.show_title
          ? `${raw.show_title}${
              raw.season_number != null && raw.episode_number != null
                ? ` (S${String(raw.season_number).padStart(2, '0')}E${String(raw.episode_number).padStart(2, '0')})`
                : ''
            }`
          : raw.media_title || 'Média';

        items.push({
          id: raw.id,
          title: displayTitle,
          showTitle: raw.show_title ?? null,
          seasonNumber: raw.season_number ?? null,
          episodeNumber: raw.episode_number ?? null,
          year: raw.year ?? null,
          mediaType: itemMediaType,
          tmdbId: raw.tmdb_id ?? null,
          serverName,
          username,
          startedAt: raw.started_at || new Date().toISOString(),
          stoppedAt: raw.stopped_at ?? null,
          percentComplete: Math.round(raw.percent_complete ?? 0),
          watched: Boolean(raw.watched),
          device: raw.device ?? null,
          platform: raw.platform ?? null,
          isTranscode: Boolean(raw.is_transcode),
          resolution: raw.resolution ?? null
        });
      }

      return items.slice(0, options?.limit ?? 25);
    } catch {
      return [];
    }
  }

  /**
   * Analyse l'historique de visionnage global Tracearr pour en déduire :
   * 1) Les derniers films/séries vus par l'utilisateur connecté (et la liste de ses titres déjà vus à exclure)
   * 2) Les films/séries populaires vus récemment par les AUTRES membres sur ses serveurs Plex accessibles
   */
  async getUserTasteAndCommunityTrends(options?: {
    plexUsername?: string;
    allowedServers?: string[];
    mediaType?: 'movie' | 'tv';
  }): Promise<TracearrUserTasteAndTrends> {
    const empty: TracearrUserTasteAndTrends = {
      myRecentWatched: [],
      watchedTmdbIds: new Set<number>(),
      watchedNormTitles: new Set<string>(),
      communityPopular: []
    };
    if (!this.isConfigured()) return empty;

    const allHistory = await this.getWatchHistory({
      allowedServers: options?.allowedServers,
      mediaType: options?.mediaType,
      limit: 250
    });
    if (allHistory.length === 0) return empty;

    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const targetUser = options?.plexUsername?.toLowerCase().trim();
    const myRecentMap = new Map<
      string,
      {
        title: string;
        year: number | null;
        mediaType: 'movie' | 'tv';
        tmdbId: number | null;
        percentComplete: number;
        startedAt: string;
      }
    >();

    const communityMap = new Map<
      string,
      {
        title: string;
        year: number | null;
        mediaType: 'movie' | 'tv';
        tmdbId: number | null;
        serverNames: Set<string>;
        viewers: Set<string>;
        totalPlays: number;
        lastWatchedAt: string;
      }
    >();

    for (const h of allHistory) {
      const cleanTitle = (h.showTitle || h.title.replace(/\s*\(S\d+E\d+\)$/i, '')).trim();
      if (!cleanTitle || cleanTitle === 'Média') continue;
      const normTitle = norm(cleanTitle);
      if (!normTitle) continue;

      const isMeaningfulWatch = h.watched || h.percentComplete >= 45 || h.mediaType === 'tv';
      const itemKey = h.tmdbId && h.tmdbId > 0 ? `tmdb:${h.tmdbId}` : `title:${normTitle}`;
      const isCurrentUser = Boolean(targetUser && h.username.toLowerCase() === targetUser);

      if (isCurrentUser) {
        if (h.watched || h.percentComplete >= 35) {
          if (h.tmdbId && h.tmdbId > 0) {
            empty.watchedTmdbIds.add(h.tmdbId);
          }
          empty.watchedNormTitles.add(normTitle);
        }
        if (isMeaningfulWatch && !myRecentMap.has(itemKey) && myRecentMap.size < 10) {
          myRecentMap.set(itemKey, {
            title: cleanTitle,
            year: h.year,
            mediaType: h.mediaType,
            tmdbId: h.tmdbId,
            percentComplete: h.percentComplete,
            startedAt: h.startedAt
          });
        }
      } else if (isMeaningfulWatch) {
        const existing = communityMap.get(itemKey);
        if (!existing) {
          communityMap.set(itemKey, {
            title: cleanTitle,
            year: h.year,
            mediaType: h.mediaType,
            tmdbId: h.tmdbId,
            serverNames: new Set(h.serverName ? [h.serverName] : []),
            viewers: new Set([h.username.toLowerCase()]),
            totalPlays: 1,
            lastWatchedAt: h.startedAt
          });
        } else {
          if (h.serverName) existing.serverNames.add(h.serverName);
          existing.viewers.add(h.username.toLowerCase());
          existing.totalPlays += 1;
          if (h.startedAt > existing.lastWatchedAt) {
            existing.lastWatchedAt = h.startedAt;
          }
        }
      }
    }

    const communityPopular: TracearrCommunityPopularItem[] = [];
    for (const entry of communityMap.values()) {
      const normTitle = norm(entry.title);
      if (
        (entry.tmdbId && empty.watchedTmdbIds.has(entry.tmdbId)) ||
        empty.watchedNormTitles.has(normTitle)
      ) {
        continue;
      }
      communityPopular.push({
        title: entry.title,
        year: entry.year,
        mediaType: entry.mediaType,
        tmdbId: entry.tmdbId,
        serverNames: Array.from(entry.serverNames),
        distinctViewersCount: entry.viewers.size,
        totalPlays: entry.totalPlays,
        lastWatchedAt: entry.lastWatchedAt
      });
    }

    communityPopular.sort((a, b) => {
      if (b.distinctViewersCount !== a.distinctViewersCount) {
        return b.distinctViewersCount - a.distinctViewersCount;
      }
      if (b.totalPlays !== a.totalPlays) {
        return b.totalPlays - a.totalPlays;
      }
      return b.lastWatchedAt.localeCompare(a.lastWatchedAt);
    });

    return {
      myRecentWatched: Array.from(myRecentMap.values()),
      watchedTmdbIds: empty.watchedTmdbIds,
      watchedNormTitles: empty.watchedNormTitles,
      communityPopular: communityPopular.slice(0, 8)
    };
  }

  async getUserActivitySummaryMap(): Promise<Map<string, TracearrUserActivity>> {
    const map = new Map<string, TracearrUserActivity>();
    const history = await this.getWatchHistory({ limit: 100 });
    for (const item of history) {
      const key = item.username.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          username: item.username,
          recentPlaysCount: 1,
          lastWatchedTitle: item.title,
          lastWatchedAt: item.startedAt,
          lastServerName: item.serverName,
          lastDevice: item.device || item.platform || null
        });
      } else {
        existing.recentPlaysCount += 1;
      }
    }
    return map;
  }

  async getActiveStreams(): Promise<{
    total: number;
    transcodes: number;
    directPlays: number;
    streams: TracearrActiveStream[];
  }> {
    if (!this.isConfigured()) {
      return { total: 0, transcodes: 0, directPlays: 0, streams: [] };
    }

    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/v2/public/streams`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) {
        return { total: 0, transcodes: 0, directPlays: 0, streams: [] };
      }

      const json = (await res.json()) as {
        data?: Array<{
          server_name?: string;
          media_title?: string;
          show_title?: string | null;
          season_number?: number | null;
          episode_number?: number | null;
          device?: string | null;
          platform?: string | null;
          is_transcode?: boolean;
          percent_complete?: number;
          resolution?: string | null;
          user?: { username?: string };
        }>;
        summary?: {
          total?: number;
          transcodes?: number;
          direct_plays?: number;
        };
      };

      const streams: TracearrActiveStream[] = (json.data ?? []).map((s) => ({
        username: s.user?.username || 'inconnu',
        title: s.show_title
          ? `${s.show_title}${
              s.season_number != null && s.episode_number != null
                ? ` S${String(s.season_number).padStart(2, '0')}E${String(s.episode_number).padStart(2, '0')}`
                : ''
            }`
          : s.media_title || 'Média',
        serverName: s.server_name || 'Plex',
        device: s.device ?? null,
        platform: s.platform ?? null,
        isTranscode: Boolean(s.is_transcode),
        percentComplete: Math.round(s.percent_complete ?? 0),
        resolution: s.resolution ?? null
      }));

      return {
        total: json.summary?.total ?? streams.length,
        transcodes: json.summary?.transcodes ?? streams.filter((s) => s.isTranscode).length,
        directPlays: json.summary?.direct_plays ?? streams.filter((s) => !s.isTranscode).length,
        streams
      };
    } catch {
      return { total: 0, transcodes: 0, directPlays: 0, streams: [] };
    }
  }
}
