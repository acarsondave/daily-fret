// A smooth reading of a coarse clock.
//
// `YTPlayer.getCurrentTime()` is the only time source the embed gives us and it
// is not good enough to animate against: it moves in visible steps, it costs a
// cross-document call, and reading it every frame produces a chart that judders
// while the video beside it plays perfectly smoothly. The judder is worse than
// being slightly wrong, because judder is what "this app is broken" looks like.
//
// So the player is polled a few times a second and the frames in between are
// filled in from `performance.now()` scaled by the playback rate. Two rules keep
// that projection honest:
//
//   1. A small disagreement with the player is corrected by bending the clock,
//      never by jumping it. The correction is capped at a quarter of the current
//      rate, so the chart still always moves forwards, just briefly a little
//      slower or faster until it agrees again.
//   2. A large disagreement is a seek, an ad, or a stall, and there is nothing
//      to bend towards. Those snap.
//
// Nothing here knows about React or about YouTube. It takes numbers and a wall
// clock, which is what makes it testable without a video.

/** Beyond this much disagreement the projection is not wrong, it is stale. */
export const SNAP_SECONDS = 0.35;

/**
 * The most the clock may be sped up or slowed down to close a gap, as a
 * fraction of the playback rate. A quarter converges a full snap-sized error in
 * about one and a half seconds at normal speed and can never run the chart
 * backwards, which a fixed correction speed could at 0.25x playback.
 */
export const MAX_CORRECTION_FRACTION = 0.25;

export interface MediaClockSample {
  /** What the player says the time is, in seconds. */
  mediaSeconds: number;
  /** The wall clock when that reading was taken, in milliseconds. */
  wallMs: number;
  /** Whether the recording is actually advancing. Buffering and ads are not. */
  playing: boolean;
  /** The player's playback rate. 1 is normal speed. */
  rate: number;
}

export interface MediaClockRead {
  seconds: number;
  playing: boolean;
  rate: number;
  /** True when the last sample had to snap: a seek, a stall, or the first read. */
  snapped: boolean;
}

export class MediaClock {
  private baseSeconds = 0;
  private baseWallMs = 0;
  private offsetSeconds = 0;
  private offsetWallMs = 0;
  private started = false;
  private lastSnapped = true;
  private state: { playing: boolean; rate: number } = { playing: false, rate: 1 };

  /** Feed the clock a reading from the player. Safe to call as often as you like. */
  sample({ mediaSeconds, wallMs, playing, rate }: MediaClockSample): void {
    const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    const changedGear = playing !== this.state.playing || safeRate !== this.state.rate;
    const projected = this.started ? this.read(wallMs).seconds : mediaSeconds;
    const error = mediaSeconds - projected;

    this.state = { playing, rate: safeRate };
    this.baseSeconds = mediaSeconds;
    this.baseWallMs = wallMs;
    this.offsetWallMs = wallMs;

    // Pausing, resuming, changing speed and seeking all invalidate the
    // projection outright; there is no continuity worth preserving across them.
    const snap = !this.started || changedGear || !playing || Math.abs(error) > SNAP_SECONDS;
    this.offsetSeconds = snap ? 0 : -error;
    this.lastSnapped = snap;
    this.started = true;
  }

  /** The time now, interpolated. Cheap enough to call on every animation frame. */
  read(wallMs: number): MediaClockRead {
    const { playing, rate } = this.state;
    const elapsed = playing ? Math.max(0, (wallMs - this.baseWallMs) / 1000) : 0;
    const raw = this.baseSeconds + elapsed * rate;
    return {
      seconds: raw + this.decayedOffset(wallMs),
      playing,
      rate,
      snapped: this.lastSnapped,
    };
  }

  /** True once the player has reported anything at all. */
  get ready(): boolean {
    return this.started;
  }

  // The residual disagreement, shrinking at a bounded speed so the visible
  // clock stays monotonic while it converges.
  private decayedOffset(wallMs: number): number {
    if (this.offsetSeconds === 0) return 0;
    const age = Math.max(0, (wallMs - this.offsetWallMs) / 1000);
    const closed = age * this.state.rate * MAX_CORRECTION_FRACTION;
    const remaining = Math.abs(this.offsetSeconds) - closed;
    if (remaining <= 0) return 0;
    return Math.sign(this.offsetSeconds) * remaining;
  }
}

/**
 * What the chart reads from, once per frame.
 *
 * An interface rather than the player itself so the chart can be driven by a
 * clock a test controls. The real one wraps `MediaClock`; nothing else about
 * the chart changes.
 */
export interface TimeSource {
  read(): MediaClockRead;
}
