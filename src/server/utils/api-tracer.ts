import crypto from 'node:crypto';
import type { ApiTraceEntryDTO } from '../../shared/types.js';

function redactSensitiveStrings(input: string): string {
  return input
    .replace(/([?&](?:X-Plex-Token|apikey|apiKey|token|passkey)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/("?(?:apiKey|api_key|token|plexToken|password|secret)"?\s*:\s*")[^"]+"/gi, '$1[REDACTED]"');
}

export class ApiTracer {
  private entries: ApiTraceEntryDTO[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 250) {
    this.maxEntries = maxEntries;
  }

  public getEntries(limit = 120, serviceFilter?: string): ApiTraceEntryDTO[] {
    const filtered =
      serviceFilter && serviceFilter !== 'all'
        ? this.entries.filter((e) => e.service === serviceFilter)
        : this.entries;
    return filtered.slice(0, limit);
  }

  public clear(): void {
    this.entries = [];
  }

  public record(entry: Omit<ApiTraceEntryDTO, 'id' | 'timestamp'>): void {
    const fullEntry: ApiTraceEntryDTO = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.entries.unshift(fullEntry);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
  }

  public markPosition(): string | null {
    return this.entries[0]?.id || null;
  }

  public getEntriesSince(markerId: string | null): ApiTraceEntryDTO[] {
    if (!markerId) {
      return this.entries.slice(0, 40).reverse();
    }
    const idx = this.entries.findIndex((e) => e.id === markerId);
    if (idx <= 0) return [];
    return this.entries.slice(0, idx).reverse();
  }

  private classifyUrl(rawUrl: string): {
    service: ApiTraceEntryDTO['service'];
    serverLabel?: string;
    sanitizedUrl: string;
  } {
    const sanitizedUrl = redactSensitiveStrings(rawUrl)
      .replace(/([?&](?:X-Plex-Token|apikey|apiKey|token)=)[^&]+/gi, '$1[REDACTED]');

    const lower = rawUrl.toLowerCase();
    if (lower.includes(':32400') || lower.includes('plex.tv')) {
      const serverLabel = lower.includes('192.168.1.163')
        ? 'Plex NucVillers'
        : lower.includes('192.168.1.154')
          ? 'Plex NucBuntu'
          : lower.includes('plex.tv')
            ? 'Plex.tv Cloud Directory'
            : 'Plex';
      return { service: 'plex', serverLabel, sanitizedUrl };
    }
    if (lower.includes(':5055')) {
      return { service: 'overseerr', serverLabel: 'Overseerr', sanitizedUrl };
    }
    if (lower.includes(':7878')) {
      return { service: 'radarr', serverLabel: 'Radarr', sanitizedUrl };
    }
    if (lower.includes(':8989')) {
      return { service: 'sonarr', serverLabel: 'Sonarr', sanitizedUrl };
    }
    if (lower.includes(':9696')) {
      return { service: 'prowlarr', serverLabel: 'Prowlarr', sanitizedUrl };
    }
    if (lower.includes(':3999') || lower.includes('/api/v2/public/')) {
      return { service: 'tracearr', serverLabel: 'Tracearr Multi-Plex', sanitizedUrl };
    }
    if (lower.includes('deepseek.com')) {
      return { service: 'deepseek', serverLabel: 'DeepSeek LLM', sanitizedUrl };
    }
    if (lower.includes('generativelanguage.googleapis.com')) {
      return { service: 'deepseek', serverLabel: 'Google Gemini LLM', sanitizedUrl };
    }
    if (lower.includes('api.groq.com')) {
      return { service: 'deepseek', serverLabel: 'Groq Cloud LLM', sanitizedUrl };
    }
    if (lower.includes('api.mistral.ai')) {
      return { service: 'deepseek', serverLabel: 'Mistral AI LLM', sanitizedUrl };
    }
    if (lower.includes('openrouter.ai')) {
      return { service: 'deepseek', serverLabel: 'OpenRouter Free LLM', sanitizedUrl };
    }
    if (lower.includes('api.cloudflare.com')) {
      return { service: 'cloudflare', serverLabel: 'Cloudflare Zero Trust', sanitizedUrl };
    }
    return { service: 'other', sanitizedUrl };
  }

  private summarizeBody(rawText: string | undefined, maxLen = 380): string | undefined {
    if (!rawText) return undefined;
    const redacted = redactSensitiveStrings(rawText);
    if (redacted.length <= maxLen) return redacted;
    return `${redacted.slice(0, maxLen)}…`;
  }

  public wrapFetch(baseFetch: typeof fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || 'GET').toUpperCase();
      const { service, serverLabel, sanitizedUrl } = this.classifyUrl(rawUrl);

      let requestSummary: string | undefined;
      if (typeof init?.body === 'string' && init.body.length > 0) {
        try {
          const parsed = JSON.parse(init.body);
          if (service === 'deepseek' && parsed.messages) {
            const lastMsg = parsed.messages[parsed.messages.length - 1];
            requestSummary = `model=${parsed.model} | messages=${parsed.messages.length} | lastRole=${lastMsg?.role}`;
          } else {
            requestSummary = this.summarizeBody(init.body, 260);
          }
        } catch {
          requestSummary = this.summarizeBody(init.body, 260);
        }
      }

      const t0 = Date.now();
      try {
        const res = await baseFetch(input, init);
        const latencyMs = Date.now() - t0;

        let responseSummary: string | undefined;
        try {
          if (typeof res.clone === 'function') {
            const cloneText = await res.clone().text();
            responseSummary = this.summarizeBody(cloneText, 380);
          }
        } catch {
          // Ignore clone errors on mock responses
        }

        const entry: ApiTraceEntryDTO = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          service,
          serverLabel,
          method,
          url: sanitizedUrl,
          statusCode: res.status,
          ok: res.ok,
          latencyMs,
          requestSummary,
          responseSummary
        };

        this.entries.unshift(entry);
        if (this.entries.length > this.maxEntries) {
          this.entries.length = this.maxEntries;
        }

        return res;
      } catch (err) {
        const latencyMs = Date.now() - t0;
        const entry: ApiTraceEntryDTO = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          service,
          serverLabel,
          method,
          url: sanitizedUrl,
          statusCode: null,
          ok: false,
          latencyMs,
          requestSummary,
          error: redactSensitiveStrings(err instanceof Error ? err.message : 'FETCH_ERROR')
        };

        this.entries.unshift(entry);
        if (this.entries.length > this.maxEntries) {
          this.entries.length = this.maxEntries;
        }
        throw err;
      }
    }) as typeof fetch;
  }
}
