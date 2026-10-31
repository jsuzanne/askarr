import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config/env.js';

describe('Phase G4: 2-Step Confirmation Token & Cloudflare Access Sync Tests', () => {
  it('T-G4-01: enforces 2-step confirmation (prepare -> confirm), single-use token, and ownership', async () => {
    const overseerrPostCalls: Array<Record<string, unknown>> = [];

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      // Overseerr users list (userType === 1 Plex friend)
      if (url.includes('/api/v1/user')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 42,
                email: 'ami.plex@example.com',
                plexUsername: 'AmiPlex',
                displayName: 'Ami Plex',
                userType: 1,
                permissions: 32,
                requestCount: 3
              },
              {
                id: 99,
                email: 'local.only@example.com',
                plexUsername: null,
                displayName: 'Local Only',
                userType: 2,
                permissions: 0,
                requestCount: 0
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Overseerr movie detail (not yet requested, not on Plex)
      if (url.includes('/api/v1/movie/872585')) {
        return new Response(
          JSON.stringify({
            id: 872585,
            title: 'Oppenheimer',
            originalTitle: 'Oppenheimer',
            releaseDate: '2023-07-19',
            runtime: 180,
            voteAverage: 8.1,
            overview: 'Biopic sur J. Robert Oppenheimer.',
            genres: [{ name: 'Drame' }, { name: 'Histoire' }],
            externalIds: { imdbId: 'tt15398776' },
            mediaInfo: undefined
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Overseerr POST /api/v1/request
      if (url.includes('/api/v1/request') && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}'));
        overseerrPostCalls.push(body);
        return new Response(
          JSON.stringify({
            id: 777,
            status: 2,
            createdAt: '2026-03-30T22:00:00.000Z',
            media: { status: 3, tmdbId: body.mediaId }
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Plex & Radarr empty responses (not in catalog yet)
      if (url.includes(':32400/')) {
        return new Response(JSON.stringify({ MediaContainer: { size: 0, Metadata: [], Directory: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes(':7878/')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const config = loadConfig({
      NODE_ENV: 'test',
      ALLOW_DEV_AUTH_HEADER: 'true',
      ADMIN_EMAILS: 'admin@example.com',
      SQLITE_DB_PATH: ':memory:',
      PLEX_SERVERS: 'NucVillers|http://192.168.1.163:32400',
      PLEX_TOKEN: 'fake-plex',
      OVERSEERR_BASE_URL: 'http://192.168.1.154:5055',
      OVERSEERR_API_KEY: 'fake-overseerr',
      RADARR_BASE_URL: 'http://192.168.1.154:7878',
      RADARR_API_KEY: 'fake-radarr'
    });

    const { app, db } = await createApp({ config, fetchImpl: mockFetch });

    // Step 1: Prepare request -> must NOT call POST /api/v1/request yet
    const prepRes = await app.inject({
      method: 'POST',
      url: '/api/requests/prepare',
      headers: { 'x-dev-user-email': 'ami.plex@example.com' },
      payload: { tmdbId: 872585, mediaType: 'movie' }
    });

    expect(prepRes.statusCode).toBe(200);
    const prepData = prepRes.json();
    expect(prepData.preparedAction.actionId).toMatch(/^act_/);
    expect(prepData.preparedAction.status).toBe('PENDING');
    expect(overseerrPostCalls).toHaveLength(0);

    const actionId = prepData.preparedAction.actionId as string;

    // Security check: another user cannot confirm someone else's token
    const otherUserRes = await app.inject({
      method: 'POST',
      url: '/api/requests/confirm',
      headers: { 'x-dev-user-email': 'admin@example.com' },
      payload: { actionId }
    });
    expect(otherUserRes.statusCode).toBe(403);
    expect(overseerrPostCalls).toHaveLength(0);

    // Step 2: Confirm request -> executes POST /api/v1/request once with userId=42
    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/requests/confirm',
      headers: { 'x-dev-user-email': 'ami.plex@example.com' },
      payload: { actionId }
    });

    expect(confirmRes.statusCode).toBe(200);
    const confirmData = confirmRes.json();
    expect(confirmData.status).toBe('EXECUTED');
    expect(confirmData.overseerrRequestId).toBe(777);
    expect(overseerrPostCalls).toHaveLength(1);
    expect(overseerrPostCalls[0]).toEqual({
      mediaType: 'movie',
      mediaId: 872585,
      is4k: false,
      userId: 42
    });

    // Step 3: Re-using the same actionId is blocked (409 ACTION_ALREADY_CONSUMED)
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/requests/confirm',
      headers: { 'x-dev-user-email': 'ami.plex@example.com' },
      payload: { actionId }
    });
    expect(replayRes.statusCode).toBe(409);
    expect(overseerrPostCalls).toHaveLength(1);

    db.close();
    await app.close();
  });

  it('T-G4-02: Cloudflare Access sync enforces userType === 1 Plex friend, preserves non-email rules, and supports SQLite rollback', async () => {
    let currentCfPolicy = {
      id: 'pol-askarr-123',
      name: 'askarr-allow-users',
      decision: 'allow',
      include: [
        { ip: { ip: '192.168.1.0/24' } },
        { email: { email: 'admin@example.com' } }
      ],
      exclude: [],
      require: []
    };

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/api/v1/user')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 10,
                email: 'jean.ami@example.com',
                plexUsername: 'JeanAmi',
                displayName: 'Jean Ami',
                userType: 1,
                permissions: 32,
                requestCount: 1
              },
              {
                id: 20,
                email: 'local.account@example.com',
                plexUsername: null,
                displayName: 'Local Account',
                userType: 2,
                permissions: 0,
                requestCount: 0
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/access/policies/pol-askarr-123') && method === 'GET') {
        return new Response(JSON.stringify({ success: true, result: currentCfPolicy }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/access/policies/pol-askarr-123') && method === 'PUT') {
        const body = JSON.parse(String(init?.body || '{}'));
        currentCfPolicy = {
          ...currentCfPolicy,
          include: body.include
        };
        return new Response(JSON.stringify({ success: true, result: currentCfPolicy }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/access/policies')) {
        return new Response(JSON.stringify({ success: true, result: [currentCfPolicy] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/access/groups')) {
        return new Response(JSON.stringify({ success: true, result: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const config = loadConfig({
      NODE_ENV: 'test',
      ALLOW_DEV_AUTH_HEADER: 'true',
      ADMIN_EMAILS: 'admin@example.com',
      SQLITE_DB_PATH: ':memory:',
      OVERSEERR_BASE_URL: 'http://192.168.1.154:5055',
      OVERSEERR_API_KEY: 'fake-overseerr',
      CLOUDFLARE_ACCOUNT_ID: 'acc-123',
      CLOUDFLARE_API_TOKEN: 'cf-tok-123',
      CF_ACCESS_TARGET_MODE: 'policy',
      CF_ACCESS_TARGET_ID: 'pol-askarr-123'
    });

    const { app, db } = await createApp({ config, fetchImpl: mockFetch });

    // 1. Rejects local-only Overseerr user (userType === 2)
    const rejectLocalRes = await app.inject({
      method: 'POST',
      url: '/api/admin/cloudflare/emails/add',
      headers: { 'x-dev-user-email': 'admin@example.com' },
      payload: { email: 'local.account@example.com' }
    });
    expect(rejectLocalRes.statusCode).toBe(400);
    expect(rejectLocalRes.json().error).toBe('NOT_A_PLEX_FRIEND');

    // 2. Accepts valid Plex friend (userType === 1), snapshots into SQLite, and preserves IP rule
    const addPlexFriendRes = await app.inject({
      method: 'POST',
      url: '/api/admin/cloudflare/emails/add',
      headers: { 'x-dev-user-email': 'admin@example.com' },
      payload: { email: 'jean.ami@example.com' }
    });
    expect(addPlexFriendRes.statusCode).toBe(200);
    const addedBody = addPlexFriendRes.json();
    expect(addedBody.updatedEmails).toEqual(['admin@example.com', 'jean.ami@example.com']);
    expect(currentCfPolicy.include[0]).toEqual({ ip: { ip: '192.168.1.0/24' } });

    const revisionId = addedBody.revisionId as number;
    expect(revisionId).toBeGreaterThan(0);

    // 3. Protects admin email from deletion
    const removeAdminRes = await app.inject({
      method: 'POST',
      url: '/api/admin/cloudflare/emails/remove',
      headers: { 'x-dev-user-email': 'admin@example.com' },
      payload: { email: 'admin@example.com' }
    });
    expect(removeAdminRes.statusCode).toBe(400);

    // 4. Rollback restores exact previous state
    const rollbackRes = await app.inject({
      method: 'POST',
      url: `/api/admin/cloudflare/rollback/${revisionId}`,
      headers: { 'x-dev-user-email': 'admin@example.com' }
    });
    expect(rollbackRes.statusCode).toBe(200);
    expect(rollbackRes.json().restoredEmails).toEqual(['admin@example.com']);
    expect(currentCfPolicy.include).toHaveLength(2); // 1 IP rule + 1 admin email

    db.close();
    await app.close();
  });
});
