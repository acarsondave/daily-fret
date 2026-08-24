// The sound of chart mode: the chords, in time, plus the click.
//
// A sibling of Metronome rather than an extension of it. The global metronome
// carries the routine's own BPM and beats-per-bar and is owned by the drills; a
// song borrowing it and handing it back is a state fight waiting to happen. Two
// schedulers queueing buffer sources on one context is unremarkable, and this
// one is the simpler of the two because its whole grid is known in advance.
//
// It uses the shared output context and only ever the shared one, and brackets
// audibility honestly: it asks for audio when a song starts playing and releases
// it when the song stops. Not on mount, and not on the intro screen.

import { getOutputContext, releaseOutputAudio, requestOutputAudio } from './outputContext';
import { COUNT_IN_BEATS, VOICES, renderClick, type BeatAccent } from './metronome';
import { renderStrum, type StrumDir } from './songVoice';
import { getChordShape } from '../data/chordShapes';
import { parseStrum } from '../data/songs';
import type { SongClock } from '../lib/songClock';
import { secondsPerBeat, type SongTimeline, type TimedBar } from '../lib/songTiming';

const LOOKAHEAD_MS = 25;
const MIN_AHEAD_S = 0.12;
const MAX_AHEAD_S = 2.5;
const WAKE_HEADROOM = 3;

export type BackingEvent =
  | { at: number; kind: 'chord'; chord: string; dir: StrumDir }
  | { at: number; kind: 'click'; accent: BeatAccent };

/**
 * The strokes one bar sounds, in chart seconds.
 *
 * A bar's `strum` is arrow art for a chart cell, not a slot grid: the catalogue
 * comment says so and `songStrum.ts` refuses to hand most of them to the pattern
 * matcher for exactly that reason. "DD" is two downs held across a bar and lays
 * onto the beats cleanly; "DDUUDU" is six arrows in a bar of four and does not
 * lay onto anything. Spreading six strokes evenly over four beats would be a
 * sextuplet, which is not how any of these songs go, and a backing playing a
 * rhythm the record does not have is worse than a backing playing none.
 *
 * So: where the arrows divide the bar into whole beats or whole slots per beat,
 * every arrow sounds where it is drawn. Where they do not, the bar sounds once
 * on its downbeat, which is where its first arrow is drawn anyway, and the click
 * carries the beat. Nothing is ever sounded where no arrow is drawn.
 */
export function barStrokes(bar: TimedBar): { at: number; dir: StrumDir }[] {
  const slots = parseStrum(bar.strum);
  const span = bar.endSeconds - bar.startSeconds;
  if (!slots.length || span <= 0) return [];

  const divides = slots.length % bar.beats === 0 || bar.beats % slots.length === 0;
  if (!divides) {
    const first = slots.find((dir) => dir !== '-');
    return first ? [{ at: bar.startSeconds, dir: first as StrumDir }] : [];
  }

  const step = span / slots.length;
  const out: { at: number; dir: StrumDir }[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === '-') continue;
    out.push({ at: bar.startSeconds + i * step, dir: slots[i] as StrumDir });
  }
  return out;
}

/**
 * Everything the song will sound, in order, in chart seconds.
 *
 * Built once for a whole song rather than a bar at a time. The clicks are all in
 * here whether or not the click is currently on, because the toggle is a
 * decision about what to schedule and not about what the song contains: turning
 * the click on mid-song must not require the plan to be rebuilt underneath a
 * queue that has already been filled from it.
 *
 * The count-in is negative time. The chart's own count-in draws itself for any
 * moment before the first downbeat, so there is nothing to add to the chart and
 * nothing to add to the timeline.
 */
export function buildBackingPlan(timeline: SongTimeline, countInBeats = COUNT_IN_BEATS): BackingEvent[] {
  const events: BackingEvent[] = [];
  const first = timeline.bars[0];
  if (!first) return events;

  const leadIn = secondsPerBeat(first);
  for (let k = countInBeats; k > 0; k--) {
    events.push({ at: first.startSeconds - k * leadIn, kind: 'click', accent: 'countin' });
  }

  for (const bar of timeline.bars) {
    const beat = secondsPerBeat(bar);
    for (let b = 0; b < bar.beats; b++) {
      events.push({
        at: bar.startSeconds + b * beat,
        kind: 'click',
        accent: b === 0 ? 'downbeat' : 'beat',
      });
    }
    for (const stroke of barStrokes(bar)) {
      events.push({ at: stroke.at, kind: 'chord', chord: bar.chord, dir: stroke.dir });
    }
  }

  // A chord and the click on the same downbeat must both be queued, so the sort
  // has to be stable about the tie rather than dropping one of them.
  events.sort((a, b) => a.at - b.at);
  return events;
}

/** The first event at or after a chart position. Binary search: songs are long. */
export function cursorAt(events: BackingEvent[], seconds: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (events[mid].at < seconds) low = mid + 1;
    else high = mid;
  }
  return low;
}

// --- The context, as little of it as this needs ----------------------------
//
// Typed structurally rather than as an AudioContext so the scheduler can be
// driven by a fake that records what was queued and when. A real AudioContext
// satisfies all of it.

export interface BackingBuffer {
  duration: number;
  copyToChannel(source: Float32Array, channel: number): void;
}

export interface BackingNode {
  buffer: BackingBuffer | null;
  connect(destination: unknown): unknown;
  start(when: number): void;
  stop(when?: number): void;
}

export interface BackingCtx {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): BackingBuffer;
  createBufferSource(): BackingNode;
}

interface Queued {
  node: BackingNode;
  endsAt: number;
}

export interface BackingOptions {
  /** Where the clamp is, so the backing sounds at the pitch the chart asks for. */
  capo?: number;
  /** Whether the click sounds outside the count-in. It always sounds inside it. */
  click?: boolean;
  contextOf?: () => BackingCtx | null;
}

export class SongBacking {
  private clock: SongClock;
  private events: BackingEvent[] = [];
  private cursor = 0;
  private epoch = -1;
  private queued: Queued[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private capo = 0;
  private click = false;
  private contextOf: () => BackingCtx | null;
  private chords = new Map<string, BackingBuffer>();
  private clicks = new Map<BeatAccent, BackingBuffer>();
  private buffersFor: BackingCtx | null = null;
  private lastWakeAt = 0;
  private wakeGapS = 0;

  constructor(clock: SongClock, options: BackingOptions = {}) {
    this.clock = clock;
    this.capo = options.capo ?? 0;
    this.click = options.click ?? false;
    this.contextOf = options.contextOf ?? (() => getOutputContext());
  }

  setPlan(events: BackingEvent[]): void {
    this.events = events;
    // The plan changed under a queue filled from the old one.
    this.silenceQueued();
    this.epoch = -1;
  }

  setCapo(capo: number): void {
    if (capo === this.capo) return;
    this.capo = capo;
    this.chords.clear();
  }

  setClick(on: boolean): void {
    this.click = on;
  }

  get isClicking(): boolean {
    return this.click;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.epoch = -1;
    this.lastWakeAt = 0;
    this.wakeGapS = 0;
    requestOutputAudio();
    this.pump();
    if (typeof setInterval === 'function') {
      this.timer = setInterval(() => this.pump(), LOOKAHEAD_MS);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.running) return;
    this.running = false;
    // Up to MAX_AHEAD_S of chords can be on the audio thread when a throttled
    // page is stopped. A suspended context holds them rather than dropping them,
    // so leaving them queued means the song plays two more seconds after the
    // player closed it.
    this.silenceQueued();
    releaseOutputAudio();
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Everything currently handed to the audio thread, taken back. */
  private silenceQueued(): void {
    for (const q of this.queued) q.node.stop();
    this.queued.length = 0;
  }

  /**
   * Fill the queue up to the horizon. Called on a timer, and by tests directly.
   *
   * The rebase check is the part that matters. Everything already queued was
   * placed against one mapping from chart time to clock time, and a seek, a
   * pause or a pace change replaces that mapping. Without noticing, the old
   * tempo would keep sounding underneath the new one.
   */
  pump(): void {
    if (!this.running || !this.events.length) return;
    const ctx = this.contextOf();
    if (!ctx || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    this.trackWake(now);

    if (this.queued.length) this.queued = this.queued.filter((q) => q.endsAt > now);

    const read = this.clock.peek();
    if (this.clock.epoch !== this.epoch) {
      this.silenceQueued();
      this.cursor = cursorAt(this.events, read);
      this.epoch = this.clock.epoch;
    }
    if (!this.clock.isPlaying) return;

    const horizon = read + this.aheadSeconds() * this.clock.getRate();
    while (this.cursor < this.events.length && this.events[this.cursor].at <= horizon) {
      const event = this.events[this.cursor];
      this.cursor += 1;
      if (event.kind === 'click' && event.accent !== 'countin' && !this.click) continue;
      const when = this.clock.sourceTimeAt(event.at);
      // Already gone. Firing it now would be a stroke in the wrong place, which
      // is worse than a stroke nobody heard.
      if (when < now) continue;
      const buffer = event.kind === 'chord'
        ? this.chordBuffer(ctx, event.chord, event.dir)
        : this.clickBuffer(ctx, event.accent);
      if (!buffer) continue;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.start(when);
      this.queued.push({ node, endsAt: when + buffer.duration });
    }
  }

  private aheadSeconds(): number {
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (hidden) return MAX_AHEAD_S;
    return Math.min(MAX_AHEAD_S, Math.max(MIN_AHEAD_S, this.wakeGapS * WAKE_HEADROOM));
  }

  private trackWake(now: number): void {
    if (this.lastWakeAt > 0) {
      const gap = now - this.lastWakeAt;
      this.wakeGapS = gap > this.wakeGapS ? gap : this.wakeGapS * 0.8 + gap * 0.2;
    }
    this.lastWakeAt = now;
  }

  private forContext(ctx: BackingCtx): void {
    if (this.buffersFor === ctx) return;
    this.chords.clear();
    this.clicks.clear();
    this.buffersFor = ctx;
  }

  private toBuffer(ctx: BackingCtx, samples: Float32Array): BackingBuffer {
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  // Cached per chord, direction and capo, exactly as the metronome caches its
  // click voices. A four-chord song is twelve buffers, a few milliseconds each.
  private chordBuffer(ctx: BackingCtx, chord: string, dir: StrumDir): BackingBuffer | null {
    this.forContext(ctx);
    const key = `${chord}|${dir}|${this.capo}`;
    const held = this.chords.get(key);
    if (held) return held;
    const shape = getChordShape(chord);
    // A chord with no shape is not a chord this can play. It is silent rather
    // than approximated: the chart still says what to play, and a wrong chord
    // under the player's hands is the one failure worth avoiding outright.
    if (!shape) return null;
    const built = this.toBuffer(ctx, renderStrum(shape, dir, ctx.sampleRate, this.capo));
    this.chords.set(key, built);
    return built;
  }

  private clickBuffer(ctx: BackingCtx, accent: BeatAccent): BackingBuffer {
    this.forContext(ctx);
    const held = this.clicks.get(accent);
    if (held) return held;
    const built = this.toBuffer(ctx, renderClick(VOICES[accent], ctx.sampleRate));
    this.clicks.set(accent, built);
    return built;
  }
}
