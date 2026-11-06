import { describe, it, expect, vi } from 'vitest';
import { TracearrConnector } from '../../src/server/connectors/tracearr.js';

describe('TracearrConnector Watch History & Telemetry Unit Tests', () => {
  const fakeBaseUrl = 'http://192.168.1.163:3999';
  const fakeApiKey = 'tracearr-test-key';

  it('T-TRACE-01: extracts watch history with flexible username matching (email prefix, name, username, object or string)', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v2/public/servers')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { server_id: 'srv-1', server_name: 'NucVillers' },
              { server_id: 'srv-2', server_name: 'NucBuntu' }
            ]
          })
        };
      }
      if (url.includes('/api/v2/public/history')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              // 1. user as object with username matching directly
              {
                id: 'hist-1',
                server_id: 'srv-1',
                media_type: 'movie',
                media_title: 'Gladiator II',
                year: 2024,
                tmdb_id: 558449,
                started_at: '2026-11-05T20:00:00Z',
                watched: true,
                percent_complete: 100,
                user: { username: 'jsuzanne' }
              },
              // 2. user as object with email prefix matching targetUser 'jsuzanne'
              {
                id: 'hist-2',
                server_name: 'NucBuntu',
                media_type: 'movie',
                media_title: 'Dune: Part Two',
                year: 2024,
                tmdb_id: 693134,
                started_at: '2026-11-04T19:00:00Z',
                watched: true,
                percent_complete: 95,
                user: { name: 'Jean-Louis', email: 'jsuzanne@example.com' }
              },
              // 3. user with friendly name / string
              {
                id: 'hist-3',
                server_id: 'srv-1',
                media_type: 'episode',
                show_title: 'Severance',
                season_number: 2,
                episode_number: 1,
                year: 2025,
                tmdb_id: 95557,
                started_at: '2026-11-03T21:00:00Z',
                watched: true,
                percent_complete: 100,
                user: 'jsuzanne'
              },
              // 4. another user (should be excluded when targetUser is 'jsuzanne')
              {
                id: 'hist-4',
                server_id: 'srv-1',
                media_type: 'movie',
                media_title: 'Inception',
                year: 2010,
                tmdb_id: 27205,
                started_at: '2026-11-02T18:00:00Z',
                watched: true,
                percent_complete: 80,
                user: { username: 'alice' }
              }
            ]
          })
        };
      }
      return { ok: false, status: 404 };
    });

    const connector = new TracearrConnector(fakeBaseUrl, fakeApiKey, mockFetch as unknown as typeof fetch);

    // Query for user 'jsuzanne' without mediaType filter
    const history = await connector.getWatchHistory({
      plexUsername: 'jsuzanne',
      allowedServers: ['NucVillers', 'NucBuntu']
    });

    expect(history.length).toBe(3);
    expect(history.map((h) => h.title)).toEqual([
      'Gladiator II',
      'Dune: Part Two',
      'Severance (S02E01)'
    ]);
    expect(history[0].serverName).toBe('NucVillers');
    expect(history[1].serverName).toBe('NucBuntu');
    expect(history[2].mediaType).toBe('tv');
  });

  it('T-TRACE-02: resolves server name from server_id and does not drop generic "Plex" fallback', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v2/public/servers')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ server_id: 'srv-alpha', server_name: 'NucVillers' }]
          })
        };
      }
      if (url.includes('/api/v2/public/history')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              // Has server_id but no server_name -> resolves to 'NucVillers'
              {
                id: 'hist-10',
                server_id: 'srv-alpha',
                media_type: 'movie',
                media_title: 'Oppenheimer',
                year: 2023,
                tmdb_id: 872585,
                started_at: '2026-11-01T20:00:00Z',
                watched: true,
                user: { username: 'jsuzanne' }
              },
              // Has neither server_id nor server_name -> defaults to 'Plex' (must NOT be dropped!)
              {
                id: 'hist-11',
                media_type: 'movie',
                media_title: 'Interstellar',
                year: 2014,
                tmdb_id: 157336,
                started_at: '2026-10-30T20:00:00Z',
                watched: true,
                user: { username: 'jsuzanne' }
              }
            ]
          })
        };
      }
      return { ok: false, status: 404 };
    });

    const connector = new TracearrConnector(fakeBaseUrl, fakeApiKey, mockFetch as unknown as typeof fetch);

    const history = await connector.getWatchHistory({
      plexUsername: 'jsuzanne',
      allowedServers: ['NucVillers']
    });

    expect(history.length).toBe(2);
    expect(history[0].serverName).toBe('NucVillers');
    expect(history[1].serverName).toBe('Plex');
  });

  it('T-TRACE-03: filters by mediaType (movie vs tv) and discards audio/track entries', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v2/public/history')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'hist-m1',
                media_type: 'movie',
                media_title: 'The Substance',
                year: 2024,
                tmdb_id: 933260,
                user: { username: 'jsuzanne' }
              },
              {
                id: 'hist-tv1',
                media_type: 'episode',
                show_title: 'The Penguin',
                season_number: 1,
                episode_number: 1,
                user: { username: 'jsuzanne' }
              },
              {
                id: 'hist-audio1',
                media_type: 'track',
                media_title: 'Song Title',
                user: { username: 'jsuzanne' }
              }
            ]
          })
        };
      }
      return { ok: false, status: 404 };
    });

    const connector = new TracearrConnector(fakeBaseUrl, fakeApiKey, mockFetch as unknown as typeof fetch);

    const moviesOnly = await connector.getWatchHistory({
      plexUsername: 'jsuzanne',
      mediaType: 'movie'
    });
    expect(moviesOnly.length).toBe(1);
    expect(moviesOnly[0].title).toBe('The Substance');

    // Reset raw cache to query tv
    (connector as any).watchHistoryRawCache = null;
    const tvOnly = await connector.getWatchHistory({
      plexUsername: 'jsuzanne',
      mediaType: 'tv'
    });
    expect(tvOnly.length).toBe(1);
    expect(tvOnly[0].title).toBe('The Penguin (S01E01)');
  });

  it('T-TRACE-04: getActiveStreams parses streams and server mapping correctly', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v2/public/servers')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ server_id: 'srv-1', server_name: 'NucVillers' }]
          })
        };
      }
      if (url.includes('/api/v2/public/streams')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                server_id: 'srv-1',
                media_title: 'Alien: Romulus',
                user: { name: 'jsuzanne' },
                device: 'Apple TV 4K',
                is_transcode: false,
                percent_complete: 42
              }
            ],
            summary: {
              total: 1,
              transcodes: 0,
              direct_plays: 1
            }
          })
        };
      }
      return { ok: false, status: 404 };
    });

    const connector = new TracearrConnector(fakeBaseUrl, fakeApiKey, mockFetch as unknown as typeof fetch);
    const active = await connector.getActiveStreams();

    expect(active.total).toBe(1);
    expect(active.directPlays).toBe(1);
    expect(active.streams.length).toBe(1);
    expect(active.streams[0].username).toBe('jsuzanne');
    expect(active.streams[0].serverName).toBe('NucVillers');
    expect(active.streams[0].title).toBe('Alien: Romulus');
    expect(active.streams[0].percentComplete).toBe(42);
  });
});
