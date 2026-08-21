/**
 * Where a drill's number and the number to beat sit on the results ring.
 *
 * The ring used to be a picture of one run and nothing else: it filled as the
 * count approached the previous best and a sentence underneath said "+7 over
 * your best" or "4 to beat your best". The sentence is gone, so the ring has to
 * carry both numbers at once. It does that by putting the previous best on the
 * circumference as a mark: the arc reaching past the mark is the run that beat
 * it, and the arc stopping short of it is the distance left, drawn to scale.
 *
 * Two of the drills count things with no natural maximum, and one scores a
 * percentage that has one. Both end up on the same ring through this function,
 * so the four result screens can be read the same way without knowing which.
 */

/**
 * Where the mark sits when the drill has no ceiling of its own.
 *
 * Fixed rather than derived, so the target is in the same place on every run of
 * every counting drill and the player learns one shape. It leaves a quarter of
 * the ring beyond the mark, which is the room a new best has to grow into: a
 * run that beats the mark by a quarter fills the ring, and anything past that
 * is already an exceptional day.
 */
export const BEST_AT = 0.8;

export interface RingScale {
  /** How much of the circumference the run itself covers, 0..1. */
  progress: number;
  /** Where the previous best sits, or null when this is the first run. */
  benchmark: number | null;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * @param value  what this run has counted or scored so far
 * @param best   the best before this run started, 0 when there is none
 * @param ceiling the top of the drill's own scale, for a drill that has one
 */
export function ringScale(value: number, best: number, ceiling?: number): RingScale {
  if (ceiling !== undefined && ceiling > 0) {
    return {
      progress: clamp01(value / ceiling),
      benchmark: best > 0 ? clamp01(best / ceiling) : null,
    };
  }
  // No previous best and no ceiling: nothing to be a fraction of. The run lands
  // on the mark's own place, which is where the mark then appears, so a first
  // run is drawn as the benchmark being set rather than as a score out of
  // nothing.
  if (best <= 0) return { progress: value > 0 ? BEST_AT : 0, benchmark: null };
  return { progress: clamp01(value / (best / BEST_AT)), benchmark: BEST_AT };
}

/**
 * The same scale, for a ring being watched while the count is still climbing.
 *
 * Separate from `ringScale` because the first-run case above is a statement
 * about a run that has *finished*: it landed, and where it landed is the mark it
 * sets. Read live, that same answer is a lie with a very specific shape — the
 * arc jumps to the mark's place on the first thing counted and then sits there
 * for the rest of the drill, whether the player goes on to place five more or
 * fifty. A whole coached session was reported as "the progress bar is not
 * working or moving properly" and this was why; it had never moved.
 *
 * So a live run with nothing to be a fraction of gets `null` rather than a
 * number, and the drills draw the count with no ring around it. A ring is a
 * target. Until there is something to aim at, there is no target to draw, and
 * an arc that implies one is the app claiming to know something it does not.
 */
export function liveRingScale(
  value: number,
  best: number,
  ceiling?: number,
): RingScale | null {
  // A ceiling is a real scale on its own, so a first run against one is fine to
  // draw: the arc is the score out of the top, and only the mark is missing.
  if (ceiling !== undefined && ceiling > 0) return ringScale(value, best, ceiling);
  if (best <= 0) return null;
  return ringScale(value, best);
}
