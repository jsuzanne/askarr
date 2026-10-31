import pino from 'pino';

const SENSITIVE_KEY_PATTERNS = /api[_-]?key|token|secret|password|authorization|cookie|passkey|downloadurl|infourl|guid/i;
const URL_SECRET_QUERY_REGEX = /([?&](?:apikey|api_key|token|passkey|X-Plex-Token)=)[^&\s"']+/gi;
const MAGNET_REGEX = /magnet:\?[^\s"']+/gi;
const EMAIL_IN_LOG_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function redactString(input: string): string {
  return input
    .replace(URL_SECRET_QUERY_REGEX, '$1[REDACTED]')
    .replace(MAGNET_REGEX, '[REDACTED_MAGNET]')
    .replace(EMAIL_IN_LOG_REGEX, '[REDACTED_EMAIL]');
}

export function redactObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return redactString(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERNS.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactObject(v);
      }
    }
    return out as T;
  }
  return obj;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["cf-access-jwt-assertion"]',
      'req.headers["x-plex-token"]',
      'req.headers["x-api-key"]',
      '*.apiKey',
      '*.token',
      '*.plexToken',
      '*.deepseekApiKey',
      '*.cloudflareApiToken',
      '*.downloadUrl',
      '*.guid',
      '*.infoUrl'
    ],
    censor: '[REDACTED]'
  }
});
