// What a run of strums and a run of clicks add up to.
//
// Pure arithmetic over two lists of times in seconds: no audio, no React, no
// store. The analysis that produces those lists lives in src/audio/timing.ts;
// keeping the judgement separable is what lets the numbers be checked against
// synthesised takes with known answers instead of against a guess.

/** A strum this far from its beat is playing in time. Stated on screen. */
export const IN_TIME_MS = 50;

/**
 * How finely a lean can honestly be read, in milliseconds either way.
 *
 * Two things set it, and the second is much the larger. The analysis itself is
 * good to about five milliseconds: measured against synthesised takes with known
 * answers, one strum's offset can be told from another's to within 3 ms on an
 * ordinary take and 11 ms on the worst one tried. What dominates is the strum. A
 * downstroke is six strings struck in succession, and the moment its sound
 * arrives lands 9 ms after the pick met the first string when the sweep is brisk
 * and 24 ms when it is slow. Nothing in the signal says which kind of sweep it
 * was, so anything inside that range is a fact about how the player strums
 * rather than about where they strummed.
 *
 * So the drill reports the number, which is a true statement about when the
 * sound arrived, and refuses to call it a lean until it is bigger than a strum's
 * own shape could explain. The same figure is the width of the band drawn around
 * the beat on screen, so the picture and the words cannot disagree about what
 * counts as centred.
 */
export const TIMING_RESOLUTION_MS = 25;

/**
 * A spread tighter than this is not a person.
 *
 * The best players alive sit ten to twenty milliseconds either side of a click.
 * A run that comes back at two or three has not measured a person at all: it has
 * measured the guitar against itself, which is what happens if a strum's own
 * brightness is loud enough to be mistaken for the click. The band split and its
 * level floor make that very hard (a click is four times the level a strum
 * leaves in the click band), but "very hard" is not "impossible", and the cost
 * of the mistake is the drill telling somebody they have perfect time. So the
 * result is refused instead, and the surface says the click could not be heard.
 */
const HUMAN_SPREAD_FLOOR_MS = 4;

/**
 * Below this the run is not a measurement.
 *
 * A percentage over four beats is arithmetic, not evidence: four lucky strums
 * would read 100% and go into the history beside a minute of real playing. The
 * span is counted from the first strum to the last, so this is also what stops a
 * player banking a perfect score by strumming twice and stopping.
 */
export const MIN_MEASURED_BEATS = 8;

/** The beat grid needs this many clicks before it is worth fitting. */
const MIN_CLICKS = 4;
/**
 * How far off the phase a click may sit and still be believed, as a fraction of
 * a beat. Real clicks are perfectly periodic; anything outside this is a bright
 * transient that leaked into the click band, and including it would drag the
 * grid the whole measurement is referred to.
 */
const INLIER_FRACTION = 0.18;
/** A fitted period this far from the metronome's own is not this metronome. */
const PERIOD_TOLERANCE = 0.06;

/**
 * Where the beats are, as the microphone heard them.
 *
 * `period` is fitted rather than taken from the BPM. The click and the capture
 * run on the same device clock in practice, but nothing guarantees it, and a
 * hundred parts per million over a minute is six milliseconds of drift against a
 * statistic that is trying to resolve tens. Fitting costs nothing and removes
 * the assumption.
 */
export interface BeatGrid {
  origin: number;
  period: number;
  /** Clicks the fit was built from, after outliers were dropped. */
  clicks: number;
}

/** Where a strum landed, and how far that is from the beat it belongs to. */
export interface BeatOffset {
  beat: number;
  offsetMs: number;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Signed distance from `t` to the nearest multiple of `period`, in (-P/2, P/2]. */
function wrapAround(t: number, period: number): number {
  const remainder = t - Math.round(t / period) * period;
  return remainder;
}

/**
 * Fit a beat grid to the clicks that were actually heard.
 *
 * Two stages, because the two failure modes are different. The phase is found
 * circularly first: every click contributes a unit vector at its position within
 * a beat, and their resultant points at the phase. That is immune to a stray
 * onset landing anywhere in particular, which a "start from the first click"
 * indexing is not. Then the inliers are fitted by least squares, which is what
 * recovers the true period.
 *
 * Returns null when the clicks do not describe this tempo at all: too few of
 * them, or a fitted period that disagrees with the metronome. A null grid is the
 * honest answer when the microphone cannot hear the click, and the drill says so
 * rather than measuring against a grid it invented.
 */
export function fitBeatGrid(clicks: readonly number[], nominalPeriod: number): BeatGrid | null {
  if (nominalPeriod <= 0 || clicks.length < MIN_CLICKS) return null;

  let x = 0;
  let y = 0;
  for (const t of clicks) {
    const angle = (2 * Math.PI * t) / nominalPeriod;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  if (x === 0 && y === 0) return null;
  const phase = (Math.atan2(y, x) / (2 * Math.PI)) * nominalPeriod;

  // One click per beat position, keeping whichever sits closest to the phase: a
  // click and a leaked transient can round to the same beat, and the fit must
  // not see both.
  const byBeat = new Map<number, number>();
  for (const t of clicks) {
    if (Math.abs(wrapAround(t - phase, nominalPeriod)) > nominalPeriod * INLIER_FRACTION) continue;
    const beat = Math.round((t - phase) / nominalPeriod);
    const held = byBeat.get(beat);
    if (held === undefined || Math.abs(t - (phase + beat * nominalPeriod)) < Math.abs(held - (phase + beat * nominalPeriod))) {
      byBeat.set(beat, t);
    }
  }
  if (byBeat.size < MIN_CLICKS) return null;

  let n = 0;
  let sumBeat = 0;
  let sumBeatSquared = 0;
  let sumTime = 0;
  let sumBeatTime = 0;
  for (const [beat, t] of byBeat) {
    n += 1;
    sumBeat += beat;
    sumBeatSquared += beat * beat;
    sumTime += t;
    sumBeatTime += beat * t;
  }
  const denominator = n * sumBeatSquared - sumBeat * sumBeat;
  if (denominator === 0) return null;
  const period = (n * sumBeatTime - sumBeat * sumTime) / denominator;
  if (Math.abs(period - nominalPeriod) > nominalPeriod * PERIOD_TOLERANCE) return null;
  const origin = (sumTime - period * sumBeat) / n;

  return { origin, period, clicks: n };
}

/** The beat a moment belongs to, and how far it missed by. Early is negative. */
export function offsetAt(grid: BeatGrid, at: number): BeatOffset {
  const beat = Math.round((at - grid.origin) / grid.period);
  return { beat, offsetMs: (at - (grid.origin + beat * grid.period)) * 1000 };
}

/**
 * What a run added up to.
 *
 * `enough` is the gate everything downstream reads: false means the run is
 * reported to the player as unmeasured and nothing is written to their history.
 */
export interface TimingSummary {
  enough: boolean;
  /**
   * The offsets are too tight to have come from a person, so the beat grid is
   * almost certainly the player's own strums. See HUMAN_SPREAD_FLOOR_MS.
   */
  selfReferential: boolean;
  /** Beats between the first strum and the last, inclusive. */
  expectedBeats: number;
  /** Beats that got a strum at all. */
  beatsPlayed: number;
  /** Beats whose nearest strum was inside IN_TIME_MS. */
  beatsInTime: number;
  /** Strums beyond the first on a beat, so a double strum is visible as one. */
  extras: number;
  /** Mean signed offset in ms: negative rushes, positive drags. */
  meanMs: number;
  medianMs: number;
  /** Spread of the offsets in ms. See the note on `spreadOf`. */
  spreadMs: number;
  /**
   * Percentage of expected beats struck inside IN_TIME_MS. The stored score.
   * Zero whenever `enough` is false, so a run that is not a measurement cannot
   * be read as a good one by anything that forgets to check.
   */
  score: number;
  /** One offset per beat played, in beat order, for the results chart. */
  offsets: BeatOffset[];
}

const EMPTY: TimingSummary = {
  enough: false,
  selfReferential: false,
  expectedBeats: 0,
  beatsPlayed: 0,
  beatsInTime: 0,
  extras: 0,
  meanMs: 0,
  medianMs: 0,
  spreadMs: 0,
  score: 0,
  offsets: [],
};

/**
 * How tightly the offsets cluster, as a median absolute deviation scaled to be
 * read on the same axis as a standard deviation.
 *
 * A standard deviation is the wrong statistic here and it is wrong in the
 * direction that hurts most. A minute of strumming reliably contains two or
 * three gross mistimings: a fumbled chord change, a beat missed and caught late,
 * a double strum. Squaring the residuals lets any one of those dominate the
 * number, so a player whose forty-five good strums are getting visibly tighter
 * sees the figure that is supposed to describe that get worse. The MAD has a
 * breakdown point of a half: it describes the playing, and a handful of
 * disasters cannot move it. The 1.4826 factor makes it equal to the standard
 * deviation for normally distributed offsets, so the number is still readable as
 * "about this many milliseconds either side".
 */
function spreadOf(offsets: readonly number[], centre: number): number {
  if (offsets.length < 2) return 0;
  return 1.4826 * median(offsets.map((o) => Math.abs(o - centre)));
}

export function summariseTiming(strums: readonly number[], grid: BeatGrid): TimingSummary {
  if (strums.length === 0) return EMPTY;

  // One offset per beat: the closest strum wins the beat and the rest are
  // extras. Averaging every strum instead would let a beat that was hit twice
  // count twice toward how well the player is keeping time, which it is not.
  const closest = new Map<number, number>();
  let extras = 0;
  for (const at of strums) {
    const { beat, offsetMs } = offsetAt(grid, at);
    const held = closest.get(beat);
    if (held === undefined) {
      closest.set(beat, offsetMs);
      continue;
    }
    extras += 1;
    if (Math.abs(offsetMs) < Math.abs(held)) closest.set(beat, offsetMs);
  }

  const beats = [...closest.keys()].sort((a, b) => a - b);
  const expectedBeats = beats[beats.length - 1] - beats[0] + 1;
  const values = beats.map((beat) => closest.get(beat)!);
  const beatsInTime = values.filter((offset) => Math.abs(offset) <= IN_TIME_MS).length;
  const mid = median(values);
  const spreadMs = spreadOf(values, mid);
  const selfReferential = expectedBeats >= MIN_MEASURED_BEATS && spreadMs < HUMAN_SPREAD_FLOOR_MS;
  const enough = expectedBeats >= MIN_MEASURED_BEATS && !selfReferential;

  return {
    enough,
    selfReferential,
    expectedBeats,
    beatsPlayed: beats.length,
    beatsInTime,
    extras,
    meanMs: values.reduce((sum, v) => sum + v, 0) / values.length,
    medianMs: mid,
    spreadMs,
    score: enough ? Math.round((100 * beatsInTime) / expectedBeats) : 0,
    offsets: beats.map((beat) => ({ beat, offsetMs: closest.get(beat)! })),
  };
}

/**
 * How the run is going, in one short line the player can act on.
 *
 * Deliberately never a verdict on the person. "Landing a touch early" is
 * something to adjust; "you rush" is something to be.
 */
export function describeTiming(summary: TimingSummary): string {
  if (!summary.enough) return 'Not enough beats to measure yet.';
  const lean = Math.round(summary.medianMs);
  const centred = Math.abs(lean) <= TIMING_RESOLUTION_MS;
  if (centred && summary.spreadMs <= TIMING_RESOLUTION_MS) return 'Locked to the click.';
  if (centred) return 'Sitting on the beat. Now even out the spread.';
  return lean < 0
    ? `Landing about ${Math.abs(lean)} ms ahead of the click.`
    : `Landing about ${lean} ms behind the click.`;
}
