import { describe, it, expect, vi } from 'vitest';
import { MediaAggregatorService } from '../../src/server/aggregator/media-aggregator.service.js';
import type { PlexMultiServerConnector } from '../../src/server/connectors/plex.connector.js';
import type { OverseerrConnector } from '../../src/server/connectors/overseerr.connector.js';
import type { RadarrConnector } from '../../src/server/connectors/radarr.connector.js';
import type { SonarrConnector } from '../../src/server/connectors/sonarr.connector.js';
import type { ProwlarrConnector } from '../../src/server/connectors/prowlarr.connector.js';

describe('MediaAggregatorService 8-Dimensional Evidence & Advisor Tests', () => {
  it('T-AGG-01: identifies a movie not on Plex but monitored in Radarr and computes VOD/DVD release timeline', async () => {
    const mockPlex = {
      findMediaAcrossServers: vi.fn().mockResolvedValue({
        state: 'not_in_catalog',
        serversQueried: ['NucVillers', 'NucBuntu'],
        matchedDetails: [],
        matchedItems: [],
        provenance: []
      })
    } as unknown as PlexMultiServerConnector;

    const mockOverseerr = {
      getMediaDetail: vi.fn().mockResolvedValue({
        tmdbId: 999111,
        mediaType: 'movie',
        tvdbId: null,
        imdbId: 'tt26446278',
        titleFr: 'Le Comte de Monte-Cristo',
        originalTitle: 'Le Comte de Monte-Cristo',
        year: 2024,
        overviewFr: 'Victime d’un complot, le jeune Edmond Dantès est arrêté le jour de son mariage...',
        posterUrl: 'https://image.tmdb.org/t/p/w500/monte-cristo.jpg',
        genres: ['Aventure', 'Drame', 'Histoire'],
        runtimeMinutes: 178,
        voteAverage: 8.4,
        directorOrCreator: 'Matthieu Delaporte, Alexandre de La Patellière',
        topCast: ['Pierre Niney', 'Bastien Bouillon', 'Anaïs Demoustier'],
        tmdbReleases: {
          inCinemas: '2026-06-28',
          digitalRelease: '2026-10-24',
          physicalRelease: '2026-11-06'
        },
        totalSeasons: 0,
        seasonsMeta: [],
        requestInfo: {
          mediaStatus: 3,
          latestRequestId: 10,
          latestRequestStatus: 2,
          requestedAt: '2026-07-01T10:00:00Z',
          requestedByUserId: 1,
          requestedByEmail: 'friend@example.com',
          requestedByDisplayName: 'Alice',
          requestedSeasons: []
        }
      })
    } as unknown as OverseerrConnector;

    const mockRadarr = {
      getMovieByTmdbId: vi.fn().mockResolvedValue({
        movie: {
          id: 42,
          tmdbId: 999111,
          title: 'Le Comte de Monte-Cristo',
          monitored: true,
          hasFile: false,
          status: 'inCinemas',
          inCinemas: '2026-06-28',
          digitalRelease: '2026-10-24',
          physicalRelease: '2026-11-06'
        }
      }),
      getQueueForMovie: vi.fn().mockResolvedValue(null)
    } as unknown as RadarrConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      mockRadarr,
      {} as unknown as SonarrConnector,
      {} as unknown as ProwlarrConnector
    );

    const ev = await aggregator.buildMediaEvidence({
      tmdbId: 999111,
      mediaType: 'movie',
      currentUserEmail: 'friend@example.com'
    });

    expect(ev.catalogPresence.state).toBe('not_in_catalog');
    expect(ev.acquisitionPipeline.state).toBe('monitored_waiting_release');
    expect(ev.identity.ratings.tmdbVoteAverage).toBe(8.4);
    expect(ev.identity.genres).toContain('Aventure');
    expect(ev.identity.topCast).toContain('Pierre Niney');
    expect(ev.identity.releaseDates.digitalRelease).toBe('2026-10-24');
    expect(ev.identity.releaseDates.physicalRelease).toBe('2026-11-06');
    expect(ev.requestState.sourceOrigin).toBe('overseerr_user');
    expect(ev.requestState.requestedByDisplayName).toBe('Alice');
    expect(ev.actionability.userFriendlyStatusLabel).toContain("Dans la liste d'attente");
    expect(ev.actionability.userFriendlyStatusLabel).toContain('demandé par Alice');
  });

  it('T-AGG-03: distinguishes a movie added automatically via a Radarr import list (auto_list) from an Overseerr user request', async () => {
    const mockPlex = {
      findMediaAcrossServers: vi.fn().mockResolvedValue({
        state: 'not_in_catalog',
        serversQueried: ['NucVillers'],
        matchedDetails: [],
        matchedItems: [],
        provenance: []
      })
    } as unknown as PlexMultiServerConnector;

    const mockOverseerr = {
      getMediaDetail: vi.fn().mockResolvedValue({
        tmdbId: 777333,
        mediaType: 'movie',
        tvdbId: null,
        imdbId: null,
        titleFr: 'Dune : Troisième Partie',
        originalTitle: 'Dune: Part Three',
        year: 2026,
        overviewFr: 'Suite de Dune.',
        posterUrl: null,
        genres: ['Science-Fiction'],
        runtimeMinutes: 165,
        voteAverage: 8.6,
        directorOrCreator: 'Denis Villeneuve',
        topCast: ['Timothée Chalamet'],
        tmdbReleases: {
          inCinemas: '2026-12-16',
          digitalRelease: null,
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
        }
      })
    } as unknown as OverseerrConnector;

    const mockRadarr = {
      getMovieByTmdbId: vi.fn().mockResolvedValue({
        movie: {
          id: 99,
          tmdbId: 777333,
          title: 'Dune: Part Three',
          monitored: true,
          hasFile: false,
          added: '2026-10-25',
          status: 'announced',
          inCinemas: '2026-12-16',
          digitalRelease: null,
          physicalRelease: null
        }
      }),
      getQueueForMovie: vi.fn().mockResolvedValue(null)
    } as unknown as RadarrConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      mockRadarr,
      {} as unknown as SonarrConnector,
      {} as unknown as ProwlarrConnector
    );

    const ev = await aggregator.buildMediaEvidence({
      tmdbId: 777333,
      mediaType: 'movie'
    });

    expect(ev.requestState.sourceOrigin).toBe('auto_list');
    expect(ev.requestState.requestedByDisplayName).toBeNull();
    expect(ev.actionability.userFriendlyStatusLabel).toContain('ajouté auto (liste)');
  });

  it('T-AGG-02: applies +120 days heuristic when a movie only has a theatrical release date', async () => {
    const mockPlex = {
      findMediaAcrossServers: vi.fn().mockResolvedValue({
        state: 'not_in_catalog',
        serversQueried: ['NucVillers'],
        matchedDetails: [],
        matchedItems: [],
        provenance: []
      })
    } as unknown as PlexMultiServerConnector;

    const mockOverseerr = {
      getMediaDetail: vi.fn().mockResolvedValue({
        tmdbId: 888222,
        mediaType: 'movie',
        tvdbId: null,
        imdbId: null,
        titleFr: 'Film En Salle',
        originalTitle: 'In Theaters Now',
        year: 2026,
        overviewFr: 'Un film tout juste sorti au cinéma.',
        posterUrl: null,
        genres: ['Action'],
        runtimeMinutes: 120,
        voteAverage: 7.5,
        directorOrCreator: 'Jane Doe',
        topCast: ['Actor One'],
        tmdbReleases: {
          inCinemas: '2026-08-01',
          digitalRelease: null,
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
        }
      })
    } as unknown as OverseerrConnector;

    const mockRadarr = {
      getMovieByTmdbId: vi.fn().mockResolvedValue({
        movie: null
      })
    } as unknown as RadarrConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      mockRadarr,
      {} as unknown as SonarrConnector,
      {} as unknown as ProwlarrConnector
    );

    const ev = await aggregator.buildMediaEvidence({
      tmdbId: 888222,
      mediaType: 'movie'
    });

    expect(ev.identity.releaseDates.isEstimatedDate).toBe(true);
    expect(ev.identity.releaseDates.estimatedVodOrDvdDate).toBe('2026-11-29');
  });

  it('T-AGG-04: verifySpecificTitles injects high-confidence local Radarr catalog matches from userQueryContext', async () => {
    const mockPlex = {
      findMediaAcrossServers: vi.fn().mockResolvedValue({
        state: 'available_now',
        serversQueried: ['NucVillers'],
        matchedDetails: [],
        matchedItems: [
          {
            serverName: 'NucVillers',
            ratingKey: '555',
            libraryTitle: 'Films',
            isSharedAcrossAllServers: true,
            title: 'Le rêve américain',
            originalTitle: 'Le rêve américain',
            year: 2026
          }
        ],
        provenance: []
      })
    } as unknown as PlexMultiServerConnector;

    const mockOverseerr = {
      search: vi.fn().mockResolvedValue([]),
      getMediaDetail: vi.fn().mockResolvedValue({
        tmdbId: 1365378,
        mediaType: 'movie',
        tvdbId: null,
        imdbId: 'tt33550099',
        titleFr: 'Le rêve américain',
        originalTitle: 'Le rêve américain',
        year: 2026,
        overviewFr:
          "Personne n'aurait parié sur Jérémy et Bouna pour devenir des agents qui comptent en NBA.",
        posterUrl: null,
        genres: ['Comédie', 'Drame'],
        runtimeMinutes: 120,
        voteAverage: 7.4,
        directorOrCreator: 'Anthony Marciano',
        topCast: ['Jean-Pascal Zadi', 'Raphaël Quenard'],
        tmdbReleases: {
          inCinemas: '2026-02-18',
          digitalRelease: null,
          physicalRelease: null
        },
        totalSeasons: 0,
        seasonsMeta: [],
        requestInfo: {
          mediaStatus: 5,
          latestRequestId: null,
          latestRequestStatus: null,
          requestedAt: null,
          requestedByUserId: null,
          requestedByEmail: null,
          requestedByDisplayName: null,
          requestedSeasons: []
        }
      })
    } as unknown as OverseerrConnector;

    const mockRadarr = {
      getCatalogIndex: vi.fn().mockResolvedValue({
        movies: [
          {
            id: 3333,
            tmdbId: 1365378,
            title: 'Le rêve américain',
            originalTitle: 'Le rêve américain',
            alternateTitles: [],
            year: 2026,
            overview:
              "Personne n'aurait parié sur Jérémy, coincé derrière le comptoir d'un vidéo club à Amiens, ou sur Bouna, lorsqu'il faisait le ménage à l'aéroport d'Orly. Sans contacts, sans argent et avec un anglais plus qu'approximatif, rien ne les prédestinait à devenir des agents qui comptent en NBA.",
            originalLanguage: 'French',
            monitored: true,
            hasFile: true
          }
        ],
        latencyMs: 1
      }),
      getMovieByTmdbId: vi.fn().mockResolvedValue({ movie: null }),
      getQueueForMovie: vi.fn().mockResolvedValue(null)
    } as unknown as RadarrConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      mockRadarr,
      {} as unknown as SonarrConnector,
      {} as unknown as ProwlarrConnector
    );

    const cards = await aggregator.verifySpecificTitles({
      items: [{ title: 'Un1que, Victor Wembanyama', year: 2023, mediaType: 'movie' }],
      userQueryContext:
        "Je cherche le film français récent qui raconte l'histoire de deux Français devenus agents de joueurs NBA comme Wembanyama"
    });

    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards[0].identity.tmdbId).toBe(1365378);
    expect(cards[0].identity.titleFr).toBe('Le rêve américain');
  });

  it('T-AGG-05: marks partially_available TV series (e.g. The Staircase 1/8 episodes) as actionable with requestableSeasons', async () => {
    const mockPlex = {
      findMediaAcrossServers: vi.fn().mockResolvedValue({
        state: 'available_now',
        serversQueried: ['NucVillers', 'NucBuntu'],
        matchedDetails: [],
        matchedItems: [
          {
            serverName: 'NucVillers',
            ratingKey: '991',
            libraryTitle: 'Series TV',
            isSharedAcrossAllServers: true,
            title: 'The Staircase',
            originalTitle: 'The Staircase',
            year: 2022
          }
        ],
        provenance: []
      })
    } as unknown as PlexMultiServerConnector;

    const mockOverseerr = {
      getMediaDetail: vi.fn().mockResolvedValue({
        tmdbId: 113988,
        mediaType: 'tv',
        tvdbId: 392556,
        imdbId: 'tt11324406',
        titleFr: 'The Staircase',
        originalTitle: 'The Staircase',
        year: 2022,
        overviewFr: "L'histoire de Michael Peterson...",
        posterUrl: null,
        genres: ['Drame', 'Crime'],
        runtimeMinutes: 65,
        voteAverage: 7.1,
        directorOrCreator: 'Antonio Campos',
        topCast: ['Colin Firth', 'Toni Collette'],
        tmdbReleases: {
          inCinemas: null,
          digitalRelease: null,
          physicalRelease: null
        },
        totalSeasons: 1,
        seasonsMeta: [{ seasonNumber: 1, episodeCount: 8, status: 4 }],
        requestInfo: {
          mediaStatus: 4,
          latestRequestId: 50,
          latestRequestStatus: 2,
          requestedAt: '2026-10-01T10:00:00Z',
          requestedByUserId: 1,
          requestedByEmail: 'user@example.com',
          requestedByDisplayName: 'Jean',
          requestedSeasons: [1]
        }
      })
    } as unknown as OverseerrConnector;

    const mockSonarr = {
      getSeriesByTvdbId: vi.fn().mockResolvedValue({
        series: {
          id: 77,
          tvdbId: 392556,
          title: 'The Staircase',
          monitored: false,
          seasons: [
            {
              seasonNumber: 1,
              monitored: false,
              episodeFileCount: 1,
              episodeCount: 8,
              totalEpisodeCount: 8,
              percentOfEpisodes: 12.5
            }
          ],
          statistics: {
            episodeFileCount: 1,
            episodeCount: 8,
            totalEpisodeCount: 8,
            percentOfEpisodes: 12.5
          }
        },
        latencyMs: 5
      }),
      getQueueForSeries: vi.fn().mockResolvedValue({ items: [], latencyMs: 2 })
    } as unknown as SonarrConnector;

    const aggregator = new MediaAggregatorService(
      mockOverseerr,
      mockPlex,
      {} as unknown as RadarrConnector,
      mockSonarr,
      {} as unknown as ProwlarrConnector
    );

    const ev = await aggregator.buildMediaEvidence({
      tmdbId: 113988,
      mediaType: 'tv',
      currentUserEmail: 'user@example.com'
    });

    expect(ev.catalogPresence.state).toBe('partially_available');
    expect(ev.actionability.canRequestNow).toBe(true);
    expect(ev.actionability.requestableSeasons).toEqual([1]);
    expect(ev.actionability.userFriendlyStatusLabel).toContain('1/8 ép.');
    expect(ev.actionability.userFriendlyExplanationFr).toContain('7 épisode(s) manquant(s)');
  });
});
