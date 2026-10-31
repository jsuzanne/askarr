import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { parsePlexServers, type AppConfig } from './config/env.js';
import { AskarrDatabase } from './db/database.js';
import { CloudflareAuthVerifier, AuthError, requireAdmin, type AuthenticatedPrincipal } from './auth/cloudflare-auth.js';
import { PlexMultiServerConnector } from './connectors/plex.connector.js';
import { OverseerrConnector } from './connectors/overseerr.connector.js';
import { RadarrConnector } from './connectors/radarr.connector.js';
import { SonarrConnector } from './connectors/sonarr.connector.js';
import { ProwlarrConnector } from './connectors/prowlarr.connector.js';
import { CloudflareAccessConnector } from './connectors/cloudflare-access.connector.js';
import { TracearrConnector } from './connectors/tracearr.js';
import { SmtpInviteService } from './connectors/smtp-invite.service.js';
import { MediaAggregatorService } from './aggregator/media-aggregator.service.js';
import { DeepSeekOrchestratorService } from './orchestrator/deepseek-orchestrator.service.js';
import { ApiTracer } from './utils/api-tracer.js';
import type { UserSessionInfo, AdminSettingsDTO, PlexSharedUserDTO } from '../shared/types.js';
import type { JWTVerifyGetKey } from 'jose';

export interface AppDependencies {
  config: AppConfig;
  db?: AskarrDatabase;
  customJwks?: JWTVerifyGetKey;
  fetchImpl?: typeof fetch;
}

export async function createApp(deps: AppDependencies): Promise<{
  app: FastifyInstance;
  db: AskarrDatabase;
  aggregator: MediaAggregatorService;
  cfAccess: CloudflareAccessConnector;
}> {
  const { config } = deps;
  const apiTracer = new ApiTracer(250);
  const fetchImpl = apiTracer.wrapFetch(deps.fetchImpl || fetch);
  const db = deps.db || new AskarrDatabase(config.sqliteDbPath);
  const authVerifier = new CloudflareAuthVerifier(config, deps.customJwks);

  const plex = new PlexMultiServerConnector(config.plexServers, config.plexToken, fetchImpl);
  const overseerr = new OverseerrConnector(config.overseerrBaseUrl, config.overseerrApiKey, fetchImpl);
  const radarr = new RadarrConnector(config.radarrBaseUrl, config.radarrApiKey, fetchImpl);
  const sonarr = new SonarrConnector(config.sonarrBaseUrl, config.sonarrApiKey, fetchImpl);
  const prowlarr = new ProwlarrConnector(config.prowlarrBaseUrl, config.prowlarrApiKey, fetchImpl);
  const tracearr = new TracearrConnector(config.tracearrBaseUrl, config.tracearrApiKey, fetchImpl);
  const cfAccess = new CloudflareAccessConnector(
    config.cloudflareAccountId,
    config.cloudflareApiToken,
    config.cfAccessTargetMode,
    config.cfAccessTargetId,
    db,
    fetchImpl
  );

  const aggregator = new MediaAggregatorService(overseerr, plex, radarr, sonarr, prowlarr);
  const orchestrator = new DeepSeekOrchestratorService(config, db, aggregator, overseerr, fetchImpl, tracearr);
  const smtpInvite = new SmtpInviteService(db, config.adminEmails[0] || '', apiTracer);

  function maskSecret(val: string): string {
    if (!val) return '';
    if (val.length <= 6) return '••••••';
    return `••••••••${val.slice(-4)}`;
  }

  function applySavedSettingsToRuntime(): void {
    const saved = db.getAllAppSettings();

    if (saved.cfg_plex_servers) {
      config.plexServers = parsePlexServers(saved.cfg_plex_servers);
    }
    if (saved.cfg_plex_token) {
      config.plexToken = saved.cfg_plex_token;
    }
    plex.updateConfig(config.plexServers, config.plexToken);

    if (saved.cfg_overseerr_url) {
      config.overseerrBaseUrl = saved.cfg_overseerr_url.replace(/\/+$/, '');
    }
    if (saved.cfg_overseerr_key) {
      config.overseerrApiKey = saved.cfg_overseerr_key;
    }
    overseerr.updateConfig(config.overseerrBaseUrl, config.overseerrApiKey);

    if (saved.cfg_radarr_url) {
      config.radarrBaseUrl = saved.cfg_radarr_url.replace(/\/+$/, '');
    }
    if (saved.cfg_radarr_key) {
      config.radarrApiKey = saved.cfg_radarr_key;
    }
    radarr.updateConfig(config.radarrBaseUrl, config.radarrApiKey);

    if (saved.cfg_sonarr_url) {
      config.sonarrBaseUrl = saved.cfg_sonarr_url.replace(/\/+$/, '');
    }
    if (saved.cfg_sonarr_key) {
      config.sonarrApiKey = saved.cfg_sonarr_key;
    }
    sonarr.updateConfig(config.sonarrBaseUrl, config.sonarrApiKey);

    if (saved.cfg_prowlarr_url) {
      config.prowlarrBaseUrl = saved.cfg_prowlarr_url.replace(/\/+$/, '');
    }
    if (saved.cfg_prowlarr_key) {
      config.prowlarrApiKey = saved.cfg_prowlarr_key;
    }
    prowlarr.updateConfig(config.prowlarrBaseUrl, config.prowlarrApiKey);

    if (saved.cfg_tracearr_url) {
      config.tracearrBaseUrl = saved.cfg_tracearr_url.replace(/\/+$/, '');
    }
    if (saved.cfg_tracearr_key) {
      config.tracearrApiKey = saved.cfg_tracearr_key;
    }
    tracearr.updateConfig(config.tracearrBaseUrl, config.tracearrApiKey);

    if (saved.cfg_cf_account_id !== undefined) {
      config.cloudflareAccountId = saved.cfg_cf_account_id;
    }
    if (saved.cfg_cf_api_token) {
      config.cloudflareApiToken = saved.cfg_cf_api_token;
    }
    if (saved.cfg_cf_target_mode === 'policy' || saved.cfg_cf_target_mode === 'group') {
      config.cfAccessTargetMode = saved.cfg_cf_target_mode;
    }
    if (saved.cfg_cf_target_id !== undefined) {
      config.cfAccessTargetId = saved.cfg_cf_target_id;
    }
    cfAccess.updateConfig({
      accountId: config.cloudflareAccountId,
      apiToken: config.cloudflareApiToken,
      targetMode: config.cfAccessTargetMode,
      targetId: config.cfAccessTargetId
    });

    if (saved.cfg_cf_team_domain !== undefined) {
      config.cfAccessTeamDomain = saved.cfg_cf_team_domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    }
    if (saved.cfg_cf_aud !== undefined) {
      config.cfAccessAud = saved.cfg_cf_aud;
    }
    if (saved.cfg_admin_emails) {
      const parsedAdmins = saved.cfg_admin_emails
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (parsedAdmins.length > 0) {
        config.adminEmails = parsedAdmins;
      }
    }

    if (saved.cfg_deepseek_url) {
      config.deepseekBaseUrl = saved.cfg_deepseek_url.replace(/\/+$/, '');
    }
    if (saved.cfg_deepseek_model) {
      config.deepseekModel = saved.cfg_deepseek_model;
    }
    if (saved.cfg_deepseek_key) {
      config.deepseekApiKey = saved.cfg_deepseek_key;
    }
    if (saved.cfg_ai_daily_token_cap && Number(saved.cfg_ai_daily_token_cap) > 0) {
      config.aiDailyTokenCap = Number(saved.cfg_ai_daily_token_cap);
    }
    if (saved.cfg_ai_monthly_budget_usd && Number(saved.cfg_ai_monthly_budget_usd) > 0) {
      config.aiMonthlyBudgetUsd = Number(saved.cfg_ai_monthly_budget_usd);
    }
  }

  // Appliquer immédiatement les éventuelles surcharges SQLite au démarrage
  applySavedSettingsToRuntime();

  const app = Fastify({
    logger: false
  });

  await app.register(cors, {
    origin: true
  });

  // Liveness probe (seul endpoint API non authentifié pour Docker HEALTHCHECK)
  app.get('/api/health/live', async () => ({
    status: 'ok',
    service: 'askarr',
    phase: 'G4_FULL_WRITE_AND_CF_SYNC',
    timestamp: new Date().toISOString()
  }));

  async function resolveUserSession(req: FastifyRequest): Promise<{
    principal: AuthenticatedPrincipal;
    session: UserSessionInfo;
  }> {
    const principal = await authVerifier.verifyRequest(req);
    const alias = db.getIdentityAlias(principal.email);
    let overseerrUser = null;
    try {
      overseerrUser = await overseerr.resolvePlexUser(principal.email, alias?.overseerrEmail);
    } catch {
      overseerrUser = null;
    }

    const budget = db.getLlmBudgetStats(config.aiDailyTokenCap, config.aiMonthlyBudgetUsd);
    const aiMode: UserSessionInfo['aiMode'] =
      config.deepseekApiKey && !budget.isOverQuota ? 'active' : 'direct_search_fallback';

    let plexAccess: UserSessionInfo['plexAccess'];
    try {
      const resolvedAccess = await plex.resolveUserPlexServerAccess({
        email: principal.email,
        isAdmin: principal.role === 'admin',
        overseerrPlexUsername: overseerrUser?.plexUsername ?? alias?.plexUsername,
        aliasPlexEmail: alias?.overseerrEmail
      });
      if (resolvedAccess) {
        plexAccess = {
          plexUserId: resolvedAccess.plexUserId,
          plexUsername: resolvedAccess.plexUsername,
          askarrServerNames: resolvedAccess.askarrServerNames,
          allServerNames: resolvedAccess.allServerNames,
          configuredServerNames: config.plexServers.map((s) => s.name)
        };
      }
    } catch {
      plexAccess = undefined;
    }

    return {
      principal,
      session: {
        email: principal.email,
        role: principal.role,
        authSource: principal.authSource,
        overseerr: {
          linked: Boolean(overseerrUser || alias || plexAccess),
          overseerrUserId: overseerrUser?.id ?? alias?.overseerrUserId ?? null,
          plexUsername: overseerrUser?.plexUsername ?? alias?.plexUsername ?? plexAccess?.plexUsername ?? null,
          userType: overseerrUser?.userType ?? (alias || plexAccess ? 1 : null)
        },
        plexAccess,
        aiMode
      }
    };
  }

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AuthError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message
      });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Paramètres de requête invalides.',
        details: error.errors
      });
    }
    return reply.code(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Erreur interne du serveur.'
    });
  });

  // 1. Session & Identité
  app.get('/api/me', async (req) => {
    const { session } = await resolveUserSession(req);
    return session;
  });

  // 2. Chat Conversationnel IA (DeepSeek + Fallback Recherche Directe)
  const chatBodySchema = z.object({
    conversationId: z.string().optional(),
    message: z.string().min(1).max(600)
  });

  app.post('/api/chat/messages', async (req) => {
    const { session } = await resolveUserSession(req);
    const body = chatBodySchema.parse(req.body);
    const traceMarker = apiTracer.markPosition();
    const result = await orchestrator.handleUserMessage({
      userEmail: session.email,
      overseerrUserId: session.overseerr.overseerrUserId,
      plexAccess: session.plexAccess,
      conversationId: body.conversationId,
      message: body.message
    });
    const apiTraces = session.role === 'admin' ? apiTracer.getEntriesSince(traceMarker) : undefined;
    return {
      ...result,
      apiTraces
    };
  });

  // 3. Recherche Directe & Désambiguïsation (0 token IA)
  const searchQuerySchema = z.object({
    q: z.string().min(1).max(120),
    type: z.enum(['movie', 'tv', 'auto']).default('auto'),
    year: z.coerce.number().int().optional()
  });

  app.get('/api/media/search', async (req) => {
    const { session } = await resolveUserSession(req);
    const query = searchQuerySchema.parse(req.query);
    return aggregator.searchAndCheckMedia({
      query: query.q,
      mediaType: query.type,
      year: query.year,
      currentUserEmail: session.email,
      currentUserOverseerrId: session.overseerr.overseerrUserId
    });
  });

  // 4. Détail d'un film ou d'une série (0 token IA)
  const detailParamsSchema = z.object({
    mediaType: z.enum(['movie', 'tv']),
    tmdbId: z.coerce.number().int().positive()
  });

  app.get('/api/media/:mediaType/:tmdbId', async (req) => {
    const { session } = await resolveUserSession(req);
    const params = detailParamsSchema.parse(req.params);
    return aggregator.buildMediaEvidence({
      tmdbId: params.tmdbId,
      mediaType: params.mediaType,
      currentUserEmail: session.email,
      currentUserOverseerrId: session.overseerr.overseerrUserId,
      includeSeasons: params.mediaType === 'tv',
      checkIndexers: false
    });
  });

  // 5. Découverte & Conseils (0 token IA quand appelé depuis les filtres UI)
  const discoverQuerySchema = z.object({
    scope: z.enum(['on_plex_now', 'similar_to_title', 'discover_by_genre_or_trending']).default('on_plex_now'),
    mediaType: z.enum(['movie', 'tv', 'auto']).default('auto'),
    genre: z.string().optional(),
    similarToTmdbId: z.coerce.number().int().optional(),
    minRating: z.coerce.number().default(7.0),
    plexLibraryFilter: z.string().optional()
  });

  app.get('/api/media/discover', async (req) => {
    const { session } = await resolveUserSession(req);
    const query = discoverQuerySchema.parse(req.query);
    const cards = await aggregator.discoverAndRecommend({
      ...query,
      currentUserEmail: session.email,
      currentUserOverseerrId: session.overseerr.overseerrUserId
    });
    return { items: cards };
  });

  // 6. Mes demandes en direct (0 token IA)
  app.get('/api/requests/mine', async (req) => {
    const { session } = await resolveUserSession(req);
    const filterUserId = session.role === 'admin' ? undefined : session.overseerr.overseerrUserId;
    const rawRequests = await overseerr.getRequests(filterUserId, 12);
    const enriched = await Promise.all(
      rawRequests.slice(0, 8).map(async (r) => {
        try {
          const evidence = await aggregator.buildMediaEvidence({
            tmdbId: r.tmdbId,
            mediaType: r.mediaType,
            currentUserEmail: session.email,
            currentUserOverseerrId: session.overseerr.overseerrUserId,
            includeSeasons: r.mediaType === 'tv',
            checkIndexers: false
          });
          return {
            requestId: r.requestId,
            createdAt: r.createdAt,
            requestedByDisplayName: r.requestedByDisplayName,
            requestedSeasons: r.seasons,
            evidence
          };
        } catch {
          return null;
        }
      })
    );
    return {
      items: enriched.filter((x) => x !== null)
    };
  });

  // 7. Préparation et Confirmation en 2 étapes d'une demande Overseerr (ADR-005 / G4)
  const prepareRequestBodySchema = z.object({
    tmdbId: z.number().int().positive(),
    mediaType: z.enum(['movie', 'tv']),
    seasons: z.array(z.number().int().positive()).optional()
  });

  app.post('/api/requests/prepare', async (req, reply: FastifyReply) => {
    const { session } = await resolveUserSession(req);
    const body = prepareRequestBodySchema.parse(req.body);

    if (!session.overseerr.linked && session.role !== 'admin') {
      return reply.code(403).send({
        error: 'UNLINKED_PLEX_USER',
        message: "Ton adresse email n'est pas encore rattachée à un compte ami Plex dans Overseerr."
      });
    }

    try {
      const { evidence, preparedAction } = await orchestrator.prepareMediaRequestAction({
        userEmail: session.email,
        overseerrUserId: session.overseerr.overseerrUserId,
        tmdbId: body.tmdbId,
        mediaType: body.mediaType,
        seasons: body.seasons
      });
      return {
        preparedAction,
        evidence
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la préparation de la demande.';
      return reply.code(409).send({
        error: 'REQUEST_NOT_ELIGIBLE',
        message: msg.replace(/^REQUEST_NOT_ELIGIBLE:[^:]+:/, '')
      });
    }
  });

  const confirmRequestBodySchema = z.object({
    actionId: z.string().min(5).max(80)
  });

  app.post('/api/requests/confirm', async (req, reply: FastifyReply) => {
    const { session } = await resolveUserSession(req);
    const body = confirmRequestBodySchema.parse(req.body);

    const record = db.getPreparedActionByToken(body.actionId);
    if (!record) {
      return reply.code(404).send({
        error: 'ACTION_TOKEN_NOT_FOUND',
        message: 'Ce jeton de confirmation est introuvable.'
      });
    }

    if (record.userEmail.toLowerCase() !== session.email.toLowerCase()) {
      return reply.code(403).send({
        error: 'ACTION_TOKEN_FORBIDDEN',
        message: 'Ce jeton de confirmation appartient à un autre utilisateur.'
      });
    }

    if (record.status === 'EXECUTED' || record.status === 'SUPERSEDED') {
      return reply.code(409).send({
        error: 'ACTION_ALREADY_CONSUMED',
        message: 'Cette demande a déjà été confirmée.',
        status: record.status,
        externalResult: record.externalResult
      });
    }

    if (record.status !== 'PENDING' || new Date(record.expiresAt).getTime() < Date.now()) {
      db.completePreparedAction({ token: record.token, status: 'EXPIRED' });
      return reply.code(410).send({
        error: 'ACTION_TOKEN_EXPIRED',
        message: 'Le délai de confirmation (10 minutes) a expiré. Relance la demande pour générer un nouveau bouton.'
      });
    }

    // Re-vérification en direct avant exécution (Anti-doublon / Idempotence)
    const freshEvidence = await aggregator.buildMediaEvidence({
      tmdbId: record.payload.tmdbId,
      mediaType: record.payload.mediaType,
      currentUserEmail: session.email,
      currentUserOverseerrId: session.overseerr.overseerrUserId,
      includeSeasons: record.payload.mediaType === 'tv',
      checkIndexers: false
    });

    if (!freshEvidence.actionability.canRequestNow) {
      db.completePreparedAction({
        token: record.token,
        status: 'SUPERSEDED',
        externalResult: {
          reason: freshEvidence.actionability.blockReason,
          explanationFr: freshEvidence.actionability.userFriendlyExplanationFr
        }
      });

      db.recordAuditLog({
        actorEmail: session.email,
        actorRole: session.role,
        actionType: record.actionType,
        targetService: 'overseerr',
        actionToken: record.token,
        summaryFr: `Demande ignorée (déjà pris en charge) : ${record.payload.summaryFr}`,
        status: 'SUPERSEDED'
      });

      return {
        status: 'SUPERSEDED',
        messageFr: freshEvidence.actionability.userFriendlyExplanationFr,
        evidence: freshEvidence
      };
    }

    let seasonsToRequest = record.payload.seasons;
    if (record.payload.mediaType === 'tv') {
      seasonsToRequest = (record.payload.seasons || []).filter((s) =>
        freshEvidence.actionability.requestableSeasons.includes(s)
      );
      if (seasonsToRequest.length === 0) {
        db.completePreparedAction({
          token: record.token,
          status: 'SUPERSEDED',
          externalResult: { reason: 'SEASONS_ALREADY_REQUESTED' }
        });
        return {
          status: 'SUPERSEDED',
          messageFr: "Ces saisons figurent déjà sur Plex ou dans la liste d'attente.",
          evidence: freshEvidence
        };
      }
    }

    try {
      const createdReq = await overseerr.createMediaRequest({
        mediaType: record.payload.mediaType,
        tmdbId: record.payload.tmdbId,
        seasons: seasonsToRequest,
        overseerrUserId: record.overseerrUserId ?? session.overseerr.overseerrUserId
      });

      // Si l'œuvre était déjà présente dans Radarr/Sonarr mais en 'monitored=false' (ex: ancienne demande #113 dans Overseerr),
      // on réactive explicitement la surveillance (monitored=true) dans Radarr/Sonarr !
      let reactivatedInArr = false;
      const extId = freshEvidence.acquisitionPipeline.externalServiceId;
      if (extId && freshEvidence.acquisitionPipeline.state === 'unmonitored_no_file') {
        if (record.payload.mediaType === 'movie') {
          reactivatedInArr = await radarr.setMovieMonitored(extId, true);
        } else {
          reactivatedInArr = await sonarr.setSeriesMonitored(extId, true);
        }
      }

      db.completePreparedAction({
        token: record.token,
        status: 'EXECUTED',
        externalResult: { ...createdReq, reactivatedInArr }
      });

      db.recordAuditLog({
        actorEmail: session.email,
        actorRole: session.role,
        actionType: record.actionType,
        targetService: 'overseerr',
        actionToken: record.token,
        summaryFr: `Demande confirmée (#${createdReq.requestId}${reactivatedInArr ? ' + surveillance Radarr/Sonarr réactivée' : ''}) : ${record.payload.summaryFr}`,
        diffRedacted: {
          tmdbId: record.payload.tmdbId,
          mediaType: record.payload.mediaType,
          seasons: seasonsToRequest,
          overseerrRequestId: createdReq.requestId,
          reactivatedInArr
        },
        status: 'SUCCESS'
      });

      const updatedEvidence = await aggregator.buildMediaEvidence({
        tmdbId: record.payload.tmdbId,
        mediaType: record.payload.mediaType,
        currentUserEmail: session.email,
        currentUserOverseerrId: session.overseerr.overseerrUserId,
        includeSeasons: record.payload.mediaType === 'tv',
        checkIndexers: false
      });

      return {
        status: 'EXECUTED',
        overseerrRequestId: createdReq.requestId,
        messageFr: reactivatedInArr
          ? `La surveillance automatique de "${record.payload.title}" a été réactivée dans la liste d'attente (Radarr/Sonarr) !`
          : `Ta demande pour "${record.payload.title}" a bien été envoyée ! Elle est maintenant dans la liste d'attente automatique.`,
        evidence: updatedEvidence
      };
    } catch (err) {
      db.completePreparedAction({
        token: record.token,
        status: 'FAILED',
        externalResult: { error: err instanceof Error ? err.message : 'UNKNOWN' }
      });

      db.recordAuditLog({
        actorEmail: session.email,
        actorRole: session.role,
        actionType: record.actionType,
        targetService: 'overseerr',
        actionToken: record.token,
        summaryFr: `Échec de la demande : ${record.payload.summaryFr}`,
        status: 'FAILED'
      });

      return reply.code(502).send({
        error: 'OVERSEERR_WRITE_FAILED',
        message: err instanceof Error ? err.message : "Erreur lors de l'envoi de la demande à Overseerr."
      });
    }
  });

  // 8. Routes d'Administration (strictement réservées 'admin')
  app.get('/api/admin/health', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;

    const [plexHealth, osHealth, radarrHealth, sonarrHealth, prowlarrHealth, tracearrHealth, cfHealth] = await Promise.all([
      plex.checkHealth(),
      overseerr.checkHealth(),
      radarr.checkHealth(),
      sonarr.checkHealth(),
      prowlarr.checkHealth(),
      tracearr.checkHealth(),
      cfAccess.checkHealth()
    ]);

    return {
      plexServers: plexHealth,
      overseerr: osHealth,
      radarr: radarrHealth,
      sonarr: sonarrHealth,
      prowlarr: prowlarrHealth,
      tracearr: tracearrHealth,
      cloudflareAccess: cfHealth,
      deepseekConfigured: Boolean(config.deepseekApiKey)
    };
  });

  app.get('/api/admin/ai-usage', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const [stats, accountBalance] = await Promise.all([
      Promise.resolve(db.getLlmBudgetStats(config.aiDailyTokenCap, config.aiMonthlyBudgetUsd)),
      orchestrator.getAccountBalance()
    ]);
    return {
      ...stats,
      accountBalance
    };
  });

  app.post('/api/admin/ai-usage/reset-daily', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const cleared = db.resetDailyLlmUsage();
    return {
      ok: true,
      clearedEntries: cleared,
      stats: db.getLlmBudgetStats(config.aiDailyTokenCap, config.aiMonthlyBudgetUsd)
    };
  });

  app.get('/api/admin/audit-logs', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    return { items: db.getRecentAuditLogs(50) };
  });

  app.get('/api/admin/users', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const users = await overseerr.getUsers();
    return {
      plexUsers: users.filter((u) => u.userType === 1),
      localUsers: users.filter((u) => u.userType !== 1),
      identityAliases: db.listIdentityAliases()
    };
  });

  const linkUserBodySchema = z.object({
    cfEmail: z.string().email(),
    overseerrUserId: z.number().int().positive()
  });

  app.post('/api/admin/users/link', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = linkUserBodySchema.parse(req.body);

    const users = await overseerr.getUsers(true);
    const targetPlexUser = users.find((u) => u.id === body.overseerrUserId);
    if (!targetPlexUser || targetPlexUser.userType !== 1) {
      return reply.code(400).send({
        error: 'PLEX_USER_REQUIRED',
        message: 'Seuls les utilisateurs Plex (userType = 1) dans Overseerr peuvent être liés.'
      });
    }

    db.upsertIdentityAlias({
      cfEmail: body.cfEmail,
      overseerrUserId: targetPlexUser.id,
      overseerrEmail: targetPlexUser.email,
      plexUsername: targetPlexUser.plexUsername,
      linkedBy: principal.email
    });

    db.recordAuditLog({
      actorEmail: principal.email,
      actorRole: 'admin',
      actionType: 'IDENTITY_ALIAS_UPSERT',
      targetService: 'sqlite',
      summaryFr: `Liaison email Cloudflare (${body.cfEmail}) -> Ami Plex Overseerr #${targetPlexUser.id} (${targetPlexUser.displayName})`,
      status: 'SUCCESS'
    });

    return {
      ok: true,
      identityAliases: db.listIdentityAliases()
    };
  });

  // 9. Administration Cloudflare Access, Annuaire Plex.tv & Invitations VIP par Email (ADR-006 / G4)
  async function buildPlexDirectory(
    forceRefresh = false,
    cfEmails: string[] = []
  ): Promise<{
    plexUsers: Awaited<ReturnType<typeof overseerr.getUsers>>;
    plexDirectory: PlexSharedUserDTO[];
  }> {
    const [overseerrUsers, cloudUsers, tracearrActivityMap] = await Promise.all([
      overseerr.getUsers(forceRefresh).catch((): Awaited<ReturnType<typeof overseerr.getUsers>> => []),
      plex.getSharedUsersDirectory(forceRefresh).catch((): Awaited<ReturnType<typeof plex.getSharedUsersDirectory>> => []),
      tracearr.isConfigured()
        ? tracearr.getUserActivitySummaryMap().catch(() => new Map())
        : Promise.resolve(new Map())
    ]);

    const plexUsers = overseerrUsers.filter((u) => u.userType === 1);
    const aliases = db.listIdentityAliases();
    const cfSet = new Set(cfEmails.map((e) => e.toLowerCase()));

    const byKey = new Map<string, PlexSharedUserDTO>();

    for (const cu of cloudUsers) {
      const emailLower = cu.email.trim().toLowerCase();
      const matchedOs = plexUsers.find(
        (ou) =>
          (emailLower && ou.email.toLowerCase() === emailLower) ||
          (cu.username && ou.plexUsername?.toLowerCase() === cu.username.toLowerCase())
      );
      const matchedAlias = aliases.find(
        (al) =>
          (emailLower && al.overseerrEmail.toLowerCase() === emailLower) ||
          (matchedOs && al.overseerrUserId === matchedOs.id)
      );
      const effectiveEmail = emailLower || matchedOs?.email?.toLowerCase() || '';
      const inCf = Boolean(
        (effectiveEmail && cfSet.has(effectiveEmail)) ||
          (matchedAlias && cfSet.has(matchedAlias.cfEmail.toLowerCase()))
      );

      const resolvedUsername = cu.username || matchedOs?.plexUsername || cu.title;
      const activity =
        (resolvedUsername && tracearrActivityMap.get(resolvedUsername.toLowerCase())) ||
        (cu.title && tracearrActivityMap.get(cu.title.toLowerCase())) ||
        undefined;

      const key = effectiveEmail || `plex:${cu.plexUserId}`;
      byKey.set(key, {
        plexUserId: cu.plexUserId,
        username: resolvedUsername,
        title: cu.title || matchedOs?.displayName || cu.username,
        email: effectiveEmail,
        thumb: cu.thumb || null,
        askarrServerNames: cu.askarrServerNames,
        allServerNames: cu.allServerNames,
        overseerrUserId: matchedOs?.id ?? null,
        inCloudflareAccess: inCf,
        tracearrActivity: activity
      });
    }

    // Ajouter les éventuels comptes Overseerr (ex: propriétaire ou compte non listé dans /api/users)
    for (const ou of plexUsers) {
      const emailLower = ou.email.trim().toLowerCase();
      if (!emailLower || byKey.has(emailLower)) continue;
      const matchedAlias = aliases.find((al) => al.overseerrUserId === ou.id);
      const inCf =
        cfSet.has(emailLower) || Boolean(matchedAlias && cfSet.has(matchedAlias.cfEmail.toLowerCase()));
      const isOwner = config.adminEmails.includes(emailLower);
      const resolvedUsername = ou.plexUsername || ou.displayName;
      const activity =
        (resolvedUsername && tracearrActivityMap.get(resolvedUsername.toLowerCase())) ||
        (ou.displayName && tracearrActivityMap.get(ou.displayName.toLowerCase())) ||
        undefined;

      byKey.set(emailLower, {
        plexUserId: ou.id,
        username: resolvedUsername,
        title: ou.displayName || ou.plexUsername || emailLower,
        email: emailLower,
        thumb: null,
        askarrServerNames: isOwner ? config.plexServers.map((s) => s.name) : [],
        allServerNames: isOwner ? config.plexServers.map((s) => s.name) : [],
        overseerrUserId: ou.id,
        inCloudflareAccess: inCf,
        tracearrActivity: activity
      });
    }

    const plexDirectory = Array.from(byKey.values()).sort((a, b) => {
      if (a.inCloudflareAccess !== b.inCloudflareAccess) {
        return a.inCloudflareAccess ? -1 : 1;
      }
      return (a.title || a.username || a.email).localeCompare(b.title || b.username || b.email, 'fr');
    });

    return { plexUsers, plexDirectory };
  }

  app.get('/api/admin/cloudflare/status', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;

    const cfState = await cfAccess.getStatusSummary();
    const { plexUsers, plexDirectory } = await buildPlexDirectory(false, cfState.emails);
    const aliases = db.listIdentityAliases();
    const revisions = db.getRecentCfPolicyRevisions(15);

    return {
      ...cfState,
      plexUsers,
      plexDirectory,
      identityAliases: aliases,
      revisions,
      smtp: smtpInvite.getPublicSummary()
    };
  });

  app.post('/api/admin/plex-users/sync', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;

    const cfState = await cfAccess.getStatusSummary();
    const { plexUsers, plexDirectory } = await buildPlexDirectory(true, cfState.emails);

    return {
      ok: true,
      count: plexDirectory.length,
      plexUsers,
      plexDirectory
    };
  });

  const bootstrapPolicySchema = z.object({
    policyName: z.string().min(3).max(60).default('askarr-allow-users'),
    includeAllPlexFriends: z.boolean().default(true)
  });

  app.post('/api/admin/cloudflare/bootstrap-policy', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = bootstrapPolicySchema.parse(req.body || {});

    const { plexUsers, plexDirectory } = await buildPlexDirectory(false, []);
    const plexEmails = body.includeAllPlexFriends
      ? [
          ...plexUsers.filter((u) => u.userType === 1 && u.email).map((u) => u.email),
          ...plexDirectory.filter((u) => u.email).map((u) => u.email)
        ]
      : [];

    const initialEmails = Array.from(new Set([...config.adminEmails, principal.email, ...plexEmails]));
    const policy = await cfAccess.ensureAskarrReusablePolicy({
      policyName: body.policyName,
      initialEmails,
      actorEmail: principal.email
    });

    db.recordAuditLog({
      actorEmail: principal.email,
      actorRole: 'admin',
      actionType: 'CF_POLICY_BOOTSTRAP',
      targetService: 'cloudflare_access',
      summaryFr: `Création / sélection de la policy réutilisable "${policy.name}" (${initialEmails.length} emails autorisés)`,
      status: 'SUCCESS'
    });

    return cfAccess.getStatusSummary();
  });

  const switchTargetSchema = z.object({
    mode: z.enum(['policy', 'group']),
    id: z.string().min(4)
  });

  app.post('/api/admin/cloudflare/target', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = switchTargetSchema.parse(req.body);
    cfAccess.setTarget(body.mode, body.id);
    return cfAccess.getStatusSummary();
  });

  const addCfEmailSchema = z.object({
    email: z.string().email(),
    overseerrUserId: z.number().int().positive().optional(),
    plexUserId: z.number().int().positive().optional(),
    sendInviteEmail: z.boolean().optional(),
    customMessage: z.string().max(500).optional()
  });

  app.post('/api/admin/cloudflare/emails/add', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = addCfEmailSchema.parse(req.body);
    const normalizedEmail = body.email.trim().toLowerCase();

    const { plexUsers, plexDirectory } = await buildPlexDirectory(true, []);
    let matchedPlexUser = plexUsers.find((u) => u.userType === 1 && u.email.toLowerCase() === normalizedEmail);
    const matchedCloudUser = plexDirectory.find(
      (u) =>
        (u.email && u.email.toLowerCase() === normalizedEmail) ||
        (body.plexUserId && u.plexUserId === body.plexUserId)
    );

    if (!matchedPlexUser && body.overseerrUserId) {
      const byId = plexUsers.find((u) => u.id === body.overseerrUserId);
      if (!byId || byId.userType !== 1) {
        return reply.code(400).send({
          error: 'PLEX_USER_REQUIRED',
          message: "Le compte sélectionné dans Overseerr n'est pas un compte Plex (userType = 1)."
        });
      }
      matchedPlexUser = byId;
      db.upsertIdentityAlias({
        cfEmail: normalizedEmail,
        overseerrUserId: byId.id,
        overseerrEmail: byId.email,
        plexUsername: byId.plexUsername,
        linkedBy: principal.email
      });
    } else if (!matchedPlexUser && matchedCloudUser && matchedCloudUser.email && matchedCloudUser.email !== normalizedEmail) {
      // L'utilisateur a un email Google/Cloudflare différent de son email Plex.tv
      if (matchedCloudUser.overseerrUserId) {
        db.upsertIdentityAlias({
          cfEmail: normalizedEmail,
          overseerrUserId: matchedCloudUser.overseerrUserId,
          overseerrEmail: matchedCloudUser.email,
          plexUsername: matchedCloudUser.username,
          linkedBy: principal.email
        });
      }
    }

    const existingAlias = db.getIdentityAlias(normalizedEmail);
    const isAdminEmail = config.adminEmails.includes(normalizedEmail);

    if (!matchedPlexUser && !matchedCloudUser && !existingAlias && !isAdminEmail) {
      return reply.code(400).send({
        error: 'NOT_A_PLEX_FRIEND',
        message:
          "Cet email ne correspond à aucun ami Plex (ni dans Plex.tv ni dans Overseerr). Sélectionne le compte ami Plex correspondant pour créer l'alias."
      });
    }

    const res = await cfAccess.addEmailToTarget({
      emailToAdd: normalizedEmail,
      actorEmail: principal.email
    });

    let inviteSent = false;
    let inviteError: string | undefined;
    if (body.sendInviteEmail) {
      try {
        const origin =
          typeof req.headers.origin === 'string'
            ? req.headers.origin
            : `${req.protocol}://${req.hostname}`;
        await smtpInvite.sendInvitationEmail({
          recipientEmail: normalizedEmail,
          recipientName:
            matchedCloudUser?.title ||
            matchedPlexUser?.displayName ||
            matchedCloudUser?.username ||
            null,
          plexServers: matchedCloudUser?.askarrServerNames,
          fallbackOrigin: origin,
          customMessage: body.customMessage
        });
        inviteSent = true;
      } catch (err) {
        inviteError = err instanceof Error ? err.message : "Erreur lors de l'envoi de l'email VIP.";
      }
    }

    db.recordAuditLog({
      actorEmail: principal.email,
      actorRole: 'admin',
      actionType: 'CF_ACCESS_ADD_EMAIL',
      targetService: 'cloudflare_access',
      summaryFr: `Ajout de ${normalizedEmail} dans Cloudflare Access (${res.targetName})${inviteSent ? ' + Billet VIP envoyé par email' : ''}`,
      diffRedacted: {
        targetId: res.targetId,
        targetName: res.targetName,
        revisionId: res.revisionId,
        alreadyPresent: res.alreadyPresent,
        inviteSent
      },
      status: 'SUCCESS'
    });

    const newState = await cfAccess.getStatusSummary();
    const updatedDir = await buildPlexDirectory(false, newState.emails);

    return {
      ...res,
      inviteSent,
      inviteError,
      state: newState,
      plexDirectory: updatedDir.plexDirectory,
      revisions: db.getRecentCfPolicyRevisions(15)
    };
  });

  const bulkImportCfEmailsSchema = z.object({
    emails: z.array(z.string().email()).min(1).max(100),
    sendInviteEmails: z.boolean().default(false),
    customMessage: z.string().max(500).optional()
  });

  app.post('/api/admin/cloudflare/emails/bulk-import', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = bulkImportCfEmailsSchema.parse(req.body);

    const res = await cfAccess.addMultipleEmailsToTarget({
      emailsToAdd: body.emails,
      actorEmail: principal.email
    });

    let invitesSentCount = 0;
    const inviteErrors: string[] = [];

    if (body.sendInviteEmails && res.addedEmails.length > 0) {
      const { plexDirectory } = await buildPlexDirectory(false, res.updatedEmails);
      const origin =
        typeof req.headers.origin === 'string'
          ? req.headers.origin
          : `${req.protocol}://${req.hostname}`;

      for (const email of res.addedEmails) {
        const friend = plexDirectory.find((u) => u.email.toLowerCase() === email.toLowerCase());
        try {
          await smtpInvite.sendInvitationEmail({
            recipientEmail: email,
            recipientName: friend?.title || friend?.username || null,
            plexServers: friend?.askarrServerNames,
            fallbackOrigin: origin,
            customMessage: body.customMessage
          });
          invitesSentCount++;
        } catch (err) {
          inviteErrors.push(`${email}: ${err instanceof Error ? err.message : 'Erreur SMTP'}`);
        }
      }
    }

    db.recordAuditLog({
      actorEmail: principal.email,
      actorRole: 'admin',
      actionType: 'CF_ACCESS_BULK_IMPORT',
      targetService: 'cloudflare_access',
      summaryFr: `Import groupé de ${res.addedCount} ami(s) Plex dans Cloudflare Access (${res.targetName})${invitesSentCount > 0 ? ` + ${invitesSentCount} invitation(s) VIP envoyée(s)` : ''}`,
      diffRedacted: {
        targetId: res.targetId,
        targetName: res.targetName,
        addedCount: res.addedCount,
        invitesSentCount,
        revisionId: res.revisionId
      },
      status: 'SUCCESS'
    });

    const newState = await cfAccess.getStatusSummary();
    const updatedDir = await buildPlexDirectory(false, newState.emails);

    return {
      ...res,
      invitesSentCount,
      inviteErrors,
      state: newState,
      plexDirectory: updatedDir.plexDirectory,
      revisions: db.getRecentCfPolicyRevisions(15)
    };
  });

  const sendInviteBodySchema = z.object({
    email: z.string().email(),
    recipientName: z.string().max(120).optional(),
    plexServers: z.array(z.string()).optional(),
    customMessage: z.string().max(500).optional()
  });

  app.post('/api/admin/cloudflare/send-invite', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = sendInviteBodySchema.parse(req.body);
    const normalizedEmail = body.email.trim().toLowerCase();

    const { plexDirectory } = await buildPlexDirectory(false, []);
    const matchedFriend = plexDirectory.find((u) => u.email.toLowerCase() === normalizedEmail);
    const origin =
      typeof req.headers.origin === 'string'
        ? req.headers.origin
        : `${req.protocol}://${req.hostname}`;

    try {
      const result = await smtpInvite.sendInvitationEmail({
        recipientEmail: normalizedEmail,
        recipientName: body.recipientName || matchedFriend?.title || matchedFriend?.username || null,
        plexServers: body.plexServers || matchedFriend?.askarrServerNames,
        fallbackOrigin: origin,
        customMessage: body.customMessage
      });

      db.recordAuditLog({
        actorEmail: principal.email,
        actorRole: 'admin',
        actionType: 'SMTP_VIP_INVITE',
        targetService: 'smtp',
        summaryFr: `Envoi du Billet d'Invitation VIP par email à ${normalizedEmail}`,
        status: 'SUCCESS'
      });

      return {
        ok: true,
        ...result
      };
    } catch (err) {
      return reply.code(400).send({
        error: 'SMTP_SEND_ERROR',
        message: err instanceof Error ? err.message : "Échec de l'envoi de l'email d'invitation."
      });
    }
  });

  const updateSmtpSchema = z.object({
    smtpHost: z.string().max(120).optional(),
    smtpPort: z.coerce.number().int().positive().optional(),
    smtpUser: z.string().max(160).optional(),
    smtpAppPassword: z.string().max(160).optional(),
    senderName: z.string().max(120).optional(),
    publicAppUrl: z.string().max(240).optional()
  });

  app.post('/api/admin/settings/smtp', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = updateSmtpSchema.parse(req.body);
    const updated = smtpInvite.updateSettings(body);

    db.recordAuditLog({
      actorEmail: principal.email,
      actorRole: 'admin',
      actionType: 'SMTP_SETTINGS_UPDATE',
      targetService: 'sqlite',
      summaryFr: `Mise à jour de la configuration Google SMTP (${updated.smtpUser || 'non renseigné'})`,
      status: 'SUCCESS'
    });

    return {
      ok: true,
      smtp: updated
    };
  });

  app.post('/api/admin/settings/smtp/test', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = z
      .object({
        testRecipientEmail: z.string().email().optional()
      })
      .parse(req.body || {});

    const targetEmail = (body.testRecipientEmail || principal.email).trim().toLowerCase();
    const origin =
      typeof req.headers.origin === 'string'
        ? req.headers.origin
        : `${req.protocol}://${req.hostname}`;

    try {
      const result = await smtpInvite.sendInvitationEmail({
        recipientEmail: targetEmail,
        recipientName: 'Administrateur Askarr (Test VIP)',
        plexServers: config.plexServers.map((s) => s.name),
        fallbackOrigin: origin,
        customMessage:
          'Ceci est un billet de test envoyé depuis Askarr pour vérifier ta configuration Google App Password (SMTPS port 465).'
      });
      return {
        ok: true,
        recipientEmail: targetEmail,
        ...result
      };
    } catch (err) {
      return reply.code(400).send({
        error: 'SMTP_TEST_FAILED',
        message: err instanceof Error ? err.message : 'Échec du test SMTP.'
      });
    }
  });

  const removeCfEmailSchema = z.object({
    email: z.string().email()
  });

  app.post('/api/admin/cloudflare/emails/remove', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = removeCfEmailSchema.parse(req.body);

    try {
      const res = await cfAccess.removeEmailFromTarget({
        emailToRemove: body.email,
        actorEmail: principal.email,
        protectedAdminEmails: [...config.adminEmails, principal.email]
      });

      db.recordAuditLog({
        actorEmail: principal.email,
        actorRole: 'admin',
        actionType: 'CF_ACCESS_REMOVE_EMAIL',
        targetService: 'cloudflare_access',
        summaryFr: `Retrait de ${body.email.toLowerCase()} de Cloudflare Access (${res.targetName})`,
        diffRedacted: {
          targetId: res.targetId,
          targetName: res.targetName,
          revisionId: res.revisionId
        },
        status: 'SUCCESS'
      });

      return {
        ...res,
        state: await cfAccess.getStatusSummary(),
        revisions: db.getRecentCfPolicyRevisions(15)
      };
    } catch (err) {
      return reply.code(400).send({
        error: 'CF_REMOVE_ERROR',
        message: err instanceof Error ? err.message : 'Impossible de retirer cet email.'
      });
    }
  });

  const rollbackParamsSchema = z.object({
    revisionId: z.coerce.number().int().positive()
  });

  app.post('/api/admin/cloudflare/rollback/:revisionId', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const params = rollbackParamsSchema.parse(req.params);

    const res = await cfAccess.rollbackToRevision({
      revisionId: params.revisionId,
      actorEmail: principal.email
    });

    db.recordAuditLog({
      actorEmail: principal.email,
      actorRole: 'admin',
      actionType: 'CF_ACCESS_ROLLBACK',
      targetService: 'cloudflare_access',
      summaryFr: `Restauration de la révision #${params.revisionId} sur Cloudflare Access (${res.restoredTargetName})`,
      status: 'SUCCESS'
    });

    return {
      ...res,
      state: await cfAccess.getStatusSummary(),
      revisions: db.getRecentCfPolicyRevisions(15)
    };
  });

  // 10. Traceur d'appels API en temps réel & Paramètres techniques (Admin Debug)
  const tracesQuerySchema = z.object({
    service: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(250).default(120)
  });

  app.get('/api/admin/traces', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const query = tracesQuerySchema.parse(req.query);
    const list = apiTracer.getEntries(query.limit, query.service);
    return {
      items: list,
      entries: list
    };
  });

  app.delete('/api/admin/traces', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    apiTracer.clear();
    return { ok: true };
  });

  app.get('/api/admin/settings', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;

    const [accountBalance, usageStats] = await Promise.all([
      orchestrator.getAccountBalance(),
      Promise.resolve(db.getLlmBudgetStats(config.aiDailyTokenCap, config.aiMonthlyBudgetUsd))
    ]);

    const settings: AdminSettingsDTO = {
      nodeEnv: config.nodeEnv,
      port: config.port,
      auth: {
        cfAccessTeamDomain: config.cfAccessTeamDomain || 'Non configuré',
        cfAccessAudConfigured: Boolean(config.cfAccessAud),
        cfAccessAudPreview: config.cfAccessAud
          ? `${config.cfAccessAud.slice(0, 12)}…${config.cfAccessAud.slice(-8)}`
          : 'Non configuré',
        allowDevAuthHeader: config.allowDevAuthHeader,
        adminEmailsCount: config.adminEmails.length
      },
      connectors: {
        plexServers: config.plexServers.map((s) => ({
          name: s.name,
          baseUrl: s.baseUrl,
          configured: Boolean(config.plexToken && s.baseUrl)
        })),
        overseerr: {
          baseUrl: config.overseerrBaseUrl,
          configured: Boolean(config.overseerrApiKey && config.overseerrBaseUrl)
        },
        radarr: {
          baseUrl: config.radarrBaseUrl,
          configured: Boolean(config.radarrApiKey && config.radarrBaseUrl)
        },
        sonarr: {
          baseUrl: config.sonarrBaseUrl,
          configured: Boolean(config.sonarrApiKey && config.sonarrBaseUrl)
        },
        prowlarr: {
          baseUrl: config.prowlarrBaseUrl,
          configured: Boolean(config.prowlarrApiKey && config.prowlarrBaseUrl)
        },
        tracearr: {
          baseUrl: config.tracearrBaseUrl,
          configured: Boolean(config.tracearrApiKey && config.tracearrBaseUrl)
        },
        cloudflareAccess: {
          accountIdConfigured: Boolean(config.cloudflareAccountId),
          apiTokenConfigured: Boolean(config.cloudflareApiToken),
          targetMode: config.cfAccessTargetMode,
          targetId: config.cfAccessTargetId || 'Auto-découverte'
        },
        deepseek: {
          baseUrl: config.deepseekBaseUrl,
          model: config.deepseekModel,
          configured: Boolean(config.deepseekApiKey),
          dailyTokenCap: config.aiDailyTokenCap,
          monthlyBudgetUsd: config.aiMonthlyBudgetUsd,
          pricing: {
            inputCacheMissPer1M: config.deepseekPriceInputCacheMissPer1M,
            inputCacheHitPer1M: config.deepseekPriceInputCacheHitPer1M,
            outputPer1M: config.deepseekPriceOutputPer1M
          },
          accountBalance,
          usageStats
        }
      },
      editableValues: {
        plexServersRaw: config.plexServers.map((s) => `${s.name}|${s.baseUrl}`).join(','),
        plexTokenMasked: maskSecret(config.plexToken),
        plexTokenConfigured: Boolean(config.plexToken),
        overseerrBaseUrl: config.overseerrBaseUrl,
        overseerrApiKeyMasked: maskSecret(config.overseerrApiKey),
        overseerrApiKeyConfigured: Boolean(config.overseerrApiKey),
        radarrBaseUrl: config.radarrBaseUrl,
        radarrApiKeyMasked: maskSecret(config.radarrApiKey),
        radarrApiKeyConfigured: Boolean(config.radarrApiKey),
        sonarrBaseUrl: config.sonarrBaseUrl,
        sonarrApiKeyMasked: maskSecret(config.sonarrApiKey),
        sonarrApiKeyConfigured: Boolean(config.sonarrApiKey),
        prowlarrBaseUrl: config.prowlarrBaseUrl,
        prowlarrApiKeyMasked: maskSecret(config.prowlarrApiKey),
        prowlarrApiKeyConfigured: Boolean(config.prowlarrApiKey),
        tracearrBaseUrl: config.tracearrBaseUrl,
        tracearrApiKeyMasked: maskSecret(config.tracearrApiKey),
        tracearrApiKeyConfigured: Boolean(config.tracearrApiKey),
        cloudflareAccountId: config.cloudflareAccountId,
        cloudflareApiTokenMasked: maskSecret(config.cloudflareApiToken),
        cloudflareApiTokenConfigured: Boolean(config.cloudflareApiToken),
        cfAccessTargetMode: config.cfAccessTargetMode,
        cfAccessTargetId: config.cfAccessTargetId,
        cfAccessTeamDomain: config.cfAccessTeamDomain,
        cfAccessAud: config.cfAccessAud,
        adminEmailsRaw: config.adminEmails.join(', '),
        deepseekBaseUrl: config.deepseekBaseUrl,
        deepseekModel: config.deepseekModel,
        deepseekApiKeyMasked: maskSecret(config.deepseekApiKey),
        deepseekApiKeyConfigured: Boolean(config.deepseekApiKey),
        aiDailyTokenCap: config.aiDailyTokenCap,
        aiMonthlyBudgetUsd: config.aiMonthlyBudgetUsd
      },
      smtp: smtpInvite.getPublicSummary()
    };

    return settings;
  });

  const saveRuntimeSettingsSchema = z.object({
    plexServersRaw: z.string().optional(),
    plexToken: z.string().optional(),
    overseerrBaseUrl: z.string().optional(),
    overseerrApiKey: z.string().optional(),
    radarrBaseUrl: z.string().optional(),
    radarrApiKey: z.string().optional(),
    sonarrBaseUrl: z.string().optional(),
    sonarrApiKey: z.string().optional(),
    prowlarrBaseUrl: z.string().optional(),
    prowlarrApiKey: z.string().optional(),
    tracearrBaseUrl: z.string().optional(),
    tracearrApiKey: z.string().optional(),
    cloudflareAccountId: z.string().optional(),
    cloudflareApiToken: z.string().optional(),
    cfAccessTargetMode: z.enum(['policy', 'group']).optional(),
    cfAccessTargetId: z.string().optional(),
    cfAccessTeamDomain: z.string().optional(),
    cfAccessAud: z.string().optional(),
    adminEmailsRaw: z.string().optional(),
    deepseekBaseUrl: z.string().optional(),
    deepseekModel: z.string().optional(),
    deepseekApiKey: z.string().optional(),
    aiDailyTokenCap: z.coerce.number().int().positive().optional(),
    aiMonthlyBudgetUsd: z.coerce.number().positive().optional()
  });

  app.post('/api/admin/settings/save', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = saveRuntimeSettingsSchema.parse(req.body);

    const saveIfPresent = (key: string, val?: string) => {
      if (val !== undefined && val.trim().length > 0 && !val.startsWith('••••')) {
        db.setAppSetting(key, val.trim());
      }
    };

    if (body.plexServersRaw !== undefined && body.plexServersRaw.trim().length > 0) {
      db.setAppSetting('cfg_plex_servers', body.plexServersRaw.trim());
    }
    saveIfPresent('cfg_plex_token', body.plexToken);
    saveIfPresent('cfg_overseerr_url', body.overseerrBaseUrl);
    saveIfPresent('cfg_overseerr_key', body.overseerrApiKey);
    saveIfPresent('cfg_radarr_url', body.radarrBaseUrl);
    saveIfPresent('cfg_radarr_key', body.radarrApiKey);
    saveIfPresent('cfg_sonarr_url', body.sonarrBaseUrl);
    saveIfPresent('cfg_sonarr_key', body.sonarrApiKey);
    saveIfPresent('cfg_prowlarr_url', body.prowlarrBaseUrl);
    saveIfPresent('cfg_prowlarr_key', body.prowlarrApiKey);
    saveIfPresent('cfg_tracearr_url', body.tracearrBaseUrl);
    saveIfPresent('cfg_tracearr_key', body.tracearrApiKey);

    if (body.cloudflareAccountId !== undefined) {
      db.setAppSetting('cfg_cf_account_id', body.cloudflareAccountId.trim());
    }
    saveIfPresent('cfg_cf_api_token', body.cloudflareApiToken);
    if (body.cfAccessTargetMode) {
      db.setAppSetting('cfg_cf_target_mode', body.cfAccessTargetMode);
    }
    if (body.cfAccessTargetId !== undefined) {
      db.setAppSetting('cfg_cf_target_id', body.cfAccessTargetId.trim());
    }
    if (body.cfAccessTeamDomain !== undefined) {
      db.setAppSetting('cfg_cf_team_domain', body.cfAccessTeamDomain.trim());
    }
    if (body.cfAccessAud !== undefined) {
      db.setAppSetting('cfg_cf_aud', body.cfAccessAud.trim());
    }
    if (body.adminEmailsRaw !== undefined && body.adminEmailsRaw.trim().length > 0) {
      db.setAppSetting('cfg_admin_emails', body.adminEmailsRaw.trim());
    }

    saveIfPresent('cfg_deepseek_url', body.deepseekBaseUrl);
    saveIfPresent('cfg_deepseek_model', body.deepseekModel);
    saveIfPresent('cfg_deepseek_key', body.deepseekApiKey);
    if (body.aiDailyTokenCap) {
      db.setAppSetting('cfg_ai_daily_token_cap', String(body.aiDailyTokenCap));
    }
    if (body.aiMonthlyBudgetUsd) {
      db.setAppSetting('cfg_ai_monthly_budget_usd', String(body.aiMonthlyBudgetUsd));
    }

    applySavedSettingsToRuntime();

    db.recordAuditLog({
      actorEmail: principal.email,
      actorRole: 'admin',
      actionType: 'RUNTIME_SETTINGS_UPDATE',
      targetService: 'sqlite',
      summaryFr: `Mise à jour et rechargement à chaud de la configuration Askarr (${config.plexServers.length} serveurs Plex actifs)`,
      status: 'SUCCESS'
    });

    return {
      ok: true,
      plexServersCount: config.plexServers.length,
      messageFr: 'Configuration enregistrée dans SQLite et appliquée à chaud sur tous les connecteurs !'
    };
  });

  const discoverPlexSchema = z.object({
    plexToken: z.string().optional(),
    autoApply: z.boolean().default(true)
  });

  app.post('/api/admin/settings/discover-plex', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = discoverPlexSchema.parse(req.body || {});

    const cleanOverrideToken =
      body.plexToken && body.plexToken.trim().length > 0 && !body.plexToken.startsWith('••••')
        ? body.plexToken.trim()
        : undefined;

    try {
      const discovered = await plex.discoverOwnedServers(cleanOverrideToken);
      const plexServersRaw = discovered.map((s) => `${s.name}|${s.baseUrl}`).join(',');

      if (body.autoApply && discovered.length > 0) {
        if (cleanOverrideToken) {
          db.setAppSetting('cfg_plex_token', cleanOverrideToken);
        }
        db.setAppSetting('cfg_plex_servers', plexServersRaw);
        applySavedSettingsToRuntime();
      }

      return {
        ok: true,
        discovered,
        plexServersRaw
      };
    } catch (err) {
      return reply.code(400).send({
        error: 'PLEX_DISCOVERY_FAILED',
        message: err instanceof Error ? err.message : 'Échec de la découverte automatique Plex.tv'
      });
    }
  });

  const testServiceSchema = z.object({
    service: z.string().min(1)
  });

  app.post('/api/admin/settings/test-service', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const body = testServiceSchema.parse(req.body);
    const marker = apiTracer.markPosition();

    let ok = false;
    let latencyMs = 0;
    let detail = '';
    let result: unknown;

    if (body.service.startsWith('plex')) {
      const allPlex = await plex.checkHealth();
      result = allPlex;
      const targetName = body.service.includes(':') ? body.service.split(':')[1] : undefined;
      const matched = targetName ? allPlex.find((p) => p.serverName === targetName) : allPlex[0];
      if (matched) {
        ok = matched.ok;
        latencyMs = matched.latencyMs;
        detail = matched.ok
          ? `Connecté (${matched.videoLibraries.length} bibliothèques : ${matched.videoLibraries.join(', ')})`
          : matched.error || 'Hors-ligne';
      }
    } else if (body.service === 'overseerr') {
      const h = await overseerr.checkHealth();
      result = h;
      ok = h.ok;
      latencyMs = h.latencyMs;
      detail = h.ok ? `Overseerr v${h.version ?? 'OK'}` : h.error || 'Erreur';
    } else if (body.service === 'radarr') {
      const h = await radarr.checkHealth();
      result = h;
      ok = h.ok;
      latencyMs = h.latencyMs;
      detail = h.ok ? `Radarr v${h.version ?? 'OK'}` : h.error || 'Erreur';
    } else if (body.service === 'sonarr') {
      const h = await sonarr.checkHealth();
      result = h;
      ok = h.ok;
      latencyMs = h.latencyMs;
      detail = h.ok ? `Sonarr v${h.version ?? 'OK'}` : h.error || 'Erreur';
    } else if (body.service === 'prowlarr') {
      const h = await prowlarr.checkHealth();
      result = h;
      ok = h.ok;
      latencyMs = h.latencyMs;
      detail = h.ok
        ? `Prowlarr v${h.version ?? 'OK'} (${h.activeIndexersCount} actifs, ${h.backoffIndexersCount} en backoff)`
        : h.error || 'Erreur';
    } else if (body.service === 'tracearr') {
      const h = await tracearr.checkHealth();
      result = h;
      ok = h.ok;
      latencyMs = h.latencyMs;
      detail = h.ok
        ? `Tracearr connecté (${h.monitoredServersCount ?? 0} serveurs supervisés : ${(h.serverNames ?? []).join(', ')})`
        : h.error || 'Erreur';
    } else if (body.service === 'cloudflare') {
      const h = await cfAccess.checkHealth();
      result = h;
      ok = h.ok;
      latencyMs = h.latencyMs;
      detail = h.ok
        ? `Cloudflare Access (${h.policiesCount ?? 0} policies, ${h.groupsCount ?? 0} groupes)`
        : h.error || 'Erreur';
    } else if (body.service === 'deepseek') {
      const t0 = Date.now();
      const bal = await orchestrator.getAccountBalance();
      latencyMs = Date.now() - t0;
      ok = Boolean(config.deepseekApiKey) && (bal.available || !bal.error);
      detail = ok
        ? `Connecté (${config.deepseekModel}) • Solde restant : ${bal.totalBalance} ${bal.currency}`
        : bal.error || 'Clé API absente ou solde épuisé';
      result = { ok, model: config.deepseekModel, balance: bal };
    }

    return {
      ok,
      latencyMs,
      detail,
      service: body.service,
      result,
      traces: apiTracer.getEntriesSince(marker)
    };
  });

  // 16. Notation & Retours Utilisateurs sur les réponses IA (pour amélioration continue du code)
  const feedbackBodySchema = z.object({
    messageId: z.string().min(1),
    conversationId: z.string().optional(),
    rating: z.number().int().min(1).max(5),
    quickTag: z.string().max(80).optional(),
    comment: z.string().max(600).optional(),
    userPrompt: z.string().max(1000).default(''),
    assistantReply: z.string().min(1).max(4000),
    mediaCardsSummary: z
      .array(
        z.object({
          tmdbId: z.number(),
          mediaType: z.string(),
          titleFr: z.string(),
          year: z.number().nullable(),
          plexState: z.string()
        })
      )
      .optional()
  });

  app.post('/api/chat/feedback', async (req) => {
    const { session } = await resolveUserSession(req);
    const body = feedbackBodySchema.parse(req.body);
    const saved = db.saveResponseFeedback({
      userEmail: session.email,
      conversationId: body.conversationId,
      messageId: body.messageId,
      rating: body.rating,
      quickTag: body.quickTag,
      comment: body.comment,
      userPrompt: body.userPrompt,
      assistantReply: body.assistantReply,
      mediaCardsSummary: body.mediaCardsSummary
    });
    return { status: 'SAVED', feedback: saved };
  });

  app.get('/api/admin/feedback', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    return db.getFeedbackStats(100);
  });

  const deleteFeedbackParamsSchema = z.object({
    id: z.coerce.number().int().positive()
  });

  app.delete('/api/admin/feedback/:id', async (req, reply: FastifyReply) => {
    const { principal } = await resolveUserSession(req);
    if (!requireAdmin(principal, reply)) return;
    const params = deleteFeedbackParamsSchema.parse(req.params);
    const deleted = db.deleteFeedback(params.id);
    return { status: deleted ? 'DELETED' : 'NOT_FOUND' };
  });

  // Servir le build statique du frontend React en production s'il existe
  const clientDistPath = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(clientDistPath)) {
    await app.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/'
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Route API introuvable.' });
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, db, aggregator, cfAccess };
}
