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

/**
 * What a pattern does at one eighth-note slot. `null` is a ghost.
 *
 * `X` IS THE PERCUSSIVE SLAP, AND IT IS A THIRD THING. The pick crosses the
 * strings and the strings are dead: an onset with no chord in it. Writing it as
 * `D` would teach the hand to strum where it should mute, and writing it as `-`
 * would teach it to skip the stroke that carries the groove, so it is neither.
 * It has no direction of its own; the arm's own direction at that slot is the
 * direction it is played with, which is the same rule a ghost already follows.
 *
 * What the drill does NOT claim about it: nothing here verifies that the strings
 * were actually muted. The analyser reports onsets, and an onset is all the
 * evidence there is, so a slap is scored exactly as a strike in the right slot
 * at the right time and no more than that. Saying "that was a proper slap" would
 * be a verdict on a measurement nobody has taken.
 */
export type SlotStroke = 'D' | 'U' | 'X' | null;

/**
 * Which way the arm is travelling through a slot, whatever the pattern asks.
 *
 * The pendulum, stated once. The arm is on its way down through every even slot
 * and up through every odd one, so a ghost and a slap both know their own
 * direction without being told, and a `D` or `U` can only ever agree with it.
 */
export const armDirectionAt = (slot: number): 'D' | 'U' => (slot % 2 === 0 ? 'D' : 'U');

export interface Pattern {
  /** The authored string, exactly as the task stores it, grid mark and all. */
  source: string;
  /** One entry per slot, in order. How wide a slot is, see `slotsPerBeat`. */
  slots: SlotStroke[];
  /**
   * Slots this pattern puts in one beat: 2 for eighths, 4 for sixteenths.
   *
   * Read from the string it was parsed out of, never assumed. Everything that
   * turns a slot into a time or into a count goes through this number, so a
   * pattern's grid is a property of that pattern and of nothing else.
   */
  slotsPerBeat: SlotResolution;
}

/** Beats in a bar. Every pattern in this app is 4/4. */
export const BEATS_PER_BAR = 4;

/**
 * How finely a pattern divides the beat.
 *
 * Two is eighth notes, counted 1 + 2 + 3 + 4 +, and is what Module 5 teaches and
 * what every pattern on the ladder is written in. Four is sixteenths, counted
 * 1 e + a, and exists because some songs are not counted in eighths and reading
 * one as though it were teaches the wrong count. Get Lucky is the case that
 * forced it: laid out as eighths its sixteen slots become two bars, which puts a
 * bar line and an accented downbeat in the middle of a phrase the record counts
 * straight through, and moves the percussive slap off the backbeat where it
 * belongs onto beat three where nothing happens.
 *
 * NOT A GLOBAL. This is a property of each pattern, carried on the pattern and on
 * the string it was written as, never a constant read from anywhere. Which grid a
 * song is counted on is a claim about the record, it is decided in
 * src/data/songs.ts, and it has to stay changeable there in one line: the only
 * real test of the reading is the player putting it against the record.
 */
export type SlotResolution = 2 | 4;

export const EIGHTHS: SlotResolution = 2;
export const SIXTEENTHS: SlotResolution = 4;

/**
 * Slots in one bar of 4/4, at eighth resolution: 1 + 2 + 3 + 4 +.
 *
 * The count Justin has the player say out loud, and the reason the pattern
 * alphabet is what it is. Still exported and still eight, because eighths are
 * still what almost everything here is: read a pattern's own bar length off
 * {@link slotsPerBarOf} rather than assuming this one.
 */
export const SLOTS_PER_BAR = 8;

/** Slots in one bar of this pattern. Eight for eighths, sixteen for sixteenths. */
export const slotsPerBarOf = (pattern: Pattern): number =>
  pattern.slotsPerBeat * BEATS_PER_BAR;

/**
 * What marks a written pattern as sixteenths.
 *
 * A prefix on the string, and it has to be on the string rather than beside it,
 * because the string is the whole of what travels: a deck is `string[]` from the
 * task through to the drill, and a drill key is that string with a tempo on the
 * end. Two patterns of the same sixteen characters on different grids are
 * different exercises held at different tempos, and without the mark they would
 * collapse into one series in the player's history.
 *
 * `16.` and not something shorter. It cannot contain `:`, which every key is
 * split on, nor `~`, which separates a pattern from its tempo, nor `@`, which
 * belongs to the window a count was counted over. It also has to be unmistakable
 * in a stored key somebody reads months from now, and `16.` says what it is.
 *
 * ABSENCE MEANS EIGHTHS. That is the whole compatibility guarantee: no pattern
 * ever written carries this mark, so every stored key and every built-in rung
 * parses, scores and keys exactly as it did before sixteenths existed.
 */
export const SIXTEENTH_MARK = '16.';

/** A pattern's slots written as the string that carries its grid with it. */
export function writePattern(slots: string, resolution: SlotResolution): string {
  return resolution === SIXTEENTHS ? `${SIXTEENTH_MARK}${slots}` : slots;
}

/**
 * The longest phrase a pattern may be, in bars.
 *
 * Two, and the second bar is not decoration. "Exploring Strumming" asks for it
 * in as many words: "generally, every four or eight bars, a slight rhythmic
 * strumming variation should happen. Your strumming pattern should stay the
 * same most of the time, but this change will make it pop." A phrase that holds
 * for a bar and then varies is a different thing to hold than a bar that
 * repeats, and it cannot be written in eight slots at all.
 *
 * Not four or eight. A pattern is something the player is asked to produce cold
 * after switching off another one, and a four-bar phrase is a piece of music
 * rather than a pattern. Two is also where the drill stays honest about time:
 * a run has to hold a phrase MIN_PATTERN_GOES times before it is allowed an
 * opinion, and that is already eight bars for a two-bar phrase.
 */
export const MAX_PATTERN_BARS = 2;

/** Bars the phrase occupies. One for every pattern until two-bar phrases. */
export function barsIn(pattern: Pattern): number {
  return pattern.slots.length / slotsPerBarOf(pattern);
}

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
 * How late a stroke of the given kind is detected, at a slot.
 *
 * A slap takes the lag of the direction the arm is already going, and that is
 * inherited rather than measured. The reason the two figures above differ is
 * geometry — a down stroke's onset builds as the sweep crosses from the wound E,
 * an up stroke's starts on the thin E and rises at once — and a muted stroke
 * sweeps across the same strings in the same direction, so the same geometry
 * applies to it. What is genuinely unmeasured is whether damping the strings
 * sharpens the transient enough to move the figure; if it does, the error is at
 * most the twenty milliseconds between the two, inside a fifty millisecond
 * budget. Said out loud here because it is the one number in this file taken by
 * argument instead of from a take.
 */
function detectionLagMs(expected: SlotStroke, slot: number): number {
  const direction = expected === 'D' || expected === 'U' ? expected : armDirectionAt(slot);
  return direction === 'U' ? UP_DETECTION_LAG_MS : DOWN_DETECTION_LAG_MS;
}

/**
 * Read a pattern string into slots.
 *
 * THE GRID COMES FIRST. A string beginning `16.` is one bar of sixteenths and
 * everything else is eighths ({@link SIXTEENTH_MARK}). Nothing infers a grid from
 * a length, because sixteen characters is a real pattern under both readings and
 * guessing between them is exactly the mistake this exists to stop.
 *
 * IN EIGHTHS, three lengths are accepted and they mean different things. Eight
 * characters is one bar and is taken as written. Sixteen is a two-bar phrase,
 * read the same way straight through; see {@link MAX_PATTERN_BARS}. Four
 * characters is one bar of quarter notes, the "four down strums" every beginner
 * starts on, and is expanded by putting a ghost after each: `DDDD` becomes
 * `D-D-D-D-`, which is the same instruction, because the arm still travels
 * through the offbeats.
 *
 * IN SIXTEENTHS, exactly sixteen characters, which is exactly one bar. Not two: a
 * two-bar sixteenth phrase is thirty-two slots to hold in one go, which is a
 * piece of music rather than a pattern, and allowing it would push past every
 * length this file and the pattern manager are built around for no case anyone
 * has.
 *
 * Everything else returns null rather than being guessed at. Six characters in
 * particular describes three beats, which is not a bar of 4/4 at all, and a
 * matcher that quietly padded it would score the player against a bar that does
 * not exist.
 */
export function parsePattern(source: string): Pattern | null {
  const marked = source.trim().toUpperCase().startsWith(SIXTEENTH_MARK.toUpperCase());
  const body = marked ? source.trim().slice(SIXTEENTH_MARK.length) : source.trim();
  const trimmed = body.toUpperCase();
  if (!/^[DUX-]+$/.test(trimmed)) return null;

  const read = (chars: string): SlotStroke[] =>
    [...chars].map((c) => (c === 'D' ? 'D' : c === 'U' ? 'U' : c === 'X' ? 'X' : null));

  if (marked) {
    if (trimmed.length !== SIXTEENTHS * BEATS_PER_BAR) return null;
    const slots = read(trimmed);
    return travelsWithTheArm(slots) ? { source, slots, slotsPerBeat: SIXTEENTHS } : null;
  }

  if (trimmed.length % SLOTS_PER_BAR === 0 && trimmed.length <= SLOTS_PER_BAR * MAX_PATTERN_BARS) {
    const slots = read(trimmed);
    return travelsWithTheArm(slots) ? { source, slots, slotsPerBeat: EIGHTHS } : null;
  }

  if (trimmed.length === SLOTS_PER_BAR / 2) {
    // Quarters. An up strum on a quarter note is not a thing this expansion can
    // represent, and a pattern that wanted one would have been written at
    // eighth resolution, so a `U` here is a pattern that has already been
    // written wrong rather than one to reinterpret.
    if (trimmed.includes('U')) return null;
    const slots: SlotStroke[] = [];
    for (const c of trimmed) {
      // A slap survives the expansion where an up strum cannot: it is played
      // with whatever direction the arm already has, and on a quarter note that
      // is always a down.
      slots.push(c === 'D' ? 'D' : c === 'X' ? 'X' : null);
      slots.push(null);
    }
    return { source, slots, slotsPerBeat: EIGHTHS };
  }

  return null;
}

/**
 * Whether every stroke faces the way the arm is already going at that slot.
 *
 * The arm is a pendulum: it is on its way down through every even slot and up
 * through every odd one, whatever the pattern asks of it. So a `U` on a
 * downbeat is not a hard pattern, it is an impossible one, and letting it
 * through costs twice over. The bar would draw a pick pointing against the
 * arm crossing it, and the matcher would take the up strum's detection lag off
 * a stroke that was physically a down, moving the reported offset twenty
 * milliseconds the wrong way inside a fifty millisecond budget.
 */
function travelsWithTheArm(slots: readonly SlotStroke[]): boolean {
  return slots.every(
    // A slap is exempt because it has no direction to disagree with: it is
    // played with whichever way the arm is already going through that slot.
    (stroke, slot) => !stroke || stroke === 'X' || stroke === armDirectionAt(slot),
  );
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
  /**
   * Which time round the pattern this was, from zero.
   *
   * Not a bar. A phrase may be two bars long ({@link MAX_PATTERN_BARS}), and
   * what the drill and the summary both ask about is whether the pattern came
   * out whole this time round, which is a question about the phrase.
   */
  pass: number;
  /** Eighth-note slot within the pattern, from zero. */
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
   * The grid beat that the pattern's first slot sits on.
   *
   * The grid numbers beats from its own origin, which has nothing to do with
   * where the player was told to start, so the caller states it. Getting this
   * wrong rotates the whole pattern and scores a perfect take as a total miss,
   * which is exactly the failure a caller would otherwise blame on the player.
   */
  originBeat: number;
  /** Times round the pattern the run covers. */
  passes: number;
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
  const { onsets, grid, pattern, originBeat, passes } = run;
  const slots = pattern.slots.length;
  // How wide a slot is comes from the pattern and from nothing else. The phrase's
  // length says how many slots there are; its grid says how long one lasts. This
  // used to be `grid.period / 2` under a comment saying a slot is always half a
  // beat, which was true of every pattern that existed at the time and is exactly
  // the assumption a sixteenth-note phrase breaks.
  const slotPeriod = grid.period / pattern.slotsPerBeat;
  const half = slotPeriod / 2;

  // Ideal time of every slot in the run, and the direction expected there.
  const ideal: { pass: number; slot: number; at: number; expected: SlotStroke }[] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    for (let slot = 0; slot < slots; slot += 1) {
      const beat = originBeat + (pass * slots + slot) / pattern.slotsPerBeat;
      ideal.push({
        pass,
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
      const lag = detectionLagMs(ideal[i].expected, ideal[i].slot);
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
      return { pass: s.pass, slot: s.slot, expected: s.expected, kind: s.expected ? 'missed' : 'ghost' };
    }
    const lag = detectionLagMs(s.expected, s.slot);
    const offsetMs = (struck.at - s.at) * 1000 - lag;
    if (!s.expected) {
      return { pass: s.pass, slot: s.slot, expected: null, kind: 'added', offsetMs };
    }
    return {
      pass: s.pass,
      slot: s.slot,
      expected: s.expected,
      kind: 'hit',
      offsetMs,
      inTime: Math.abs(offsetMs) <= IN_TIME_MS,
    };
  });
}

/** How one slot of the pattern went across every pass of the run. */
export interface SlotReliability {
  slot: number;
  expected: SlotStroke;
  /** Passes in which this slot was struck at all. */
  struck: number;
  /** Passes in which it was struck within {@link IN_TIME_MS}. */
  inTime: number;
  passes: number;
  /** Median offset across the passes it was struck in. Early is negative. */
  medianMs: number;
}

export interface PatternSummary {
  /** False when the run is too short to say anything. Nothing is recorded. */
  enough: boolean;
  passes: number;
  /** One entry per slot in the pattern, in order. This is the diagnosis. */
  slots: SlotReliability[];
  /** Expected strums that landed in time, as a percentage of those expected. */
  score: number;
  expected: number;
  played: number;
  /** Strums in slots the pattern leaves silent. Never subtracts from the score. */
  added: number;
  /**
   * The first pass in which every sounded slot landed in time, or null if none
   * did. Zero means the pattern arrived whole.
   *
   * The whole reason the drill deals patterns at random rather than repeating
   * one. Justin's own test of a pattern being automatic is that it survives
   * without attention, and the measurable form of that is recall under switch:
   * after coming off a different pattern, does this one come out right the first
   * time round, or does it take two goes of fumbling to settle. Accuracy
   * averaged over a long run hides exactly that.
   *
   * Still called `settledBar` because that is the name it is stored under in
   * every daily log already written, and a field the app reads back from disk is
   * not renamed for tidiness. Every pattern that existed when it was named was
   * one bar long, so the two readings agreed.
   */
  settledBar: number | null;
}

/**
 * Times round the pattern a run needs before it is allowed an opinion.
 *
 * Four, because settling is the thing being measured and two passes cannot
 * distinguish "came out right immediately" from "there was only time for one
 * attempt". For a two-bar phrase that is eight bars, which is the cost of asking
 * the same question about a longer thing rather than a discount on it.
 */
export const MIN_PATTERN_PASSES = 4;

const median = (values: readonly number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function summarisePattern(outcomes: readonly SlotOutcome[], pattern: Pattern): PatternSummary {
  const passes = outcomes.length ? Math.max(...outcomes.map((o) => o.pass)) + 1 : 0;
  const empty: PatternSummary = {
    enough: false, passes, slots: [], score: 0, expected: 0, played: 0, added: 0, settledBar: null,
  };
  if (passes < MIN_PATTERN_PASSES || !soundedSlots(pattern)) return empty;

  const slots: SlotReliability[] = pattern.slots.map((expected, slot) => {
    const mine = outcomes.filter((o) => o.slot === slot);
    const hits = mine.filter((o) => o.kind === 'hit');
    return {
      slot,
      expected,
      struck: mine.filter((o) => o.kind === 'hit' || o.kind === 'added').length,
      inTime: hits.filter((o) => o.inTime).length,
      passes: mine.length,
      medianMs: median(hits.map((o) => o.offsetMs ?? 0)),
    };
  });

  const expected = outcomes.filter((o) => o.expected !== null).length;
  const played = outcomes.filter((o) => o.kind === 'hit').length;
  const inTime = outcomes.filter((o) => o.kind === 'hit' && o.inTime).length;

  let settledBar: number | null = null;
  for (let pass = 0; pass < passes; pass += 1) {
    const wanted = outcomes.filter((o) => o.pass === pass && o.expected !== null);
    if (wanted.length && wanted.every((o) => o.kind === 'hit' && o.inTime)) {
      settledBar = pass;
      break;
    }
  }

  return {
    enough: true,
    passes,
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
 * `automatic` deliberately requires settling on the first pass, not merely a
 * high score. A pattern you recover on the third go is one you are working out;
 * a pattern that arrives whole is one you have.
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
