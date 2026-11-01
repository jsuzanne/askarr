import type {
  MediaEvidence,
  MediaType,
  ProvenanceEntry,
  SeasonCoverageItem
} from '../../shared/types.js';
import type { OverseerrConnector, OverseerrEnrichedDetail } from '../connectors/overseerr.connector.js';
import { buildPlexDeepLinks, type PlexMultiServerConnector, type PlexMetadataDetail } from '../connectors/plex.connector.js';
import type { RadarrConnector, RadarrMovieStatus, RadarrQueueItem } from '../connectors/radarr.connector.js';
import type { SonarrConnector, SonarrSeriesStatus, SonarrQueueItem } from '../connectors/sonarr.connector.js';
import type { ProwlarrConnector } from '../connectors/prowlarr.connector.js';

export function formatFrenchDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function addDaysIso(isoDate: string, days: number): string | null {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class MediaAggregatorService {
  constructor(
    private readonly overseerr: OverseerrConnector,
    private readonly plex: PlexMultiServerConnector,
    private readonly radarr: RadarrConnector,
    private readonly sonarr: SonarrConnector,
    private readonly prowlarr: ProwlarrConnector
  ) {}

  public async searchAndCheckMedia(params: {
    query: string;
    mediaType: 'movie' | 'tv' | 'auto';
    year?: number;
    currentUserEmail?: string;
    currentUserOverseerrId?: number | null;
    maxCandidates?: number;
    userQueryContext?: string;
  }): Promise<{
    query: string;
    exactMatchFound: boolean;
    disambiguationRequired: boolean;
    candidates: MediaEvidence[];
  }> {
    const maxCandidates = params.maxCandidates || 4;
    const localSearchQuery =
      params.userQueryContext && params.userQueryContext.trim().length > params.query.trim().length
        ? `${params.query} ${params.userQueryContext}`
        : params.query;
    const [rawCandidates, localCatalogMatches] = await Promise.all([
      this.overseerr.search(params.query, params.mediaType),
      this.searchLocalCatalogByKeywords({
        query: localSearchQuery,
        mediaType: params.mediaType,
        year: params.year,
        limit: 3
      })
    ]);

    const mergedRaw: Array<{ tmdbId: number; mediaType: MediaType; year: number | null; title: string }> = [];
    const seenKeys = new Set<string>();
    for (const loc of localCatalogMatches) {
      const k = `${loc.mediaType}:${loc.tmdbId}`;
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        mergedRaw.push(loc);
      }
    }
    for (const c of rawCandidates) {
      const k = `${c.mediaType}:${c.tmdbId}`;
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        mergedRaw.push({
          tmdbId: c.tmdbId,
          mediaType: c.mediaType,
          year: c.year,
          title: c.titleFr
        });
      }
    }

    const normTitle = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const normQuery = normTitle(params.query);
    const currentYear = new Date().getFullYear();

    let filtered = mergedRaw;
    if (params.year) {
      const yearMatches = mergedRaw.filter((c) => c.year && Math.abs(c.year - params.year!) <= 1);
      if (yearMatches.length > 0) filtered = yearMatches;
    } else {
      // Si aucune année n'est forcée, promouvoir en tête tout homonyme exact récent (sortie cinéma/VOD de l'année en cours ou précédente)
      filtered = [...mergedRaw].sort((a, b) => {
        const aExactRecent = normTitle(a.title) === normQuery && (a.year ?? 0) >= currentYear - 1 ? 1 : 0;
        const bExactRecent = normTitle(b.title) === normQuery && (b.year ?? 0) >= currentYear - 1 ? 1 : 0;
        return bExactRecent - aExactRecent;
      });
    }

    const topCandidates = filtered.slice(0, maxCandidates);
    const enriched = await Promise.all(
      topCandidates.map((c) =>
        this.buildMediaEvidence({
          tmdbId: c.tmdbId,
          mediaType: c.mediaType,
          currentUserEmail: params.currentUserEmail,
          currentUserOverseerrId: params.currentUserOverseerrId,
          includeSeasons: c.mediaType === 'tv',
          checkIndexers: false
        })
      )
    );

    const exactMatches = enriched.filter(
      (e) =>
        normTitle(e.identity.titleFr) === normQuery ||
        normTitle(e.identity.originalTitle) === normQuery
    );

    const finalCandidates =
      exactMatches.length === 1
        ? enriched.filter(
            (e) =>
              e.identity.tmdbId === exactMatches[0].identity.tmdbId ||
              e.catalogPresence.state === 'available_now' ||
              (e.identity.year ?? 0) >= currentYear - 1 ||
              normTitle(e.identity.titleFr).startsWith(`${normQuery} `)
          )
        : enriched;

    return {
      query: params.query,
      exactMatchFound: exactMatches.length === 1,
      disambiguationRequired: finalCandidates.length > 1 && exactMatches.length !== 1,
      candidates: finalCandidates
    };
  }

  /**
   * Scan ultra-rapide (< 2 ms en RAM) de l'index local Radarr (1 400+ films) et Sonarr
   * mis en cache mémoire pendant 10 minutes.
   * Permet de trouver un film récent ou suivi dans Radarr/Sonarr (ex: "Le Rêve américain" 2026)
   * même lorsque l'utilisateur le décrit par son sujet ("film français sur 2 agents de NBA / Wembanyama"
   * ou "film de zombie coréen") sans ralentir l'application ni interroger Plex sur tout le catalogue.
   */
  public async searchLocalCatalogByKeywords(params: {
    query: string;
    mediaType?: 'movie' | 'tv' | 'auto';
    year?: number;
    limit?: number;
  }): Promise<Array<{ tmdbId: number; mediaType: MediaType; year: number | null; title: string; score: number }>> {
    const limit = params.limit || 3;
    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const normQuery = norm(params.query || '');
    if (!normQuery || normQuery.length < 3) return [];

    const stopWords = new Set([
      'film',
      'films',
      'serie',
      'series',
      'sur',
      'avec',
      'dans',
      'les',
      'des',
      'une',
      'pour',
      'par',
      'qui',
      'que',
      'est',
      'sont',
      'sorti',
      'sortie',
      'recent',
      'recente',
      'nouveau',
      'nouvelle',
      'histoire',
      'parle',
      'deux',
      'trois',
      'avoir',
      'dispo',
      'disponible',
      'plex'
    ]);

    const rawTokens = normQuery
      .split(/\s+/)
      .filter((t) => (t.length >= 3 || t === 'nb' || t === 'us') && !stopWords.has(t));

    // Expansion sémantique légère pour les requêtes descriptives fréquentes
    const expandedTokens = new Set<string>(rawTokens);
    if (
      expandedTokens.has('wembanyama') ||
      expandedTokens.has('wemby') ||
      expandedTokens.has('nba') ||
      expandedTokens.has('basket') ||
      expandedTokens.has('basketball')
    ) {
      expandedTokens.add('nba');
      expandedTokens.add('basket');
      expandedTokens.add('agents');
      expandedTokens.add('americain');
      expandedTokens.add('bouna');
      expandedTokens.add('jeremy');
    }
    if (expandedTokens.has('coreen') || expandedTokens.has('coreenne') || expandedTokens.has('coree')) {
      expandedTokens.add('korean');
      expandedTokens.add('busan');
      expandedTokens.add('seoul');
    }

    const wantsFrench =
      normQuery.includes('francais') || normQuery.includes('francaise') || normQuery.includes('france');
    const wantsKorean =
      normQuery.includes('coreen') || normQuery.includes('coreenne') || normQuery.includes('coree');

    const matches: Array<{
      tmdbId: number;
      mediaType: MediaType;
      year: number | null;
      title: string;
      score: number;
    }> = [];

    const includeMovies = !params.mediaType || params.mediaType === 'auto' || params.mediaType === 'movie';
    const includeTv = !params.mediaType || params.mediaType === 'auto' || params.mediaType === 'tv';

    if (includeMovies && typeof (this.radarr as unknown as { getCatalogIndex?: unknown }).getCatalogIndex === 'function') {
      try {
        const { movies } = await this.radarr.getCatalogIndex();
        for (const m of movies) {
          if (!m.tmdbId || m.tmdbId <= 0) continue;
          if (params.year && m.year && Math.abs(m.year - params.year) > 2) continue;

          const normTitle = norm(m.title);
          const normOrig = norm(m.originalTitle || '');
          const normAlt = (m.alternateTitles || []).map((a) => norm(a)).join(' ');
          const normOverview = norm(m.overview || '');
          const normLang = norm(m.originalLanguage || '');

          let score = 0;
          if (normTitle === normQuery || (normOrig && normOrig === normQuery)) {
            score += 100;
          } else if (normTitle.includes(normQuery) || (normOrig && normOrig.includes(normQuery))) {
            score += 60;
          }

          let matchedTokens = 0;
          for (const tok of expandedTokens) {
            let tokHit = false;
            if (normTitle.includes(tok) || normOrig.includes(tok) || normAlt.includes(tok)) {
              score += 18;
              tokHit = true;
            }
            if (normOverview.includes(tok)) {
              score += 14;
              tokHit = true;
            }
            if (tokHit) matchedTokens++;
          }

          if (wantsFrench && (normLang === 'french' || normLang === 'fr')) {
            score += matchedTokens > 0 ? 12 : 0;
          }
          if (wantsKorean && (normLang === 'korean' || normLang === 'ko')) {
            score += matchedTokens > 0 ? 15 : 0;
          }
          if (matchedTokens >= 2 && m.year && m.year >= new Date().getFullYear() - 1) {
            score += 6;
          }

          if (score >= 28) {
            matches.push({
              tmdbId: m.tmdbId,
              mediaType: 'movie',
              year: m.year,
              title: m.title,
              score
            });
          }
        }
      } catch {
        // Ignorer silencieusement si Radarr est injoignable ou mocké partiellement
      }
    }

    if (includeTv && typeof (this.sonarr as unknown as { getCatalogIndex?: unknown }).getCatalogIndex === 'function') {
      try {
        const { series } = await this.sonarr.getCatalogIndex();
        for (const s of series) {
          if (!s.tmdbId || s.tmdbId <= 0) continue;
          if (params.year && s.year && Math.abs(s.year - params.year) > 2) continue;

          const normTitle = norm(s.title);
          const normAlt = (s.alternateTitles || []).map((a) => norm(a)).join(' ');
          const normOverview = norm(s.overview || '');

          let score = 0;
          if (normTitle === normQuery) {
            score += 100;
          } else if (normTitle.includes(normQuery)) {
            score += 60;
          }

          for (const tok of expandedTokens) {
            if (normTitle.includes(tok) || normAlt.includes(tok)) score += 18;
            if (normOverview.includes(tok)) score += 14;
          }

          if (score >= 28) {
            matches.push({
              tmdbId: s.tmdbId,
              mediaType: 'tv',
              year: s.year,
              title: s.title,
              score
            });
          }
        }
      } catch {
        // Ignorer silencieusement
      }
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  public async buildMediaEvidence(params: {
    tmdbId: number;
    mediaType: MediaType;
    currentUserEmail?: string;
    currentUserOverseerrId?: number | null;
    includeSeasons?: boolean;
    checkIndexers?: boolean;
    knownPlexHint?: { serverNames: string[]; libraryTitle?: string };
    knownRequestHint?: {
      requestId: number;
      requestedAt: string | null;
      requestedByEmail: string | null;
      requestedByDisplayName: string | null;
    };
  }): Promise<MediaEvidence> {
    const provenance: ProvenanceEntry[] = [];

    // 1. Détail Overseerr / TMDB (identité FR + VO, notes TMDB, genres, acteurs, dates de sortie FR/US)
    const tOs = Date.now();
    let osDetail: OverseerrEnrichedDetail;
    try {
      osDetail = await this.overseerr.getMediaDetail(params.tmdbId, params.mediaType);
      provenance.push({
        source: 'overseerr',
        status: 'ok',
        latencyMs: Date.now() - tOs,
        detail: `${osDetail.titleFr} (TMDB ${osDetail.tmdbId})`
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ERROR';
      provenance.push({
        source: 'overseerr',
        status: msg.includes('abort') ? 'timeout' : 'error',
        latencyMs: Date.now() - tOs,
        detail: msg
      });
      throw err;
    }

    const hasKnownPlexHint =
      params.knownPlexHint &&
      Array.isArray(params.knownPlexHint.serverNames) &&
      params.knownPlexHint.serverNames.length > 0;

    // 2. En parallèle : Fédération Multi-Serveurs Plex + Radarr (si film) ou Sonarr (si série)
    // Si Tracearr nous a déjà fourni les serveurs Plex exacts (knownPlexHint), on évite les 5 requêtes Plex + Radarr redondantes !
    const plexPromise = hasKnownPlexHint
      ? Promise.resolve({
          state: 'available_now' as const,
          serversQueried: params.knownPlexHint!.serverNames,
          matchedItems: params.knownPlexHint!.serverNames.map((srv) => {
            const links = buildPlexDeepLinks(srv, '');
            return {
              serverName: srv,
              ratingKey: '',
              title: osDetail.titleFr,
              originalTitle: osDetail.originalTitle,
              year: osDetail.year,
              libraryTitle:
                params.knownPlexHint!.libraryTitle ||
                (osDetail.mediaType === 'tv' ? 'Séries TV' : 'Films'),
              isSharedAcrossAllServers: params.knownPlexHint!.serverNames.length > 1,
              machineIdentifier: links.machineIdentifier,
              plexWebUrl: 'https://app.plex.tv/desktop/',
              plexIosDeepLink: 'plex://'
            };
          }),
          matchedDetails: [] as PlexMetadataDetail[],
          provenance: [] as ProvenanceEntry[]
        })
      : this.plex.findMediaAcrossServers({
          tmdbId: osDetail.tmdbId,
          tvdbId: osDetail.tvdbId,
          imdbId: osDetail.imdbId,
          titleFr: osDetail.titleFr,
          originalTitle: osDetail.originalTitle,
          year: osDetail.year,
          mediaType: osDetail.mediaType,
          includeSeasons: Boolean(params.includeSeasons || osDetail.mediaType === 'tv')
        });

    let radarrMovie = null as RadarrMovieStatus | null;
    let radarrQueue = null as RadarrQueueItem | null;
    let radarrError = false;

    let sonarrSeries = null as SonarrSeriesStatus | null;
    let sonarrQueue = null as SonarrQueueItem | null;
    let sonarrError = false;

    const arrPromise = (async () => {
      if (hasKnownPlexHint) {
        return;
      }
      if (osDetail.mediaType === 'movie') {
        const t0 = Date.now();
        try {
          const res = await this.radarr.getMovieByTmdbId(osDetail.tmdbId);
          radarrMovie = res.movie;
          if (radarrMovie && !radarrMovie.hasFile) {
            radarrQueue = await this.radarr.getQueueForMovie(radarrMovie.id);
          }
          provenance.push({
            source: 'radarr',
            status: 'ok',
            latencyMs: Date.now() - t0,
            detail: radarrMovie
              ? `monitored=${radarrMovie.monitored}, hasFile=${radarrMovie.hasFile}`
              : 'Non présent dans Radarr'
          });
        } catch (err) {
          radarrError = true;
          const msg = err instanceof Error ? err.message : 'ERROR';
          provenance.push({
            source: 'radarr',
            status: msg.includes('abort') ? 'timeout' : 'error',
            latencyMs: Date.now() - t0,
            detail: msg
          });
        }
      } else if (osDetail.tvdbId) {
        const t0 = Date.now();
        try {
          const res = await this.sonarr.getSeriesByTvdbId(osDetail.tvdbId);
          sonarrSeries = res.series;
          if (sonarrSeries) {
            sonarrQueue = await this.sonarr.getQueueForSeries(sonarrSeries.id);
          }
          provenance.push({
            source: 'sonarr',
            status: 'ok',
            latencyMs: Date.now() - t0,
            detail: sonarrSeries ? `monitored=${sonarrSeries.monitored}` : 'Non présent dans Sonarr'
          });
        } catch (err) {
          sonarrError = true;
          const msg = err instanceof Error ? err.message : 'ERROR';
          provenance.push({
            source: 'sonarr',
            status: msg.includes('abort') ? 'timeout' : 'error',
            latencyMs: Date.now() - t0,
            detail: msg
          });
        }
      }
    })();

    const [plexResult] = await Promise.all([plexPromise, arrPromise]);
    provenance.push(...plexResult.provenance);

    const firstPlexDetail: PlexMetadataDetail | undefined = plexResult.matchedDetails[0];

    // 3. Calcul des dates de sortie Cinéma / VOD / DVD (fusion Radarr + TMDB + estimation à +120j si en salle)
    const inCinemas = radarrMovie?.inCinemas || osDetail.tmdbReleases.inCinemas || null;
    const digitalRelease = radarrMovie?.digitalRelease || osDetail.tmdbReleases.digitalRelease || null;
    const physicalRelease = radarrMovie?.physicalRelease || osDetail.tmdbReleases.physicalRelease || null;

    let estimatedVodOrDvdDate: string | null = digitalRelease || physicalRelease || null;
    let isEstimatedDate = false;
    if (!estimatedVodOrDvdDate && inCinemas && osDetail.mediaType === 'movie') {
      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (inCinemas >= sixMonthsAgo) {
        estimatedVodOrDvdDate = addDaysIso(inCinemas, 120);
        isEstimatedDate = Boolean(estimatedVodOrDvdDate);
      }
    }

    // 4. Couverture par saison (Séries TV)
    let episodeCoverage: MediaEvidence['episodeCoverage'] = null;
    let catalogState: MediaEvidence['catalogPresence']['state'] = plexResult.state;

    if (osDetail.mediaType === 'tv') {
      const plexSeasonMap = new Map<number, { count: number; servers: Set<string> }>();
      for (const detail of plexResult.matchedDetails) {
        for (const s of detail.seasons || []) {
          const cur = plexSeasonMap.get(s.seasonNumber) || { count: 0, servers: new Set<string>() };
          cur.count = Math.max(cur.count, s.episodeCount);
          cur.servers.add(detail.serverName);
          plexSeasonMap.set(s.seasonNumber, cur);
        }
      }

      const sonarrSeasonMap = new Map<number, { fileCount: number; totalCount: number; monitored: boolean }>();
      for (const s of sonarrSeries?.seasons || []) {
        sonarrSeasonMap.set(s.seasonNumber, {
          fileCount: s.episodeFileCount,
          totalCount: s.totalEpisodeCount || s.episodeCount,
          monitored: s.monitored
        });
      }

      const seasons: SeasonCoverageItem[] = osDetail.seasonsMeta.map((meta) => {
        const pInfo = plexSeasonMap.get(meta.seasonNumber);
        const sInfo = sonarrSeasonMap.get(meta.seasonNumber);
        const plexEpCount = pInfo?.count || 0;
        const sonarrFileCount = sInfo?.fileCount || 0;
        const totalEpCount = sInfo?.totalCount || meta.episodeCount || 0;
        const monitoredInSonarr = Boolean(sInfo?.monitored);
        const requestedInOverseerr =
          osDetail.requestInfo.requestedSeasons.includes(meta.seasonNumber) ||
          (meta.overseerrStatus !== null && meta.overseerrStatus >= 2);

        let state: SeasonCoverageItem['state'] = 'not_requested';
        if (plexEpCount > 0 && (totalEpCount === 0 || plexEpCount >= totalEpCount)) {
          state = 'available_on_plex';
        } else if (plexEpCount > 0 || sonarrFileCount > 0) {
          state = 'partially_available';
        } else if (monitoredInSonarr || requestedInOverseerr) {
          state = 'requested_or_monitored';
        }

        return {
          seasonNumber: meta.seasonNumber,
          state,
          plexEpisodeCount: plexEpCount,
          sonarrEpisodeFileCount: sonarrFileCount,
          totalEpisodeCount: totalEpCount,
          monitoredInSonarr,
          requestedInOverseerr,
          availableOnPlexServers: pInfo ? Array.from(pInfo.servers) : []
        };
      });

      episodeCoverage = {
        totalSeasons: osDetail.totalSeasons || seasons.length,
        seasons
      };

      const availableSeasons = seasons.filter((s) => s.state === 'available_on_plex').length;
      const partialSeasons = seasons.filter((s) => s.state === 'partially_available').length;
      if (availableSeasons > 0 && availableSeasons < seasons.length) {
        catalogState = 'partially_available';
      } else if (partialSeasons > 0 && availableSeasons === 0) {
        catalogState = 'partially_available';
      }
    }

    // 5. État de la demande dans Overseerr
    let reqState: MediaEvidence['requestState']['state'] = 'not_requested';
    if (osDetail.requestInfo.mediaStatus === 5 || osDetail.requestInfo.latestRequestStatus === 5) {
      reqState = 'available';
    } else if (osDetail.requestInfo.latestRequestStatus === 3) {
      reqState = 'declined';
    } else if (osDetail.requestInfo.latestRequestStatus === 2 || osDetail.requestInfo.mediaStatus === 3 || osDetail.requestInfo.mediaStatus === 4) {
      reqState = 'approved_processing';
    } else if (osDetail.requestInfo.latestRequestStatus === 1 || osDetail.requestInfo.mediaStatus === 2) {
      reqState = 'pending_approval';
    }

    const effectiveRequestId = osDetail.requestInfo.latestRequestId ?? params.knownRequestHint?.requestId ?? null;
    const effectiveRequestedByEmail =
      osDetail.requestInfo.requestedByEmail || params.knownRequestHint?.requestedByEmail || null;
    const effectiveRequestedBy =
      osDetail.requestInfo.requestedByDisplayName || params.knownRequestHint?.requestedByDisplayName || null;

    const requestedByCurrentUser = Boolean(
      (params.currentUserOverseerrId && osDetail.requestInfo.requestedByUserId === params.currentUserOverseerrId) ||
        (params.currentUserEmail && effectiveRequestedByEmail === params.currentUserEmail.toLowerCase())
    );

    // 6. Pipeline d'acquisition Radarr / Sonarr
    let acqState: MediaEvidence['acquisitionPipeline']['state'] = 'not_in_arr';
    let estimatedAvailabilityDate: string | null = null;
    let estimatedAvailabilityReason: MediaEvidence['acquisitionPipeline']['estimatedAvailabilityReason'] = null;
    let queueProgressPercent: number | null = null;
    let queueTimeleft: string | null = null;

    const nowIso = new Date().toISOString().slice(0, 10);

    if (osDetail.mediaType === 'movie') {
      if (radarrError) {
        acqState = 'unknown';
      } else if (radarrMovie) {
        if (radarrMovie.hasFile) {
          acqState = 'imported_on_disk';
        } else if (radarrQueue) {
          const pct =
            radarrQueue.size > 0
              ? Math.max(0, Math.min(100, Math.round(((radarrQueue.size - radarrQueue.sizeleft) / radarrQueue.size) * 100)))
              : 0;
          queueProgressPercent = pct;
          queueTimeleft = radarrQueue.timeleft;
          acqState =
            radarrQueue.trackedDownloadStatus === 'warning' || radarrQueue.trackedDownloadStatus === 'error'
              ? 'download_warning_or_error'
              : 'downloading';
        } else if (radarrMovie.monitored) {
          if (digitalRelease && digitalRelease > nowIso) {
            acqState = 'monitored_waiting_release';
            estimatedAvailabilityDate = digitalRelease;
            estimatedAvailabilityReason = 'digital_release';
          } else if (physicalRelease && physicalRelease > nowIso) {
            acqState = 'monitored_waiting_release';
            estimatedAvailabilityDate = physicalRelease;
            estimatedAvailabilityReason = 'physical_release';
          } else if (estimatedVodOrDvdDate && estimatedVodOrDvdDate > nowIso) {
            acqState = 'monitored_waiting_release';
            estimatedAvailabilityDate = estimatedVodOrDvdDate;
            estimatedAvailabilityReason = isEstimatedDate ? 'estimated_from_cinema' : 'digital_release';
          } else if (inCinemas && inCinemas > nowIso) {
            acqState = 'monitored_waiting_release';
            estimatedAvailabilityDate = inCinemas;
            estimatedAvailabilityReason = 'cinema_release';
          } else {
            acqState = 'monitored_searching';
          }
        } else {
          acqState = 'unmonitored_no_file';
        }
      } else if (estimatedVodOrDvdDate && estimatedVodOrDvdDate > nowIso) {
        estimatedAvailabilityDate = estimatedVodOrDvdDate;
        estimatedAvailabilityReason = isEstimatedDate
          ? 'estimated_from_cinema'
          : digitalRelease
            ? 'digital_release'
            : 'physical_release';
      }
    } else {
      if (sonarrError) {
        acqState = 'unknown';
      } else if (sonarrSeries) {
        const totalFiles = sonarrSeries.seasons.reduce((acc, s) => acc + s.episodeFileCount, 0);
        if (sonarrQueue) {
          const pct =
            sonarrQueue.size > 0
              ? Math.max(0, Math.min(100, Math.round(((sonarrQueue.size - sonarrQueue.sizeleft) / sonarrQueue.size) * 100)))
              : 0;
          queueProgressPercent = pct;
          queueTimeleft = sonarrQueue.timeleft;
          acqState = 'downloading';
        } else if (totalFiles > 0) {
          acqState = 'imported_on_disk';
        } else if (sonarrSeries.monitored) {
          if (sonarrSeries.nextAiring && sonarrSeries.nextAiring > nowIso) {
            acqState = 'monitored_waiting_release';
            estimatedAvailabilityDate = sonarrSeries.nextAiring;
            estimatedAvailabilityReason = 'next_airing';
          } else {
            acqState = 'monitored_searching';
          }
        } else {
          acqState = 'unmonitored_no_file';
        }
      }
    }

    // 7. Recherche optionnelle Prowlarr (uniquement sur appel explicite de diagnostic)
    let indexerSearch: MediaEvidence['indexerSearch'] = {
      queried: false,
      state: 'not_queried',
      matchingReleasesCount: 0,
      bestQualityHint: null,
      activeIndexersCount: null
    };

    if (params.checkIndexers && catalogState !== 'available_now') {
      const tProwl = Date.now();
      try {
        const searchRes = await this.prowlarr.searchMediaReleases(
          osDetail.originalTitle || osDetail.titleFr,
          osDetail.mediaType
        );
        indexerSearch = {
          queried: true,
          state: searchRes.releases.length > 0 ? 'releases_found' : 'no_release_found',
          matchingReleasesCount: searchRes.releases.length,
          bestQualityHint: searchRes.bestQualityHint,
          activeIndexersCount: null
        };
        provenance.push({
          source: 'prowlarr',
          status: 'ok',
          latencyMs: searchRes.latencyMs,
          detail: `${searchRes.releases.length} release(s) trouvée(s)`
        });
      } catch (err) {
        indexerSearch = {
          queried: true,
          state: 'indexer_error',
          matchingReleasesCount: 0,
          bestQualityHint: null,
          activeIndexersCount: null
        };
        provenance.push({
          source: 'prowlarr',
          status: 'error',
          latencyMs: Date.now() - tProwl,
          detail: err instanceof Error ? err.message : 'ERROR'
        });
      }
    }

    // 8. Éligibilité & Explication en français non-technique + Mapping d'accès serveurs Plex par utilisateur
    const configuredServers =
      typeof this.plex.getConfiguredServers === 'function'
        ? this.plex.getConfiguredServers().map((s) => s.name)
        : ['NucVillers', 'NucBuntu'];

    let availableServers: string[] = [];
    if (plexResult.matchedItems.length > 0) {
      const serversSet = new Set<string>();
      for (const m of plexResult.matchedItems) {
        if (typeof this.plex.getServersHostingLibrary === 'function') {
          for (const srv of this.plex.getServersHostingLibrary(m.libraryTitle, m.serverName)) {
            serversSet.add(srv);
          }
        } else if (m.isSharedAcrossAllServers) {
          for (const srv of configuredServers) serversSet.add(srv);
        } else {
          serversSet.add(m.serverName);
        }
      }
      availableServers = Array.from(serversSet);
    }

    let userAllowedServers: string[] | undefined;
    let userAccessibleServers: string[] | undefined;
    let accessibleToCurrentUser: boolean | undefined;

    if (params.currentUserEmail && typeof this.plex.resolveUserPlexServerAccess === 'function') {
      const access = await this.plex.resolveUserPlexServerAccess({
        email: params.currentUserEmail
      });
      if (access && access.askarrServerNames.length > 0) {
        userAllowedServers = access.askarrServerNames;
        if (availableServers.length > 0) {
          userAccessibleServers = availableServers.filter((srv) =>
            userAllowedServers!.some((u) => u.toLowerCase() === srv.toLowerCase())
          );
          accessibleToCurrentUser = userAccessibleServers.length > 0;
        }
      }
    }

    const requestableSeasons =
      episodeCoverage?.seasons.filter((s) => s.state === 'not_requested').map((s) => s.seasonNumber) || [];

    const arrAddedAt = radarrMovie?.added || sonarrSeries?.added || null;
    const overseerrRequestedAt = osDetail.requestInfo.requestedAt || params.knownRequestHint?.requestedAt || null;
    const effectiveRequestedAt = overseerrRequestedAt || arrAddedAt || null;
    const hasOverseerrRequest =
      effectiveRequestId !== null || effectiveRequestedBy !== null || overseerrRequestedAt !== null;
    const sourceOrigin: 'overseerr_user' | 'auto_list' | null = hasOverseerrRequest
      ? 'overseerr_user'
      : acqState !== 'not_in_arr' && acqState !== 'unknown'
        ? 'auto_list'
        : null;

    if (
      reqState === 'not_requested' &&
      (acqState === 'monitored_waiting_release' || acqState === 'monitored_searching' || acqState === 'downloading')
    ) {
      reqState = 'approved_processing';
    }

    const actionability = this.computeUserFriendlyActionability({
      mediaType: osDetail.mediaType,
      catalogState,
      matchedItems: plexResult.matchedItems,
      availableServers,
      userAllowedServers,
      userAccessibleServers,
      accessibleToCurrentUser,
      acqState,
      reqState,
      requestedAt: effectiveRequestedAt,
      requestedByDisplayName: effectiveRequestedBy,
      sourceOrigin,
      estimatedAvailabilityDate,
      isEstimatedDate,
      queueProgressPercent,
      requestableSeasons,
      episodeCoverage
    });

    return {
      identity: {
        mediaType: osDetail.mediaType,
        tmdbId: osDetail.tmdbId,
        tvdbId: osDetail.tvdbId,
        imdbId: osDetail.imdbId,
        titleFr: osDetail.titleFr,
        originalTitle: osDetail.originalTitle,
        year: osDetail.year,
        overviewFr: osDetail.overviewFr || firstPlexDetail?.summary || null,
        posterUrl: osDetail.posterUrl,
        genres: osDetail.genres.length > 0 ? osDetail.genres : firstPlexDetail?.genres || [],
        runtimeMinutes: osDetail.runtimeMinutes || firstPlexDetail?.durationMinutes || null,
        directorOrCreator: osDetail.directorOrCreator || firstPlexDetail?.directors[0] || null,
        topCast: osDetail.topCast.length > 0 ? osDetail.topCast : firstPlexDetail?.cast || [],
        ratings: {
          imdbOrAudienceRating: firstPlexDetail?.audienceRating ?? osDetail.voteAverage ?? null,
          tmdbVoteAverage: osDetail.voteAverage,
          criticRating: firstPlexDetail?.criticRating ?? null
        },
        releaseDates: {
          inCinemas,
          digitalRelease,
          physicalRelease,
          estimatedVodOrDvdDate,
          isEstimatedDate,
          nextAiring: sonarrSeries?.nextAiring || null
        }
      },
      catalogPresence: {
        state: catalogState,
        serversQueried: plexResult.serversQueried,
        matchedItems: plexResult.matchedItems,
        availableServers,
        userAccessibleServers,
        userAllowedServers,
        accessibleToCurrentUser
      },
      requestState: {
        state: reqState,
        requestId: effectiveRequestId,
        requestedAt: effectiveRequestedAt,
        requestedByCurrentUser,
        requestedByDisplayName: effectiveRequestedBy,
        sourceOrigin
      },
      acquisitionPipeline: {
        state: acqState,
        externalServiceId: radarrMovie?.id || sonarrSeries?.id || null,
        monitored: radarrMovie ? radarrMovie.monitored : sonarrSeries ? sonarrSeries.monitored : null,
        hasFile: radarrMovie ? radarrMovie.hasFile : null,
        addedAt: arrAddedAt || (effectiveRequestedAt ? effectiveRequestedAt.slice(0, 10) : null),
        estimatedAvailabilityDate,
        estimatedAvailabilityReason,
        queueProgressPercent,
        queueTimeleft
      },
      episodeCoverage,
      indexerSearch,
      actionability,
      provenance
    };
  }

  private computeUserFriendlyActionability(params: {
    mediaType: MediaType;
    catalogState: MediaEvidence['catalogPresence']['state'];
    matchedItems: MediaEvidence['catalogPresence']['matchedItems'];
    availableServers?: string[];
    userAllowedServers?: string[];
    userAccessibleServers?: string[];
    accessibleToCurrentUser?: boolean;
    acqState: MediaEvidence['acquisitionPipeline']['state'];
    reqState: MediaEvidence['requestState']['state'];
    requestedAt?: string | null;
    requestedByDisplayName?: string | null;
    sourceOrigin?: 'overseerr_user' | 'auto_list' | null;
    estimatedAvailabilityDate: string | null;
    isEstimatedDate: boolean;
    queueProgressPercent: number | null;
    requestableSeasons: number[];
    episodeCoverage: MediaEvidence['episodeCoverage'];
  }): MediaEvidence['actionability'] {
    const firstMatch = params.matchedItems[0];

    if (params.catalogState === 'available_now' && firstMatch) {
      const serversList =
        params.availableServers && params.availableServers.length > 0
          ? params.availableServers.join(' & ')
          : firstMatch.serverName;

      if (params.accessibleToCurrentUser === false && params.userAllowedServers?.length) {
        return {
          canRequestNow: false,
          requestableSeasons: [],
          blockReason: 'ALREADY_AVAILABLE_ON_PLEX',
          userFriendlyStatusLabel: `Sur Plex (${firstMatch.libraryTitle} • ${serversList})`,
          userFriendlyExplanationFr: `Disponible sur le serveur Plex ${serversList} (bibliothèque « ${firstMatch.libraryTitle} »). Attention : ton compte Plex est rattaché à ${params.userAllowedServers.join(' & ')}.`,
          statusTone: 'amber'
        };
      }

      const locationText = firstMatch.isSharedAcrossAllServers
        ? `Bibliothèque « ${firstMatch.libraryTitle} » (serveurs Plex : ${serversList})`
        : `Bibliothèque « ${firstMatch.libraryTitle} » (serveur Plex : ${firstMatch.serverName})`;

      const requesterNote = params.requestedByDisplayName
        ? ` (Demandé par ${params.requestedByDisplayName})`
        : '';

      return {
        canRequestNow: false,
        requestableSeasons: [],
        blockReason: 'ALREADY_AVAILABLE_ON_PLEX',
        userFriendlyStatusLabel: firstMatch.isSharedAcrossAllServers
          ? `Disponible sur Plex (${firstMatch.libraryTitle} • ${serversList})`
          : `Disponible sur Plex (${firstMatch.libraryTitle} • ${firstMatch.serverName})`,
        userFriendlyExplanationFr: `Ce titre est déjà disponible sur Plex dans la ${locationText}.${requesterNote}`,
        statusTone: 'emerald'
      };
    }

    if (params.catalogState === 'partially_available' && params.episodeCoverage) {
      const availS = params.episodeCoverage.seasons
        .filter((s) => s.state === 'available_on_plex')
        .map((s) => `S${s.seasonNumber}`);
      const canReqMore = params.requestableSeasons.length > 0;
      return {
        canRequestNow: canReqMore,
        requestableSeasons: params.requestableSeasons,
        blockReason: canReqMore ? null : 'ALREADY_REQUESTED_OR_MONITORED',
        userFriendlyStatusLabel: `Partiellement sur Plex (${availS.join(', ') || 'Épisodes partiels'})`,
        userFriendlyExplanationFr: canReqMore
          ? `Certaines saisons sont déjà sur Plex (${availS.join(', ')}). Les saisons ${params.requestableSeasons.map((n) => `S${n}`).join(', ')} peuvent être demandées.`
          : `Certaines saisons sont déjà sur Plex et les autres sont déjà en cours de suivi.`,
        statusTone: 'sky'
      };
    }

    if (params.acqState === 'downloading') {
      const pctText = params.queueProgressPercent !== null ? ` (${params.queueProgressPercent} %)` : '';
      return {
        canRequestNow: false,
        requestableSeasons: [],
        blockReason: 'ALREADY_REQUESTED_OR_MONITORED',
        userFriendlyStatusLabel: `Téléchargement en cours${pctText}`,
        userFriendlyExplanationFr: `Ce titre est actuellement en cours de téléchargement${pctText} et arrivera automatiquement sur Plex dès la fin.`,
        statusTone: 'indigo'
      };
    }

    if (params.acqState === 'monitored_waiting_release') {
      const dateFr = formatFrenchDate(params.estimatedAvailabilityDate);
      const addedFr = formatFrenchDate(params.requestedAt ?? null);
      const estPrefix = params.isEstimatedDate ? 'Sortie VOD/DVD estimée vers le ' : 'Sortie VOD/DVD prévue le ';
      const originBadge = params.requestedByDisplayName
        ? ` • demandé par ${params.requestedByDisplayName}${addedFr ? ` le ${addedFr}` : ''}`
        : params.sourceOrigin === 'auto_list'
          ? ` • ajouté auto (liste)${addedFr ? ` le ${addedFr}` : ''}`
          : addedFr
            ? ` • demandé le ${addedFr}`
            : '';
      const originPhrase = params.requestedByDisplayName
        ? `demandé par ${params.requestedByDisplayName}${addedFr ? ` le ${addedFr}` : ''}`
        : params.sourceOrigin === 'auto_list'
          ? `ajouté automatiquement via une liste${addedFr ? ` le ${addedFr}` : ''}`
          : addedFr
            ? `programmé depuis le ${addedFr}`
            : `programmé dans la liste d'attente`;
      return {
        canRequestNow: false,
        requestableSeasons: [],
        blockReason: 'ALREADY_REQUESTED_OR_MONITORED',
        userFriendlyStatusLabel: dateFr
          ? `Dans la liste d'attente (${estPrefix}${dateFr}${originBadge})`
          : `Dans la liste d'attente (en attente de sortie VOD/DVD${originBadge})`,
        userFriendlyExplanationFr: dateFr
          ? `Pas encore sur Plex, mais déjà dans la liste d'attente (${originPhrase}) ! ${estPrefix}${dateFr} : il sera ajouté automatiquement dès sa disponibilité.`
          : `Pas encore sur Plex, mais déjà dans la liste d'attente (${originPhrase}) en attendant sa sortie numérique ou DVD.`,
        statusTone: 'amber'
      };
    }

    if (
      params.acqState === 'monitored_searching' ||
      params.reqState === 'approved_processing' ||
      params.reqState === 'pending_approval'
    ) {
      const addedFr = formatFrenchDate(params.requestedAt ?? null);
      const dateFr = formatFrenchDate(params.estimatedAvailabilityDate);
      const originShort = params.requestedByDisplayName
        ? `demandé par ${params.requestedByDisplayName}${addedFr ? ` le ${addedFr}` : ''}`
        : params.sourceOrigin === 'auto_list'
          ? `ajouté auto (liste)${addedFr ? ` le ${addedFr}` : ''}`
          : addedFr
            ? `demandé le ${addedFr}`
            : '';
      return {
        canRequestNow: false,
        requestableSeasons: [],
        blockReason: 'ALREADY_REQUESTED_OR_MONITORED',
        userFriendlyStatusLabel: originShort
          ? `Déjà en liste d'attente (${originShort} • recherche auto)`
          : `Déjà demandé (en recherche automatique)`,
        userFriendlyExplanationFr: `Ce titre n'est pas encore sur Plex, mais il est déjà dans la liste d'attente${originShort ? ` (${originShort})` : ''}${dateFr ? ` — sortie VOD/DVD vers le ${dateFr}` : ''} et le serveur le recherche automatiquement.`,
        statusTone: 'amber'
      };
    }

    if (params.catalogState === 'unknown') {
      return {
        canRequestNow: false,
        requestableSeasons: [],
        blockReason: null,
        userFriendlyStatusLabel: `Vérification partielle (serveur Plex temporairement injoignable)`,
        userFriendlyExplanationFr: `Impossible de confirmer la présence sur Plex à cet instant.`,
        statusTone: 'slate'
      };
    }

    const futureDateFr = formatFrenchDate(params.estimatedAvailabilityDate);
    return {
      canRequestNow: true,
      requestableSeasons: params.mediaType === 'tv' ? params.requestableSeasons : [],
      blockReason: null,
      userFriendlyStatusLabel: futureDateFr
        ? `Pas encore sur Plex (Sortie VOD/DVD vers le ${futureDateFr})`
        : `Pas encore sur Plex — Disponible à la demande`,
      userFriendlyExplanationFr: futureDateFr
        ? `Ce titre n'est pas encore sur Plex (sortie VOD/DVD prévue vers le ${futureDateFr}), mais vous pouvez le demander dès maintenant pour qu'il s'ajoute automatiquement à sa sortie.`
        : `Ce titre n'est ni sur Plex ni dans la liste d'attente : vous pouvez demander son ajout.`,
      statusTone: 'slate'
    };
  }

  public async searchByPerson(params: {
    personQuery: string;
    roleFilter?: 'director' | 'actor' | 'any';
    year?: number;
    mediaType?: 'movie' | 'tv' | 'auto';
    currentUserEmail?: string;
    currentUserOverseerrId?: number | null;
    maxCandidates?: number;
  }): Promise<{
    personName: string | null;
    candidates: MediaEvidence[];
  }> {
    const maxCandidates = params.maxCandidates || 5;
    const personRes = await this.overseerr.searchPersonFilmography({
      personQuery: params.personQuery,
      roleFilter: params.roleFilter || 'any',
      year: params.year,
      mediaType: params.mediaType || 'auto'
    });

    if (personRes.candidates.length === 0) {
      return { personName: personRes.personName, candidates: [] };
    }

    const enriched = await Promise.all(
      personRes.candidates.slice(0, maxCandidates).map((c) =>
        this.buildMediaEvidence({
          tmdbId: c.tmdbId,
          mediaType: c.mediaType,
          currentUserEmail: params.currentUserEmail,
          currentUserOverseerrId: params.currentUserOverseerrId,
          includeSeasons: c.mediaType === 'tv',
          checkIndexers: false
        })
      )
    );

    // Put titles already available on Plex first so the user sees what they can watch immediately
    enriched.sort((a, b) => {
      const aAvail = a.catalogPresence.state === 'available_now' ? 1 : 0;
      const bAvail = b.catalogPresence.state === 'available_now' ? 1 : 0;
      if (aAvail !== bAvail) return bAvail - aAvail;
      return (b.identity.ratings.imdbOrAudienceRating ?? 0) - (a.identity.ratings.imdbOrAudienceRating ?? 0);
    });

    return {
      personName: personRes.personName,
      candidates: enriched
    };
  }

  public async verifySpecificTitles(params: {
    items: Array<{
      title: string;
      year?: number;
      mediaType?: 'movie' | 'tv' | 'auto';
      knownPlexHint?: { serverNames: string[]; libraryTitle?: string };
    }>;
    currentUserEmail?: string;
    currentUserOverseerrId?: number | null;
    userQueryContext?: string;
  }): Promise<MediaEvidence[]> {
    const cleanItems = params.items
      .filter((i) => i && typeof i.title === 'string' && i.title.trim().length > 0)
      .slice(0, 6);

    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const localContextPromise =
      params.userQueryContext && params.userQueryContext.trim().length >= 8
        ? this.searchLocalCatalogByKeywords({
            query: params.userQueryContext,
            limit: 2
          })
        : Promise.resolve([]);

    const currentYear = new Date().getFullYear();

    const [localMatches, nestedResults] = await Promise.all([
      localContextPromise,
      Promise.all(
        cleanItems.map(async (item) => {
          try {
            const targetTitle = norm(item.title);
            const searchRes = await this.overseerr.search(item.title.trim(), item.mediaType || 'auto', {
              includePersonFallback: false
            });
            if (searchRes.length === 0) return [];

            // Vérifier si l'utilisateur a explicitement tapé une ancienne année dans son message
            const userExplicitlyAskedOldYear = Boolean(
              item.year &&
                item.year < currentYear - 1 &&
                params.userQueryContext &&
                params.userQueryContext.includes(String(item.year))
            );

            // Score each candidate by exact title match + year match so a movie like "Goliath" (2022)
            // or "Titane" (2021) is selected accurately
            const scored = searchRes.map((c, idx) => {
              const tFr = norm(c.titleFr);
              const tOrig = norm(c.originalTitle);
              let score = Math.max(0, 20 - idx * 2);
              if (tFr === targetTitle || tOrig === targetTitle) {
                score += 100;
              } else if (tFr.includes(targetTitle) || tOrig.includes(targetTitle)) {
                score += 40;
              }
              if (item.year && c.year) {
                const diff = Math.abs(c.year - item.year);
                if (diff === 0) score += 90;
                else if (diff === 1) score += 60;
                else score -= Math.min(80, diff * 10);
              }
              if (item.mediaType && item.mediaType !== 'auto' && c.mediaType === item.mediaType) {
                score += 25;
              }
              return { c, score };
            });

            scored.sort((a, b) => b.score - a.score);
            const best = scored[0].c;

            // Si l'utilisateur cherche 1 ou 2 titres sans préciser une vieille année et qu'une sortie cinéma/VOD récente
            // (année en cours ou précédente, ex: "Le Fantôme de l'Opéra" 2026) porte exactement ce titre sur TMDB,
            // on l'inclut en tête pour ne jamais rater un film actuellement à l'affiche malgré le cutoff du LLM.
            const candidatesToEnrich = [best];
            if (cleanItems.length <= 2 && !userExplicitlyAskedOldYear) {
              const recentHomonym = searchRes.find(
                (c) =>
                  c.tmdbId !== best.tmdbId &&
                  (c.year ?? 0) >= currentYear - 1 &&
                  (norm(c.titleFr) === targetTitle || norm(c.originalTitle) === targetTitle)
              );
              if (recentHomonym) {
                candidatesToEnrich.unshift(recentHomonym);
              }
            }

            const built = await Promise.all(
              candidatesToEnrich.map((cand) =>
                this.buildMediaEvidence({
                  tmdbId: cand.tmdbId,
                  mediaType: cand.mediaType,
                  currentUserEmail: params.currentUserEmail,
                  currentUserOverseerrId: params.currentUserOverseerrId,
                  includeSeasons: cand.mediaType === 'tv',
                  checkIndexers: false,
                  knownPlexHint: cand.tmdbId === best.tmdbId ? item.knownPlexHint : undefined
                })
              )
            );
            return built;
          } catch {
            return [];
          }
        })
      )
    ]);
    const results = nestedResults.flat();

    const highConfidenceLocal = localMatches.filter((m) => m.score >= 35);
    const localEvidences = await Promise.all(
      highConfidenceLocal.map(async (loc) => {
        try {
          return await this.buildMediaEvidence({
            tmdbId: loc.tmdbId,
            mediaType: loc.mediaType,
            currentUserEmail: params.currentUserEmail,
            currentUserOverseerrId: params.currentUserOverseerrId,
            includeSeasons: loc.mediaType === 'tv',
            checkIndexers: false
          });
        } catch {
          return null;
        }
      })
    );

    const seen = new Set<string>();
    const deduped: MediaEvidence[] = [];
    for (const ev of [...localEvidences, ...results]) {
      if (!ev) continue;
      const key = `${ev.identity.mediaType}:${ev.identity.tmdbId}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(ev);
      }
    }
    return deduped;
  }

  public async discoverAndRecommend(params: {
    scope: 'on_plex_now' | 'similar_to_title' | 'discover_by_genre_or_trending';
    mediaType: 'movie' | 'tv' | 'auto';
    genre?: string;
    similarToTmdbId?: number;
    minRating?: number;
    plexLibraryFilter?: string;
    personFilter?: string;
    yearFilter?: number;
    limit?: number;
    currentUserEmail?: string;
    currentUserOverseerrId?: number | null;
  }): Promise<MediaEvidence[]> {
    const requestedLimit = params.limit && params.limit > 0 ? Math.min(8, params.limit) : undefined;
    if (params.scope === 'on_plex_now' || params.plexLibraryFilter) {
      const plexDisc = await this.plex.discoverOnPlex({
        mediaType: params.mediaType,
        genre: params.genre,
        minRating: params.minRating ?? 7.0,
        libraryFilter: params.plexLibraryFilter,
        personFilter: params.personFilter,
        yearFilter: params.yearFilter,
        limit: requestedLimit ?? 5
      });

      const configuredServers =
        typeof this.plex.getConfiguredServers === 'function'
          ? this.plex.getConfiguredServers().map((s) => s.name)
          : ['NucVillers', 'NucBuntu'];

      let userAllowedServers: string[] | undefined;
      if (params.currentUserEmail && typeof this.plex.resolveUserPlexServerAccess === 'function') {
        const access = await this.plex.resolveUserPlexServerAccess({
          email: params.currentUserEmail
        });
        if (access && access.askarrServerNames.length > 0) {
          userAllowedServers = access.askarrServerNames;
        }
      }

      return plexDisc.items.map((item, idx) => {
        const availableServers =
          typeof this.plex.getServersHostingLibrary === 'function'
            ? this.plex.getServersHostingLibrary(item.librarySectionTitle, item.serverName)
            : item.isSharedAcrossAllServers
              ? configuredServers
              : [item.serverName];
        const userAccessibleServers = userAllowedServers
          ? availableServers.filter((srv) =>
              userAllowedServers!.some((u) => u.toLowerCase() === srv.toLowerCase())
            )
          : undefined;
        const accessibleToCurrentUser = userAccessibleServers
          ? userAccessibleServers.length > 0
          : undefined;
        const serversList = availableServers.join(' & ');

        return {
          identity: {
            mediaType: item.type === 'show' ? 'tv' : 'movie',
            tmdbId: -(idx + 1),
            tvdbId: null,
            imdbId: null,
            titleFr: item.title,
            originalTitle: item.originalTitle || item.title,
            year: item.year,
            overviewFr: item.summary,
            posterUrl: null,
            genres: item.genres,
            runtimeMinutes: item.durationMinutes,
            directorOrCreator: item.directors[0] || null,
            topCast: item.cast,
            ratings: {
              imdbOrAudienceRating: item.audienceRating,
              tmdbVoteAverage: null,
              criticRating: item.criticRating
            },
            releaseDates: {
              inCinemas: null,
              digitalRelease: null,
              physicalRelease: null,
              estimatedVodOrDvdDate: null,
              isEstimatedDate: false,
              nextAiring: null
            }
          },
          catalogPresence: {
            state: 'available_now',
            serversQueried: [item.serverName],
            matchedItems: [
              {
                serverName: item.serverName,
                ratingKey: item.ratingKey,
                libraryTitle: item.librarySectionTitle,
                isSharedAcrossAllServers: item.isSharedAcrossAllServers,
                title: item.title,
                originalTitle: item.originalTitle,
                year: item.year,
                ...buildPlexDeepLinks(item.serverName, item.ratingKey)
              }
            ],
            availableServers,
            userAccessibleServers,
            userAllowedServers,
            accessibleToCurrentUser
          },
          requestState: {
            state: 'available',
            requestId: null,
            requestedAt: null,
            requestedByCurrentUser: false,
            requestedByDisplayName: null
          },
          acquisitionPipeline: {
            state: 'imported_on_disk',
            externalServiceId: null,
            monitored: true,
            hasFile: true,
            estimatedAvailabilityDate: null,
            estimatedAvailabilityReason: null,
            queueProgressPercent: null,
            queueTimeleft: null
          },
          episodeCoverage: null,
          indexerSearch: {
            queried: false,
            state: 'not_queried',
            matchingReleasesCount: 0,
            bestQualityHint: null,
            activeIndexersCount: null
          },
          actionability: {
            canRequestNow: false,
            requestableSeasons: [],
            blockReason: 'ALREADY_AVAILABLE_ON_PLEX',
            userFriendlyStatusLabel:
              accessibleToCurrentUser === false
                ? `Sur Plex (${item.librarySectionTitle} • ${serversList})`
                : `Disponible sur Plex (${item.librarySectionTitle} • ${serversList})`,
            userFriendlyExplanationFr:
              accessibleToCurrentUser === false && userAllowedServers?.length
                ? `Disponible sur le serveur Plex ${serversList} (bibliothèque « ${item.librarySectionTitle} »). Attention : ton compte Plex est rattaché à ${userAllowedServers.join(' & ')}.`
                : `Disponible immédiatement dans la bibliothèque « ${item.librarySectionTitle} » (serveurs Plex : ${serversList}).`,
            statusTone: accessibleToCurrentUser === false ? 'amber' : 'emerald'
          },
          provenance: idx === 0 ? plexDisc.provenance : []
        };
      });
    }

    let candidates =
      params.scope === 'similar_to_title' && params.similarToTmdbId
        ? await this.overseerr.getRecommendations(
            params.similarToTmdbId,
            params.mediaType === 'tv' ? 'tv' : 'movie'
          )
        : await this.overseerr.discoverByGenreOrTrending(
            params.mediaType,
            params.genre,
            params.yearFilter
          );

    if (params.minRating) {
      const aboveRating = candidates.filter((c) => (c.voteAverage ?? 0) >= params.minRating!);
      if (aboveRating.length > 0) candidates = aboveRating;
    }

    const top = candidates.slice(0, requestedLimit ?? 4);
    return Promise.all(
      top.map((c) =>
        this.buildMediaEvidence({
          tmdbId: c.tmdbId,
          mediaType: c.mediaType,
          currentUserEmail: params.currentUserEmail,
          currentUserOverseerrId: params.currentUserOverseerrId,
          includeSeasons: false,
          checkIndexers: false
        })
      )
    );
  }

  public async getWaitingListAndRequests(params: {
    currentUserEmail?: string;
    currentUserOverseerrId?: number | null;
    onlyCurrentUser?: boolean;
    limit?: number;
  }): Promise<MediaEvidence[]> {
    const limit = Math.min(8, Math.max(1, params.limit || 5));

    const [overseerrRes, radarrWaitingRes] = await Promise.allSettled([
      this.overseerr.getRequests(params.onlyCurrentUser ? params.currentUserOverseerrId : undefined, 10),
      !params.onlyCurrentUser && typeof this.radarr.getRecentWaitingMovies === 'function'
        ? this.radarr.getRecentWaitingMovies(10)
        : Promise.resolve({ movies: [] as RadarrMovieStatus[], latencyMs: 0 })
    ]);

    const merged = new Map<
      string,
      {
        tmdbId: number;
        mediaType: MediaType;
        addedAt: string;
        isWaitingHint: boolean;
        knownRequestHint?: {
          requestId: number;
          requestedAt: string | null;
          requestedByEmail: string | null;
          requestedByDisplayName: string | null;
        };
      }
    >();

    if (radarrWaitingRes.status === 'fulfilled') {
      for (const m of radarrWaitingRes.value.movies) {
        if (!m.tmdbId || m.tmdbId <= 0) continue;
        const key = `movie:${m.tmdbId}`;
        merged.set(key, {
          tmdbId: m.tmdbId,
          mediaType: 'movie',
          addedAt: m.added || '',
          isWaitingHint: !m.hasFile
        });
      }
    }

    if (overseerrRes.status === 'fulfilled') {
      for (const r of overseerrRes.value) {
        if (!r.tmdbId || r.tmdbId <= 0) continue;
        const key = `${r.mediaType}:${r.tmdbId}`;
        const existing = merged.get(key);
        const createdIso = r.createdAt ? r.createdAt.slice(0, 10) : '';
        const reqHint = {
          requestId: r.requestId,
          requestedAt: r.createdAt,
          requestedByEmail: r.requestedByEmail,
          requestedByDisplayName: r.requestedByDisplayName
        };
        if (!existing) {
          merged.set(key, {
            tmdbId: r.tmdbId,
            mediaType: r.mediaType,
            addedAt: createdIso,
            isWaitingHint: r.mediaStatus !== 5,
            knownRequestHint: reqHint
          });
        } else {
          existing.knownRequestHint = reqHint;
          if (createdIso && (!existing.addedAt || createdIso > existing.addedAt)) {
            existing.addedAt = createdIso;
          }
        }
      }
    }

    const candidates = Array.from(merged.values()).sort((a, b) => {
      if (a.isWaitingHint !== b.isWaitingHint) return a.isWaitingHint ? -1 : 1;
      return (b.addedAt || '').localeCompare(a.addedAt || '');
    });

    const enriched = await Promise.all(
      candidates.slice(0, limit).map(async (item) => {
        try {
          return await this.buildMediaEvidence({
            tmdbId: item.tmdbId,
            mediaType: item.mediaType,
            currentUserEmail: params.currentUserEmail,
            currentUserOverseerrId: params.currentUserOverseerrId,
            includeSeasons: item.mediaType === 'tv',
            checkIndexers: false,
            knownRequestHint: item.knownRequestHint
          });
        } catch {
          return null;
        }
      })
    );

    return enriched.filter((e): e is MediaEvidence => e !== null);
  }
}
