import { describe, it, expect } from 'vitest';
import { OverseerrConnector } from '../../src/server/connectors/overseerr.connector.js';
import { PlexMultiServerConnector } from '../../src/server/connectors/plex.connector.js';

describe('G1 Contract Tests (Overseerr RFC3986, VOD/DVD Releases & Multi-Server Plex)', () => {
  it('T-G1-OVERSEERR-ENC: encodes spaces as %20 (RFC 3986) and never +', async () => {
    const requestedUrls: string[] = [];
    const mockFetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;

    const overseerr = new OverseerrConnector('http://192.168.1.154:5055', 'fake-key', mockFetch);
    await overseerr.search('Le Comte de Monte Cristo');

    expect(requestedUrls[0]).toContain('Le%20Comte%20de%20Monte%20Cristo');
    expect(requestedUrls[0]).not.toContain('Le+Comte');
  });

  it('T-G1-OVERSEERR-ADVISOR: extracts TMDB ratings, cast, director, and FR/US Cinema/VOD/DVD release dates', async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          id: 693134,
          title: 'Dune : Deuxième Partie',
          originalTitle: 'Dune: Part Two',
          releaseDate: '2024-02-27',
          runtime: 166,
          voteAverage: 8.3,
          genres: [{ id: 878, name: 'Science-Fiction' }, { id: 12, name: 'Aventure' }],
          credits: {
            cast: [{ name: 'Timothée Chalamet' }, { name: 'Zendaya' }],
            crew: [{ name: 'Denis Villeneuve', job: 'Director' }]
          },
          releases: {
            results: [
              {
                iso_3166_1: 'FR',
                release_dates: [
                  { type: 3, release_date: '2024-02-28T00:00:00.000Z' },
                  { type: 4, release_date: '2024-06-27T00:00:00.000Z' },
                  { type: 5, release_date: '2024-07-10T00:00:00.000Z' }
                ]
              }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const overseerr = new OverseerrConnector('http://192.168.1.154:5055', 'fake-key', mockFetch);
    const details = await overseerr.getMediaDetail(693134, 'movie');

    expect(details.voteAverage).toBe(8.3);
    expect(details.directorOrCreator).toBe('Denis Villeneuve');
    expect(details.topCast).toContain('Timothée Chalamet');
    expect(details.tmdbReleases.inCinemas).toBe('2024-02-28');
    expect(details.tmdbReleases.digitalRelease).toBe('2024-06-27');
    expect(details.tmdbReleases.physicalRelease).toBe('2024-07-10');
  });

  it('T-G1-PLEX-MULTISERVER: cascades from NucVillers to NucBuntu when a movie is in a specialized library (Cinephile)', async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      // NucVillers returns empty for a specialized Cinephile classic
      if (url.includes('192.168.1.163:32400')) {
        return new Response(JSON.stringify({ MediaContainer: { size: 0, Hub: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      // NucBuntu returns the movie in library "Cinephile"
      if (url.includes('192.168.1.154:32400/hubs/search')) {
        return new Response(
          JSON.stringify({
            MediaContainer: {
              Hub: [
                {
                  type: 'movie',
                  Metadata: [{ ratingKey: '55123', type: 'movie' }]
                }
              ]
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('192.168.1.154:32400/library/metadata/55123')) {
        return new Response(
          JSON.stringify({
            MediaContainer: {
              size: 1,
              Metadata: [
                {
                  ratingKey: '55123',
                  title: 'Mulholland Drive',
                  originalTitle: 'Mulholland Dr.',
                  type: 'movie',
                  year: 2001,
                  librarySectionTitle: 'Cinephile',
                  rating: 7.9,
                  audienceRating: 8.4,
                  Genre: [{ tag: 'Mystery' }, { tag: 'Thriller' }],
                  Director: [{ tag: 'David Lynch' }],
                  Role: [{ tag: 'Naomi Watts' }, { tag: 'Laura Harring' }],
                  Guid: [{ id: 'tmdb://1018' }]
                }
              ]
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const plex = new PlexMultiServerConnector(
      [
        { name: 'NucVillers', baseUrl: 'http://192.168.1.163:32400' },
        { name: 'NucBuntu', baseUrl: 'http://192.168.1.154:32400' }
      ],
      'fake-plex-token',
      mockFetch
    );

    const result = await plex.findMediaAcrossServers({
      tmdbId: 1018,
      titleFr: 'Mulholland Drive',
      originalTitle: 'Mulholland Dr.',
      year: 2001,
      mediaType: 'movie'
    });

    expect(result.state).toBe('available_now');
    expect(result.serversQueried).toEqual(['NucVillers', 'NucBuntu']);
    expect(result.matchedItems[0].serverName).toBe('NucBuntu');
    expect(result.matchedItems[0].libraryTitle).toBe('Cinephile');
    expect(result.matchedItems[0].isSharedAcrossAllServers).toBe(false);
    expect(result.matchedDetails[0].audienceRating).toBe(8.4);
  });
});
