import type { DrillKind } from '../types';

// What each drill's stored number means, in one place. These labels appear on
// the task row, in Progress and in the coached summary, and they were drifting:
// the row printed "cpm" for a rotation's change count and "nailed" for a score
// Chord Perfect reports as "placed".
export const DRILL_UNIT: Record<DrillKind, string> = {
  'one-minute-changes': 'cpm',
  'chord-rotation': 'changes',
  'chord-trainer': 'placed',
  'strum-timing': '% in time',
  'strum-pattern': '% in time',
  'note-finder': 'finds',
  song: '',
};

export const DRILL_LABEL: Record<DrillKind, string> = {
  'one-minute-changes': '1-minute changes',
  'chord-rotation': 'Anchor changes',
  'chord-trainer': 'Chord Perfect',
  'strum-timing': 'Strum timing',
  'strum-pattern': 'Strum patterns',
  'note-finder': 'Note finder',
  song: 'Song play-along',
};

/**
 * Shortest sensible Chord Perfect block, per shape.
 *
 * Below this a chord gets a couple of placements and nothing sticks, which is
 * the whole point of the drill.
 */
export const MIN_CHORD_SECONDS = 20;

/** Seconds each shape in a Chord Perfect pool is drilled for. */
export function trainerChordSeconds(durationSec: number, poolSize: number): number {
  return Math.max(MIN_CHORD_SECONDS, Math.round(durationSec / Math.max(1, poolSize)));
}

/**
 * How long a Chord Perfect block actually runs for, which is not what the task
 * asked for.
 *
 * Each shape gets its own clock and no shape gets less than MIN_CHORD_SECONDS,
 * so a 90-second task over five shapes runs for 100 seconds, not 90. The score
 * is every placement in that block, and lib/tempo.ts turns a stored score into a
 * per-minute rate by dividing by the length it was played over. Handed the
 * configured 90 it read the block eleven per cent fast, and the click then asked
 * for a pace the player had never actually reached, which is exactly what the
 * prescription is not allowed to do.
 */
export function trainerBlockSeconds(durationSec: number, poolSize: number): number {
  const size = Math.max(1, poolSize);
  return trainerChordSeconds(durationSec, size) * size;
}
