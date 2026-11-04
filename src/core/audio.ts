/**
 * Web Audio synth SFX — no audio files, everything is synthesized.
 *
 * One shared AudioContext, created lazily on the first user gesture (the
 * browser requires that). Mute is persisted in localStorage so a parent only
 * has to tap it once.
 */

import { AUDIO } from './config';

const MUTE_STORAGE_KEY = 'pose-arcade:muted';

export class SoundEffects {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted: boolean;

  public constructor() {
    this.muted =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  }

  public get isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // Storage unavailable (private mode etc.) — mute still works in-memory.
    }
  }

  /** Create/resume the context. Call from a user gesture. */
  public unlock(): void {
    const ctx = this.ensureContext();
    if (ctx !== null && ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (this.context === null) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = AUDIO.masterGain;
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  private tone(
    freqHz: number,
    endFreqHz: number,
    durationSec: number,
    type: OscillatorType = 'square',
    whenSec = 0,
  ): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (ctx === null || this.master === null) return;
    const t0 = ctx.currentTime + whenSec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqHz, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(endFreqHz, 1), t0 + durationSec);
    gain.gain.setValueAtTime(0.5, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationSec);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + durationSec + 0.02);
  }

  /** Quick descending blip: a missile fired. */
  public shoot(): void {
    this.tone(AUDIO.shootFreqHz, AUDIO.shootEndFreqHz, AUDIO.shootDurationSec);
  }

  /** Two clicks: an arm lowered, ready to fire again. */
  public reload(): void {
    this.tone(AUDIO.reloadClickFreqHz, AUDIO.reloadClickFreqHz, 0.05);
    this.tone(
      AUDIO.reloadClickFreqHz,
      AUDIO.reloadClickFreqHz,
      0.05,
      'square',
      AUDIO.reloadGapSec,
    );
  }

  /** Low thud: the ship was hit. */
  public hit(): void {
    this.tone(AUDIO.hitFreqHz, 60, AUDIO.hitDurationSec, 'sawtooth');
  }

  /** Ascending jingle: level clear / game won. */
  public win(): void {
    AUDIO.winNotesHz.forEach((freq, i) => {
      this.tone(freq, freq, AUDIO.winNoteSec, 'triangle', i * AUDIO.winNoteSec);
    });
  }

  /** Dance Drop feedback: Perfect = high chime, Good = mid, Miss = low. */
  public feedback(kind: 'perfect' | 'good' | 'miss'): void {
    const freq =
      kind === 'perfect'
        ? AUDIO.perfectFreqHz
        : kind === 'good'
          ? AUDIO.goodFreqHz
          : AUDIO.missFreqHz;
    this.tone(freq, freq, AUDIO.feedbackDurationSec, 'triangle');
  }
}
