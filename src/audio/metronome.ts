// Sample-accurate metronome built on a Web Audio lookahead scheduler (the
// classic "schedule a little ahead on a coarse timer" pattern). It plays through
// the app's shared output context (src/audio/outputContext.ts), which is kept
// separate from the mic graph so the click never contends with capture. A single
// shared instance backs the whole app, so toggling from any drill controls one
// click, never two overlapping ones.

import {
  getOutputContext,
  isOutputAudioReady,
  requestOutputAudio,
  releaseOutputAudio,
  unlockOutputAudio,
  outputAudioState,
  onOutputAudioChange,
} from './outputContext';

const LOOKAHEAD_MS = 25; // how often the scheduler wakes to queue clicks
const SCHEDULE_AHEAD_S = 0.12; // how far ahead of the clock clicks are queued
const DEFAULT_BEATS_PER_BAR = 4;
const START_OFFSET_S = 0.08; // breathing room between "go" and the first click
const SILENT_GRACE_MS = 700; // how long a start may take before we call it muted

export const MIN_BPM = 40;
export const MAX_BPM = 240;

const clampBpm = (bpm: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));

export class Metronome {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private beat = 0;
  private bpm = 90;
  private beatsPerBar = DEFAULT_BEATS_PER_BAR;
  private running = false;
  // Fired on the main thread roughly at each audible click, so the UI can pulse
  // in time. `accent` marks beat one of the bar.
  onBeat: ((accent: boolean) => void) | null = null;
  // Fired whenever the click's *audible* state changes. Running and audible are
  // not the same thing: the browser can hold audio suspended, and the UI has to
  // say so rather than show a tempo that isn't sounding.
  onAudibleChange: ((audible: boolean) => void) | null = null;

  constructor() {
    onOutputAudioChange((ready) => {
      if (!this.running) {
        this.emitAudible();
        return;
      }
      if (ready) {
        // The clock was frozen while audio was held, so anything queued is
        // stale. Pick the count up again just ahead of the live clock.
        this.rebase();
        this.startTimer();
      } else {
        // Interrupted mid-drill (a call, the session handed elsewhere). Go quiet
        // and start asking for it back rather than ticking into a void.
        this.stopTimer();
        requestOutputAudio();
      }
      this.emitAudible();
    });
  }

  private rebase(): void {
    const ctx = getOutputContext();
    if (ctx) this.nextNoteTime = ctx.currentTime + START_OFFSET_S;
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.schedule(), LOOKAHEAD_MS);
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isAudible(): boolean {
    return this.running && isOutputAudioReady();
  }

  getBpm(): number {
    return this.bpm;
  }

  setBpm(bpm: number): void {
    this.bpm = clampBpm(bpm);
  }

  // How many beats the accent cycle spans. Drills set this to the beats between
  // chord changes, so the accented click always lands on "change now" rather
  // than on an abstract beat one the player has to count against.
  setBeatsPerBar(beats: number): void {
    const next = Math.max(1, Math.round(beats));
    if (next === this.beatsPerBar) return;
    this.beatsPerBar = next;
    // Restart the cycle so the next accent is a full bar away, never a stray
    // one landing mid-figure because the old count was further along.
    this.beat = 0;
  }

  private emitAudible(): void {
    this.onAudibleChange?.(this.isAudible);
  }

  start(bpm?: number): void {
    if (bpm != null) this.setBpm(bpm);
    if (this.running) return;
    const ctx = getOutputContext();
    if (!ctx) return;
    this.running = true;
    this.beat = 0;
    this.nextNoteTime = ctx.currentTime + START_OFFSET_S;

    if (this.isAudible) {
      this.startTimer();
      this.emitAudible();
      return;
    }

    // In coached practice the click starts on the coach's schedule, seconds
    // after the last tap, and the coach's voice may still hold the audio
    // session. Keep asking (slowly) until it is free, and don't tick until it
    // is: a click that cannot sound must cost nothing, or it starves the voice.
    requestOutputAudio();
    // Report silence only if it is still silent a moment later, so the ordinary
    // case never flashes a warning on its way to playing.
    setTimeout(() => {
      if (this.running && !this.isAudible) this.emitAudible();
    }, SILENT_GRACE_MS);
  }

  stop(): void {
    this.stopTimer();
    releaseOutputAudio();
    if (!this.running) return;
    this.running = false;
    this.emitAudible();
  }

  // Free audio from inside a user gesture, then restart the count from here.
  // The click is the one control the player can use to fix a silent context.
  unlockAndStart(bpm?: number): void {
    unlockOutputAudio();
    this.stop();
    this.start(bpm);
  }

  private schedule(): void {
    const ctx = getOutputContext();
    if (!ctx) return;
    if (ctx.state !== 'running') {
      // Nothing can sound right now. Hold the next click just ahead of the clock
      // so a resume doesn't dump a backlog of stale beats in one burst.
      this.nextNoteTime = ctx.currentTime + START_OFFSET_S;
      return;
    }
    const secondsPerBeat = 60 / this.bpm;
    while (this.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const accent = this.beat === 0;
      this.click(ctx, this.nextNoteTime, accent);
      if (this.onBeat) {
        const delayMs = Math.max(0, (this.nextNoteTime - ctx.currentTime) * 1000);
        const fireAccent = accent;
        setTimeout(() => this.onBeat?.(fireAccent), delayMs);
      }
      this.nextNoteTime += secondsPerBeat;
      this.beat = (this.beat + 1) % this.beatsPerBar;
    }
  }

  private click(ctx: AudioContext, time: number, accent: boolean): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    const peak = accent ? 0.5 : 0.34;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }
}

// One shared engine for the whole app.
export const metronome = new Metronome();

// Field diagnostic, alongside window.dailyFretDiag. A silent click has several
// possible causes that look identical from the outside, and this separates them:
// `context` is what the browser says, `running` is what the app asked for,
// `audible` is whether those agree.
if (typeof window !== 'undefined') {
  (window as unknown as { dailyFretAudio: () => unknown }).dailyFretAudio = () => ({
    ...outputAudioState(),
    running: metronome.isRunning,
    audible: metronome.isAudible,
    bpm: metronome.getBpm(),
  });
}
