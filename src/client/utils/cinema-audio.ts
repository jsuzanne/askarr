/**
 * Synthétiseur d'Ambiance "Grand Cinéma" 100 % Web Audio API (Zéro fichier externe, Zéro impact CPU).
 *
 * Pourquoi ça ne ralentit jamais l'application :
 * - Aucun fichier MP3/WAV téléchargé sur le réseau (0 Ko de bande passante).
 * - La boucle Projecteur 35mm et la nappe acoustique sont pré-calculées une seule fois dans un
 *   `AudioBuffer` de 4 secondes joué en boucle matérielle par le thread audio C++ du navigateur
 *   (0 % de charge sur le thread JavaScript / React).
 * - Dès que l'onglet passe en arrière-plan (`visibilitychange`) ou que le mode est sur `off`,
 *   l'`AudioContext` est suspendu (`suspend()`), libérant immédiatement la carte son.
 */

export type CinemaAudioMode = 'off' | 'sfx_only' | 'projector' | 'grand_cinema' | 'fip_jazz';

const STORAGE_MODE_KEY = 'askarr_cinema_audio_mode';
const STORAGE_VOLUME_KEY = 'askarr_cinema_audio_volume';
const FIP_JAZZ_STREAM_URL = 'https://icecast.radiofrance.fr/fipjazz-midfi.mp3';
const FIP_JAZZ_FALLBACK_URL = 'https://direct.fipradio.fr/live/fip-webradio2.mp3';

class CinemaAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private projectorSource: AudioBufferSourceNode | null = null;
  private padOscillators: OscillatorNode[] = [];
  private padGain: GainNode | null = null;
  private padLfo: OscillatorNode | null = null;

  private mode: CinemaAudioMode = 'sfx_only';
  private volume = 0.45; // 0.0 -> 1.0
  private isAmbientRunning = false;

  // Boucle dédiée au projecteur rétro pendant la recherche / attente de réponse IA
  private retroSpinBuffer: AudioBuffer | null = null;
  private retroSpinSource: AudioBufferSourceNode | null = null;
  private retroSpinGain: GainNode | null = null;
  private retroSpinStopTimer: number | null = null;

  // Flux live Radio France "FIP Autour du Jazz" (créé uniquement à la demande, 0 impact hors mode FIP)
  private fipAudio: HTMLAudioElement | null = null;
  private isFipDucked = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const savedMode = window.localStorage.getItem(STORAGE_MODE_KEY) as CinemaAudioMode | null;
      if (
        savedMode === 'off' ||
        savedMode === 'sfx_only' ||
        savedMode === 'projector' ||
        savedMode === 'grand_cinema' ||
        savedMode === 'fip_jazz'
      ) {
        this.mode = savedMode;
      }
      const savedVol = Number(window.localStorage.getItem(STORAGE_VOLUME_KEY));
      if (!Number.isNaN(savedVol) && savedVol >= 0.05 && savedVol <= 1) {
        this.volume = savedVol;
      }

      // Pause automatiquement le moteur audio quand l'onglet n'est plus visible (0 batterie sur mobile)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          if (this.ctx) {
            void this.ctx.suspend().catch(() => undefined);
          }
          if (this.fipAudio && !this.fipAudio.paused) {
            this.fipAudio.pause();
          }
        } else if (this.mode !== 'off') {
          if (this.ctx) {
            void this.ctx.resume().catch(() => undefined);
          }
          if (this.mode === 'fip_jazz' && this.fipAudio && this.fipAudio.paused) {
            void this.fipAudio.play().catch(() => undefined);
          }
        }
      });
    }
  }

  public getMode(): CinemaAudioMode {
    return this.mode;
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(newVolume: number): void {
    this.volume = Math.max(0.05, Math.min(1, newVolume));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_VOLUME_KEY, String(this.volume));
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.08);
    }
    this.syncFipVolume();
  }

  private syncFipVolume(): void {
    if (!this.fipAudio) return;
    const baseVol = Math.max(0.03, Math.min(1, this.volume * (this.isFipDucked ? 0.22 : 0.55)));
    this.fipAudio.volume = baseVol;
  }

  private startFipJazzStream(): void {
    if (typeof window === 'undefined') return;
    if (!this.fipAudio) {
      const audio = new Audio();
      audio.preload = 'none';
      audio.crossOrigin = 'anonymous';
      audio.onerror = () => {
        if (audio.src !== FIP_JAZZ_FALLBACK_URL && this.mode === 'fip_jazz') {
          audio.src = FIP_JAZZ_FALLBACK_URL;
          void audio.play().catch(() => undefined);
        }
      };
      this.fipAudio = audio;
    }
    if (!this.fipAudio.src || (!this.fipAudio.src.includes('radiofrance') && !this.fipAudio.src.includes('fipradio'))) {
      this.fipAudio.src = FIP_JAZZ_STREAM_URL;
    }
    this.syncFipVolume();
    void this.fipAudio.play().catch(() => undefined);
  }

  private stopFipJazzStream(): void {
    if (!this.fipAudio) return;
    try {
      this.fipAudio.pause();
      this.fipAudio.removeAttribute('src');
      this.fipAudio.load();
    } catch {
      // Ignore
    }
  }

  public setMode(newMode: CinemaAudioMode): void {
    this.mode = newMode;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_MODE_KEY, newMode);
    }

    if (newMode === 'off') {
      this.stopAmbientNodes();
      this.stopFipJazzStream();
      this.stopRetroProjectorSpin(true);
      if (this.ctx && this.ctx.state === 'running') {
        void this.ctx.suspend().catch(() => undefined);
      }
      return;
    }

    this.ensureContext();
    if (!this.ctx) return;

    if (newMode === 'sfx_only') {
      this.stopAmbientNodes();
      this.stopFipJazzStream();
      this.playCurtainChimeSfx();
    } else if (newMode === 'fip_jazz') {
      this.stopAmbientNodes();
      this.startFipJazzStream();
      this.playCurtainChimeSfx();
    } else {
      this.stopFipJazzStream();
      this.startOrUpdateAmbientNodes();
      this.playCurtainChimeSfx();
    }
  }

  /**
   * Réveille le contexte audio au premier clic de l'utilisateur si un mode était sauvegardé.
   */
  public unlockOnUserGesture(): void {
    if (this.mode === 'off') return;
    this.ensureContext();
    if (this.mode === 'projector' || this.mode === 'grand_cinema') {
      if (!this.isAmbientRunning) {
        this.startOrUpdateAmbientNodes();
      }
    } else if (this.mode === 'fip_jazz') {
      if (!this.fipAudio || this.fipAudio.paused) {
        this.startFipJazzStream();
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  /**
   * Génère une boucle matérielle de 4 secondes imitant le ronronnement feutré d'une cabine
   * de projection 35mm (24 images/s feutrées + chaleur acoustique de salle obscure).
   * Calculé une seule fois en mémoire (~350 Ko).
   */
  private createProjectorLoopBuffer(ctx: AudioContext): AudioBuffer {
    const durationSec = 4;
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * durationSec;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Filtre passe-bas simple à 1 pôle pour transformer le bruit blanc en souffle de salle très doux
    let lastOut = 0;
    const sprocketsPerSec = 18; // cadence mécanique douce et apaisante
    const samplesPerSprocket = Math.floor(sampleRate / sprocketsPerSec);

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Souffle chaud filtré (Brown/Pink noise très doux)
      lastOut = (lastOut + 0.025 * white) / 1.025;
      let sample = lastOut * 0.16;

      // Léger ronronnement moteur 50 Hz + harmonique 100 Hz très atténué
      const t = i / sampleRate;
      sample += Math.sin(2 * Math.PI * 52 * t) * 0.012;
      sample += Math.sin(2 * Math.PI * 104 * t) * 0.006;

      // Micro-cliquetis feutré de pellicule 35mm (enveloppe exponentielle de 4 ms)
      const posInSprocket = i % samplesPerSprocket;
      if (posInSprocket < sampleRate * 0.004) {
        const env = Math.exp(-posInSprocket / (sampleRate * 0.001));
        // Légère variation naturelle d'un cran à l'autre
        const sprocketIndex = Math.floor(i / samplesPerSprocket);
        const accent = sprocketIndex % 4 === 0 ? 1.15 : 0.75;
        sample += white * env * 0.032 * accent;
      }

      data[i] = sample;
    }

    return buffer;
  }

  private stopAmbientNodes(): void {
    try {
      if (this.projectorSource) {
        this.projectorSource.stop();
        this.projectorSource.disconnect();
        this.projectorSource = null;
      }
      for (const osc of this.padOscillators) {
        osc.stop();
        osc.disconnect();
      }
      this.padOscillators = [];
      if (this.padLfo) {
        this.padLfo.stop();
        this.padLfo.disconnect();
        this.padLfo = null;
      }
      if (this.padGain) {
        this.padGain.disconnect();
        this.padGain = null;
      }
      if (this.ambientGain) {
        this.ambientGain.disconnect();
        this.ambientGain = null;
      }
    } catch {
      // Ignore stop errors on already stopped nodes
    }
    this.isAmbientRunning = false;
  }

  private startOrUpdateAmbientNodes(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    this.stopAmbientNodes();

    const now = ctx.currentTime;
    const ambGain = ctx.createGain();
    ambGain.gain.setValueAtTime(0.001, now);
    ambGain.gain.exponentialRampToValueAtTime(1.0, now + 1.2);
    ambGain.connect(this.masterGain);
    this.ambientGain = ambGain;

    // 1. Couche Projecteur 35mm feutré (active en mode 'projector' et 'grand_cinema')
    const projBuffer = this.createProjectorLoopBuffer(ctx);
    const projSource = ctx.createBufferSource();
    projSource.buffer = projBuffer;
    projSource.loop = true;

    const projFilter = ctx.createBiquadFilter();
    projFilter.type = 'lowpass';
    projFilter.frequency.value = 950; // Garde uniquement le côté feutré/chaud

    projSource.connect(projFilter);
    projFilter.connect(ambGain);
    projSource.start(now);
    this.projectorSource = projSource;

    // 2. Couche Nappe Harmonique "Prélude Grand Cinéma" (uniquement en mode 'grand_cinema')
    if (this.mode === 'grand_cinema') {
      const padGain = ctx.createGain();
      padGain.gain.setValueAtTime(0.001, now);
      padGain.gain.exponentialRampToValueAtTime(0.055, now + 2.5);

      const padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 320;
      padFilter.Q.value = 0.7;

      // LFO ultra-lent (respiration de la salle toutes les 12 secondes)
      const lfo = ctx.createOscillator();
      const lfoDepth = ctx.createGain();
      lfo.frequency.value = 0.08;
      lfoDepth.gain.value = 90;
      lfo.connect(lfoDepth);
      lfoDepth.connect(padFilter.frequency);
      lfo.start(now);
      this.padLfo = lfo;

      // Accord cinématographique suspendu très doux (Ré2, La2, Mi3, Fa#3)
      const chordFreqs = [73.42, 110.0, 164.81, 185.0];
      for (const freq of chordFreqs) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = (Math.random() - 0.5) * 8;
        osc.connect(padFilter);
        osc.start(now);
        this.padOscillators.push(osc);
      }

      padFilter.connect(padGain);
      padGain.connect(ambGain);
      this.padGain = padGain;
    }

    this.isAmbientRunning = true;
  }

  /**
   * Micro-SFX 1 : Envoi d'une question au projectionniste (enclenchement mécanique + démarrage
   * du projecteur rétro qui tourne pendant toute l'attente de la réponse).
   */
  public playSearchReelSfx(): void {
    this.startRetroProjectorSpin();
  }

  /**
   * Génère un buffer matériel de 2 secondes reproduisant fidèlement un projecteur rétro 16mm/35mm
   * en pleine recherche :
   * - Mécanisme intermittent à croix de Malte (double cliquetis mécanique : griffe + obturateur à 20 img/s)
   * - Frottement cyclique de la bobine celluloïd (légère modulation à chaque tour de bobine)
   * - Ronronnement chaud du moteur électrique et de la lampe ventilée
   */
  private getOrCreateRetroSpinBuffer(ctx: AudioContext): AudioBuffer {
    if (this.retroSpinBuffer && this.retroSpinBuffer.sampleRate === ctx.sampleRate) {
      return this.retroSpinBuffer;
    }

    const durationSec = 2;
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * durationSec;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    const fps = 20; // Cadence projecteur rétro bien audible et cinématographique
    const samplesPerFrame = Math.floor(sampleRate / fps);
    const secondaryTickOffset = Math.floor(sampleRate * 0.011); // Obturateur 11 ms après la griffe

    let lpNoise = 0;
    let bpState1 = 0;
    let bpState2 = 0;

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const white = Math.random() * 2 - 1;

      // 1. Souffle mécanique et frottement de pellicule modulé par la rotation de la bobine (1.5 tour/s)
      lpNoise = (lpNoise + 0.04 * white) / 1.04;
      const reelSwish = 0.8 + 0.35 * Math.sin(2 * Math.PI * 1.5 * t);
      let sample = lpNoise * 0.18 * reelSwish;

      // 2. Ronronnement du moteur synchrone rétro (55 Hz + 110 Hz + 165 Hz)
      sample += Math.sin(2 * Math.PI * 55 * t) * 0.022;
      sample += Math.sin(2 * Math.PI * 110 * t) * 0.014;
      sample += Math.sin(2 * Math.PI * 165 * t) * 0.007;

      // 3. Cliquetis mécanique de la croix de Malte (griffe d'entraînement + pale d'obturateur)
      const posInFrame = i % samplesPerFrame;
      const frameIndex = Math.floor(i / samplesPerFrame);
      const frameAccent = frameIndex % 4 === 0 ? 1.2 : frameIndex % 2 === 0 ? 0.95 : 0.82;

      // Impulsion principale (griffe qui tire la perforation 35mm)
      if (posInFrame < sampleRate * 0.0055) {
        const env = Math.exp(-posInFrame / (sampleRate * 0.0012));
        const woodyClick = Math.sin(2 * Math.PI * 820 * (posInFrame / sampleRate)) * 0.55 + white * 0.85;
        sample += woodyClick * env * 0.14 * frameAccent;
      }

      // Impulsion secondaire (fermeture de la pale d'obturateur)
      const posSecondary = posInFrame - secondaryTickOffset;
      if (posSecondary >= 0 && posSecondary < sampleRate * 0.0035) {
        const env2 = Math.exp(-posSecondary / (sampleRate * 0.0008));
        const metalTick = Math.sin(2 * Math.PI * 1650 * (posSecondary / sampleRate)) * 0.45 + white * 0.65;
        sample += metalTick * env2 * 0.075 * frameAccent;
      }

      // Léger lissage résonant pour donner la couleur "boîtier métallique vintage"
      bpState1 = 0.85 * bpState1 + 0.15 * sample;
      bpState2 = 0.92 * bpState2 + 0.08 * bpState1;
      data[i] = sample * 0.75 + bpState2 * 0.35;
    }

    this.retroSpinBuffer = buffer;
    return buffer;
  }

  /**
   * Démarre le bruit de projecteur rétro qui tourne en continu pendant que l'utilisateur
   * attend la réponse du projectionniste IA.
   * Inclut une vraie mise en vitesse mécanique (inertie de la bobine au démarrage).
   */
  public startRetroProjectorSpin(autoStopAfterMs?: number): void {
    if (this.mode === 'off') return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    // Nettoie une éventuelle boucle précédente
    this.stopRetroProjectorSpin(true);

    // Si FIP Jazz tourne, baisse légèrement son volume ("ducking") pendant que le projecteur tourne
    this.isFipDucked = true;
    this.syncFipVolume();

    const now = ctx.currentTime;

    // Petit "clac" d'interrupteur mécanique à bascule au démarrage
    const switchOsc = ctx.createOscillator();
    const switchGain = ctx.createGain();
    switchOsc.type = 'triangle';
    switchOsc.frequency.setValueAtTime(190, now);
    switchOsc.frequency.exponentialRampToValueAtTime(420, now + 0.045);
    switchGain.gain.setValueAtTime(0.09, now);
    switchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    switchOsc.connect(switchGain);
    switchGain.connect(this.masterGain);
    switchOsc.start(now);
    switchOsc.stop(now + 0.06);

    // Boucle matérielle du projecteur rétro
    const buffer = this.getOrCreateRetroSpinBuffer(ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Inertie mécanique : la bobine démarre plus lentement (0.55x) et atteint sa vitesse nominale (1.0x) en 0.45s
    source.playbackRate.setValueAtTime(0.55, now);
    source.playbackRate.exponentialRampToValueAtTime(1.0, now + 0.45);

    // Filtre passe-bande chaud pour le timbre "projecteur rétro"
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + 0.45);

    const spinGain = ctx.createGain();
    spinGain.gain.setValueAtTime(0.001, now);
    spinGain.gain.linearRampToValueAtTime(0.32, now + 0.18);

    source.connect(filter);
    filter.connect(spinGain);
    spinGain.connect(this.masterGain);

    source.start(now);
    this.retroSpinSource = source;
    this.retroSpinGain = spinGain;

    if (autoStopAfterMs && typeof window !== 'undefined') {
      this.retroSpinStopTimer = window.setTimeout(() => {
        this.stopRetroProjectorSpin(false);
      }, autoStopAfterMs);
    }
  }

  /**
   * Arrête le projecteur rétro lorsque la réponse est prête, avec un effet réaliste
   * de décélération de bobine (freinage mécanique doux).
   */
  public stopRetroProjectorSpin(immediate = false): void {
    if (this.retroSpinStopTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.retroSpinStopTimer);
      this.retroSpinStopTimer = null;
    }

    const source = this.retroSpinSource;
    const gain = this.retroSpinGain;
    this.retroSpinSource = null;
    this.retroSpinGain = null;

    // Remonte le volume de FIP Jazz en douceur
    this.isFipDucked = false;
    this.syncFipVolume();

    if (!source || !gain || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      if (immediate) {
        source.stop(now);
        source.disconnect();
        gain.disconnect();
        return;
      }

      // Décélération mécanique de la bobine (1.0x -> 0.42x) + fondu de sortie sur 260 ms
      source.playbackRate.cancelScheduledValues(now);
      source.playbackRate.setValueAtTime(source.playbackRate.value || 1.0, now);
      source.playbackRate.exponentialRampToValueAtTime(0.42, now + 0.26);

      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value || 0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

      source.stop(now + 0.28);
    } catch {
      // Ignore si déjà arrêté
    }
  }

  /**
   * Micro-SFX 2 : Apparition des affiches de films (accord lumineux très feutré façon ouverture de rideau).
   */
  public playCurtainChimeSfx(): void {
    if (this.mode === 'off') return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25]; // Accord de La Majeur doux
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.055;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.045, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.45);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + 0.48);
    });
  }

  /**
   * Micro-SFX 3 : Billet VIP composté lors de la confirmation d'une demande Overseerr.
   */
  public playTicketPunchSfx(): void {
    if (this.mode === 'off') return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // Arpège Do5-Mi5-Sol5-Do6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.045;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.06, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + 0.38);
    });
  }
}

export const cinemaAudio = new CinemaAudioEngine();
