import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Search,
  Send,
  Compass,
  Clock,
  ShieldCheck,
  Server,
  Star,
  Film,
  RefreshCw,
  CheckCircle2,
  XCircle,
  PlusCircle,
  Users,
  Trash2,
  RotateCcw,
  UserPlus,
  Bug,
  Settings,
  Activity,
  ChevronDown,
  ChevronUp,
  Terminal,
  Eye,
  Play,
  Award,
  MessageSquarePlus,
  Copy,
  Check,
  Clapperboard,
  Ticket,
  Mail
} from 'lucide-react';
import type {
  AdminSettingsDTO,
  ApiTraceEntryDTO,
  DeepSeekBalanceDTO,
  FeedbackStatsDTO,
  LlmTurnUsageDTO,
  LlmUsageCallEntryDTO,
  MediaEvidence,
  PlexSharedUserDTO,
  PreparedActionDTO,
  ProvenanceEntry,
  SmtpSettingsDTO,
  UserSessionInfo
} from '../shared/types.js';
import { MediaCandidateCard } from './components/MediaCandidateCard.js';
import { RichMarkdownText } from './components/RichMarkdownText.js';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  userPrompt?: string;
  mediaCards?: MediaEvidence[];
  preparedAction?: PreparedActionDTO;
  provenance?: ProvenanceEntry[];
  apiTraces?: ApiTraceEntryDTO[];
  llmUsage?: LlmTurnUsageDTO;
  aiMode?: 'active' | 'direct_search_fallback';
  createdAt: string;
}

interface AdminHealthResponse {
  plexServers: Array<{
    serverName: string;
    baseUrl: string;
    ok: boolean;
    latencyMs: number;
    version?: string;
    librariesCount?: number;
    videoLibraries?: string[];
  }>;
  overseerr: { ok: boolean; latencyMs: number; version?: string };
  radarr: { ok: boolean; latencyMs: number; version?: string };
  sonarr: { ok: boolean; latencyMs: number; version?: string };
  prowlarr: { ok: boolean; latencyMs: number; version?: string };
  cloudflareAccess?: { ok: boolean; latencyMs: number; policiesCount?: number; groupsCount?: number };
  deepseekConfigured: boolean;
}

interface CloudflareAdminStatus {
  configured: boolean;
  targetMode: 'policy' | 'group';
  targetId: string | null;
  targetName: string | null;
  emails: string[];
  nonEmailRulesCount: number;
  availablePolicies: Array<{ id: string; name: string; decision: string; emailCount: number }>;
  availableGroups: Array<{ id: string; name: string; emailCount: number }>;
  plexUsers: Array<{
    id: number;
    email: string;
    plexUsername: string | null;
    displayName: string;
    userType: number;
    requestCount: number;
  }>;
  plexDirectory?: PlexSharedUserDTO[];
  smtp?: SmtpSettingsDTO;
  identityAliases: Array<{
    cfEmail: string;
    overseerrUserId: number;
    overseerrEmail: string;
    plexUsername: string | null;
  }>;
  revisions: Array<{
    id: number;
    targetType: 'policy' | 'group';
    targetId: string;
    targetName: string;
    actorEmail: string;
    operation: string;
    beforeEmails: string[];
    createdAt: string;
  }>;
}

interface AiBudgetStats {
  dailyTokensUsed: number;
  dailyTokenCap: number;
  monthlyCostUsd: number;
  monthlyBudgetUsd: number;
  cacheHitRatioPercent: number;
  totalCallsCount: number;
  averageCostPerRequestUsd?: number;
  averageTokensPerRequest?: number;
  lastRequestCostUsd?: number | null;
  isOverQuota: boolean;
  recentCalls?: LlmUsageCallEntryDTO[];
  accountBalance?: DeepSeekBalanceDTO;
}

interface MyRequestItem {
  requestId: number;
  createdAt: string;
  requestedByDisplayName: string;
  requestedSeasons: number[];
  evidence: MediaEvidence;
}

const QUICK_PROMPTS = [
  {
    label: '🏆 Palmarès Cannes / Retrouver un film',
    icon: Award,
    prompt: 'Quels films ont gagné la Palme d’Or au Festival de Cannes ces dernières années et lesquels sont sur Plex ?'
  },
  {
    label: '🎬 Film par réalisateur ou acteur',
    icon: Clapperboard,
    prompt: 'Quels sont les meilleurs films de Cédric Klapisch ou Denis Villeneuve et lesquels sont disponibles sur Plex ?'
  },
  {
    label: '✨ Pépites déjà sur Plex (> 7.8)',
    icon: Star,
    prompt: 'Conseille-moi d’excellents films déjà disponibles sur Plex avec une note supérieure à 7.8'
  },
  {
    label: '🍿 Grand Spectacle Sci-Fi & Thriller',
    icon: Compass,
    prompt: 'Recommande-moi un super film de Science-Fiction ou Thriller psychologique avec les notes IMDb'
  },
  {
    label: '🎟️ Sorties Salle & dates VOD/DVD',
    icon: Ticket,
    prompt: 'Est-ce que Dune : Deuxième Partie ou Le Comte de Monte-Cristo sont sur Plex, ou quelle est leur date VOD / DVD ?'
  }
];

const FEEDBACK_QUICK_TAGS = [
  'Pertinent & précis',
  'Bon film retrouvé',
  'Mélange hors-sujet',
  'Film manquant',
  'Dispo Plex erronée'
];

function serviceBadgeColor(service: ApiTraceEntryDTO['service']): string {
  switch (service) {
    case 'radarr':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'sonarr':
      return 'bg-sky-500/20 text-sky-300 border-sky-500/40';
    case 'overseerr':
      return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
    case 'plex':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'prowlarr':
      return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
    case 'deepseek':
      return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    case 'cloudflare':
      return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
    case 'smtp':
      return 'bg-yellow-500/20 text-yellow-200 border-yellow-500/40';
    default:
      return 'bg-stone-700 text-stone-300 border-stone-600';
  }
}

export function App() {
  // Workspace mode: 'user' (Ami Plex interface) vs 'admin' (Console Admin)
  const [workspaceMode, setWorkspaceMode] = useState<'user' | 'admin'>('user');
  const [userTab, setUserTab] = useState<'chat' | 'requests'>('chat');
  const [adminTab, setAdminTab] = useState<'cloudflare' | 'health' | 'traces' | 'feedback' | 'settings'>('cloudflare');
  // Toggle for Admin to see inline technical traces inside the User Chat & Media Cards
  const [debugOverlay, setDebugOverlay] = useState<boolean>(true);
  const [expandedMsgTraceId, setExpandedMsgTraceId] = useState<string | null>(null);
  const [expandedTraceIds, setExpandedTraceIds] = useState<Record<string, boolean>>({});
  const [traceServiceFilter, setTraceServiceFilter] = useState<string>('all');

  const [session, setSession] = useState<UserSessionInfo | null>(null);
  const [adminHealth, setAdminHealth] = useState<AdminHealthResponse | null>(null);
  const [aiBudget, setAiBudget] = useState<AiBudgetStats | null>(null);
  const [cfStatus, setCfStatus] = useState<CloudflareAdminStatus | null>(null);
  const [adminSettings, setAdminSettings] = useState<AdminSettingsDTO | null>(null);
  const [apiTraces, setApiTraces] = useState<ApiTraceEntryDTO[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStatsDTO | null>(null);
  const [copiedFeedbackJson, setCopiedFeedbackJson] = useState(false);

  // Per-message user rating state
  const [ratingsByMsgId, setRatingsByMsgId] = useState<
    Record<
      string,
      {
        rating: number;
        comment: string;
        issueTag: string;
        saved: boolean;
        submitting?: boolean;
      }
    >
  >({});
  const [activeRatingDraftMsgId, setActiveRatingDraftMsgId] = useState<string | null>(null);

  const [testingServiceKey, setTestingServiceKey] = useState<string | null>(null);
  const [serviceTestResults, setServiceTestResults] = useState<
    Record<string, { ok: boolean; latencyMs: number; detail: string }>
  >({});

  const [newFriendEmail, setNewFriendEmail] = useState('');
  const [selectedPlexUserId, setSelectedPlexUserId] = useState<string>('');
  const [sendInviteOnAdd, setSendInviteOnAdd] = useState<boolean>(true);
  const [customInviteNote, setCustomInviteNote] = useState<string>('');
  const [plexFilterServer, setPlexFilterServer] = useState<string>('all');
  const [plexSearchQuery, setPlexSearchQuery] = useState<string>('');
  const [sendingInviteToEmail, setSendingInviteToEmail] = useState<string | null>(null);
  const [cfBusy, setCfBusy] = useState(false);
  const [cfBanner, setCfBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [smtpForm, setSmtpForm] = useState({
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpUser: '',
    smtpAppPassword: '',
    senderName: 'Askarr · Grand Cinéma Plex',
    publicAppUrl: ''
  });
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpBanner, setSmtpBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [configForm, setConfigForm] = useState({
    plexServersRaw: '',
    plexToken: '',
    overseerrBaseUrl: '',
    overseerrApiKey: '',
    radarrBaseUrl: '',
    radarrApiKey: '',
    sonarrBaseUrl: '',
    sonarrApiKey: '',
    prowlarrBaseUrl: '',
    prowlarrApiKey: '',
    cloudflareAccountId: '',
    cloudflareApiToken: '',
    cfAccessTargetMode: 'group' as 'policy' | 'group',
    cfAccessTargetId: '',
    cfAccessTeamDomain: '',
    cfAccessAud: '',
    adminEmailsRaw: '',
    deepseekBaseUrl: '',
    deepseekModel: '',
    deepseekApiKey: '',
    aiDailyTokenCap: 2500000,
    aiMonthlyBudgetUsd: 10
  });
  const [configSaving, setConfigSaving] = useState(false);
  const [configDiscovering, setConfigDiscovering] = useState(false);
  const [configBanner, setConfigBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [myRequests, setMyRequests] = useState<MyRequestItem[] | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Bienvenue dans ta salle **Askarr — Grand Cinéma & Séries** !\n\n' +
        'Installe-toi dans ton fauteuil, je m’occupe de la séance :\n' +
        '• **Retrouver un film ou une série** à partir d’un **réalisateur** (*Klapisch, Villeneuve...*), d’un **acteur** (*Pierre Niney...*), d’une **année**, d’un **souvenir d’intrigue** ou d’un **palmarès** (*Festival de Cannes / Palme d’Or, César, Oscars*).\n' +
        '• Vérifier **instantanément** s’il est à l’affiche sur nos serveurs **Plex** (*NucVillers* & *NucBuntu Cinéphile*) avec les **notes IMDb**.\n' +
        '• Regarder sa **date de sortie VOD / DVD** ou **le programmer sur Plex en 2 clics**.',
      createdAt: new Date().toISOString()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchSession();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function fetchSession() {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const data: UserSessionInfo = await res.json();
        setSession(data);
      }
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  }

  async function fetchMyRequests() {
    try {
      const res = await fetch('/api/requests/mine');
      if (res.ok) {
        const data: { items?: MyRequestItem[] } = await res.json();
        setMyRequests(Array.isArray(data.items) ? data.items : []);
      }
    } catch (err) {
      console.error('Failed to load user requests:', err);
    }
  }

  async function fetchTraces(service?: string) {
    try {
      const filter = service ?? traceServiceFilter;
      const qs = filter && filter !== 'all' ? `?service=${encodeURIComponent(filter)}&limit=120` : '?limit=120';
      const res = await fetch(`/api/admin/traces${qs}`);
      if (res.ok) {
        const data: { items?: ApiTraceEntryDTO[]; entries?: ApiTraceEntryDTO[] } = await res.json();
        const list = Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.entries)
            ? data.entries
            : [];
        setApiTraces(list);
      }
    } catch (err) {
      console.error('Failed to load API traces:', err);
    }
  }

  async function clearTraces() {
    try {
      await fetch('/api/admin/traces', { method: 'DELETE' });
      setApiTraces([]);
    } catch (err) {
      console.error('Failed to clear traces:', err);
    }
  }

  async function fetchSettings() {
    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const data: AdminSettingsDTO = await res.json();
        setAdminSettings(data);
        if (data.editableValues) {
          const ev = data.editableValues;
          setConfigForm((prev) => ({
            plexServersRaw: ev.plexServersRaw || prev.plexServersRaw,
            plexToken: '',
            overseerrBaseUrl: ev.overseerrBaseUrl || prev.overseerrBaseUrl,
            overseerrApiKey: '',
            radarrBaseUrl: ev.radarrBaseUrl || prev.radarrBaseUrl,
            radarrApiKey: '',
            sonarrBaseUrl: ev.sonarrBaseUrl || prev.sonarrBaseUrl,
            sonarrApiKey: '',
            prowlarrBaseUrl: ev.prowlarrBaseUrl || prev.prowlarrBaseUrl,
            prowlarrApiKey: '',
            cloudflareAccountId: ev.cloudflareAccountId || prev.cloudflareAccountId,
            cloudflareApiToken: '',
            cfAccessTargetMode: ev.cfAccessTargetMode || prev.cfAccessTargetMode,
            cfAccessTargetId: ev.cfAccessTargetId || prev.cfAccessTargetId,
            cfAccessTeamDomain: ev.cfAccessTeamDomain || prev.cfAccessTeamDomain,
            cfAccessAud: ev.cfAccessAud || prev.cfAccessAud,
            adminEmailsRaw: ev.adminEmailsRaw || prev.adminEmailsRaw,
            deepseekBaseUrl: ev.deepseekBaseUrl || prev.deepseekBaseUrl,
            deepseekModel: ev.deepseekModel || prev.deepseekModel,
            deepseekApiKey: '',
            aiDailyTokenCap: ev.aiDailyTokenCap || prev.aiDailyTokenCap,
            aiMonthlyBudgetUsd: ev.aiMonthlyBudgetUsd || prev.aiMonthlyBudgetUsd
          }));
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async function handleSaveRuntimeConfig(e: React.FormEvent) {
    e.preventDefault();
    setConfigSaving(true);
    setConfigBanner(null);
    try {
      const res = await fetch('/api/admin/settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configForm)
      });
      const data = await res.json();
      if (!res.ok) {
        setConfigBanner({
          type: 'error',
          text: data.message || 'Erreur lors de la sauvegarde de la configuration.'
        });
      } else {
        setConfigBanner({
          type: 'success',
          text:
            data.messageFr ||
            '✓ Configuration sauvegardée dans SQLite et rechargée à chaud sur tous les connecteurs !'
        });
        await Promise.all([fetchSettings(), fetchAdminStatus(), fetchSession()]);
      }
    } catch {
      setConfigBanner({ type: 'error', text: 'Erreur réseau lors de la sauvegarde.' });
    } finally {
      setConfigSaving(false);
    }
  }

  async function handleDiscoverPlexServers() {
    setConfigDiscovering(true);
    setConfigBanner(null);
    try {
      const res = await fetch('/api/admin/settings/discover-plex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plexToken: configForm.plexToken || undefined,
          autoApply: true
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setConfigBanner({
          type: 'error',
          text: data.message || 'Impossible de découvrir les serveurs via plex.tv.'
        });
      } else {
        if (data.plexServersRaw) {
          setConfigForm((prev) => ({ ...prev, plexServersRaw: data.plexServersRaw }));
        }
        const names = Array.isArray(data.discovered)
          ? data.discovered.map((s: { name: string; baseUrl: string }) => `${s.name} (${s.baseUrl})`).join(', ')
          : '';
        setConfigBanner({
          type: 'success',
          text: `🔍 ${data.discovered?.length || 0} serveur(s) Plex découverts sur plex.tv et activés à chaud : ${names}`
        });
        await Promise.all([fetchSettings(), fetchAdminStatus(), fetchSession()]);
      }
    } catch {
      setConfigBanner({ type: 'error', text: 'Erreur réseau lors de la découverte Plex.tv.' });
    } finally {
      setConfigDiscovering(false);
    }
  }

  async function handleTestService(serviceKey: string) {
    setTestingServiceKey(serviceKey);
    try {
      const res = await fetch('/api/admin/settings/test-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: serviceKey })
      });
      if (res.ok) {
        const data: { ok: boolean; latencyMs: number; detail: string } = await res.json();
        setServiceTestResults((prev) => ({ ...prev, [serviceKey]: data }));
        void fetchTraces();
      }
    } catch {
      setServiceTestResults((prev) => ({
        ...prev,
        [serviceKey]: { ok: false, latencyMs: 0, detail: 'Erreur réseau' }
      }));
    } finally {
      setTestingServiceKey(null);
    }
  }

  async function fetchAdminStatus() {
    try {
      const [hRes, bRes, cfRes] = await Promise.all([
        fetch('/api/admin/health'),
        fetch('/api/admin/ai-usage'),
        fetch('/api/admin/cloudflare/status')
      ]);
      if (hRes.ok) {
        setAdminHealth(await hRes.json());
      }
      if (bRes.ok) {
        setAiBudget(await bRes.json());
      }
      if (cfRes.ok) {
        const cfData: CloudflareAdminStatus = await cfRes.json();
        setCfStatus(cfData);
        if (cfData.smtp) {
          setSmtpForm((prev) => ({
            smtpHost: cfData.smtp!.smtpHost || 'smtp.gmail.com',
            smtpPort: cfData.smtp!.smtpPort || 465,
            smtpUser: cfData.smtp!.smtpUser || prev.smtpUser,
            smtpAppPassword: '',
            senderName: cfData.smtp!.senderName || 'Askarr · Grand Cinéma Plex',
            publicAppUrl: cfData.smtp!.publicAppUrl || prev.publicAppUrl
          }));
        }
      }
    } catch (err) {
      console.error('Failed to load admin status:', err);
    }
  }

  async function handleBootstrapCfPolicy() {
    setCfBusy(true);
    setCfBanner(null);
    try {
      const res = await fetch('/api/admin/cloudflare/bootstrap-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyName: 'askarr-allow-users', includeAllPlexFriends: true })
      });
      const data = await res.json();
      if (!res.ok) {
        setCfBanner({ type: 'error', text: data.message || 'Impossible de créer la policy.' });
      } else {
        setCfBanner({
          type: 'success',
          text: `Policy réutilisable "${data.targetName || 'askarr-allow-users'}" synchronisée avec les amis Plex !`
        });
        await fetchAdminStatus();
      }
    } catch {
      setCfBanner({ type: 'error', text: 'Erreur lors de la communication avec Cloudflare Access.' });
    } finally {
      setCfBusy(false);
    }
  }

  async function handleAddFriendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!newFriendEmail.trim() || cfBusy) return;
    setCfBusy(true);
    setCfBanner(null);
    try {
      const res = await fetch('/api/admin/cloudflare/emails/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newFriendEmail.trim(),
          overseerrUserId: selectedPlexUserId ? Number(selectedPlexUserId) : undefined,
          sendInviteEmail: sendInviteOnAdd,
          customMessage: customInviteNote.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setCfBanner({ type: 'error', text: data.message || "Erreur lors de l'ajout de l'email." });
      } else {
        setNewFriendEmail('');
        setSelectedPlexUserId('');
        const inviteTxt = data.inviteSent
          ? ' + Billet d’invitation VIP envoyé par email !'
          : data.inviteError
            ? ` (Email non envoyé : ${data.inviteError})`
            : '';
        setCfBanner({
          type: 'success',
          text: `Adresse ajoutée à Cloudflare Access (${data.targetName}) avec sauvegarde SQLite${inviteTxt}`
        });
        await fetchAdminStatus();
      }
    } catch {
      setCfBanner({ type: 'error', text: "Erreur réseau lors de l'ajout de l'email." });
    } finally {
      setCfBusy(false);
    }
  }

  async function handleQuickAuthorizePlexFriend(friend: PlexSharedUserDTO, withEmailInvite: boolean) {
    if (!friend.email || cfBusy) return;
    setCfBusy(true);
    setCfBanner(null);
    try {
      const res = await fetch('/api/admin/cloudflare/emails/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: friend.email,
          plexUserId: friend.plexUserId,
          overseerrUserId: friend.overseerrUserId ?? undefined,
          sendInviteEmail: withEmailInvite,
          customMessage: customInviteNote.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setCfBanner({ type: 'error', text: data.message || "Erreur lors de l'autorisation Cloudflare." });
      } else {
        const inviteTxt = data.inviteSent
          ? ' + Billet VIP envoyé par email !'
          : data.inviteError
            ? ` (Note SMTP : ${data.inviteError})`
            : '';
        setCfBanner({
          type: 'success',
          text: `${friend.title || friend.username} (${friend.email}) est maintenant autorisé dans Cloudflare Access${inviteTxt}`
        });
        await fetchAdminStatus();
      }
    } catch {
      setCfBanner({ type: 'error', text: "Erreur réseau lors de l'autorisation." });
    } finally {
      setCfBusy(false);
    }
  }

  async function handleBulkImportPlexFriends(emailsToImport: string[], sendInvites: boolean) {
    if (emailsToImport.length === 0 || cfBusy) return;
    setCfBusy(true);
    setCfBanner(null);
    try {
      const res = await fetch('/api/admin/cloudflare/emails/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: emailsToImport,
          sendInviteEmails: sendInvites,
          customMessage: customInviteNote.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setCfBanner({ type: 'error', text: data.message || "Erreur lors de l'import groupé." });
      } else {
        setCfBanner({
          type: 'success',
          text: `${data.addedCount} ami(s) Plex importés dans Cloudflare Access (${data.targetName})${
            data.invitesSentCount > 0 ? ` + ${data.invitesSentCount} billet(s) VIP envoyés !` : ' !'
          }`
        });
        await fetchAdminStatus();
      }
    } catch {
      setCfBanner({ type: 'error', text: "Erreur réseau lors de l'import groupé." });
    } finally {
      setCfBusy(false);
    }
  }

  async function handleSyncPlexUsers() {
    setCfBusy(true);
    setCfBanner(null);
    try {
      const res = await fetch('/api/admin/plex-users/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setCfBanner({
          type: 'success',
          text: `Annuaire Plex.tv rafraîchi : ${data.count} comptes amis synchronisés sur les 5 serveurs (NucVillers, NucBuntu, EQ12buntu, MacMini, Macmini4) !`
        });
        await fetchAdminStatus();
      }
    } catch {
      setCfBanner({ type: 'error', text: "Erreur lors de la synchronisation de l'annuaire Plex.tv." });
    } finally {
      setCfBusy(false);
    }
  }

  async function handleSendVipInvite(friend: {
    email: string;
    recipientName?: string;
    plexServers?: string[];
  }) {
    if (!friend.email || sendingInviteToEmail) return;
    setSendingInviteToEmail(friend.email);
    setCfBanner(null);
    try {
      const res = await fetch('/api/admin/cloudflare/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: friend.email,
          recipientName: friend.recipientName,
          plexServers: friend.plexServers,
          customMessage: customInviteNote.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setCfBanner({
          type: 'error',
          text: data.message || "Échec de l'envoi du Billet d'Invitation VIP."
        });
      } else {
        setCfBanner({
          type: 'success',
          text: `🎬 Billet d'Invitation VIP envoyé par email à ${friend.email} (${data.latencyMs} ms) !`
        });
      }
    } catch {
      setCfBanner({ type: 'error', text: "Erreur réseau lors de l'envoi de l'email VIP." });
    } finally {
      setSendingInviteToEmail(null);
    }
  }

  async function handleSaveSmtpSettings(e: React.FormEvent) {
    e.preventDefault();
    setSmtpSaving(true);
    setSmtpBanner(null);
    try {
      const res = await fetch('/api/admin/settings/smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(smtpForm)
      });
      const data = await res.json();
      if (!res.ok) {
        setSmtpBanner({ type: 'error', text: data.message || 'Erreur lors de la sauvegarde SMTP.' });
      } else {
        setSmtpForm((prev) => ({ ...prev, smtpAppPassword: '' }));
        setSmtpBanner({
          type: 'success',
          text: 'Configuration Google SMTP (App Password) sauvegardée dans SQLite !'
        });
        await fetchAdminStatus();
      }
    } catch {
      setSmtpBanner({ type: 'error', text: 'Erreur réseau lors de la sauvegarde SMTP.' });
    } finally {
      setSmtpSaving(false);
    }
  }

  async function handleTestSmtpEmail() {
    setSmtpTesting(true);
    setSmtpBanner(null);
    try {
      const res = await fetch('/api/admin/settings/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) {
        setSmtpBanner({ type: 'error', text: data.message || 'Échec du test SMTP.' });
      } else {
        setSmtpBanner({
          type: 'success',
          text: `Billet VIP de test envoyé avec succès à ${data.recipientEmail} (${data.latencyMs} ms) !`
        });
      }
    } catch {
      setSmtpBanner({ type: 'error', text: 'Erreur réseau lors du test SMTP.' });
    } finally {
      setSmtpTesting(false);
    }
  }

  async function handleRemoveFriendEmail(emailToRemove: string) {
    if (cfBusy) return;
    setCfBusy(true);
    setCfBanner(null);
    try {
      const res = await fetch('/api/admin/cloudflare/emails/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToRemove })
      });
      const data = await res.json();
      if (!res.ok) {
        setCfBanner({ type: 'error', text: data.message || 'Impossible de retirer cet email.' });
      } else {
        setCfBanner({
          type: 'success',
          text: `Adresse ${emailToRemove} retirée de Cloudflare Access.`
        });
        await fetchAdminStatus();
      }
    } catch {
      setCfBanner({ type: 'error', text: 'Erreur réseau.' });
    } finally {
      setCfBusy(false);
    }
  }

  async function handleRollbackRevision(revisionId: number) {
    if (cfBusy) return;
    setCfBusy(true);
    setCfBanner(null);
    try {
      const res = await fetch(`/api/admin/cloudflare/rollback/${revisionId}`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        setCfBanner({ type: 'error', text: data.message || 'Erreur lors de la restauration.' });
      } else {
        setCfBanner({
          type: 'success',
          text: `Révision #${revisionId} restaurée avec succès sur "${data.restoredTargetName}" !`
        });
        await fetchAdminStatus();
      }
    } catch {
      setCfBanner({ type: 'error', text: 'Erreur réseau lors du rollback.' });
    } finally {
      setCfBusy(false);
    }
  }

  async function fetchFeedbackStats() {
    try {
      const res = await fetch('/api/admin/feedback');
      if (res.ok) {
        const data: FeedbackStatsDTO = await res.json();
        setFeedbackStats(data);
      }
    } catch (err) {
      console.error('Failed to load feedback stats:', err);
    }
  }

  async function handleDeleteFeedback(id: number) {
    try {
      await fetch(`/api/admin/feedback/${id}`, { method: 'DELETE' });
      void fetchFeedbackStats();
    } catch (err) {
      console.error('Failed to delete feedback:', err);
    }
  }

  async function handleCopyFeedbackJson() {
    if (!feedbackStats) return;
    try {
      const exportPayload = feedbackStats.items.map((item) => ({
        rating: item.rating,
        quickTag: item.quickTag,
        userPrompt: item.userPrompt,
        comment: item.comment,
        assistantReplyExcerpt: item.assistantReply.slice(0, 280),
        mediaCardsSummary: item.mediaCardsSummary,
        createdAt: item.createdAt
      }));
      await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
      setCopiedFeedbackJson(true);
      setTimeout(() => setCopiedFeedbackJson(false), 2500);
    } catch {
      // ignore clipboard errors
    }
  }

  async function submitMessageFeedback(
    msg: UiMessage,
    ratingOverride?: number,
    tagOverride?: string,
    commentOverride?: string
  ) {
    const existing = ratingsByMsgId[msg.id] || {
      rating: 5,
      comment: '',
      issueTag: '',
      saved: false
    };
    const rating = ratingOverride ?? existing.rating;
    const issueTag = tagOverride ?? existing.issueTag;
    const comment = commentOverride ?? existing.comment;

    setRatingsByMsgId((prev) => ({
      ...prev,
      [msg.id]: {
        rating,
        issueTag,
        comment,
        saved: false,
        submitting: true
      }
    }));

    try {
      const res = await fetch('/api/chat/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          messageId: msg.id,
          userPrompt: msg.userPrompt || '',
          assistantReply: msg.content,
          rating,
          comment: comment.trim() || undefined,
          quickTag: issueTag || undefined,
          mediaCardsSummary: (msg.mediaCards || []).map((c) => ({
            tmdbId: c.identity.tmdbId,
            mediaType: c.identity.mediaType,
            titleFr: c.identity.titleFr,
            year: c.identity.year,
            plexState: c.catalogPresence.state
          }))
        })
      });

      if (res.ok) {
        setRatingsByMsgId((prev) => ({
          ...prev,
          [msg.id]: {
            rating,
            issueTag,
            comment,
            saved: true,
            submitting: false
          }
        }));
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      setRatingsByMsgId((prev) => ({
        ...prev,
        [msg.id]: {
          ...existing,
          rating,
          submitting: false
        }
      }));
    }
  }

  useEffect(() => {
    if (workspaceMode === 'user' && userTab === 'requests') {
      void fetchMyRequests();
    } else if (workspaceMode === 'admin') {
      if (adminTab === 'traces') {
        void fetchTraces();
      } else if (adminTab === 'feedback') {
        void fetchFeedbackStats();
      } else if (adminTab === 'settings') {
        void fetchSettings();
      } else if (adminTab === 'cloudflare' || adminTab === 'health') {
        void fetchAdminStatus();
      }
    }
  }, [workspaceMode, userTab, adminTab, traceServiceFilter]);

  async function sendMessage(textToSend?: string) {
    const query = (textToSend ?? input).trim();
    if (!query || loading) return;

    if (!textToSend) {
      setInput('');
    }

    const userMsg: UiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          conversationId
        })
      });

      if (!res.ok) {
        throw new Error(`Erreur serveur (${res.status})`);
      }

      const data: {
        conversationId: string;
        messageId?: string;
        reply: string;
        mediaCards: MediaEvidence[];
        provenance: ProvenanceEntry[];
        apiTraces?: ApiTraceEntryDTO[];
        llmUsage?: LlmTurnUsageDTO;
        aiMode: 'active' | 'direct_search_fallback';
      } = await res.json();

      setConversationId(data.conversationId);

      const assistantMsg: UiMessage = {
        id: data.messageId || `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        userPrompt: query,
        mediaCards: data.mediaCards,
        provenance: data.provenance,
        apiTraces: data.apiTraces,
        llmUsage: data.llmUsage,
        aiMode: data.aiMode,
        createdAt: new Date().toISOString()
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content:
            'Désolé, une erreur temporaire est survenue lors de la vérification des catalogues. Réessaie dans quelques secondes.',
          createdAt: new Date().toISOString()
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleAskSimilar(evidence: MediaEvidence) {
    void sendMessage(
      `Conseille-moi des titres similaires à "${evidence.identity.titleFr}" (${evidence.identity.year ?? ''}) avec leurs notes IMDb et leur disponibilité sur Plex`
    );
  }

  function startNewConversation() {
    setConversationId(undefined);
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        content:
          'Nouvelle séance ouverte ! Quel film, série, réalisateur ou palmarès (*Cannes, César, Oscars*) cherches-tu aujourd’hui ?',
        createdAt: new Date().toISOString()
      }
    ]);
  }

  const isAdmin = session?.role === 'admin';
  const showInlineDebug = isAdmin && debugOverlay;

  return (
    <div className="min-h-screen flex flex-col cinema-auditorium-bg text-stone-100">
      {/* Fronton de Cinéma (Architecture Navigation 2 Niveaux — État de l'Art) */}
      <header className="sticky top-0 z-30 border-b border-amber-500/25 bg-[#0c070a]/95 backdrop-blur-xl shadow-[0_10px_35px_rgba(0,0,0,0.85)]">
        {/* Rampe lumineuse d'ampoules de cinéma (Marquee Bulbs) */}
        <div className="h-1.5 w-full bg-gradient-to-r from-red-950 via-amber-500/30 to-red-950 cinema-marquee-bulbs opacity-90" />

        {/* NIVEAU 1 : Identité de la Salle (Gauche) • Sélecteur Salle Ciné / Régie (Centre) • Profil & Traces (Droite) */}
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3">
          {/* Gauche : Logo & Marque */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-red-600 via-red-800 to-amber-600 p-[1px] shadow-[0_0_20px_rgba(220,38,38,0.4)] shrink-0">
              <div className="w-full h-full rounded-xl bg-[#140a0e] flex items-center justify-center">
                <Clapperboard className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
              </div>
            </div>

            <div className="flex items-center gap-2.5 min-w-0">
              <h1 className="font-cinema text-2xl sm:text-3xl tracking-wider bg-gradient-to-b from-amber-100 via-amber-300 to-amber-500 bg-clip-text text-transparent leading-none">
                ASKARR
              </h1>
              <span className="hidden md:inline-flex font-cinema tracking-widest text-xs px-2.5 py-0.5 rounded-md bg-gradient-to-r from-red-900/90 to-red-800/80 text-amber-200 border border-amber-400/40 shadow-sm whitespace-nowrap">
                {workspaceMode === 'user' ? '🍿 GRAND CINÉMA' : '🎬 RÉGIE ADMIN'}
              </span>
            </div>
          </div>

          {/* Centre : Bascule Principale "Salle Ciné" vs "Régie Admin" */}
          {isAdmin && (
            <div className="flex items-center bg-stone-950/95 p-1 rounded-xl border border-amber-500/30 shadow-inner">
              <button
                type="button"
                onClick={() => setWorkspaceMode('user')}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap flex items-center gap-1.5 cursor-pointer transition-all ${
                  workspaceMode === 'user'
                    ? 'cinema-velvet-pill text-white shadow-sm'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>Salle Ciné</span>
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceMode('admin')}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap flex items-center gap-1.5 cursor-pointer transition-all ${
                  workspaceMode === 'admin'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                <Server className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>Régie Admin</span>
              </button>
            </div>
          )}

          {/* Droite : Bouton Traces (en Salle Ciné) + Profil Utilisateur & Serveurs Plex */}
          <div className="flex items-center gap-2.5 shrink-0">
            {isAdmin && workspaceMode === 'user' && (
              <button
                type="button"
                onClick={() => setDebugOverlay((v) => !v)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium border whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
                  debugOverlay
                    ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                    : 'bg-stone-900/90 text-stone-400 border-stone-800 hover:text-stone-200'
                }`}
                title="Afficher ou masquer les traces techniques sous les réponses du chat"
              >
                <Bug className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="hidden sm:inline">Traces :</span>
                <span className="font-bold">{debugOverlay ? 'ON' : 'OFF'}</span>
              </button>
            )}

            {session && (
              <div className="hidden sm:flex items-center gap-2 pl-2.5 border-l border-amber-500/20">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] shrink-0" />
                <div className="text-right">
                  <div className="text-xs sm:text-sm font-semibold text-amber-100 leading-tight">
                    {session.overseerr.plexUsername || session.email.split('@')[0]}
                  </div>
                  <div className="text-[11px] text-amber-300/90 leading-tight font-medium">
                    {session.plexAccess && session.plexAccess.askarrServerNames.length > 0
                      ? `Plex : ${session.plexAccess.askarrServerNames.join(' & ')}`
                      : session.overseerr.linked
                        ? 'Membre Ciné-Club Plex'
                        : 'Spectateur Invité'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* NIVEAU 2 : Barre de Sous-Navigation Pleine Largeur (Zéro troncature, tous les onglets visibles d'un coup d'œil) */}
        <div className="border-t border-amber-500/15 bg-black/55">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-1.5 flex items-center justify-between gap-3 overflow-x-auto no-scrollbar">
            {workspaceMode === 'user' ? (
              <>
                <nav className="flex items-center gap-1.5 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setUserTab('chat')}
                    className={`flex-1 sm:flex-initial justify-center px-3.5 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                      userTab === 'chat'
                        ? 'cinema-velvet-pill text-white shadow-sm'
                        : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900/60'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>Grand Écran & Ciné-Club</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUserTab('requests')}
                    className={`flex-1 sm:flex-initial justify-center px-3.5 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                      userTab === 'requests'
                        ? 'cinema-velvet-pill text-white shadow-sm'
                        : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900/60'
                    }`}
                  >
                    <Ticket className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>Mes Programmations</span>
                  </button>
                </nav>

                <div className="hidden lg:flex items-center gap-1.5 text-xs text-stone-400">
                  <span>5 Serveurs Plex :</span>
                  {['NucVillers', 'NucBuntu', 'EQ12buntu', 'MacMini', 'Macmini4'].map((srv) => (
                    <span
                      key={srv}
                      className={`px-2 py-0.5 rounded border font-medium ${
                        srv === 'NucBuntu'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      }`}
                    >
                      {srv}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <nav className="flex items-center gap-1.5 sm:gap-2 w-full">
                <button
                  type="button"
                  onClick={() => setAdminTab('cloudflare')}
                  className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                    adminTab === 'cloudflare'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-stone-300 hover:text-white hover:bg-stone-900/70'
                  }`}
                >
                  <Users className="w-4 h-4 shrink-0" />
                  <span>Utilisateurs Plex & VIP</span>
                  {cfStatus?.plexDirectory && cfStatus.plexDirectory.length > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[11px] font-mono ${
                        adminTab === 'cloudflare'
                          ? 'bg-black/30 text-amber-100'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {cfStatus.plexDirectory.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setAdminTab('health')}
                  className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                    adminTab === 'health'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-stone-300 hover:text-white hover:bg-stone-900/70'
                  }`}
                >
                  <Activity className="w-4 h-4 shrink-0" />
                  <span>Santé Projecteurs</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAdminTab('traces')}
                  className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                    adminTab === 'traces'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-stone-300 hover:text-white hover:bg-stone-900/70'
                  }`}
                >
                  <Terminal className="w-4 h-4 shrink-0" />
                  <span>Traceur API</span>
                  {apiTraces.length > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[11px] font-mono ${
                        adminTab === 'traces'
                          ? 'bg-black/30 text-amber-100'
                          : 'bg-stone-800 text-stone-300'
                      }`}
                    >
                      {apiTraces.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setAdminTab('feedback')}
                  className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                    adminTab === 'feedback'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-stone-300 hover:text-white hover:bg-stone-900/70'
                  }`}
                >
                  <Star className="w-4 h-4 shrink-0" />
                  <span>Notes Spectateurs</span>
                  {feedbackStats && feedbackStats.totalCount > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[11px] font-mono ${
                        adminTab === 'feedback'
                          ? 'bg-black/30 text-amber-100'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {feedbackStats.totalCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setAdminTab('settings')}
                  className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                    adminTab === 'settings'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-stone-300 hover:text-white hover:bg-stone-900/70'
                  }`}
                >
                  <Settings className="w-4 h-4 shrink-0" />
                  <span>Paramètres & Identités</span>
                </button>
              </nav>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col">
        {/* ========================================================= */}
        {/* ESPACE SALLE DE CINÉMA (AMI PLEX)                         */}
        {/* ========================================================= */}
        {workspaceMode === 'user' && userTab === 'chat' && (
          <div className="flex-1 flex flex-col gap-5 sm:gap-6">
            {/* Bandeau "À L'AFFICHE" — Suggestions de Séances (Swipeable sur iPhone, Grand Confort sur Desktop) */}
            <div className="flex items-center justify-between gap-2.5 bg-[#120b0e]/90 border border-amber-500/25 rounded-2xl p-2.5 sm:p-3.5 shadow-lg">
              <div className="flex items-center gap-2 overflow-x-auto flex-nowrap py-0.5 pr-1 no-scrollbar">
                {QUICK_PROMPTS.map((qp, idx) => {
                  const Icon = qp.icon;
                  return (
                    <button
                      key={idx}
                      onClick={() => void sendMessage(qp.prompt)}
                      disabled={loading}
                      className="text-xs sm:text-sm lg:text-[15px] font-medium bg-stone-950/90 hover:bg-red-950/60 active:scale-[0.99] text-stone-100 border border-amber-500/25 hover:border-amber-400/60 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
                    >
                      <Icon className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>{qp.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={startNewConversation}
                className="text-xs sm:text-sm font-semibold text-amber-200 hover:text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-red-950/60 hover:bg-red-900/70 border border-amber-500/30 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                title="Nouvelle séance"
              >
                <PlusCircle className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">Nouvelle séance</span>
              </button>
            </div>

            {/* Fil de Projection (Messages Utilisateur & Écran Assistant) */}
            <div className="flex-1 space-y-6 sm:space-y-7 overflow-y-auto">
              {messages.map((msg) => {
                const hasTrace = msg.apiTraces && msg.apiTraces.length > 0;
                const isTraceExpanded = expandedMsgTraceId === msg.id;
                const isWelcome = msg.id.startsWith('welcome');
                const ratingState = ratingsByMsgId[msg.id];
                const isDraftOpen = activeRatingDraftMsgId === msg.id;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`w-full sm:w-auto rounded-2xl relative overflow-hidden ${
                        msg.role === 'user'
                          ? 'cinema-velvet-pill text-white w-fit max-w-[92%] sm:max-w-2xl px-5 py-3.5 sm:px-6 sm:py-4 text-[15px] sm:text-base lg:text-[17px] leading-relaxed font-medium'
                          : 'cinema-screen-card max-w-4xl text-stone-100 px-5 py-4 sm:px-7 sm:py-6'
                      }`}
                    >
                      {/* Reflet supérieur de l'écran de cinéma pour les réponses de l'assistant */}
                      {msg.role === 'assistant' && (
                        <>
                          <div className="
                            absolute inset-x-0 top-0 h-[3px]
                            bg-gradient-to-r from-transparent via-amber-300/70 to-transparent
                          " />
                          <div className="mb-3 flex items-center justify-between gap-2 border-b border-amber-500/15 pb-2">
                            <div className="flex items-center gap-2">
                              <Film className="w-4 h-4 text-amber-400 shrink-0" />
                              <span className="font-cinema tracking-widest text-xs sm:text-sm text-amber-300 uppercase">
                                Projectionniste Askarr • Spécialiste 7e Art
                              </span>
                            </div>
                            <span className="text-[11px] sm:text-xs text-stone-400 font-mono">
                              Salle Plex HD/4K
                            </span>
                          </div>
                        </>
                      )}

                      {msg.aiMode === 'direct_search_fallback' && (
                        <div className="mb-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs sm:text-sm bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          <Search className="w-3.5 h-3.5" />
                          <span>Mode Recherche Directe (sans IA)</span>
                        </div>
                      )}

                      {msg.role === 'assistant' ? (
                        <RichMarkdownText text={msg.content} />
                      ) : (
                        <div className="whitespace-pre-line">{msg.content}</div>
                      )}

                      {/* Barre de Note Spectateur / Critique (1 à 5 étoiles) */}
                      {msg.role === 'assistant' && !isWelcome && (
                        <div className="mt-4 sm:mt-5 pt-3.5 border-t border-amber-500/20 flex flex-col gap-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-1.5 sm:gap-2">
                              <span className="text-xs sm:text-sm font-medium text-amber-200/80 mr-1">
                                Note cette séance :
                              </span>
                              {[1, 2, 3, 4, 5].map((star) => {
                                const active = (ratingState?.rating ?? 0) >= star;
                                return (
                                  <button
                                    key={star}
                                    type="button"
                                    onClick={() => {
                                      setActiveRatingDraftMsgId(msg.id);
                                      void submitMessageFeedback(msg, star);
                                    }}
                                    className={`p-1 rounded-lg transition-transform active:scale-110 cursor-pointer ${
                                      active
                                        ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]'
                                        : 'text-stone-600 hover:text-amber-300/70'
                                    }`}
                                    title={`Noter ${star}/5`}
                                  >
                                    <Star
                                      className={`w-4.5 h-4.5 sm:w-5 sm:h-5 ${active ? 'fill-amber-400' : ''}`}
                                    />
                                  </button>
                                );
                              })}
                              {ratingState?.saved && (
                                <span className="text-xs sm:text-sm text-emerald-400 font-semibold ml-1.5 flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>{ratingState.rating}/5 enregistré</span>
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                setActiveRatingDraftMsgId(isDraftOpen ? null : msg.id)
                              }
                              className="text-xs sm:text-sm text-stone-300 hover:text-amber-300 flex items-center gap-1.5 cursor-pointer"
                            >
                              <MessageSquarePlus className="w-4 h-4 text-amber-400" />
                              <span>
                                {ratingState?.comment || ratingState?.issueTag
                                  ? 'Modifier ma critique'
                                  : 'Ajouter une remarque'}
                              </span>
                            </button>
                          </div>

                          {/* Tiroir de tags rapides + commentaire libre */}
                          {isDraftOpen && (
                            <div className="p-3 sm:p-4 rounded-xl bg-black/75 border border-amber-500/25 space-y-3">
                              <div className="flex flex-wrap gap-2">
                                {FEEDBACK_QUICK_TAGS.map((tag) => {
                                  const selected = ratingState?.issueTag === tag;
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() =>
                                        void submitMessageFeedback(
                                          msg,
                                          ratingState?.rating || 4,
                                          selected ? '' : tag
                                        )
                                      }
                                      className={`px-3 py-1 rounded-lg text-xs sm:text-sm font-medium border cursor-pointer transition-colors ${
                                        selected
                                          ? 'bg-red-900/60 text-amber-200 border-amber-400/70'
                                          : 'bg-stone-900 text-stone-300 border-stone-800 hover:text-white'
                                      }`}
                                    >
                                      {tag}
                                    </button>
                                  );
                                })}
                              </div>

                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={ratingState?.comment ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setRatingsByMsgId((prev) => ({
                                      ...prev,
                                      [msg.id]: {
                                        rating: prev[msg.id]?.rating || 4,
                                        issueTag: prev[msg.id]?.issueTag || '',
                                        comment: val,
                                        saved: false
                                      }
                                    }));
                                  }}
                                  placeholder="Un détail pour améliorer le projectionniste ? (ex: il manquait tel film...)"
                                  className="flex-1 rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-xs sm:text-sm text-white placeholder-stone-500 focus:outline-none focus:border-amber-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    void submitMessageFeedback(msg);
                                    setActiveRatingDraftMsgId(null);
                                  }}
                                  className="px-4 py-2 rounded-xl cinema-velvet-pill text-white text-xs sm:text-sm font-bold cursor-pointer shrink-0"
                                >
                                  Envoyer
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tiroir Technique Admin par Message */}
                      {showInlineDebug && msg.role === 'assistant' && (hasTrace || msg.llmUsage) && (
                        <div className="mt-3 pt-2.5 border-t border-amber-500/20">
                          <div className="flex flex-wrap items-center gap-2">
                            {hasTrace && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedMsgTraceId(isTraceExpanded ? null : msg.id)
                                }
                                className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-300 hover:text-amber-200 bg-amber-950/40 border border-amber-500/35 px-3 py-1.5 rounded-lg cursor-pointer"
                              >
                                <Bug className="w-3.5 h-3.5" />
                                <span>
                                  Trace Régie : {msg.apiTraces!.length} appels API (
                                  {Array.from(new Set(msg.apiTraces!.map((t) => t.service))).join(', ')})
                                </span>
                                {isTraceExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}

                            {msg.llmUsage && (
                              <span
                                className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-500/35 px-3 py-1.5 rounded-lg"
                                title={`Prompt: ${msg.llmUsage.promptTokens} tok (Cache Hit: ${msg.llmUsage.cacheHitTokens}, Miss: ${msg.llmUsage.cacheMissTokens}) • Réponse: ${msg.llmUsage.completionTokens} tok • ${msg.llmUsage.toolRounds} round(s) d'outils`}
                              >
                                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                <span>
                                  Coût DeepSeek : ${msg.llmUsage.estimatedCostUsd.toFixed(5)} (~
                                  {(msg.llmUsage.estimatedCostUsd * 100).toFixed(3)} ¢) •{' '}
                                  {msg.llmUsage.totalTokens.toLocaleString('fr-FR')} tok (
                                  {msg.llmUsage.promptTokens > 0
                                    ? Math.round(
                                        (msg.llmUsage.cacheHitTokens / msg.llmUsage.promptTokens) * 100
                                      )
                                    : 0}
                                  % cache)
                                </span>
                              </span>
                            )}
                          </div>

                          {isTraceExpanded && (
                            <div className="mt-2.5 space-y-2 max-h-80 overflow-y-auto rounded-xl bg-black/90 border border-stone-800 p-3 text-xs font-mono">
                              {msg.apiTraces!.map((tr) => (
                                <div
                                  key={tr.id}
                                  className="p-2.5 rounded-lg bg-stone-900/90 border border-stone-800 space-y-1.5"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span
                                        className={`px-2 py-0.5 rounded border text-[10px] uppercase font-bold ${serviceBadgeColor(
                                          tr.service
                                        )}`}
                                      >
                                        {tr.serverLabel || tr.service}
                                      </span>
                                      <span className="font-bold text-stone-200">{tr.method}</span>
                                      <span className="text-stone-300 truncate max-w-md" title={tr.url}>
                                        {tr.url}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span
                                        className={
                                          tr.ok ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                                        }
                                      >
                                        HTTP {tr.statusCode ?? 'ERR'}
                                      </span>
                                      <span className="text-amber-300">{tr.latencyMs} ms</span>
                                    </div>
                                  </div>
                                  {tr.responseSummary && (
                                    <pre className="text-[11px] text-stone-400 overflow-x-auto bg-black p-2 rounded border border-stone-800 max-h-32">
                                      {tr.responseSummary}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Affiches de Films & Fiches Distributeur */}
                    {msg.mediaCards && msg.mediaCards.length > 0 && (
                      <div className="mt-4 sm:mt-5 w-full grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                        {msg.mediaCards.map((cand) => (
                          <MediaCandidateCard
                            key={`${cand.identity.mediaType}-${cand.identity.tmdbId}-${cand.identity.titleFr}`}
                            evidence={cand}
                            onAskSimilar={handleAskSimilar}
                            showTechnicalTrace={showInlineDebug}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {loading && (
                <div className="flex items-center gap-3.5 text-amber-100 cinema-screen-card rounded-2xl px-5 py-4 w-fit">
                  <RefreshCw className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-sm sm:text-base font-medium">
                    Projecteur en marche : recherche cinéma & vérification des salles Plex (`NucVillers` & `NucBuntu`)...
                  </span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Guichet de Recherche en bas de l'écran */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
              className="sticky bottom-2 sm:bottom-4 bg-[#120a0d]/95 border border-amber-500/35 rounded-2xl p-2 sm:p-2.5 shadow-[0_15px_50px_rgba(0,0,0,0.9)] backdrop-blur-xl flex items-center gap-2 sm:gap-3"
            >
              <div className="pl-3 text-amber-400 hidden sm:block">
                <Clapperboard className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Un film, un réalisateur, un acteur, une intrigue ou un palmarès de Cannes..."
                className="flex-1 bg-transparent text-base lg:text-lg text-white placeholder-stone-400 focus:outline-none py-2.5 sm:py-3 px-2.5"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="cinema-velvet-pill hover:brightness-110 active:scale-95 disabled:opacity-40 text-white font-bold text-sm sm:text-base px-4 sm:px-6 py-3 rounded-xl transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                <span className="hidden sm:inline">Lancer la séance</span>
                <Send className="w-4 h-4 sm:w-5 sm:h-5 text-amber-200" />
              </button>
            </form>
          </div>
        )}

        {workspaceMode === 'user' && userTab === 'requests' && (
          <div className="space-y-6">
            <div className="cinema-screen-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5">
                    <Ticket className="w-6 h-6 text-amber-400" />
                    <span>Mes Programmations & Liste d’attente Salle Plex</span>
                  </h2>
                  <p className="text-sm text-stone-300 mt-1">
                    Retrouve ici les films et séries récemment programmés et leur statut de téléchargement en temps réel.
                  </p>
                </div>
                <button
                  onClick={() => void fetchMyRequests()}
                  className="text-xs sm:text-sm bg-stone-900 hover:bg-stone-800 border border-amber-500/30 text-amber-200 px-4 py-2.5 rounded-xl flex items-center gap-2 cursor-pointer font-semibold"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Actualiser</span>
                </button>
              </div>

              {!myRequests ? (
                <p className="text-sm sm:text-base text-stone-400">Chargement des programmations...</p>
              ) : myRequests.length === 0 ? (
                <p className="text-sm sm:text-base text-stone-400">Aucune demande récente trouvée.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {myRequests.map((req) => (
                    <MediaCandidateCard
                      key={req.requestId}
                      evidence={req.evidence}
                      onAskSimilar={handleAskSimilar}
                      showTechnicalTrace={showInlineDebug}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* CONSOLE ADMIN : 1. TRACEUR API LIVE                       */}
        {/* ========================================================= */}
        {workspaceMode === 'admin' && adminTab === 'traces' && (
          <div className="space-y-5">
            <div className="cinema-screen-card rounded-2xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-amber-400" />
                    <span>Traceur Technique d’Appels API (Radarr, Sonarr, Overseerr, Plex, DeepSeek)</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-stone-400 mt-1">
                    Inspecte chaque requête HTTP sortante du backend avec sa latence, son code HTTP et le payload JSON reçu (clés API automatiquement masquées).
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void fetchTraces()}
                    className="text-xs sm:text-sm cinema-velvet-pill text-white px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer font-semibold"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Rafraîchir</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearTraces()}
                    className="text-xs sm:text-sm bg-stone-900 hover:bg-stone-800 border border-stone-700 text-rose-300 px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Vider</span>
                  </button>
                </div>
              </div>

              {/* Filter pills by service */}
              <div className="flex flex-wrap items-center gap-2 mb-5">
                {[
                  { id: 'all', label: 'Tous les services' },
                  { id: 'radarr', label: 'Radarr' },
                  { id: 'sonarr', label: 'Sonarr' },
                  { id: 'overseerr', label: 'Overseerr' },
                  { id: 'plex', label: 'Plex (NucVillers & NucBuntu)' },
                  { id: 'prowlarr', label: 'Prowlarr' },
                  { id: 'deepseek', label: 'DeepSeek IA' },
                  { id: 'cloudflare', label: 'Cloudflare Access' }
                ].map((srv) => (
                  <button
                    key={srv.id}
                    type="button"
                    onClick={() => setTraceServiceFilter(srv.id)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold border transition-colors cursor-pointer ${
                      traceServiceFilter === srv.id
                        ? 'bg-amber-600 text-white border-amber-500'
                        : 'bg-black/60 text-stone-400 border-stone-800 hover:text-stone-200'
                    }`}
                  >
                    {srv.label}
                  </button>
                ))}
              </div>

              {apiTraces.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-black/60 border border-stone-800 text-sm text-stone-400">
                  Aucun appel API enregistré pour ce filtre. Lance une recherche dans la Salle Ciné ou clique sur « Tester » dans l’onglet Paramètres.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[65vh] overflow-y-auto pr-1">
                  {apiTraces.map((tr) => {
                    const isOpen = !!expandedTraceIds[tr.id];
                    return (
                      <div
                        key={tr.id}
                        className="rounded-xl bg-black/75 border border-stone-800 p-3.5 text-xs sm:text-sm font-mono"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span
                              className={`px-2 py-0.5 rounded border text-[11px] uppercase font-bold shrink-0 ${serviceBadgeColor(
                                tr.service
                              )}`}
                            >
                              {tr.service}
                            </span>
                            <span className="font-bold text-stone-200 shrink-0">{tr.method}</span>
                            <span className="text-stone-300 break-all">{tr.url}</span>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-bold ${
                                tr.ok
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              HTTP {tr.statusCode ?? 'ERR'}
                            </span>
                            <span className="text-amber-300">{tr.latencyMs} ms</span>
                            <span className="text-stone-500 text-xs">
                              {new Date(tr.timestamp).toLocaleTimeString('fr-FR')}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedTraceIds((prev) => ({ ...prev, [tr.id]: !isOpen }))
                              }
                              className="px-2.5 py-1 rounded bg-stone-900 hover:bg-stone-800 text-stone-300 border border-stone-700 cursor-pointer flex items-center gap-1"
                            >
                              <span>Payload</span>
                              {isOpen ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="mt-3 pt-3 border-t border-stone-800 grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <div>
                              <div className="text-xs uppercase tracking-wider text-stone-400 mb-1">
                                Requête envoyée (Body / Params) :
                              </div>
                              <pre className="p-3 rounded-lg bg-stone-950 border border-stone-800 text-xs text-stone-300 overflow-x-auto max-h-60">
                                {tr.requestSummary || '(Requête GET sans body)'}
                              </pre>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-wider text-stone-400 mb-1">
                                Réponse reçue ({tr.serverLabel || tr.service}) :
                              </div>
                              <pre className="p-3 rounded-lg bg-stone-950 border border-stone-800 text-xs text-emerald-200/90 overflow-x-auto max-h-60">
                                {tr.responseSummary || tr.error || '(Réponse vide)'}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* CONSOLE ADMIN : 1B. AVIS & NOTES IA (FEEDBACK SQLITE)     */}
        {/* ========================================================= */}
        {workspaceMode === 'admin' && adminTab === 'feedback' && (
          <div className="space-y-5">
            <div className="cinema-screen-card rounded-2xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
                    <span>Critiques & Notes Spectateurs sur les Réponses IA</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-stone-400 mt-1">
                    Consulte toutes les notes (`1 à 5 ★`), tags de problème et commentaires laissés sur les réponses d’Askarr. Stocké dans SQLite (`response_feedback`) pour affiner le prompt et le code.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyFeedbackJson()}
                    className="text-xs sm:text-sm bg-amber-600/20 hover:bg-amber-600/30 text-amber-200 border border-amber-500/40 px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer font-semibold"
                  >
                    {copiedFeedbackJson ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>Copié dans le presse-papier !</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copier JSON pour amélioration code</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void fetchFeedbackStats()}
                    className="text-xs sm:text-sm cinema-velvet-pill text-white px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer font-semibold"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Rafraîchir</span>
                  </button>
                </div>
              </div>

              {!feedbackStats ? (
                <p className="text-sm text-stone-400">Chargement des critiques utilisateurs...</p>
              ) : (
                <div className="space-y-5">
                  {/* KPI Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 text-xs sm:text-sm">
                    <div className="p-4 rounded-xl bg-black/75 border border-stone-800">
                      <div className="text-stone-400">Note Moyenne Globale</div>
                      <div className="text-2xl font-bold text-amber-400 mt-1 flex items-center gap-1.5">
                        <span>{feedbackStats.averageRating > 0 ? `${feedbackStats.averageRating} / 5` : '—'}</span>
                        <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
                      </div>
                    </div>
                    <div className="p-4 rounded-xl bg-black/75 border border-stone-800">
                      <div className="text-stone-400">Total Séances Notées</div>
                      <div className="text-2xl font-bold text-white mt-1">
                        {feedbackStats.totalCount}
                      </div>
                    </div>
                    <div className="p-4 rounded-xl bg-black/75 border border-stone-800">
                      <div className="text-stone-400">Séances Excellentes (4-5 ★)</div>
                      <div className="text-2xl font-bold text-emerald-400 mt-1">
                        {Math.max(0, feedbackStats.totalCount - feedbackStats.lowRatingCount)}
                      </div>
                    </div>
                    <div className="p-4 rounded-xl bg-black/75 border border-stone-800">
                      <div className="text-stone-400">À retravailler (1-3 ★)</div>
                      <div className="text-2xl font-bold text-rose-400 mt-1">
                        {feedbackStats.lowRatingCount}
                      </div>
                    </div>
                  </div>

                  {feedbackStats.items.length === 0 ? (
                    <div className="p-8 text-center rounded-xl bg-black/60 border border-stone-800 text-sm text-stone-400">
                      Aucune note enregistrée pour l’instant. Clique sur les étoiles ★ sous une réponse dans la Salle Ciné pour noter une interaction !
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                      {feedbackStats.items.map((item) => (
                        <div
                          key={item.id}
                          className="p-4 rounded-xl bg-black/75 border border-stone-800 space-y-2.5 text-xs sm:text-sm"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 ${
                                  item.rating >= 4
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                    : item.rating === 3
                                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                      : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                <span>{item.rating} / 5 ★</span>
                              </span>
                              {item.quickTag && (
                                <span className="px-2.5 py-0.5 rounded-lg bg-red-900/40 text-amber-200 border border-amber-500/40 font-medium">
                                  {item.quickTag}
                                </span>
                              )}
                              <span className="text-stone-400">
                                par <span className="text-stone-200 font-mono">{item.userEmail}</span>
                              </span>
                              <span className="text-stone-500">
                                • {item.mediaCardsSummary.length} affiche(s) • {new Date(item.createdAt).toLocaleString('fr-FR')}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => void handleDeleteFeedback(item.id)}
                              className="text-rose-400 hover:text-rose-300 p-1 cursor-pointer"
                              title="Supprimer cet avis"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {item.userPrompt && (
                            <div className="p-3 rounded-lg bg-stone-900 border border-stone-800">
                              <span className="text-amber-300 font-semibold">Question posée : </span>
                              <span className="text-white">{item.userPrompt}</span>
                            </div>
                          )}

                          {item.comment && (
                            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-amber-200">
                              <span className="font-semibold">Commentaire utilisateur : </span>
                              <span>{item.comment}</span>
                            </div>
                          )}

                          <details className="text-stone-400">
                            <summary className="cursor-pointer hover:text-stone-200 font-medium">
                              Voir la réponse de l’assistant
                            </summary>
                            <div className="mt-2 p-3 rounded-lg bg-stone-900/70 border border-stone-800 whitespace-pre-line text-stone-200">
                              {item.assistantReply}
                            </div>
                          </details>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* CONSOLE ADMIN : 2. PARAMÈTRES (SETTINGS & TESTS LIVE)     */}
        {/* ========================================================= */}
        {workspaceMode === 'admin' && adminTab === 'settings' && (
          <div className="space-y-6">
            <div className="cinema-screen-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <Settings className="w-5 h-5 text-amber-400" />
                    <span>Paramètres des Connecteurs & Tests d’API en Direct</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-stone-400 mt-1">
                    Vérifie la configuration active (`.env`) de chaque composant Homelab et lance un test unitaire en direct (chaque test est aussi visible dans le Traceur API).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchSettings()}
                  className="text-xs sm:text-sm bg-stone-900 hover:bg-stone-800 border border-amber-500/30 text-amber-200 px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer font-semibold"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Actualiser</span>
                </button>
              </div>

              {!adminSettings ? (
                <p className="text-sm text-stone-400">Chargement de la configuration...</p>
              ) : (
                <div className="space-y-6">
                  {/* Grid of connectors with Test buttons */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      {
                        key: 'plex',
                        title: 'Fédération Multi-Plex (NucVillers & NucBuntu)',
                        url: adminSettings.connectors.plexServers.map((s) => `${s.name} (${s.baseUrl})`).join(' + '),
                        configured: adminSettings.connectors.plexServers.every((s) => s.configured),
                        meta: `${adminSettings.connectors.plexServers.length} serveurs PMS configurés`
                      },
                      {
                        key: 'overseerr',
                        title: 'Overseerr (Catalogue TMDB & Demandes)',
                        url: adminSettings.connectors.overseerr.baseUrl,
                        configured: adminSettings.connectors.overseerr.configured,
                        meta: 'API v1 (/api/v1/search, /request, /user)'
                      },
                      {
                        key: 'radarr',
                        title: 'Radarr (Films & Monitoring)',
                        url: adminSettings.connectors.radarr.baseUrl,
                        configured: adminSettings.connectors.radarr.configured,
                        meta: 'API v3 (/api/v3/movie, /queue, /diskspace)'
                      },
                      {
                        key: 'sonarr',
                        title: 'Sonarr (Séries & Épisodes)',
                        url: adminSettings.connectors.sonarr.baseUrl,
                        configured: adminSettings.connectors.sonarr.configured,
                        meta: 'API v3 (/api/v3/series, /queue)'
                      },
                      {
                        key: 'prowlarr',
                        title: 'Prowlarr (Indexeurs Torrents/Usenet)',
                        url: adminSettings.connectors.prowlarr.baseUrl,
                        configured: adminSettings.connectors.prowlarr.configured,
                        meta: 'API v1 (/api/v1/indexerstatus)'
                      },
                      {
                        key: 'deepseek',
                        title: 'DeepSeek AI (LLM Copilot & Conseils)',
                        url: `${adminSettings.connectors.deepseek.baseUrl} (${adminSettings.connectors.deepseek.model})`,
                        configured: adminSettings.connectors.deepseek.configured,
                        meta: adminSettings.connectors.deepseek.accountBalance?.available
                          ? `Solde restant : ${adminSettings.connectors.deepseek.accountBalance.totalBalance} ${adminSettings.connectors.deepseek.accountBalance.currency} • Coût moyen : ~$${(adminSettings.connectors.deepseek.usageStats?.averageCostPerRequestUsd ?? 0.00135).toFixed(4)}/req`
                          : `Plafond: ${adminSettings.connectors.deepseek.dailyTokenCap.toLocaleString('fr-FR')} tokens/j • Budget: $${adminSettings.connectors.deepseek.monthlyBudgetUsd}/mois`
                      },
                      {
                        key: 'cloudflare',
                        title: 'Cloudflare Zero Trust Access',
                        url: adminSettings.auth.cfAccessTeamDomain || 'Non défini',
                        configured: adminSettings.connectors.cloudflareAccess.apiTokenConfigured,
                        meta: `Mode: ${adminSettings.connectors.cloudflareAccess.targetMode} • ID: ${adminSettings.connectors.cloudflareAccess.targetId || 'auto'}`
                      }
                    ].map((srv) => {
                      const testRes = serviceTestResults[srv.key];
                      const isTesting = testingServiceKey === srv.key;
                      return (
                        <div
                          key={srv.key}
                          className="p-4 rounded-xl bg-black/70 border border-stone-800 flex flex-col justify-between gap-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-sm sm:text-base text-white">{srv.title}</span>
                              <span
                                className={`text-xs px-2.5 py-0.5 rounded-full border ${
                                  srv.configured
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                }`}
                              >
                                {srv.configured ? 'Clé API active' : 'Clé manquante'}
                              </span>
                            </div>
                            <div className="text-xs sm:text-sm font-mono text-amber-300 break-all">{srv.url}</div>
                            <div className="text-xs text-stone-400">{srv.meta}</div>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-stone-800">
                            {testRes ? (
                              <div
                                className={`text-xs sm:text-sm flex items-center gap-1.5 ${
                                  testRes.ok ? 'text-emerald-300' : 'text-rose-300'
                                }`}
                              >
                                {testRes.ok ? (
                                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                                ) : (
                                  <XCircle className="w-4 h-4 shrink-0" />
                                )}
                                <span>
                                  {testRes.detail} ({testRes.latencyMs} ms)
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-stone-500">
                                Prêt pour test de connectivité
                              </span>
                            )}

                            <button
                              type="button"
                              disabled={isTesting}
                              onClick={() => void handleTestService(srv.key)}
                              className="px-3.5 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 border border-amber-500/30 text-xs sm:text-sm font-semibold text-white flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
                            >
                              <Play className="w-3.5 h-3.5 text-amber-400" />
                              <span>{isTesting ? 'Test...' : 'Tester API'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Cockpit Financier DeepSeek IA — Solde du Compte & Coût par Requête */}
                  {adminSettings.connectors.deepseek && (() => {
                    const ds = adminSettings.connectors.deepseek;
                    const bal = ds.accountBalance;
                    const stats = ds.usageStats;
                    const avgCostUsd = stats?.averageCostPerRequestUsd ?? 0.00135;
                    const balanceNum = bal ? parseFloat(bal.totalBalance) : 0;
                    const estimatedRemainingRequests =
                      balanceNum > 0 && avgCostUsd > 0 ? Math.floor(balanceNum / avgCostUsd) : null;
                    const requestsPerDollar = avgCostUsd > 0 ? Math.floor(1 / avgCostUsd) : 740;

                    return (
                      <div className="p-5 rounded-2xl bg-black/75 border border-amber-500/35 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                              <Sparkles className="w-5 h-5 text-amber-400" />
                              <span>Cockpit Financier DeepSeek IA — Solde du Compte & Coût par Requête</span>
                            </h3>
                            <p className="text-xs sm:text-sm text-stone-400 mt-0.5">
                              Solde récupéré en direct sur <code className="text-amber-300">GET /user/balance</code> et chiffrage exact par requête selon le tarif officiel DeepSeek (<code className="text-emerald-300">Cache Hit -90%</code>).
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await fetch('/api/admin/ai-usage/reset-daily', { method: 'POST' });
                                await fetchSettings();
                                await fetchAdminStatus();
                                await fetchSession();
                              }}
                              className="px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 border border-amber-500/40 text-amber-200 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Remettre compteur jour à 0</span>
                            </button>
                          </div>
                        </div>

                        {/* 4 KPI Cards : Solde restant, Coût moyen/req, Autonomie estimée, Consommation Mois */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs sm:text-sm">
                          <div className="p-4 rounded-xl bg-stone-950/90 border border-emerald-500/35">
                            <div className="text-stone-400">Solde restant Compte DeepSeek</div>
                            <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                              {bal?.available
                                ? `${bal.totalBalance} ${bal.currency}`
                                : bal?.error || 'Indisponible'}
                            </div>
                            {bal?.available && (
                              <div className="text-[11px] text-stone-400 mt-1 font-mono">
                                Rechargé : {bal.toppedUpBalance} {bal.currency} • Offert : {bal.grantedBalance}{' '}
                                {bal.currency}
                              </div>
                            )}
                          </div>

                          <div className="p-4 rounded-xl bg-stone-950/90 border border-amber-500/30">
                            <div className="text-stone-400">Coût moyen par requête IA</div>
                            <div className="text-2xl font-bold font-mono text-amber-300 mt-1">
                              ${avgCostUsd.toFixed(5)}
                            </div>
                            <div className="text-[11px] text-stone-400 mt-1">
                              Soit ~{(avgCostUsd * 100).toFixed(2)} centime/req (~{requestsPerDollar.toLocaleString('fr-FR')} req pour 1 $)
                            </div>
                          </div>

                          <div className="p-4 rounded-xl bg-stone-950/90 border border-stone-800">
                            <div className="text-stone-400">Autonomie estimée du solde</div>
                            <div className="text-2xl font-bold font-mono text-white mt-1">
                              {estimatedRemainingRequests !== null
                                ? `~${estimatedRemainingRequests.toLocaleString('fr-FR')} req.`
                                : '—'}
                            </div>
                            <div className="text-[11px] text-stone-400 mt-1">
                              Moyenne : ~{(stats?.averageTokensPerRequest ?? 7800).toLocaleString('fr-FR')} tokens / requête
                            </div>
                          </div>

                          <div className="p-4 rounded-xl bg-stone-950/90 border border-stone-800">
                            <div className="text-stone-400">Dépensé ce mois-ci ({stats?.totalCallsCount ?? 0} req.)</div>
                            <div className="text-2xl font-bold font-mono text-stone-100 mt-1">
                              ${(stats?.monthlyCostUsd ?? 0).toFixed(4)}
                            </div>
                            <div className="text-[11px] text-emerald-300 mt-1 font-mono">
                              Cache Hit Prompt : {(stats?.cacheHitRatioPercent ?? 0).toFixed(1)}% • Aujourd’hui :{' '}
                              {(stats?.dailyTokensUsed ?? 0).toLocaleString('fr-FR')} tok
                            </div>
                          </div>
                        </div>

                        {/* Grille tarifaire DeepSeek active */}
                        {ds.pricing && (
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-stone-950/80 border border-stone-800 text-xs text-stone-300 font-mono">
                            <span>
                              Tarif <strong className="text-amber-300">{ds.model}</strong> :
                            </span>
                            <span>
                              Input Cache Hit : <strong className="text-emerald-300">${ds.pricing.inputCacheHitPer1M}/1M tok</strong> (-90%)
                            </span>
                            <span>
                              Input Cache Miss : <strong className="text-stone-200">${ds.pricing.inputCacheMissPer1M}/1M tok</strong>
                            </span>
                            <span>
                              Output (Réponse) : <strong className="text-amber-200">${ds.pricing.outputPer1M}/1M tok</strong>
                            </span>
                          </div>
                        )}

                        {/* Historique des dernières requêtes avec coût unitaire */}
                        {stats?.recentCalls && stats.recentCalls.length > 0 && (
                          <details className="group">
                            <summary className="cursor-pointer text-xs sm:text-sm font-semibold text-amber-300 hover:text-amber-200 flex items-center gap-1.5">
                              <span>
                                Voir le détail chiffré des {stats.recentCalls.length} dernières requêtes IA
                              </span>
                              <ChevronDown className="w-4 h-4" />
                            </summary>
                            <div className="mt-3 overflow-x-auto rounded-xl border border-stone-800 bg-stone-950/90">
                              <table className="w-full text-left text-xs font-mono">
                                <thead className="bg-stone-900/90 text-stone-400 border-b border-stone-800">
                                  <tr>
                                    <th className="py-2 px-3">Heure</th>
                                    <th className="py-2 px-3">Utilisateur</th>
                                    <th className="py-2 px-3">Outils</th>
                                    <th className="py-2 px-3">Tokens (Hit / Miss / Out)</th>
                                    <th className="py-2 px-3">Latence</th>
                                    <th className="py-2 px-3 text-right">Coût Requête</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-900">
                                  {stats.recentCalls.map((call) => (
                                    <tr key={call.id} className="hover:bg-stone-900/40">
                                      <td className="py-2 px-3 text-stone-400">
                                        {new Date(call.timestamp).toLocaleTimeString('fr-FR')}
                                      </td>
                                      <td className="py-2 px-3 text-stone-200 truncate max-w-[160px]">
                                        {call.userEmail}
                                      </td>
                                      <td className="py-2 px-3 text-stone-300">
                                        {call.fallbackUsed ? (
                                          <span className="text-amber-400">Fallback (0 IA)</span>
                                        ) : (
                                          `${call.toolRounds} round(s)`
                                        )}
                                      </td>
                                      <td className="py-2 px-3 text-stone-300">
                                        {call.totalTokens.toLocaleString('fr-FR')} tok{' '}
                                        <span className="text-stone-500">
                                          ({call.cacheHitTokens} hit / {call.cacheMissTokens} miss /{' '}
                                          {call.completionTokens} out)
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 text-amber-300">{call.latencyMs} ms</td>
                                      <td className="py-2 px-3 text-right font-bold text-emerald-300">
                                        ${call.estimatedCostUsd.toFixed(5)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })()}

                  {/* General Guardrails Summary */}
                  <div className="p-4 rounded-xl bg-black/60 border border-stone-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs sm:text-sm">
                    <div>
                      <div className="text-stone-400">Environnement / Port</div>
                      <div className="font-mono font-semibold text-white mt-0.5">
                        {adminSettings.nodeEnv} • Port {adminSettings.port}
                      </div>
                    </div>
                    <div>
                      <div className="text-stone-400">Admins configurés</div>
                      <div className="font-mono font-semibold text-emerald-300 mt-0.5">
                        {adminSettings.auth.adminEmailsCount} compte(s)
                      </div>
                    </div>
                    <div>
                      <div className="text-stone-400">Cloudflare Access AUD</div>
                      <div className="font-mono font-semibold text-amber-300 mt-0.5">
                        {adminSettings.auth.cfAccessAudPreview}
                      </div>
                    </div>
                    <div>
                      <div className="text-stone-400">Mode Dev Local Header</div>
                      <div className="font-mono font-semibold text-amber-200 mt-0.5">
                        {adminSettings.auth.allowDevAuthHeader ? 'Actif (Dev)' : 'Désactivé (Prod)'}
                      </div>
                    </div>
                  </div>

                  {/* Panneau Interactif d'Édition des Paramètres & Tokens (SQLite + Hot-Reload) */}
                  <form
                    onSubmit={handleSaveRuntimeConfig}
                    className="p-5 rounded-2xl bg-black/80 border border-amber-500/40 space-y-5 text-xs sm:text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                          <Settings className="w-5 h-5 text-amber-400" />
                          <span>Éditer la Configuration, URLs & Tokens API (Persistance SQLite & Hot-Reload)</span>
                        </h3>
                        <p className="text-xs sm:text-sm text-stone-400 mt-1">
                          Pré-rempli avec les paramètres actuels de ton instance. Tout utilisateur ou admin peut modifier ses tokens ou découvrir ses serveurs Plex en 1 clic sans redémarrer le conteneur Docker.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={configDiscovering}
                          onClick={() => void handleDiscoverPlexServers()}
                          className="px-3.5 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 border border-emerald-500/50 text-emerald-300 font-semibold cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Compass className={`w-4 h-4 ${configDiscovering ? 'animate-spin' : ''}`} />
                          <span>
                            {configDiscovering
                              ? 'Découverte sur plex.tv...'
                              : '🔍 Auto-Découvrir mes serveurs Plex (plex.tv)'}
                          </span>
                        </button>

                        <button
                          type="submit"
                          disabled={configSaving}
                          className="px-4 py-2 rounded-xl cinema-velvet-pill text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          {configSaving ? 'Application à chaud...' : '💾 Enregistrer & Appliquer à chaud'}
                        </button>
                      </div>
                    </div>

                    {configBanner && (
                      <div
                        className={`rounded-xl border px-4 py-3 text-xs sm:text-sm font-medium ${
                          configBanner.type === 'success'
                            ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200'
                            : 'bg-rose-950/60 border-rose-700/60 text-rose-200'
                        }`}
                      >
                        {configBanner.text}
                      </div>
                    )}

                    {/* Section 1 : Serveurs Plex & Token */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-stone-950/90 border border-stone-800">
                      <div className="md:col-span-2">
                        <label className="block text-stone-300 font-semibold mb-1">
                          Serveurs Plex (`Nom|http://ip:32400` séparés par virgule)
                        </label>
                        <input
                          type="text"
                          value={configForm.plexServersRaw}
                          onChange={(e) => setConfigForm((p) => ({ ...p, plexServersRaw: e.target.value }))}
                          placeholder="NucVillers|http://192.168.1.163:32400,NucBuntu|http://192.168.1.154:32400"
                          className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-amber-200 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-stone-300 font-semibold mb-1">
                          Token Plex (`X-Plex-Token`)
                        </label>
                        <input
                          type="password"
                          value={configForm.plexToken}
                          onChange={(e) => setConfigForm((p) => ({ ...p, plexToken: e.target.value }))}
                          placeholder={
                            adminSettings.editableValues?.plexTokenMasked || 'Laisser vide pour conserver actuel'
                          }
                          className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                        />
                      </div>
                    </div>

                    {/* Section 2 : Stack *arr & Overseerr */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-stone-950/90 border border-stone-800">
                      <div className="space-y-2">
                        <label className="block text-stone-300 font-semibold">Overseerr (URL & Clé API)</label>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={configForm.overseerrBaseUrl}
                            onChange={(e) => setConfigForm((p) => ({ ...p, overseerrBaseUrl: e.target.value }))}
                            placeholder="http://192.168.1.154:5055"
                            className="rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                          />
                          <input
                            type="password"
                            value={configForm.overseerrApiKey}
                            onChange={(e) => setConfigForm((p) => ({ ...p, overseerrApiKey: e.target.value }))}
                            placeholder={adminSettings.editableValues?.overseerrApiKeyMasked || 'Clé API Overseerr'}
                            className="rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-stone-300 font-semibold">Radarr (URL & Clé API)</label>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={configForm.radarrBaseUrl}
                            onChange={(e) => setConfigForm((p) => ({ ...p, radarrBaseUrl: e.target.value }))}
                            placeholder="http://192.168.1.154:7878"
                            className="rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                          />
                          <input
                            type="password"
                            value={configForm.radarrApiKey}
                            onChange={(e) => setConfigForm((p) => ({ ...p, radarrApiKey: e.target.value }))}
                            placeholder={adminSettings.editableValues?.radarrApiKeyMasked || 'Clé API Radarr'}
                            className="rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-stone-300 font-semibold">Sonarr (URL & Clé API)</label>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={configForm.sonarrBaseUrl}
                            onChange={(e) => setConfigForm((p) => ({ ...p, sonarrBaseUrl: e.target.value }))}
                            placeholder="http://192.168.1.154:8989"
                            className="rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                          />
                          <input
                            type="password"
                            value={configForm.sonarrApiKey}
                            onChange={(e) => setConfigForm((p) => ({ ...p, sonarrApiKey: e.target.value }))}
                            placeholder={adminSettings.editableValues?.sonarrApiKeyMasked || 'Clé API Sonarr'}
                            className="rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-stone-300 font-semibold">Prowlarr (URL & Clé API)</label>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={configForm.prowlarrBaseUrl}
                            onChange={(e) => setConfigForm((p) => ({ ...p, prowlarrBaseUrl: e.target.value }))}
                            placeholder="http://192.168.1.154:9696"
                            className="rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                          />
                          <input
                            type="password"
                            value={configForm.prowlarrApiKey}
                            onChange={(e) => setConfigForm((p) => ({ ...p, prowlarrApiKey: e.target.value }))}
                            placeholder={adminSettings.editableValues?.prowlarrApiKeyMasked || 'Clé API Prowlarr'}
                            className="rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Section 3 : DeepSeek IA & Cloudflare Access */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-stone-950/90 border border-stone-800">
                      <div>
                        <label className="block text-stone-300 font-semibold mb-1">Clé API DeepSeek</label>
                        <input
                          type="password"
                          value={configForm.deepseekApiKey}
                          onChange={(e) => setConfigForm((p) => ({ ...p, deepseekApiKey: e.target.value }))}
                          placeholder={adminSettings.editableValues?.deepseekApiKeyMasked || 'sk-...'}
                          className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-stone-300 font-semibold mb-1">Cloudflare Account ID</label>
                        <input
                          type="text"
                          value={configForm.cloudflareAccountId}
                          onChange={(e) => setConfigForm((p) => ({ ...p, cloudflareAccountId: e.target.value }))}
                          placeholder="Account ID Cloudflare"
                          className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-stone-300 font-semibold mb-1">Token API Cloudflare Zero Trust</label>
                        <input
                          type="password"
                          value={configForm.cloudflareApiToken}
                          onChange={(e) => setConfigForm((p) => ({ ...p, cloudflareApiToken: e.target.value }))}
                          placeholder={adminSettings.editableValues?.cloudflareApiTokenMasked || 'Token API Cloudflare'}
                          className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-stone-300 font-semibold mb-1">Domaine Cloudflare Access</label>
                        <input
                          type="text"
                          value={configForm.cfAccessTeamDomain}
                          onChange={(e) => setConfigForm((p) => ({ ...p, cfAccessTeamDomain: e.target.value }))}
                          placeholder="ton-team.cloudflareaccess.com"
                          className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-stone-300 font-semibold mb-1">Audience JWT (`CF_ACCESS_AUD`)</label>
                        <input
                          type="text"
                          value={configForm.cfAccessAud}
                          onChange={(e) => setConfigForm((p) => ({ ...p, cfAccessAud: e.target.value }))}
                          placeholder="Tag AUD de l'application Cloudflare Access"
                          className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-white font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-stone-300 font-semibold mb-1">Emails Administrateurs</label>
                        <input
                          type="text"
                          value={configForm.adminEmailsRaw}
                          onChange={(e) => setConfigForm((p) => ({ ...p, adminEmailsRaw: e.target.value }))}
                          placeholder="admin@domaine.com"
                          className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3 py-2 text-emerald-300 font-mono text-xs"
                        />
                      </div>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* CONSOLE ADMIN : 3. INVITÉS VIP, ANNUAIRE PLEX & SMTP      */}
        {/* ========================================================= */}
        {workspaceMode === 'admin' && adminTab === 'cloudflare' && (
          <div className="space-y-6">
            {/* Carte 1 : Annuaire Plex.tv (Serveurs par Ami) & Synchronisation Cloudflare Access */}
            <div className="cinema-screen-card rounded-2xl p-5 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-amber-400" />
                    <span>Annuaire des Amis Plex (`plex.tv`), Accès Serveurs & Invitations VIP</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-stone-400 mt-1">
                    Chaque ami Plex est relié aux serveurs auxquels il a accès (<code className="text-emerald-300">NucVillers</code>, <code className="text-amber-300">NucBuntu</code>). Importe-les dans <code className="text-amber-300">Cloudflare Access</code> et envoie-leur leur <strong>Billet d'Invitation VIP</strong> par email Google SMTP.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={cfBusy}
                    onClick={() => void handleSyncPlexUsers()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 border border-amber-500/35 px-3.5 py-2 text-xs sm:text-sm font-semibold text-amber-200 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${cfBusy ? 'animate-spin' : ''}`} />
                    <span>Rafraîchir Annuaire Plex.tv</span>
                  </button>

                  <button
                    type="button"
                    disabled={cfBusy}
                    onClick={() => void handleBootstrapCfPolicy()}
                    className="inline-flex items-center gap-2 rounded-xl cinema-velvet-pill disabled:opacity-50 px-4 py-2 text-xs sm:text-sm font-bold text-white cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-amber-300" />
                    <span>Synchroniser tous les amis Plex vers Cloudflare</span>
                  </button>
                </div>
              </div>

              {cfBanner && (
                <div
                  className={`rounded-xl border px-4 py-3 text-xs sm:text-sm font-medium ${
                    cfBanner.type === 'success'
                      ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200'
                      : 'bg-rose-950/60 border-rose-700/60 text-rose-200'
                  }`}
                >
                  {cfBanner.text}
                </div>
              )}

              {/* Section Annuaire Complet des Amis Plex (avec filtres par serveur et import 1-clic) */}
              {cfStatus?.plexDirectory && cfStatus.plexDirectory.length > 0 && (() => {
                const dir = cfStatus.plexDirectory;
                const filteredFriends = dir.filter((u) => {
                  if (plexFilterServer === 'unimported' && u.inCloudflareAccess) return false;
                  if (
                    plexFilterServer !== 'all' &&
                    plexFilterServer !== 'unimported' &&
                    !u.askarrServerNames.some((s) => s.toLowerCase() === plexFilterServer.toLowerCase())
                  ) {
                    return false;
                  }
                  if (plexSearchQuery.trim()) {
                    const q = plexSearchQuery.trim().toLowerCase();
                    return (
                      u.title.toLowerCase().includes(q) ||
                      u.username.toLowerCase().includes(q) ||
                      u.email.toLowerCase().includes(q) ||
                      String(u.plexUserId).includes(q)
                    );
                  }
                  return true;
                });

                const unimportedInFilter = filteredFriends
                  .filter((u) => !u.inCloudflareAccess && u.email)
                  .map((u) => u.email);

                return (
                  <div className="p-4 sm:p-5 rounded-2xl bg-black/70 border border-amber-500/25 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {[
                          { id: 'all', label: `Tous (${dir.length})` },
                          {
                            id: 'unimported',
                            label: `À importer Cloudflare (${dir.filter((u) => !u.inCloudflareAccess && u.email).length})`
                          },
                          ...['NucVillers', 'NucBuntu', 'EQ12buntu', 'MacMini', 'Macmini4'].map((srv) => ({
                            id: srv,
                            label: `${srv} (${dir.filter((u) => u.askarrServerNames.some((s) => s.toLowerCase() === srv.toLowerCase())).length})`
                          }))
                        ].map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setPlexFilterServer(tab.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold border cursor-pointer transition-colors ${
                              plexFilterServer === tab.id
                                ? 'bg-amber-600 text-white border-amber-400'
                                : 'bg-stone-900 text-stone-300 border-stone-800 hover:border-amber-500/40'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={plexSearchQuery}
                          onChange={(e) => setPlexSearchQuery(e.target.value)}
                          placeholder="Rechercher nom, pseudo, email, #ID Plex..."
                          className="rounded-xl bg-stone-900 border border-stone-700 px-3.5 py-1.5 text-xs sm:text-sm text-white placeholder-stone-500 w-64"
                        />
                        {unimportedInFilter.length > 0 && (
                          <button
                            type="button"
                            disabled={cfBusy}
                            onClick={() => void handleBulkImportPlexFriends(unimportedInFilter, false)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-white cursor-pointer"
                          >
                            <UserPlus className="w-4 h-4" />
                            <span>Importer ces {unimportedInFilter.length} amis dans Cloudflare</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="max-h-96 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2.5 pr-1">
                      {filteredFriends.map((friend) => {
                        const isSending = sendingInviteToEmail === friend.email;
                        return (
                          <div
                            key={`${friend.plexUserId}-${friend.email}`}
                            className="p-3 rounded-xl bg-stone-950/90 border border-stone-800 hover:border-amber-500/35 flex flex-col justify-between gap-2.5 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-sm text-white truncate">
                                    {friend.title || friend.username}
                                  </span>
                                  <span className="text-[11px] font-mono text-stone-400">
                                    #{friend.plexUserId}
                                  </span>
                                  {friend.inCloudflareAccess ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                                      <CheckCircle2 className="w-3 h-3" />
                                      <span>Autorisé Cloudflare</span>
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-stone-800 border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400">
                                      Non importé
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs font-mono text-amber-200/90 truncate mt-0.5">
                                  {friend.email || 'Aucun email dans Plex.tv'}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-stone-900">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {friend.askarrServerNames.length > 0 ? (
                                  friend.askarrServerNames.map((srv) => (
                                    <span
                                      key={srv}
                                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
                                        srv === 'NucBuntu'
                                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                      }`}
                                    >
                                      <Server className="w-3 h-3" />
                                      <span>{srv}</span>
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[11px] text-stone-500 italic">
                                     Autre serveur ({friend.allServerNames.join(', ') || 'aucun'})
                                  </span>
                                )}
                              </div>

                              {friend.email && (
                                <div className="flex items-center gap-1.5">
                                  {!friend.inCloudflareAccess && (
                                    <button
                                      type="button"
                                      disabled={cfBusy}
                                      onClick={() => void handleQuickAuthorizePlexFriend(friend, false)}
                                      className="px-2.5 py-1 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                                      title="Ajouter cet ami dans Cloudflare Access"
                                    >
                                      + Autoriser CF
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={Boolean(sendingInviteToEmail) || cfBusy}
                                    onClick={() => {
                                      if (!friend.inCloudflareAccess) {
                                        void handleQuickAuthorizePlexFriend(friend, true);
                                      } else {
                                        void handleSendVipInvite({
                                          email: friend.email,
                                          recipientName: friend.title || friend.username,
                                          plexServers: friend.askarrServerNames
                                        });
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/50 text-amber-200 text-xs font-semibold cursor-pointer disabled:opacity-50"
                                    title={
                                      friend.inCloudflareAccess
                                        ? "Envoyer le Billet d'Invitation VIP par email"
                                        : 'Autoriser dans Cloudflare Access + Envoyer le Billet VIP par email'
                                    }
                                  >
                                    <Mail className="w-3.5 h-3.5 text-amber-400" />
                                    <span>
                                      {isSending
                                        ? 'Envoi...'
                                        : friend.inCloudflareAccess
                                          ? 'Billet VIP'
                                          : '+ CF & Billet VIP'}
                                    </span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {cfStatus && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs sm:text-sm">
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-black/65 border border-stone-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-stone-400">Règle Cloudflare active :</span>
                        <span className="font-semibold text-amber-300">
                          {cfStatus.targetName
                            ? `${cfStatus.targetName} (${cfStatus.targetMode})`
                            : 'Non créée (clique sur le bouton ci-dessus)'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-stone-400">Emails autorisés dans la règle :</span>
                        <span className="font-mono text-emerald-300">{cfStatus.emails.length}</span>
                      </div>
                    </div>

                    <form
                      onSubmit={handleAddFriendEmail}
                      className="space-y-3 p-4 rounded-xl bg-black/65 border border-stone-800"
                    >
                      <div className="font-semibold text-stone-200 flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-amber-400" />
                        <span>Autoriser manuellement un email & envoyer un Billet VIP</span>
                      </div>
                      <input
                        type="email"
                        value={newFriendEmail}
                        onChange={(e) => setNewFriendEmail(e.target.value)}
                        placeholder="Email Cloudflare de l'ami (ex: ami@gmail.com)"
                        className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-stone-500"
                      />
                      <select
                        value={selectedPlexUserId}
                        onChange={(e) => setSelectedPlexUserId(e.target.value)}
                        className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3.5 py-2.5 text-xs sm:text-sm text-stone-200"
                      >
                        <option value="">
                          -- Si son email Google diffère de Plex, associer à ce compte Plex --
                        </option>
                        {cfStatus.plexUsers.map((pu) => (
                          <option key={pu.id} value={pu.id}>
                            {pu.displayName} ({pu.email}) — Ami Plex #{pu.id}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={customInviteNote}
                        onChange={(e) => setCustomInviteNote(e.target.value)}
                        placeholder="Petit mot personnel optionnel dans le Billet VIP (ex: Bonnes séances ciné !)"
                        className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3.5 py-2 text-xs sm:text-sm text-white placeholder-stone-500"
                      />
                      <label className="flex items-center gap-2 text-xs sm:text-sm text-amber-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sendInviteOnAdd}
                          onChange={(e) => setSendInviteOnAdd(e.target.checked)}
                          className="accent-amber-500 h-4 w-4 rounded"
                        />
                        <span>Envoyer automatiquement le Billet d'Invitation VIP par email (Google SMTP)</span>
                      </label>
                      <button
                        type="submit"
                        disabled={cfBusy || !newFriendEmail.trim()}
                        className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 py-2.5 font-bold text-white cursor-pointer"
                      >
                        {sendInviteOnAdd
                          ? 'Autoriser dans Cloudflare + Envoyer Billet VIP'
                          : 'Autoriser dans Cloudflare Access'}
                      </button>
                    </form>
                  </div>

                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-black/65 border border-stone-800 max-h-64 overflow-y-auto space-y-2">
                      <div className="font-semibold text-stone-200 mb-2">
                        Emails actuellement autorisés dans Cloudflare ({cfStatus.emails.length})
                      </div>
                      {cfStatus.emails.length === 0 ? (
                        <div className="text-stone-500">Aucun email configuré dans cette règle.</div>
                      ) : (
                        cfStatus.emails.map((email) => (
                          <div
                            key={email}
                            className="flex items-center justify-between gap-2 py-1.5 px-3 rounded-lg bg-stone-900/90 border border-stone-800"
                          >
                            <span className="font-mono text-stone-200 truncate">{email}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                disabled={Boolean(sendingInviteToEmail)}
                                onClick={() => void handleSendVipInvite({ email })}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs cursor-pointer"
                                title="Envoyer ou renvoyer le Billet d'Invitation VIP par email"
                              >
                                <Mail className="w-3.5 h-3.5 text-amber-400" />
                                <span>{sendingInviteToEmail === email ? '...' : 'Inviter'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={cfBusy}
                                onClick={() => void handleRemoveFriendEmail(email)}
                                className="text-rose-400 hover:text-rose-300 p-1 cursor-pointer"
                                title="Retirer de la policy Cloudflare"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {cfStatus.revisions.length > 0 && (
                      <div className="p-4 rounded-xl bg-black/65 border border-stone-800 max-h-44 overflow-y-auto space-y-2">
                        <div className="font-semibold text-stone-200 mb-1">
                          Historique & Rollback instantané SQLite
                        </div>
                        {cfStatus.revisions.slice(0, 5).map((rev) => (
                          <div
                            key={rev.id}
                            className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-stone-900/90 border border-stone-800"
                          >
                            <div>
                              <span className="font-mono text-amber-300">#{rev.id}</span>{' '}
                              <span className="text-stone-300">{rev.operation}</span>
                            </div>
                            <button
                              type="button"
                              disabled={cfBusy}
                              onClick={() => void handleRollbackRevision(rev.id)}
                              className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Restaurer</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Carte 2 : Configuration Google SMTP (Mot de passe d'application) comme sur Transistor */}
            <div className="cinema-screen-card rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <Mail className="w-5 h-5 text-amber-400" />
                    <span>Configuration Google SMTP (Mot de passe d'application) — Envoi des Billets VIP</span>
                  </h3>
                  <p className="text-xs sm:text-sm text-stone-400 mt-1">
                    Comme sur Transistor, utilise <code className="text-amber-300">smtp.gmail.com:465</code> (TLS implicite) et un <strong>Mot de passe d'application Google de 16 caractères</strong> pour envoyer les invitations VIP.
                  </p>
                </div>

                {cfStatus?.smtp && (
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      cfStatus.smtp.smtpConfigured
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    }`}
                  >
                    {cfStatus.smtp.smtpConfigured
                      ? `✓ SMTP Prêt (${cfStatus.smtp.smtpUser})`
                      : 'Mot de passe App Google requis'}
                  </span>
                )}
              </div>

              {smtpBanner && (
                <div
                  className={`rounded-xl border px-4 py-3 text-xs sm:text-sm font-medium ${
                    smtpBanner.type === 'success'
                      ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200'
                      : 'bg-rose-950/60 border-rose-700/60 text-rose-200'
                  }`}
                >
                  {smtpBanner.text}
                </div>
              )}

              <form onSubmit={handleSaveSmtpSettings} className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs sm:text-sm">
                <div>
                  <label className="block text-stone-300 mb-1 font-medium">Compte Gmail expéditeur</label>
                  <input
                    type="email"
                    value={smtpForm.smtpUser}
                    onChange={(e) => setSmtpForm((p) => ({ ...p, smtpUser: e.target.value }))}
                    placeholder="ton.email@gmail.com"
                    className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3.5 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-stone-300 mb-1 font-medium">
                    Mot de passe d'application Google (16 car.)
                  </label>
                  <input
                    type="password"
                    value={smtpForm.smtpAppPassword}
                    onChange={(e) => setSmtpForm((p) => ({ ...p, smtpAppPassword: e.target.value }))}
                    placeholder={
                      cfStatus?.smtp?.hasSmtpPassword
                        ? '•••••••••••••••• (déjà enregistré)'
                        : 'xxxx xxxx xxxx xxxx'
                    }
                    className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3.5 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-stone-300 mb-1 font-medium">
                    URL publique Askarr (liens dans l'email)
                  </label>
                  <input
                    type="url"
                    value={smtpForm.publicAppUrl}
                    onChange={(e) => setSmtpForm((p) => ({ ...p, publicAppUrl: e.target.value }))}
                    placeholder="https://askarr.ton-domaine.fr"
                    className="w-full rounded-xl bg-stone-900 border border-stone-700 px-3.5 py-2 text-white"
                  />
                </div>

                <div className="md:col-span-3 flex flex-wrap items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    disabled={smtpTesting || !cfStatus?.smtp?.smtpConfigured}
                    onClick={() => void handleTestSmtpEmail()}
                    className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 border border-amber-500/40 text-amber-200 font-semibold cursor-pointer disabled:opacity-40"
                  >
                    {smtpTesting ? 'Envoi du test...' : "M'envoyer un Billet VIP de test"}
                  </button>
                  <button
                    type="submit"
                    disabled={smtpSaving}
                    className="px-5 py-2 rounded-xl cinema-velvet-pill text-white font-bold cursor-pointer disabled:opacity-50"
                  >
                    {smtpSaving ? 'Sauvegarde...' : 'Enregistrer la configuration SMTP'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* CONSOLE ADMIN : 4. SANTÉ HOMELAB & QUOTAS IA              */}
        {/* ========================================================= */}
        {workspaceMode === 'admin' && adminTab === 'health' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="cinema-screen-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Server className="w-5 h-5 text-amber-400" />
                  <span>État des Projecteurs & Connecteurs Homelab</span>
                </h2>
                <button
                  type="button"
                  onClick={() => void fetchAdminStatus()}
                  className="text-xs sm:text-sm bg-stone-900 hover:bg-stone-800 border border-amber-500/30 text-amber-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Rafraîchir</span>
                </button>
              </div>

              {!adminHealth ? (
                <p className="text-sm text-stone-400">Vérification des connecteurs en cours...</p>
              ) : (
                <div className="space-y-3 text-xs sm:text-sm">
                  {adminHealth.plexServers.map((ps) => (
                    <div
                      key={ps.serverName}
                      className="flex items-center justify-between p-3.5 rounded-xl bg-black/65 border border-stone-800"
                    >
                      <div className="flex items-center gap-3">
                        {ps.ok ? (
                          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400" />
                        ) : (
                          <XCircle className="w-4.5 h-4.5 text-rose-400" />
                        )}
                        <div>
                          <div className="font-semibold text-stone-100">Plex • {ps.serverName}</div>
                          <div className="text-xs text-stone-400">
                            {ps.videoLibraries?.length ?? ps.librariesCount ?? 0} bibliothèques vidéo ({ps.videoLibraries?.join(', ') || 'PMS'})
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-emerald-300">{ps.latencyMs} ms</span>
                    </div>
                  ))}

                  {[
                    { name: 'Overseerr', status: adminHealth.overseerr },
                    { name: 'Radarr', status: adminHealth.radarr },
                    { name: 'Sonarr', status: adminHealth.sonarr },
                    { name: 'Prowlarr', status: adminHealth.prowlarr }
                  ].map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between p-3.5 rounded-xl bg-black/65 border border-stone-800"
                    >
                      <div className="flex items-center gap-3">
                        {item.status.ok ? (
                          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400" />
                        ) : (
                          <XCircle className="w-4.5 h-4.5 text-rose-400" />
                        )}
                        <div>
                          <div className="font-semibold text-stone-100">{item.name}</div>
                          {item.status.version && (
                            <div className="text-xs text-stone-400">v{item.status.version}</div>
                          )}
                        </div>
                      </div>
                      <span
                        className={`font-mono ${
                          item.status.ok ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {item.status.ok ? `${item.status.latencyMs} ms` : 'Hors-ligne'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="cinema-screen-card rounded-2xl p-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <span>Gouvernance IA DeepSeek & Sécurité</span>
              </h2>

              <div className="space-y-4 text-xs sm:text-sm">
                {aiBudget && (
                  <div className="p-4 rounded-xl bg-black/65 border border-stone-800 space-y-2.5">
                    {aiBudget.accountBalance && (
                      <div className="flex justify-between text-stone-400 pb-2 border-b border-stone-800">
                        <span>Solde restant Compte DeepSeek</span>
                        <span className="text-emerald-400 font-bold font-mono">
                          {aiBudget.accountBalance.available
                            ? `${aiBudget.accountBalance.totalBalance} ${aiBudget.accountBalance.currency}`
                            : aiBudget.accountBalance.error || 'Indisponible'}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-stone-400">
                      <span>Coût moyen par requête IA</span>
                      <span className="text-amber-300 font-mono">
                        ~${(aiBudget.averageCostPerRequestUsd ?? 0.00135).toFixed(5)} / requête
                      </span>
                    </div>
                    <div className="flex justify-between text-stone-400">
                      <span>Tokens Aujourd’hui</span>
                      <span className="text-stone-100 font-mono">
                        {aiBudget.dailyTokensUsed.toLocaleString('fr-FR')} /{' '}
                        {aiBudget.dailyTokenCap.toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <div className="flex justify-between text-stone-400">
                      <span>Consommation Mois (USD)</span>
                      <span className="text-stone-100 font-mono">
                        ${aiBudget.monthlyCostUsd.toFixed(4)} / $
                        {aiBudget.monthlyBudgetUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-stone-400">
                      <span>Cache Hit Context DeepSeek</span>
                      <span className="text-emerald-300 font-mono">
                        {aiBudget.cacheHitRatioPercent.toFixed(1)} %
                      </span>
                    </div>
                    <div className="pt-2 border-t border-stone-800 flex items-center justify-between">
                      <span className={aiBudget.isOverQuota ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                        {aiBudget.isOverQuota ? '⚠️ Quota journalier atteint (Fallback actif)' : '✓ IA DeepSeek Active'}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch('/api/admin/ai-usage/reset-daily', { method: 'POST' });
                          await fetchAdminStatus();
                          await fetchSession();
                        }}
                        className="px-3 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 border border-amber-500/40 text-amber-200 text-xs font-semibold cursor-pointer flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Remettre le compteur du jour à 0</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="p-4 rounded-xl bg-black/65 border border-stone-800 space-y-2 text-stone-300">
                  <div className="font-bold text-amber-200">Garanties actives :</div>
                  <div>• Fédération Multi-Serveurs Plex (`NucVillers` + `NucBuntu` Cinéphile/4K)</div>
                  <div>• Programmation en 2 étapes avec gestion idempotente Overseerr (HTTP 409 géré)</div>
                  <div>• Redaction automatique des clés API et tokens dans le Traceur API</div>
                  <div>• Synchronisation Cloudflare Access (`userType === 1` Plex uniquement) + Rollback SQLite</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
export default App;
