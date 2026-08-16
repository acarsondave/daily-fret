// Moving back and forth along a path of chords.
//
// The anchor drill used to loop: D → A → E → D → A → E. That has two problems as
// an anchor-finger exercise. It only ever drills each transition in one
// direction, so the hand never practises the way back; and the wrap from the
// last chord to the first is a jump between two chords that are not neighbours
// in the exercise at all, which no piece of music asked for.
//
// Sweeping turns round at each end instead: D → A → E → A → D → A → E. Every
// neighbouring pair gets drilled both ways and nothing else gets drilled at all.
//
// Pure and on its own so the turn can be tested without a microphone: this is
// the sort of index arithmetic that is obviously right and quietly off by one.

export interface SweepStep {
  /** The index to cue next. */
  next: number;
  /** The direction to carry into the step after that. */
  dir: number;
}

/**
 * One step along a path of `length` chords, turning round at either end.
 *
 * A path of fewer than two chords cannot move, and says so by staying put rather
 * than wrapping. `rotationRing` already refuses to build one, and this must not
 * quietly become a loop if that ever changes.
 */
export function sweepStep(from: number, dir: number, length: number): SweepStep {
  if (length < 2) return { next: 0, dir: 1 };
  const ahead = from + dir;
  if (ahead >= length) return { next: from - 1, dir: -1 };
  if (ahead < 0) return { next: from + 1, dir: 1 };
  return { next: ahead, dir };
}
