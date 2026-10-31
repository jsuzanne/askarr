import type { AskarrDatabase } from '../db/database.js';

export interface CfAccessRule {
  email?: { email: string };
  email_domain?: { domain: string };
  ip?: { ip: string };
  geo?: { country_code: string };
  group?: { id: string };
  everyone?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CfReusablePolicy {
  id: string;
  name: string;
  decision: 'allow' | 'deny' | 'non_identity' | 'bypass' | string;
  include: CfAccessRule[];
  exclude?: CfAccessRule[];
  require?: CfAccessRule[];
  session_duration?: string;
  created_at?: string;
  updated_at?: string;
  app_count?: number;
}

export interface CfAccessGroup {
  id: string;
  name: string;
  include: CfAccessRule[];
  exclude?: CfAccessRule[];
  require?: CfAccessRule[];
  created_at?: string;
  updated_at?: string;
}

export interface CfTargetSummary {
  configured: boolean;
  targetMode: 'policy' | 'group';
  targetId: string | null;
  targetName: string | null;
  decision?: string;
  emails: string[];
  nonEmailRulesCount: number;
  availablePolicies: Array<{ id: string; name: string; decision: string; emailCount: number }>;
  availableGroups: Array<{ id: string; name: string; emailCount: number }>;
}

export class CloudflareAccessConnector {
  private activeTargetId: string | null;
  private activeTargetMode: 'policy' | 'group';

  constructor(
    private accountId: string,
    private apiToken: string,
    initialTargetMode: 'policy' | 'group' = 'policy',
    initialTargetId = '',
    private readonly db?: AskarrDatabase,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.activeTargetMode = initialTargetMode;
    this.activeTargetId = initialTargetId.trim() || null;
  }

  public updateConfig(params: {
    accountId?: string;
    apiToken?: string;
    targetMode?: 'policy' | 'group';
    targetId?: string;
  }): void {
    if (typeof params.accountId === 'string') {
      this.accountId = params.accountId.trim();
    }
    if (typeof params.apiToken === 'string' && params.apiToken.trim() && !params.apiToken.includes('••••')) {
      this.apiToken = params.apiToken.trim();
    }
    if (params.targetMode === 'policy' || params.targetMode === 'group') {
      this.activeTargetMode = params.targetMode;
    }
    if (typeof params.targetId === 'string') {
      this.activeTargetId = params.targetId.trim() || null;
    }
  }

  public isConfigured(): boolean {
    return Boolean(this.accountId && this.apiToken);
  }

  private async cfFetch<T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
    timeoutMs = 8000
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('CLOUDFLARE_NOT_CONFIGURED: CLOUDFLARE_ACCOUNT_ID ou CLOUDFLARE_API_TOKEN manquant.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}${path}`;
      const res = await this.fetchImpl(url, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      const json = (await res.json()) as {
        success?: boolean;
        result?: T;
        errors?: Array<{ code?: number; message?: string }>;
      };

      if (!res.ok || !json.success) {
        const errMsg = json.errors?.map((e) => e.message).join('; ') || `HTTP_${res.status}`;
        throw new Error(`CLOUDFLARE_API_ERROR: ${errMsg}`);
      }
      return json.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  public static extractEmailsFromRules(rules: CfAccessRule[] = []): string[] {
    const emails: string[] = [];
    for (const r of rules) {
      if (r.email && typeof r.email.email === 'string') {
        emails.push(r.email.email.trim().toLowerCase());
      }
    }
    return Array.from(new Set(emails));
  }

  public static mergeEmailsIntoRules(existingRules: CfAccessRule[] = [], newEmails: string[]): CfAccessRule[] {
    const nonEmailRules = existingRules.filter((r) => !r.email);
    const normalizedEmails = Array.from(
      new Set(newEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    );
    const emailRules: CfAccessRule[] = normalizedEmails.map((email) => ({
      email: { email }
    }));
    return [...nonEmailRules, ...emailRules];
  }

  public async listReusablePolicies(): Promise<CfReusablePolicy[]> {
    return (await this.cfFetch<CfReusablePolicy[]>('/access/policies')) || [];
  }

  public async listAccessGroups(): Promise<CfAccessGroup[]> {
    return (await this.cfFetch<CfAccessGroup[]>('/access/groups')) || [];
  }

  /**
   * Découvre automatiquement la policy réutilisable Askarr (`askarr-allow-users`, `allow askarr-user`, `askarr-user`)
   * si CF_ACCESS_TARGET_ID n'a pas encore été renseigné dans .env.
   */
  public async resolveOrDiscoverTarget(): Promise<{
    mode: 'policy' | 'group';
    id: string | null;
    policies: CfReusablePolicy[];
    groups: CfAccessGroup[];
  }> {
    const [policies, groups] = await Promise.all([
      this.listReusablePolicies(),
      this.listAccessGroups()
    ]);

    if (this.activeTargetId) {
      return {
        mode: this.activeTargetMode,
        id: this.activeTargetId,
        policies,
        groups
      };
    }

    // Recherche automatique d'une policy portant "askarr" dans son nom
    const askarrPolicy = policies.find((p) => p.name.toLowerCase().includes('askarr'));
    if (askarrPolicy) {
      this.activeTargetMode = 'policy';
      this.activeTargetId = askarrPolicy.id;
      return { mode: 'policy', id: askarrPolicy.id, policies, groups };
    }

    // Sinon recherche d'un groupe portant "askarr" dans son nom
    const askarrGroup = groups.find((g) => g.name.toLowerCase().includes('askarr'));
    if (askarrGroup) {
      this.activeTargetMode = 'group';
      this.activeTargetId = askarrGroup.id;
      return { mode: 'group', id: askarrGroup.id, policies, groups };
    }

    return {
      mode: this.activeTargetMode,
      id: null,
      policies,
      groups
    };
  }

  public setTarget(mode: 'policy' | 'group', targetId: string): void {
    this.activeTargetMode = mode;
    this.activeTargetId = targetId.trim();
  }

  public async checkHealth(): Promise<{
    ok: boolean;
    latencyMs: number;
    policiesCount?: number;
    groupsCount?: number;
    error?: string;
  }> {
    const t0 = Date.now();
    if (!this.isConfigured()) {
      return { ok: false, latencyMs: 0, error: 'NOT_CONFIGURED' };
    }
    try {
      const [policies, groups] = await Promise.all([
        this.listReusablePolicies(),
        this.listAccessGroups()
      ]);
      return {
        ok: true,
        latencyMs: Date.now() - t0,
        policiesCount: policies.length,
        groupsCount: groups.length
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : 'UNKNOWN_ERROR'
      };
    }
  }

  public async getStatusSummary(): Promise<CfTargetSummary> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        targetMode: this.activeTargetMode,
        targetId: null,
        targetName: null,
        emails: [],
        nonEmailRulesCount: 0,
        availablePolicies: [],
        availableGroups: []
      };
    }

    const { mode, id, policies, groups } = await this.resolveOrDiscoverTarget();

    const availablePolicies = policies.map((p) => ({
      id: p.id,
      name: p.name,
      decision: p.decision,
      emailCount: CloudflareAccessConnector.extractEmailsFromRules(p.include).length
    }));

    const availableGroups = groups.map((g) => ({
      id: g.id,
      name: g.name,
      emailCount: CloudflareAccessConnector.extractEmailsFromRules(g.include).length
    }));

    if (!id) {
      return {
        configured: true,
        targetMode: mode,
        targetId: null,
        targetName: null,
        emails: [],
        nonEmailRulesCount: 0,
        availablePolicies,
        availableGroups
      };
    }

    if (mode === 'policy') {
      const target = await this.cfFetch<CfReusablePolicy>(`/access/policies/${encodeURIComponent(id)}`);
      const emails = CloudflareAccessConnector.extractEmailsFromRules(target.include);
      const nonEmailCount = (target.include || []).filter((r) => !r.email).length;
      return {
        configured: true,
        targetMode: 'policy',
        targetId: target.id,
        targetName: target.name,
        decision: target.decision,
        emails,
        nonEmailRulesCount: nonEmailCount,
        availablePolicies,
        availableGroups
      };
    } else {
      const target = await this.cfFetch<CfAccessGroup>(`/access/groups/${encodeURIComponent(id)}`);
      const emails = CloudflareAccessConnector.extractEmailsFromRules(target.include);
      const nonEmailCount = (target.include || []).filter((r) => !r.email).length;
      return {
        configured: true,
        targetMode: 'group',
        targetId: target.id,
        targetName: target.name,
        emails,
        nonEmailRulesCount: nonEmailCount,
        availablePolicies,
        availableGroups
      };
    }
  }

  /**
   * Crée, récupère ou synchronise automatiquement le groupe ou la policy `askarr-allow-users` sur Cloudflare Access.
   */
  public async ensureAskarrReusablePolicy(params: {
    policyName?: string;
    initialEmails: string[];
    actorEmail: string;
  }): Promise<CfReusablePolicy | CfAccessGroup> {
    const desiredName = (params.policyName || 'askarr-allow-users').trim();
    const cleanEmails = Array.from(
      new Set(params.initialEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    );

    // 1. Vérifier d'abord si un Rule Group (Access Group) askarr-allow-users existe
    const groups = await this.listAccessGroups();
    const existingGroup = groups.find(
      (g) => g.name.trim().toLowerCase() === desiredName.toLowerCase() || g.name.toLowerCase().includes('askarr')
    );

    if (existingGroup) {
      const currentGroup = await this.cfFetch<CfAccessGroup>(
        `/access/groups/${encodeURIComponent(existingGroup.id)}`
      );
      if (this.db) {
        this.db.saveCfPolicyRevision({
          targetType: 'group',
          targetId: currentGroup.id,
          operation: `SYNC_GROUP:${currentGroup.name}`,
          actorEmail: params.actorEmail,
          previousPayloadJson: JSON.stringify(currentGroup)
        });
      }

      const existingEmails = CloudflareAccessConnector.extractEmailsFromRules(currentGroup.include);
      const mergedEmails = Array.from(new Set([...existingEmails, ...cleanEmails]));
      const mergedInclude = CloudflareAccessConnector.mergeEmailsIntoRules(
        currentGroup.include || [],
        mergedEmails
      );

      const updatedGroup = await this.cfFetch<CfAccessGroup>(
        `/access/groups/${encodeURIComponent(currentGroup.id)}`,
        {
          method: 'PUT',
          body: {
            name: currentGroup.name,
            include: mergedInclude,
            exclude: currentGroup.exclude || [],
            require: currentGroup.require || []
          }
        }
      );

      this.activeTargetMode = 'group';
      this.activeTargetId = updatedGroup.id;
      return updatedGroup;
    }

    // 2. Sinon vérifier les Reusable Policies
    const policies = await this.listReusablePolicies();
    const existing = policies.find(
      (p) => p.name.trim().toLowerCase() === desiredName.toLowerCase() || p.name.toLowerCase().includes('askarr')
    );

    if (existing) {
      this.activeTargetMode = 'policy';
      this.activeTargetId = existing.id;
      return existing;
    }

    const includeRules: CfAccessRule[] = cleanEmails.map((email) => ({ email: { email } }));

    const created = await this.cfFetch<CfReusablePolicy>('/access/policies', {
      method: 'POST',
      body: {
        name: desiredName,
        decision: 'allow',
        include: includeRules,
        exclude: [],
        require: [],
        session_duration: '720h'
      }
    });

    this.activeTargetMode = 'policy';
    this.activeTargetId = created.id;

    if (this.db) {
      this.db.saveCfPolicyRevision({
        targetType: 'policy',
        targetId: created.id,
        operation: `BOOTSTRAP_POLICY:${desiredName}`,
        actorEmail: params.actorEmail,
        previousPayloadJson: JSON.stringify(created)
      });
    }

    return created;
  }

  /**
   * Ajoute un email à la policy ou au groupe Cloudflare Access après snapshot SQLite (`cf_policy_revisions`).
   */
  public async addEmailToTarget(params: {
    emailToAdd: string;
    actorEmail: string;
  }): Promise<{
    revisionId: number | null;
    updatedEmails: string[];
    targetId: string;
    targetName: string;
    alreadyPresent: boolean;
  }> {
    const normalizedEmail = params.emailToAdd.trim().toLowerCase();
    const { mode, id } = await this.resolveOrDiscoverTarget();
    if (!id) {
      throw new Error(
        'CF_TARGET_NOT_SET: Aucune policy ou groupe Askarr sélectionné. Créez ou sélectionnez "askarr-allow-users" d\'abord.'
      );
    }

    const endpoint =
      mode === 'policy'
        ? `/access/policies/${encodeURIComponent(id)}`
        : `/access/groups/${encodeURIComponent(id)}`;

    const current = await this.cfFetch<CfReusablePolicy | CfAccessGroup>(endpoint);
    const existingEmails = CloudflareAccessConnector.extractEmailsFromRules(current.include);

    if (existingEmails.includes(normalizedEmail)) {
      return {
        revisionId: null,
        updatedEmails: existingEmails,
        targetId: current.id,
        targetName: current.name,
        alreadyPresent: true
      };
    }

    // 1. Sauvegarde obligatoire avant écriture (R2 / ADR-006)
    let revisionId: number | null = null;
    if (this.db) {
      revisionId = this.db.saveCfPolicyRevision({
        targetType: mode,
        targetId: current.id,
        operation: `ADD_EMAIL:${normalizedEmail}`,
        actorEmail: params.actorEmail,
        previousPayloadJson: JSON.stringify(current)
      });
    }

    // 2. Fusion chirurgicale préservant toutes les règles non-email
    const nextEmails = [...existingEmails, normalizedEmail];
    const nextInclude = CloudflareAccessConnector.mergeEmailsIntoRules(current.include, nextEmails);

    const putBody: Record<string, unknown> = {
      name: current.name,
      include: nextInclude,
      exclude: current.exclude || [],
      require: current.require || []
    };

    if (mode === 'policy') {
      const pol = current as CfReusablePolicy;
      putBody.decision = pol.decision || 'allow';
      if (pol.session_duration) {
        putBody.session_duration = pol.session_duration;
      }
    }

    const updated = await this.cfFetch<CfReusablePolicy | CfAccessGroup>(endpoint, {
      method: 'PUT',
      body: putBody
    });

    return {
      revisionId,
      updatedEmails: CloudflareAccessConnector.extractEmailsFromRules(updated.include),
      targetId: updated.id,
      targetName: updated.name,
      alreadyPresent: false
    };
  }

  /**
   * Ajoute un lot d'emails d'amis Plex à la policy ou au groupe Cloudflare Access en une seule écriture atomique.
   */
  public async addMultipleEmailsToTarget(params: {
    emailsToAdd: string[];
    actorEmail: string;
  }): Promise<{
    revisionId: number | null;
    addedCount: number;
    addedEmails: string[];
    updatedEmails: string[];
    targetId: string;
    targetName: string;
  }> {
    const cleanToAdd = Array.from(
      new Set(
        params.emailsToAdd
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.includes('@'))
      )
    );

    const { mode, id } = await this.resolveOrDiscoverTarget();
    if (!id) {
      throw new Error(
        'CF_TARGET_NOT_SET: Aucune policy ou groupe Askarr sélectionné. Créez ou sélectionnez "askarr-allow-users" d\'abord.'
      );
    }

    const endpoint =
      mode === 'policy'
        ? `/access/policies/${encodeURIComponent(id)}`
        : `/access/groups/${encodeURIComponent(id)}`;

    const current = await this.cfFetch<CfReusablePolicy | CfAccessGroup>(endpoint);
    const existingEmails = CloudflareAccessConnector.extractEmailsFromRules(current.include);
    const newlyAdded = cleanToAdd.filter((e) => !existingEmails.includes(e));

    if (newlyAdded.length === 0) {
      return {
        revisionId: null,
        addedCount: 0,
        addedEmails: [],
        updatedEmails: existingEmails,
        targetId: current.id,
        targetName: current.name
      };
    }

    let revisionId: number | null = null;
    if (this.db) {
      revisionId = this.db.saveCfPolicyRevision({
        targetType: mode,
        targetId: current.id,
        operation: `BULK_IMPORT_PLEX:${newlyAdded.length}_EMAILS`,
        actorEmail: params.actorEmail,
        previousPayloadJson: JSON.stringify(current)
      });
    }

    const nextEmails = Array.from(new Set([...existingEmails, ...newlyAdded]));
    const nextInclude = CloudflareAccessConnector.mergeEmailsIntoRules(current.include, nextEmails);

    const putBody: Record<string, unknown> = {
      name: current.name,
      include: nextInclude,
      exclude: current.exclude || [],
      require: current.require || []
    };

    if (mode === 'policy') {
      const pol = current as CfReusablePolicy;
      putBody.decision = pol.decision || 'allow';
      if (pol.session_duration) {
        putBody.session_duration = pol.session_duration;
      }
    }

    const updated = await this.cfFetch<CfReusablePolicy | CfAccessGroup>(endpoint, {
      method: 'PUT',
      body: putBody
    });

    return {
      revisionId,
      addedCount: newlyAdded.length,
      addedEmails: newlyAdded,
      updatedEmails: CloudflareAccessConnector.extractEmailsFromRules(updated.include),
      targetId: updated.id,
      targetName: updated.name
    };
  }

  /**
   * Retire un email de la policy ou du groupe Cloudflare Access après snapshot SQLite (`cf_policy_revisions`).
   */
  public async removeEmailFromTarget(params: {
    emailToRemove: string;
    actorEmail: string;
    protectedAdminEmails: string[];
  }): Promise<{
    revisionId: number | null;
    updatedEmails: string[];
    targetId: string;
    targetName: string;
  }> {
    const normalizedEmail = params.emailToRemove.trim().toLowerCase();
    const isAdminProtected = params.protectedAdminEmails
      .map((e) => e.trim().toLowerCase())
      .includes(normalizedEmail);

    if (isAdminProtected) {
      throw new Error(
        'CANNOT_REMOVE_ADMIN_EMAIL: Impossible de supprimer une adresse email administrateur de la policy Cloudflare Access.'
      );
    }

    const { mode, id } = await this.resolveOrDiscoverTarget();
    if (!id) {
      throw new Error('CF_TARGET_NOT_SET: Aucune policy ou groupe Askarr sélectionné.');
    }

    const endpoint =
      mode === 'policy'
        ? `/access/policies/${encodeURIComponent(id)}`
        : `/access/groups/${encodeURIComponent(id)}`;

    const current = await this.cfFetch<CfReusablePolicy | CfAccessGroup>(endpoint);
    const existingEmails = CloudflareAccessConnector.extractEmailsFromRules(current.include);
    const nextEmails = existingEmails.filter((e) => e !== normalizedEmail);

    if (nextEmails.length === 0 && (current.include || []).filter((r) => !r.email).length === 0) {
      throw new Error(
        'CANNOT_EMPTY_POLICY: Impossible de vider totalement la règle include de la policy Cloudflare Access.'
      );
    }

    let revisionId: number | null = null;
    if (this.db) {
      revisionId = this.db.saveCfPolicyRevision({
        targetType: mode,
        targetId: current.id,
        operation: `REMOVE_EMAIL:${normalizedEmail}`,
        actorEmail: params.actorEmail,
        previousPayloadJson: JSON.stringify(current)
      });
    }

    const nextInclude = CloudflareAccessConnector.mergeEmailsIntoRules(current.include, nextEmails);

    const putBody: Record<string, unknown> = {
      name: current.name,
      include: nextInclude,
      exclude: current.exclude || [],
      require: current.require || []
    };

    if (mode === 'policy') {
      const pol = current as CfReusablePolicy;
      putBody.decision = pol.decision || 'allow';
      if (pol.session_duration) {
        putBody.session_duration = pol.session_duration;
      }
    }

    const updated = await this.cfFetch<CfReusablePolicy | CfAccessGroup>(endpoint, {
      method: 'PUT',
      body: putBody
    });

    return {
      revisionId,
      updatedEmails: CloudflareAccessConnector.extractEmailsFromRules(updated.include),
      targetId: updated.id,
      targetName: updated.name
    };
  }

  /**
   * Restaure une révision précédente depuis la table SQLite `cf_policy_revisions`.
   */
  public async rollbackToRevision(params: {
    revisionId: number;
    actorEmail: string;
  }): Promise<{
    restoredTargetId: string;
    restoredTargetName: string;
    restoredEmails: string[];
  }> {
    if (!this.db) {
      throw new Error('DATABASE_REQUIRED_FOR_ROLLBACK');
    }

    const rev = this.db.getCfPolicyRevisionById(params.revisionId);
    if (!rev) {
      throw new Error(`REVISION_NOT_FOUND: Révision #${params.revisionId} introuvable.`);
    }

    const snapshot = JSON.parse(rev.previousPayloadJson) as CfReusablePolicy & CfAccessGroup;
    const endpoint =
      rev.targetType === 'policy'
        ? `/access/policies/${encodeURIComponent(rev.targetId)}`
        : `/access/groups/${encodeURIComponent(rev.targetId)}`;

    // Sauvegarde de l'état courant avant restauration
    const currentBeforeRollback = await this.cfFetch<CfReusablePolicy | CfAccessGroup>(endpoint);
    this.db.saveCfPolicyRevision({
      targetType: rev.targetType,
      targetId: rev.targetId,
      operation: `PRE_ROLLBACK_TO_${params.revisionId}`,
      actorEmail: params.actorEmail,
      previousPayloadJson: JSON.stringify(currentBeforeRollback)
    });

    const putBody: Record<string, unknown> = {
      name: snapshot.name,
      include: snapshot.include || [],
      exclude: snapshot.exclude || [],
      require: snapshot.require || []
    };

    if (rev.targetType === 'policy') {
      putBody.decision = snapshot.decision || 'allow';
      if (snapshot.session_duration) {
        putBody.session_duration = snapshot.session_duration;
      }
    }

    const restored = await this.cfFetch<CfReusablePolicy | CfAccessGroup>(endpoint, {
      method: 'PUT',
      body: putBody
    });

    return {
      restoredTargetId: restored.id,
      restoredTargetName: restored.name,
      restoredEmails: CloudflareAccessConnector.extractEmailsFromRules(restored.include)
    };
  }
}
