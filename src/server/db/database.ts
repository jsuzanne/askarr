import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ChatMessageDTO,
  FeedbackStatsDTO,
  LlmUsageCallEntryDTO,
  MediaEvidence,
  ProvenanceEntry,
  ResponseFeedbackDTO,
  UserRole
} from '../../shared/types.js';

export interface LlmUsageRecord {
  userEmail: string;
  conversationId: string | null;
  model: string;
  toolRounds: number;
  promptTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  fallbackUsed: boolean;
}

export interface LlmBudgetStats {
  dailyTokensUsed: number;
  dailyTokenCap: number;
  monthlyCostUsd: number;
  monthlyBudgetUsd: number;
  cacheHitRatioPercent: number;
  totalCallsCount: number;
  averageCostPerRequestUsd: number;
  averageTokensPerRequest: number;
  lastRequestCostUsd: number | null;
  isOverQuota: boolean;
  recentCalls: LlmUsageCallEntryDTO[];
}

export class AskarrDatabase {
  public readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const resolved = path.resolve(dbPath);
      const dir = path.dirname(resolved);
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(resolved) && fs.statSync(resolved).size > 0) {
        const backupPath = `${resolved}.bak.latest`;
        try {
          fs.copyFileSync(resolved, backupPath);
        } catch {
          // Ignore backup error on read-only fs if any
        }
      }
      this.db = new DatabaseSync(resolved);
    } else {
      this.db = new DatabaseSync(':memory:');
    }

    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_identity_links (
        cf_email TEXT PRIMARY KEY,
        overseerr_user_id INTEGER NOT NULL,
        overseerr_email TEXT NOT NULL,
        plex_username TEXT,
        linked_by TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        media_cards_json TEXT,
        provenance_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prepared_actions (
        token TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        overseerr_user_id INTEGER,
        action_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        external_result_json TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target_service TEXT NOT NULL,
        action_token TEXT,
        summary_fr TEXT NOT NULL,
        diff_redacted_json TEXT,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cf_policy_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_name TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        operation TEXT NOT NULL,
        before_emails_json TEXT NOT NULL,
        after_emails_json TEXT NOT NULL,
        full_rule_backup_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS llm_usage_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        user_email TEXT NOT NULL,
        conversation_id TEXT,
        model TEXT NOT NULL,
        tool_rounds INTEGER NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        prompt_cache_hit_tokens INTEGER NOT NULL,
        prompt_cache_miss_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        estimated_cost_usd REAL NOT NULL,
        latency_ms INTEGER NOT NULL,
        fallback_used INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS response_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        user_email TEXT NOT NULL,
        conversation_id TEXT,
        message_id TEXT NOT NULL,
        rating INTEGER NOT NULL,
        quick_tag TEXT,
        comment TEXT,
        user_prompt TEXT NOT NULL,
        assistant_reply TEXT NOT NULL,
        media_cards_summary_json TEXT
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  public getAppSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  public getAllAppSettings(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all() as Array<{
      key: string;
      value: string;
    }>;
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.key] = r.value;
    }
    return out;
  }

  public setAppSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, new Date().toISOString());
  }

  public getIdentityAlias(cfEmail: string): { overseerrUserId: number; overseerrEmail: string; plexUsername: string | null } | null {
    const stmt = this.db.prepare(
      'SELECT overseerr_user_id, overseerr_email, plex_username FROM user_identity_links WHERE LOWER(cf_email) = LOWER(?)'
    );
    const row = stmt.get(cfEmail) as
      | { overseerr_user_id: number; overseerr_email: string; plex_username: string | null }
      | undefined;
    if (!row) return null;
    return {
      overseerrUserId: row.overseerr_user_id,
      overseerrEmail: row.overseerr_email,
      plexUsername: row.plex_username
    };
  }

  public upsertIdentityAlias(params: {
    cfEmail: string;
    overseerrUserId: number;
    overseerrEmail: string;
    plexUsername: string | null;
    linkedBy: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO user_identity_links (cf_email, overseerr_user_id, overseerr_email, plex_username, linked_by, updated_at)
      VALUES (LOWER(?), ?, LOWER(?), ?, ?, ?)
      ON CONFLICT(cf_email) DO UPDATE SET
        overseerr_user_id = excluded.overseerr_user_id,
        overseerr_email = excluded.overseerr_email,
        plex_username = excluded.plex_username,
        linked_by = excluded.linked_by,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      params.cfEmail,
      params.overseerrUserId,
      params.overseerrEmail,
      params.plexUsername,
      params.linkedBy,
      new Date().toISOString()
    );
  }

  public listIdentityAliases(): Array<{
    cfEmail: string;
    overseerrUserId: number;
    overseerrEmail: string;
    plexUsername: string | null;
    linkedBy: string;
    updatedAt: string;
  }> {
    return this.db
      .prepare(
        `SELECT cf_email AS cfEmail, overseerr_user_id AS overseerrUserId,
                overseerr_email AS overseerrEmail, plex_username AS plexUsername,
                linked_by AS linkedBy, updated_at AS updatedAt
         FROM user_identity_links
         ORDER BY updated_at DESC`
      )
      .all() as Array<{
      cfEmail: string;
      overseerrUserId: number;
      overseerrEmail: string;
      plexUsername: string | null;
      linkedBy: string;
      updatedAt: string;
    }>;
  }

  public createPreparedAction(params: {
    userEmail: string;
    overseerrUserId: number | null;
    actionType: 'OVERSEERR_REQUEST_MOVIE' | 'OVERSEERR_REQUEST_TV';
    payload: {
      mediaType: 'movie' | 'tv';
      tmdbId: number;
      title: string;
      year: number | null;
      seasons?: number[];
      summaryFr: string;
    };
    ttlMinutes?: number;
  }): {
    token: string;
    expiresAt: string;
    payloadHash: string;
  } {
    const token = `act_${crypto.randomBytes(16).toString('hex')}`;
    const now = new Date();
    const ttlMs = (params.ttlMinutes ?? 10) * 60 * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const payloadJson = JSON.stringify(params.payload);
    const payloadHash = crypto.createHash('sha256').update(payloadJson).digest('hex');

    this.db
      .prepare(
        `INSERT INTO prepared_actions (
          token, user_email, overseerr_user_id, action_type,
          payload_json, payload_hash, status, created_at, expires_at
        ) VALUES (?, LOWER(?), ?, ?, ?, ?, 'PENDING', ?, ?)`
      )
      .run(
        token,
        params.userEmail,
        params.overseerrUserId,
        params.actionType,
        payloadJson,
        payloadHash,
        now.toISOString(),
        expiresAt
      );

    return { token, expiresAt, payloadHash };
  }

  public getPreparedActionByToken(token: string): {
    token: string;
    userEmail: string;
    overseerrUserId: number | null;
    actionType: string;
    payload: {
      mediaType: 'movie' | 'tv';
      tmdbId: number;
      title: string;
      year: number | null;
      seasons?: number[];
      summaryFr: string;
    };
    payloadHash: string;
    status: 'PENDING' | 'EXECUTED' | 'EXPIRED' | 'SUPERSEDED' | 'FAILED';
    externalResult: Record<string, unknown> | null;
    createdAt: string;
    expiresAt: string;
    consumedAt: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT token, user_email, overseerr_user_id, action_type,
                payload_json, payload_hash, status, external_result_json,
                created_at, expires_at, consumed_at
         FROM prepared_actions
         WHERE token = ?`
      )
      .get(token) as
      | {
          token: string;
          user_email: string;
          overseerr_user_id: number | null;
          action_type: string;
          payload_json: string;
          payload_hash: string;
          status: 'PENDING' | 'EXECUTED' | 'EXPIRED' | 'SUPERSEDED' | 'FAILED';
          external_result_json: string | null;
          created_at: string;
          expires_at: string;
          consumed_at: string | null;
        }
      | undefined;

    if (!row) return null;
    return {
      token: row.token,
      userEmail: row.user_email,
      overseerrUserId: row.overseerr_user_id,
      actionType: row.action_type,
      payload: JSON.parse(row.payload_json),
      payloadHash: row.payload_hash,
      status: row.status,
      externalResult: row.external_result_json ? JSON.parse(row.external_result_json) : null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at
    };
  }

  public completePreparedAction(params: {
    token: string;
    status: 'EXECUTED' | 'EXPIRED' | 'SUPERSEDED' | 'FAILED';
    externalResult?: Record<string, unknown>;
  }): boolean {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE prepared_actions
         SET status = ?, external_result_json = ?, consumed_at = ?
         WHERE token = ? AND status = 'PENDING'`
      )
      .run(
        params.status,
        params.externalResult ? JSON.stringify(params.externalResult) : null,
        now,
        params.token
      );
    return Number(res.changes) > 0;
  }

  public saveCfPolicyRevision(params: {
    targetType: 'policy' | 'group';
    targetId: string;
    operation: string;
    actorEmail: string;
    previousPayloadJson: string;
    beforeEmails?: string[];
    afterEmails?: string[];
    targetName?: string;
  }): number {
    let parsedName = params.targetName || params.targetId;
    let extractedBeforeEmails = params.beforeEmails || [];
    try {
      const parsed = JSON.parse(params.previousPayloadJson) as {
        name?: string;
        include?: Array<{ email?: { email?: string } }>;
      };
      if (parsed.name) parsedName = parsed.name;
      if (!params.beforeEmails && Array.isArray(parsed.include)) {
        extractedBeforeEmails = parsed.include
          .map((r) => r.email?.email?.trim().toLowerCase())
          .filter((e): e is string => Boolean(e));
      }
    } catch {
      // ignore parse fallback
    }

    const res = this.db
      .prepare(
        `INSERT INTO cf_policy_revisions (
          target_type, target_id, target_name, actor_email, operation,
          before_emails_json, after_emails_json, full_rule_backup_json, created_at
        ) VALUES (?, ?, ?, LOWER(?), ?, ?, ?, ?, ?)`
      )
      .run(
        params.targetType,
        params.targetId,
        parsedName,
        params.actorEmail,
        params.operation,
        JSON.stringify(extractedBeforeEmails),
        JSON.stringify(params.afterEmails || []),
        params.previousPayloadJson,
        new Date().toISOString()
      );
    return Number(res.lastInsertRowid);
  }

  public getCfPolicyRevisionById(revisionId: number): {
    id: number;
    targetType: 'policy' | 'group';
    targetId: string;
    targetName: string;
    actorEmail: string;
    operation: string;
    beforeEmails: string[];
    previousPayloadJson: string;
    createdAt: string;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, target_type, target_id, target_name, actor_email,
                operation, before_emails_json, full_rule_backup_json, created_at
         FROM cf_policy_revisions
         WHERE id = ?`
      )
      .get(revisionId) as
      | {
          id: number;
          target_type: 'policy' | 'group';
          target_id: string;
          target_name: string;
          actor_email: string;
          operation: string;
          before_emails_json: string;
          full_rule_backup_json: string;
          created_at: string;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      targetName: row.target_name,
      actorEmail: row.actor_email,
      operation: row.operation,
      beforeEmails: JSON.parse(row.before_emails_json),
      previousPayloadJson: row.full_rule_backup_json,
      createdAt: row.created_at
    };
  }

  public getRecentCfPolicyRevisions(limit = 20): Array<{
    id: number;
    targetType: 'policy' | 'group';
    targetId: string;
    targetName: string;
    actorEmail: string;
    operation: string;
    beforeEmails: string[];
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, target_type, target_id, target_name, actor_email,
                operation, before_emails_json, created_at
         FROM cf_policy_revisions
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: number;
      target_type: 'policy' | 'group';
      target_id: string;
      target_name: string;
      actor_email: string;
      operation: string;
      before_emails_json: string;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      targetName: r.target_name,
      actorEmail: r.actor_email,
      operation: r.operation,
      beforeEmails: JSON.parse(r.before_emails_json),
      createdAt: r.created_at
    }));
  }

  public ensureConversation(userEmail: string, conversationId?: string, title = 'Nouvelle discussion'): string {
    const now = new Date().toISOString();
    if (conversationId) {
      const existing = this.db
        .prepare('SELECT id FROM conversations WHERE id = ? AND LOWER(user_email) = LOWER(?)')
        .get(conversationId, userEmail) as { id: string } | undefined;
      if (existing) {
        this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
        return existing.id;
      }
    }
    const id = conversationId || crypto.randomUUID();
    this.db
      .prepare('INSERT INTO conversations (id, user_email, title, created_at, updated_at) VALUES (?, LOWER(?), ?, ?, ?)')
      .run(id, userEmail, title.slice(0, 80), now, now);
    return id;
  }

  public addMessage(params: {
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    mediaCards?: MediaEvidence[];
    provenance?: ProvenanceEntry[];
  }): ChatMessageDTO {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, media_cards_json, provenance_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.conversationId,
        params.role,
        params.content,
        params.mediaCards ? JSON.stringify(params.mediaCards) : null,
        params.provenance ? JSON.stringify(params.provenance) : null,
        createdAt
      );
    return {
      id,
      role: params.role,
      content: params.content,
      mediaCards: params.mediaCards,
      provenance: params.provenance,
      createdAt
    };
  }

  public getConversationMessages(conversationId: string, userEmail: string, limit = 20): ChatMessageDTO[] {
    const conv = this.db
      .prepare('SELECT id FROM conversations WHERE id = ? AND LOWER(user_email) = LOWER(?)')
      .get(conversationId, userEmail) as { id: string } | undefined;
    if (!conv) return [];

    const rows = this.db
      .prepare(
        `SELECT id, role, content, media_cards_json, provenance_json, created_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(conversationId, limit) as Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      media_cards_json: string | null;
      provenance_json: string | null;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      mediaCards: r.media_cards_json ? (JSON.parse(r.media_cards_json) as MediaEvidence[]) : undefined,
      provenance: r.provenance_json ? (JSON.parse(r.provenance_json) as ProvenanceEntry[]) : undefined,
      createdAt: r.created_at
    }));
  }

  public recordLlmUsage(record: LlmUsageRecord): void {
    this.db
      .prepare(
        `INSERT INTO llm_usage_ledger (
          timestamp, user_email, conversation_id, model, tool_rounds,
          prompt_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens,
          completion_tokens, estimated_cost_usd, latency_ms, fallback_used
        ) VALUES (?, LOWER(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        record.userEmail,
        record.conversationId,
        record.model,
        record.toolRounds,
        record.promptTokens,
        record.promptCacheHitTokens,
        record.promptCacheMissTokens,
        record.completionTokens,
        record.estimatedCostUsd,
        record.latencyMs,
        record.fallbackUsed ? 1 : 0
      );
  }

  public getLlmBudgetStats(dailyTokenCap: number, monthlyBudgetUsd: number): LlmBudgetStats {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const dayRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens
         FROM llm_usage_ledger WHERE timestamp >= ?`
      )
      .get(startOfDay) as { total_tokens: number };

    const monthRow = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(estimated_cost_usd), 0) AS total_cost,
           COALESCE(SUM(prompt_tokens), 0) AS total_prompt,
           COALESCE(SUM(prompt_cache_hit_tokens), 0) AS total_hit,
           COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
           COUNT(*) AS total_calls,
           SUM(CASE WHEN fallback_used = 0 THEN 1 ELSE 0 END) AS ai_calls
         FROM llm_usage_ledger WHERE timestamp >= ?`
      )
      .get(startOfMonth) as {
      total_cost: number;
      total_prompt: number;
      total_hit: number;
      total_tokens: number;
      total_calls: number;
      ai_calls: number | null;
    };

    const recentRows = this.db
      .prepare(
        `SELECT
           id, timestamp, user_email, model, tool_rounds,
           prompt_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens,
           completion_tokens, estimated_cost_usd, latency_ms, fallback_used
         FROM llm_usage_ledger
         ORDER BY id DESC
         LIMIT 15`
      )
      .all() as Array<{
      id: number;
      timestamp: string;
      user_email: string;
      model: string;
      tool_rounds: number;
      prompt_tokens: number;
      prompt_cache_hit_tokens: number;
      prompt_cache_miss_tokens: number;
      completion_tokens: number;
      estimated_cost_usd: number;
      latency_ms: number;
      fallback_used: number;
    }>;

    const recentCalls: LlmUsageCallEntryDTO[] = recentRows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      userEmail: r.user_email,
      model: r.model,
      toolRounds: r.tool_rounds,
      promptTokens: r.prompt_tokens,
      cacheHitTokens: r.prompt_cache_hit_tokens,
      cacheMissTokens: r.prompt_cache_miss_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.prompt_tokens + r.completion_tokens,
      estimatedCostUsd: Math.round(Number(r.estimated_cost_usd || 0) * 1_000_000) / 1_000_000,
      latencyMs: r.latency_ms,
      fallbackUsed: Boolean(r.fallback_used)
    }));

    const dailyTokensUsed = Number(dayRow?.total_tokens || 0);
    const monthlyCostUsd = Number(monthRow?.total_cost || 0);
    const totalPrompt = Number(monthRow?.total_prompt || 0);
    const totalHit = Number(monthRow?.total_hit || 0);
    const totalMonthTokens = Number(monthRow?.total_tokens || 0);
    const aiCallsCount = Number(monthRow?.ai_calls || 0);
    const cacheHitRatioPercent = totalPrompt > 0 ? Math.round((totalHit / totalPrompt) * 1000) / 10 : 0;

    // Coût moyen par requête IA (basé sur les appels réels, ou estimation standard ~6500 tokens avec 60% cache hit = ~$0.00124 si historique vide)
    const averageCostPerRequestUsd =
      aiCallsCount > 0
        ? Math.round((monthlyCostUsd / aiCallsCount) * 1_000_000) / 1_000_000
        : 0.00135;
    const averageTokensPerRequest =
      aiCallsCount > 0 ? Math.round(totalMonthTokens / aiCallsCount) : 7800;

    const lastAiCall = recentCalls.find((c) => !c.fallbackUsed);

    return {
      dailyTokensUsed,
      dailyTokenCap,
      monthlyCostUsd: Math.round(monthlyCostUsd * 100000) / 100000,
      monthlyBudgetUsd,
      cacheHitRatioPercent,
      totalCallsCount: Number(monthRow?.total_calls || 0),
      averageCostPerRequestUsd,
      averageTokensPerRequest,
      lastRequestCostUsd: lastAiCall ? lastAiCall.estimatedCostUsd : null,
      isOverQuota: dailyTokensUsed >= dailyTokenCap || monthlyCostUsd >= monthlyBudgetUsd,
      recentCalls
    };
  }

  public resetDailyLlmUsage(): number {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const res = this.db.prepare('DELETE FROM llm_usage_ledger WHERE timestamp >= ?').run(startOfDay);
    return Number(res.changes || 0);
  }

  public recordAuditLog(params: {
    actorEmail: string;
    actorRole: UserRole;
    actionType: string;
    targetService: string;
    actionToken?: string | null;
    summaryFr: string;
    diffRedacted?: unknown;
    status: 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'SUPERSEDED';
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (
          timestamp, actor_email, actor_role, action_type, target_service,
          action_token, summary_fr, diff_redacted_json, status
        ) VALUES (?, LOWER(?), ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        params.actorEmail,
        params.actorRole,
        params.actionType,
        params.targetService,
        params.actionToken || null,
        params.summaryFr,
        params.diffRedacted ? JSON.stringify(params.diffRedacted) : null,
        params.status
      );
  }

  public getRecentAuditLogs(limit = 50): Array<{
    id: number;
    timestamp: string;
    actorEmail: string;
    actorRole: string;
    actionType: string;
    targetService: string;
    summaryFr: string;
    status: string;
  }> {
    return this.db
      .prepare(
        `SELECT id, timestamp, actor_email AS actorEmail, actor_role AS actorRole,
                action_type AS actionType, target_service AS targetService,
                summary_fr AS summaryFr, status
         FROM audit_logs
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: number;
      timestamp: string;
      actorEmail: string;
      actorRole: string;
      actionType: string;
      targetService: string;
      summaryFr: string;
      status: string;
    }>;
  }

  public saveResponseFeedback(params: {
    userEmail: string;
    conversationId?: string | null;
    messageId: string;
    rating: number;
    quickTag?: string | null;
    comment?: string | null;
    userPrompt: string;
    assistantReply: string;
    mediaCardsSummary?: Array<{
      tmdbId: number;
      mediaType: string;
      titleFr: string;
      year: number | null;
      plexState: string;
    }>;
  }): ResponseFeedbackDTO {
    const now = new Date().toISOString();
    const cardsJson = JSON.stringify(params.mediaCardsSummary || []);
    const existing = this.db
      .prepare('SELECT id FROM response_feedback WHERE message_id = ? AND LOWER(user_email) = LOWER(?)')
      .get(params.messageId, params.userEmail) as { id: number } | undefined;

    let id: number;
    if (existing) {
      this.db
        .prepare(
          `UPDATE response_feedback
           SET rating = ?, quick_tag = ?, comment = ?, created_at = ?
           WHERE id = ?`
        )
        .run(
          params.rating,
          params.quickTag || null,
          params.comment || null,
          now,
          existing.id
        );
      id = existing.id;
    } else {
      const res = this.db
        .prepare(
          `INSERT INTO response_feedback (
            created_at, user_email, conversation_id, message_id, rating,
            quick_tag, comment, user_prompt, assistant_reply, media_cards_summary_json
          ) VALUES (?, LOWER(?), ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          now,
          params.userEmail,
          params.conversationId || null,
          params.messageId,
          params.rating,
          params.quickTag || null,
          params.comment || null,
          params.userPrompt,
          params.assistantReply,
          cardsJson
        );
      id = Number(res.lastInsertRowid);
    }

    return {
      id,
      createdAt: now,
      userEmail: params.userEmail.toLowerCase(),
      conversationId: params.conversationId || null,
      messageId: params.messageId,
      rating: params.rating,
      quickTag: params.quickTag || null,
      comment: params.comment || null,
      userPrompt: params.userPrompt,
      assistantReply: params.assistantReply,
      mediaCardsSummary: params.mediaCardsSummary || []
    };
  }

  public getFeedbackStats(limit = 60, maxRatingFilter?: number): FeedbackStatsDTO {
    const aggRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total_count,
                COALESCE(AVG(rating), 0) AS avg_rating,
                SUM(CASE WHEN rating <= 3 THEN 1 ELSE 0 END) AS low_count
         FROM response_feedback`
      )
      .get() as { total_count: number; avg_rating: number; low_count: number | null };

    const whereClause = typeof maxRatingFilter === 'number' ? 'WHERE rating <= ?' : '';
    const rows = (
      typeof maxRatingFilter === 'number'
        ? this.db
            .prepare(
              `SELECT id, created_at, user_email, conversation_id, message_id, rating,
                      quick_tag, comment, user_prompt, assistant_reply, media_cards_summary_json
               FROM response_feedback
               ${whereClause}
               ORDER BY id DESC
               LIMIT ?`
            )
            .all(maxRatingFilter, limit)
        : this.db
            .prepare(
              `SELECT id, created_at, user_email, conversation_id, message_id, rating,
                      quick_tag, comment, user_prompt, assistant_reply, media_cards_summary_json
               FROM response_feedback
               ORDER BY id DESC
               LIMIT ?`
            )
            .all(limit)
    ) as Array<{
      id: number;
      created_at: string;
      user_email: string;
      conversation_id: string | null;
      message_id: string;
      rating: number;
      quick_tag: string | null;
      comment: string | null;
      user_prompt: string;
      assistant_reply: string;
      media_cards_summary_json: string | null;
    }>;

    const items: ResponseFeedbackDTO[] = rows.map((r) => {
      let parsedCards: ResponseFeedbackDTO['mediaCardsSummary'] = [];
      try {
        parsedCards = r.media_cards_summary_json ? JSON.parse(r.media_cards_summary_json) : [];
      } catch {
        parsedCards = [];
      }
      return {
        id: r.id,
        createdAt: r.created_at,
        userEmail: r.user_email,
        conversationId: r.conversation_id,
        messageId: r.message_id,
        rating: r.rating,
        quickTag: r.quick_tag,
        comment: r.comment,
        userPrompt: r.user_prompt,
        assistantReply: r.assistant_reply,
        mediaCardsSummary: parsedCards
      };
    });

    return {
      totalCount: Number(aggRow?.total_count || 0),
      averageRating: Math.round(Number(aggRow?.avg_rating || 0) * 100) / 100,
      lowRatingCount: Number(aggRow?.low_count || 0),
      items
    };
  }

  public deleteFeedback(id: number): boolean {
    const res = this.db.prepare('DELETE FROM response_feedback WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  public close(): void {
    this.db.close();
  }
}
