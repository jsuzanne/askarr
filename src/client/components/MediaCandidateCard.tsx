import React, { useState, useEffect } from 'react';
import {
  Film,
  Tv,
  Star,
  CheckCircle2,
  Clock,
  Disc,
  Server,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Download,
  PlusCircle,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Terminal,
  Clapperboard,
  Play,
  Pause,
  Square,
  RefreshCw,
  ExternalLink,
  Smartphone
} from 'lucide-react';
import type {
  MediaEvidence,
  PlexCastResponseDTO,
  PlexPlayerDeviceDTO,
  PreparedActionDTO
} from '../../shared/types.js';
import { ENABLE_PLEX_CAST_FEATURE } from '../../shared/types.js';
import { cinemaAudio } from '../utils/cinema-audio.js';
import { useI18n } from '../i18n/index.js';

interface Props {
  evidence: MediaEvidence;
  onAskSimilar?: (evidence: MediaEvidence) => void;
  onEvidenceUpdated?: (updated: MediaEvidence) => void;
  showTechnicalTrace?: boolean;
  plexPlayers?: PlexPlayerDeviceDTO[];
  selectedPlayerId?: string | null;
  onSelectPlayerId?: (id: string) => void;
  onRefreshPlayers?: (force?: boolean) => Promise<void>;
  scanningPlayers?: boolean;
  embeddedInChat?: boolean;
  compactSynopsis?: boolean;
  initialPreparedAction?: PreparedActionDTO | null;
}

function formatDuration(minutes: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m} min`;
}

function formatDate(iso: string | null, lang: 'fr' | 'en'): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function getLocalizedStatusLabel(label: string, lang: 'fr' | 'en'): string {
  if (lang === 'fr') return label;
  if (label.startsWith('Disponible sur Plex')) {
    return label.replace('Disponible sur Plex', 'Available on Plex');
  }
  if (label.startsWith('Non dispo sur ton serveur Plex')) {
    return label
      .replace('Non dispo sur ton serveur Plex', 'Not available on your Plex server')
      .replace('présent sur', 'present on');
  }
  if (label.startsWith('Partiellement sur Plex')) {
    return label.replace('Partiellement sur Plex', 'Partially on Plex');
  }
  if (label.startsWith('Téléchargement en cours')) {
    return label.replace('Téléchargement en cours', 'Downloading in progress');
  }
  if (label.startsWith('Vérification partielle')) {
    return 'Partial check (Plex server temporarily unreachable)';
  }
  if (label.includes('en salle')) {
    return label.replace('en salle', 'in theaters');
  }
  return label;
}

export const MediaCandidateCard: React.FC<Props> = ({
  evidence,
  onAskSimilar,
  onEvidenceUpdated,
  showTechnicalTrace = false,
  plexPlayers = [],
  selectedPlayerId = null,
  onSelectPlayerId,
  onRefreshPlayers,
  scanningPlayers = false,
  embeddedInChat = false,
  compactSynopsis = false,
  initialPreparedAction = null
}) => {
  const { lang, t } = useI18n();
  const [localEvidence, setLocalEvidence] = useState<MediaEvidence>(evidence);
  const [showAllSeasons, setShowAllSeasons] = useState(false);
  const [synopsisExpanded, setSynopsisExpanded] = useState(!compactSynopsis);
  const [selectedSeasons, setSelectedSeasons] = useState<number[]>(evidence.actionability.requestableSeasons);
  const [preparedAction, setPreparedAction] = useState<PreparedActionDTO | null>(initialPreparedAction);

  useEffect(() => {
    if (initialPreparedAction) {
      setPreparedAction(initialPreparedAction);
    }
  }, [initialPreparedAction]);
  const [loadingAction, setLoadingAction] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // État Cast Plex Player (Apple TV / Smart TV / LAN Companion)
  const [showPlayerMenu, setShowPlayerMenu] = useState(false);
  const [castingInProgress, setCastingInProgress] = useState(false);
  const [castResult, setCastResult] = useState<PlexCastResponseDTO | null>(null);
  const [remoteControlMsg, setRemoteControlMsg] = useState<string | null>(null);

  const { identity, catalogPresence, acquisitionPipeline, episodeCoverage, actionability } = localEvidence;

  const toggleSeason = (seasonNumber: number) => {
    setPreparedAction(null);
    setSelectedSeasons((prev) =>
      prev.includes(seasonNumber) ? prev.filter((s) => s !== seasonNumber) : [...prev, seasonNumber].sort((a, b) => a - b)
    );
  };

  const handlePrepareRequest = async () => {
    setLoadingAction(true);
    setFeedbackMessage(null);
    try {
      const res = await fetch('/api/requests/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdbId: identity.tmdbId,
          mediaType: identity.mediaType,
          seasons: identity.mediaType === 'tv' ? selectedSeasons : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedbackMessage({ type: 'error', text: data.message || 'Impossible de préparer cette demande.' });
        return;
      }
      setPreparedAction(data.preparedAction);
      if (data.evidence) {
        setLocalEvidence(data.evidence);
      }
    } catch {
      setFeedbackMessage({ type: 'error', text: 'Erreur de connexion au serveur.' });
    } finally {
      setLoadingAction(false);
    }
  };

  const handleConfirmRequest = async () => {
    if (!preparedAction) return;
    setLoadingAction(true);
    setFeedbackMessage(null);
    try {
      const res = await fetch('/api/requests/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: preparedAction.actionId })
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedbackMessage({ type: 'error', text: data.message || 'Erreur lors de la confirmation.' });
        return;
      }
      setPreparedAction(null);
      cinemaAudio.playTicketPunchSfx();
      setFeedbackMessage({
        type: 'success',
        text: data.messageFr || 'Demande confirmée et envoyée !'
      });
      if (data.evidence) {
        setLocalEvidence(data.evidence);
        onEvidenceUpdated?.(data.evidence);
      }
    } catch {
      setFeedbackMessage({ type: 'error', text: 'Erreur lors de la validation de la demande.' });
    } finally {
      setLoadingAction(false);
    }
  };

  const rating = identity.ratings.imdbOrAudienceRating ?? identity.ratings.tmdbVoteAverage;
  const showOriginalTitle =
    identity.originalTitle &&
    identity.originalTitle.trim().toLowerCase() !== identity.titleFr.trim().toLowerCase();

  const toneBadgeClasses: Record<MediaEvidence['actionability']['statusTone'], string> = {
    emerald: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.12)]',
    sky: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
    indigo: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
    amber: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
    slate: 'bg-stone-800/90 text-stone-300 border-stone-700',
    rose: 'bg-rose-500/15 text-rose-200 border-rose-500/40'
  };

  const vodDateFr = formatDate(identity.releaseDates.estimatedVodOrDvdDate, lang);
  const cinemaDateFr = formatDate(identity.releaseDates.inCinemas, lang);
  const requestedOrAddedDateFr = formatDate(
    localEvidence.requestState.requestedAt || acquisitionPipeline.addedAt || null,
    lang
  );
  const requesterName = localEvidence.requestState.requestedByDisplayName || null;
  const sourceOrigin =
    localEvidence.requestState.sourceOrigin ||
    (requesterName
      ? 'overseerr_user'
      : acquisitionPipeline.state !== 'not_in_arr' && acquisitionPipeline.state !== 'unknown'
        ? 'auto_list'
        : null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const isVodFuture = Boolean(
    identity.releaseDates.estimatedVodOrDvdDate && identity.releaseDates.estimatedVodOrDvdDate > todayIso
  );

  const primaryPlexMatch = catalogPresence.matchedItems[0] || null;
  const plexWebUrl = primaryPlexMatch
    ? primaryPlexMatch.plexWebUrl ||
      (primaryPlexMatch.machineIdentifier
        ? `https://app.plex.tv/desktop/#!/server/${primaryPlexMatch.machineIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${primaryPlexMatch.ratingKey}`)}`
        : `https://app.plex.tv/desktop/#!/search?query=${encodeURIComponent(identity.titleFr)}`)
    : null;
  const plexIosDeepLink = primaryPlexMatch
    ? primaryPlexMatch.plexIosDeepLink ||
      (primaryPlexMatch.machineIdentifier
        ? `plex://preplay/?metadataKey=${encodeURIComponent(`/library/metadata/${primaryPlexMatch.ratingKey}`)}&server=${primaryPlexMatch.machineIdentifier}`
        : `plex://`)
    : null;
  const isMobileDevice =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const primaryPlexHref = isMobileDevice ? plexIosDeepLink || plexWebUrl : plexWebUrl;

  const activePlayer =
    (selectedPlayerId ? plexPlayers.find((p) => p.clientIdentifier === selectedPlayerId) : null) ||
    plexPlayers.find((p) => p.isOnline) ||
    plexPlayers[0] ||
    null;

  const handleCastToPlayer = async (targetPlayer?: PlexPlayerDeviceDTO, offsetMs?: number) => {
    const player = targetPlayer || activePlayer;
    if (!player || !primaryPlexMatch) {
      setShowPlayerMenu(true);
      void onRefreshPlayers?.(true);
      return;
    }
    onSelectPlayerId?.(player.clientIdentifier);
    setShowPlayerMenu(false);
    setCastingInProgress(true);
    setCastResult(null);
    setRemoteControlMsg(null);
    try {
      const res = await fetch('/api/plex/cast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientIdentifier: player.clientIdentifier,
          serverName: primaryPlexMatch.serverName,
          ratingKey: primaryPlexMatch.ratingKey,
          mediaType: identity.mediaType,
          offsetMs,
          playerAddress: player.address,
          playerPort: player.port
        })
      });
      const data = (await res.json()) as PlexCastResponseDTO;
      setCastResult(data);
      if (data.ok) {
        cinemaAudio.playTicketPunchSfx();
      }
    } catch {
      setCastResult({
        ok: false,
        playerName: player.displayName || player.name,
        clientIdentifier: player.clientIdentifier,
        serverName: primaryPlexMatch.serverName,
        ratingKey: primaryPlexMatch.ratingKey,
        resolvedKey: `/library/metadata/${primaryPlexMatch.ratingKey}`,
        playQueueId: null,
        deliveryMethod: 'none',
        messageFr: 'Erreur de communication avec le serveur lors du lancement sur le lecteur.'
      });
    } finally {
      setCastingInProgress(false);
    }
  };

  const handleControlPlayer = async (
    action: 'pause' | 'play' | 'stop' | 'stepForward' | 'stepBack'
  ) => {
    const player = activePlayer;
    if (!player) return;
    try {
      const res = await fetch('/api/plex/cast/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientIdentifier: player.clientIdentifier,
          action,
          playerAddress: player.address,
          playerPort: player.port
        })
      });
      const data = (await res.json()) as { ok: boolean; messageFr: string };
      setRemoteControlMsg(data.messageFr);
    } catch {
      setRemoteControlMsg('Impossible d’envoyer la commande au lecteur.');
    }
  };

  const partialSelectedSeasons =
    episodeCoverage?.seasons.filter(
      (s) => selectedSeasons.includes(s.seasonNumber) && s.state === 'partially_available'
    ) || [];
  const totalMissingInSelected = partialSelectedSeasons.reduce(
    (sum, s) => sum + Math.max(0, s.totalEpisodeCount - Math.max(s.plexEpisodeCount, s.sonarrEpisodeFileCount)),
    0
  );
  const requestButtonLabel =
    identity.mediaType === 'tv'
      ? partialSelectedSeasons.length === 1 && selectedSeasons.length === 1
        ? totalMissingInSelected > 0
          ? lang === 'en'
            ? `Complete Season ${selectedSeasons[0]} (${totalMissingInSelected} missing ep.)`
            : `Compléter Saison ${selectedSeasons[0]} (${totalMissingInSelected} ép. manquant${totalMissingInSelected > 1 ? 's' : ''})`
          : t('complete_season', { season: selectedSeasons[0] })
        : partialSelectedSeasons.length > 0
          ? lang === 'en'
            ? `Complete / Request (${selectedSeasons.map((n) => `S${n}`).join(', ')})`
            : `Compléter / Demander (${selectedSeasons.map((n) => `S${n}`).join(', ')})`
          : selectedSeasons.length > 0
            ? lang === 'en'
              ? `Request ${selectedSeasons.map((n) => `S${n}`).join(', ')} on Plex`
              : `Demander ${selectedSeasons.map((n) => `S${n}`).join(', ')} sur Plex`
            : t('select_season')
      : t('request_on_plex');

  return (
    <div
      className={`group rounded-2xl flex flex-col justify-between relative overflow-hidden ${
        embeddedInChat
          ? 'bg-black/45 border border-amber-500/25 p-3.5 sm:p-4 shadow-[0_8px_28px_rgba(0,0,0,0.65)]'
          : 'cinema-poster-card p-4 sm:p-5 lg:p-6'
      }`}
    >
      {/* Fine ligne lumineuse dorée en haut de l'affiche */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/50 to-transparent opacity-75 group-hover:opacity-100 transition-opacity" />

      <div>
        {/* Partie haute : Affiche de Cinéma + Métadonnées Grand Écran */}
        <div className="flex flex-row items-start gap-3.5 sm:gap-4">
          {/* Affiche Encadrée (cliquable vers Plex si disponible) */}
          <div
            className={`relative shrink-0 overflow-hidden rounded-xl bg-stone-900 border border-amber-500/30 shadow-[0_10px_25px_rgba(0,0,0,0.85)] ${
              embeddedInChat
                ? 'h-32 w-22 sm:h-40 sm:w-28 lg:h-44 lg:w-30'
                : 'h-32 w-22 sm:h-48 sm:w-32 lg:h-52 lg:w-36'
            }`}
          >
            {primaryPlexHref ? (
              <a
                href={primaryPlexHref}
                target={isMobileDevice ? undefined : '_blank'}
                rel={isMobileDevice ? undefined : 'noopener noreferrer'}
                title={`Ouvrir « ${identity.titleFr} » directement dans Plex`}
                className="block h-full w-full relative group/poster cursor-pointer"
              >
                {identity.posterUrl ? (
                  <img
                    src={identity.posterUrl}
                    alt={identity.titleFr}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-amber-500/50 p-2 text-center bg-gradient-to-b from-stone-900 to-black">
                    {identity.mediaType === 'movie' ? <Film className="h-8 w-8" /> : <Tv className="h-8 w-8" />}
                    <span className="text-xs font-medium line-clamp-3 text-stone-400">{identity.titleFr}</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/poster:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-black shadow-lg">
                    <Play className="h-3.5 w-3.5 fill-black" />
                    Plex
                  </span>
                </div>
              </a>
            ) : identity.posterUrl ? (
              <img
                src={identity.posterUrl}
                alt={identity.titleFr}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-amber-500/50 p-2 text-center bg-gradient-to-b from-stone-900 to-black">
                {identity.mediaType === 'movie' ? <Film className="h-8 w-8" /> : <Tv className="h-8 w-8" />}
                <span className="text-xs font-medium line-clamp-3 text-stone-400">{identity.titleFr}</span>
              </div>
            )}
            <div className="pointer-events-none absolute top-1.5 left-1.5 rounded-md bg-black/85 backdrop-blur-md px-1.5 py-0.5 text-[10px] font-cinema tracking-wider uppercase text-amber-300 border border-amber-500/40 shadow">
              {identity.mediaType === 'movie' ? (lang === 'en' ? '🎬 MOVIE' : '🎬 FILM') : (lang === 'en' ? '📺 TV SHOW' : '📺 SÉRIE')}
            </div>
          </div>

          {/* En-tête, Note IMDb Or, Genres & Distribution */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg lg:text-xl font-bold text-white leading-tight break-words tracking-tight">
                  {identity.titleFr}{' '}
                  {identity.year ? (
                    <span className="font-normal text-amber-300/90 text-sm sm:text-base">
                      ({identity.year})
                    </span>
                  ) : null}
                </h3>
                {showOriginalTitle && (
                  <p className="mt-0.5 text-xs italic text-stone-400 truncate">
                    {lang === 'en' ? 'Original title:' : 'Titre original :'} {identity.originalTitle}
                  </p>
                )}
              </div>

              {rating !== null && rating > 0 && (
                <div
                  className="flex shrink-0 items-center gap-1 rounded-xl bg-gradient-to-br from-amber-500/25 to-yellow-600/10 border border-amber-400/50 px-2.5 py-1 text-xs sm:text-sm font-bold text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.18)]"
                  title={lang === 'en' ? 'IMDb / Audience rating out of 10' : 'Note IMDb / Spectateurs sur 10'}
                >
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />
                  <span>{rating.toFixed(1)}</span>
                </div>
              )}
            </div>

            {/* Genres & Durée */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-200">
              {identity.genres.slice(0, 4).map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-stone-900/90 border border-amber-500/25 px-2 py-0.5 text-[11px] font-medium text-amber-100/90"
                >
                  {g}
                </span>
              ))}
              {formatDuration(identity.runtimeMinutes) && (
                <span className="text-amber-300/80 text-xs font-medium ml-0.5">
                  • {formatDuration(identity.runtimeMinutes)}
                </span>
              )}
              {identity.overviewFr && compactSynopsis && (
                <button
                  type="button"
                  onClick={() => setSynopsisExpanded((v) => !v)}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-amber-300/90 hover:text-amber-200 underline decoration-amber-500/40 cursor-pointer"
                >
                  <span>{synopsisExpanded ? (lang === 'en' ? 'Hide synopsis' : 'Masquer synopsis') : '+ Synopsis'}</span>
                </button>
              )}
            </div>

            {/* Réalisateur & Casting */}
            {(identity.directorOrCreator || identity.topCast.length > 0) && (
              <div className="mt-1.5 space-y-0.5 text-xs sm:text-[13px] text-stone-300 leading-snug">
                {identity.directorOrCreator && (
                  <p className="line-clamp-1">
                    <strong className="text-amber-200/95 font-semibold">
                      {identity.mediaType === 'movie' ? t('director') : t('creator')}
                    </strong>{' '}
                    <span className="text-white font-medium">{identity.directorOrCreator}</span>
                  </p>
                )}
                {identity.topCast.length > 0 && (
                  <p className="line-clamp-1">
                    <strong className="text-amber-200/95 font-semibold">{t('cast')}</strong>{' '}
                    <span>{identity.topCast.slice(0, 4).join(', ')}</span>
                  </p>
                )}
              </div>
            )}

            {/* Ligne unifiée de Statut Plex + Salle/Serveurs + Origine/Dates (remplace les 4 blocs empilés) */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {primaryPlexHref ? (
                <a
                  href={primaryPlexHref}
                  target={isMobileDevice ? undefined : '_blank'}
                  rel={isMobileDevice ? undefined : 'noopener noreferrer'}
                  title={lang === 'en' ? 'Click to open directly in Plex' : 'Cliquer pour ouvrir directement dans Plex'}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold hover:brightness-110 transition cursor-pointer ${toneBadgeClasses[actionability.statusTone]}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>{getLocalizedStatusLabel(actionability.userFriendlyStatusLabel, lang)}</span>
                </a>
              ) : (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${toneBadgeClasses[actionability.statusTone]}`}
                >
                  {catalogPresence.state === 'available_now' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : acquisitionPipeline.state === 'downloading' ? (
                    <Download className="h-3.5 w-3.5 shrink-0 animate-bounce" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{getLocalizedStatusLabel(actionability.userFriendlyStatusLabel, lang)}</span>
                </span>
              )}

              {requesterName ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-stone-900/90 border border-amber-500/25 px-2 py-1 text-[11px] text-amber-200/90">
                  <Clock className="h-3 w-3 text-amber-400 shrink-0" />
                  <span>
                    {t('requested_by', { name: requesterName })}
                    {requestedOrAddedDateFr ? ` (${requestedOrAddedDateFr})` : ''}
                  </span>
                </span>
              ) : sourceOrigin === 'auto_list' ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-stone-900/90 border border-stone-700/80 px-2 py-1 text-[11px] text-stone-300">
                  <Clock className="h-3 w-3 text-amber-400/80 shrink-0" />
                  <span>
                    {t('auto_list')}{requestedOrAddedDateFr ? ` (${requestedOrAddedDateFr})` : ''}
                  </span>
                </span>
              ) : null}

              {catalogPresence.state !== 'available_now' && cinemaDateFr && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-stone-900/90 border border-stone-700/80 px-2 py-1 text-[11px] text-stone-300">
                  <Clapperboard className="h-3 w-3 text-red-400 shrink-0" />
                  <span>{t('theatrical_release', { date: cinemaDateFr })}</span>
                </span>
              )}

              {catalogPresence.state !== 'available_now' && vodDateFr && (
                <span
                  className={`inline-flex items-center gap-1 rounded-lg bg-stone-900/90 border px-2 py-1 text-[11px] ${
                    isVodFuture
                      ? 'border-amber-500/35 text-amber-200 font-medium'
                      : 'border-stone-700/80 text-stone-300'
                  }`}
                >
                  <Disc className={`h-3 w-3 shrink-0 ${isVodFuture ? 'text-amber-400' : 'text-stone-400'}`} />
                  <span>
                    {t('vod_release', {
                      date: identity.releaseDates.isEstimatedDate && isVodFuture ? `~${vodDateFr}` : vodDateFr
                    })}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Synopsis FR (affiché si déplié ou en mode multi-cartes) */}
        {identity.overviewFr && synopsisExpanded && (
          <p className="mt-2.5 text-xs sm:text-[13px] leading-relaxed text-stone-200/90 line-clamp-2 sm:line-clamp-3">
            {identity.overviewFr}
          </p>
        )}

        {/* Alerte uniquement si l'utilisateur n'a PAS accès au serveur où se trouve le média */}
        {catalogPresence.accessibleToCurrentUser === false && (
          <div className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-amber-950/70 border border-amber-500/50 px-3 py-1.5 text-xs text-amber-200">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              Présent sur <strong>{catalogPresence.availableServers?.join(' & ')}</strong>, mais ton compte Plex est rattaché à{' '}
              <strong>{catalogPresence.userAllowedServers?.join(' & ') || 'un autre serveur'}</strong>.
            </span>
          </div>
        )}

        {/* Pilules compactes des saisons pour les Séries TV */}
        {episodeCoverage && episodeCoverage.seasons.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300/80 mr-1">
              Saisons :
            </span>
            {(showAllSeasons ? episodeCoverage.seasons : episodeCoverage.seasons.slice(0, 6)).map((s) => {
              const isRequestable = actionability.requestableSeasons.includes(s.seasonNumber);
              const isSelected = selectedSeasons.includes(s.seasonNumber);
              const presentEpCount = Math.max(s.plexEpisodeCount, s.sonarrEpisodeFileCount);
              const missingCount = Math.max(0, s.totalEpisodeCount - presentEpCount);
              return (
                <button
                  type="button"
                  disabled={!isRequestable}
                  onClick={() => isRequestable && toggleSeason(s.seasonNumber)}
                  key={s.seasonNumber}
                  title={
                    s.state === 'partially_available'
                      ? `Saison ${s.seasonNumber} incomplète : ${presentEpCount}/${s.totalEpisodeCount} épisodes sur Plex (${missingCount} manquant${missingCount > 1 ? 's' : ''}). Cliquer pour sélectionner.`
                      : undefined
                  }
                  className={`rounded-lg border px-2.5 py-1 text-xs inline-flex items-center gap-1.5 transition ${
                    s.state === 'available_on_plex'
                      ? 'bg-emerald-950/35 border-emerald-700/50 text-emerald-200 cursor-default'
                      : s.state === 'requested_or_monitored'
                        ? 'bg-amber-950/35 border-amber-700/50 text-amber-200 cursor-default'
                        : isSelected
                          ? 'bg-red-900/60 border-amber-400 text-white cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                          : 'bg-stone-900/90 border-stone-800 text-stone-400 cursor-pointer hover:border-amber-500/40'
                  }`}
                >
                  {isRequestable && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="h-3 w-3 accent-amber-400 rounded pointer-events-none"
                    />
                  )}
                  <span className="font-semibold">S{s.seasonNumber}</span>
                  <span className="opacity-90">
                    {s.state === 'available_on_plex'
                      ? `✓ ${presentEpCount} ép.`
                      : s.state === 'partially_available'
                        ? `${presentEpCount}/${s.totalEpisodeCount} ép. (${missingCount} manq.)`
                        : s.state === 'requested_or_monitored'
                          ? 'En attente'
                          : 'À demander'}
                  </span>
                </button>
              );
            })}
            {episodeCoverage.seasons.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllSeasons(!showAllSeasons)}
                className="inline-flex items-center gap-0.5 text-xs text-amber-400 hover:underline cursor-pointer ml-1"
              >
                <span>{showAllSeasons ? 'Réduire' : `+${episodeCoverage.seasons.length - 6} saisons`}</span>
                {showAllSeasons ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Barre d'Actions Unifiée : Ouvrir sur Plex + Lancer sur Apple TV + Compléter/Demander + Similaires */}
      <div className="mt-3 flex flex-col gap-2 border-t border-amber-500/15 pt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Bouton principal Ouvrir sur Plex */}
            {plexWebUrl && (
              <a
                href={primaryPlexHref || plexWebUrl}
                target={isMobileDevice ? undefined : '_blank'}
                rel={isMobileDevice ? undefined : 'noopener noreferrer'}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-3 py-1.5 text-xs sm:text-sm font-bold text-stone-950 shadow-[0_4px_15px_rgba(245,158,11,0.3)] hover:from-amber-400 hover:to-yellow-400 active:scale-[0.98] transition cursor-pointer"
                title={
                  isMobileDevice
                    ? "Ouvrir directement dans l'application Plex (iPhone / iPad)"
                    : 'Ouvrir directement dans Plex Web (PC / Mac)'
                }
              >
                <Play className="h-3.5 w-3.5 fill-stone-950 text-stone-950 shrink-0" />
                <span>{isMobileDevice ? t('open_plex_app') : t('open_in_plex')}</span>
              </a>
            )}

            {plexIosDeepLink && !isMobileDevice && (
              <a
                href={plexIosDeepLink}
                className="inline-flex items-center gap-1 rounded-xl border border-amber-500/35 bg-stone-900/90 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 hover:border-amber-400 transition cursor-pointer"
                title="Lien natif plex:// (ouvre l'application Plex installée sur iPhone/iPad/Mac)"
              >
                <Smartphone className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>App</span>
              </a>
            )}

            {/* Bouton Lancer directement sur TV / Plex Player (Apple TV, Smart TV...) */}
            {ENABLE_PLEX_CAST_FEATURE && primaryPlexMatch && (
              <div className="relative inline-flex items-center">
                <div className="inline-flex items-center rounded-xl border border-emerald-500/50 bg-emerald-950/75 shadow-[0_0_15px_rgba(16,185,129,0.15)] overflow-hidden">
                  <button
                    type="button"
                    disabled={castingInProgress}
                    onClick={() => void handleCastToPlayer()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-bold text-emerald-100 hover:bg-emerald-800/60 active:scale-[0.99] transition cursor-pointer disabled:opacity-60"
                    title={
                      activePlayer
                        ? `Lancer immédiatement sur ${activePlayer.displayName} (${activePlayer.isOnline ? 'En ligne sur le réseau' : 'Veille / Ouvrir Plex sur la TV'})`
                        : 'Choisir un lecteur Plex (Apple TV, Smart TV...) pour lancer le programme'
                    }
                  >
                    {castingInProgress ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300 shrink-0" />
                    ) : (
                      <Tv className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    )}
                    {activePlayer?.isOnline && (
                      <span
                        className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.95)] animate-pulse shrink-0"
                        title="Lecteur détecté actif en temps réel"
                      />
                    )}
                    <span>
                      {castingInProgress
                        ? 'Lancement...'
                        : activePlayer
                          ? `Lancer sur ${activePlayer.displayName}`
                          : 'Caster sur TV'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !showPlayerMenu;
                      setShowPlayerMenu(next);
                      if (next) {
                        void onRefreshPlayers?.(true);
                      }
                    }}
                    className="px-2 py-1.5 border-l border-emerald-500/40 text-emerald-300 hover:bg-emerald-800/60 transition cursor-pointer"
                    title="Changer d'écran Plex ou scanner le réseau"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {showPlayerMenu && (
                  <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-2 w-72 sm:w-80 rounded-2xl bg-[#11090d]/98 border border-emerald-500/50 shadow-[0_20px_50px_rgba(0,0,0,0.95)] backdrop-blur-xl p-3 z-50 text-left">
                    <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-emerald-500/20">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300 uppercase tracking-wider">
                        <Tv className="h-3.5 w-3.5" />
                        <span>Lecteurs Plex (Companion)</span>
                      </div>
                      <button
                        type="button"
                        disabled={scanningPlayers}
                        onClick={() => void onRefreshPlayers?.(true)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-950/90 hover:bg-emerald-900 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${scanningPlayers ? 'animate-spin' : ''}`} />
                        <span>{scanningPlayers ? 'Scan...' : 'Scanner'}</span>
                      </button>
                    </div>

                    {plexPlayers.length === 0 ? (
                      <div className="py-3 text-xs text-stone-400 text-center">
                        Aucun lecteur détecté. Ouvre l&apos;app Plex sur ton Apple TV puis clique sur{' '}
                        <strong className="text-emerald-300">Scanner</strong>.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto pr-0.5">
                        {plexPlayers.map((p) => {
                          const isSelected = activePlayer?.clientIdentifier === p.clientIdentifier;
                          return (
                            <button
                              key={p.clientIdentifier}
                              type="button"
                              onClick={() => void handleCastToPlayer(p)}
                              className={`w-full text-left p-2 rounded-xl border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                                isSelected
                                  ? 'bg-emerald-500/20 border-emerald-400/70 text-white'
                                  : 'bg-stone-900/80 border-stone-800 text-stone-200 hover:bg-stone-800/80 hover:border-stone-700'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-xs font-bold">
                                  <span
                                    className={`h-2 w-2 rounded-full shrink-0 ${
                                      p.isOnline
                                        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                                        : 'bg-stone-600'
                                    }`}
                                  />
                                  <span className="truncate">{p.displayName}</span>
                                </div>
                                <div className="text-[10px] text-stone-400 mt-0.5 truncate">
                                  {p.product}
                                  {p.address ? ` • ${p.address}` : ''}
                                  {p.nowPlayingTitle ? ` • ▶ ${p.nowPlayingTitle}` : ''}
                                </div>
                              </div>
                              <span
                                className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  p.isOnline
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                    : 'bg-stone-800 text-stone-400 border-stone-700'
                                }`}
                              >
                                {p.isOnline ? '🟢 Prêt' : 'Veille'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Bouton Direct de Demande / Complétion des épisodes manquants intégré à la barre d'action */}
            {actionability.canRequestNow && !preparedAction && (
              <button
                type="button"
                disabled={loadingAction || (identity.mediaType === 'tv' && selectedSeasons.length === 0)}
                onClick={handlePrepareRequest}
                className="cinema-velvet-pill inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-bold text-white hover:brightness-110 active:scale-[0.99] disabled:opacity-50 transition cursor-pointer"
                title={actionability.userFriendlyExplanationFr}
              >
                {loadingAction ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : partialSelectedSeasons.length > 0 ? (
                  <Download className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                ) : (
                  <PlusCircle className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                )}
                <span>{requestButtonLabel}</span>
              </button>
            )}
          </div>

          {evidence.identity.tmdbId > 0 && onAskSimilar && (
            <button
              type="button"
              onClick={() => onAskSimilar(evidence)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs sm:text-sm font-semibold text-amber-200 hover:bg-amber-500/20 hover:border-amber-400/60 active:scale-[0.99] transition cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span>{identity.mediaType === 'tv' ? t('similar_series') : t('similar_movies')}</span>
            </button>
          )}
        </div>

        {/* Bandeau Retour Cast & Télécommande Directe Plex Player */}
        {ENABLE_PLEX_CAST_FEATURE && castResult && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-2.5 ${
              castResult.ok
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-100'
                : 'bg-amber-950/80 border-amber-500/50 text-amber-100'
            }`}
          >
            <div className="flex items-center gap-2">
              {castResult.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              )}
              <span>{castResult.messageFr}</span>
              {remoteControlMsg && (
                <span className="text-xs text-emerald-300/90 font-mono">({remoteControlMsg})</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {castResult.ok ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleControlPlayer('pause')}
                    className="inline-flex items-center gap-1 rounded-lg bg-black/60 hover:bg-black/90 border border-emerald-500/40 px-2.5 py-1 text-xs font-semibold text-emerald-200 cursor-pointer"
                  >
                    <Pause className="h-3 w-3" />
                    <span>Pause</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleControlPlayer('play')}
                    className="inline-flex items-center gap-1 rounded-lg bg-black/60 hover:bg-black/90 border border-emerald-500/40 px-2.5 py-1 text-xs font-semibold text-emerald-200 cursor-pointer"
                  >
                    <Play className="h-3 w-3" />
                    <span>Reprendre</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleControlPlayer('stop')}
                    className="inline-flex items-center gap-1 rounded-lg bg-black/60 hover:bg-black/90 border border-rose-500/40 px-2.5 py-1 text-xs font-semibold text-rose-200 cursor-pointer"
                  >
                    <Square className="h-3 w-3" />
                    <span>Stop</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCastToPlayer(activePlayer || undefined, 0)}
                    className="inline-flex items-center gap-1 rounded-lg bg-black/60 hover:bg-black/90 border border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-200 cursor-pointer"
                    title="Relancer depuis le début (00:00)"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Début</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    await onRefreshPlayers?.(true);
                    await handleCastToPlayer();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/60 px-3 py-1 text-xs font-bold text-amber-100 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Scanner & Réessayer</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Retour d'information après confirmation ou erreur */}
        {feedbackMessage && (
          <div
            className={`mt-1 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm font-medium ${
              feedbackMessage.type === 'success'
                ? 'bg-emerald-950/70 border-emerald-600/60 text-emerald-200'
                : 'bg-rose-950/70 border-rose-600/60 text-rose-200'
            }`}
          >
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
        )}

        {preparedAction && (
          <div className="mt-1 rounded-xl border border-amber-400/50 bg-red-950/45 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs sm:text-sm text-amber-100">
              <ShieldCheck className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white leading-snug">{preparedAction.summaryFr}</p>
                <p className="mt-0.5 text-xs text-amber-200/90 leading-relaxed">
                  Étape 2/2 : Confirme ton ticket pour lancer la recherche et l’acquisition automatique vers Plex.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setPreparedAction(null)}
                className="rounded-xl border border-stone-700 bg-stone-900 px-3.5 py-1.5 text-xs font-medium text-stone-300 hover:bg-stone-800 cursor-pointer whitespace-nowrap"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmRequest}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer shadow-md whitespace-nowrap"
              >
                {loadingAction ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                <span>Confirmer</span>
              </button>
            </div>
          </div>
        )}

        {/* Trace technique par carte (visible uniquement quand l'Admin active le Mode Debug) */}
        {showTechnicalTrace && (
          <div className="mt-2 rounded-xl border border-amber-500/30 bg-black/80 p-3 text-xs font-mono text-stone-300 space-y-1.5">
            <div className="flex items-center justify-between text-amber-300 font-semibold border-b border-stone-800 pb-1">
              <span className="inline-flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5" />
                <span>TRACE TECHNIQUE (ADMIN DEBUG)</span>
              </span>
              <span>
                TMDB={identity.tmdbId}
                {identity.imdbId ? ` | IMDb=${identity.imdbId}` : ''}
                {identity.tvdbId ? ` | TVDB=${identity.tvdbId}` : ''}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[11px]">
              <div className="rounded bg-stone-900/90 px-2.5 py-1 border border-stone-800">
                <span className="text-stone-400">Plex Catalog:</span>{' '}
                <span className="text-emerald-300">{catalogPresence.state}</span> (
                {catalogPresence.matchedItems.map((m) => `${m.serverName}:${m.libraryTitle}`).join(', ') || 'aucun'})
              </div>
              <div className="rounded bg-stone-900/90 px-2.5 py-1 border border-stone-800">
                <span className="text-stone-400">Overseerr:</span>{' '}
                <span className="text-sky-300">{localEvidence.requestState.state}</span>
                {localEvidence.requestState.requestId ? ` (#${localEvidence.requestState.requestId})` : ''}
              </div>
              <div className="rounded bg-stone-900/90 px-2.5 py-1 border border-stone-800">
                <span className="text-stone-400">
                  {identity.mediaType === 'movie' ? 'Radarr:' : 'Sonarr:'}
                </span>{' '}
                <span className="text-amber-300">{acquisitionPipeline.state}</span>
                {acquisitionPipeline.externalServiceId ? ` (id=${acquisitionPipeline.externalServiceId})` : ''}
              </div>
            </div>
            {localEvidence.provenance.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {localEvidence.provenance.map((p, idx) => (
                  <span
                    key={`${p.source}-${idx}`}
                    className={`rounded px-2 py-0.5 text-[11px] border ${
                      p.status === 'ok'
                        ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
                    }`}
                  >
                    {p.source} ({p.latencyMs}ms){p.detail ? ` → ${p.detail}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
