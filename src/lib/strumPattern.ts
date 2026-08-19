// Scoring a strumming pattern, slot by slot.
//
// WHAT THIS IS FOR. Module 5 of the beginner course is "Basic Theory and
// Strumming Development", and its two strumming lessons teach one mechanic: the
// arm never stops. It is a continuous eighth-note pendulum from the elbow, and
// for the beats you do not play you lift the pick off the strings while the arm
// keeps travelling through them. Which of the eight slots in a bar actually
// sound is the pattern, and the player chooses it.
//
// WHAT IT REPLACES. `summariseTiming` scores the share of quarter-note beats
// that got a strum inside 50 ms. That is the right measure for the drill it was
// built for, one down strum per click, and the wrong one for a pattern: a beat
// the pattern deliberately leaves empty counts against you, so a perfectly
// in-time "D-DU-UD-" scores 75 while all-downs scores 100. The player who
// graduates to the pattern the course spends two modules teaching watches their
// rhythm score fall and can never recover it. Up strums fare worse still: they
// land between beats, so they were binned as extras and counted for nothing at
// all, which is to say the one thing Module 5 is about was the one thing not
// measured.
//
// WHY A GHOST STRUM DOES NOT NEED TO BE HEARD. It cannot be: the pick is off
// the strings and there is no sound. It does not have to be. If the arm really
// is a pendulum then every strum that *does* sound lands on its own eighth-note
// slot, and if the arm stops and restarts the next one arrives late. Grid
// adherence at eighth resolution is therefore a real measure of the continuous
// motion, taken indirectly. That is worth stating plainly because the honest
// alternative was to claim nothing.
//
// WHAT IS MEASURED, AND WHAT IS NOT. Direction is not in the signal and is not
// inferred. The pattern says which slots should sound; the analyser says which
// slots did. `D-DU-UD-` has a distinctive fingerprint across eight slots without
// anyone knowing which way the hand was moving, and claiming to know would be
// the kind of confident wrong number this app has already paid for once.

import { IN_TIME_MS, type BeatGrid } from './strumTiming';

/** What a pattern does at one eighth-note slot. `null` is a ghost. */
export type SlotStroke = 'D' | 'U' | null;

export interface Pattern {
  /** The authored string, exactly as the task stores it. */
  source: string;
  /** One entry per eighth-note slot, in order. */
  slots: SlotStroke[];
}

/**
 * Slots in one bar of 4/4, at eighth resolution: 1 + 2 + 3 + 4 +.
 *
 * The count Justin has the player say out loud, and the reason the pattern
 * alphabet is what it is.
 */
export const SLOTS_PER_BAR = 8;

/**
 * How much later than the moment of contact each direction is detected.
 *
 * Measured, not assumed. Synthesised takes of `D-DU-UD-`, `D-DUDUD-` and
 * straight eighths at 80 BPM through the real analyser report downs about 23 ms
 * late and ups about 3 ms late. The cause is physical: a down stroke sweeps from
 * the wound E and the onset builds as the sweep crosses the strings, while an up
 * stroke starts on the thin E and rises almost at once.
 *
 * It matters because it is one axis of a 50 ms budget. Scoring both directions
 * against the same grid without this puts every up strum 20 ms early before the
 * player has done anything, which would read as rushing the offbeat, which is
 * the single most common thing a beginner is actually told off for. A bias you
 * know about and do not remove is a bias you are reporting as the player's.
 */
export const DOWN_DETECTION_LAG_MS = 23;
export const UP_DETECTION_LAG_MS = 3;

/**
 * Read a pattern string into eighth-note slots.
 *
 * Two lengths are accepted and they mean different things. Eight characters is
 * one bar at eighth resolution and is taken as written. Four characters is one
 * bar of quarter notes, the "four down strums" every beginner starts on, and is
 * expanded by putting a ghost after each: `DDDD` becomes `D-D-D-D-`, which is
 * the same instruction, because the arm still travels through the offbeats.
 *
 * Everything else returns null rather than being guessed at. Six characters in
 * particular describes three beats, which is not a bar of 4/4 at all, and a
 * matcher that quietly padded it would score the player against a bar that does
 * not exist.
 */
export function parsePattern(source: string): Pattern | null {
  const trimmed = source.trim().toUpperCase();
  if (!/^[DU-]+$/.test(trimmed)) return null;

  const read = (chars: string): SlotStroke[] =>
    [...chars].map((c) => (c === 'D' ? 'D' : c === 'U' ? 'U' : null));

  if (trimmed.length === SLOTS_PER_BAR) return { source, slots: read(trimmed) };

  if (trimmed.length === SLOTS_PER_BAR / 2) {
    // Quarters. An up strum on a quarter note is not a thing this expansion can
    // represent, and a pattern that wanted one would have been written at
    // eighth resolution, so a `U` here is a pattern that has already been
    // written wrong rather than one to reinterpret.
    if (trimmed.includes('U')) return null;
    const slots: SlotStroke[] = [];
    for (const c of trimmed) {
      slots.push(c === 'D' ? 'D' : null);
      slots.push(null);
    }
    return { source, slots };
  }

  return null;
}

/** Slots the pattern actually strikes. A pattern of all ghosts is not a pattern. */
export function soundedSlots(pattern: Pattern): number {
  return pattern.slots.filter((s) => s !== null).length;
}

export type SlotOutcomeKind =
  | 'hit'
  /** Expected and nothing arrived. The arm stopped, or the pick missed. */
  | 'missed'
  /** Correctly silent: the arm passed through with the pick off the strings. */
  | 'ghost'
  /**
   * Silent in the pattern, struck anyway.
   *
   * Not an error, and deliberately not named one. "Exploring Strumming" tells
   * the player in as many words that they can add strums and leave others out,
   * so an added strum is a variation. It is counted separately and shown
   * differently, and it never subtracts from the score.
   */
  | 'added';

export interface SlotOutcome {
  /** Bar within the run, from zero. */
  bar: number;
  /** Eighth-note slot within the bar, from zero. */
  slot: number;
  expected: SlotStroke;
  kind: SlotOutcomeKind;
  /**
   * How far the strum was from the slot, in milliseconds, once the direction's
   * own detection lag is taken out. Early is negative. Only present on a strum.
   */
  offsetMs?: number;
  /** Within {@link IN_TIME_MS} of the slot. Only meaningful on a hit. */
  inTime?: boolean;
}

export interface PatternRun {
  onsets: readonly number[];
  grid: BeatGrid;
  pattern: Pattern;
  /**
   * The grid beat that bar zero, slot zero sits on.
   *
   * The grid numbers beats from its own origin, which has nothing to do with
   * where the player was told to start, so the caller states it. Getting this
   * wrong rotates the whole pattern and scores a perfect take as a total miss,
   * which is exactly the failure a caller would otherwise blame on the player.
   */
  originBeat: number;
  /** Bars the run covers. */
  bars: number;
}

/**
 * Assign every onset to at most one slot, and every slot an outcome.
 *
 * An onset belongs to the slot it is nearest, within half a slot either side, so
 * the assignment is total and unambiguous rather than greedy in playing order: a
 * player who is consistently 40 ms late should not have their first strum eat
 * the slot before it and cascade the rest.
 */
export function matchPattern(run: PatternRun): SlotOutcome[] {
  const { onsets, grid, pattern, originBeat, bars } = run;
  const slotsPerBar = pattern.slots.length;
  const slotPeriod = (grid.period * 4) / slotsPerBar;
  const half = slotPeriod / 2;

  // Ideal time of every slot in the run, and the direction expected there.
  const ideal: { bar: number; slot: number; at: number; expected: SlotStroke }[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let slot = 0; slot < slotsPerBar; slot += 1) {
      const beat = originBeat + bar * 4 + (slot * 4) / slotsPerBar;
      ideal.push({
        bar,
        slot,
        at: grid.origin + beat * grid.period,
        expected: pattern.slots[slot],
      });
    }
  }

  const claimed = new Map<number, { at: number; distance: number }>();
  for (const onset of onsets) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < ideal.length; i += 1) {
      // Compare against where a strum of the expected direction would be *heard*,
      // not where it would be played, so the comparison is like for like.
      const lag = ideal[i].expected === 'U' ? UP_DETECTION_LAG_MS : DOWN_DETECTION_LAG_MS;
      const distance = Math.abs(onset - (ideal[i].at + lag / 1000));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best < 0 || bestDistance > half) continue;
    const held = claimed.get(best);
    // Two onsets inside one slot is a flam or a detector double. The nearer one
    // is the strum; keeping the first would let a stray early transient decide.
    if (!held || bestDistance < held.distance) claimed.set(best, { at: onset, distance: bestDistance });
  }

  return ideal.map((s, i) => {
    const struck = claimed.get(i);
    if (!struck) {
      return { bar: s.bar, slot: s.slot, expected: s.expected, kind: s.expected ? 'missed' : 'ghost' };
    }
    const lag = s.expected === 'U' ? UP_DETECTION_LAG_MS : DOWN_DETECTION_LAG_MS;
    const offsetMs = (struck.at - s.at) * 1000 - lag;
    if (!s.expected) {
      return { bar: s.bar, slot: s.slot, expected: null, kind: 'added', offsetMs };
    }
    return {
      bar: s.bar,
      slot: s.slot,
      expected: s.expected,
      kind: 'hit',
      offsetMs,
      inTime: Math.abs(offsetMs) <= IN_TIME_MS,
    };
  });
}

/** How one slot of the pattern went across every bar of the run. */
export interface SlotReliability {
  slot: number;
  expected: SlotStroke;
  /** Bars in which this slot was struck at all. */
  struck: number;
  /** Bars in which it was struck within {@link IN_TIME_MS}. */
  inTime: number;
  bars: number;
  /** Median offset across the bars it was struck in. Early is negative. */
  medianMs: number;
}

export interface PatternSummary {
  /** False when the run is too short to say anything. Nothing is recorded. */
  enough: boolean;
  bars: number;
  /** One entry per slot in the pattern, in order. This is the diagnosis. */
  slots: SlotReliability[];
  /** Expected strums that landed in time, as a percentage of those expected. */
  score: number;
  expected: number;
  played: number;
  /** Strums in slots the pattern leaves silent. Never subtracts from the score. */
  added: number;
  /**
   * The first bar in which every sounded slot landed in time, or null if none did.
   *
   * The whole reason the drill deals patterns at random rather than repeating
   * one. Justin's own test of a pattern being automatic is that it survives
   * without attention, and the measurable form of that is recall under switch:
   * after coming off a different pattern, does this one come out right on the
   * first bar, or does it take two bars of fumbling to settle. Accuracy averaged
   * over a long run hides exactly that.
   */
  settledBar: number | null;
}

/**
 * Bars a run needs before it is allowed an opinion.
 *
 * Four, because settling is the thing being measured and a two-bar run cannot
 * distinguish "came out right immediately" from "there was only time for one
 * attempt".
 */
export const MIN_PATTERN_BARS = 4;

const median = (values: readonly number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function summarisePattern(outcomes: readonly SlotOutcome[], pattern: Pattern): PatternSummary {
  const bars = outcomes.length ? Math.max(...outcomes.map((o) => o.bar)) + 1 : 0;
  const empty: PatternSummary = {
    enough: false, bars, slots: [], score: 0, expected: 0, played: 0, added: 0, settledBar: null,
  };
  if (bars < MIN_PATTERN_BARS || !soundedSlots(pattern)) return empty;

  const slots: SlotReliability[] = pattern.slots.map((expected, slot) => {
    const mine = outcomes.filter((o) => o.slot === slot);
    const hits = mine.filter((o) => o.kind === 'hit');
    return {
      slot,
      expected,
      struck: mine.filter((o) => o.kind === 'hit' || o.kind === 'added').length,
      inTime: hits.filter((o) => o.inTime).length,
      bars: mine.length,
      medianMs: median(hits.map((o) => o.offsetMs ?? 0)),
    };
  });

  const expected = outcomes.filter((o) => o.expected !== null).length;
  const played = outcomes.filter((o) => o.kind === 'hit').length;
  const inTime = outcomes.filter((o) => o.kind === 'hit' && o.inTime).length;

  let settledBar: number | null = null;
  for (let bar = 0; bar < bars; bar += 1) {
    const wanted = outcomes.filter((o) => o.bar === bar && o.expected !== null);
    if (wanted.length && wanted.every((o) => o.kind === 'hit' && o.inTime)) {
      settledBar = bar;
      break;
    }
  }

  return {
    enough: true,
    bars,
    slots,
    score: expected ? Math.round((inTime / expected) * 100) : 0,
    expected,
    played,
    added: outcomes.filter((o) => o.kind === 'added').length,
    settledBar,
  };
}

/**
 * How well established a pattern is, from its own recent runs.
 *
 * Named for what the lesson asks for: "these strumming patterns should feel so
 * consistent that they almost become automatic". Three clean runs rather than
 * one, matching the rule the rest of the app already uses for a change pair, and
 * for the same reason: one good run is a good day.
 *
 * `automatic` deliberately requires settling on the first bar, not merely a high
 * score. A pattern you recover by bar three is one you are working out; a
 * pattern that arrives whole is one you have.
 */
export type PatternStanding = 'new' | 'learning' | 'automatic';

export const AUTOMATIC_RUNS = 3;
/** Below this, a run did not hold the pattern well enough to count towards anything. */
export const PATTERN_CLEAN_SCORE = 80;

export interface PatternRunRecord {
  /** YYYY-MM-DD. */
  date: string;
  score: number;
  settledBar: number | null;
}

export function patternStanding(runs: readonly PatternRunRecord[]): PatternStanding {
  if (!runs.length) return 'new';
  const recent = runs.slice(-AUTOMATIC_RUNS);
  if (recent.length < AUTOMATIC_RUNS) return 'learning';
  const clean = recent.every((r) => r.score >= PATTERN_CLEAN_SCORE && r.settledBar === 0);
  return clean ? 'automatic' : 'learning';
}

/**
 * Which pattern to deal next.
 *
 * Weighted towards the least established, because time spent on a pattern that
 * is already automatic is time not spent on one that is not. But never only
 * those: one established pattern is always eligible, because the switch is the
 * exercise and a switch needs something to switch away from. Dealing purely by
 * weakness would drill three shaky patterns against each other and never test
 * recall of a solid one.
 *
 * Deterministic in its input so it can be tested; the caller supplies the roll.
 */
export function dealNext(
  deck: readonly { pattern: string; standing: PatternStanding }[],
  previous: string | null,
  roll: number,
): string | null {
  if (!deck.length) return null;
  const eligible = deck.filter((d) => d.pattern !== previous);
  const pool = eligible.length ? eligible : [...deck];
  const weight = (s: PatternStanding): number => (s === 'new' ? 4 : s === 'learning' ? 3 : 1);
  const total = pool.reduce((sum, d) => sum + weight(d.standing), 0);
  let cursor = Math.min(Math.max(roll, 0), 0.999999) * total;
  for (const d of pool) {
    cursor -= weight(d.standing);
    if (cursor < 0) return d.pattern;
  }
  return pool[pool.length - 1].pattern;
}
