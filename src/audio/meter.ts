// Time signatures, and where their weight falls.
//
// The click used to know one shape of bar: four beats, the first one a bell.
// Module 6 is where the course leaves four. 6/8 is counted in six eighth-note
// beats with the weight on one and a lighter weight on four, and that second
// weight is the whole of what makes it feel like 6/8 rather than two bars of
// 3/4 or a fast bar of six. A beginner cannot hear "compound time" from a
// description, so the click has to play it.
//
// Pure on purpose. The metronome engine, the panel, the tempo plan and both
// strumming drills read the same answer from here, which is the only way they
// can agree about where a bar starts.

import type { BeatAccent } from './metronome';

export type MeterId = '4/4' | '3/4' | '6/8';

/** How much weight a beat of the bar carries. One is never `none`. */
export type AccentLevel = 'strong' | 'light' | 'none';

export interface Meter {
  id: MeterId;
  /** Clicks in one bar. */
  beats: number;
  /**
   * What one click is worth. 6/8 clicks every eighth note, so its BPM is an
   * eighth-note BPM: Justin's "about 130, one down strum per beat" is 130 here.
   */
  pulse: 'quarter' | 'eighth';
  /** The default weight of each beat in the bar. */
  accents: readonly AccentLevel[];
  /** How the bar is counted out loud. */
  count: readonly string[];
}

export const METERS: Record<MeterId, Meter> = {
  '4/4': {
    id: '4/4',
    beats: 4,
    pulse: 'quarter',
    accents: ['strong', 'none', 'none', 'none'],
    count: ['1', '2', '3', '4'],
  },
  '3/4': {
    id: '3/4',
    beats: 3,
    pulse: 'quarter',
    accents: ['strong', 'none', 'none'],
    count: ['1', '2', '3'],
  },
  '6/8': {
    id: '6/8',
    beats: 6,
    pulse: 'eighth',
    accents: ['strong', 'none', 'none', 'light', 'none', 'none'],
    count: ['1', '2', '3', '4', '5', '6'],
  },
};

export const METER_IDS: readonly MeterId[] = ['4/4', '3/4', '6/8'];

export const DEFAULT_METER: MeterId = '4/4';

export function isMeterId(value: unknown): value is MeterId {
  return value === '4/4' || value === '3/4' || value === '6/8';
}

export function meterOf(id: string | undefined | null): Meter {
  return isMeterId(id) ? METERS[id] : METERS[DEFAULT_METER];
}

/** The meter a bar of this many beats is counted in, for songs that only say a number. */
export function meterForBeats(beats: number | undefined): MeterId {
  return beats === 6 ? '6/8' : beats === 3 ? '3/4' : '4/4';
}

/**
 * A stored accent row, made safe to play.
 *
 * Beat one is always strong: it is where the bar starts, and a click with no
 * bar line is a click the strumming drills cannot line a pattern up against.
 * A row of the wrong length (a stale save from another meter) is the default
 * rather than a guess at what it meant.
 */
export function normaliseAccents(
  id: MeterId,
  stored: readonly AccentLevel[] | undefined,
): AccentLevel[] {
  const meter = METERS[id];
  if (!stored || stored.length !== meter.beats) return [...meter.accents];
  const row = stored.map((level) =>
    level === 'strong' || level === 'light' || level === 'none' ? level : 'none',
  );
  row[0] = 'strong';
  return row;
}

/** What tapping a beat in the panel does to it. */
export function nextAccentLevel(level: AccentLevel): AccentLevel {
  return level === 'none' ? 'light' : level === 'light' ? 'strong' : 'none';
}

/**
 * The voice of every click in one cycle.
 *
 * The cycle is usually one bar. A changes drill can stretch it to the beats a
 * chord is held for (src/lib/tempo.ts), and then every bar line inside the
 * cycle gets the lighter mark, so an eight-beat change in 4/4 reads as two
 * bars exactly as it always has, and a twelve-beat change in 6/8 as two bars
 * of six.
 */
export function cycleAccents(
  id: MeterId,
  stored?: readonly AccentLevel[],
  cycle?: number,
): BeatAccent[] {
  const meter = METERS[id];
  const levels = normaliseAccents(id, stored);
  const length = Math.max(1, Math.round(cycle ?? meter.beats));
  const out: BeatAccent[] = [];
  for (let i = 0; i < length; i++) {
    if (i === 0) {
      out.push('downbeat');
      continue;
    }
    const inBar = i % meter.beats;
    if (inBar === 0) {
      out.push('midbar');
      continue;
    }
    const level = levels[inBar];
    out.push(level === 'strong' ? 'downbeat' : level === 'light' ? 'midbar' : 'beat');
  }
  return out;
}

/**
 * Which voice a beat gets.
 *
 * With a row, the row decides. Without one, the rule the click has always
 * used: a cycle that divides into bars of four gets a mark halfway, anything
 * else is downbeat and beats.
 */
export function accentFor(
  position: number,
  beatsPerBar: number,
  row?: readonly BeatAccent[],
): BeatAccent {
  if (position < 0) return 'countin';
  if (row && row.length) return row[position % row.length];
  const beat = position % beatsPerBar;
  if (beat === 0) return 'downbeat';
  if (beatsPerBar > 4 && beatsPerBar % 4 === 0 && beat % 4 === 0) return 'midbar';
  return 'beat';
}

/** One bar of quiet clicks before the first real one. */
export function countInFor(id: MeterId): number {
  return METERS[id].beats;
}
