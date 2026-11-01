import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type SupportedLanguage = 'fr' | 'en';

export interface Translations {
  // Navigation & Header
  salle_cine: string;
  salle_cine_tooltip: string;
  vue_user: string;
  vue_user_tooltip: string;
  regie_admin: string;
  grand_cinema_badge: string;
  regie_admin_badge: string;
  quitter_vue_user: string;
  viewer_mode_active: string;
  ambiance: string;
  ambiance_title: string;
  traces_on: string;
  traces_off: string;
  administrator: string;
  friend: string;
  plex_servers_count: string;
  plex_servers_label: string;

  // Audio Menu
  soundscape_title: string;
  soundscape_subtitle: string;
  audio_off: string;
  audio_sfx_only: string;
  audio_projector: string;
  audio_fip_jazz: string;
  audio_grand_cine: string;

  // Subheader Quick Action Pills
  grand_ecran_cine_club: string;
  mes_programmations: string;
  nouvelle_discussion: string;
  derniers_ajouts_plex: string;
  mon_historique_reprise: string;
  palmares_cannes: string;
  par_realisateur_acteur: string;
  pepites_plex: string;
  sorties_salle_dates_vod: string;

  // Empty State / Projectionist
  projectionist_role: string;
  welcome_title: string;
  welcome_subtitle: string;
  welcome_bullet_1: string;
  welcome_bullet_2: string;
  welcome_bullet_3: string;

  // Input Bar
  input_placeholder: string;
  start_session: string;

  // Media Card
  open_in_plex: string;
  open_plex_app: string;
  similar_movies: string;
  similar_series: string;
  available_now: string;
  available_on_servers: string;
  in_waiting_list: string;
  not_on_plex_can_request: string;
  downloading_in_progress: string;
  theatrical_release: string;
  vod_release: string;
  requested_by: string;
  auto_list: string;
  director: string;
  creator: string;
  cast: string;
  synopsis: string;
  confirm_request: string;
  request_on_plex: string;
  complete_season: string;
  select_season: string;

  // Régie Admin Tabs
  tab_users_vip: string;
  tab_health: string;
  tab_tracer: string;
  tab_journal: string;
  tab_settings: string;
  test_api: string;
  refresh: string;
  active_key: string;
  to_review: string;

  // Language Switcher
  language: string;
  switch_to_fr: string;
  switch_to_en: string;
}

const translations: Record<SupportedLanguage, Translations> = {
  fr: {
    salle_cine: 'Salle Ciné',
    salle_cine_tooltip: 'Salle Ciné avec traces techniques et outils Admin',
    vue_user: 'Vue User',
    vue_user_tooltip: "Mode Viewer (User) : Voir et tester exactement l'interface d'un ami invité sans créer de compte",
    regie_admin: 'Régie Admin',
    grand_cinema_badge: '🍿 GRAND CINÉMA',
    regie_admin_badge: '🎬 RÉGIE ADMIN',
    quitter_vue_user: 'Quitter Vue User ✕',
    viewer_mode_active: 'Vue User ({username})',
    ambiance: 'Ambiance :',
    ambiance_title: 'Ambiance sonore de salle de cinéma & bruitages (Web Audio natif)',
    traces_on: 'Traces : ON',
    traces_off: 'Traces : OFF',
    administrator: 'Administrateur',
    friend: 'Spectateur invité',
    plex_servers_count: '{count} serveurs Plex',
    plex_servers_label: 'Serveurs Plex :',

    soundscape_title: 'Ambiance Sonore Cinéma',
    soundscape_subtitle: 'Synthèse Web Audio 100% native • 0 Mo • 0 ralentissement',
    audio_off: 'Muet',
    audio_sfx_only: 'Projecteur',
    audio_projector: 'Cabine 35mm',
    audio_fip_jazz: '🎷 FIP Jazz',
    audio_grand_cine: 'Grand Ciné',

    grand_ecran_cine_club: 'Grand Écran & Ciné-Club',
    mes_programmations: 'Mes Programmations',
    nouvelle_discussion: 'Nouvelle discussion',
    derniers_ajouts_plex: 'Derniers ajouts Plex',
    mon_historique_reprise: 'Mon historique & reprise',
    palmares_cannes: 'Palmarès Cannes / Retrouver un film',
    par_realisateur_acteur: 'Par réalisateur ou acteur',
    pepites_plex: 'Pépites sur Plex (> 7.8)',
    sorties_salle_dates_vod: 'Sorties Salle & dates VOD',

    projectionist_role: 'PROJECTIONNISTE ASKARR • SPÉCIALISTE 7E ART',
    welcome_title: 'Bienvenue dans ta salle Askarr — Grand Cinéma & Séries !',
    welcome_subtitle: "Installe-toi dans ton fauteuil, je m'occupe de la séance :",
    welcome_bullet_1: "Retrouver un film ou une série à partir d'un réalisateur (Klapisch, Villeneuve...), d'un acteur (Pierre Niney...), d'une année, d'un souvenir d'intrigue ou d'un palmarès (Festival de Cannes / Palme d'Or, César, Oscars).",
    welcome_bullet_2: "Vérifier instantanément s'il est à l'affiche sur nos serveurs Plex avec les notes IMDb.",
    welcome_bullet_3: 'Regarder sa date de sortie VOD / DVD ou le programmer sur Plex en 2 clics.',

    input_placeholder: 'Un film, un réalisateur, un acteur, une intrigue ou un palmarès de Cannes...',
    start_session: 'Lancer la séance',

    open_in_plex: 'Ouvrir sur Plex',
    open_plex_app: "Ouvrir l'app Plex",
    similar_movies: 'Films similaires',
    similar_series: 'Séries similaires',
    available_now: 'Disponible immédiatement sur Plex',
    available_on_servers: 'Disponible sur vos serveurs Plex ({servers})',
    in_waiting_list: "Dans la liste d'attente",
    not_on_plex_can_request: 'Pas encore sur Plex — Disponible à la demande',
    downloading_in_progress: 'Téléchargement en cours',
    theatrical_release: 'Sortie ciné : {date}',
    vod_release: 'VOD/DVD : {date}',
    requested_by: 'Demandé par {name}',
    auto_list: 'Liste auto',
    director: 'Réalisation :',
    creator: 'Création :',
    cast: 'Avec :',
    synopsis: 'Synopsis',
    confirm_request: 'Confirmer la demande',
    request_on_plex: 'Demander sur Plex',
    complete_season: 'Compléter la Saison {season}',
    select_season: 'Choisir une saison',

    tab_users_vip: 'Utilisateurs Plex & VIP',
    tab_health: 'Santé Projecteurs',
    tab_tracer: 'Traceur API',
    tab_journal: 'Journal Q&A & Notes',
    tab_settings: 'Paramètres & Identités',
    test_api: 'Tester API',
    refresh: 'Actualiser',
    active_key: 'Clé API active',
    to_review: 'à voir',

    language: 'Langue',
    switch_to_fr: 'Passer en Français',
    switch_to_en: 'Switch to English'
  },
  en: {
    salle_cine: 'Cinema Room',
    salle_cine_tooltip: 'Cinema Room with technical traces and admin tools',
    vue_user: 'User View',
    vue_user_tooltip: "Viewer Mode: Preview the exact experience of an invited friend without an account",
    regie_admin: 'Admin Room',
    grand_cinema_badge: '🍿 GRAND CINEMA',
    regie_admin_badge: '🎬 ADMIN ROOM',
    quitter_vue_user: 'Exit User View ✕',
    viewer_mode_active: 'User View ({username})',
    ambiance: 'Soundscape:',
    ambiance_title: 'Cinema room audio atmosphere & procedural sound effects (native Web Audio)',
    traces_on: 'Traces: ON',
    traces_off: 'Traces: OFF',
    administrator: 'Administrator',
    friend: 'Invited Friend',
    plex_servers_count: '{count} Plex servers',
    plex_servers_label: 'Plex Servers:',

    soundscape_title: 'Cinema Soundscape',
    soundscape_subtitle: '100% native Web Audio synthesis • 0 MB • 0 performance impact',
    audio_off: 'Muted',
    audio_sfx_only: 'Projector',
    audio_projector: '35mm Booth',
    audio_fip_jazz: '🎷 FIP Jazz',
    audio_grand_cine: 'Grand Cinema',

    grand_ecran_cine_club: 'Cinema Club',
    mes_programmations: 'My Requests',
    nouvelle_discussion: 'New Screening',
    derniers_ajouts_plex: 'Recent Plex Additions',
    mon_historique_reprise: 'My Watch History',
    palmares_cannes: 'Cannes & Awards / Find a Film',
    par_realisateur_acteur: 'By Director or Actor',
    pepites_plex: 'Plex Gems (> 7.8)',
    sorties_salle_dates_vod: 'Theatrical & VOD Dates',

    projectionist_role: 'ASKARR PROJECTIONIST • 7TH ART SPECIALIST',
    welcome_title: 'Welcome to Askarr — Grand Cinema & Series!',
    welcome_subtitle: "Take your seat, I'll take care of the screening:",
    welcome_bullet_1: 'Find any film or series by director (Nolan, Villeneuve...), actor, release year, plot memories, or film awards (Oscars, Cannes Palme d\'Or, BAFTAs).',
    welcome_bullet_2: 'Instantly check whether it is available on our Plex servers with live IMDb ratings.',
    welcome_bullet_3: 'Check theatrical & digital VOD/DVD release dates or request it on Plex in two clicks.',

    input_placeholder: 'A movie, director, actor, plot memory, or festival award...',
    start_session: 'Start screening',

    open_in_plex: 'Open in Plex',
    open_plex_app: 'Open Plex App',
    similar_movies: 'Similar Movies',
    similar_series: 'Similar Series',
    available_now: 'Available immediately on Plex',
    available_on_servers: 'Available on your Plex servers ({servers})',
    in_waiting_list: 'In the waiting list',
    not_on_plex_can_request: 'Not on Plex yet — Available to request',
    downloading_in_progress: 'Downloading in progress',
    theatrical_release: 'Theatrical release: {date}',
    vod_release: 'Digital / DVD: {date}',
    requested_by: 'Requested by {name}',
    auto_list: 'Auto list',
    director: 'Director:',
    creator: 'Creator:',
    cast: 'Cast:',
    synopsis: 'Synopsis',
    confirm_request: 'Confirm Request',
    request_on_plex: 'Request on Plex',
    complete_season: 'Complete Season {season}',
    select_season: 'Select a season',

    tab_users_vip: 'Plex Users & VIP',
    tab_health: 'System Health',
    tab_tracer: 'API Tracer',
    tab_journal: 'Q&A Journal & Notes',
    tab_settings: 'Settings & Identities',
    test_api: 'Test API',
    refresh: 'Refresh',
    active_key: 'Active API Key',
    to_review: 'to review',

    language: 'Language',
    switch_to_fr: 'Passer en Français',
    switch_to_en: 'Switch to English'
  }
};

interface I18nContextType {
  lang: SupportedLanguage;
  setLang: (lang: SupportedLanguage) => void;
  toggleLang: () => void;
  t: (key: keyof Translations, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const STORAGE_KEY = 'askarr_ui_language';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<SupportedLanguage>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'fr' || stored === 'en') return stored;
      if (typeof navigator !== 'undefined' && navigator.language) {
        return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
      }
    } catch {
      // Fallback in environments without localStorage
    }
    return 'fr';
  });

  const setLang = (newLang: SupportedLanguage) => {
    setLangState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {
      // Ignore
    }
  };

  const toggleLang = () => {
    setLang(lang === 'fr' ? 'en' : 'fr');
  };

  const t = (key: keyof Translations, params?: Record<string, string | number>): string => {
    const dict = translations[lang] || translations.fr;
    let text = dict[key] || translations.fr[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

const defaultContextValue: I18nContextType = {
  lang: 'fr',
  setLang: () => {},
  toggleLang: () => {},
  t: (key: keyof Translations, params?: Record<string, string | number>) => {
    let text = translations.fr[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return text;
  }
};

export function useI18n() {
  const ctx = useContext(I18nContext);
  return ctx || defaultContextValue;
}
