import type { AskarrDatabase } from '../db/database.js';
import type {
  DiscordNotificationDomainsDTO,
  DiscordSettingsDTO,
  LlmTurnUsageDTO,
  MediaEvidence
} from '../../shared/types.js';

export const DEFAULT_DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1566503759528337558/No8UJG59kVEgtA-MLl2Jr3pMFGo4DG19OltcIwc426RwalQlHLgyGF1QElvxa4PKzZ9k';

export interface DiscordConfigInternal {
  enabled: boolean;
  webhookUrl: string;
  botUsername: string;
  domains: DiscordNotificationDomainsDTO;
}

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: DiscordEmbedField[];
  thumbnail?: { url: string };
  footer?: { text: string };
  timestamp?: string;
}

function truncateText(text: string | null | undefined, maxLen: number): string {
  const cleaned = (text || '').trim();
  if (!cleaned) return '—';
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

export function maskDiscordWebhookUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^(https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/)(.+)$/i);
  if (match) {
    const prefix = match[1];
    const token = match[2];
    const tail = token.length > 6 ? token.slice(-6) : '';
    return `${prefix}••••••••••••${tail}`;
  }
  if (trimmed.length <= 16) return '••••••••••••';
  return `${trimmed.slice(0, 24)}••••••••${trimmed.slice(-4)}`;
}

export class DiscordNotifierService {
  constructor(
    private readonly db: AskarrDatabase,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly nodeEnv: 'development' | 'test' | 'production' = 'development'
  ) {}

  private getBoolSetting(key: string, defaultVal: boolean): boolean {
    const raw = this.db.getAppSetting(key);
    if (raw === null || raw === undefined || raw === '') return defaultVal;
    return raw === 'true' || raw === '1';
  }

  public getConfig(): DiscordConfigInternal {
    const defaultEnabled = this.nodeEnv !== 'test';
    const enabled = this.getBoolSetting('discord_enabled', defaultEnabled);

    const savedUrl = this.db.getAppSetting('discord_webhook_url');
    const webhookUrl = (
      savedUrl !== null && savedUrl !== undefined && savedUrl.trim().length > 0
        ? savedUrl
        : process.env.DISCORD_WEBHOOK_URL || DEFAULT_DISCORD_WEBHOOK_URL
    ).trim();

    const botUsername = (
      this.db.getAppSetting('discord_bot_username') ||
      process.env.DISCORD_BOT_USERNAME ||
      'Askarr · Concierge Cinéma'
    ).trim();

    const domains: DiscordNotificationDomainsDTO = {
      prompts: this.getBoolSetting('discord_domain_prompts', true),
      mediaRequests: this.getBoolSetting('discord_domain_media_requests', true),
      feedback: this.getBoolSetting('discord_domain_feedback', true),
      aiAlerts: this.getBoolSetting('discord_domain_ai_alerts', true),
      plexCast: this.getBoolSetting('discord_domain_plex_cast', false),
      userInvites: this.getBoolSetting('discord_domain_user_invites', false)
    };

    return {
      enabled,
      webhookUrl,
      botUsername,
      domains
    };
  }

  public getPublicSummary(): DiscordSettingsDTO {
    const cfg = this.getConfig();
    return {
      enabled: cfg.enabled,
      webhookConfigured: Boolean(cfg.webhookUrl && cfg.webhookUrl.startsWith('http')),
      webhookUrlMasked: maskDiscordWebhookUrl(cfg.webhookUrl),
      botUsername: cfg.botUsername,
      domains: cfg.domains
    };
  }

  public updateSettings(partial: {
    enabled?: boolean;
    webhookUrl?: string;
    botUsername?: string;
    domains?: Partial<DiscordNotificationDomainsDTO>;
  }): DiscordSettingsDTO {
    if (typeof partial.enabled === 'boolean') {
      this.db.setAppSetting('discord_enabled', partial.enabled ? 'true' : 'false');
    }
    if (typeof partial.webhookUrl === 'string') {
      const cleaned = partial.webhookUrl.trim();
      if (cleaned && !cleaned.includes('••••')) {
        this.db.setAppSetting('discord_webhook_url', cleaned);
      }
    }
    if (typeof partial.botUsername === 'string' && partial.botUsername.trim()) {
      this.db.setAppSetting('discord_bot_username', partial.botUsername.trim());
    }
    if (partial.domains) {
      const d = partial.domains;
      if (typeof d.prompts === 'boolean') {
        this.db.setAppSetting('discord_domain_prompts', d.prompts ? 'true' : 'false');
      }
      if (typeof d.mediaRequests === 'boolean') {
        this.db.setAppSetting('discord_domain_media_requests', d.mediaRequests ? 'true' : 'false');
      }
      if (typeof d.feedback === 'boolean') {
        this.db.setAppSetting('discord_domain_feedback', d.feedback ? 'true' : 'false');
      }
      if (typeof d.aiAlerts === 'boolean') {
        this.db.setAppSetting('discord_domain_ai_alerts', d.aiAlerts ? 'true' : 'false');
      }
      if (typeof d.plexCast === 'boolean') {
        this.db.setAppSetting('discord_domain_plex_cast', d.plexCast ? 'true' : 'false');
      }
      if (typeof d.userInvites === 'boolean') {
        this.db.setAppSetting('discord_domain_user_invites', d.userInvites ? 'true' : 'false');
      }
    }
    return this.getPublicSummary();
  }

  private async postEmbed(embed: DiscordEmbed, forceSend = false): Promise<{
    ok: boolean;
    latencyMs: number;
    detail: string;
  }> {
    const cfg = this.getConfig();
    if (!forceSend && !cfg.enabled) {
      return { ok: false, latencyMs: 0, detail: 'Notifications Discord désactivées' };
    }
    if (!cfg.webhookUrl || !cfg.webhookUrl.startsWith('http')) {
      return { ok: false, latencyMs: 0, detail: 'URL Webhook Discord non configurée' };
    }

    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await this.fetchImpl(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cfg.botUsername || 'Askarr · Concierge Cinéma',
          embeds: [
            {
              ...embed,
              footer: embed.footer || { text: 'Askarr • Grand Cinéma Plex' },
              timestamp: embed.timestamp || new Date().toISOString()
            }
          ]
        }),
        signal: controller.signal
      });
      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        let errTxt = '';
        try {
          errTxt = (await res.text()).slice(0, 120);
        } catch {
          // ignore
        }
        return {
          ok: false,
          latencyMs,
          detail: `Discord HTTP ${res.status}${errTxt ? ` : ${errTxt}` : ''}`
        };
      }
      return {
        ok: true,
        latencyMs,
        detail: `Notification Discord envoyée avec succès (HTTP ${res.status})`
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        detail: err instanceof Error ? err.message : 'Erreur réseau Discord Webhook'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async sendTestNotification(triggeredByEmail: string): Promise<{
    ok: boolean;
    latencyMs: number;
    detail: string;
  }> {
    const cfg = this.getConfig();
    const activeDomains = Object.entries(cfg.domains)
      .filter(([, v]) => v)
      .map(([k]) => {
        if (k === 'prompts') return '💬 Prompts & Réponses IA';
        if (k === 'mediaRequests') return '🎬 Demandes Médias';
        if (k === 'feedback') return '⭐ Notes & Feedbacks';
        if (k === 'aiAlerts') return '⚠️ Alertes IA / Failover';
        if (k === 'plexCast') return '📺 Cast Plex TV';
        if (k === 'userInvites') return '👥 Invitations VIP';
        return k;
      });

    return this.postEmbed(
      {
        title: '🔔 Test de Notification Discord — Askarr',
        description:
          'Le Webhook Discord de ton instance **Askarr** est opérationnel ! Tu recevras ici en temps réel les événements des domaines cochés dans **Paramètres**.',
        color: 0xf59e0b,
        fields: [
          {
            name: '👤 Déclenché par',
            value: triggeredByEmail,
            inline: true
          },
          {
            name: '📡 Statut Global',
            value: cfg.enabled ? '✅ Actif' : '⏸️ En pause (Test manuel)',
            inline: true
          },
          {
            name: '✅ Domaines notifiés cochés',
            value: activeDomains.length > 0 ? activeDomains.join(' • ') : 'Aucun domaine coché',
            inline: false
          }
        ]
      },
      true
    );
  }

  public notifyPromptInteraction(params: {
    userEmail: string;
    plexUsername?: string | null;
    userAllowedServers?: string[];
    prompt: string;
    reply: string;
    mediaCards: MediaEvidence[];
    aiMode: 'active' | 'direct_search_fallback';
    llmUsage?: LlmTurnUsageDTO;
  }): void {
    const cfg = this.getConfig();
    if (!cfg.enabled) return;

    // 1. Si une bascule (failover) ou un mode secours a eu lieu et que aiAlerts est coché, on notifie l'alerte IA
    if (cfg.domains.aiAlerts) {
      if (params.llmUsage?.failoverFrom) {
        void this.postEmbed({
          title: '⚠️ Bascule Automatique (Failover) Fournisseur LLM',
          description: `Le fournisseur initial **${params.llmUsage.failoverFrom}** n'a pas répondu ou a atteint son quota. Askarr a basculé de manière transparente sur **${params.llmUsage.providerLabel || params.llmUsage.model || 'Secours'}**.`,
          color: 0xf97316,
          fields: [
            {
              name: '👤 Utilisateur',
              value: params.plexUsername
                ? `${params.plexUsername} (${params.userEmail})`
                : params.userEmail,
              inline: true
            },
            {
              name: '🤖 Modèle de secours utilisé',
              value: `${params.llmUsage.providerLabel || ''} (${params.llmUsage.model || 'LLM'})`,
              inline: true
            },
            {
              name: '❓ Prompt concerné',
              value: truncateText(params.prompt, 240),
              inline: false
            }
          ]
        }).catch(() => {});
      } else if (params.aiMode === 'direct_search_fallback') {
        void this.postEmbed({
          title: '🚨 Mode Secours Déterministe Activé (Aucun LLM disponible)',
          description:
            "Tous les fournisseurs LLM ont échoué ou dépassé leur quota. Askarr a répondu via la recherche directe TMDB/Plex.",
          color: 0xf43f5e,
          fields: [
            {
              name: '👤 Utilisateur',
              value: params.userEmail,
              inline: true
            },
            {
              name: '❓ Prompt concerné',
              value: truncateText(params.prompt, 240),
              inline: false
            }
          ]
        }).catch(() => {});
      }
    }

    // 2. Notification du Prompt & Réponse IA
    if (!cfg.domains.prompts) return;

    const firstPoster = params.mediaCards.find(
      (c) => c.identity.posterUrl && c.identity.posterUrl.startsWith('http')
    )?.identity.posterUrl;

    const cardsSummary =
      params.mediaCards.length > 0
        ? params.mediaCards
            .slice(0, 5)
            .map((c) => {
              const stateIcon =
                c.catalogPresence.state === 'available_now'
                  ? '🟢 Dispo Plex'
                  : c.catalogPresence.state === 'partially_available'
                    ? '🟡 Partiel Plex'
                    : '🔵 Non présent';
              return `• **${c.identity.titleFr}** (${c.identity.year || 'N/A'}) — ${stateIcon}`;
            })
            .join('\n')
        : '_Aucune fiche média attachée_';

    const modelLabel = params.llmUsage?.model
      ? `${params.llmUsage.providerLabel ? `${params.llmUsage.providerLabel} • ` : ''}${params.llmUsage.model}`
      : params.aiMode === 'direct_search_fallback'
        ? 'Recherche directe (Fallback)'
        : 'IA Active';

    const latencyTxt = params.llmUsage?.latencyMs
      ? ` • ${(params.llmUsage.latencyMs / 1000).toFixed(1)}s`
      : '';

    const userDisplay = params.plexUsername
      ? `${params.plexUsername} (${params.userEmail})`
      : params.userEmail;

    const serversTxt =
      params.userAllowedServers && params.userAllowedServers.length > 0
        ? ` [${params.userAllowedServers.join(', ')}]`
        : '';

    void this.postEmbed({
      title: `💬 Question posée : « ${truncateText(params.prompt, 140)} »`,
      description: truncateText(params.reply, 650),
      color: params.mediaCards.some((c) => c.catalogPresence.state === 'available_now')
        ? 0x10b981
        : 0xf59e0b,
      thumbnail: firstPoster ? { url: firstPoster } : undefined,
      fields: [
        {
          name: '👤 Spectateur & Serveurs',
          value: `${userDisplay}${serversTxt}`,
          inline: true
        },
        {
          name: '🤖 Modèle & Latence',
          value: `${modelLabel}${latencyTxt}`,
          inline: true
        },
        {
          name: `🎬 Affiches présentées (${params.mediaCards.length})`,
          value: truncateText(cardsSummary, 500),
          inline: false
        }
      ]
    }).catch(() => {});
  }

  public notifyMediaRequest(params: {
    userEmail: string;
    plexUsername?: string | null;
    title: string;
    year: number | null;
    mediaType: 'movie' | 'tv';
    seasons?: number[];
    overseerrRequestId?: number | null;
    targetService: string;
    messageFr: string;
    posterUrl?: string | null;
  }): void {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.domains.mediaRequests) return;

    const typeLabel =
      params.mediaType === 'tv'
        ? `Série TV${params.seasons && params.seasons.length > 0 ? ` (Saison${params.seasons.length > 1 ? 's' : ''} ${params.seasons.join(', ')})` : ''}`
        : 'Film';

    void this.postEmbed({
      title: `🎬 Programmation demandée : ${params.title}${params.year ? ` (${params.year})` : ''}`,
      description: params.messageFr,
      color: 0x10b981,
      thumbnail:
        params.posterUrl && params.posterUrl.startsWith('http')
          ? { url: params.posterUrl }
          : undefined,
      fields: [
        {
          name: '👤 Demandé par',
          value: params.plexUsername
            ? `${params.plexUsername} (${params.userEmail})`
            : params.userEmail,
          inline: true
        },
        {
          name: '📽️ Format',
          value: typeLabel,
          inline: true
        },
        {
          name: '⚙️ Pipeline',
          value: `${params.targetService.toUpperCase()}${params.overseerrRequestId ? ` (#${params.overseerrRequestId})` : ''}`,
          inline: true
        }
      ]
    }).catch(() => {});
  }

  public notifyFeedback(params: {
    userEmail: string;
    rating: number;
    quickTag?: string | null;
    comment?: string | null;
    userPrompt: string;
    assistantReply: string;
  }): void {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.domains.feedback) return;

    const stars = '⭐'.repeat(Math.max(1, Math.min(5, params.rating)));
    const color = params.rating >= 4 ? 0x10b981 : params.rating === 3 ? 0xf59e0b : 0xf43f5e;
    const titlePrefix =
      params.rating >= 4
        ? '⭐ Avis Spectateur Positif'
        : params.rating === 3
          ? '💬 Avis Spectateur Mitigé'
          : '🚨 Avis Spectateur Négatif (À analyser)';

    const fields: DiscordEmbedField[] = [
      {
        name: '👤 Spectateur',
        value: params.userEmail,
        inline: true
      },
      {
        name: '🏷️ Note & Tag',
        value: `${stars} (${params.rating}/5)${params.quickTag ? ` • **${params.quickTag}**` : ''}`,
        inline: true
      }
    ];

    if (params.comment && params.comment.trim()) {
      fields.push({
        name: '💬 Commentaire laissé',
        value: `« ${truncateText(params.comment, 400)} »`,
        inline: false
      });
    }

    if (params.userPrompt && params.userPrompt.trim()) {
      fields.push({
        name: '❓ Question posée',
        value: truncateText(params.userPrompt, 260),
        inline: false
      });
    }

    fields.push({
      name: '🤖 Réponse notée',
      value: truncateText(params.assistantReply, 400),
      inline: false
    });

    void this.postEmbed({
      title: `${titlePrefix} — ${params.rating}/5`,
      color,
      fields
    }).catch(() => {});
  }

  public notifyPlexCast(params: {
    userEmail: string;
    playerName: string;
    serverName: string;
    ratingKey: string;
    deliveryMethod: string;
    ok: boolean;
  }): void {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.domains.plexCast) return;

    void this.postEmbed({
      title: `📺 Diffusion Plex lancée sur ${params.playerName}`,
      description: `**${params.userEmail}** a déclenché une lecture sur **${params.playerName}** depuis le serveur **${params.serverName}** (${params.deliveryMethod}).`,
      color: params.ok ? 0x06b6d4 : 0xf43f5e
    }).catch(() => {});
  }

  public notifyUserInvite(params: {
    actorEmail: string;
    recipientEmail: string;
    actionLabel: string;
    plexServers?: string[];
  }): void {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.domains.userInvites) return;

    void this.postEmbed({
      title: `🎟️ Accès Membre / Invitation VIP : ${params.recipientEmail}`,
      description: params.actionLabel,
      color: 0xa855f7,
      fields: [
        {
          name: '👤 Membre invité',
          value: params.recipientEmail,
          inline: true
        },
        {
          name: '🖥️ Serveurs Plex',
          value:
            params.plexServers && params.plexServers.length > 0
              ? params.plexServers.join(', ')
              : 'Accès standard',
          inline: true
        },
        {
          name: '🔑 Action par',
          value: params.actorEmail,
          inline: true
        }
      ]
    }).catch(() => {});
  }
}
