import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type { LlmProviderId, LlmRoutingMode } from '../../shared/types.js';

const envPath = path.resolve(process.cwd(), '.env');
const qualEnvPath = path.resolve(process.cwd(), '.env.qualification');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
if (fs.existsSync(qualEnvPath)) {
  dotenv.config({ path: qualEnvPath });
}

export interface PlexServerConfig {
  name: string;
  baseUrl: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  sqliteDbPath: string;
  cfAccessTeamDomain: string;
  cfAccessAud: string;
  adminEmails: string[];
  allowDevAuthHeader: boolean;
  devDefaultUserEmail: string;
  plexServers: PlexServerConfig[];
  plexToken: string;
  overseerrBaseUrl: string;
  overseerrApiKey: string;
  radarrBaseUrl: string;
  radarrApiKey: string;
  sonarrBaseUrl: string;
  sonarrApiKey: string;
  prowlarrBaseUrl: string;
  prowlarrApiKey: string;
  tracearrBaseUrl: string;
  tracearrApiKey: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  cfAccessTargetMode: 'policy' | 'group';
  cfAccessTargetId: string;
  deepseekBaseUrl: string;
  deepseekApiKey: string;
  deepseekModel: string;
  deepseekPriceInputCacheMissPer1M: number;
  deepseekPriceInputCacheHitPer1M: number;
  deepseekPriceOutputPer1M: number;
  llmRoutingMode?: LlmRoutingMode;
  llmManualProvider?: LlmProviderId;
  geminiApiKey?: string;
  geminiModel?: string;
  groqApiKey?: string;
  groqModel?: string;
  mistralApiKey?: string;
  mistralModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  aiDailyTokenCap: number;
  aiMonthlyBudgetUsd: number;
}

export function parsePlexServers(
  plexServersRaw?: string,
  plexVillersUrl?: string,
  plexBaseUrl?: string
): PlexServerConfig[] {
  if (plexServersRaw && plexServersRaw.trim().length > 0) {
    const entries = plexServersRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed: PlexServerConfig[] = [];
    for (const entry of entries) {
      if (entry.includes('|')) {
        const [name, url] = entry.split('|', 2);
        if (name && url) {
          parsed.push({ name: name.trim(), baseUrl: url.trim().replace(/\/+$/, '') });
        }
      } else {
        parsed.push({
          name: `Plex-${parsed.length + 1}`,
          baseUrl: entry.replace(/\/+$/, '')
        });
      }
    }
    if (parsed.length > 0) return parsed;
  }

  // Fallback intelligent qui inclut les 5 serveurs Plex du réseau local
  const servers: PlexServerConfig[] = [];
  const villers = (plexVillersUrl || 'http://192.168.1.163:32400').replace(/\/+$/, '');
  servers.push({ name: 'NucVillers', baseUrl: villers });

  const buntu = (plexBaseUrl || 'http://192.168.1.154:32400').replace(/\/+$/, '');
  if (buntu !== villers) {
    servers.push({ name: 'NucBuntu', baseUrl: buntu });
  }

  // Si aucun override restricteur n'est fourni, ajouter également les 3 autres serveurs Plex du LAN
  if (!plexVillersUrl && !plexBaseUrl) {
    servers.push(
      { name: 'EQ12buntu', baseUrl: 'http://192.168.1.61:32400' },
      { name: 'MacMini', baseUrl: 'http://192.168.1.9:32400' },
      { name: 'Macmini4', baseUrl: 'http://192.168.1.89:32400' }
    );
  }
  return servers;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnvRaw = (env.NODE_ENV || 'development').toLowerCase();
  const nodeEnv: AppConfig['nodeEnv'] =
    nodeEnvRaw === 'production' ? 'production' : nodeEnvRaw === 'test' ? 'test' : 'development';

  const allowDevAuthHeader = env.ALLOW_DEV_AUTH_HEADER === 'true';

  // Garde-fou critique de sécurité (CA-11 / ADR-004)
  if (nodeEnv === 'production' && allowDevAuthHeader) {
    throw new Error(
      'SECURITY_FATAL: ALLOW_DEV_AUTH_HEADER=true est strictement interdit lorsque NODE_ENV=production.'
    );
  }

  const adminEmails = (env.ADMIN_EMAILS || env.DEV_DEFAULT_USER_EMAIL || 'admin@askarr.local')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return {
    nodeEnv,
    port: Number(env.PORT || 4880),
    sqliteDbPath: env.SQLITE_DB_PATH || './data/askarr.db',
    cfAccessTeamDomain: (env.CF_ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    cfAccessAud: env.CF_ACCESS_AUD || '',
    adminEmails,
    allowDevAuthHeader,
    devDefaultUserEmail: (env.DEV_DEFAULT_USER_EMAIL || adminEmails[0] || 'admin@askarr.local').toLowerCase(),
    plexServers: parsePlexServers(env.PLEX_SERVERS, env.PLEX_VILLERS_BASE_URL, env.PLEX_BASE_URL),
    plexToken: env.PLEX_TOKEN || '',
    overseerrBaseUrl: (env.OVERSEERR_BASE_URL || 'http://192.168.1.154:5055').replace(/\/+$/, ''),
    overseerrApiKey: env.OVERSEERR_API_KEY || '',
    radarrBaseUrl: (env.RADARR_BASE_URL || 'http://192.168.1.154:7878').replace(/\/+$/, ''),
    radarrApiKey: env.RADARR_API_KEY || '',
    sonarrBaseUrl: (env.SONARR_BASE_URL || 'http://192.168.1.154:8989').replace(/\/+$/, ''),
    sonarrApiKey: env.SONARR_API_KEY || '',
    prowlarrBaseUrl: (env.PROWLARR_BASE_URL || 'http://192.168.1.154:9696').replace(/\/+$/, ''),
    prowlarrApiKey: env.PROWLARR_API_KEY || '',
    tracearrBaseUrl: (env.TRACEARR_BASE_URL || 'http://192.168.1.163:3999').replace(/\/+$/, ''),
    tracearrApiKey: env.TRACEARR_API_KEY || env.Tracearr_API_KEY || '',
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID || '',
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN || '',
    cfAccessTargetMode: env.CF_ACCESS_TARGET_MODE === 'policy' ? 'policy' : 'group',
    cfAccessTargetId: env.CF_ACCESS_TARGET_ID || '',
    deepseekBaseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    deepseekApiKey: env.DEEPSEEK_API_KEY || '',
    deepseekModel: env.DEEPSEEK_MODEL || 'deepseek-chat',
    deepseekPriceInputCacheMissPer1M: Number(env.DEEPSEEK_PRICE_INPUT_CACHE_MISS_PER_1M_USD || 0.27),
    deepseekPriceInputCacheHitPer1M: Number(env.DEEPSEEK_PRICE_INPUT_CACHE_HIT_PER_1M_USD || 0.07),
    deepseekPriceOutputPer1M: Number(env.DEEPSEEK_PRICE_OUTPUT_PER_1M_USD || 1.10),
    llmRoutingMode:
      env.LLM_ROUTING_MODE === 'manual' || env.LLM_ROUTING_MODE === 'load_balance'
        ? env.LLM_ROUTING_MODE
        : 'priority_cascade',
    llmManualProvider:
      env.LLM_MANUAL_PROVIDER === 'gemini' ||
      env.LLM_MANUAL_PROVIDER === 'groq' ||
      env.LLM_MANUAL_PROVIDER === 'mistral' ||
      env.LLM_MANUAL_PROVIDER === 'openrouter'
        ? env.LLM_MANUAL_PROVIDER
        : 'deepseek',
    geminiApiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    groqApiKey: env.GROQ_API_KEY || '',
    groqModel: env.GROQ_MODEL || 'openai/gpt-oss-120b',
    mistralApiKey: env.MISTRAL_API_KEY || '',
    mistralModel: env.MISTRAL_MODEL || 'mistral-small-latest',
    openrouterApiKey: env.OPENROUTER_API_KEY || '',
    openrouterModel: env.OPENROUTER_MODEL || 'openrouter/free',
    aiDailyTokenCap: Number(env.AI_DAILY_TOKEN_CAP || 2500000),
    aiMonthlyBudgetUsd: Number(env.AI_MONTHLY_BUDGET_USD || 10.0)
  };
}
