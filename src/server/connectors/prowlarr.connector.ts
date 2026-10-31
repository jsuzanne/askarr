import type { MediaType } from '../../shared/types.js';

export interface SanitizedProwlarrRelease {
  title: string;
  indexer: string;
  sizeBytes: number;
  seeders: number | null;
  ageDays: number | null;
}

export class ProwlarrConnector {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  public updateConfig(baseUrl?: string, apiKey?: string): void {
    if (typeof baseUrl === 'string' && baseUrl.trim()) {
      this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    }
    if (typeof apiKey === 'string' && apiKey.trim() && !apiKey.includes('••••')) {
      this.apiKey = apiKey.trim();
    }
  }

  private async getJson<T>(pathWithQuery: string, timeoutMs = 8000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${pathWithQuery}`, {
        method: 'GET',
        headers: {
          'X-Api-Key': this.apiKey,
          Accept: 'application/json'
        },
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`PROWLARR_HTTP_${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  public async checkHealth(): Promise<{
    ok: boolean;
    version?: string;
    activeIndexersCount: number;
    backoffIndexersCount: number;
    latencyMs: number;
    error?: string;
  }> {
    const t0 = Date.now();
    try {
      const [status, indexers, indexerStatuses] = await Promise.all([
        this.getJson<{ version?: string }>('/api/v1/system/status'),
        this.getJson<Array<{ enable?: boolean }>>('/api/v1/indexer'),
        this.getJson<Array<{ disabledTill?: string }>>('/api/v1/indexerstatus')
      ]);
      const activeIndexersCount = (indexers || []).filter((i) => i.enable).length;
      const backoffIndexersCount = (indexerStatuses || []).length;
      return {
        ok: true,
        version: status.version,
        activeIndexersCount,
        backoffIndexersCount,
        latencyMs: Date.now() - t0
      };
    } catch (err) {
      return {
        ok: false,
        activeIndexersCount: 0,
        backoffIndexersCount: 0,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : 'UNKNOWN_ERROR'
      };
    }
  }

  /**
   * Recherche contrôlée sur Prowlarr avec :
   * 1. Filtrage obligatoire par catégorie (2000 = Films, 5000 = Séries TV) pour exclure les jeux PC (observation G1).
   * 2. Purge immédiate des champs sensibles `guid`, `downloadUrl` et `infoUrl` (qui contiennent des passkeys privés).
   */
  public async searchMediaReleases(
    query: string,
    mediaType: MediaType
  ): Promise<{
    releases: SanitizedProwlarrRelease[];
    bestQualityHint: string | null;
    latencyMs: number;
  }> {
    const t0 = Date.now();
    const category = mediaType === 'movie' ? 2000 : 5000;
    const encodedQuery = encodeURIComponent(query.trim());
    const rawItems = await this.getJson<Array<Record<string, unknown>>>(
      `/api/v1/search?query=${encodedQuery}&categories=${category}&type=search`
    );

    // Expurgation stricte : on ne conserve JAMAIS guid, downloadUrl ni infoUrl
    const sanitized: SanitizedProwlarrRelease[] = (rawItems || []).slice(0, 15).map((r) => ({
      title: String(r.title || ''),
      indexer: String(r.indexer || 'Indexer'),
      sizeBytes: Number(r.size || 0),
      seeders: typeof r.seeders === 'number' ? r.seeders : null,
      ageDays: typeof r.age === 'number' ? r.age : null
    }));

    let bestQualityHint: string | null = null;
    for (const rel of sanitized) {
      const t = rel.title.toUpperCase();
      if (t.includes('2160P') || t.includes('4K')) {
        bestQualityHint = '4K / 2160p';
        break;
      }
      if (t.includes('1080P')) {
        bestQualityHint = 'Full HD 1080p';
      } else if (!bestQualityHint && t.includes('720P')) {
        bestQualityHint = 'HD 720p';
      }
    }

    return {
      releases: sanitized,
      bestQualityHint,
      latencyMs: Date.now() - t0
    };
  }
}
