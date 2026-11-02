import { z } from 'zod';
import type { MediaType } from '../../shared/types.js';

export const MDBLIST_GENRE_SLUGS = [
  'action',
  'adventure',
  'animation',
  'anime',
  'biography',
  'comedy',
  'crime',
  'documentary',
  'drama',
  'family',
  'fantasy',
  'history',
  'horror',
  'music',
  'musical',
  'mystery',
  'romance',
  'sci-fi',
  'sport',
  'superhero',
  'thriller',
  'war',
  'western'
] as const;

export type MdblistGenreSlug = (typeof MDBLIST_GENRE_SLUGS)[number];

export const MDBLIST_RATING_SOURCES = [
  'imdb',
  'tmdb',
  'mdblist',
  'metacritic',
  'rotten_tomatoes',
  'popcorn',
  'letterboxd',
  'mal'
] as const;

export type MdblistRatingSource = (typeof MDBLIST_RATING_SOURCES)[number];

export type ComparisonOperator = 'gt' | 'gte' | 'lt' | 'lte';

export type DiscoveryScope = 'any' | 'on_plex_now' | 'missing_on_plex';

export type SortField = 'score' | 'imdbrating' | 'tmdbrating' | 'released' | 'votes' | 'runtime' | 'title';

function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9+-]+/g, ' ')
    .trim();
}

const GENRE_ALIAS_MAP: Record<string, MdblistGenreSlug> = {
  action: 'action',
  actions: 'action',
  aventure: 'adventure',
  aventures: 'adventure',
  adventure: 'adventure',
  animation: 'animation',
  animations: 'animation',
  'dessin anime': 'animation',
  'dessins animes': 'animation',
  anime: 'anime',
  animes: 'anime',
  'animation japonaise': 'anime',
  manga: 'anime',
  biographie: 'biography',
  biopic: 'biography',
  biopics: 'biography',
  biography: 'biography',
  comedie: 'comedy',
  comedies: 'comedy',
  comedy: 'comedy',
  humour: 'comedy',
  crime: 'crime',
  crimes: 'crime',
  policier: 'crime',
  polar: 'crime',
  polars: 'crime',
  gangster: 'crime',
  mafia: 'crime',
  documentaire: 'documentary',
  documentaires: 'documentary',
  docu: 'documentary',
  documentary: 'documentary',
  drame: 'drama',
  drames: 'drama',
  drama: 'drama',
  dramatique: 'drama',
  famille: 'family',
  familial: 'family',
  family: 'family',
  jeunesse: 'family',
  enfants: 'family',
  fantastique: 'fantasy',
  fantasy: 'fantasy',
  'heroic fantasy': 'fantasy',
  histoire: 'history',
  historique: 'history',
  historiques: 'history',
  history: 'history',
  historical: 'history',
  horreur: 'horror',
  epouvante: 'horror',
  horror: 'horror',
  musique: 'music',
  music: 'music',
  musical: 'musical',
  'comedie musicale': 'musical',
  mystere: 'mystery',
  mystery: 'mystery',
  enigme: 'mystery',
  enquete: 'mystery',
  romance: 'romance',
  romantique: 'romance',
  romantiques: 'romance',
  amour: 'romance',
  'science-fiction': 'sci-fi',
  'science fiction': 'sci-fi',
  'sci-fi': 'sci-fi',
  scifi: 'sci-fi',
  sf: 'sci-fi',
  anticipation: 'sci-fi',
  sport: 'sport',
  sports: 'sport',
  'super-heros': 'superhero',
  'super heros': 'superhero',
  superhero: 'superhero',
  superheros: 'superhero',
  thriller: 'thriller',
  thrillers: 'thriller',
  suspense: 'thriller',
  guerre: 'war',
  war: 'war',
  western: 'western',
  westerns: 'western'
};

export const GENRE_FRENCH_LABEL: Record<MdblistGenreSlug, string> = {
  action: 'action',
  adventure: 'aventure',
  animation: 'animation',
  anime: 'anime',
  biography: 'biopic / biographie',
  comedy: 'comédie',
  crime: 'policier / crime',
  documentary: 'documentaire',
  drama: 'drame',
  family: 'famille',
  fantasy: 'fantastique / fantasy',
  history: 'historique',
  horror: 'horreur',
  music: 'musique',
  musical: 'comédie musicale',
  mystery: 'mystère',
  romance: 'romance',
  'sci-fi': 'science-fiction',
  sport: 'sport',
  superhero: 'super-héros',
  thriller: 'thriller',
  war: 'guerre',
  western: 'western'
};

const RATING_SOURCE_ALIAS_MAP: Record<string, MdblistRatingSource> = {
  imdb: 'imdb',
  'imdb rating': 'imdb',
  tmdb: 'tmdb',
  'the movie db': 'tmdb',
  themoviedb: 'tmdb',
  mdblist: 'mdblist',
  mdb: 'mdblist',
  score: 'mdblist',
  metacritic: 'metacritic',
  meta: 'metacritic',
  metascore: 'metacritic',
  rotten_tomatoes: 'rotten_tomatoes',
  'rotten tomatoes': 'rotten_tomatoes',
  rottentomatoes: 'rotten_tomatoes',
  rt: 'rotten_tomatoes',
  tomatoes: 'rotten_tomatoes',
  tomatometer: 'rotten_tomatoes',
  popcorn: 'popcorn',
  'rt audience': 'popcorn',
  letterboxd: 'letterboxd',
  letterbox: 'letterboxd',
  mal: 'mal',
  myanimelist: 'mal'
};

const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  fr: 'fr',
  fre: 'fr',
  fra: 'fr',
  francais: 'fr',
  francaise: 'fr',
  french: 'fr',
  en: 'en',
  eng: 'en',
  anglais: 'en',
  anglaise: 'en',
  english: 'en',
  es: 'es',
  spa: 'es',
  espagnol: 'es',
  espagnole: 'es',
  spanish: 'es',
  it: 'it',
  ita: 'it',
  italien: 'it',
  italienne: 'it',
  italian: 'it',
  de: 'de',
  ger: 'de',
  deu: 'de',
  allemand: 'de',
  allemande: 'de',
  german: 'de',
  ja: 'ja',
  jpn: 'ja',
  jp: 'ja',
  japonais: 'ja',
  japonaise: 'ja',
  japanese: 'ja',
  ko: 'ko',
  kor: 'ko',
  kr: 'ko',
  coreen: 'ko',
  coreenne: 'ko',
  korean: 'ko',
  pt: 'pt',
  por: 'pt',
  portugais: 'pt',
  portuguese: 'pt',
  zh: 'zh',
  chi: 'zh',
  zho: 'zh',
  chinois: 'zh',
  chinese: 'zh',
  da: 'da',
  dan: 'da',
  danois: 'da',
  danish: 'da',
  sv: 'sv',
  swe: 'sv',
  suedois: 'sv',
  swedish: 'sv'
};

export function resolveGenreSlug(rawGenre: string): MdblistGenreSlug | null {
  const norm = normalizeToken(rawGenre);
  if (!norm) return null;
  if (GENRE_ALIAS_MAP[norm]) return GENRE_ALIAS_MAP[norm];
  if ((MDBLIST_GENRE_SLUGS as readonly string[]).includes(norm)) {
    return norm as MdblistGenreSlug;
  }
  return null;
}

export function resolveRatingSource(rawSource: string): MdblistRatingSource | null {
  const norm = normalizeToken(rawSource);
  if (!norm) return null;
  return RATING_SOURCE_ALIAS_MAP[norm] ?? null;
}

export function resolveLanguageIso(rawLang: string): string | null {
  const norm = normalizeToken(rawLang);
  if (!norm) return null;
  if (LANGUAGE_ALIAS_MAP[norm]) return LANGUAGE_ALIAS_MAP[norm];
  if (/^[a-z]{2}$/.test(norm)) return norm;
  return null;
}

export const rawDiscoveryCriteriaInputSchema = z
  .object({
    mediaType: z.string().optional().default('movie'),
    genres: z.array(z.string()).optional(),
    genreOperator: z.enum(['and', 'or']).optional(),
    genresOperator: z.enum(['and', 'or']).optional(),
    keywords: z.array(z.string()).optional(),
    yearFrom: z.number().int().optional(),
    yearTo: z.number().int().optional(),
    isRecent: z.boolean().optional(),
    ratingSource: z.string().optional(),
    minRating: z.number().optional(),
    maxRating: z.number().optional(),
    ratingComparison: z.enum(['gt', 'gte', 'lt', 'lte']).optional(),
    maxRatingComparison: z.enum(['lt', 'lte']).optional(),
    minVotes: z.number().int().optional(),
    minRuntimeMinutes: z.number().int().optional(),
    maxRuntimeMinutes: z.number().int().optional(),
    minRuntimeComparison: z.enum(['gt', 'gte']).optional(),
    maxRuntimeComparison: z.enum(['lt', 'lte']).optional(),
    originalLanguage: z.string().optional(),
    spokenLanguage: z.string().optional(),
    audioLanguage: z.string().optional(),
    audioDubbingLanguage: z.string().optional(),
    externalStreamingPlatform: z.string().optional(),
    externalStreamingService: z.string().optional(),
    excludeWatched: z.boolean().optional().default(true),
    scope: z.enum(['any', 'on_plex_now', 'missing_on_plex']).optional().default('any'),
    sort: z.enum(['score', 'imdbrating', 'tmdbrating', 'released', 'votes', 'runtime', 'title']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    unsupportedConstraints: z.array(z.string()).optional(),
    unmappedConstraintNotes: z.array(z.string()).optional(),
    inheritPreviousCriteria: z.boolean().optional(),
    limit: z.number().int().optional().default(5)
  })
  .strict();

export type RawDiscoveryCriteriaInput = z.input<typeof rawDiscoveryCriteriaInputSchema>;

export interface NormalizedDiscoveryCriteria {
  mediaType: MediaType;
  genres: MdblistGenreSlug[];
  genreOperator: 'and' | 'or';
  yearFrom: number | null;
  yearTo: number | null;
  isRecentApplied: boolean;
  ratingSource: MdblistRatingSource | null;
  minRating: number | null;
  maxRating: number | null;
  ratingComparison: 'gt' | 'gte';
  maxRatingComparison: 'lt' | 'lte';
  minVotes: number | null;
  minRuntimeMinutes: number | null;
  maxRuntimeMinutes: number | null;
  minRuntimeComparison: 'gt' | 'gte';
  maxRuntimeComparison: 'lt' | 'lte';
  originalLanguage: string | null;
  excludeWatched: boolean;
  scope: DiscoveryScope;
  sort: SortField;
  order: 'asc' | 'desc';
  limit: number;
  appliedConventions: string[];
  unsupportedConstraints: string[];
  appliedCriteriaSummaryFr: string;
}

export interface CriteriaValidationOptions {
  currentYear?: number;
  recentYearsWindow?: number;
}

export type CriteriaValidationResult =
  | {
      ok: true;
      criteria: NormalizedDiscoveryCriteria;
    }
  | {
      ok: false;
      errorCode:
        | 'INVALID_SCHEMA'
        | 'INVALID_BOUNDS'
        | 'UNSUPPORTED_RATING_SOURCE'
        | 'UNSUPPORTED_CRITERIA_ONLY';
      errorMessageFr: string;
      unsupportedConstraints: string[];
    };

export function getRatingScaleMax(source: MdblistRatingSource): 5 | 10 | 100 {
  if (source === 'letterboxd') return 5;
  if (source === 'imdb' || source === 'tmdb' || source === 'mal') return 10;
  return 100;
}

/**
 * Convertit un seuil de note natif (ex: 8/10 IMDb, 3.5/5 Letterboxd, 80/100 Metacritic)
 * vers l'échelle entière normalisée 0–100 de l'API MDBList, en respectant strictement `>` vs `>=`.
 */
export function toMdblistRatingScale100(
  ratingValue: number,
  source: MdblistRatingSource,
  comparison: 'gt' | 'gte' | 'lt' | 'lte'
): number {
  const scaleMax = getRatingScaleMax(source);
  let scaled: number;

  if (scaleMax === 10) {
    scaled = Math.round(ratingValue * 10);
  } else if (scaleMax === 5) {
    // Si l'appelant a déjà passé une valeur > 5 (ex: 70), on la garde sur 100
    scaled = ratingValue <= 5 ? Math.round(ratingValue * 20) : Math.round(ratingValue);
  } else {
    // Pour une source sur 100, si l'utilisateur dit "8" par habitude sur 10, on respecte la valeur passée si > 10, sinon * 10
    scaled = ratingValue <= 10 ? Math.round(ratingValue * 10) : Math.round(ratingValue);
  }

  if (comparison === 'gt') {
    scaled = Math.min(100, scaled + 1);
  } else if (comparison === 'lt') {
    scaled = Math.max(0, scaled - 1);
  }

  return Math.max(0, Math.min(100, scaled));
}

export function validateAndNormalizeCriteria(
  rawInput: unknown,
  options: CriteriaValidationOptions = {}
): CriteriaValidationResult {
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const recentYearsWindow = Math.max(1, Math.min(15, options.recentYearsWindow ?? 3));

  const parsed = rawDiscoveryCriteriaInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: 'INVALID_SCHEMA',
      errorMessageFr: `Contrat de critères invalide : ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      unsupportedConstraints: []
    };
  }

  const data = parsed.data;
  const unsupportedConstraints: string[] = [
    ...(data.unsupportedConstraints || []),
    ...(data.unmappedConstraintNotes || [])
  ].filter((c) => typeof c === 'string' && c.trim().length > 0);
  const appliedConventions: string[] = [];

  if (Array.isArray(data.keywords) && data.keywords.length > 0) {
    const cleanKeywords = data.keywords.map((k) => k.trim()).filter(Boolean);
    if (cleanKeywords.length > 0) {
      unsupportedConstraints.push(
        `Le filtrage par mots-clés thématiques libres (${cleanKeywords.join(', ')}) n'est pas exposé directement par l'endpoint /catalog de MDBList.`
      );
    }
  }

  // 1. MediaType
  const rawTypeNorm = normalizeToken(data.mediaType || 'movie');
  let mediaType: MediaType = 'movie';
  if (['tv', 'show', 'shows', 'serie', 'series', 'television'].includes(rawTypeNorm)) {
    mediaType = 'tv';
  } else if (['movie', 'movies', 'film', 'films', 'cinema'].includes(rawTypeNorm)) {
    mediaType = 'movie';
  } else {
    return {
      ok: false,
      errorCode: 'INVALID_BOUNDS',
      errorMessageFr: `Type de média non reconnu : "${data.mediaType}" (attendu : "movie" ou "tv").`,
      unsupportedConstraints
    };
  }

  // 2. Genres
  const genres: MdblistGenreSlug[] = [];
  for (const rawG of data.genres || []) {
    const slug = resolveGenreSlug(rawG);
    if (!slug) {
      unsupportedConstraints.push(`Genre non reconnu par le catalogue MDBList : "${rawG}".`);
    } else if (!genres.includes(slug)) {
      genres.push(slug);
    }
  }
  // Par défaut 'and' pour ne jamais transformer silencieusement une combinaison en OU
  const effectiveGenreOp = data.genreOperator ?? data.genresOperator;
  const genreOperator: 'and' | 'or' = effectiveGenreOp === 'or' ? 'or' : 'and';

  // 3. Années & convention "récent"
  let yearFrom: number | null = data.yearFrom ?? null;
  let yearTo: number | null = data.yearTo ?? null;
  let isRecentApplied = false;

  if (data.isRecent && yearFrom === null && yearTo === null) {
    yearFrom = currentYear - recentYearsWindow;
    yearTo = currentYear;
    isRecentApplied = true;
    appliedConventions.push(
      `Critère "récent" interprété selon la convention configurée (${yearFrom}–${yearTo}, fenêtre de ${recentYearsWindow} ans).`
    );
  }

  const maxAllowedYear = currentYear + 2;
  if (yearFrom !== null && (yearFrom < 1888 || yearFrom > maxAllowedYear)) {
    return {
      ok: false,
      errorCode: 'INVALID_BOUNDS',
      errorMessageFr: `L'année de début (${yearFrom}) est hors des bornes autorisées (1888–${maxAllowedYear}).`,
      unsupportedConstraints
    };
  }
  if (yearTo !== null && (yearTo < 1888 || yearTo > maxAllowedYear)) {
    return {
      ok: false,
      errorCode: 'INVALID_BOUNDS',
      errorMessageFr: `L'année de fin (${yearTo}) est hors des bornes autorisées (1888–${maxAllowedYear}).`,
      unsupportedConstraints
    };
  }
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    return {
      ok: false,
      errorCode: 'INVALID_BOUNDS',
      errorMessageFr: `L'année de début (${yearFrom}) ne peut pas être supérieure à l'année de fin (${yearTo}).`,
      unsupportedConstraints
    };
  }

  // 4. Source de note & seuils
  let ratingSource: MdblistRatingSource | null = null;
  if (data.ratingSource !== undefined && data.ratingSource.trim().length > 0) {
    const resolved = resolveRatingSource(data.ratingSource);
    if (!resolved) {
      const msg = `La source de note "${data.ratingSource}" n'est pas prise en charge par MDBList (sources supportées : IMDb, TMDb, MDBList, Metacritic, Rotten Tomatoes, Popcorn, Letterboxd, MyAnimeList). Aucune note de substitution n'a été appliquée.`;
      unsupportedConstraints.push(msg);
      return {
        ok: false,
        errorCode: 'UNSUPPORTED_RATING_SOURCE',
        errorMessageFr: msg,
        unsupportedConstraints
      };
    }
    ratingSource = resolved;
  } else if (data.minRating !== undefined || data.maxRating !== undefined) {
    ratingSource = 'imdb';
    appliedConventions.push('Source de note par défaut : IMDb.');
  }

  const minRating: number | null = data.minRating ?? null;
  const maxRating: number | null = data.maxRating ?? null;

  let ratingComparison: 'gt' | 'gte' = 'gte';
  let maxRatingComparison: 'lt' | 'lte' = data.maxRatingComparison ?? 'lte';

  if (data.ratingComparison === 'gt' || data.ratingComparison === 'gte') {
    ratingComparison = data.ratingComparison;
  } else if (data.ratingComparison === 'lt' || data.ratingComparison === 'lte') {
    maxRatingComparison = data.ratingComparison;
  }

  if (ratingSource) {
    const scaleMax = getRatingScaleMax(ratingSource);
    const maxBound = scaleMax === 5 ? 100 : scaleMax; // Letterboxd accepte 0-5 (ou 0-100)
    if (minRating !== null && (minRating < 0 || minRating > maxBound)) {
      return {
        ok: false,
        errorCode: 'INVALID_BOUNDS',
        errorMessageFr: `La note minimale (${minRating}) dépasse l'échelle de ${ratingSource} (0–${scaleMax}).`,
        unsupportedConstraints
      };
    }
    if (maxRating !== null && (maxRating < 0 || maxRating > maxBound)) {
      return {
        ok: false,
        errorCode: 'INVALID_BOUNDS',
        errorMessageFr: `La note maximale (${maxRating}) dépasse l'échelle de ${ratingSource} (0–${scaleMax}).`,
        unsupportedConstraints
      };
    }
    if (minRating !== null && maxRating !== null && minRating > maxRating) {
      return {
        ok: false,
        errorCode: 'INVALID_BOUNDS',
        errorMessageFr: `La note minimale (${minRating}) ne peut pas être supérieure à la note maximale (${maxRating}).`,
        unsupportedConstraints
      };
    }
  }

  // 5. Nombre de votes
  const minVotes: number | null = data.minVotes ?? null;
  if (minVotes !== null && (minVotes < 0 || minVotes > 5_000_000)) {
    return {
      ok: false,
      errorCode: 'INVALID_BOUNDS',
      errorMessageFr: `Le nombre minimum de votes (${minVotes}) est hors bornes (0–5 000 000).`,
      unsupportedConstraints
    };
  }

  // 6. Durée (en minutes)
  const minRuntimeMinutes: number | null = data.minRuntimeMinutes ?? null;
  const maxRuntimeMinutes: number | null = data.maxRuntimeMinutes ?? null;
  const minRuntimeComparison: 'gt' | 'gte' = data.minRuntimeComparison ?? 'gte';
  const maxRuntimeComparison: 'lt' | 'lte' = data.maxRuntimeComparison ?? 'lte';

  if (minRuntimeMinutes !== null && (minRuntimeMinutes < 1 || minRuntimeMinutes > 600)) {
    return {
      ok: false,
      errorCode: 'INVALID_BOUNDS',
      errorMessageFr: `La durée minimale (${minRuntimeMinutes} min) est hors des bornes autorisées (1–600 min).`,
      unsupportedConstraints
    };
  }
  if (maxRuntimeMinutes !== null && (maxRuntimeMinutes < 1 || maxRuntimeMinutes > 600)) {
    return {
      ok: false,
      errorCode: 'INVALID_BOUNDS',
      errorMessageFr: `La durée maximale (${maxRuntimeMinutes} min) est hors des bornes autorisées (1–600 min).`,
      unsupportedConstraints
    };
  }
  if (
    minRuntimeMinutes !== null &&
    maxRuntimeMinutes !== null &&
    minRuntimeMinutes > maxRuntimeMinutes
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_BOUNDS',
      errorMessageFr: `La durée minimale (${minRuntimeMinutes} min) ne peut pas dépasser la durée maximale (${maxRuntimeMinutes} min).`,
      unsupportedConstraints
    };
  }

  // 7. Langue originale vs Langue de piste audio (doublage)
  let originalLanguage: string | null = null;
  if (data.originalLanguage && data.originalLanguage.trim().length > 0) {
    const iso = resolveLanguageIso(data.originalLanguage);
    if (!iso) {
      unsupportedConstraints.push(
        `Langue originale non reconnue : "${data.originalLanguage}".`
      );
    } else {
      originalLanguage = iso;
    }
  }

  const effectiveAudioLang = (data.audioLanguage || data.audioDubbingLanguage || '').trim();
  if (effectiveAudioLang.length > 0) {
    unsupportedConstraints.push(
      `Le filtrage par langue de piste audio disponible ("${effectiveAudioLang}") n'est pas pris en charge par le catalogue MDBList (seule la langue originale de production VO peut être filtrée).`
    );
  }
  if (data.spokenLanguage && data.spokenLanguage.trim().length > 0) {
    unsupportedConstraints.push(
      `Le filtrage par langue parlée secondaire ("${data.spokenLanguage.trim()}") n'est pas exposé par le catalogue MDBList (seule la langue originale de production VO est filtrable).`
    );
  }

  // 8. Plateforme de streaming externe vs Présence réelle sur Plex
  const effectiveExternalPlatform = (
    data.externalStreamingPlatform ||
    data.externalStreamingService ||
    ''
  ).trim();
  if (effectiveExternalPlatform.length > 0) {
    unsupportedConstraints.push(
      `La disponibilité sur le service externe "${effectiveExternalPlatform}" n'est pas vérifiée par Askarr (seule la disponibilité réelle sur tes serveurs Plex et dans Radarr/Sonarr/Overseerr est vérifiée).`
    );
  }

  // 9. Limite de résultats & Tri
  if (data.limit < 1 || data.limit > 20) {
    return {
      ok: false,
      errorCode: 'INVALID_BOUNDS',
      errorMessageFr: `Le nombre de résultats demandé (${data.limit}) doit être compris entre 1 et 20.`,
      unsupportedConstraints
    };
  }
  const limit = Math.min(8, Math.max(1, data.limit));

  const defaultSort: SortField =
    ratingSource === 'imdb'
      ? 'imdbrating'
      : ratingSource === 'tmdb'
        ? 'tmdbrating'
        : 'score';
  const sort: SortField = data.sort ?? defaultSort;
  const order: 'asc' | 'desc' = data.order ?? 'desc';

  // Vérifier s'il ne reste aucun critère exploitable alors que des contraintes non supportées ont été fournies
  const hasAnySupportedCriterion =
    genres.length > 0 ||
    yearFrom !== null ||
    yearTo !== null ||
    minRating !== null ||
    maxRating !== null ||
    minVotes !== null ||
    minRuntimeMinutes !== null ||
    maxRuntimeMinutes !== null ||
    originalLanguage !== null;

  if (!hasAnySupportedCriterion && unsupportedConstraints.length > 0) {
    return {
      ok: false,
      errorCode: 'UNSUPPORTED_CRITERIA_ONLY',
      errorMessageFr: unsupportedConstraints.join(' '),
      unsupportedConstraints
    };
  }

  const summaryParts: string[] = [mediaType === 'tv' ? 'Séries TV' : 'Films'];
  if (genres.length > 0) {
    const labels = genres.map((g) => GENRE_FRENCH_LABEL[g] || g);
    summaryParts.push(
      `genre: ${labels.join(genreOperator === 'and' ? ' ET ' : ' OU ')}`
    );
  }
  if (yearFrom !== null && yearTo !== null) {
    summaryParts.push(yearFrom === yearTo ? `année: ${yearFrom}` : `période: ${yearFrom}–${yearTo}`);
  } else if (yearFrom !== null) {
    summaryParts.push(`sorti à partir de ${yearFrom}`);
  } else if (yearTo !== null) {
    summaryParts.push(`sorti jusqu'en ${yearTo}`);
  }
  if (ratingSource && minRating !== null) {
    const opLabel = ratingComparison === 'gt' ? '>' : '>=';
    summaryParts.push(`note ${ratingSource.toUpperCase()} ${opLabel} ${minRating}`);
  }
  if (ratingSource && maxRating !== null) {
    const opLabel = maxRatingComparison === 'lt' ? '<' : '<=';
    summaryParts.push(`note ${ratingSource.toUpperCase()} ${opLabel} ${maxRating}`);
  }
  if (minVotes !== null) {
    summaryParts.push(`votes >= ${minVotes}`);
  }
  if (minRuntimeMinutes !== null) {
    const opLabel = minRuntimeComparison === 'gt' ? '>' : '>=';
    summaryParts.push(`durée ${opLabel} ${minRuntimeMinutes} min`);
  }
  if (maxRuntimeMinutes !== null) {
    const opLabel = maxRuntimeComparison === 'lt' ? '<' : '<=';
    summaryParts.push(`durée ${opLabel} ${maxRuntimeMinutes} min`);
  }
  if (originalLanguage) {
    summaryParts.push(`langue originale: ${originalLanguage.toUpperCase()}`);
  }
  if (data.excludeWatched) {
    summaryParts.push('non vus uniquement');
  }
  if (data.scope === 'on_plex_now') {
    summaryParts.push('disponibles sur tes serveurs Plex autorisés');
  } else if (data.scope === 'missing_on_plex') {
    summaryParts.push('absents de Plex (demandables)');
  }

  return {
    ok: true,
    criteria: {
      mediaType,
      genres,
      genreOperator,
      yearFrom,
      yearTo,
      isRecentApplied,
      ratingSource,
      minRating,
      maxRating,
      ratingComparison,
      maxRatingComparison,
      minVotes,
      minRuntimeMinutes,
      maxRuntimeMinutes,
      minRuntimeComparison,
      maxRuntimeComparison,
      originalLanguage,
      excludeWatched: data.excludeWatched,
      scope: data.scope,
      sort,
      order,
      limit,
      appliedConventions,
      unsupportedConstraints,
      appliedCriteriaSummaryFr: summaryParts.join(' • ')
    }
  };
}

/**
 * Vérifie strictement si la note réelle d'un candidat pour la source demandée
 * satisfait les seuils min/max avec distinction `>` vs `>=` et `<` vs `<=`.
 * Une note absente (`null` / `undefined`) ne satisfait jamais un seuil.
 */
export function matchesRatingConstraint(
  actualRating: number | null | undefined,
  criteria: Pick<
    NormalizedDiscoveryCriteria,
    'ratingSource' | 'minRating' | 'maxRating' | 'ratingComparison' | 'maxRatingComparison'
  >
): boolean {
  if (!criteria.ratingSource) return true;
  if (criteria.minRating === null && criteria.maxRating === null) return true;

  if (actualRating === null || actualRating === undefined || !Number.isFinite(actualRating) || actualRating <= 0) {
    return false;
  }

  if (criteria.minRating !== null) {
    if (criteria.ratingComparison === 'gt') {
      if (!(actualRating > criteria.minRating)) return false;
    } else {
      if (!(actualRating >= criteria.minRating)) return false;
    }
  }

  if (criteria.maxRating !== null) {
    if (criteria.maxRatingComparison === 'lt') {
      if (!(actualRating < criteria.maxRating)) return false;
    } else {
      if (!(actualRating <= criteria.maxRating)) return false;
    }
  }

  return true;
}

/**
 * Vérifie strictement si la durée en minutes satisfait les bornes demandées.
 * Une durée absente (`null` / `undefined`) ne satisfait jamais un filtre de durée.
 */
export function matchesRuntimeConstraint(
  actualRuntimeMinutes: number | null | undefined,
  criteria: Pick<
    NormalizedDiscoveryCriteria,
    'minRuntimeMinutes' | 'maxRuntimeMinutes' | 'minRuntimeComparison' | 'maxRuntimeComparison'
  >
): boolean {
  if (criteria.minRuntimeMinutes === null && criteria.maxRuntimeMinutes === null) {
    return true;
  }

  if (
    actualRuntimeMinutes === null ||
    actualRuntimeMinutes === undefined ||
    !Number.isFinite(actualRuntimeMinutes) ||
    actualRuntimeMinutes <= 0
  ) {
    return false;
  }

  if (criteria.minRuntimeMinutes !== null) {
    if (criteria.minRuntimeComparison === 'gt') {
      if (!(actualRuntimeMinutes > criteria.minRuntimeMinutes)) return false;
    } else {
      if (!(actualRuntimeMinutes >= criteria.minRuntimeMinutes)) return false;
    }
  }

  if (criteria.maxRuntimeMinutes !== null) {
    if (criteria.maxRuntimeComparison === 'lt') {
      if (!(actualRuntimeMinutes < criteria.maxRuntimeMinutes)) return false;
    } else {
      if (!(actualRuntimeMinutes <= criteria.maxRuntimeMinutes)) return false;
    }
  }

  return true;
}

/**
 * Vérifie strictement si l'année de sortie satisfait l'intervalle demandé.
 */
export function matchesYearConstraint(
  actualYear: number | null | undefined,
  criteria: Pick<NormalizedDiscoveryCriteria, 'yearFrom' | 'yearTo'>
): boolean {
  if (criteria.yearFrom === null && criteria.yearTo === null) {
    return true;
  }
  if (actualYear === null || actualYear === undefined || !Number.isFinite(actualYear)) {
    return false;
  }
  if (criteria.yearFrom !== null && actualYear < criteria.yearFrom) {
    return false;
  }
  if (criteria.yearTo !== null && actualYear > criteria.yearTo) {
    return false;
  }
  return true;
}

/**
 * Fusionne un suivi conversationnel ("Seulement sur Plex", "Plutôt des comédies",
 * "Et moins de 90 minutes", "Finalement à partir de 2000") avec les critères
 * normalisés du tour précédent, puis revalide intégralement le contrat via `validateAndNormalizeCriteria`.
 * Les affirmations de l'utilisateur ne peuvent jamais contourner le schéma de validation.
 */
export function mergeFollowUpCriteria(
  previous: NormalizedDiscoveryCriteria,
  followUpPatch: unknown,
  options: CriteriaValidationOptions = {}
): CriteriaValidationResult {
  if (!followUpPatch || typeof followUpPatch !== 'object' || Array.isArray(followUpPatch)) {
    return validateAndNormalizeCriteria(followUpPatch, options);
  }

  const patch = followUpPatch as Record<string, unknown>;
  const base: Record<string, unknown> = {
    mediaType: previous.mediaType,
    genres: [...previous.genres],
    genreOperator: previous.genreOperator,
    ...(previous.yearFrom !== null ? { yearFrom: previous.yearFrom } : {}),
    ...(previous.yearTo !== null ? { yearTo: previous.yearTo } : {}),
    ...(previous.ratingSource !== null ? { ratingSource: previous.ratingSource } : {}),
    ...(previous.minRating !== null ? { minRating: previous.minRating } : {}),
    ...(previous.maxRating !== null ? { maxRating: previous.maxRating } : {}),
    ratingComparison: previous.ratingComparison,
    maxRatingComparison: previous.maxRatingComparison,
    ...(previous.minVotes !== null ? { minVotes: previous.minVotes } : {}),
    ...(previous.minRuntimeMinutes !== null ? { minRuntimeMinutes: previous.minRuntimeMinutes } : {}),
    ...(previous.maxRuntimeMinutes !== null ? { maxRuntimeMinutes: previous.maxRuntimeMinutes } : {}),
    minRuntimeComparison: previous.minRuntimeComparison,
    maxRuntimeComparison: previous.maxRuntimeComparison,
    ...(previous.originalLanguage !== null ? { originalLanguage: previous.originalLanguage } : {}),
    excludeWatched: previous.excludeWatched,
    scope: previous.scope,
    sort: previous.sort,
    order: previous.order,
    limit: previous.limit
  };

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'inheritPreviousCriteria') continue;
    if (value === undefined) continue;
    if (value === null) {
      delete base[key];
    } else {
      base[key] = value;
    }
  }

  return validateAndNormalizeCriteria(base, options);
}
