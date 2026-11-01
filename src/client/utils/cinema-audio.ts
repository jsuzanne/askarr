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

export type CinemaAudioMode = 'off' | 'sfx_only' | 'projector' | 'grand_cinema';

const STORAGE_MODE_KEY = 'askarr_cinema_audio_mode';
const STORAGE_VOLUME_KEY = 'askarr_cinema_audio_volume';

class CinemaAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private projectorSource: AudioBufferSourceNode | null = null;
  private padOscillators: OscillatorNode[] = [];
  private padGain: GainNode | null = null;
  private padLfo: OscillatorNode | null = null;

  private mode: CinemaAudioMode = 'off';
  private volume = 0.45; // 0.0 -> 1.0
  private isAmbientRunning = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const savedMode = window.localStorage.getItem(STORAGE_MODE_KEY) as CinemaAudioMode | null;
      if (
        savedMode === 'off' ||
        savedMode === 'sfx_only' ||
        savedMode === 'projector' ||
        savedMode === 'grand_cinema'
      ) {
        this.mode = savedMode;
      }
      const savedVol = Number(window.localStorage.getItem(STORAGE_VOLUME_KEY));
      if (!Number.isNaN(savedVol) && savedVol >= 0.05 && savedVol <= 1) {
        this.volume = savedVol;
      }

      // Pause automatiquement le moteur audio quand l'onglet n'est plus visible (0 batterie sur mobile)
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) {
          void this.ctx.suspend().catch(() => undefined);
        } else if (this.mode !== 'off') {
          void this.ctx.resume().catch(() => undefined);
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
  }

  public setMode(newMode: CinemaAudioMode): void {
    this.mode = newMode;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_MODE_KEY, newMode);
    }

    if (newMode === 'off') {
      this.stopAmbientNodes();
      if (this.ctx && this.ctx.state === 'running') {
        void this.ctx.suspend().catch(() => undefined);
      }
      return;
    }

    this.ensureContext();
    if (!this.ctx) return;

    if (newMode === 'sfx_only') {
      this.stopAmbientNodes();
      this.playCurtainChimeSfx();
    } else {
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
   * Micro-SFX 1 : Envoi d'une question au projectionniste (petit enclenchement mécanique doux).
   */
  public playSearchReelSfx(): void {
    if (this.mode === 'off') return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(330, now + 0.09);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
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
