import { describe, it, expect } from 'vitest';
import { redactString, redactObject } from '../../src/server/utils/logger.js';
import { parsePlexServers, loadConfig } from '../../src/server/config/env.js';
import { ProwlarrConnector } from '../../src/server/connectors/prowlarr.connector.js';

describe('Security, Redaction & Invariant Tests', () => {
  it('T-SEC-01: throws SECURITY_FATAL when NODE_ENV=production and ALLOW_DEV_AUTH_HEADER=true', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        ALLOW_DEV_AUTH_HEADER: 'true'
      })
    ).toThrow(/SECURITY_FATAL/);
  });

  it('T-SEC-02: redacts API keys, passkeys, magnet links, and personal emails in strings and objects', () => {
    const rawLog =
      'GET http://192.168.1.154:9696/api/v1/search?apikey=abcdef1234567890&passkey=sec999 magnet:?xt=urn:btih:12345 user=alice.friend@gmail.com';
    const cleaned = redactString(rawLog);

    expect(cleaned).not.toContain('abcdef1234567890');
    expect(cleaned).not.toContain('sec999');
    expect(cleaned).not.toContain('magnet:?xt=urn:btih:12345');
    expect(cleaned).not.toContain('alice.friend@gmail.com');
  });

  it('T-SEC-02b: strips downloadUrl, guid, infoUrl, and apiKey fields recursively from objects', () => {
    const rawPayload = {
      title: 'Dune.Part.Two.2024.1080p.WEB-DL',
      indexer: 'YGG',
      guid: 'https://tracker.secret/guid/12345?passkey=mysecret',
      downloadUrl: 'https://tracker.secret/download/12345?passkey=mysecret',
      infoUrl: 'https://tracker.secret/info/12345',
      nested: {
        apiKey: 'super-secret-api-key'
      }
    };

    const safe = redactObject(rawPayload) as Record<string, unknown>;
    expect(safe.guid).toBe('[REDACTED]');
    expect(safe.downloadUrl).toBe('[REDACTED]');
    expect(safe.infoUrl).toBe('[REDACTED]');
    expect((safe.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect(safe.title).toBe('Dune.Part.Two.2024.1080p.WEB-DL');
  });

  it('T-PLEX-CFG: parses multi-server PLEX_SERVERS string and preserves priority order', () => {
    const servers = parsePlexServers(
      'NucVillers|http://192.168.1.163:32400,NucBuntu|http://192.168.1.154:32400'
    );

    expect(servers).toHaveLength(2);
    expect(servers[0].name).toBe('NucVillers');
    expect(servers[0].baseUrl).toBe('http://192.168.1.163:32400');
    expect(servers[1].name).toBe('NucBuntu');
    expect(servers[1].baseUrl).toBe('http://192.168.1.154:32400');
  });

  it('T-G1-PROWLARR: ProwlarrConnector enforces categories 2000/5000 and strips URLs/GUIDs', async () => {
    const capturedUrls: string[] = [];
    const mockFetch = (async (input: RequestInfo | URL) => {
      capturedUrls.push(String(input));
      return new Response(
        JSON.stringify([
          {
            title: 'Anatomy.of.a.Fall.2023.1080p.BluRay.x264',
            indexer: 'TrackerFR',
            size: 8500000000,
            seeders: 42,
            age: 14,
            guid: 'https://secret.tracker/guid/999',
            downloadUrl: 'https://secret.tracker/dl/999?passkey=secret',
            infoUrl: 'https://secret.tracker/info/999'
          }
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const connector = new ProwlarrConnector('http://192.168.1.154:9696', 'fake-key', mockFetch);
    const res = await connector.searchMediaReleases('Anatomy of a Fall', 'movie');

    expect(capturedUrls[0]).toContain('categories=2000');
    expect(res.releases).toHaveLength(1);
    expect(res.bestQualityHint).toBe('Full HD 1080p');
    expect(res.releases[0].title).toContain('Anatomy.of.a.Fall');
    expect((res.releases[0] as unknown as Record<string, unknown>).guid).toBeUndefined();
    expect((res.releases[0] as unknown as Record<string, unknown>).downloadUrl).toBeUndefined();
    expect((res.releases[0] as unknown as Record<string, unknown>).infoUrl).toBeUndefined();
  });
});
