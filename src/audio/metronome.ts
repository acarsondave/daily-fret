// The practice click. Three things have to be true of it, and they pull against
// each other:
//
//  1. It has to be heard over a strummed acoustic guitar in an ordinary room,
//     from a laptop or phone speaker, without becoming unpleasant across a
//     twenty-minute session. That rules out a sine beep: a tone sits inside the
//     guitar's own harmonic series and is masked by it. A real metronome click
//     is a broadband transient with a sub-millisecond attack and a decay
//     measured in tens of milliseconds, centred where the ear is most sensitive
//     and the guitar is least dense (roughly 2 to 4 kHz).
//  2. It has to land on time regardless of what the main thread is doing. The
//     pitch detector runs on the same page. So the audio is scheduled ahead on
//     the AudioContext clock (the classic lookahead scheduler) and nothing
//     audible depends on a timer firing punctually.
//  3. The visual beat has to agree with the audible one. A pulse that drifts
//     from the click is worse than no pulse, so the UI is driven from the audio
//     clock on an animation frame, not from a per-beat setTimeout.
//
// It plays through the app's shared output context (src/audio/outputContext.ts),
// kept separate from the mic graph so the click never contends with capture. A
// single shared instance backs the whole app, so toggling from any drill
// controls one click, never two overlapping ones.

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
const MIN_AHEAD_S = 0.12; // the queue depth when the page is running normally
const MAX_AHEAD_S = 2.5; // the queue depth when the page is being throttled
const WAKE_HEADROOM = 3; // queue this many scheduler wakes ahead of the clock
const DEFAULT_BEATS_PER_BAR = 4;
const START_OFFSET_S = 0.08; // breathing room between "go" and the first click
const SILENT_GRACE_MS = 700; // how long a start may take before we call it muted
// A bar of four, whatever the cycle is. Musicians count in fours.
export const COUNT_IN_BEATS = 4;
// A visual beat older than this arrived while the page was not rendering. Only
// the last one still means anything; the rest would flash past in one frame.
const STALE_VISUAL_S = 0.25;

export const MIN_BPM = 40;
export const MAX_BPM = 240;

const clampBpm = (bpm: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));

// What a beat is worth. The downbeat is where the chord changes, so it gets its
// own voice rather than a louder copy of the same one. `midbar` exists because
// the tempo model hands this thing an eight-beat change cycle for slower
// players (src/lib/tempo.ts), and eight undifferentiated clicks is not a bar you
// can sit a strumming pattern inside: it needs a halfway mark.
export type BeatAccent = 'downbeat' | 'midbar' | 'beat' | 'countin';

export interface BeatEvent {
  // Position in the cycle, 0-based. Negative during the count-in, so -4 is the
  // first of four and -1 is the last before the drill's own beat one.
  position: number;
  // Position within the cycle, 0-based, for anything already counting.
  beat: number;
  beatsPerBar: number;
  accent: BeatAccent;
  // Seconds per beat at the moment this beat sounded, so the UI can pace a
  // pendulum against the real tempo instead of a fixed loop.
  secondsPerBeat: number;
}

// ---------------------------------------------------------------------------
// Click synthesis
// ---------------------------------------------------------------------------

export interface ClickVoice {
  // Exponentially damped partials. Deliberately inharmonic on the downbeat:
  // that is what makes a struck bell a bell rather than a note.
  partials: { freq: number; amp: number; decay: number }[];
  noiseAmp: number;
  noiseDecay: number;
  lengthS: number;
  peak: number;
}

// One family, three strikes. Every voice carries the same 3140 Hz partial, so
// they read as one instrument hit in different places rather than three
// unrelated beeps. The downbeat adds the octave below and two inharmonic upper
// partials with a long decay, which is a bell; the plain beat is the same strike
// with the ring damped, which is a stick.
export const VOICES: Record<BeatAccent, ClickVoice> = {
  downbeat: {
    partials: [
      { freq: 1570, amp: 0.7, decay: 0.03 },
      { freq: 3140, amp: 1, decay: 0.018 },
      { freq: 4712, amp: 0.45, decay: 0.009 },
      { freq: 6280, amp: 0.22, decay: 0.004 },
    ],
    noiseAmp: 0.55,
    noiseDecay: 0.0018,
    lengthS: 0.07,
    peak: 0.82,
  },
  midbar: {
    partials: [
      { freq: 2350, amp: 1, decay: 0.006 },
      { freq: 3550, amp: 0.35, decay: 0.0028 },
    ],
    noiseAmp: 0.6,
    noiseDecay: 0.0016,
    lengthS: 0.038,
    peak: 0.62,
  },
  beat: {
    partials: [
      { freq: 3140, amp: 1, decay: 0.0045 },
      { freq: 4740, amp: 0.4, decay: 0.0022 },
    ],
    noiseAmp: 0.7,
    noiseDecay: 0.0016,
    lengthS: 0.03,
    peak: 0.55,
  },
  // Quieter and duller than anything in the drill, so a count-in is audibly
  // "not yet" rather than four beats you might mistake for the first bar.
  countin: {
    partials: [{ freq: 2350, amp: 1, decay: 0.004 }],
    noiseAmp: 0.35,
    noiseDecay: 0.0014,
    lengthS: 0.026,
    peak: 0.32,
  },
};

const TAPER_S = 0.003; // fade the tail to zero; a truncated decay is its own click
// Raised-cosine fade-in on the leading edge.
//
// A click that starts on a discontinuity is, by definition, broadband: the step
// spreads energy across the whole spectrum including the two hundred to eight
// hundred hertz where a strummed guitar lives. That did not matter while nothing
// listened to the click, and it matters a great deal now that the strum timing
// drill has to tell the two apart in the microphone. Measured on the shipping
// voices, one millisecond of ramp costs between three and thirteen per cent of
// the click's own 2 to 7 kHz body and takes its bleed into the guitar's band
// down by six to thirty times, depending on the voice. It is still an attack: a
// millisecond is a fraction of the shortest rise the ear resolves as one, and
// the click is unchanged to listen to.
const ATTACK_S = 0.001;

// Renders one click to a mono sample buffer. Rendering once and replaying the
// buffer beats synthesising per beat on two counts: the whole waveform is
// available to shape (a differentiated noise transient cannot be built out of
// oscillator nodes), and a beat costs one node instead of two nodes plus three
// scheduled parameter events, which keeps the main thread free for the pitch
// detector running beside it.
export function renderClick(
  voice: ClickVoice,
  sampleRate: number,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> {
  const n = Math.max(1, Math.ceil(voice.lengthS * sampleRate));
  const out = new Float32Array(n);

  // First difference of white noise rather than the noise itself: a +6 dB/octave
  // tilt that turns a hiss into the bright snap of an escapement.
  let previousNoise = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (const p of voice.partials) {
      v += p.amp * Math.exp(-t / p.decay) * Math.sin(2 * Math.PI * p.freq * t);
    }
    const white = random() * 2 - 1;
    v += voice.noiseAmp * (white - previousNoise) * Math.exp(-t / voice.noiseDecay);
    previousNoise = white;
    out[i] = v;
  }

  const attack = Math.min(n, Math.max(2, Math.round(ATTACK_S * sampleRate)));
  for (let i = 0; i < attack; i++) {
    out[i] *= 0.5 * (1 - Math.cos((Math.PI * i) / (attack - 1)));
  }

  // Raised cosine down to exactly zero on the final sample. A decay simply cut
  // off where the buffer ends is a step, and a step is another click.
  const taper = Math.min(n, Math.max(2, Math.round(TAPER_S * sampleRate)));
  for (let i = 0; i < taper && taper > 1; i++) {
    out[n - taper + i] *= 0.5 * (1 + Math.cos((Math.PI * i) / (taper - 1)));
  }

  let loudest = 0;
  for (let i = 0; i < n; i++) loudest = Math.max(loudest, Math.abs(out[i]));
  if (loudest > 0) {
    const scale = voice.peak / loudest;
    for (let i = 0; i < n; i++) out[i] *= scale;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export interface PlannedBeat {
  time: number;
  position: number;
}

export interface BeatPlan {
  beats: PlannedBeat[];
  nextTime: number;
  nextPosition: number;
  // Beats the scheduler arrived too late to place. They are dropped rather than
  // fired, and reported so the caller can discard their visuals too.
  skipped: number;
}

// The whole scheduler, as arithmetic: given where the grid is, what time it is,
// and how far ahead to fill, return the beats to queue.
//
// The catch-up branch is the one that matters. A backgrounded tab has its timers
// clamped to a second or more, so the scheduler can wake to find the grid well
// behind the clock. Queuing those beats anyway starts every one of them
// immediately, which is a burst of machine-gun clicks the moment you switch back
// to the tab. Instead the grid jumps forward a whole number of beats, so the
// count skips cleanly and beat one still falls where it would have.
export function planBeats(
  nextTime: number,
  now: number,
  aheadS: number,
  secondsPerBeat: number,
  position: number,
): BeatPlan {
  let time = nextTime;
  let pos = position;
  let skipped = 0;
  if (time < now) {
    skipped = Math.ceil((now - time) / secondsPerBeat);
    time += skipped * secondsPerBeat;
    pos += skipped;
  }
  const beats: PlannedBeat[] = [];
  const horizon = now + aheadS;
  while (time < horizon) {
    beats.push({ time, position: pos });
    // Stepping from the grid origin rather than accumulating keeps a long
    // session on the same grid it started on.
    pos += 1;
    time = nextTime + (pos - position) * secondsPerBeat;
  }
  return { beats, nextTime: time, nextPosition: pos, skipped };
}

/**
 * The phase, as arithmetic, so it can be checked without an audio context.
 *
 * `nextHeard` and `position` describe the next click the scheduler has not
 * placed yet, which is the pair the scheduler itself carries. Counting back from
 * there is what finds the most recent click that has actually been heard.
 */
export function phaseAt(
  nextHeard: number,
  now: number,
  secondsPerBeat: number,
  position: number,
  beatsPerBar: number,
): ClickPhase | null {
  if (!(secondsPerBeat > 0)) return null;
  const back = Math.ceil((nextHeard - now) / secondsPerBeat);
  // A whole beat past the next click the scheduler has placed means it has not
  // woken since before that click was due, which is what a backgrounded tab
  // does. `planBeats` will skip the count forward when it next wakes, so the
  // beats in between are ones nobody will ever hear and there is no phase to
  // report. A stale count is not a late one.
  if (back < 0) return null;
  const sinceSeconds = now - (nextHeard - back * secondsPerBeat);
  if (!Number.isFinite(sinceSeconds) || sinceSeconds < 0 || sinceSeconds >= secondsPerBeat) {
    return null;
  }
  return { position: position - back, sinceSeconds, secondsPerBeat, beatsPerBar };
}

// Which voice a beat gets. A cycle that divides into bars of four gets a mark
// halfway so the bar has a shape; anything else is downbeat and beats.
export function accentFor(position: number, beatsPerBar: number): BeatAccent {
  if (position < 0) return 'countin';
  const beat = position % beatsPerBar;
  if (beat === 0) return 'downbeat';
  if (beatsPerBar > 4 && beatsPerBar % 4 === 0 && beat % 4 === 0) return 'midbar';
  return 'beat';
}

/** Where the audible click is in its bar, as of the moment it was asked. */
export interface ClickPhase {
  /**
   * Bar-relative count of the most recent click to reach the ear. Beat one of a
   * bar is a multiple of `beatsPerBar`; a count-in is negative.
   */
  position: number;
  /** Seconds since that click. Always at least zero and under one beat. */
  sinceSeconds: number;
  secondsPerBeat: number;
  beatsPerBar: number;
}

interface QueuedSource {
  node: AudioBufferSourceNode;
  endsAt: number;
}

export class Metronome {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame: number | null = null;
  private nextNoteTime = 0;
  private position = 0;
  private bpm = 90;
  private beatsPerBar = DEFAULT_BEATS_PER_BAR;
  private running = false;
  private buffers: Map<BeatAccent, AudioBuffer> | null = null;
  private buffersFor: BaseAudioContext | null = null;
  private queued: QueuedSource[] = [];
  private visuals: { time: number; event: BeatEvent }[] = [];
  private lastWakeAt = 0;
  private wakeGapS = 0;

  // Fired on the main thread at each audible click, paced by the audio clock.
  onBeat: ((event: BeatEvent) => void) | null = null;
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
        //
        // Going quiet includes the clicks already handed to the audio thread. A
        // suspended context does not throw those away, it holds them: its clock
        // stops, and every one of them sounds the instant the route comes back,
        // on a grid `rebase` has by then moved off. Stopping the metronome has
        // always silenced the queue for exactly this reason; being interrupted
        // did not, and a camera taking the audio for a second is the common way
        // in.
        this.stopTimer();
        this.silenceQueued();
        requestOutputAudio();
      }
      this.emitAudible();
    });
  }

  /** Everything already on the audio thread, taken back. */
  private silenceQueued(): void {
    for (const q of this.queued) q.node.stop();
    this.queued.length = 0;
  }

  private rebase(): void {
    const ctx = getOutputContext();
    if (ctx) this.nextNoteTime = ctx.currentTime + START_OFFSET_S;
    this.visuals.length = 0;
  }

  private startTimer(): void {
    if (this.timer) return;
    this.lastWakeAt = 0;
    this.wakeGapS = 0;
    this.timer = setInterval(() => this.schedule(), LOOKAHEAD_MS);
    this.startFrames();
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopFrames();
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

  getBeatsPerBar(): number {
    return this.beatsPerBar;
  }

  /**
   * Where the click is in its bar right now.
   *
   * `onBeat` fires once per click and is already taken by the metronome panel,
   * and one callback cannot carry a marker that has to move between clicks
   * anyway. A drill drawing a continuous eighth-note pendulum needs the phase on
   * every animation frame, so it asks for it.
   *
   * Reported against the ear, not the scheduler: the output latency is taken off
   * the same way `drainVisuals` takes it off, so a marker driven from this sits
   * where the player hears the click rather than where the audio thread queued
   * it. Nothing here mutates the count, so asking is free and asking often is
   * safe.
   *
   * Null whenever there is no click to be in phase with, which the caller has to
   * handle: a marker that keeps sweeping over a stopped metronome is the app
   * claiming a beat nobody can hear.
   */
  phase(): ClickPhase | null {
    const ctx = getOutputContext();
    if (!this.running || !ctx || ctx.state !== 'running') return null;
    // `nextNoteTime` is when the next click is queued to start; it reaches the
    // ear an output latency later, and so did every beat before it.
    return phaseAt(
      this.nextNoteTime - this.outputDelay(ctx),
      ctx.currentTime,
      60 / this.bpm,
      this.position,
      this.beatsPerBar,
    );
  }

  // How many beats the accent cycle spans. Drills set this to the beats between
  // chord changes, so the accented click always lands on "change now" rather
  // than on an abstract beat one the player has to count against.
  setBeatsPerBar(beats: number): void {
    const next = Math.max(1, Math.round(beats));
    if (next === this.beatsPerBar) return;
    this.beatsPerBar = next;
    // Restart the cycle so the next accent is a full bar away, never a stray
    // one landing mid-figure because the old count was further along. A count-in
    // in progress keeps its own place.
    if (this.position >= 0) this.position = 0;
  }

  private emitAudible(): void {
    this.onAudibleChange?.(this.isAudible);
  }

  start(bpm?: number, options?: { countIn?: boolean }): void {
    if (bpm != null) this.setBpm(bpm);
    if (this.running) return;
    const ctx = getOutputContext();
    if (!ctx) return;
    this.running = true;
    this.position = options?.countIn ? -COUNT_IN_BEATS : 0;
    this.nextNoteTime = ctx.currentTime + START_OFFSET_S;
    this.visuals.length = 0;

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
    // Up to MAX_AHEAD_S of clicks can be queued when the page has been
    // throttled. Silence them, or stopping a backgrounded metronome keeps
    // clicking for two more seconds.
    this.silenceQueued();
    this.visuals.length = 0;
    if (!this.running) return;
    this.running = false;
    this.emitAudible();
  }

  // Free audio from inside a user gesture, then restart the count from here.
  // The click is the one control the player can use to fix a silent context.
  unlockAndStart(bpm?: number, options?: { countIn?: boolean }): void {
    unlockOutputAudio();
    this.stop();
    this.start(bpm, options);
  }

  // How deep to keep the audio queue. Foreground, it is the MIN_AHEAD_S floor,
  // which keeps a tempo change audible almost immediately. When the page is
  // hidden or the thread is stalling, the scheduler's own wake period is the
  // honest measure of how long it may be until the next chance to queue
  // anything, so the window tracks it. This is measured rather than driven off
  // visibilitychange alone, because throttling policy differs per browser and
  // Safari suspends on its own schedule.
  private aheadSeconds(): number {
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (hidden) return MAX_AHEAD_S;
    return Math.min(MAX_AHEAD_S, Math.max(MIN_AHEAD_S, this.wakeGapS * WAKE_HEADROOM));
  }

  private trackWake(now: number): void {
    if (this.lastWakeAt > 0) {
      const gap = now - this.lastWakeAt;
      // Grow immediately, shrink gently: one stalled wake must widen the window
      // at once, but a single fast wake must not narrow it back under a beat
      // that is still queued.
      this.wakeGapS = gap > this.wakeGapS ? gap : this.wakeGapS * 0.8 + gap * 0.2;
    }
    this.lastWakeAt = now;
  }

  private clickBuffers(ctx: AudioContext): Map<BeatAccent, AudioBuffer> {
    if (this.buffers && this.buffersFor === ctx) return this.buffers;
    const built = new Map<BeatAccent, AudioBuffer>();
    for (const accent of Object.keys(VOICES) as BeatAccent[]) {
      const samples = renderClick(VOICES[accent], ctx.sampleRate);
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      built.set(accent, buffer);
    }
    this.buffers = built;
    this.buffersFor = ctx;
    return built;
  }

  private schedule(): void {
    const ctx = getOutputContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.trackWake(now);
    if (ctx.state !== 'running') {
      // Nothing can sound right now. Hold the next click just ahead of the clock
      // so a resume doesn't dump a backlog of stale beats in one burst.
      this.nextNoteTime = now + START_OFFSET_S;
      return;
    }

    // Drop finished nodes. Cheaper than an onended handler per beat, which is
    // main-thread work the pitch detector would have to queue behind.
    if (this.queued.length) this.queued = this.queued.filter((q) => q.endsAt > now);

    const secondsPerBeat = 60 / this.bpm;
    const plan = planBeats(this.nextNoteTime, now, this.aheadSeconds(), secondsPerBeat, this.position);
    if (plan.skipped > 0) this.visuals.length = 0;

    const buffers = this.clickBuffers(ctx);
    for (const beat of plan.beats) {
      const accent = accentFor(beat.position, this.beatsPerBar);
      const buffer = buffers.get(accent);
      if (!buffer) throw new Error(`metronome: no click rendered for "${accent}"`);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.start(beat.time);
      this.queued.push({ node, endsAt: beat.time + buffer.duration });
      this.visuals.push({
        time: beat.time,
        event: {
          position: beat.position,
          beat: beat.position < 0 ? beat.position + COUNT_IN_BEATS : beat.position % this.beatsPerBar,
          beatsPerBar: this.beatsPerBar,
          accent,
          secondsPerBeat,
        },
      });
    }
    this.nextNoteTime = plan.nextTime;
    this.position = plan.nextPosition;
    // Animation frames are the first thing a saturated main thread drops, and
    // the pitch detector can saturate it. Draining here too puts a 25 ms ceiling
    // on how late a pulse can be, whatever the compositor is doing.
    this.drainVisuals(ctx);
  }

  // Sound scheduled for time T reaches the speaker at T plus the output
  // latency, so that is when the pulse belongs. Firefox and Chromium report
  // outputLatency; WebKit reports only baseLatency, which is the smaller
  // render-quantum part of the same delay and is the best figure it has.
  private outputDelay(ctx: AudioContext): number {
    return typeof ctx.outputLatency === 'number' ? ctx.outputLatency : ctx.baseLatency;
  }

  private startFrames(): void {
    if (this.frame !== null || typeof requestAnimationFrame !== 'function') return;
    this.frame = requestAnimationFrame(this.pump);
  }

  private stopFrames(): void {
    if (this.frame === null) return;
    cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  // The visual beat, paced off the audio clock rather than off a per-beat timer.
  // Every check re-reads the clock, so lateness can never accumulate the way a
  // chain of setTimeouts does, and a beat that came due while the page was not
  // rendering is dropped instead of replayed.
  private drainVisuals(ctx: AudioContext): void {
    const due = ctx.currentTime - this.outputDelay(ctx);
    let latest: BeatEvent | null = null;
    while (this.visuals.length > 0 && this.visuals[0].time <= due) {
      const entry = this.visuals.shift();
      if (!entry) break;
      // Frames stop while the page is hidden, so several beats can come due at
      // once on return. Only the one that is current still means anything.
      if (due - entry.time <= STALE_VISUAL_S) latest = entry.event;
    }
    if (latest) this.onBeat?.(latest);
  }

  private pump = (): void => {
    this.frame = null;
    const ctx = getOutputContext();
    if (!ctx || !this.running) return;
    this.drainVisuals(ctx);
    this.frame = requestAnimationFrame(this.pump);
  };
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
