// The clock the chart runs on when there is no recording to follow.
//
// MediaClock exists because YouTube's clock is coarse, remote and occasionally
// lying: it is polled four times a second and the frames between are projected,
// corrected and sometimes snapped. None of that applies here. This clock is not
// tracking anything, it *is* the truth, so there is no smoothing, no drift
// correction and no error to converge.
//
// It reads the audio context's own clock by preference, because that is the
// clock the backing is scheduled against. Driving the picture from
// `performance.now()` while the sound is queued on `ctx.currentTime` is how a
// chart and a chord end up half a beat apart on a stalling main thread.
//
// A suspended context is the case that had to be designed for rather than
// discovered. Opening a camera hands the output route away and the context
// stops advancing, sometimes with no event at all. Because the position is
// derived from that clock and never from the wall, the chart holds where it was
// and picks up from there when the sound comes back. It cannot lurch forward
// through the silence, which is what a wall clock would have made it do.

import { getOutputContext } from '../audio/outputContext';
import type { MediaClockRead, TimeSource } from './mediaClock';

/**
 * Where the seconds come from.
 *
 * `running` is not "is the song playing". It is whether this source is still
 * advancing at all, which is what a suspended audio context stops doing.
 */
export interface ClockSource {
  now(): number;
  running(): boolean;
}

/**
 * The audio clock if there is one, the wall clock if there is not.
 *
 * Chosen once and kept. Swapping sources mid-song would rebase the chart
 * against a different origin, which is a jump, and the reason to prefer the
 * audio clock is precisely that it does not jump.
 */
export function defaultClockSource(): ClockSource {
  const ctx = getOutputContext();
  if (!ctx) {
    return { now: () => performance.now() / 1000, running: () => true };
  }
  return { now: () => ctx.currentTime, running: () => ctx.state === 'running' };
}

export class SongClock implements TimeSource {
  private source: ClockSource;
  /** Chart seconds at the anchor. */
  private baseSeconds = 0;
  /** Source seconds at the anchor. */
  private baseNow = 0;
  private rate = 1;
  private playing = false;
  private snapPending = true;
  private version = 0;

  constructor(source: ClockSource = defaultClockSource()) {
    this.source = source;
    this.baseNow = source.now();
  }

  /**
   * Begin at a position, playing.
   *
   * A count-in is a negative `fromSeconds`: the chart's own count-in draws
   * itself from the timeline for any time before the first downbeat, so there
   * is nothing to add to the chart and nothing to add to the timeline.
   */
  start(fromSeconds: number): void {
    this.baseSeconds = fromSeconds;
    this.baseNow = this.source.now();
    this.playing = true;
    this.snapPending = true;
    this.version += 1;
  }

  pause(): void {
    if (!this.playing) return;
    this.baseSeconds = this.positionAt(this.source.now());
    this.baseNow = this.source.now();
    this.playing = false;
    this.version += 1;
  }

  resume(): void {
    if (this.playing) return;
    this.baseNow = this.source.now();
    this.playing = true;
    this.version += 1;
  }

  /** Jump. The next read reports `snapped`, which is what re-arms a count-in. */
  seek(seconds: number): void {
    this.baseSeconds = seconds;
    this.baseNow = this.source.now();
    this.snapPending = true;
    this.version += 1;
  }

  /**
   * Change pace without losing the place.
   *
   * Rebased at the instant of the change rather than by rebuilding the timeline,
   * so the bar under the playhead stays the bar under the playhead. A control
   * that moved the player somewhere else in the song when they pressed it would
   * be unusable.
   */
  setRate(rate: number): void {
    // A rate that is not a positive number is refused outright rather than
    // coerced to one. Silently snapping a bad value back to full speed would
    // make a control that had done nothing look like a control that had done
    // something, on the one screen whose whole job is to be slower than the
    // record.
    if (!(Number.isFinite(rate) && rate > 0)) return;
    const next = rate;
    if (next === this.rate) return;
    const now = this.source.now();
    this.baseSeconds = this.positionAt(now);
    this.baseNow = now;
    this.rate = next;
    this.version += 1;
  }

  /**
   * How many times the mapping from chart time to clock time has been redrawn.
   *
   * Anything that has queued sound ahead of the clock has queued it against one
   * of these mappings, and every start, pause, resume, seek and pace change
   * replaces it. A scheduler that did not notice would leave a bar of the old
   * tempo sounding under the new one.
   */
  get epoch(): number {
    return this.version;
  }

  /**
   * When a chart position falls on the source clock. The inverse of `read`.
   *
   * Only meaningful while playing, and only for as long as the epoch stands.
   */
  sourceTimeAt(chartSeconds: number): number {
    return this.baseNow + (chartSeconds - this.baseSeconds) / this.rate;
  }

  getRate(): number {
    return this.rate;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  read(): MediaClockRead {
    const seconds = this.positionAt(this.source.now());
    const snapped = this.snapPending;
    this.snapPending = false;
    return {
      seconds,
      // Advancing, not merely asked to advance. A held context is a chart that
      // has stopped moving, and the playhead's pulse must say so rather than
      // beating over silence.
      playing: this.playing && this.source.running(),
      rate: this.rate,
      snapped,
    };
  }

  /** The position without consuming the snap flag, for callers that only look. */
  peek(): number {
    return this.positionAt(this.source.now());
  }

  private positionAt(now: number): number {
    if (!this.playing) return this.baseSeconds;
    // Clamped at zero so a source that reports a moment in the past (a fake one
    // in a test, a clock reset in the wild) can never run the chart backwards.
    return this.baseSeconds + Math.max(0, now - this.baseNow) * this.rate;
  }
}
