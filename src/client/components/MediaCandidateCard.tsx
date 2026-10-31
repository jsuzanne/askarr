import React, { useState } from 'react';
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
  ExternalLink,
  Smartphone
} from 'lucide-react';
import type { MediaEvidence, PreparedActionDTO } from '../../shared/types.js';

interface Props {
  evidence: MediaEvidence;
  onAskSimilar?: (evidence: MediaEvidence) => void;
  onEvidenceUpdated?: (updated: MediaEvidence) => void;
  showTechnicalTrace?: boolean;
}

function formatDuration(minutes: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m} min`;
}

function formatDateFr(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const MediaCandidateCard: React.FC<Props> = ({
  evidence,
  onAskSimilar,
  onEvidenceUpdated,
  showTechnicalTrace = false
}) => {
  const [localEvidence, setLocalEvidence] = useState<MediaEvidence>(evidence);
  const [showAllSeasons, setShowAllSeasons] = useState(false);
  const [selectedSeasons, setSelectedSeasons] = useState<number[]>(evidence.actionability.requestableSeasons);
  const [preparedAction, setPreparedAction] = useState<PreparedActionDTO | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  const vodDateFr = formatDateFr(identity.releaseDates.estimatedVodOrDvdDate);
  const cinemaDateFr = formatDateFr(identity.releaseDates.inCinemas);
  const requestedOrAddedDateFr = formatDateFr(
    localEvidence.requestState.requestedAt || acquisitionPipeline.addedAt || null
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

  return (
    <div className="group cinema-poster-card rounded-2xl p-4 sm:p-5 lg:p-6 flex flex-col justify-between relative overflow-hidden">
      {/* Fine ligne lumineuse dorée en haut de l'affiche */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/50 to-transparent opacity-75 group-hover:opacity-100 transition-opacity" />

      <div>
        {/* Partie haute : Affiche de Cinéma + Métadonnées Grand Écran */}
        <div className="flex flex-row items-start gap-3.5 sm:gap-5">
          {/* Affiche Encadrée (cliquable vers Plex si disponible) */}
          <div className="relative h-32 w-22 sm:h-48 sm:w-32 lg:h-52 lg:w-36 shrink-0 overflow-hidden rounded-xl bg-stone-900 border border-amber-500/30 shadow-[0_10px_25px_rgba(0,0,0,0.85)]">
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
            <div className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/85 backdrop-blur-md px-2 py-0.5 text-[10px] sm:text-xs font-cinema tracking-wider uppercase text-amber-300 border border-amber-500/40 shadow">
              {identity.mediaType === 'movie' ? '🎬 FILM' : '📺 SÉRIE'}
            </div>
          </div>

          {/* En-tête, Note IMDb Or, Genres & Distribution */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0">
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white leading-tight break-words tracking-tight">
                  {identity.titleFr}{' '}
                  {identity.year ? (
                    <span className="font-normal text-amber-300/90 text-sm sm:text-base lg:text-lg">
                      ({identity.year})
                    </span>
                  ) : null}
                </h3>
                {showOriginalTitle && (
                  <p className="mt-0.5 text-xs sm:text-sm italic text-stone-400 truncate">
                    Titre original : {identity.originalTitle}
                  </p>
                )}
              </div>

              {rating !== null && rating > 0 && (
                <div
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br from-amber-500/25 to-yellow-600/10 border border-amber-400/50 px-2.5 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm lg:text-base font-bold text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.18)]"
                  title="Note IMDb / Spectateurs sur 10"
                >
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400 shrink-0" />
                  <span>{rating.toFixed(1)}</span>
                </div>
              )}
            </div>

            {/* Genres & Durée */}
            <div className="mt-2 sm:mt-2.5 flex flex-wrap items-center gap-1.5 text-xs sm:text-sm text-stone-200">
              {identity.genres.slice(0, 4).map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-stone-900/90 border border-amber-500/25 px-2.5 py-0.5 text-[11px] sm:text-xs lg:text-sm font-medium text-amber-100/90"
                >
                  {g}
                </span>
              ))}
              {formatDuration(identity.runtimeMinutes) && (
                <span className="text-amber-300/80 text-xs sm:text-sm font-medium ml-1">
                  • {formatDuration(identity.runtimeMinutes)}
                </span>
              )}
            </div>

            {/* Réalisateur & Casting */}
            {(identity.directorOrCreator || identity.topCast.length > 0) && (
              <div className="mt-2.5 space-y-1 text-xs sm:text-sm lg:text-[15px] text-stone-300 leading-snug">
                {identity.directorOrCreator && (
                  <p className="line-clamp-1">
                    <strong className="text-amber-200/95 font-semibold">
                      {identity.mediaType === 'movie' ? 'Réalisation :' : 'Création :'}
                    </strong>{' '}
                    <span className="text-white font-medium">{identity.directorOrCreator}</span>
                  </p>
                )}
                {identity.topCast.length > 0 && (
                  <p className="line-clamp-2">
                    <strong className="text-amber-200/95 font-semibold">Avec :</strong>{' '}
                    <span>{identity.topCast.slice(0, 4).join(', ')}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Synopsis FR */}
        {identity.overviewFr && (
          <p className="mt-3.5 text-[13px] sm:text-sm lg:text-[15px] leading-relaxed text-stone-200/95 line-clamp-3 sm:line-clamp-4">
            {identity.overviewFr}
          </p>
        )}
      </div>

      {/* Bandeau de Disponibilité Salle Plex Multi-Serveurs / Liste d'attente / Sortie DVD-VOD */}
      <div className="mt-4 flex flex-col gap-2.5 border-t border-amber-500/15 pt-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {primaryPlexHref ? (
            <a
              href={primaryPlexHref}
              target={isMobileDevice ? undefined : '_blank'}
              rel={isMobileDevice ? undefined : 'noopener noreferrer'}
              title="Cliquer pour ouvrir directement dans Plex"
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs sm:text-sm font-semibold hover:brightness-110 transition cursor-pointer ${toneBadgeClasses[actionability.statusTone]}`}
            >
              <CheckCircle2 className="h-4 w-4 sm:h-4.5 sm:w-4.5 shrink-0 text-emerald-400" />
              <span>{actionability.userFriendlyStatusLabel}</span>
              <ExternalLink className="h-3.5 w-3.5 opacity-80 shrink-0" />
            </a>
          ) : (
            <div
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs sm:text-sm font-semibold ${toneBadgeClasses[actionability.statusTone]}`}
            >
              {catalogPresence.state === 'available_now' ? (
                <CheckCircle2 className="h-4 w-4 sm:h-4.5 sm:w-4.5 shrink-0 text-emerald-400" />
              ) : acquisitionPipeline.state === 'downloading' ? (
                <Download className="h-4 w-4 sm:h-4.5 sm:w-4.5 shrink-0 animate-bounce" />
              ) : (
                <Clock className="h-4 w-4 sm:h-4.5 sm:w-4.5 shrink-0" />
              )}
              <span>{actionability.userFriendlyStatusLabel}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/* Boutons directs Plex (App iPhone / PC Web) */}
            {plexWebUrl && (
              <a
                href={primaryPlexHref || plexWebUrl}
                target={isMobileDevice ? undefined : '_blank'}
                rel={isMobileDevice ? undefined : 'noopener noreferrer'}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-stone-950 shadow-[0_4px_15px_rgba(245,158,11,0.35)] hover:from-amber-400 hover:to-yellow-400 active:scale-[0.98] transition cursor-pointer"
                title={
                  isMobileDevice
                    ? "Ouvrir directement dans l'application Plex (iPhone / iPad)"
                    : 'Ouvrir directement dans Plex Web (PC / Mac)'
                }
              >
                <Play className="h-3.5 w-3.5 sm:h-4 sm:w-4 fill-stone-950 text-stone-950 shrink-0" />
                <span>{isMobileDevice ? "Ouvrir l'app Plex" : 'Ouvrir sur Plex'}</span>
              </a>
            )}

            {plexIosDeepLink && !isMobileDevice && (
              <a
                href={plexIosDeepLink}
                className="inline-flex items-center gap-1 rounded-xl border border-amber-500/40 bg-stone-900/90 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 hover:border-amber-400 transition cursor-pointer"
                title="Lien natif plex:// (ouvre l'application Plex installée sur iPhone/iPad/Mac)"
              >
                <Smartphone className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>App native</span>
              </a>
            )}

            {plexWebUrl && isMobileDevice && (
              <a
                href={plexWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-xl border border-amber-500/40 bg-stone-900/90 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 transition cursor-pointer"
                title="Ouvrir dans le navigateur Plex Web (app.plex.tv)"
              >
                <ExternalLink className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>Plex Web</span>
              </a>
            )}

            {evidence.identity.tmdbId > 0 && onAskSimilar && (
              <button
                type="button"
                onClick={() => onAskSimilar(evidence)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs sm:text-sm font-semibold text-amber-200 hover:bg-amber-500/20 hover:border-amber-400/60 active:scale-[0.99] transition cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-400" />
                <span>Films similaires</span>
              </button>
            )}
          </div>
        </div>

        {/* Détail multi-serveurs Plex & Accès Personnel de l'utilisateur */}
        {catalogPresence.matchedItems.length > 0 && (
          <div className="flex flex-col gap-1.5 text-xs sm:text-sm text-stone-200">
            <div className="flex flex-wrap items-center gap-2">
              {catalogPresence.matchedItems.map((m) => {
                const serversText =
                  catalogPresence.availableServers && catalogPresence.availableServers.length > 1
                    ? `Partagée (${catalogPresence.availableServers.join(', ')})`
                    : m.isSharedAcrossAllServers
                      ? 'Partagée (NucVillers & NucBuntu)'
                      : `Serveur ${m.serverName} uniquement`;
                return (
                  <span
                    key={`${m.serverName}-${m.ratingKey}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-950/60 border border-emerald-600/40 px-2.5 py-1 text-xs sm:text-sm text-emerald-200"
                  >
                    <Server className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span>
                      Salle <strong>{m.libraryTitle}</strong> — {serversText}
                    </span>
                  </span>
                );
              })}
            </div>

            {catalogPresence.accessibleToCurrentUser === false && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-amber-950/70 border border-amber-500/50 px-3 py-1.5 text-xs sm:text-sm text-amber-200">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  Ce titre est sur <strong>{catalogPresence.availableServers?.join(' & ')}</strong>, mais ton compte Plex est rattaché à{' '}
                  <strong>{catalogPresence.userAllowedServers?.join(' & ') || 'un autre serveur'}</strong>.
                </span>
              </div>
            )}

            {catalogPresence.accessibleToCurrentUser === true &&
              catalogPresence.userAccessibleServers &&
              catalogPresence.userAccessibleServers.length > 0 && (
                <div className="inline-flex items-center gap-1.5 text-xs text-emerald-300/90 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>
                    Accessible sur ton compte Plex ({catalogPresence.userAccessibleServers.join(' & ')})
                  </span>
                </div>
              )}

            {requesterName && (
              <div className="inline-flex items-center gap-1.5 text-xs text-amber-200/90 font-medium">
                <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>
                  Demandé par <strong>{requesterName}</strong>
                  {requestedOrAddedDateFr ? ` le ${requestedOrAddedDateFr}` : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Origine de la demande / liste automatique & dates Cinéma / VOD / DVD si pas encore sur Plex */}
        {catalogPresence.state !== 'available_now' &&
          (requesterName || sourceOrigin === 'auto_list' || requestedOrAddedDateFr || cinemaDateFr || vodDateFr) && (
            <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm text-stone-200 bg-black/50 rounded-xl px-3.5 py-2 border border-amber-500/20">
              {requesterName ? (
                <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
                  <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                  <span>
                    Demandé par <strong>{requesterName}</strong>
                    {requestedOrAddedDateFr ? ` le ${requestedOrAddedDateFr}` : ''}
                  </span>
                </span>
              ) : sourceOrigin === 'auto_list' ? (
                <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
                  <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                  <span>
                    Ajouté automatiquement (liste)
                    {requestedOrAddedDateFr ? ` le ${requestedOrAddedDateFr}` : ''}
                  </span>
                </span>
              ) : requestedOrAddedDateFr ? (
                <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
                  <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                  <span>Demandé / mis en attente le : {requestedOrAddedDateFr}</span>
                </span>
              ) : null}
              {cinemaDateFr && (
              <span className="inline-flex items-center gap-1.5">
                <Clapperboard className="h-4 w-4 text-red-400 shrink-0" />
                <span>Sortie en salle : {cinemaDateFr}</span>
              </span>
            )}
            {vodDateFr && (
              <span
                className={`inline-flex items-center gap-1.5 font-medium ${
                  isVodFuture ? 'text-amber-300' : 'text-stone-200'
                }`}
              >
                <Disc className={`h-4 w-4 shrink-0 ${isVodFuture ? 'text-amber-400' : 'text-stone-400'}`} />
                <span>
                  {identity.releaseDates.isEstimatedDate && isVodFuture
                    ? `Sortie VOD / DVD estimée : vers le ${vodDateFr}`
                    : isVodFuture
                      ? `Sortie VOD / DVD prévue : ${vodDateFr}`
                      : `Sortie VOD / DVD : ${vodDateFr}`}
                </span>
              </span>
            )}
          </div>
        )}

        {/* Détail des saisons pour les Séries TV */}
        {episodeCoverage && episodeCoverage.seasons.length > 0 && (
          <div className="mt-1 rounded-xl bg-black/55 border border-amber-500/20 p-3">
            <div className="flex items-center justify-between text-xs sm:text-sm font-semibold text-amber-200 mb-2">
              <span>État des saisons ({episodeCoverage.seasons.length})</span>
              {episodeCoverage.seasons.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllSeasons(!showAllSeasons)}
                  className="inline-flex items-center gap-1 text-amber-400 hover:underline cursor-pointer"
                >
                  <span>{showAllSeasons ? 'Réduire' : 'Voir toutes les saisons'}</span>
                  {showAllSeasons ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(showAllSeasons ? episodeCoverage.seasons : episodeCoverage.seasons.slice(0, 6)).map((s) => {
                const isRequestable = actionability.requestableSeasons.includes(s.seasonNumber);
                const isSelected = selectedSeasons.includes(s.seasonNumber);
                return (
                  <button
                    type="button"
                    disabled={!isRequestable}
                    onClick={() => isRequestable && toggleSeason(s.seasonNumber)}
                    key={s.seasonNumber}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs flex items-center justify-between transition ${
                      s.state === 'available_on_plex'
                        ? 'bg-emerald-950/35 border-emerald-700/50 text-emerald-200 cursor-default'
                        : s.state === 'requested_or_monitored'
                          ? 'bg-amber-950/35 border-amber-700/50 text-amber-200 cursor-default'
                          : isSelected
                            ? 'bg-red-900/50 border-amber-400 text-white cursor-pointer'
                            : 'bg-stone-900/90 border-stone-800 text-stone-400 cursor-pointer hover:border-amber-500/40'
                    }`}
                  >
                    <span className="font-semibold flex items-center gap-1.5">
                      {isRequestable && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="h-3.5 w-3.5 accent-red-600 rounded pointer-events-none"
                        />
                      )}
                      <span>Saison {s.seasonNumber}</span>
                    </span>
                    <span>
                      {s.state === 'available_on_plex'
                        ? `Plex (${s.plexEpisodeCount} ép.)`
                        : s.state === 'partially_available'
                          ? `${s.plexEpisodeCount}/${s.totalEpisodeCount} ép.`
                          : s.state === 'requested_or_monitored'
                            ? 'En attente'
                            : 'À demander'}
                    </span>
                  </button>
                );
              })}
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

        {/* Flux de Demande en 2 Étapes (Style Billet de Programmation Plex) */}
        {actionability.canRequestNow && !preparedAction && (
          <div className="mt-1.5 flex flex-col gap-2.5 rounded-xl bg-black/55 border border-amber-500/25 p-3.5">
            <span className="text-xs sm:text-sm text-stone-200 leading-relaxed">
              {actionability.userFriendlyExplanationFr}
            </span>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={loadingAction || (identity.mediaType === 'tv' && selectedSeasons.length === 0)}
                onClick={handlePrepareRequest}
                className="w-full sm:w-auto cinema-velvet-pill inline-flex items-center justify-center gap-2 rounded-xl px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-bold text-white hover:brightness-110 active:scale-[0.99] disabled:opacity-50 transition cursor-pointer whitespace-nowrap"
              >
                {loadingAction ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlusCircle className="h-4 w-4 text-amber-300" />
                )}
                <span>
                  {identity.mediaType === 'tv'
                    ? `Programmer ${selectedSeasons.length} saison(s) sur Plex`
                    : "Programmer l'ajout sur Plex"}
                </span>
              </button>
            </div>
          </div>
        )}

        {preparedAction && (
          <div className="mt-1.5 rounded-xl border border-amber-400/50 bg-red-950/45 p-4 flex flex-col gap-3">
            <div className="flex items-start gap-2.5 text-xs sm:text-sm text-amber-100">
              <ShieldCheck className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white leading-snug">{preparedAction.summaryFr}</p>
                <p className="mt-1 text-xs sm:text-sm text-amber-200/90 leading-relaxed">
                  Étape 2/2 : Confirme ton ticket pour lancer l’acquisition automatique vers Plex.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-amber-500/25">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setPreparedAction(null)}
                className="flex-1 sm:flex-none rounded-xl border border-stone-700 bg-stone-900 px-4 py-2 text-xs sm:text-sm font-medium text-stone-300 hover:bg-stone-800 cursor-pointer whitespace-nowrap text-center"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmRequest}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4.5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer shadow-md whitespace-nowrap"
              >
                {loadingAction ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                <span>Confirmer la programmation</span>
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
