import type { PlexServerConfig } from '../config/env.js';
import type { MediaType, PlexMatchedItem, ProvenanceEntry } from '../../shared/types.js';

export interface PlexSectionInfo {
  key: string;
  title: string;
  type: 'movie' | 'show' | string;
}

export interface PlexMetadataDetail {
  serverName: string;
  ratingKey: string;
  type: 'movie' | 'show';
  title: string;
  originalTitle: string | null;
  year: number | null;
  summary: string | null;
  librarySectionTitle: string;
  isSharedAcrossAllServers: boolean;
  guids: string[];
  audienceRating: number | null;
  criticRating: number | null;
  genres: string[];
  directors: string[];
  cast: string[];
  durationMinutes: number | null;
  seasons?: Array<{
    seasonNumber: number;
    episodeCount: number;
    title: string;
  }>;
}

const SHARED_LIBRARY_NAMES = new Set([
  'films',
  'séries tv',
  'series tv',
  'series',
  'enfants',
  'films legacy',
  'filmslegacy',
  'séries tv kids',
  'séries kids',
  'true crimes',
  'videodivers'
]);

export function normalizePlexLibraryKey(libraryTitle: string): string {
  const clean = libraryTitle
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  if (clean === 'series' || clean === 'seriestv') return 'seriestv';
  if (clean === 'seriestvkids' || clean === 'serieskids') return 'serieskids';
  return clean;
}

/**
 * Topologie exacte des bibliothèques sur les 5 serveurs Plex (NucVillers, NucBuntu, EQ12buntu, MacMini, Macmini4)
 */
const LIBRARY_SERVERS_TOPOLOGY: Record<string, string[]> = {
  films: ['NucVillers', 'NucBuntu', 'EQ12buntu', 'MacMini', 'Macmini4'],
  seriestv: ['NucVillers', 'NucBuntu', 'EQ12buntu', 'MacMini', 'Macmini4'],
  films4k: ['NucBuntu', 'EQ12buntu', 'MacMini'],
  filmslegacy: ['NucVillers', 'NucBuntu', 'MacMini'],
  videodivers: ['NucVillers', 'NucBuntu', 'MacMini'],
  enfants: ['NucVillers', 'NucBuntu'],
  truecrimes: ['NucVillers', 'NucBuntu'],
  serieskids: ['NucVillers', 'NucBuntu'],
  horror: ['NucBuntu', 'MacMini'],
  sports: ['NucBuntu', 'MacMini'],
  cinephile: ['NucBuntu'],
  musical: ['NucBuntu'],
  concerts: ['NucBuntu'],
  documentaires: ['NucBuntu'],
  hetznersport: ['NucBuntu'],
  progtv: ['NucBuntu'],
  videomaisonverte: ['NucBuntu'],
  vimeo: ['NucBuntu']
};

export const PLEX_SERVER_MACHINE_IDS: Record<string, string> = {
  nucvillers: 'f7e411a0b75062b5983ed9306434178dc4f1e57b',
  nucbuntu: '6f07724c3f2800fa4465117ccfbf3c5261431386',
  eq12buntu: '26c8abdd0ec0fedf2a2153a56c60703878442983',
  macmini: '3461d573b782f27de0b2f2eae02ca994848103f7',
  macmini4: '6c606a8576929339bb0690693046cfe1532a0c3a'
};

export function buildPlexDeepLinks(serverName: string, ratingKey: string): {
  machineIdentifier?: string;
  plexWebUrl: string;
  plexIosDeepLink: string;
} {
  const machineIdentifier = PLEX_SERVER_MACHINE_IDS[serverName.trim().toLowerCase()];
  const metadataKey = encodeURIComponent(`/library/metadata/${ratingKey}`);
  if (machineIdentifier) {
    return {
      machineIdentifier,
      plexWebUrl: `https://app.plex.tv/desktop/#!/server/${machineIdentifier}/details?key=${metadataKey}`,
      plexIosDeepLink: `plex://preplay/?metadataKey=${metadataKey}&server=${machineIdentifier}`
    };
  }
  return {
    plexWebUrl: 'https://app.plex.tv/desktop/',
    plexIosDeepLink: 'plex://'
  };
}

export function isSharedPlexLibraryName(libraryTitle: string): boolean {
  const key = normalizePlexLibraryKey(libraryTitle);
  const hosts = LIBRARY_SERVERS_TOPOLOGY[key];
  if (hosts) return hosts.length > 1;
  return SHARED_LIBRARY_NAMES.has(libraryTitle.trim().toLowerCase());
}

export interface PlexCloudSharedUser {
  plexUserId: number;
  username: string;
  title: string;
  email: string;
  thumb: string | null;
  allServerNames: string[];
  askarrServerNames: string[];
}

function parseXmlAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
  return attrs;
}

export class PlexMultiServerConnector {
  private sectionsCache = new Map<string, { expiresAt: number; sections: PlexSectionInfo[] }>();
  private sharedUsersCache: { expiresAt: number; users: PlexCloudSharedUser[] } | null = null;

  constructor(
    private servers: PlexServerConfig[],
    private plexToken: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  public getConfiguredServers(): PlexServerConfig[] {
    return this.servers;
  }

  public updateConfig(servers: PlexServerConfig[], plexToken?: string): void {
    this.servers = servers;
    if (typeof plexToken === 'string' && plexToken.trim() && !plexToken.includes('••••')) {
      this.plexToken = plexToken.trim();
    }
    this.sectionsCache.clear();
    this.sharedUsersCache = null;
  }

  /**
   * Auto-découvre tous les serveurs Plex appartenant au propriétaire du token via plex.tv/api/resources
   */
  public async discoverOwnedServers(plexTokenOverride?: string): Promise<
    Array<{
      name: string;
      baseUrl: string;
      machineIdentifier: string;
    }>
  > {
    const token =
      plexTokenOverride && plexTokenOverride.trim() && !plexTokenOverride.includes('••••')
        ? plexTokenOverride.trim()
        : this.plexToken;
    if (!token) {
      throw new Error('Aucun PLEX_TOKEN configuré pour interroger plex.tv.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await this.fetchImpl('https://plex.tv/api/resources?includeHttps=1&includeRelay=1', {
        method: 'GET',
        headers: {
          'X-Plex-Token': token,
          Accept: 'application/xml, text/xml, */*'
        },
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`PLEX_TV_HTTP_${res.status}`);
      }
      const xml = await res.text();
      const discovered: Array<{ name: string; baseUrl: string; machineIdentifier: string }> = [];
      const deviceRegex = /<Device\s+([^>]+)>([\s\S]*?)<\/Device>/g;
      let match: RegExpExecArray | null;
      while ((match = deviceRegex.exec(xml)) !== null) {
        const dAttrs = parseXmlAttributes(match[1]);
        const inner = match[2];
        if (!dAttrs.provides?.includes('server') || dAttrs.owned !== '1') continue;

        const name = (dAttrs.name || '').trim();
        const machineId = (dAttrs.clientIdentifier || '').trim();
        if (!name || !machineId) continue;

        PLEX_SERVER_MACHINE_IDS[name.toLowerCase()] = machineId;

        const connRegex = /<Connection\s+([^/>]+)\/?>/g;
        let cm: RegExpExecArray | null;
        const localCandidates: Array<{ address: string; port: string; uri: string }> = [];
        let fallbackUri = '';
        while ((cm = connRegex.exec(inner)) !== null) {
          const cAttrs = parseXmlAttributes(cm[1]);
          if (cAttrs.local === '1' && cAttrs.address && cAttrs.port) {
            localCandidates.push({
              address: cAttrs.address,
              port: cAttrs.port,
              uri: `http://${cAttrs.address}:${cAttrs.port}`
            });
          } else if (!fallbackUri && cAttrs.uri) {
            fallbackUri = cAttrs.uri;
          }
        }

        // Préférer le sous-réseau LAN principal 192.168.1.x puis toute IP locale
        const preferredLocal =
          localCandidates.find((c) => c.address.startsWith('192.168.1.')) ||
          localCandidates.find((c) => c.address.startsWith('192.168.')) ||
          localCandidates[0];

        const baseUrl = (preferredLocal?.uri || fallbackUri).replace(/\/+$/, '');
        if (baseUrl) {
          discovered.push({ name, baseUrl, machineIdentifier: machineId });
        }
      }
      return discovered;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Retourne la liste exacte des serveurs Plex configurés qui hébergent une bibliothèque donnée
   * (ex: "Films" -> 5 serveurs, "Films 4K" -> NucBuntu/EQ12buntu/MacMini, "Cinephile" -> NucBuntu).
   */
  public getServersHostingLibrary(libraryTitle: string, fallbackServerName?: string): string[] {
    const key = normalizePlexLibraryKey(libraryTitle);
    const configuredNames = this.servers.map((s) => s.name);

    // 1. Vérifier d'abord les sections réelles en cache si plusieurs serveurs ont déjà été inspectés
    const fromCache: string[] = [];
    for (const srv of this.servers) {
      const cached = this.sectionsCache.get(srv.name);
      if (cached && cached.sections.some((sec) => normalizePlexLibraryKey(sec.title) === key)) {
        fromCache.push(srv.name);
      }
    }

    // 2. Utiliser la topologie connue des 5 serveurs filtrée par les serveurs configurés
    const fromTopology = (LIBRARY_SERVERS_TOPOLOGY[key] || []).filter((name) =>
      configuredNames.some((c) => c.toLowerCase() === name.toLowerCase())
    );

    const merged = Array.from(new Set([...fromTopology, ...fromCache]));
    if (merged.length > 0) {
      return merged;
    }

    if (fallbackServerName) {
      return [fallbackServerName];
    }
    return configuredNames.slice(0, 1);
  }

  private async fetchPlexJson<T>(serverUrl: string, pathWithQuery: string, timeoutMs = 6500): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${serverUrl}${pathWithQuery}`, {
        method: 'GET',
        headers: {
          'X-Plex-Token': this.plexToken,
          Accept: 'application/json'
        },
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`PLEX_HTTP_${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  public async getServerSections(server: PlexServerConfig): Promise<PlexSectionInfo[]> {
    const cached = this.sectionsCache.get(server.name);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.sections;
    }
    const data = await this.fetchPlexJson<{
      MediaContainer?: { Directory?: Array<{ key: string; title: string; type: string }> };
    }>(server.baseUrl, '/library/sections');
    const dirs = data.MediaContainer?.Directory || [];
    const sections = dirs
      .filter((d) => d.type === 'movie' || d.type === 'show')
      .map((d) => ({ key: String(d.key), title: d.title, type: d.type }));
    this.sectionsCache.set(server.name, {
      expiresAt: Date.now() + 15 * 60 * 1000,
      sections
    });
    return sections;
  }

  public async checkHealth(): Promise<
    Array<{ serverName: string; baseUrl: string; ok: boolean; latencyMs: number; videoLibraries: string[]; error?: string }>
  > {
    return Promise.all(
      this.servers.map(async (srv) => {
        const t0 = Date.now();
        try {
          const sections = await this.getServerSections(srv);
          return {
            serverName: srv.name,
            baseUrl: srv.baseUrl,
            ok: true,
            latencyMs: Date.now() - t0,
            videoLibraries: sections.map((s) => s.title)
          };
        } catch (err) {
          return {
            serverName: srv.name,
            baseUrl: srv.baseUrl,
            ok: false,
            latencyMs: Date.now() - t0,
            videoLibraries: [],
            error: err instanceof Error ? err.message : 'UNKNOWN_ERROR'
          };
        }
      })
    );
  }

  public async getMetadataByRatingKey(server: PlexServerConfig, ratingKey: string, includeSeasons = false): Promise<PlexMetadataDetail | null> {
    const data = await this.fetchPlexJson<{
      MediaContainer?: { Metadata?: Array<Record<string, unknown>> };
    }>(server.baseUrl, `/library/metadata/${encodeURIComponent(ratingKey)}`);

    const item = data.MediaContainer?.Metadata?.[0];
    if (!item) return null;

    const guidsRaw = (item.Guid as Array<{ id?: string }> | undefined) || [];
    const guids = guidsRaw.map((g) => g.id || '').filter(Boolean);
    const libTitle = String(item.librarySectionTitle || 'Films');
    const type: 'movie' | 'show' = item.type === 'show' ? 'show' : 'movie';
    const durationMs = typeof item.duration === 'number' ? item.duration : null;

    const detail: PlexMetadataDetail = {
      serverName: server.name,
      ratingKey: String(item.ratingKey || ratingKey),
      type,
      title: String(item.title || ''),
      originalTitle: typeof item.originalTitle === 'string' ? item.originalTitle : null,
      year: typeof item.year === 'number' ? item.year : null,
      summary: typeof item.summary === 'string' ? item.summary : null,
      librarySectionTitle: libTitle,
      isSharedAcrossAllServers: isSharedPlexLibraryName(libTitle),
      guids,
      audienceRating: typeof item.audienceRating === 'number' ? item.audienceRating : null,
      criticRating: typeof item.rating === 'number' ? item.rating : null,
      genres: ((item.Genre as Array<{ tag?: string }> | undefined) || []).map((g) => g.tag || '').filter(Boolean),
      directors: ((item.Director as Array<{ tag?: string }> | undefined) || []).map((d) => d.tag || '').filter(Boolean),
      cast: ((item.Role as Array<{ tag?: string }> | undefined) || [])
        .slice(0, 5)
        .map((r) => r.tag || '')
        .filter(Boolean),
      durationMinutes: durationMs ? Math.round(durationMs / 60000) : null
    };

    if (includeSeasons && type === 'show') {
      const childrenData = await this.fetchPlexJson<{
        MediaContainer?: { Metadata?: Array<Record<string, unknown>> };
      }>(server.baseUrl, `/library/metadata/${encodeURIComponent(ratingKey)}/children`);
      const children = childrenData.MediaContainer?.Metadata || [];
      detail.seasons = children
        .filter((c) => typeof c.index === 'number' && c.index > 0)
        .map((c) => ({
          seasonNumber: Number(c.index),
          episodeCount: Number(c.leafCount || 0),
          title: String(c.title || `Saison ${c.index}`)
        }));
    }

    return detail;
  }

  private async searchOnSingleServer(
    server: PlexServerConfig,
    params: {
      tmdbId: number;
      tvdbId?: number | null;
      imdbId?: string | null;
      titleFr: string;
      originalTitle?: string | null;
      year?: number | null;
      mediaType: MediaType;
      includeSeasons?: boolean;
    }
  ): Promise<{ matched: PlexMetadataDetail[]; latencyMs: number }> {
    const t0 = Date.now();
    const queries = Array.from(
      new Set([params.titleFr.trim(), (params.originalTitle || '').trim()].filter((q) => q.length > 0))
    );

    const candidateRatingKeys = new Set<string>();
    const expectedPlexType = params.mediaType === 'tv' ? 'show' : 'movie';
    const targetTmdbGuid = `tmdb://${params.tmdbId}`;
    const targetTvdbGuid = params.tvdbId ? `tvdb://${params.tvdbId}` : null;
    const targetImdbGuid = params.imdbId ? `imdb://${params.imdbId}` : null;
    const normTitleFr = params.titleFr.trim().toLowerCase();
    const normOrig = (params.originalTitle || '').trim().toLowerCase();

    const searchResponses = await Promise.all(
      queries.map((q) => {
        const path = `/hubs/search?query=${encodeURIComponent(q)}&limit=10&includeGuids=1`;
        return this.fetchPlexJson<{
          MediaContainer?: {
            Hub?: Array<{
              type?: string;
              Metadata?: Array<{
                ratingKey?: string;
                type?: string;
                title?: string;
                originalTitle?: string;
                year?: number;
                Guid?: Array<{ id?: string }>;
              }>;
            }>;
          };
        }>(server.baseUrl, path);
      })
    );

    for (const data of searchResponses) {
      for (const hub of data.MediaContainer?.Hub || []) {
        if (hub.type === expectedPlexType || hub.type === 'movie' || hub.type === 'show') {
          for (const m of hub.Metadata || []) {
            if (!m.ratingKey || (m.type && m.type !== expectedPlexType)) continue;
            if (params.year && typeof m.year === 'number' && Math.abs(m.year - params.year) > 2) {
              continue;
            }
            // Si Plex renvoie directement les GUIDs dans /hubs/search?includeGuids=1,
            // on pré-filtre immédiatement pour éviter 5 appels HTTP getMetadataByRatingKey inutiles
            // sur des résultats partiels qui ne sont pas le film cherché (ex: "Le Rêve américain" absent).
            if (Array.isArray(m.Guid) && m.Guid.length > 0) {
              const inlineGuids = m.Guid.map((g) => String(g.id || '').toLowerCase());
              const hasGuidMatch = inlineGuids.some(
                (g) =>
                  g === targetTmdbGuid ||
                  (targetTvdbGuid && g === targetTvdbGuid) ||
                  (targetImdbGuid && g === targetImdbGuid)
              );
              const mTitleNorm = (m.title || '').trim().toLowerCase();
              const mOrigNorm = (m.originalTitle || '').trim().toLowerCase();
              const hasExactTitleMatch =
                (mTitleNorm && (mTitleNorm === normTitleFr || (normOrig && mTitleNorm === normOrig))) ||
                (mOrigNorm && (mOrigNorm === normTitleFr || (normOrig && mOrigNorm === normOrig)));
              if (!hasGuidMatch && !hasExactTitleMatch) {
                continue;
              }
            }
            candidateRatingKeys.add(String(m.ratingKey));
          }
        }
      }
    }

    const matched: PlexMetadataDetail[] = [];

    const keysToInspect = Array.from(candidateRatingKeys).slice(0, 5);
    const details = await Promise.all(
      keysToInspect.map((rk) => this.getMetadataByRatingKey(server, rk, Boolean(params.includeSeasons)))
    );

    for (const detail of details) {
      if (!detail || detail.type !== expectedPlexType) continue;

      const guidMatched = detail.guids.some(
        (g) => g === targetTmdbGuid || (targetTvdbGuid && g === targetTvdbGuid) || (targetImdbGuid && g === targetImdbGuid)
      );

      const detailTitleNorm = detail.title.trim().toLowerCase();
      const detailOrigNorm = (detail.originalTitle || '').trim().toLowerCase();

      const titleAndYearMatched =
        detail.guids.length === 0 &&
        (detailTitleNorm === normTitleFr ||
          (normOrig && detailTitleNorm === normOrig) ||
          (normOrig && detailOrigNorm === normOrig)) &&
        (!params.year || !detail.year || Math.abs(detail.year - params.year) <= 1);

      if (guidMatched || titleAndYearMatched) {
        matched.push(detail);
      }
    }

    return { matched, latencyMs: Date.now() - t0 };
  }

  /**
   * Interroge la fédération de serveurs Plex :
   * 1. Interroge le serveur de priorité 1 (NucVillers).
   * 2. Si trouvé sur NucVillers, retourne immédiatement sans solliciter NucBuntu.
   * 3. Si absent de NucVillers (ou si NucVillers est en erreur), interroge automatiquement
   *    les autres serveurs Plex configurés (ex. NucBuntu pour Cinephile, Films 4K, Horror, Musical).
   */
  public async findMediaAcrossServers(params: {
    tmdbId: number;
    tvdbId?: number | null;
    imdbId?: string | null;
    titleFr: string;
    originalTitle?: string | null;
    year?: number | null;
    mediaType: MediaType;
    includeSeasons?: boolean;
  }): Promise<{
    state: 'available_now' | 'not_in_catalog' | 'unknown';
    serversQueried: string[];
    matchedDetails: PlexMetadataDetail[];
    matchedItems: PlexMatchedItem[];
    provenance: ProvenanceEntry[];
  }> {
    const serversQueried: string[] = [];
    const matchedDetails: PlexMetadataDetail[] = [];
    const provenance: ProvenanceEntry[] = [];
    let anySuccess = false;

    if (this.servers.length === 0) {
      return {
        state: 'unknown',
        serversQueried: [],
        matchedDetails: [],
        matchedItems: [],
        provenance: [{ source: 'plex', status: 'error', latencyMs: 0, detail: 'Aucun serveur Plex configuré' }]
      };
    }

    // Étape 1 : Serveur primaire (NucVillers)
    const primary = this.servers[0];
    serversQueried.push(primary.name);
    try {
      const res1 = await this.searchOnSingleServer(primary, params);
      anySuccess = true;
      provenance.push({
        source: `plex:${primary.name}`,
        status: 'ok',
        latencyMs: res1.latencyMs,
        detail: `${res1.matched.length} correspondance(s)`
      });
      matchedDetails.push(...res1.matched);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ERROR';
      provenance.push({
        source: `plex:${primary.name}`,
        status: msg.includes('abort') ? 'timeout' : 'error',
        latencyMs: 0,
        detail: msg
      });
    }

    // Étape 2 : Si non trouvé sur le serveur primaire (NucVillers), on interroge NucBuntu (qui contient les 17 bibliothèques dont Cinephile/Horror/4K)
    if (matchedDetails.length === 0 && this.servers.length > 1) {
      const primaryCatalogFallback = this.servers[1];
      serversQueried.push(primaryCatalogFallback.name);
      let fallbackOk = false;
      try {
        const res2 = await this.searchOnSingleServer(primaryCatalogFallback, params);
        anySuccess = true;
        fallbackOk = true;
        provenance.push({
          source: `plex:${primaryCatalogFallback.name}`,
          status: 'ok',
          latencyMs: res2.latencyMs,
          detail: `${res2.matched.length} correspondance(s)`
        });
        matchedDetails.push(...res2.matched);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'ERROR';
        provenance.push({
          source: `plex:${primaryCatalogFallback.name}`,
          status: msg.includes('abort') ? 'timeout' : 'error',
          latencyMs: 0,
          detail: msg
        });
      }

      // Étape 3 : Uniquement si NucBuntu était injoignable, interroger les serveurs secondaires (EQ12buntu, MacMini, Macmini4)
      if (!fallbackOk && matchedDetails.length === 0 && this.servers.length > 2) {
        const extraServers = this.servers.slice(2);
        await Promise.all(
          extraServers.map(async (srv) => {
            serversQueried.push(srv.name);
            try {
              const res = await this.searchOnSingleServer(srv, params);
              anySuccess = true;
              provenance.push({
                source: `plex:${srv.name}`,
                status: 'ok',
                latencyMs: res.latencyMs,
                detail: `${res.matched.length} correspondance(s)`
              });
              matchedDetails.push(...res.matched);
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'ERROR';
              provenance.push({
                source: `plex:${srv.name}`,
                status: msg.includes('abort') ? 'timeout' : 'error',
                latencyMs: 0,
                detail: msg
              });
            }
          })
        );
      }
    }

    const matchedItems: PlexMatchedItem[] = matchedDetails.map((d) => ({
      serverName: d.serverName,
      ratingKey: d.ratingKey,
      libraryTitle: d.librarySectionTitle,
      isSharedAcrossAllServers: d.isSharedAcrossAllServers,
      title: d.title,
      originalTitle: d.originalTitle,
      year: d.year,
      ...buildPlexDeepLinks(d.serverName, d.ratingKey)
    }));

    return {
      state: matchedItems.length > 0 ? 'available_now' : anySuccess ? 'not_in_catalog' : 'unknown',
      serversQueried,
      matchedDetails,
      matchedItems,
      provenance
    };
  }

  /**
   * Explore et conseille des films/séries déjà présents sur les serveurs Plex
   * (y compris dans les bibliothèques spécialisées comme Cinephile, Horror, Films 4K sur NucBuntu).
   */
  public async discoverOnPlex(params: {
    mediaType: 'movie' | 'tv' | 'auto';
    genre?: string;
    minRating?: number;
    libraryFilter?: string;
    personFilter?: string;
    yearFilter?: number;
    limit?: number;
  }): Promise<{ items: PlexMetadataDetail[]; provenance: ProvenanceEntry[] }> {
    const limit = params.limit || 6;
    const minRating = params.minRating ?? (params.personFilter || params.yearFilter ? 0 : 7.0);
    const provenance: ProvenanceEntry[] = [];
    const results: PlexMetadataDetail[] = [];
    const personNorm = params.personFilter?.trim().toLowerCase();

    // NucVillers + NucBuntu couvrent 100% des 17 bibliothèques sans dupliquer 5 fois les appels sur le NAS
    const discoveryServers = this.servers.slice(0, 2);
    for (const srv of discoveryServers) {
      const t0 = Date.now();
      try {
        const sections = await this.getServerSections(srv);
        const sectionPriority = (title: string): number => {
          const k = normalizePlexLibraryKey(title);
          if (k === 'films' || k === 'seriestv') return 1;
          if (k === 'cinephile' || k === 'films4k') return 2;
          if (k === 'filmslegacy' || k === 'horror' || k === 'musical') return 3;
          return 10; // 'enfants', 'serieskids', 'truecrimes', 'videodivers' en dernier si non demandés explicitement
        };

        const matchingSections = sections
          .filter((s) => {
            if (params.libraryFilter) {
              return s.title.toLowerCase().includes(params.libraryFilter.trim().toLowerCase());
            }
            if (params.mediaType === 'movie') return s.type === 'movie';
            if (params.mediaType === 'tv') return s.type === 'show';
            return true;
          })
          .sort((a, b) => sectionPriority(a.title) - sectionPriority(b.title));

        const containerSize = personNorm || params.yearFilter ? 80 : 25;
        for (const sec of matchingSections.slice(0, 3)) {
          const yearParam = params.yearFilter ? `&year=${encodeURIComponent(String(params.yearFilter))}` : '';
          const data = await this.fetchPlexJson<{
            MediaContainer?: { Metadata?: Array<Record<string, unknown>> };
          }>(
            srv.baseUrl,
            `/library/sections/${encodeURIComponent(sec.key)}/all?sort=audienceRating:desc${yearParam}&X-Plex-Container-Start=0&X-Plex-Container-Size=${containerSize}`
          );

          for (const raw of data.MediaContainer?.Metadata || []) {
            const audienceRating = typeof raw.audienceRating === 'number' ? raw.audienceRating : null;
            const criticRating = typeof raw.rating === 'number' ? raw.rating : null;
            const bestRating = audienceRating ?? criticRating ?? 0;
            if (bestRating < minRating) continue;

            const genres = ((raw.Genre as Array<{ tag?: string }> | undefined) || [])
              .map((g) => g.tag || '')
              .filter(Boolean);
            const directors = ((raw.Director as Array<{ tag?: string }> | undefined) || [])
              .map((d) => d.tag || '')
              .filter(Boolean);
            const cast = ((raw.Role as Array<{ tag?: string }> | undefined) || [])
              .slice(0, 6)
              .map((r) => r.tag || '')
              .filter(Boolean);

            if (params.genre) {
              const gNorm = params.genre.trim().toLowerCase();
              const matchesGenre =
                genres.some((g) => g.toLowerCase().includes(gNorm)) ||
                sec.title.toLowerCase().includes(gNorm);
              if (!matchesGenre) continue;
            }

            if (personNorm) {
              const matchesPerson =
                directors.some((d) => d.toLowerCase().includes(personNorm)) ||
                cast.some((c) => c.toLowerCase().includes(personNorm));
              if (!matchesPerson) continue;
            }

            results.push({
              serverName: srv.name,
              ratingKey: String(raw.ratingKey || ''),
              type: sec.type === 'show' ? 'show' : 'movie',
              title: String(raw.title || ''),
              originalTitle: typeof raw.originalTitle === 'string' ? raw.originalTitle : null,
              year: typeof raw.year === 'number' ? raw.year : null,
              summary: typeof raw.summary === 'string' ? raw.summary : null,
              librarySectionTitle: sec.title,
              isSharedAcrossAllServers: isSharedPlexLibraryName(sec.title),
              guids: [],
              audienceRating,
              criticRating,
              genres,
              directors,
              cast: cast.slice(0, 4),
              durationMinutes: typeof raw.duration === 'number' ? Math.round(raw.duration / 60000) : null
            });

            if (results.length >= limit) break;
          }
          if (results.length >= limit) break;
        }

        provenance.push({
          source: `plex:${srv.name}`,
          status: 'ok',
          latencyMs: Date.now() - t0,
          detail: `Recommandations Plex (${results.length})`
        });

        if (results.length >= limit && !params.libraryFilter && !personNorm) break;
      } catch (err) {
        provenance.push({
          source: `plex:${srv.name}`,
          status: 'error',
          latencyMs: Date.now() - t0,
          detail: err instanceof Error ? err.message : 'ERROR'
        });
      }
    }

    return { items: results.slice(0, limit), provenance };
  }

  /**
   * Récupère l'annuaire complet des amis Plex directement depuis `https://plex.tv/api/users`
   * avec la liste exacte des serveurs Plex (`<Server name="..." />`) auxquels chaque utilisateur a accès.
   */
  public async getSharedUsersDirectory(forceRefresh = false): Promise<PlexCloudSharedUser[]> {
    if (!this.plexToken) return [];
    if (!forceRefresh && this.sharedUsersCache && this.sharedUsersCache.expiresAt > Date.now()) {
      return this.sharedUsersCache.users;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await this.fetchImpl('https://plex.tv/api/users', {
        method: 'GET',
        headers: {
          'X-Plex-Token': this.plexToken,
          Accept: 'application/xml'
        },
        signal: controller.signal
      });
      if (!res.ok) {
        return this.sharedUsersCache?.users || [];
      }
      const xml = await res.text();
      if (!xml.includes('<MediaContainer') && !xml.includes('<User')) {
        return this.sharedUsersCache?.users || [];
      }

      const configuredNames = this.servers.map((s) => s.name);
      const users: PlexCloudSharedUser[] = [];
      const userRegex = /<User\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/User>)/g;
      let match: RegExpExecArray | null;

      while ((match = userRegex.exec(xml)) !== null) {
        const userAttrs = parseXmlAttributes(match[1] || '');
        const innerXml = match[2] || '';
        const plexUserId = Number(userAttrs.id || 0);
        if (!plexUserId) continue;

        const serverNamesSet = new Set<string>();
        const serverRegex = /<Server\s+([^>]*?)\/?>/g;
        let srvMatch: RegExpExecArray | null;
        while ((srvMatch = serverRegex.exec(innerXml)) !== null) {
          const srvAttrs = parseXmlAttributes(srvMatch[1] || '');
          if (srvAttrs.name) {
            serverNamesSet.add(srvAttrs.name.trim());
          }
        }

        const allServerNames = Array.from(serverNamesSet);
        const askarrServerNames = configuredNames.filter((cfgName) =>
          allServerNames.some((s) => s.toLowerCase() === cfgName.toLowerCase())
        );

        const email = (userAttrs.email || '').trim().toLowerCase();
        const username = (userAttrs.username || userAttrs.title || `Plex #${plexUserId}`).trim();
        const title = (userAttrs.title || username).trim();

        users.push({
          plexUserId,
          username,
          title,
          email,
          thumb: userAttrs.thumb || null,
          allServerNames,
          askarrServerNames
        });
      }

      this.sharedUsersCache = {
        expiresAt: Date.now() + 10 * 60 * 1000,
        users
      };
      return users;
    } catch {
      return this.sharedUsersCache?.users || [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Résout les serveurs Plex auxquels un utilisateur (identifié par son email ou son pseudo Plex) a accès.
   */
  public async resolveUserPlexServerAccess(params: {
    email?: string | null;
    isAdmin?: boolean;
    overseerrPlexUsername?: string | null;
    aliasPlexEmail?: string | null;
  }): Promise<{
    plexUserId: number | null;
    plexUsername: string | null;
    allServerNames: string[];
    askarrServerNames: string[];
    configuredServerNames: string[];
  } | null> {
    const configuredServerNames = this.servers.map((s) => s.name);
    if (params.isAdmin) {
      const realOwnerUsername =
        params.overseerrPlexUsername?.trim() ||
        params.email?.split('@')[0]?.trim() ||
        'Admin Propriétaire Plex';
      return {
        plexUserId: 1,
        plexUsername: realOwnerUsername,
        allServerNames: configuredServerNames,
        askarrServerNames: configuredServerNames,
        configuredServerNames
      };
    }

    const candidatesEmails = [params.email, params.aliasPlexEmail]
      .filter((e): e is string => Boolean(e && e.trim()))
      .map((e) => e.trim().toLowerCase());
    const targetUsername = params.overseerrPlexUsername?.trim().toLowerCase() || '';

    if (candidatesEmails.length === 0 && !targetUsername) {
      return null;
    }

    const directory = await this.getSharedUsersDirectory(false);
    if (directory.length === 0) return null;

    const matched =
      directory.find((u) => u.email && candidatesEmails.includes(u.email.toLowerCase())) ||
      (targetUsername
        ? directory.find(
            (u) =>
              u.username.toLowerCase() === targetUsername ||
              u.title.toLowerCase() === targetUsername
          )
        : undefined);

    if (!matched) return null;

    return {
      plexUserId: matched.plexUserId,
      plexUsername: matched.username,
      allServerNames: matched.allServerNames,
      askarrServerNames: matched.askarrServerNames,
      configuredServerNames
    };
  }
}
