// Sample-accurate metronome built on a Web Audio lookahead scheduler (the
// classic "schedule a little ahead on a coarse timer" pattern). It owns its own
// output-only AudioContext, so it runs alongside the mic detector without
// contending for the input graph. A single shared instance backs the whole app
// so toggling from any drill controls one click, never two overlapping ones.

const LOOKAHEAD_MS = 25; // how often the scheduler wakes to queue clicks
const SCHEDULE_AHEAD_S = 0.12; // how far ahead of the clock clicks are queued
const DEFAULT_BEATS_PER_BAR = 4;

export const MIN_BPM = 40;
export const MAX_BPM = 240;

const clampBpm = (bpm: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));

export class Metronome {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private beat = 0;
  private bpm = 90;
  private beatsPerBar = DEFAULT_BEATS_PER_BAR;
  private running = false;
  // Fired on the main thread roughly at each audible click, so the UI can pulse
  // in time. `accent` marks beat one of the bar.
  onBeat: ((accent: boolean) => void) | null = null;

  get isRunning(): boolean {
    return this.running;
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

  start(bpm?: number): void {
    if (bpm != null) this.setBpm(bpm);
    if (this.running) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    void this.ctx.resume();
    this.running = true;
    this.beat = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), LOOKAHEAD_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }

  private schedule(): void {
    if (!this.ctx) return;
    const secondsPerBeat = 60 / this.bpm;
    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD_S) {
      const accent = this.beat === 0;
      this.click(this.nextNoteTime, accent);
      if (this.onBeat) {
        const delayMs = Math.max(0, (this.nextNoteTime - this.ctx.currentTime) * 1000);
        const fireAccent = accent;
        setTimeout(() => this.onBeat?.(fireAccent), delayMs);
      }
      this.nextNoteTime += secondsPerBeat;
      this.beat = (this.beat + 1) % this.beatsPerBar;
    }
  }

  private click(time: number, accent: boolean): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    const peak = accent ? 0.5 : 0.34;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }
}

// One shared engine for the whole app.
export const metronome = new Metronome();
