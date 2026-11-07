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
  Smartphone,
  Info,
  X,
  Search,
  ArrowRight
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
  compactRowMode?: boolean;
  rankNumber?: number;
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

function formatShortDate(iso: string | null, lang: 'fr' | 'en'): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatShortDateTime(iso: string | null | undefined, lang: 'fr' | 'en'): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
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
  compactRowMode = false,
  rankNumber,
  initialPreparedAction = null
}) => {
  const { lang, t } = useI18n();
  const [localEvidence, setLocalEvidence] = useState<MediaEvidence>(evidence);
  const [showAllSeasons, setShowAllSeasons] = useState(false);
  const [synopsisExpanded, setSynopsisExpanded] = useState(!compactSynopsis);
  const [rowExpanded, setRowExpanded] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedSeasons, setSelectedSeasons] = useState<number[]>(evidence.actionability.requestableSeasons);
  const [preparedAction, setPreparedAction] = useState<PreparedActionDTO | null>(initialPreparedAction);

  useEffect(() => {
    if (initialPreparedAction) {
      setPreparedAction(initialPreparedAction);
    }
  }, [initialPreparedAction]);

  useEffect(() => {
    if (!showDetailsModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDetailsModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showDetailsModal]);
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
    if (compactRowMode) {
      setRowExpanded(true);
    }
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
  const vodDateShortFr = formatShortDate(identity.releaseDates.estimatedVodOrDvdDate, lang);
  const cinemaDateFr = formatDate(identity.releaseDates.inCinemas, lang);
  const cinemaDateShortFr = formatShortDate(identity.releaseDates.inCinemas, lang);
  const requestedOrAddedIso = localEvidence.requestState.requestedAt || acquisitionPipeline.addedAt || null;
  const requestedOrAddedDateFr = formatDate(requestedOrAddedIso, lang);
  const requestedOrAddedDateShortFr = formatShortDate(requestedOrAddedIso, lang);
  const requesterName = localEvidence.requestState.requestedByDisplayName || null;
  const sourceOrigin =
    localEvidence.requestState.sourceOrigin ||
    (requesterName
      ? 'overseerr_user'
      : acquisitionPipeline.state !== 'not_in_arr' && acquisitionPipeline.state !== 'unknown'
        ? 'auto_list'
        : null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const isCinemaFuture = Boolean(
    identity.releaseDates.inCinemas && identity.releaseDates.inCinemas.slice(0, 10) > todayIso
  );
  const vodReleaseIso =
    identity.releaseDates.estimatedVodOrDvdDate ||
    identity.releaseDates.digitalRelease ||
    identity.releaseDates.physicalRelease ||
    null;
  const isVodFuture = Boolean(
    identity.releaseDates.estimatedVodOrDvdDate && identity.releaseDates.estimatedVodOrDvdDate > todayIso
  );
  const canRetriggerRadarr = Boolean(
    !actionability.canRequestNow && acquisitionPipeline.canRetriggerSearch
  );
  const lastSearchIso =
    acquisitionPipeline.lastSearchAt ||
    localEvidence.requestState.requestedAt ||
    acquisitionPipeline.addedAt ||
    null;
  const lastSearchDateFr = formatDate(lastSearchIso, lang);
  const lastSearchDateShortFr = formatShortDate(lastSearchIso, lang);
  const lastSearchDateTimeFr = formatShortDateTime(acquisitionPipeline.lastSearchAt, lang);
  const cooldownEndsDateTimeFr = formatShortDateTime(acquisitionPipeline.retriggerCooldownEndsAt, lang);
  const retriggerBlockedByCooldown = Boolean(acquisitionPipeline.retriggerBlockedByCooldown);
  const lastSearchReports = acquisitionPipeline.lastSearchReportsDownloaded ?? null;
  const lastSearchDuration = acquisitionPipeline.lastSearchDurationSeconds ?? null;
  const searchedBeforeVodRelease = Boolean(
    !isVodFuture &&
      vodReleaseIso &&
      lastSearchIso &&
      lastSearchIso.slice(0, 10) < vodReleaseIso.slice(0, 10) &&
      (acquisitionPipeline.lastSearchSource === 'initial_request' || !acquisitionPipeline.lastSearchSource)
  );

  // Code visuel LED 3 états ultra-lisible en un clin d'œil :
  // 1) 'available' (LED Verte) : Disponible sur Plex
  // 2) 'waitlist'  (LED Orange) : Dans la liste d'attente / En téléchargement (Radarr/Sonarr/Overseerr)
  // 3) 'missing'   (LED Grise/Rouge discrète) : Non disponible sur Plex (demandable)
  const isAvailableOnPlex =
    catalogPresence.state === 'available_now' && catalogPresence.accessibleToCurrentUser !== false;
  const isDownloadingNow = !isAvailableOnPlex && acquisitionPipeline.state === 'downloading';
  const isInWaitingList =
    !isAvailableOnPlex &&
    (isDownloadingNow ||
      acquisitionPipeline.state === 'monitored_waiting_release' ||
      acquisitionPipeline.state === 'monitored_searching' ||
      acquisitionPipeline.state === 'imported_on_disk' ||
      localEvidence.requestState.state === 'pending_approval' ||
      localEvidence.requestState.state === 'approved_processing' ||
      sourceOrigin === 'auto_list' ||
      !actionability.canRequestNow);
  const ledState: 'available' | 'waitlist' | 'missing' = isAvailableOnPlex
    ? 'available'
    : isInWaitingList
      ? 'waitlist'
      : 'missing';

  const statusLabelText = getLocalizedStatusLabel(actionability.userFriendlyStatusLabel, lang);

  // Formatage homogène et sans doublon pour que toutes les cartes aient exactement la même structure et hauteur
  const availServers = catalogPresence.availableServers || [];
  const compactServersLabel =
    availServers.length === 0
      ? ''
      : availServers.length <= 2
        ? ` (${availServers.join(', ')})`
        : ` (${availServers.slice(0, 2).join(', ')} +${availServers.length - 2})`;

  const statusPrimaryTitle =
    ledState === 'available'
      ? lang === 'en'
        ? `Available on Plex${compactServersLabel}`
        : `Disponible sur Plex${compactServersLabel}`
      : ledState === 'waitlist'
        ? isDownloadingNow
          ? lang === 'en'
            ? 'Downloading to Plex'
            : 'Téléchargement en cours vers Plex'
          : lang === 'en'
            ? 'In Plex waiting list'
            : "Dans la liste d'attente Plex"
        : lang === 'en'
          ? 'Not available on Plex'
          : 'Non disponible sur Plex';

  const originText = requesterName
    ? `${t('requested_by', { name: requesterName })}${requestedOrAddedDateFr ? ` (${requestedOrAddedDateFr})` : ''}`
    : sourceOrigin === 'auto_list'
      ? `${t('auto_list')}${requestedOrAddedDateFr ? ` (${requestedOrAddedDateFr})` : ''}`
      : null;

  const statusSecondarySubtitle =
    ledState === 'available'
      ? originText || (lang === 'en' ? 'Ready to watch now on your Plex catalog' : 'Prêt à regarder immédiatement sur ton catalogue')
      : ledState === 'waitlist'
        ? originText
          ? `${originText} • ${lang === 'en' ? 'Auto-added upon release' : 'Ajout auto sur Plex dès sortie'}`
          : lang === 'en'
            ? 'Monitored automatically • Added upon VOD/DVD release'
            : 'Surveillé automatiquement • Ajouté dès la sortie VOD/DVD'
        : lang === 'en'
          ? 'Not on Plex yet — Available on request'
          : 'Pas encore sur Plex — Disponible à la demande';

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

  const mdblistTrace = localEvidence.provenance.find((p) => p.source === 'mdblist');

  return (
    <div
      className={`group flex flex-col justify-between relative overflow-hidden transition-all ${
        compactRowMode
          ? rowExpanded
            ? 'bg-amber-500/[0.04]'
            : 'hover:bg-amber-500/[0.06]'
          : embeddedInChat
            ? 'rounded-2xl bg-black/45 border border-amber-500/25 p-3.5 sm:p-4 shadow-[0_8px_28px_rgba(0,0,0,0.65)]'
            : 'rounded-2xl cinema-poster-card p-4 sm:p-5 lg:p-6'
      }`}
    >
      {/* Fine ligne lumineuse dorée en haut de l'affiche (uniquement en mode Grandes Fiches) */}
      {!compactRowMode && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/50 to-transparent opacity-75 group-hover:opacity-100 transition-opacity" />
      )}

      {/* Ligne de tableau alignée en colonnes (toujours visible en mode Liste Compacte : clic = déplier / replier) */}
      {compactRowMode && (
        <div
          onClick={() => setRowExpanded((v) => !v)}
          className={`flex flex-col gap-2 px-3 py-2.5 sm:px-3.5 sm:py-2.5 cursor-pointer select-none transition-colors ${
            rowExpanded ? 'bg-amber-500/[0.08]' : ''
          }`}
          title={
            rowExpanded
              ? lang === 'en'
                ? 'Click to collapse movie sheet'
                : 'Cliquer pour replier la fiche'
              : lang === 'en'
                ? 'Click to expand full movie sheet'
                : 'Cliquer pour déplier la fiche complète'
          }
        >
          <div className="flex flex-wrap items-center gap-2.5 md:grid md:grid-cols-[minmax(260px,1fr)_88px_150px_90px_148px] md:items-center md:gap-3">
            {/* Colonne 1 : #Rang + Jaquette 2:3 agrandie + Titre complet (Année) + Durée & Réalisateur */}
            <div className="flex items-center gap-3 min-w-0 flex-1 md:flex-initial">
              {typeof rankNumber === 'number' && (
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-500/15 border border-amber-500/35 text-xs font-mono font-bold text-amber-300 shrink-0">
                  {rankNumber}
                </span>
              )}

              {/* Jaquette 2:3 plus grande et lisible (w-12 sm:w-13 ~ 48-52px de large) */}
              <div className="relative w-12 sm:w-[52px] aspect-[2/3] shrink-0 overflow-hidden rounded-lg bg-stone-950 border border-amber-500/35 shadow-md">
                {identity.posterUrl ? (
                  <img
                    src={identity.posterUrl}
                    alt={identity.titleFr}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-amber-500/50 bg-stone-950">
                    {identity.mediaType === 'movie' ? (
                      <Film className="h-5 w-5" />
                    ) : (
                      <Tv className="h-5 w-5" />
                    )}
                  </div>
                )}
              </div>

              {/* Titre complet (sans troncature abusive) + Sous-ligne Durée & Réalisateur */}
              <div className="min-w-0 flex-1">
                <div className="text-sm sm:text-[15px] font-bold text-white leading-snug break-words">
                  <span>{identity.titleFr}</span>
                  {identity.year ? (
                    <span className="font-mono font-normal text-xs sm:text-[13px] text-amber-300/90 ml-1.5 whitespace-nowrap">
                      ({identity.year})
                    </span>
                  ) : null}
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-stone-400">
                  {formatDuration(identity.runtimeMinutes) && (
                    <span className="font-semibold text-amber-300/90 shrink-0">
                      {formatDuration(identity.runtimeMinutes)}
                    </span>
                  )}
                  {identity.directorOrCreator && (
                    <span className="truncate max-w-[220px]">
                      {formatDuration(identity.runtimeMinutes) ? '• ' : ''}
                      {identity.directorOrCreator}
                    </span>
                  )}
                  {showTechnicalTrace && (
                    <span className="hidden lg:inline-flex items-center gap-1 rounded bg-black/80 border border-amber-500/30 px-1.5 py-0.2 text-[9px] font-mono text-amber-300/90 shrink-0">
                      <Terminal className="h-2.5 w-2.5 shrink-0" />
                      <span>
                        TMDB={identity.tmdbId}
                        {mdblistTrace ? ` • mdblist (${mdblistTrace.latencyMs}ms)` : ''}
                      </span>
                    </span>
                  )}
                  {/* Sur mobile (< md) : note + pastille couleur Plex sous le titre */}
                  <span className="md:hidden inline-flex items-center gap-1.5 font-semibold">
                    {rating !== null && rating > 0 && (
                      <span className="text-amber-300">★ {rating.toFixed(1)}</span>
                    )}
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        ledState === 'available'
                          ? 'bg-emerald-400'
                          : ledState === 'waitlist'
                            ? 'bg-amber-400'
                            : 'bg-rose-500'
                      }`}
                    />
                  </span>
                </div>
              </div>
            </div>

            {/* Colonne 2 : NOTE (alignée à 88px dès md:) */}
            <div className="hidden md:flex items-center">
              {rating !== null && rating > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-400/50 px-2 py-0.5 text-xs font-bold text-amber-200 whitespace-nowrap">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                  <span>{rating.toFixed(1)}</span>
                  <span className="text-[9px] font-semibold text-amber-300/85 uppercase">
                    {identity.ratings.imdbOrAudienceRating !== null ? 'IMDb' : 'TMDB'}
                  </span>
                </span>
              ) : (
                <span className="text-xs font-mono text-stone-500">—</span>
              )}
            </div>

            {/* Colonne 3 : GENRES (alignée à 150px dès md:) */}
            <div className="hidden md:flex flex-wrap items-center gap-1 min-w-0">
              {identity.genres.length > 0 ? (
                identity.genres.slice(0, 2).map((g) => (
                  <span
                    key={g}
                    className="rounded-md bg-stone-900/90 border border-amber-500/25 px-2 py-0.5 text-[10px] font-medium text-amber-100/90 truncate max-w-[115px]"
                  >
                    {g}
                  </span>
                ))
              ) : (
                <span className="text-xs font-mono text-stone-500">—</span>
              )}
              {identity.genres.length > 2 && (
                <span className="text-[10px] font-mono text-stone-400">
                  +{identity.genres.length - 2}
                </span>
              )}
            </div>

            {/* Colonne 4 : PLEX (code couleur Vert / Orange / Rouge centré sur 90px) */}
            <div
              className="hidden md:flex items-center justify-center"
              title={`${statusPrimaryTitle}${originText ? ` • ${originText}` : ''}`}
            >
              {ledState === 'available' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/45 px-2.5 py-0.5 text-[11px] font-bold text-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.95)] shrink-0" />
                  <span>{lang === 'en' ? 'Ready' : 'Dispo'}</span>
                </span>
              ) : ledState === 'waitlist' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/45 px-2.5 py-0.5 text-[11px] font-bold text-amber-200">
                  <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.95)] animate-pulse shrink-0" />
                  <span>{lang === 'en' ? 'Wait' : 'Attente'}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 border border-rose-500/40 px-2.5 py-0.5 text-[11px] font-bold text-rose-200">
                  <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                  <span>{lang === 'en' ? 'Missing' : 'Absent'}</span>
                </span>
              )}
            </div>

            {/* Colonne 5 : ACTIONS (bouton court ▶ Plex / + Demander + chevron accordéon ▾/▴) */}
            <div
              className="flex items-center justify-end gap-1.5 shrink-0 ml-auto md:ml-0"
              onClick={(e) => e.stopPropagation()}
            >
              {plexWebUrl && (
                <a
                  href={primaryPlexHref || plexWebUrl}
                  target={isMobileDevice ? undefined : '_blank'}
                  rel={isMobileDevice ? undefined : 'noopener noreferrer'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-3 py-1.5 text-xs font-bold text-stone-950 shadow-[0_3px_12px_rgba(245,158,11,0.3)] hover:from-amber-400 hover:to-yellow-400 transition cursor-pointer whitespace-nowrap"
                  title={`${statusPrimaryTitle} — Cliquer pour lancer dans Plex`}
                >
                  <Play className="h-3 w-3 fill-stone-950 text-stone-950 shrink-0" />
                  <span>Plex</span>
                </a>
              )}

              {actionability.canRequestNow && !preparedAction && (
                <button
                  type="button"
                  disabled={
                    loadingAction || (identity.mediaType === 'tv' && selectedSeasons.length === 0)
                  }
                  onClick={handlePrepareRequest}
                  className="cinema-velvet-pill inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white hover:brightness-110 disabled:opacity-50 transition cursor-pointer whitespace-nowrap"
                  title={actionability.userFriendlyExplanationFr}
                >
                  {loadingAction ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  ) : (
                    <PlusCircle className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                  )}
                  <span>{lang === 'en' ? 'Request' : 'Demander'}</span>
                </button>
              )}

              {canRetriggerRadarr && !preparedAction && (
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={handlePrepareRequest}
                  className="inline-flex items-center gap-1 rounded-xl border border-amber-400/55 bg-amber-500/20 hover:bg-amber-500/35 px-2.5 py-1.5 text-xs font-bold text-amber-100 disabled:opacity-50 transition cursor-pointer whitespace-nowrap"
                  title={
                    lang === 'en'
                      ? 'Movie is already released on VOD/DVD — Trigger a fresh Radarr search on indexers'
                      : 'Film déjà sorti en VOD/DVD — Relancer une recherche immédiate dans Radarr'
                  }
                >
                  {loadingAction ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                  )}
                  <span>{lang === 'en' ? 'Re-search' : 'Relancer'}</span>
                </button>
              )}

              {!canRetriggerRadarr && retriggerBlockedByCooldown && !preparedAction && (
                <span
                  className="inline-flex items-center gap-1 rounded-xl border border-stone-700/80 bg-stone-900/90 px-2.5 py-1.5 text-[11px] font-medium text-stone-400 whitespace-nowrap"
                  title={
                    lang === 'en'
                      ? `Already re-searched recently${lastSearchDateTimeFr ? ` (${lastSearchDateTimeFr})` : ''}${cooldownEndsDateTimeFr ? ` — Next manual retrigger available at ${cooldownEndsDateTimeFr}` : ''}`
                      : `Déjà relancé récemment${lastSearchDateTimeFr ? ` (${lastSearchDateTimeFr}${acquisitionPipeline.lastSearchBy ? ` par ${acquisitionPipeline.lastSearchBy}` : ''})` : ''}${cooldownEndsDateTimeFr ? ` — Prochaine relance possible dès le ${cooldownEndsDateTimeFr}` : ''}`
                  }
                >
                  <Clock className="h-3 w-3 text-amber-400/80 shrink-0" />
                  <span>{lang === 'en' ? 'Cooldown' : 'Déjà relancé'}</span>
                </span>
              )}

              <button
                type="button"
                onClick={() => setRowExpanded((v) => !v)}
                className={`inline-flex items-center justify-center rounded-xl border p-1.5 transition cursor-pointer ${
                  rowExpanded
                    ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                    : 'border-stone-700/80 bg-stone-900/90 hover:bg-stone-800 hover:border-amber-500/40 text-stone-300 hover:text-amber-200'
                }`}
                title={
                  rowExpanded
                    ? lang === 'en'
                      ? 'Collapse sheet'
                      : 'Replier la fiche'
                    : lang === 'en'
                      ? 'Expand full sheet'
                      : 'Déplier la fiche'
                }
                aria-label={rowExpanded ? 'Replier la fiche' : 'Déplier la fiche'}
              >
                {rowExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {!rowExpanded && feedbackMessage && (
            <div
              onClick={(e) => e.stopPropagation()}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
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

          {!rowExpanded && preparedAction && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="rounded-xl border border-amber-400/50 bg-red-950/45 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
            >
              <div className="flex items-start gap-2 text-xs text-amber-100">
                <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white leading-snug">{preparedAction.summaryFr}</p>
                  <p className="text-[11px] text-amber-200/90">
                    Étape 2/2 : Confirme ton ticket pour lancer l’acquisition automatique vers Plex.
                  </p>
                  {preparedAction.quotaInfoFr && (
                    <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-black/40 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                      <Clock className="h-2.5 w-2.5 shrink-0" />
                      <span>{preparedAction.quotaInfoFr}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={() => setPreparedAction(null)}
                  className="rounded-xl border border-stone-700 bg-stone-900 px-3 py-1 text-xs font-medium text-stone-300 hover:bg-stone-800 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={handleConfirmRequest}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer shadow-md"
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
        </div>
      )}

      {(!compactRowMode || rowExpanded) && (
        <div
          className={
            compactRowMode
              ? 'border-t border-amber-500/20 bg-stone-950/45 px-3.5 py-3.5 sm:px-4 sm:py-4'
              : ''
          }
        >
          <div>
        {/* Grille Responsive :
            - Mobile (< sm) : Ligne 1 = Jaquette 2:3 + Identité côte à côte ; Ligne 2 (col-span-2 pleine largeur sous la jaquette) = Statut LED + Dates + Saisons
            - Desktop (sm+) : Colonne gauche (sm:row-span-2) = Jaquette 2:3 grand format ; Colonne droite (sm:col-start-2) = Identité + Statut LED + Dates + Synopsis inline */}
        <div
          className={`grid items-start gap-x-3.5 sm:gap-x-4 gap-y-3 ${
            embeddedInChat
              ? 'grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[8.5rem_minmax(0,1fr)] lg:grid-cols-[9.5rem_minmax(0,1fr)]'
              : 'grid-cols-[7rem_minmax(0,1fr)] sm:grid-cols-[9.5rem_minmax(0,1fr)] lg:grid-cols-[10.5rem_minmax(0,1fr)]'
          }`}
        >
          {/* Jaquette 2:3 entière (object-contain, aucun badge par-dessus pour ne jamais masquer l'affiche) */}
          <button
            type="button"
            onClick={() => setShowDetailsModal(true)}
            title={
              lang === 'en'
                ? `View full details & poster for "${identity.titleFr}"`
                : `Voir la fiche complète et l'affiche entière de « ${identity.titleFr} »`
            }
            className="col-span-1 row-span-1 sm:row-span-2 relative w-full aspect-[2/3] overflow-hidden rounded-xl bg-stone-950 border border-amber-500/35 shadow-[0_10px_25px_rgba(0,0,0,0.85)] group/poster cursor-pointer text-left"
          >
            {identity.posterUrl ? (
              <img
                src={identity.posterUrl}
                alt={identity.titleFr}
                className="h-full w-full object-contain bg-stone-950 transition-transform duration-500 group-hover/poster:scale-[1.03]"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-amber-500/50 p-2 text-center bg-gradient-to-b from-stone-900 to-black">
                {identity.mediaType === 'movie' ? <Film className="h-8 w-8" /> : <Tv className="h-8 w-8" />}
                <span className="text-xs font-medium text-stone-400">{identity.titleFr}</span>
              </div>
            )}
            <div className="absolute inset-0 bg-black/45 opacity-0 group-hover/poster:opacity-100 transition-opacity flex items-center justify-center">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-black shadow-lg">
                <Info className="h-3.5 w-3.5" />
                <span>{lang === 'en' ? 'Details' : 'Fiche'}</span>
              </span>
            </div>
          </button>

          {/* Identité du film/série : Zéro troncature, retour à la ligne naturel */}
          <div className="col-start-2 row-start-1 min-w-0">
            {/* Ligne 1 : Titre complet + Année + Note avec source réelle */}
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base sm:text-lg font-bold text-white leading-snug tracking-tight min-w-0 break-words">
                {identity.titleFr}{' '}
                {identity.year ? (
                  <span className="font-normal text-amber-300/90 text-sm sm:text-base whitespace-nowrap">
                    ({identity.year})
                  </span>
                ) : null}
              </h3>

              {rating !== null && rating > 0 ? (
                <div
                  className="flex shrink-0 items-center gap-1 rounded-xl bg-gradient-to-br from-amber-500/25 to-yellow-600/10 border border-amber-400/50 px-2 py-0.5 text-xs sm:text-sm font-bold text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.18)]"
                  title={
                    identity.ratings.imdbOrAudienceRating !== null
                      ? lang === 'en'
                        ? 'IMDb / Audience rating out of 10'
                        : 'Note IMDb / Spectateurs sur 10'
                      : lang === 'en'
                        ? 'TMDB rating out of 10'
                        : 'Note TMDB sur 10'
                  }
                >
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />
                  <span>{rating.toFixed(1)}</span>
                  <span className="text-[10px] font-semibold text-amber-300/80 uppercase">
                    {identity.ratings.imdbOrAudienceRating !== null ? 'IMDb' : 'TMDB'}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Ligne 2 : Titre original (affiché uniquement s'il diffère du titre FR, sans troncature) */}
            {showOriginalTitle && (
              <p className="mt-0.5 text-xs italic text-stone-400 leading-snug break-words">
                {lang === 'en' ? 'Original title:' : 'Titre original :'} {identity.originalTitle}
              </p>
            )}

            {/* Ligne 3 : Type + Durée + TOUS les Genres (flex-wrap, zéro troncature "( M... )") */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-200">
              <span className="rounded-md bg-amber-500/15 border border-amber-500/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                {identity.mediaType === 'movie'
                  ? lang === 'en'
                    ? '🎬 Movie'
                    : '🎬 Film'
                  : lang === 'en'
                    ? '📺 Series'
                    : '📺 Série'}
              </span>
              {formatDuration(identity.runtimeMinutes) && (
                <span className="text-amber-300/90 text-xs font-semibold">
                  • {formatDuration(identity.runtimeMinutes)}
                </span>
              )}
              {identity.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-stone-900/90 border border-amber-500/25 px-2 py-0.5 text-[11px] font-medium text-amber-100/95"
                >
                  {g}
                </span>
              ))}
            </div>

            {/* Lignes 4 & 5 : Réalisateur & Casting (sans troncature, retour à la ligne propre) */}
            <div className="mt-2 space-y-1 text-xs sm:text-[13px] text-stone-300 leading-snug">
              {identity.directorOrCreator && (
                <p className="break-words">
                  <strong className="text-amber-200/95 font-semibold">
                    {identity.mediaType === 'movie' ? t('director') : t('creator')}
                  </strong>{' '}
                  <span className="text-white font-medium">{identity.directorOrCreator}</span>
                </p>
              )}
              {identity.topCast.length > 0 && (
                <p className="break-words">
                  <strong className="text-amber-200/95 font-semibold">{t('cast')}</strong>{' '}
                  <span>{identity.topCast.slice(0, 4).join(', ')}</span>
                </p>
              )}
            </div>
          </div>

          {/* Partie Statut LED + Dates + Synopsis Desktop + Saisons :
              - Sur Mobile (< sm) : col-span-2 (100% pleine largeur sous la jaquette)
              - Sur Desktop (sm+) : sm:col-span-1 sm:col-start-2 (dans la colonne de droite à côté de la jaquette) */}
          <div className="col-span-2 sm:col-span-1 sm:col-start-2 row-start-2 min-w-0 space-y-2">
            {ledState === 'available' ? (
              <div
                onClick={() => {
                  if (primaryPlexHref) {
                    window.open(primaryPlexHref, isMobileDevice ? '_self' : '_blank', 'noopener,noreferrer');
                  }
                }}
                title={statusLabelText}
                className={`rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-3 py-2 shadow-[0_0_15px_rgba(16,185,129,0.12)] transition ${
                  primaryPlexHref ? ' hover:brightness-110 cursor-pointer' : ''
                }`}
              >
                <div className="flex items-start gap-2 text-xs sm:text-[13px] font-bold text-emerald-100 leading-snug">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.95)] shrink-0" />
                  <span className="break-words">{statusPrimaryTitle}</span>
                </div>
                <div className="mt-0.5 flex items-start gap-1.5 text-[11px] sm:text-xs text-emerald-200/90 leading-snug">
                  <Clock className="mt-0.5 h-3 w-3 text-emerald-300 shrink-0" />
                  <span className="break-words">{statusSecondarySubtitle}</span>
                </div>
              </div>
            ) : ledState === 'waitlist' ? (
              <div
                title={statusLabelText}
                className="rounded-xl border border-amber-400/45 bg-gradient-to-b from-amber-500/[0.14] to-stone-950/90 px-3 py-2.5 shadow-[0_0_18px_rgba(245,158,11,0.12)] space-y-2.5"
              >
                {/* En-tête de statut sans doublon de dates */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs sm:text-[13px] font-bold text-amber-100 leading-snug">
                    {isDownloadingNow ? (
                      <Download className="h-3.5 w-3.5 text-amber-300 animate-bounce shrink-0" />
                    ) : (
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.95)] animate-pulse shrink-0" />
                    )}
                    <span className="break-words">{statusPrimaryTitle}</span>
                  </div>

                  {searchedBeforeVodRelease ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/25 border border-amber-400/60 px-2.5 py-0.5 text-[10px] font-bold text-amber-200">
                      ⚠️{' '}
                      {lang === 'en'
                        ? 'Searched before VOD — Re-trigger ready'
                        : 'Cherché avant VOD — Relance dispo'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-stone-900/80 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-200/90">
                      <Clock className="h-2.5 w-2.5 text-amber-300 shrink-0" />
                      <span>
                        {lang === 'en' ? 'Auto-added upon release' : 'Ajout auto sur Plex dès dispo'}
                      </span>
                    </span>
                  )}
                </div>

                {/* Frise chronologique unifiée en 4 étapes (Cinéma ➔ Demande ➔ VOD/DVD ➔ Radarr) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
                  {/* Étape 1 : Sortie Cinéma */}
                  <div className="relative rounded-lg bg-stone-950/85 border border-stone-800/90 px-2.5 py-1.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                      <span className="inline-flex items-center gap-1 truncate">
                        <Clapperboard className="h-3 w-3 text-red-400 shrink-0" />
                        <span>{lang === 'en' ? '1. Theaters' : '1. Sortie ciné'}</span>
                      </span>
                      <ArrowRight className="hidden sm:block h-2.5 w-2.5 text-stone-600 shrink-0" />
                    </div>
                    <div className="font-bold text-[11px] sm:text-xs text-stone-100 mt-1 truncate">
                      {cinemaDateShortFr || (identity.year ? String(identity.year) : '—')}
                    </div>
                    <div className="text-[10px] text-stone-400 truncate">
                      {isCinemaFuture
                        ? lang === 'en'
                          ? '⏳ Upcoming in theaters'
                          : '⏳ Prochainement en salle'
                        : lang === 'en'
                          ? '✓ Released in theaters'
                          : '✓ Sorti en salle'}
                    </div>
                  </div>

                  {/* Étape 2 : Demande / Ajout */}
                  <div className="relative rounded-lg bg-stone-950/85 border border-stone-800/90 px-2.5 py-1.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                      <span className="inline-flex items-center gap-1 truncate">
                        <PlusCircle className="h-3 w-3 text-amber-400 shrink-0" />
                        <span>{lang === 'en' ? '2. Request' : '2. Demande'}</span>
                      </span>
                      <ArrowRight className="hidden sm:block h-2.5 w-2.5 text-stone-600 shrink-0" />
                    </div>
                    <div className="font-bold text-[11px] sm:text-xs text-stone-100 mt-1 truncate">
                      {requestedOrAddedDateShortFr || '—'}
                    </div>
                    <div className="text-[10px] text-amber-300/95 font-medium truncate">
                      {requesterName
                        ? lang === 'en'
                          ? `By ${requesterName}`
                          : `Par ${requesterName}`
                        : sourceOrigin === 'auto_list'
                          ? lang === 'en'
                            ? 'Auto list'
                            : 'Liste automatique'
                          : 'Overseerr / Radarr'}
                    </div>
                  </div>

                  {/* Étape 3 : Sortie VOD / DVD */}
                  <div
                    className={`relative rounded-lg bg-stone-950/85 border px-2.5 py-1.5 flex flex-col justify-between ${
                      isVodFuture ? 'border-amber-500/35' : 'border-emerald-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                      <span className="inline-flex items-center gap-1 truncate">
                        <Disc
                          className={`h-3 w-3 shrink-0 ${
                            isVodFuture ? 'text-amber-400' : 'text-emerald-400'
                          }`}
                        />
                        <span>3. VOD / DVD</span>
                      </span>
                      <ArrowRight className="hidden sm:block h-2.5 w-2.5 text-stone-600 shrink-0" />
                    </div>
                    <div className="font-bold text-[11px] sm:text-xs text-stone-100 mt-1 truncate">
                      {vodDateShortFr
                        ? `${identity.releaseDates.isEstimatedDate && isVodFuture ? '~' : ''}${vodDateShortFr}`
                        : lang === 'en'
                          ? 'Released'
                          : 'Déjà sorti'}
                    </div>
                    <div
                      className={`text-[10px] font-medium truncate ${
                        isVodFuture ? 'text-amber-300' : 'text-emerald-300'
                      }`}
                    >
                      {isVodFuture
                        ? lang === 'en'
                          ? '⏳ Awaiting VOD'
                          : '⏳ Attente sortie VOD'
                        : lang === 'en'
                          ? '✓ Out on VOD/DVD'
                          : '✓ Dispo en VOD/DVD'}
                    </div>
                  </div>

                  {/* Étape 4 : Dernière recherche Radarr + Verdict */}
                  <div
                    className={`relative rounded-lg bg-stone-950/85 border px-2.5 py-1.5 flex flex-col justify-between ${
                      lastSearchReports !== null && lastSearchReports > 0
                        ? 'border-emerald-500/45'
                        : acquisitionPipeline.lastSearchSource === 'manual_retrigger'
                          ? 'border-amber-500/40'
                          : 'border-stone-800/90'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                      <span className="inline-flex items-center gap-1 truncate">
                        <Search className="h-3 w-3 text-amber-300 shrink-0" />
                        <span>{lang === 'en' ? '4. Radarr' : '4. Radarr'}</span>
                      </span>
                    </div>
                    <div className="font-bold text-[11px] sm:text-xs text-stone-100 mt-1 truncate">
                      {lastSearchDateShortFr || '—'}
                    </div>
                    <div className="text-[10px] text-amber-300/95 truncate" title={
                      lastSearchReports !== null
                        ? `${lastSearchReports} release(s)${lastSearchDuration !== null ? ` (${lastSearchDuration.toFixed(1).replace('.', ',')} s)` : ''}`
                        : undefined
                    }>
                      {lastSearchReports !== null ? (
                        lastSearchReports > 0 ? (
                          <span className="text-emerald-300 font-semibold">
                            ✓ {lastSearchReports} release{lastSearchReports > 1 ? 's' : ''}
                            {acquisitionPipeline.lastSearchBy ? ` (${acquisitionPipeline.lastSearchBy})` : ''}
                          </span>
                        ) : (
                          <span className="text-stone-300">
                            0 release
                            {lastSearchDuration !== null
                              ? ` (${lastSearchDuration.toFixed(1).replace('.', ',')}s)`
                              : ''}
                            {acquisitionPipeline.lastSearchBy ? ` • ${acquisitionPipeline.lastSearchBy}` : ''}
                          </span>
                        )
                      ) : acquisitionPipeline.lastSearchSource === 'manual_retrigger' ? (
                        lang === 'en'
                          ? `By ${acquisitionPipeline.lastSearchBy || 'user'}`
                          : `Relancée${acquisitionPipeline.lastSearchBy ? ` par ${acquisitionPipeline.lastSearchBy}` : ''}`
                      ) : acquisitionPipeline.lastSearchSource === 'radarr_grab' ? (
                        lang === 'en' ? 'Release grabbed' : 'Release récupérée'
                      ) : (
                        lang === 'en' ? 'Initial search' : 'Recherche initiale'
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                title={statusLabelText}
                className="rounded-xl border border-stone-600/60 bg-stone-900/90 px-3 py-2"
              >
                <div className="flex items-start gap-2 text-xs sm:text-[13px] font-bold text-stone-200 leading-snug">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-rose-500/85 shadow-[0_0_8px_rgba(244,63,94,0.6)] shrink-0" />
                  <span className="break-words">{statusPrimaryTitle}</span>
                </div>
                <div className="mt-0.5 flex items-start gap-1.5 text-[11px] sm:text-xs text-stone-300 leading-snug">
                  <Clock className="mt-0.5 h-3 w-3 text-stone-400 shrink-0" />
                  <span className="break-words">{statusSecondarySubtitle}</span>
                </div>
              </div>
            )}

            {/* Dates de Sortie Cinéma & VOD/DVD (affichées uniquement hors liste d'attente pour éviter tout doublon avec la frise 4 étapes) */}
            {ledState !== 'waitlist' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-lg bg-stone-900/90 border border-stone-700/80 px-2.5 py-1 text-[11px] text-stone-300">
                  <Clapperboard className="h-3 w-3 text-red-400 shrink-0" />
                  <span>
                    {t('theatrical_release', {
                      date: cinemaDateFr || (identity.year ? String(identity.year) : '—')
                    })}
                  </span>
                </span>

                {vodDateFr && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg bg-stone-900/90 border px-2.5 py-1 text-[11px] ${
                      isVodFuture && ledState !== 'available'
                        ? 'border-amber-500/35 text-amber-200 font-medium'
                        : 'border-stone-700/80 text-stone-300'
                    }`}
                  >
                    <Disc
                      className={`h-3 w-3 shrink-0 ${
                        isVodFuture && ledState !== 'available' ? 'text-amber-400' : 'text-stone-400'
                      }`}
                    />
                    <span>
                      {t('vod_release', {
                        date: identity.releaseDates.isEstimatedDate && isVodFuture ? `~${vodDateFr}` : vodDateFr
                      })}
                    </span>
                  </span>
                )}
              </div>
            )}

            {/* Synopsis FR inline sur Desktop (sm:block) ; sur Smartphone (< sm), accessible via le popup "ℹ️ Détails & Synopsis" */}
            {identity.overviewFr && (
              <div className="hidden sm:block pt-0.5">
                <p
                  className={`text-xs sm:text-[13px] leading-relaxed text-stone-200/95 ${
                    compactSynopsis && !synopsisExpanded ? 'line-clamp-2' : ''
                  }`}
                >
                  {identity.overviewFr}
                </p>
                {compactSynopsis && identity.overviewFr.length > 135 && (
                  <button
                    type="button"
                    onClick={() => setSynopsisExpanded((v) => !v)}
                    className="mt-0.5 text-[11px] font-semibold text-amber-300 hover:text-amber-200 cursor-pointer"
                  >
                    {synopsisExpanded ? '− Réduire le synopsis' : '+ Lire tout le synopsis'}
                  </button>
                )}
              </div>
            )}

            {/* Alerte uniquement si l'utilisateur n'a PAS accès au serveur où se trouve le média */}
            {catalogPresence.accessibleToCurrentUser === false &&
              (catalogPresence.availableServers?.length ?? 0) > 0 && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-amber-950/70 border border-amber-500/50 px-3 py-1.5 text-xs text-amber-200">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  Présent sur <strong>{catalogPresence.availableServers?.join(' & ')}</strong>, mais ton compte Plex est rattaché à{' '}
                  <strong>{catalogPresence.userAllowedServers?.join(' & ') || 'un autre serveur'}</strong>.
                </span>
              </div>
            )}

            {/* Pilules compactes des saisons pour les Séries TV */}
            {episodeCoverage && episodeCoverage.seasons.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
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
                {identity.mediaType === 'tv' &&
                  acquisitionPipeline.lastSearchSource === 'manual_retrigger' &&
                  lastSearchDateTimeFr && (
                    <span
                      className="inline-flex items-center gap-1 rounded-lg bg-stone-900/90 border border-amber-500/30 px-2 py-0.5 text-[11px] text-amber-200/90"
                      title={
                        cooldownEndsDateTimeFr
                          ? `Dernière relance manuelle Sonarr le ${lastSearchDateTimeFr}${acquisitionPipeline.lastSearchBy ? ` par ${acquisitionPipeline.lastSearchBy}` : ''}. Prochaine relance possible dès le ${cooldownEndsDateTimeFr}.`
                          : `Dernière relance manuelle Sonarr le ${lastSearchDateTimeFr}${acquisitionPipeline.lastSearchBy ? ` par ${acquisitionPipeline.lastSearchBy}` : ''}.`
                      }
                    >
                      <RefreshCw className="h-3 w-3 text-amber-400 shrink-0" />
                      <span>
                        {lang === 'en'
                          ? `Last Sonarr search: ${lastSearchDateTimeFr}${acquisitionPipeline.lastSearchBy ? ` (${acquisitionPipeline.lastSearchBy})` : ''}`
                          : `Dernière relance Sonarr : ${lastSearchDateTimeFr}${acquisitionPipeline.lastSearchBy ? ` (${acquisitionPipeline.lastSearchBy})` : ''}`}
                      </span>
                    </span>
                  )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Barre d'Actions Unifiée : Ouvrir sur Plex + Lancer sur Apple TV + Compléter/Demander + Similaires */}
      <div className="mt-3 flex flex-col gap-2 border-t border-amber-500/15 pt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Bouton principal Ouvrir sur Plex */}
            {plexWebUrl && (
              <a
                href={plexWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-3 py-1.5 text-xs sm:text-sm font-bold text-stone-950 shadow-[0_4px_15px_rgba(245,158,11,0.3)] hover:from-amber-400 hover:to-yellow-400 active:scale-[0.98] transition cursor-pointer"
                title="Ouvrir directement dans Plex Web"
              >
                <Play className="h-3.5 w-3.5 fill-stone-950 text-stone-950 shrink-0" />
                <span>{t('open_in_plex')}</span>
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

            {/* Statut LED Orange en bas à gauche si le film est dans la liste d'attente (symétrie visuelle avec Ouvrir / Demander sur Plex) */}
            {!plexWebUrl && !actionability.canRequestNow && ledState === 'waitlist' && (
              <div
                className="inline-flex items-center gap-2 rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-1.5 text-xs sm:text-sm font-bold text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.12)]"
                title={actionability.userFriendlyExplanationFr || statusLabelText}
              >
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.95)] animate-pulse shrink-0" />
                <span>
                  {isDownloadingNow
                    ? lang === 'en'
                      ? 'Downloading...'
                      : 'En téléchargement...'
                    : isVodFuture
                      ? lang === 'en'
                        ? 'Awaiting VOD/DVD release'
                        : 'En attente de sortie VOD/DVD'
                      : lang === 'en'
                        ? 'In waiting list'
                        : "En liste d'attente"}
                </span>
              </div>
            )}

            {/* Bouton de relance manuelle Radarr (Cas 2 : film déjà sorti en VOD/DVD mais bloqué en attente sans fichier) */}
            {canRetriggerRadarr && !preparedAction && (
              <button
                type="button"
                disabled={loadingAction}
                onClick={handlePrepareRequest}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/60 bg-amber-500/20 hover:bg-amber-500/35 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-amber-100 active:scale-[0.99] disabled:opacity-50 transition cursor-pointer"
                title={
                  lang === 'en'
                    ? 'Trigger an immediate Radarr indexer search for this movie'
                    : 'Forcer une nouvelle recherche immédiate de ce film dans Radarr sur tous les indexeurs'
                }
              >
                {loadingAction ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                )}
                <span>
                  {lang === 'en' ? 'Re-trigger Radarr search' : 'Relancer la recherche Radarr'}
                </span>
              </button>
            )}

            {/* Indication pédagogique de Cooldown quand le titre a déjà été relancé récemment */}
            {!canRetriggerRadarr && retriggerBlockedByCooldown && !preparedAction && (
              <div
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-700/80 bg-stone-900/90 px-3 py-1.5 text-xs text-stone-300"
                title={
                  lang === 'en'
                    ? 'A cooldown period applies between manual indexer searches to avoid overloading indexers.'
                    : 'Un délai de refroidissement s’applique entre deux relances manuelles pour préserver les indexeurs.'
                }
              >
                <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>
                  {lang === 'en'
                    ? `Re-searched ${lastSearchDateTimeFr || lastSearchDateShortFr || 'recently'}${acquisitionPipeline.lastSearchBy ? ` by ${acquisitionPipeline.lastSearchBy}` : ''}${cooldownEndsDateTimeFr ? ` • Next available: ${cooldownEndsDateTimeFr}` : ''}`
                    : `Déjà relancé le ${lastSearchDateTimeFr || lastSearchDateShortFr || 'récemment'}${acquisitionPipeline.lastSearchBy ? ` par ${acquisitionPipeline.lastSearchBy}` : ''}${cooldownEndsDateTimeFr ? ` • Prochaine relance : ${cooldownEndsDateTimeFr}` : ''}`}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Bouton Fiche Complète / Synopsis (Popup / Bottom Sheet) */}
            <button
              type="button"
              onClick={() => setShowDetailsModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/35 bg-stone-900/90 px-3 py-1.5 text-xs sm:text-sm font-semibold text-amber-100 hover:bg-stone-800 hover:border-amber-400/60 active:scale-[0.99] transition cursor-pointer"
              title={
                lang === 'en'
                  ? 'Open full movie sheet with large uncropped poster & complete synopsis'
                  : 'Ouvrir la fiche complète (jaquette grand format, synopsis intégral et détails)'
              }
            >
              <Info className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span>{lang === 'en' ? 'Details & Synopsis' : 'Détails & Synopsis'}</span>
            </button>

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
                {preparedAction.quotaInfoFr && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-black/45 border border-amber-500/35 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>{preparedAction.quotaInfoFr}</span>
                  </p>
                )}
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
      )}

      {/* Popup / Bottom Sheet : Fiche Complète (Jaquette Grand Format entière + Synopsis Intégral + Métadonnées) */}
      {showDetailsModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setShowDetailsModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label={identity.titleFr}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-2xl max-h-[88dvh] overflow-hidden rounded-t-3xl sm:rounded-2xl bg-[#130a0e] border-t sm:border border-amber-500/45 shadow-[0_-15px_50px_rgba(0,0,0,0.95)] text-left flex flex-col"
          >
            {/* En-tête fixe de la Fiche Film (zéro débordement au scroll) */}
            <div className="shrink-0 px-4 pt-3 pb-3 sm:px-6 sm:pt-5 bg-[#130a0e] border-b border-amber-500/20 z-10">
              {/* Poignée visuelle mobile */}
              <div className="w-12 h-1.5 rounded-full bg-amber-500/35 mx-auto sm:hidden mb-2.5" />

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                      {identity.mediaType === 'movie'
                        ? lang === 'en'
                          ? '🎬 Movie Sheet'
                          : '🎬 Fiche Film'
                        : lang === 'en'
                          ? '📺 Series Sheet'
                          : '📺 Fiche Série'}
                    </span>
                    {rating !== null && rating > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-400/50 px-2 py-0.5 text-xs font-bold text-amber-200">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        <span>{rating.toFixed(1)}/10</span>
                        <span className="text-[10px] uppercase text-amber-300/80">
                          {identity.ratings.imdbOrAudienceRating !== null ? 'IMDb' : 'TMDB'}
                        </span>
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1.5 text-lg sm:text-xl font-bold text-white leading-snug break-words">
                    {identity.titleFr}{' '}
                    {identity.year && (
                      <span className="font-normal text-amber-300">({identity.year})</span>
                    )}
                  </h3>
                  {showOriginalTitle && (
                    <p className="text-xs sm:text-sm italic text-stone-400 mt-0.5 break-words">
                      {lang === 'en' ? 'Original title:' : 'Titre original :'} {identity.originalTitle}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowDetailsModal(false)}
                  className="shrink-0 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700 p-2 text-stone-300 hover:text-white cursor-pointer"
                  aria-label={lang === 'en' ? 'Close' : 'Fermer'}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Corps défilant : Jaquette Grand Format 2:3 entière (non tronquée) + Infos clés */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
                <div className="w-40 sm:w-44 aspect-[2/3] shrink-0 rounded-xl overflow-hidden bg-stone-950 border border-amber-500/40 shadow-[0_12px_30px_rgba(0,0,0,0.45)]">
                  {identity.posterUrl ? (
                    <img
                      src={identity.posterUrl}
                      alt={identity.titleFr}
                      className="h-full w-full object-contain bg-stone-950"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-amber-500/50 p-3 text-center">
                      {identity.mediaType === 'movie' ? <Film className="h-10 w-10" /> : <Tv className="h-10 w-10" />}
                      <span className="text-xs text-stone-400">{identity.titleFr}</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-3 w-full">
                  {/* Genres + Durée */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {formatDuration(identity.runtimeMinutes) && (
                      <span className="rounded-lg bg-amber-500/15 border border-amber-500/35 px-2.5 py-0.5 text-xs font-semibold text-amber-200">
                        ⏱️ {formatDuration(identity.runtimeMinutes)}
                      </span>
                    )}
                    {identity.genres.map((g) => (
                      <span
                        key={g}
                        className="rounded-full bg-stone-900 border border-amber-500/30 px-2.5 py-0.5 text-xs font-medium text-amber-100"
                      >
                        {g}
                      </span>
                    ))}
                  </div>

                  {/* Synopsis complet sans aucune coupure */}
                  <div className="rounded-xl bg-black/55 border border-amber-500/20 p-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-1">
                      {t('synopsis')}
                    </div>
                    <p className="text-xs sm:text-sm leading-relaxed text-stone-200 whitespace-pre-line">
                      {identity.overviewFr ||
                        (lang === 'en' ? 'No synopsis available.' : 'Aucun synopsis renseigné pour ce titre.')}
                    </p>
                  </div>

                  {/* Réalisation & Distribution complète */}
                  <div className="space-y-1.5 text-xs sm:text-sm text-stone-300 bg-stone-950/80 border border-stone-800 rounded-xl p-3">
                    <p className="break-words">
                      <strong className="text-amber-300 font-semibold">
                        {identity.mediaType === 'movie' ? t('director') : t('creator')}
                      </strong>{' '}
                      <span className="text-white font-medium">{identity.directorOrCreator || '—'}</span>
                    </p>
                    <p className="break-words">
                      <strong className="text-amber-300 font-semibold">{t('cast')}</strong>{' '}
                      <span className="text-stone-100">
                        {identity.topCast.length > 0 ? identity.topCast.join(', ') : '—'}
                      </span>
                    </p>
                  </div>

                  {/* Dates de sortie & Disponibilité */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 border border-stone-700 px-2.5 py-1 text-stone-200">
                      <Clapperboard className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      <span>
                        {t('theatrical_release', {
                          date: cinemaDateFr || (identity.year ? String(identity.year) : '—')
                        })}
                      </span>
                    </span>
                    {vodDateFr && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 border border-amber-500/35 px-2.5 py-1 text-amber-200">
                        <Disc className="h-3.5 w-3.5 text-amber-400 shrink-0" />
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
            </div>

            {/* Pied fixe de la fiche : Statut + Actions directes */}
            <div className="shrink-0 px-4 py-3 sm:px-6 pb-[max(1rem,env(safe-area-inset-bottom))] bg-[#130a0e] border-t border-amber-500/20 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                <span
                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                    ledState === 'available'
                      ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                      : ledState === 'waitlist'
                        ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                        : 'bg-rose-500'
                  }`}
                />
                <span
                  className={
                    ledState === 'available'
                      ? 'text-emerald-200'
                      : ledState === 'waitlist'
                        ? 'text-amber-200'
                        : 'text-stone-300'
                  }
                >
                  {statusPrimaryTitle}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {plexWebUrl && (
                  <a
                    href={plexWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-4 py-2 text-xs sm:text-sm font-bold text-stone-950 shadow-md hover:from-amber-400 hover:to-yellow-400 cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5 fill-stone-950 text-stone-950 shrink-0" />
                    <span>{t('open_in_plex')}</span>
                  </a>
                )}

                {actionability.canRequestNow && !preparedAction && (
                  <button
                    type="button"
                    disabled={loadingAction || (identity.mediaType === 'tv' && selectedSeasons.length === 0)}
                    onClick={() => {
                      setShowDetailsModal(false);
                      void handlePrepareRequest();
                    }}
                    className="cinema-velvet-pill inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold text-white cursor-pointer"
                  >
                    <PlusCircle className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                    <span>{requestButtonLabel}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowDetailsModal(false)}
                  className="rounded-xl border border-stone-700 bg-stone-900 hover:bg-stone-800 px-3.5 py-2 text-xs sm:text-sm font-semibold text-stone-300 cursor-pointer"
                >
                  {lang === 'en' ? 'Close' : 'Fermer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
