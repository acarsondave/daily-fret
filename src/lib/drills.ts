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
  song: '',
};

export const DRILL_LABEL: Record<DrillKind, string> = {
  'one-minute-changes': '1-minute changes',
  'chord-rotation': 'Anchor changes',
  'chord-trainer': 'Chord Perfect',
  'strum-timing': 'Strum timing',
  song: 'Song play-along',
};
