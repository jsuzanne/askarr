import dgram from 'node:dgram';
import type { PlexServerConfig } from '../config/env.js';
import type {
  MediaType,
  PlexMatchedItem,
  ProvenanceEntry,
  PlexPlayerDeviceDTO,
  PlexCastRequestDTO,
  PlexCastResponseDTO
} from '../../shared/types.js';

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
  private playersCache: { expiresAt: number; players: PlexPlayerDeviceDTO[] } | null = null;
  private commandCounter = 1;

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
    minYear?: number;
    maxYear?: number;
    limit?: number;
  }): Promise<{ items: PlexMetadataDetail[]; provenance: ProvenanceEntry[] }> {
    const limit = params.limit || 6;
    const minRating = params.minRating ?? (params.personFilter || params.yearFilter ? 0 : 7.0);
    const provenance: ProvenanceEntry[] = [];
    const results: PlexMetadataDetail[] = [];
    const personNorm = params.personFilter?.trim().toLowerCase();
    const isHighRatingOrPastEraQuery = Boolean(
      (params.minRating && params.minRating >= 8.0) ||
        (params.minYear && params.minYear < 2022) ||
        (params.maxYear && params.maxYear < 2023)
    );

    // NucVillers + NucBuntu couvrent 100% des 17 bibliothèques sans dupliquer 5 fois les appels sur le NAS
    const discoveryServers = this.servers.slice(0, 2);
    for (const srv of discoveryServers) {
      const t0 = Date.now();
      try {
        const sections = await this.getServerSections(srv);
        const sectionPriority = (title: string): number => {
          const k = normalizePlexLibraryKey(title);
          if (k === 'films' || k === 'seriestv') return 1; // Films & Séries récents en priorité absolue
          if (k === 'films4k') return 2;
          if (k === 'horror' || k === 'musical') return 3;
          if (k === 'cinephile' || k === 'filmslegacy') return 8; // Bibliothèques de films anciens / classiques
          return 10; // 'enfants', 'serieskids', 'truecrimes', 'videodivers' en dernier si non demandés explicitement
        };

        const stripAccents = (s: string) =>
          s
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

        const genreEquivalents = (gRaw: string): string[] => {
          const g = stripAccents(gRaw);
          if (g.includes('comed')) return ['comedie', 'comedy'];
          if (g.includes('dram')) return ['drame', 'drama'];
          if (g.includes('horr') || g.includes('epouvant')) return ['horreur', 'epouvante', 'horror'];
          if (g.includes('science') || g.includes('sci')) return ['science-fiction', 'science fiction', 'sci-fi'];
          if (g.includes('aventur') || g.includes('adventur')) return ['aventure', 'adventure'];
          if (g.includes('fantas')) return ['fantastique', 'fantasy'];
          if (g.includes('polic') || g.includes('crim')) return ['policier', 'crime', 'thriller'];
          return [g];
        };

        const isComedyGenre = Boolean(params.genre && stripAccents(params.genre).includes('comed'));
        const effectiveMinRating =
          params.minRating ??
          (params.personFilter || params.yearFilter ? 0 : isComedyGenre ? 6.2 : minRating);

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

        const containerSize =
          personNorm || params.yearFilter || params.minYear || params.maxYear || params.genre ? 150 : 60;
        const maxSectionsToInspect = isHighRatingOrPastEraQuery ? 4 : 3;
        for (const sec of matchingSections.slice(0, maxSectionsToInspect)) {
          const secKeyNorm = normalizePlexLibraryKey(sec.title);
          // Ne pas déborder dans les bibliothèques anciennes (Cinephile / FilmsLegacy) si on a déjà trouvé des films récents dans 'Films',
          // SAUF si l'utilisateur demande explicitement une note IMDb >= 8.0 ou une période antérieure (ex: 2010-2020)
          if (
            (secKeyNorm === 'cinephile' || secKeyNorm === 'filmslegacy') &&
            !params.libraryFilter &&
            !personNorm &&
            !isHighRatingOrPastEraQuery &&
            (!params.yearFilter || params.yearFilter >= 2020) &&
            results.length > 0
          ) {
            continue;
          }

          const yearParam = params.yearFilter ? `&year=${encodeURIComponent(String(params.yearFilter))}` : '';
          // Dans la bibliothèque récente 'Films', on trie par année décroissante par défaut, sauf si l'utilisateur cherche les meilleures notes IMDb (>= 8.0)
          const sortOrder =
            secKeyNorm === 'films' && !params.yearFilter && !personNorm && !isHighRatingOrPastEraQuery
              ? 'year:desc'
              : 'audienceRating:desc';
          const data = await this.fetchPlexJson<{
            MediaContainer?: { Metadata?: Array<Record<string, unknown>> };
          }>(
            srv.baseUrl,
            `/library/sections/${encodeURIComponent(sec.key)}/all?sort=${sortOrder}${yearParam}&X-Plex-Container-Start=0&X-Plex-Container-Size=${containerSize}`
          );

          for (const raw of data.MediaContainer?.Metadata || []) {
            const audienceRating = typeof raw.audienceRating === 'number' ? raw.audienceRating : null;
            const criticRating = typeof raw.rating === 'number' ? raw.rating : null;
            const bestRating = audienceRating ?? criticRating ?? 0;
            if (bestRating < effectiveMinRating) continue;

            const itemYear = typeof raw.year === 'number' ? raw.year : null;
            if (params.minYear && (!itemYear || itemYear < params.minYear)) continue;
            if (params.maxYear && (!itemYear || itemYear > params.maxYear)) continue;

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
              const targetTerms = genreEquivalents(params.genre);
              const matchesGenre =
                genres.some((g) => {
                  const gClean = stripAccents(g);
                  return targetTerms.some((term) => gClean.includes(term));
                }) ||
                targetTerms.some((term) => stripAccents(sec.title).includes(term));
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

            const maxCollectPerLoop = isHighRatingOrPastEraQuery ? limit * 2 : limit;
            if (results.length >= maxCollectPerLoop) break;
          }
          const maxCollectPerLoop = isHighRatingOrPastEraQuery ? limit * 2 : limit;
          if (results.length >= maxCollectPerLoop && !isHighRatingOrPastEraQuery) break;
        }

        provenance.push({
          source: `plex:${srv.name}`,
          status: 'ok',
          latencyMs: Date.now() - t0,
          detail: `Recommandations Plex (${results.length})`
        });

        if (results.length >= limit && !params.libraryFilter && !personNorm && !isHighRatingOrPastEraQuery) break;
      } catch (err) {
        provenance.push({
          source: `plex:${srv.name}`,
          status: 'error',
          latencyMs: Date.now() - t0,
          detail: err instanceof Error ? err.message : 'ERROR'
        });
      }
    }

    if (isHighRatingOrPastEraQuery) {
      results.sort((a, b) => {
        const ra = a.audienceRating ?? a.criticRating ?? 0;
        const rb = b.audienceRating ?? b.criticRating ?? 0;
        return rb - ra;
      });
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
    isOwnerAccount?: boolean;
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
    if (params.isAdmin || params.isOwnerAccount) {
      const realOwnerUsername =
        params.overseerrPlexUsername?.trim() ||
        params.aliasPlexEmail?.split('@')[0]?.trim() ||
        params.email?.split('@')[0]?.trim() ||
        'Propriétaire Plex';
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

  /**
   * Scan UDP GDM local (port 32412) pour détecter les lecteurs Plex actifs sur le LAN.
   */
  private async scanLocalGdmPlayers(unicastIps: string[] = []): Promise<
    Array<{
      clientIdentifier: string;
      name: string;
      product: string;
      version: string;
      address: string;
      port: number;
    }>
  > {
    return new Promise((resolve) => {
      const discovered = new Map<
        string,
        {
          clientIdentifier: string;
          name: string;
          product: string;
          version: string;
          address: string;
          port: number;
        }
      >();
      let socket: dgram.Socket | null = null;
      const finish = () => {
        if (socket) {
          try {
            socket.close();
          } catch {
            // ignore
          }
          socket = null;
        }
        resolve(Array.from(discovered.values()));
      };

      const timeout = setTimeout(finish, 420);
      try {
        socket = dgram.createSocket('udp4');
        socket.on('error', () => {
          clearTimeout(timeout);
          finish();
        });
        socket.on('message', (msg, rinfo) => {
          const text = msg.toString('utf8');
          if (!text.includes('200 OK') && !text.includes('Resource-Identifier:')) return;
          const headers: Record<string, string> = {};
          for (const line of text.split(/\r?\n/)) {
            const idx = line.indexOf(':');
            if (idx > 0) {
              headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
            }
          }
          const cid = headers['resource-identifier'];
          if (!cid) return;
          const port = Number(headers['port'] || 32500) || 32500;
          discovered.set(cid, {
            clientIdentifier: cid,
            name: headers['name'] || 'Plex Player',
            product: headers['product'] || 'Plex Player',
            version: headers['version'] || '',
            address: rinfo.address,
            port
          });
        });
        socket.bind(0, () => {
          if (!socket) return;
          try {
            socket.setBroadcast(true);
          } catch {
            // ignore
          }
          const packet = Buffer.from('M-SEARCH * HTTP/1.1\r\n\r\n');
          const targets = new Set<string>([
            '255.255.255.255',
            '239.0.0.250',
            '192.168.1.255',
            '192.168.10.255',
            ...unicastIps.filter(Boolean)
          ]);
          for (const ip of targets) {
            try {
              socket.send(packet, 0, packet.length, 32412, ip);
            } catch {
              // ignore
            }
          }
        });
      } catch {
        clearTimeout(timeout);
        finish();
      }
    });
  }

  /**
   * Détecte automatiquement les lecteurs Plex (Apple TV, Smart TV, PS5, Fire TV, iOS, Desktop)
   * en combinant :
   * 1) `GET /clients` sur chaque serveur Plex configuré
   * 2) `GET /status/sessions` (sessions de lecture actives) sur chaque serveur
   * 3) `https://plex.tv/devices.xml` & `https://plex.tv/api/v2/resources`
   * 4) Scan GDM UDP (32412) + Probe HTTP directe sur le port Companion local (`:32500/resources`)
   */
  public async discoverPlayers(options?: {
    forceRefresh?: boolean;
    plexUsername?: string | null;
  }): Promise<PlexPlayerDeviceDTO[]> {
    if (!this.plexToken) return [];
    const now = Date.now();
    if (!options?.forceRefresh && this.playersCache && this.playersCache.expiresAt > now) {
      return this.playersCache.players;
    }

    const byId = new Map<string, PlexPlayerDeviceDTO>();
    const candidateLanIps = new Set<string>();

    const upsertPlayer = (partial: Partial<PlexPlayerDeviceDTO> & { clientIdentifier: string }) => {
      const cid = partial.clientIdentifier.trim();
      if (!cid) return;
      const existing = byId.get(cid);
      const name = partial.name || existing?.name || 'Lecteur Plex';
      const product = partial.product || existing?.product || 'Plex';
      const platform = partial.platform || existing?.platform || '';
      const device = partial.device || existing?.device || platform || 'TV';
      const address = partial.address ?? existing?.address ?? null;
      const port = partial.port ?? existing?.port ?? null;
      const isOnline = Boolean(partial.isOnline || existing?.isOnline);
      const detectionSource =
        partial.isOnline && partial.detectionSource
          ? partial.detectionSource
          : existing?.isOnline && existing?.detectionSource
            ? existing.detectionSource
            : partial.detectionSource || existing?.detectionSource || 'cloud_registry';

      byId.set(cid, {
        clientIdentifier: cid,
        name,
        displayName: partial.displayName || existing?.displayName || name,
        product,
        platform,
        device,
        model: partial.model || existing?.model,
        isOnline,
        detectionSource,
        address,
        port,
        protocol: partial.protocol || existing?.protocol || 'http',
        localUri:
          partial.localUri ||
          existing?.localUri ||
          (address && port ? `http://${address}:${port}` : null),
        viaServerName: partial.viaServerName ?? existing?.viaServerName ?? null,
        activeUser: partial.activeUser ?? existing?.activeUser ?? null,
        playbackState: partial.playbackState ?? existing?.playbackState ?? null,
        nowPlayingTitle: partial.nowPlayingTitle ?? existing?.nowPlayingTitle ?? null,
        lastSeenAt: partial.lastSeenAt ?? existing?.lastSeenAt ?? null,
        provides: partial.provides ?? existing?.provides
      });
    };

    // 1. Cloud Registry (`plex.tv/devices.xml` + `plex.tv/api/v2/resources`)
    await Promise.all([
      (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        try {
          const res = await this.fetchImpl('https://plex.tv/devices.xml', {
            method: 'GET',
            headers: { 'X-Plex-Token': this.plexToken, Accept: 'application/xml' },
            signal: controller.signal
          });
          if (!res.ok) return;
          const xml = await res.text();
          const deviceRegex = /<Device\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/Device>)/g;
          let m: RegExpExecArray | null;
          while ((m = deviceRegex.exec(xml)) !== null) {
            const attrs = parseXmlAttributes(m[1] || '');
            const inner = m[2] || '';
            const cid = (attrs.clientIdentifier || '').trim();
            if (!cid) continue;
            const provides = (attrs.provides || '').toLowerCase();
            const product = attrs.product || '';
            const platform = attrs.platform || '';
            const device = attrs.device || '';
            if (provides.includes('server')) continue;

            const connRegex = /<Connection\s+([^>]*?)\/?>/g;
            let cm: RegExpExecArray | null;
            let localAddress: string | null = null;
            let localPort: number | null = null;
            let localUri: string | null = null;
            while ((cm = connRegex.exec(inner)) !== null) {
              const cAttrs = parseXmlAttributes(cm[1] || '');
              const uri = (cAttrs.uri || '').trim();
              if (!uri) continue;
              try {
                const parsed = new URL(uri);
                const host = parsed.hostname;
                const p = Number(parsed.port || 32500);
                if (
                  host.startsWith('192.168.') ||
                  host.startsWith('10.') ||
                  host.startsWith('172.')
                ) {
                  localAddress = host;
                  localPort = p;
                  localUri = uri;
                  candidateLanIps.add(host);
                }
              } catch {
                // ignore
              }
            }

            const isLikelyPlayer =
              provides.includes('player') ||
              product.toLowerCase().includes('apple tv') ||
              product.toLowerCase().includes('samsung') ||
              product.toLowerCase().includes('android') ||
              product.toLowerCase().includes('playstation') ||
              product.toLowerCase().includes('media player') ||
              product.toLowerCase().includes('htpc') ||
              platform.toLowerCase() === 'tvos' ||
              platform.toLowerCase() === 'tizen' ||
              Boolean(localPort === 32500 || localPort === 32433);

            if (!isLikelyPlayer) continue;

            const lastSeenEpoch = Number(attrs.lastSeenAt || 0);
            const lastSeenAt =
              lastSeenEpoch > 0 ? new Date(lastSeenEpoch * 1000).toISOString() : null;

            upsertPlayer({
              clientIdentifier: cid,
              name: attrs.name || product || 'Lecteur Plex',
              product,
              platform,
              device,
              model: attrs.model || undefined,
              isOnline: false,
              detectionSource: 'cloud_registry',
              address: localAddress,
              port: localPort,
              localUri,
              lastSeenAt,
              provides: attrs.provides
            });
          }
        } catch {
          // ignore
        } finally {
          clearTimeout(timer);
        }
      })(),
      (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await this.fetchImpl(
            'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1',
            {
              method: 'GET',
              headers: {
                'X-Plex-Token': this.plexToken,
                'X-Plex-Client-Identifier': 'askarr-cinema-controller',
                'X-Plex-Provides': 'controller',
                Accept: 'application/json'
              },
              signal: controller.signal
            }
          );
          if (!res.ok) return;
          const items = (await res.json()) as Array<Record<string, unknown>>;
          if (!Array.isArray(items)) return;
          for (const item of items) {
            const provides = String(item.provides || '');
            if (!provides.includes('player')) continue;
            const cid = String(item.clientIdentifier || '').trim();
            if (!cid) continue;
            const presence = Boolean(item.presence);
            let localAddress: string | null = null;
            let localPort: number | null = null;
            let localUri: string | null = null;
            if (Array.isArray(item.connections)) {
              for (const c of item.connections as Array<Record<string, unknown>>) {
                if (c.local && typeof c.address === 'string') {
                  localAddress = c.address;
                  localPort = Number(c.port || 32500);
                  localUri = typeof c.uri === 'string' ? c.uri : `http://${localAddress}:${localPort}`;
                  candidateLanIps.add(localAddress);
                  break;
                }
              }
            }
            upsertPlayer({
              clientIdentifier: cid,
              name: String(item.name || item.product || 'Plex Player'),
              product: String(item.product || 'Plex'),
              platform: String(item.platform || ''),
              device: String(item.device || ''),
              isOnline: presence,
              detectionSource: presence ? 'cloud_presence' : 'cloud_registry',
              address: localAddress,
              port: localPort,
              localUri,
              lastSeenAt: typeof item.lastSeenAt === 'string' ? item.lastSeenAt : null,
              provides
            });
          }
        } catch {
          // ignore
        } finally {
          clearTimeout(timer);
        }
      })()
    ]);

    // 2. Interrogation en parallèle de `/clients` et `/status/sessions` sur chaque serveur Plex configuré + GDM UDP
    await Promise.all([
      ...this.servers.map(async (srv) => {
        const base = srv.baseUrl.replace(/\/+$/, '');
        // 2a. GET /clients
        const ctrlClients = new AbortController();
        const tClients = setTimeout(() => ctrlClients.abort(), 1800);
        try {
          const res = await this.fetchImpl(`${base}/clients`, {
            method: 'GET',
            headers: {
              'X-Plex-Token': this.plexToken,
              Accept: 'application/json'
            },
            signal: ctrlClients.signal
          });
          if (res.ok) {
            const text = await res.text();
            if (text.trim().startsWith('{')) {
              const json = JSON.parse(text) as {
                MediaContainer?: { Server?: Array<Record<string, unknown>> };
              };
              const list = json.MediaContainer?.Server || [];
              for (const c of list) {
                const cid = String(c.machineIdentifier || c.clientIdentifier || '').trim();
                if (!cid) continue;
                const address = String(c.address || c.host || '').trim() || null;
                const port = Number(c.port || 32500) || 32500;
                if (address) candidateLanIps.add(address);
                upsertPlayer({
                  clientIdentifier: cid,
                  name: String(c.name || c.title || 'Plex Player'),
                  product: String(c.product || c.deviceClass || 'Plex Player'),
                  platform: String(c.platform || c.deviceClass || ''),
                  device: String(c.device || c.deviceClass || 'TV'),
                  isOnline: true,
                  detectionSource: 'pms_clients',
                  address,
                  port,
                  protocol: String(c.protocol || 'http'),
                  viaServerName: srv.name,
                  lastSeenAt: new Date().toISOString()
                });
              }
            }
          }
        } catch {
          // ignore
        } finally {
          clearTimeout(tClients);
        }

        // 2b. GET /status/sessions
        const ctrlSessions = new AbortController();
        const tSessions = setTimeout(() => ctrlSessions.abort(), 1800);
        try {
          const res = await this.fetchImpl(`${base}/status/sessions`, {
            method: 'GET',
            headers: {
              'X-Plex-Token': this.plexToken,
              Accept: 'application/json'
            },
            signal: ctrlSessions.signal
          });
          if (res.ok) {
            const text = await res.text();
            if (text.trim().startsWith('{')) {
              const json = JSON.parse(text) as {
                MediaContainer?: { Metadata?: Array<Record<string, unknown>> };
              };
              const list = json.MediaContainer?.Metadata || [];
              for (const meta of list) {
                const player = meta.Player as Record<string, unknown> | undefined;
                if (!player) continue;
                const cid = String(player.machineIdentifier || '').trim();
                if (!cid) continue;
                const userObj = meta.User as Record<string, unknown> | undefined;
                const activeUser = userObj ? String(userObj.title || userObj.name || '') : null;
                const rawAddr = String(player.address || '').trim();
                const isLanAddr =
                  rawAddr.startsWith('192.168.') ||
                  rawAddr.startsWith('10.') ||
                  rawAddr.startsWith('172.');
                const stateRaw = String(player.state || 'playing').toLowerCase();
                const playbackState =
                  stateRaw === 'paused'
                    ? 'paused'
                    : stateRaw === 'buffering'
                      ? 'buffering'
                      : 'playing';
                upsertPlayer({
                  clientIdentifier: cid,
                  name: String(player.title || player.device || 'Plex Player'),
                  product: String(player.product || 'Plex'),
                  platform: String(player.platform || ''),
                  device: String(player.device || player.platform || 'TV'),
                  isOnline: true,
                  detectionSource: 'active_session',
                  address: isLanAddr ? rawAddr : undefined,
                  port: isLanAddr ? 32500 : undefined,
                  viaServerName: srv.name,
                  activeUser,
                  playbackState,
                  nowPlayingTitle: String(meta.grandparentTitle || meta.title || ''),
                  lastSeenAt: new Date().toISOString()
                });
              }
            }
          }
        } catch {
          // ignore
        } finally {
          clearTimeout(tSessions);
        }
      }),
      (async () => {
        const gdmPlayers = await this.scanLocalGdmPlayers(Array.from(candidateLanIps));
        for (const gp of gdmPlayers) {
          upsertPlayer({
            clientIdentifier: gp.clientIdentifier,
            name: gp.name,
            product: gp.product,
            isOnline: true,
            detectionSource: 'gdm_lan',
            address: gp.address,
            port: gp.port,
            lastSeenAt: new Date().toISOString()
          });
        }
      })()
    ]);

    // 3. Probe HTTP directe rapide (650ms) sur les joueurs disposant d'une IP LAN (`:32500/resources`)
    const offlineWithLan = Array.from(byId.values()).filter(
      (p) => !p.isOnline && p.address && p.port
    );
    if (offlineWithLan.length > 0) {
      await Promise.all(
        offlineWithLan.map(async (p) => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 650);
          try {
            const probeUrl = `http://${p.address}:${p.port}/resources`;
            const res = await this.fetchImpl(probeUrl, {
              method: 'GET',
              headers: {
                'X-Plex-Token': this.plexToken,
                'X-Plex-Client-Identifier': 'askarr-cinema-controller'
              },
              signal: ctrl.signal
            });
            if (res.status === 200 || res.status === 401 || res.status === 406) {
              upsertPlayer({
                clientIdentifier: p.clientIdentifier,
                isOnline: true,
                detectionSource: 'lan_probe',
                lastSeenAt: new Date().toISOString()
              });
            }
          } catch {
            // Player asleep or Plex app closed
          } finally {
            clearTimeout(timer);
          }
        })
      );
    }

    // 4. Construction d'un displayName distinctif (ex: quand 2 Apple TV ont le même nom "Apple TV")
    const allPlayers = Array.from(byId.values());
    const nameCounts = new Map<string, number>();
    for (const p of allPlayers) {
      const k = p.name.trim().toLowerCase();
      nameCounts.set(k, (nameCounts.get(k) || 0) + 1);
    }
    for (const p of allPlayers) {
      const k = p.name.trim().toLowerCase();
      if ((nameCounts.get(k) || 0) > 1) {
        const suffixParts: string[] = [];
        if (p.address) {
          const lastOctet = p.address.split('.').slice(-2).join('.');
          suffixParts.push(`.${lastOctet}`);
        } else if (p.model) {
          suffixParts.push(`Gen ${p.model}`);
        } else {
          suffixParts.push(p.clientIdentifier.slice(0, 4));
        }
        p.displayName = `${p.name} (${suffixParts.join(' • ')})`;
      } else {
        p.displayName = p.name;
      }
    }

    // 5. Tri intelligent : En ligne d'abord -> TV/Apple TV/Salon en priorité -> vus récemment
    const isTvScreen = (p: PlexPlayerDeviceDTO) => {
      const s = `${p.name} ${p.product} ${p.platform} ${p.device}`.toLowerCase();
      return (
        s.includes('apple tv') ||
        s.includes('tvos') ||
        s.includes('tizen') ||
        s.includes('samsung') ||
        s.includes('android (tv)') ||
        s.includes('playstation') ||
        s.includes('ps5') ||
        s.includes('shield') ||
        s.includes('fire')
      );
    };

    const targetUser = (options?.plexUsername || '').trim().toLowerCase();
    allPlayers.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      if (targetUser) {
        const aMatch = (a.activeUser || '').toLowerCase() === targetUser;
        const bMatch = (b.activeUser || '').toLowerCase() === targetUser;
        if (aMatch !== bMatch) return aMatch ? -1 : 1;
      }
      const aTv = isTvScreen(a);
      const bTv = isTvScreen(b);
      if (aTv !== bTv) return aTv ? -1 : 1;
      const aTime = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
      const bTime = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
      return bTime - aTime;
    });

    const filtered = allPlayers.slice(0, 12);
    this.playersCache = {
      expiresAt: Date.now() + 5000,
      players: filtered
    };
    return filtered;
  }

  /**
   * Lance immédiatement un film ou une série sur un lecteur Plex (Apple TV, Smart TV, iOS, etc.)
   * via création d'une PlayQueue officielle + commande Plex Companion `/player/playback/playMedia`.
   */
  public async castMediaToPlayer(params: PlexCastRequestDTO): Promise<PlexCastResponseDTO> {
    const players = await this.discoverPlayers({ forceRefresh: false });
    const targetPlayer = players.find((p) => p.clientIdentifier === params.clientIdentifier);
    const playerName = targetPlayer?.displayName || targetPlayer?.name || 'Lecteur Plex';
    const playerAddress = params.playerAddress || targetPlayer?.address || null;
    const playerPort = params.playerPort || targetPlayer?.port || 32500;

    // Choix du serveur Plex source
    const requestedServerName = (params.serverName || '').trim();
    const targetServer =
      this.servers.find((s) => s.name.toLowerCase() === requestedServerName.toLowerCase()) ||
      this.servers[0];

    if (!targetServer || !this.plexToken) {
      return {
        ok: false,
        playerName,
        clientIdentifier: params.clientIdentifier,
        serverName: requestedServerName || 'Plex',
        ratingKey: params.ratingKey,
        resolvedKey: `/library/metadata/${params.ratingKey}`,
        playQueueId: null,
        deliveryMethod: 'none',
        messageFr: 'Serveur ou token Plex non configuré.'
      };
    }

    const serverName = targetServer.name;
    const base = targetServer.baseUrl.replace(/\/+$/, '');
    const parsedServerUrl = new URL(base);
    const machineIdentifier =
      PLEX_SERVER_MACHINE_IDS[serverName.trim().toLowerCase()] ||
      PLEX_SERVER_MACHINE_IDS.nucvillers;
    const deepLinks = buildPlexDeepLinks(serverName, params.ratingKey);

    // Si le player est sur le VLAN 192.168.10.x et que le serveur est NucVillers ou MacMini,
    // on fournit l'IP du serveur sur le même sous-réseau 192.168.10.x pour une connexion directe optimale
    let pmsAddressForPlayer = parsedServerUrl.hostname;
    if (playerAddress?.startsWith('192.168.10.')) {
      if (serverName.toLowerCase() === 'nucvillers') {
        pmsAddressForPlayer = '192.168.10.210';
      } else if (serverName.toLowerCase() === 'macmini') {
        pmsAddressForPlayer = '192.168.10.126';
      }
    }
    const pmsPortForPlayer = Number(parsedServerUrl.port || 32400);
    const pmsProtocolForPlayer = parsedServerUrl.protocol.replace(':', '') || 'http';

    // 1. Création de la PlayQueue sur le serveur Plex (indispensable pour tvOS / Apple TV)
    let playQueueId: number | null = null;
    let resolvedKey = `/library/metadata/${params.ratingKey}`;
    let resolvedOffsetMs = params.offsetMs ?? 0;

    try {
      const uri = `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${params.ratingKey}`;
      const pqUrl = `${base}/playQueues?type=video&continuous=1&repeat=0&own=1&includeChapters=1&includeMarkers=1&uri=${encodeURIComponent(uri)}`;
      const pqCtrl = new AbortController();
      const pqTimer = setTimeout(() => pqCtrl.abort(), 4000);
      try {
        const pqRes = await this.fetchImpl(pqUrl, {
          method: 'POST',
          headers: {
            'X-Plex-Token': this.plexToken,
            'X-Plex-Client-Identifier': 'askarr-cinema-controller',
            'X-Plex-Device-Name': 'Askarr Grand Cinema',
            Accept: 'application/json'
          },
          signal: pqCtrl.signal
        });
        if (pqRes.ok) {
          const pqJson = (await pqRes.json()) as {
            MediaContainer?: {
              playQueueID?: number;
              Metadata?: Array<{ key?: string; viewOffset?: number }>;
            };
          };
          if (typeof pqJson.MediaContainer?.playQueueID === 'number') {
            playQueueId = pqJson.MediaContainer.playQueueID;
          }
          const firstItem = pqJson.MediaContainer?.Metadata?.[0];
          if (firstItem?.key) {
            resolvedKey = firstItem.key;
          }
          if (
            params.offsetMs === undefined &&
            typeof firstItem?.viewOffset === 'number' &&
            firstItem.viewOffset > 0
          ) {
            resolvedOffsetMs = firstItem.viewOffset;
          }
        }
      } finally {
        clearTimeout(pqTimer);
      }
    } catch {
      // Fallback sans PlayQueue si l'appel échoue
    }

    const commandId = ++this.commandCounter;
    const queryParams = new URLSearchParams({
      key: resolvedKey,
      offset: String(resolvedOffsetMs),
      machineIdentifier,
      address: pmsAddressForPlayer,
      port: String(pmsPortForPlayer),
      protocol: pmsProtocolForPlayer,
      token: this.plexToken,
      type: 'video',
      commandID: String(commandId)
    });
    if (playQueueId) {
      queryParams.set('containerKey', `/playQueues/${playQueueId}?own=1&window=200`);
    }

    const companionHeaders: Record<string, string> = {
      'X-Plex-Token': this.plexToken,
      'X-Plex-Client-Identifier': 'askarr-cinema-controller',
      'X-Plex-Device-Name': 'Askarr Grand Cinema',
      'X-Plex-Product': 'Askarr',
      'X-Plex-Version': '1.2.7',
      'X-Plex-Platform': 'Web',
      'X-Plex-Provides': 'controller',
      'X-Plex-Target-Client-Identifier': params.clientIdentifier
    };

    // Stratégie 1 : Connexion Companion LAN directe vers le player (`http://<playerIp>:32500/player/playback/playMedia`)
    if (playerAddress && playerPort) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3200);
      try {
        const directUrl = `http://${playerAddress}:${playerPort}/player/playback/playMedia?${queryParams.toString()}`;
        const res = await this.fetchImpl(directUrl, {
          method: 'GET',
          headers: companionHeaders,
          signal: ctrl.signal
        });
        if (res.ok) {
          return {
            ok: true,
            playerName,
            clientIdentifier: params.clientIdentifier,
            serverName,
            ratingKey: params.ratingKey,
            resolvedKey,
            playQueueId,
            deliveryMethod: 'lan_direct',
            messageFr: `Lecture lancée directement sur ${playerName} (${serverName}) !`,
            plexIosDeepLink: deepLinks.plexIosDeepLink,
            plexWebUrl: deepLinks.plexWebUrl
          };
        }
      } catch {
        // On passe à la stratégie 2
      } finally {
        clearTimeout(timer);
      }
    }

    // Stratégie 2 : Proxy Companion via le(s) serveur(s) Plex Media Server
    const candidateServers = [
      targetServer,
      ...this.servers.filter((s) => s.name !== targetServer.name)
    ];
    for (const srv of candidateServers) {
      const srvBase = srv.baseUrl.replace(/\/+$/, '');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2200);
      try {
        const pmsUrl = `${srvBase}/player/playback/playMedia?${queryParams.toString()}`;
        const res = await this.fetchImpl(pmsUrl, {
          method: 'GET',
          headers: companionHeaders,
          signal: ctrl.signal
        });
        if (res.ok) {
          return {
            ok: true,
            playerName,
            clientIdentifier: params.clientIdentifier,
            serverName,
            ratingKey: params.ratingKey,
            resolvedKey,
            playQueueId,
            deliveryMethod: 'pms_proxy',
            messageFr: `Lecture envoyée à ${playerName} via ${srv.name} !`,
            plexIosDeepLink: deepLinks.plexIosDeepLink,
            plexWebUrl: deepLinks.plexWebUrl
          };
        }
      } catch {
        // continue
      } finally {
        clearTimeout(timer);
      }
    }

    // Stratégie 3 : Relais Cloud PubSub Plex.tv (`https://plex.tv/player/playback/playMedia`)
    {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const cloudUrl = `https://plex.tv/player/playback/playMedia?${queryParams.toString()}`;
        const res = await this.fetchImpl(cloudUrl, {
          method: 'GET',
          headers: companionHeaders,
          signal: ctrl.signal
        });
        if (res.ok) {
          return {
            ok: true,
            playerName,
            clientIdentifier: params.clientIdentifier,
            serverName,
            ratingKey: params.ratingKey,
            resolvedKey,
            playQueueId,
            deliveryMethod: 'cloud_pubsub',
            messageFr: `Signal de lecture transmis à ${playerName} via Plex Cloud !`,
            plexIosDeepLink: deepLinks.plexIosDeepLink,
            plexWebUrl: deepLinks.plexWebUrl
          };
        }
      } catch {
        // ignore
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      ok: false,
      playerName,
      clientIdentifier: params.clientIdentifier,
      serverName,
      ratingKey: params.ratingKey,
      resolvedKey,
      playQueueId,
      deliveryMethod: 'none',
      messageFr: `${playerName} ne répond pas encore sur le réseau. Assure-toi que l'application Plex est ouverte au premier plan sur l'écran (${playerName}), puis réessaie.`,
      plexIosDeepLink: deepLinks.plexIosDeepLink,
      plexWebUrl: deepLinks.plexWebUrl
    };
  }

  /**
   * Contrôle la lecture en cours (Pause / Lecture / Stop) sur un Plex Player.
   */
  public async controlPlayerPlayback(params: {
    clientIdentifier: string;
    action: 'pause' | 'play' | 'stop' | 'stepForward' | 'stepBack';
    playerAddress?: string | null;
    playerPort?: number | null;
  }): Promise<{ ok: boolean; messageFr: string }> {
    const players = await this.discoverPlayers({ forceRefresh: false });
    const targetPlayer = players.find((p) => p.clientIdentifier === params.clientIdentifier);
    const playerName = targetPlayer?.displayName || targetPlayer?.name || 'Lecteur Plex';
    const playerAddress = params.playerAddress || targetPlayer?.address || null;
    const playerPort = params.playerPort || targetPlayer?.port || 32500;
    const commandId = ++this.commandCounter;

    const headers: Record<string, string> = {
      'X-Plex-Token': this.plexToken,
      'X-Plex-Client-Identifier': 'askarr-cinema-controller',
      'X-Plex-Device-Name': 'Askarr Grand Cinema',
      'X-Plex-Provides': 'controller',
      'X-Plex-Target-Client-Identifier': params.clientIdentifier
    };

    const query = `type=video&commandID=${commandId}`;
    if (playerAddress && playerPort) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2200);
      try {
        const res = await this.fetchImpl(
          `http://${playerAddress}:${playerPort}/player/playback/${params.action}?${query}`,
          { method: 'GET', headers, signal: ctrl.signal }
        );
        if (res.ok) {
          return { ok: true, messageFr: `Commande ${params.action} envoyée à ${playerName}.` };
        }
      } catch {
        // continue
      } finally {
        clearTimeout(timer);
      }
    }

    for (const srv of this.servers) {
      const srvBase = srv.baseUrl.replace(/\/+$/, '');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1800);
      try {
        const res = await this.fetchImpl(
          `${srvBase}/player/playback/${params.action}?${query}`,
          { method: 'GET', headers, signal: ctrl.signal }
        );
        if (res.ok) {
          return { ok: true, messageFr: `Commande ${params.action} envoyée à ${playerName}.` };
        }
      } catch {
        // continue
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      ok: false,
      messageFr: `Impossible de joindre ${playerName} pour la commande ${params.action}.`
    };
  }
}
