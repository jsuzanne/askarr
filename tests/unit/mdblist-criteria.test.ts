import { describe, it, expect, vi } from 'vitest';
import {
  validateAndNormalizeCriteria,
  mergeFollowUpCriteria,
  resolveGenreSlug,
  resolveRatingSource,
  toMdblistRatingScale100,
  matchesGenreConstraint,
  matchesRatingConstraint,
  matchesRuntimeConstraint
} from '../../src/server/connectors/mdblist-criteria.schema.js';
import { MdblistConnector } from '../../src/server/connectors/mdblist.connector.js';
import { MediaAggregatorService } from '../../src/server/aggregator/media-aggregator.service.js';
import type { PlexMultiServerConnector } from '../../src/server/connectors/plex.connector.js';
import type { OverseerrConnector } from '../../src/server/connectors/overseerr.connector.js';
import type { RadarrConnector } from '../../src/server/connectors/radarr.connector.js';
import type { SonarrConnector } from '../../src/server/connectors/sonarr.connector.js';
import type { ProwlarrConnector } from '../../src/server/connectors/prowlarr.connector.js';

function createBaseOverseerrDetail(overrides: Record<string, unknown> = {}) {
  return {
    tmdbId: 101,
    mediaType: 'movie' as const,
    tvdbId: null,
    imdbId: 'tt0101101',
    titleFr: 'Thriller Exemplaire',
    originalTitle: 'Exemplary Thriller',
    year: 2015,
    overviewFr: 'Un thriller haletant.',
    posterUrl: null,
    genres: ['Thriller'],
    runtimeMinutes: 110,
    voteAverage: 7.4,
    directorOrCreator: 'Denis Villeneuve',
    topCast: ['Actor A', 'Actor B'],
    tmdbReleases: {
      inCinemas: '2015-09-18',
      digitalRelease: '2015-12-18',
      physicalRelease: null
    },
    totalSeasons: 0,
    seasonsMeta: [],
    requestInfo: {
      mediaStatus: null,
      latestRequestId: null,
      latestRequestStatus: null,
      requestedAt: null,
      requestedByUserId: null,
      requestedByEmail: null,
      requestedByDisplayName: null,
      requestedSeasons: []
    },
    ...overrides
  };
}

describe('MDBList Dynamic Criteria Discovery & Validation Suite (Steps 2–7)', () => {
  it('T-MDB-01: translates French and English genre labels ("comédie", "science-fiction", "policier") to canonical MDBList slugs without silent OR substitution', () => {
    expect(resolveGenreSlug('comédie')).toBe('comedy');
    expect(resolveGenreSlug('Comedie')).toBe('comedy');
    expect(resolveGenreSlug('science-fiction')).toBe('sci-fi');
    expect(resolveGenreSlug('SF')).toBe('sci-fi');
    expect(resolveGenreSlug('policier')).toBe('crime');
    expect(resolveGenreSlug('thriller')).toBe('thriller');
    expect(resolveGenreSlug('genre-totalement-inconnu')).toBeNull();

    const validation = validateAndNormalizeCriteria({
      mediaType: 'movie',
      genres: ['thriller'],
      limit: 5
    });
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.criteria.genres).toEqual(['thriller']);
      expect(validation.criteria.genreOperator).toBe('and');
    }
  });

  it('T-MDB-02 & T-MDB-03: combines genre + year range + IMDb threshold and strictly enforces > vs >= both in API scale (0-100) and post-verification', () => {
    const gtValidation = validateAndNormalizeCriteria({
      mediaType: 'movie',
      genres: ['thriller'],
      yearFrom: 2010,
      yearTo: 2020,
      ratingSource: 'imdb',
      minRating: 8,
      ratingComparison: 'gt',
      limit: 5
    });
    expect(gtValidation.ok).toBe(true);
    if (!gtValidation.ok) return;

    const gteValidation = validateAndNormalizeCriteria({
      mediaType: 'movie',
      genres: ['thriller'],
      yearFrom: 2010,
      yearTo: 2020,
      ratingSource: 'imdb',
      minRating: 8,
      ratingComparison: 'gte',
      limit: 5
    });
    expect(gteValidation.ok).toBe(true);
    if (!gteValidation.ok) return;

    // Sur l'échelle MDBList 0-100 : > 8.0 donne 81, tandis que >= 8.0 donne 80
    expect(toMdblistRatingScale100(8, 'imdb', 'gt')).toBe(81);
    expect(toMdblistRatingScale100(8, 'imdb', 'gte')).toBe(80);

    // Post-vérification stricte : 8.0 est rejeté pour 'gt' (> 8) mais accepté pour 'gte' (>= 8)
    expect(matchesRatingConstraint(8.0, gtValidation.criteria)).toBe(false);
    expect(matchesRatingConstraint(8.1, gtValidation.criteria)).toBe(true);
    expect(matchesRatingConstraint(8.0, gteValidation.criteria)).toBe(true);
    expect(matchesRatingConstraint(7.9, gteValidation.criteria)).toBe(false);
  });

  it('T-MDB-04: rejects unknown rating sources and never substitutes TMDb or aggregate score when IMDb rating is missing', async () => {
    expect(resolveRatingSource('allocine')).toBeNull();
    expect(resolveRatingSource('senscritique')).toBeNull();

    const unsupportedSource = validateAndNormalizeCriteria({
      mediaType: 'movie',
      ratingSource: 'allocine',
      minRating: 8
    });
    expect(unsupportedSource.ok).toBe(false);
    if (!unsupportedSource.ok) {
      expect(unsupportedSource.errorCode).toBe('UNSUPPORTED_RATING_SOURCE');
    }

    // Une note absente (null) ne satisfait jamais un seuil minimum
    const imdbCriteria = validateAndNormalizeCriteria({
      mediaType: 'movie',
      ratingSource: 'imdb',
      minRating: 8,
      ratingComparison: 'gte'
    });
    expect(imdbCriteria.ok).toBe(true);
    if (imdbCriteria.ok) {
      expect(matchesRatingConstraint(null, imdbCriteria.criteria)).toBe(false);
    }

    // Vérifie que MediaAggregatorService ne remplace JAMAIS une note IMDb absente par la note TMDb (ex: 8.9/10 sur TMDb)
    const mockMdblist = {
      isConfigured: () => true,
      searchCatalog: vi.fn().mockResolvedValue({
        candidates: [
          {
            tmdbId: 500,
            imdbId: 'tt0500500',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-500',
            mediaType: 'movie',
            title: 'High TMDb But No IMDb',
            originalTitle: 'High TMDb But No IMDb',
            year: 2018,
            runtimeMinutes: 115,
            originalLanguage: 'en',
            genres: ['thriller'],
            imdbRating: null,
            imdbVotes: null,
            tmdbRating: 8.9,
            mdblistScore: 88,
            ratingsBySource: {
              imdb: { score: null, votes: null },
              tmdb: { score: 8.9, votes: 2000 },
              mdblist: { score: 88, votes: null }
            }
          }
        ],
        nextCursor: null,
        hasMore: false,
        totalResults: 1,
        fromCache: false,
        rateLimitRemaining: 900
      }),
      getMediaDetailByTmdbId: vi.fn().mockResolvedValue(null),
      getMediaDetailByImdbId: vi.fn().mockResolvedValue(null)
    } as unknown as MdblistConnector;

    const mockOverseerr = {
      getMediaDetail: vi.fn().mockResolvedValue(
        createBaseOverseerrDetail({
          tmdbId: 500,
          imdbId: 'tt0500500',
          titleFr: 'High TMDb But No IMDb',
          voteAverage: 8.9
        })
      )
    } as unknown as OverseerrConnector;

    const mockPlex = {
      findMediaAcrossServers: vi.fn().mockResolvedValue({
        state: 'available_now',
        serversQueried: ['NucVillers'],
        matchedDetails: [],
        matchedItems: [
          {
            serverName: 'NucVillers',
            ratingKey: '1',
            libraryTitle: 'Films',
            isSharedAcrossAllServers: true,
            title: 'High TMDb But No IMDb',
            originalTitle: 'High TMDb But No IMDb',
            year: 2018
          }
        ],
        provenance: []
      })
    } as unknown as PlexMultiServerConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      { getMovieByTmdbId: vi.fn().mockResolvedValue({ movie: null }) } as unknown as RadarrConnector,
      {} as unknown as SonarrConnector,
      {} as unknown as ProwlarrConnector,
      mockMdblist
    );

    const res = await aggregator.discoverMediaByCriteria({
      rawCriteria: {
        mediaType: 'movie',
        genres: ['thriller'],
        ratingSource: 'imdb',
        minRating: 8,
        ratingComparison: 'gte',
        limit: 3
      }
    });

    expect(res.cards).toHaveLength(0);
    expect(res.stats.rejectedByCriteriaCount).toBe(1);
  });

  it('T-MDB-05: distinguishes originalLanguage vs audioDubbingLanguage and Plex presence vs externalStreamingService, reporting unsupported constraints explicitly', () => {
    // 1. Si la demande contient un filtre valide + une contrainte non supportée (ex: VF ou Netflix), le filtre valide s'exécute et la contrainte non supportée est listée explicitement
    const mixed = validateAndNormalizeCriteria({
      mediaType: 'movie',
      genres: ['comedy'],
      originalLanguage: 'anglais',
      audioDubbingLanguage: 'VF',
      externalStreamingService: 'Netflix',
      keywords: ['braquage']
    });
    expect(mixed.ok).toBe(true);
    if (mixed.ok) {
      expect(mixed.criteria.originalLanguage).toBe('en');
      expect(mixed.criteria.unsupportedConstraints.length).toBeGreaterThanOrEqual(3);
      expect(mixed.criteria.unsupportedConstraints.some((c) => c.includes('VF'))).toBe(true);
      expect(mixed.criteria.unsupportedConstraints.some((c) => c.includes('Netflix'))).toBe(true);
      expect(mixed.criteria.unsupportedConstraints.some((c) => c.includes('braquage'))).toBe(true);
    }

    // 2. Si la demande repose UNIQUEMENT sur un critère non supporté par l'API (sans aucun critère supporté), elle est refusée proprement
    const onlyUnsupported = validateAndNormalizeCriteria({
      mediaType: 'movie',
      audioDubbingLanguage: 'VF'
    });
    expect(onlyUnsupported.ok).toBe(false);
    if (!onlyUnsupported.ok) {
      expect(onlyUnsupported.errorCode).toBe('UNSUPPORTED_CRITERIA_ONLY');
    }
  });

  it('T-MDB-06: enforces maxRuntimeMinutes ("moins de 100 minutes" -> lt vs lte) and rejects missing runtime when a runtime constraint is active', () => {
    const lt100 = validateAndNormalizeCriteria({
      mediaType: 'movie',
      genres: ['comedy'],
      maxRuntimeMinutes: 100,
      maxRuntimeComparison: 'lt'
    });
    expect(lt100.ok).toBe(true);
    if (!lt100.ok) return;

    // "Moins de 100 minutes" (< 100) accepte 99 min, rejette 100 min et rejette null
    expect(matchesRuntimeConstraint(99, lt100.criteria)).toBe(true);
    expect(matchesRuntimeConstraint(100, lt100.criteria)).toBe(false);
    expect(matchesRuntimeConstraint(null, lt100.criteria)).toBe(false);

    const lte100 = validateAndNormalizeCriteria({
      mediaType: 'movie',
      genres: ['comedy'],
      maxRuntimeMinutes: 100,
      maxRuntimeComparison: 'lte'
    });
    expect(lte100.ok).toBe(true);
    if (!lte100.ok) return;
    expect(matchesRuntimeConstraint(100, lte100.criteria)).toBe(true);
  });

  it('T-MDB-07 & T-MDB-08: excludes watched titles via user watch history and reports an explicit warning when watch history is unavailable', async () => {
    const mockMdblist = {
      isConfigured: () => true,
      searchCatalog: vi.fn().mockResolvedValue({
        candidates: [
          {
            tmdbId: 201,
            imdbId: 'tt0201201',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-201',
            mediaType: 'movie',
            title: 'Already Seen Sci-Fi',
            originalTitle: 'Already Seen Sci-Fi',
            year: 1995,
            runtimeMinutes: 110,
            originalLanguage: 'en',
            genres: ['science-fiction'],
            imdbRating: 8.2,
            imdbVotes: 50000,
            tmdbRating: 8.0,
            mdblistScore: 82,
            ratingsBySource: {
              imdb: { score: 8.2, votes: 50000 }
            }
          },
          {
            tmdbId: 202,
            imdbId: 'tt0202202',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-202',
            mediaType: 'movie',
            title: 'Unwatched 90s Sci-Fi',
            originalTitle: 'Unwatched 90s Sci-Fi',
            year: 1998,
            runtimeMinutes: 105,
            originalLanguage: 'en',
            genres: ['sci-fi'],
            imdbRating: 8.4,
            imdbVotes: 60000,
            tmdbRating: 8.1,
            mdblistScore: 84,
            ratingsBySource: {
              imdb: { score: 8.4, votes: 60000 }
            }
          }
        ],
        nextCursor: null,
        hasMore: false,
        totalResults: 2,
        fromCache: false,
        rateLimitRemaining: 900
      }),
      getMediaDetailByTmdbId: vi.fn(),
      getMediaDetailByImdbId: vi.fn()
    } as unknown as MdblistConnector;

    const mockOverseerr = {
      getMediaDetail: vi.fn().mockImplementation(async (tmdbId: number) =>
        createBaseOverseerrDetail({
          tmdbId,
          imdbId: tmdbId === 201 ? 'tt0201201' : 'tt0202202',
          titleFr: tmdbId === 201 ? 'Already Seen Sci-Fi' : 'Unwatched 90s Sci-Fi',
          originalTitle: tmdbId === 201 ? 'Already Seen Sci-Fi' : 'Unwatched 90s Sci-Fi',
          year: tmdbId === 201 ? 1995 : 1998,
          genres: ['Science-Fiction']
        })
      )
    } as unknown as OverseerrConnector;

    const mockPlex = {
      findMediaAcrossServers: vi.fn().mockResolvedValue({
        state: 'available_now',
        serversQueried: ['NucVillers'],
        matchedDetails: [],
        matchedItems: [
          {
            serverName: 'NucVillers',
            ratingKey: '10',
            libraryTitle: 'Films',
            isSharedAcrossAllServers: true,
            title: 'Unwatched 90s Sci-Fi',
            originalTitle: 'Unwatched 90s Sci-Fi',
            year: 1998
          }
        ],
        provenance: []
      })
    } as unknown as PlexMultiServerConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      { getMovieByTmdbId: vi.fn().mockResolvedValue({ movie: null }) } as unknown as RadarrConnector,
      {} as unknown as SonarrConnector,
      {} as unknown as ProwlarrConnector,
      mockMdblist
    );

    // Cas 7 : Historique disponible -> exclut tmdbId 201
    const verifiedRes = await aggregator.discoverMediaByCriteria({
      rawCriteria: {
        mediaType: 'movie',
        genres: ['science-fiction'],
        yearFrom: 1990,
        yearTo: 1999,
        excludeWatched: true,
        limit: 5
      },
      watchedFilter: {
        status: 'verified',
        watchedTmdbIds: new Set([201]),
        watchedNormTitles: new Set()
      }
    });

    expect(verifiedRes.watchHistoryStatus).toBe('verified');
    expect(verifiedRes.watchHistoryWarningFr).toBeNull();
    expect(verifiedRes.stats.excludedWatchedCount).toBe(1);
    expect(verifiedRes.cards).toHaveLength(1);
    expect(verifiedRes.cards[0].identity.tmdbId).toBe(202);

    // Cas 8 : Historique indisponible -> ne prétend jamais que les résultats sont certainement non vus
    const unavailableRes = await aggregator.discoverMediaByCriteria({
      rawCriteria: {
        mediaType: 'movie',
        genres: ['science-fiction'],
        yearFrom: 1990,
        yearTo: 1999,
        excludeWatched: true,
        limit: 5
      },
      watchedFilter: {
        status: 'unavailable'
      }
    });

    expect(unavailableRes.watchHistoryStatus).toBe('unavailable');
    expect(unavailableRes.watchHistoryWarningFr).toContain('historique');
    expect(unavailableRes.cards).toHaveLength(2);
  });

  it('T-MDB-09 & T-MDB-10: enforces user Plex server access rights (on_plex_now vs missing_on_plex) and preserves Askarr request actionability', async () => {
    const mockMdblist = {
      isConfigured: () => true,
      searchCatalog: vi.fn().mockResolvedValue({
        candidates: [
          {
            tmdbId: 301,
            imdbId: 'tt0301301',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-301',
            mediaType: 'movie',
            title: 'Movie On Unauthorized Server Only',
            originalTitle: 'Movie On Unauthorized Server Only',
            year: 2016,
            runtimeMinutes: 100,
            originalLanguage: 'en',
            genres: ['thriller'],
            imdbRating: 8.3,
            imdbVotes: 15000,
            tmdbRating: 7.9,
            mdblistScore: 83,
            ratingsBySource: {
              imdb: { score: 8.3, votes: 15000 }
            }
          },
          {
            tmdbId: 302,
            imdbId: 'tt0302302',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-302',
            mediaType: 'movie',
            title: 'Movie On Allowed Server',
            originalTitle: 'Movie On Allowed Server',
            year: 2017,
            runtimeMinutes: 105,
            originalLanguage: 'en',
            genres: ['thriller'],
            imdbRating: 8.5,
            imdbVotes: 25000,
            tmdbRating: 8.1,
            mdblistScore: 85,
            ratingsBySource: {
              imdb: { score: 8.5, votes: 25000 }
            }
          },
          {
            tmdbId: 303,
            imdbId: 'tt0303303',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-303',
            mediaType: 'movie',
            title: 'Movie Missing From Plex Requestable',
            originalTitle: 'Movie Missing From Plex Requestable',
            year: 2019,
            runtimeMinutes: 112,
            originalLanguage: 'en',
            genres: ['thriller'],
            imdbRating: 8.6,
            imdbVotes: 30000,
            tmdbRating: 8.2,
            mdblistScore: 86,
            ratingsBySource: {
              imdb: { score: 8.6, votes: 30000 }
            }
          }
        ],
        nextCursor: null,
        hasMore: false,
        totalResults: 3,
        fromCache: false,
        rateLimitRemaining: 900
      }),
      getMediaDetailByTmdbId: vi.fn(),
      getMediaDetailByImdbId: vi.fn()
    } as unknown as MdblistConnector;

    const mockOverseerr = {
      getMediaDetail: vi.fn().mockImplementation(async (tmdbId: number) =>
        createBaseOverseerrDetail({
          tmdbId,
          imdbId: `tt0${tmdbId}${tmdbId}`,
          titleFr:
            tmdbId === 301
              ? 'Movie On Unauthorized Server Only'
              : tmdbId === 302
                ? 'Movie On Allowed Server'
                : 'Movie Missing From Plex Requestable',
          year: 2017
        })
      )
    } as unknown as OverseerrConnector;

    const mockPlex = {
      findMediaAcrossServers: vi.fn().mockImplementation(async (q: { tmdbId?: number }) => {
        if (q.tmdbId === 301) {
          // Présent uniquement sur NucBuntu (auquel l'utilisateur n'a PAS accès)
          return {
            state: 'available_now',
            serversQueried: ['NucVillers', 'NucBuntu'],
            matchedDetails: [],
            matchedItems: [
              {
                serverName: 'NucBuntu',
                ratingKey: '301',
                libraryTitle: 'Films',
                isSharedAcrossAllServers: false,
                title: 'Movie On Unauthorized Server Only',
                originalTitle: 'Movie On Unauthorized Server Only',
                year: 2016
              }
            ],
            provenance: []
          };
        }
        if (q.tmdbId === 302) {
          // Présent sur NucVillers (serveur autorisé pour l'utilisateur)
          return {
            state: 'available_now',
            serversQueried: ['NucVillers', 'NucBuntu'],
            matchedDetails: [],
            matchedItems: [
              {
                serverName: 'NucVillers',
                ratingKey: '302',
                libraryTitle: 'Films',
                isSharedAcrossAllServers: true,
                title: 'Movie On Allowed Server',
                originalTitle: 'Movie On Allowed Server',
                year: 2017
              }
            ],
            provenance: []
          };
        }
        return {
          state: 'not_in_catalog',
          serversQueried: ['NucVillers', 'NucBuntu'],
          matchedDetails: [],
          matchedItems: [],
          provenance: []
        };
      })
    } as unknown as PlexMultiServerConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      { getMovieByTmdbId: vi.fn().mockResolvedValue({ movie: null }) } as unknown as RadarrConnector,
      {} as unknown as SonarrConnector,
      {} as unknown as ProwlarrConnector,
      mockMdblist
    );

    // 1. Scope "on_plex_now" avec userAllowedServers = ['NucVillers'] : 301 (NucBuntu uniquement) et 303 (absent) sont exclus, seul 302 est retourné
    const onPlexRes = await aggregator.discoverMediaByCriteria({
      rawCriteria: {
        mediaType: 'movie',
        genres: ['thriller'],
        scope: 'on_plex_now',
        excludeWatched: false,
        limit: 5
      },
      userAllowedServers: ['NucVillers']
    });

    expect(onPlexRes.cards).toHaveLength(1);
    expect(onPlexRes.cards[0].identity.tmdbId).toBe(302);
    expect(onPlexRes.cards[0].catalogPresence.accessibleToCurrentUser).toBe(true);
    expect(onPlexRes.stats.excludedUnauthorizedServerCount).toBe(1);

    // 2. Scope "missing_on_plex" : retourne uniquement 303 (absent de Plex et éligible à la demande Overseerr)
    const missingRes = await aggregator.discoverMediaByCriteria({
      rawCriteria: {
        mediaType: 'movie',
        genres: ['thriller'],
        scope: 'missing_on_plex',
        excludeWatched: false,
        limit: 5
      },
      userAllowedServers: ['NucVillers']
    });

    expect(missingRes.cards).toHaveLength(1);
    expect(missingRes.cards[0].identity.tmdbId).toBe(303);
    expect(missingRes.cards[0].catalogPresence.state).toBe('not_in_catalog');
    expect(missingRes.cards[0].actionability.canRequestNow).toBe(true);
  });

  it('T-MDB-11 & T-MDB-13: deduplicates TMDb/IMDb candidates, rejects mismatched mediaType (movie vs tv), and never pads results with out-of-criteria items when fewer match', async () => {
    const mockMdblist = {
      isConfigured: () => true,
      searchCatalog: vi.fn().mockResolvedValue({
        candidates: [
          {
            tmdbId: 401,
            imdbId: 'tt0401401',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-401-a',
            mediaType: 'movie',
            title: 'Valid Thriller One',
            originalTitle: 'Valid Thriller One',
            year: 2014,
            runtimeMinutes: 108,
            originalLanguage: 'en',
            genres: ['thriller'],
            imdbRating: 8.3,
            imdbVotes: 20000,
            tmdbRating: 8.0,
            mdblistScore: 83,
            ratingsBySource: {
              imdb: { score: 8.3, votes: 20000 }
            }
          },
          // Doublon même tmdbId / imdbId
          {
            tmdbId: 401,
            imdbId: 'tt0401401',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-401-dup',
            mediaType: 'movie',
            title: 'Valid Thriller One Duplicate',
            originalTitle: 'Valid Thriller One Duplicate',
            year: 2014,
            runtimeMinutes: 108,
            originalLanguage: 'en',
            genres: ['thriller'],
            imdbRating: 8.3,
            imdbVotes: 20000,
            tmdbRating: 8.0,
            mdblistScore: 83,
            ratingsBySource: {
              imdb: { score: 8.3, votes: 20000 }
            }
          },
          // Mauvais type de média (série TV au lieu de film) -> doit être ignoré
          {
            tmdbId: 401,
            imdbId: 'tt9999999',
            tvdbId: 12345,
            traktId: null,
            mdblistId: 'mdb-tv-401',
            mediaType: 'tv',
            title: 'TV Show With Same TMDb ID',
            originalTitle: 'TV Show With Same TMDb ID',
            year: 2014,
            runtimeMinutes: 50,
            originalLanguage: 'en',
            genres: ['thriller'],
            imdbRating: 9.0,
            imdbVotes: 50000,
            tmdbRating: 8.8,
            mdblistScore: 90,
            ratingsBySource: {
              imdb: { score: 9.0, votes: 50000 }
            }
          },
          {
            tmdbId: 402,
            imdbId: 'tt0402402',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-402',
            mediaType: 'movie',
            title: 'Valid Thriller Two',
            originalTitle: 'Valid Thriller Two',
            year: 2018,
            runtimeMinutes: 118,
            originalLanguage: 'en',
            genres: ['thriller'],
            imdbRating: 8.5,
            imdbVotes: 40000,
            tmdbRating: 8.2,
            mdblistScore: 85,
            ratingsBySource: {
              imdb: { score: 8.5, votes: 40000 }
            }
          }
        ],
        nextCursor: null,
        hasMore: false,
        totalResults: 4,
        fromCache: false,
        rateLimitRemaining: 900
      }),
      getMediaDetailByTmdbId: vi.fn(),
      getMediaDetailByImdbId: vi.fn()
    } as unknown as MdblistConnector;

    const mockOverseerr = {
      getMediaDetail: vi.fn().mockImplementation(async (tmdbId: number) =>
        createBaseOverseerrDetail({
          tmdbId,
          imdbId: tmdbId === 401 ? 'tt0401401' : 'tt0402402',
          titleFr: tmdbId === 401 ? 'Valid Thriller One' : 'Valid Thriller Two',
          year: tmdbId === 401 ? 2014 : 2018
        })
      )
    } as unknown as OverseerrConnector;

    const mockPlex = {
      findMediaAcrossServers: vi.fn().mockResolvedValue({
        state: 'available_now',
        serversQueried: ['NucVillers'],
        matchedDetails: [],
        matchedItems: [
          {
            serverName: 'NucVillers',
            ratingKey: '400',
            libraryTitle: 'Films',
            isSharedAcrossAllServers: true,
            title: 'Valid Thriller',
            originalTitle: 'Valid Thriller',
            year: 2014
          }
        ],
        provenance: []
      })
    } as unknown as PlexMultiServerConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      { getMovieByTmdbId: vi.fn().mockResolvedValue({ movie: null }) } as unknown as RadarrConnector,
      {} as unknown as SonarrConnector,
      {} as unknown as ProwlarrConnector,
      mockMdblist
    );

    // L'utilisateur demande 5 films, seuls 2 correspondent après déduplication et rejet du type TV
    const res = await aggregator.discoverMediaByCriteria({
      rawCriteria: {
        mediaType: 'movie',
        genres: ['thriller'],
        yearFrom: 2010,
        yearTo: 2020,
        ratingSource: 'imdb',
        minRating: 8,
        ratingComparison: 'gt',
        excludeWatched: false,
        limit: 5
      }
    });

    expect(res.cards).toHaveLength(2);
    expect(res.cards.map((c) => c.identity.tmdbId)).toEqual([401, 402]);
    expect(res.shortfallReasonFr).toContain('Seul(s) 2 titre(s) sur les 5 demandés');
    expect(res.shortfallReasonFr).toContain('Aucun titre hors critères');
  });

  it('T-MDB-12: handles conversational follow-up modifications ("Seulement sur Plex", "Plutôt des comédies", "Et moins de 90 minutes", "Finalement à partir de 2000")', () => {
    const initial = validateAndNormalizeCriteria({
      mediaType: 'movie',
      genres: ['thriller'],
      yearFrom: 2010,
      yearTo: 2020,
      ratingSource: 'imdb',
      minRating: 8,
      ratingComparison: 'gt',
      limit: 5
    });
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    // 1. "Seulement sur Plex"
    const step1 = mergeFollowUpCriteria(initial.criteria, {
      scope: 'on_plex_now'
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    expect(step1.criteria.scope).toBe('on_plex_now');
    expect(step1.criteria.genres).toEqual(['thriller']);
    expect(step1.criteria.minRating).toBe(8);

    // 2. "Plutôt des comédies"
    const step2 = mergeFollowUpCriteria(step1.criteria, {
      genres: ['comédie']
    });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    expect(step2.criteria.genres).toEqual(['comedy']);
    expect(step2.criteria.scope).toBe('on_plex_now');

    // 3. "Et moins de 90 minutes"
    const step3 = mergeFollowUpCriteria(step2.criteria, {
      maxRuntimeMinutes: 90,
      maxRuntimeComparison: 'lt'
    });
    expect(step3.ok).toBe(true);
    if (!step3.ok) return;
    expect(step3.criteria.maxRuntimeMinutes).toBe(90);
    expect(step3.criteria.maxRuntimeComparison).toBe('lt');

    // 4. "Finalement à partir de 2000"
    const step4 = mergeFollowUpCriteria(step3.criteria, {
      yearFrom: 2000
    });
    expect(step4.ok).toBe(true);
    if (!step4.ok) return;
    expect(step4.criteria.yearFrom).toBe(2000);
    expect(step4.criteria.yearTo).toBe(2020);
    expect(step4.criteria.genres).toEqual(['comedy']);
    expect(step4.criteria.maxRuntimeMinutes).toBe(90);
  });

  it('T-MDB-14: handles MDBList API errors (missing key, 401/403, 429 Retry-After, 202 Accepted Retry-After, timeout, empty response), caches normalized queries, and exposes zero list-modification methods', async () => {
    const validCriteriaRes = validateAndNormalizeCriteria({
      mediaType: 'movie',
      genres: ['thriller'],
      yearFrom: 2010,
      yearTo: 2020,
      ratingSource: 'imdb',
      minRating: 8,
      ratingComparison: 'gt',
      limit: 5
    });
    expect(validCriteriaRes.ok).toBe(true);
    if (!validCriteriaRes.ok) return;
    const criteria = validCriteriaRes.criteria;

    // 1. Clé API absente
    const unconfigured = new MdblistConnector('https://api.mdblist.com', '');
    await expect(unconfigured.searchCatalog(criteria)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED'
    });

    // 2. Erreur 401 / 403 (abonnement ou clé invalide) sans fuite de clé dans le message d'erreur
    const fetch403 = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Patron tier required' }), { status: 403 })
    );
    const conn403 = new MdblistConnector('https://api.mdblist.com', 'SUPER_SECRET_MDB_KEY', {
      fetchImpl: fetch403 as unknown as typeof fetch
    });
    await expect(conn403.searchCatalog(criteria)).rejects.toSatisfy((err: unknown) => {
      const e = err as { code?: string; message?: string };
      return e.code === 'FORBIDDEN_TIER' && !String(e.message).includes('SUPER_SECRET_MDB_KEY');
    });

    // 3. 429 Too Many Requests avec Retry-After respecté (1 seul retry borné) + format réel /catalog/movie (movies, pagination, quota, ratings)
    const sleepSpy = vi.fn().mockResolvedValue(undefined);
    let callCount429 = 0;
    let capturedUrl = '';
    const fetch429Then200 = vi.fn().mockImplementation(async (url: string | URL) => {
      capturedUrl = String(url);
      callCount429++;
      if (callCount429 === 1) {
        return new Response(JSON.stringify({ error: 'Rate limit' }), {
          status: 429,
          headers: { 'Retry-After': '2' }
        });
      }
      return new Response(
        JSON.stringify({
          movies: [
            {
              id: 777,
              imdb_id: 'tt0777777',
              ids: { mdblist: 'mdb777', imdb: 'tt0777777', tmdb: 777, tvdb: null },
              title: 'Recovered After 429',
              release_year: 2016,
              runtime: 105,
              language: 'en',
              genres: ['thriller'],
              ratings: [
                { source: 'imdb', value: 8.4, score: 84, votes: 42000 },
                { source: 'mdblist', value: 84, score: 84, votes: 6 }
              ]
            }
          ],
          pagination: {
            limit: 25,
            has_more: false,
            next_cursor: null
          },
          quota: {
            limit: 30,
            used: 4,
            remaining: 26,
            window_days: 7
          }
        }),
        { status: 200 }
      );
    });

    const conn429 = new MdblistConnector('https://api.mdblist.com', 'SECRET_KEY', {
      fetchImpl: fetch429Then200 as unknown as typeof fetch,
      sleepFn: sleepSpy,
      maxRetryAfterWaitMs: 5000
    });

    const resAfter429 = await conn429.searchCatalog(criteria);
    expect(sleepSpy).toHaveBeenCalledWith(2000);
    expect(capturedUrl).toContain('genre=thriller');
    expect(capturedUrl).toContain('year_min=2010');
    expect(capturedUrl).toContain('year_max=2020');
    expect(capturedUrl).toContain('sort=imdbrating');
    expect(capturedUrl).toContain('sort_order=desc');
    expect(capturedUrl).toContain('append_to_response=genres%2Cposter%2Cdescription%2Cratings_all');
    expect(resAfter429.candidates).toHaveLength(1);
    expect(resAfter429.candidates[0].tmdbId).toBe(777);
    expect(resAfter429.candidates[0].ratingsBySource.imdb?.score).toBe(8.4);
    expect(resAfter429.candidates[0].ratingsBySource.mdblist?.score).toBe(84);
    expect(resAfter429.rateLimitRemaining).toBe(26);
    expect(resAfter429.fromCache).toBe(false);

    // 4. Vérification du cache borné indexé par critères normalisés (2e appel = cache hit, 0 requête HTTP supplémentaire)
    const cachedRes = await conn429.searchCatalog(criteria);
    expect(cachedRes.fromCache).toBe(true);
    expect(fetch429Then200).toHaveBeenCalledTimes(2);

    // 5. 202 Accepted (construction de cache côté MDBList) suivi d'une réponse vide
    let callCount202 = 0;
    const fetch202ThenEmpty = vi.fn().mockImplementation(async () => {
      callCount202++;
      if (callCount202 === 1) {
        return new Response('', {
          status: 202,
          headers: { 'Retry-After': '1' }
        });
      }
      return new Response(JSON.stringify({ items: [], has_more: false }), { status: 200 });
    });

    const conn202 = new MdblistConnector('https://api.mdblist.com', 'SECRET_KEY', {
      fetchImpl: fetch202ThenEmpty as unknown as typeof fetch,
      sleepFn: vi.fn().mockResolvedValue(undefined)
    });
    const emptyRes = await conn202.searchCatalog(criteria);
    expect(emptyRes.candidates).toEqual([]);
    expect(emptyRes.hasMore).toBe(false);

    // 6. Timeout réseau géré proprement
    const fetchTimeout = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    );
    const connTimeout = new MdblistConnector('https://api.mdblist.com', 'SECRET_KEY', {
      fetchImpl: fetchTimeout as unknown as typeof fetch,
      requestTimeoutMs: 1500
    });
    await expect(connTimeout.searchCatalog(criteria)).rejects.toMatchObject({
      code: 'TIMEOUT'
    });

    // 7. Garantie d'architecture : aucune méthode d'écriture/modification de liste sur MdblistConnector
    const protoMethods = Object.getOwnPropertyNames(MdblistConnector.prototype);
    expect(protoMethods.some((m) => /create|delete|modify|addList|removeList|watchlist/i.test(m))).toBe(
      false
    );
  });

  it('T-MDB-15: supports limit up to 12, enforces matchesGenreConstraint against off-genre items, and supplements on_plex_now/any from local Plex catalog', async () => {
    const crit10 = validateAndNormalizeCriteria({
      mediaType: 'movie',
      genres: ['romance', 'comédie'],
      genreOperator: 'or',
      isRecent: true,
      limit: 10
    });
    expect(crit10.ok).toBe(true);
    if (!crit10.ok) return;
    expect(crit10.criteria.limit).toBe(10);

    // Off-genre items (Documentary, War Drama, Action Animation) are rejected when looking for Romance OR Comedy
    expect(matchesGenreConstraint(['Documentaire'], crit10.criteria)).toBe(false);
    expect(matchesGenreConstraint(['Drame', 'Guerre'], crit10.criteria)).toBe(false);
    expect(matchesGenreConstraint(['Animation', 'Action'], crit10.criteria)).toBe(false);
    expect(matchesGenreConstraint(['Drame', 'Romance'], crit10.criteria)).toBe(true);
    expect(matchesGenreConstraint(['Comédie romantique'], crit10.criteria)).toBe(true);

    // Local Plex catalog supplement when MDBList only returns 1 Plex movie
    const mockMdblist = {
      isConfigured: () => true,
      searchCatalog: vi.fn().mockResolvedValue({
        candidates: [
          {
            tmdbId: 801,
            imdbId: 'tt0801801',
            tvdbId: null,
            traktId: null,
            mdblistId: 'mdb-801',
            mediaType: 'movie',
            title: 'Off Genre War Movie',
            originalTitle: 'Off Genre War Movie',
            year: 2025,
            runtimeMinutes: 110,
            originalLanguage: 'en',
            genres: ['war', 'drama'],
            imdbRating: 7.5,
            imdbVotes: 5000,
            tmdbRating: 7.4,
            mdblistScore: 75,
            ratingsBySource: { imdb: { score: 7.5, votes: 5000 } }
          }
        ],
        nextCursor: null,
        hasMore: false,
        totalResults: 1,
        fromCache: false,
        rateLimitRemaining: 900
      }),
      getMediaDetailByTmdbId: vi.fn(),
      getMediaDetailByImdbId: vi.fn()
    } as unknown as MdblistConnector;

    const mockOverseerr = {
      getMediaDetail: vi.fn().mockResolvedValue(
        createBaseOverseerrDetail({
          tmdbId: 802,
          imdbId: 'tt0802802',
          titleFr: 'Romance Sur Plex',
          originalTitle: 'Romance On Plex',
          year: 2024,
          genres: ['Romance', 'Comédie'],
          runtimeMinutes: 105
        })
      )
    } as unknown as OverseerrConnector;

    const mockPlex = {
      discoverOnPlex: vi.fn().mockResolvedValue({
        items: [
          {
            serverName: 'NucVillers',
            ratingKey: '802',
            type: 'movie',
            title: 'Romance Sur Plex',
            originalTitle: 'Romance On Plex',
            year: 2024,
            summary: 'Une belle romance.',
            librarySectionTitle: 'Films',
            isSharedAcrossAllServers: true,
            guids: ['tmdb://802'],
            audienceRating: 7.6,
            criticRating: 8.0,
            genres: ['Romance', 'Comedy'],
            directors: ['Celine Song'],
            cast: ['Actor A'],
            durationMinutes: 105
          }
        ],
        provenance: []
      }),
      findMediaAcrossServers: vi.fn().mockResolvedValue({
        state: 'available_now',
        serversQueried: ['NucVillers'],
        matchedDetails: [],
        matchedItems: [
          {
            serverName: 'NucVillers',
            ratingKey: '802',
            libraryTitle: 'Films',
            isSharedAcrossAllServers: true,
            title: 'Romance Sur Plex',
            originalTitle: 'Romance On Plex',
            year: 2024
          }
        ],
        provenance: []
      })
    } as unknown as PlexMultiServerConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      { getMovieByTmdbId: vi.fn().mockResolvedValue({ movie: null }) } as unknown as RadarrConnector,
      {} as unknown as SonarrConnector,
      {} as unknown as ProwlarrConnector,
      mockMdblist
    );

    const res = await aggregator.discoverMediaByCriteria({
      rawCriteria: {
        mediaType: 'movie',
        genres: ['romance', 'comedy'],
        genreOperator: 'or',
        yearFrom: 2023,
        yearTo: 2026,
        scope: 'on_plex_now',
        excludeWatched: false,
        limit: 10
      }
    });

    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].identity.tmdbId).toBe(802);
    expect(res.stats.rejectedByCriteriaCount).toBe(1);
  });
});
