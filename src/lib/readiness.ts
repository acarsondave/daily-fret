// What "good enough" means, and what "reliably" means.
//
// Progress already answers "how fast" and "which way is this moving". This
// answers the question sitting underneath both: could the player do it again
// tomorrow. One run at or above the bar is a good day. The same run three times
// running is a skill, and only the second of those is worth telling anyone
// about.
//
// The rule is deliberately unforgiving, and that is a reversal of an earlier
// draft which tolerated one dip in the last four on the grounds that everyone
// has a bad session. But the bar exists precisely to stop someone moving on off
// one good result, and a player who came in under it two runs ago has just
// shown they cannot do it reliably yet. Waiting costs a session or two. The
// tell that strict is right: a player comfortably past the bar never trips this
// rule at all, so the only people it holds back are the people it is for.
//
// What it does not punish is resting. Runs are counted, never calendar days, so
// a day off is invisible here. Only a run that came in under the bar resets
// anything.

/**
 * One completed run of a drill, in that drill's own unit.
 *
 * Today the practice log stores one value per drill per day, and that value is
 * the day's best, so a "run" is currently the same thing as a day and two runs
 * in one session collapse into the better of them. That makes this model
 * slightly generous, in the one direction it would rather not be. When the log
 * starts recording individual runs, this interface gains the timestamp and the
 * drill's real length and nothing else here has to change.
 */
export interface DrillRun {
  /** The day the run was recorded, YYYY-MM-DD. */
  date: string;
  value: number;
}

/**
 * - `none`     nothing recorded.
 * - `working`  the latest run came in under the bar.
 * - `hit`      the latest run cleared the bar, but not enough of them yet.
 * - `held`     cleared on the last {@link HELD_RUNS} runs, and still fresh.
 * - `lapsed`   was held, and has not been run since it went cold.
 */
export type ReadinessState = 'none' | 'working' | 'hit' | 'held' | 'lapsed';

export interface Readiness {
  state: ReadinessState;
  /** Runs at or above the bar, counting back from the latest. */
  streak: number;
  bar: number;
  /** A word for a dense row. Null where the row should stay silent. */
  label: string | null;
  /** One sentence naming the evidence. Empty only when there is none. */
  evidence: string;
}

/** Consecutive clearing runs that turn a good day into a standing fact. */
export const HELD_RUNS = 3;

/**
 * How long a held result stands without being run again.
 *
 * Deliberately the same number as `RUST_DAYS` in lib/tempo.ts, which is how
 * long the metronome waits before it decides a player has gone rusty and eases
 * the prescribed tempo. Two parts of the app disagreeing about when evidence
 * has gone cold would show up as the click backing off while the mark still
 * claimed the skill was current. The readiness test asserts they match; it is
 * not imported from there because tempo.ts reaches into the audio output stack
 * and this module is loaded by a panel that has no business pulling it in.
 */
export const STALE_DAYS = 14;

/**
 * Justin's own gate, stated in the practice routine lesson of every beginner
 * module: "you can get around 30 chord changes in one minute". The app did not
 * invent this one and should not present it as its own.
 */
export const CHANGES_BAR = 30;

/**
 * A chord counts as under the hand once a pair using it moves at this rate.
 * This one *is* the app's own, inferred rather than taught: no lesson states a
 * per-chord number, so it must not be presented as the course's.
 */
export const CHORD_BAR = 20;

/** Anchor rotation is a harder motion than a single pair, so the bar is lower. */
export const ROTATION_BAR = 25;

const SPELLED = ['no', 'one', 'two', 'three'] as const;

/**
 * Small counts read as words; anything past the rule's window reads as a digit.
 * Capitalised because every call site so far opens a sentence with it, and
 * "38 on your last run. two more at 30 or better make it held" is the sort of
 * thing that reads as a machine talking.
 */
function spell(n: number): string {
  const word = SPELLED[n] ?? String(n);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * One measured value, as the player would write it.
 *
 * Rounding is never allowed to carry a value across the bar it failed to
 * clear. A drill that came in at 29.6 against a bar of 30 printed as "30 on
 * your last run. Held is three runs running at 30 or better", which is the
 * sentence disagreeing with itself in the space of nine words. Where the round
 * number would lie, the decimal stays.
 */
function figure(value: number, bar: number): string {
  const rounded = Math.round(value);
  if (value < bar && rounded >= bar) return value.toFixed(1);
  return String(rounded);
}

/** "34", "34 and 36", "34, 31 and 36". */
function listOf(values: readonly number[], bar: number): string {
  const parts = values.map((v) => figure(v, bar));
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const nothing = (bar: number): Readiness => ({
  state: 'none',
  streak: 0,
  bar,
  label: null,
  evidence: '',
});

/**
 * Where one drill stands against its bar.
 *
 * `runs` must be in chronological order, which is the same precondition
 * `recentTrend` and `planTempo` already take on their own series, and which
 * every producer in the app satisfies by sorting on the way out.
 */
export function readiness(runs: readonly DrillRun[], bar: number, today: string): Readiness {
  // A stored zero is the signature of a run the microphone never heard, not of
  // a player who made no changes at all, and lib/tempo.ts already refuses to
  // treat one as a data point for the same reason. Counting it as a failed run
  // would let a blocked mic wipe out a real streak.
  const counted = runs.filter((r) => Number.isFinite(r.value) && r.value > 0);
  if (counted.length === 0) return nothing(bar);

  const latest = counted[counted.length - 1];
  const idle = daysBetween(latest.date, today);

  let streak = 0;
  for (let i = counted.length - 1; i >= 0 && counted[i].value >= bar; i -= 1) streak += 1;

  if (streak >= HELD_RUNS) {
    if (idle > STALE_DAYS) {
      return {
        state: 'lapsed',
        streak,
        bar,
        label: 'Lapsed',
        evidence: `Held, then not run for ${idle} days. One run at ${bar} or better brings it back.`,
      };
    }
    const window = listOf(counted.slice(-HELD_RUNS).map((r) => r.value), bar);
    return {
      state: 'held',
      streak,
      bar,
      label: 'Held',
      evidence:
        streak > HELD_RUNS
          ? `${streak} runs in a row at ${bar} or better. The last three were ${window}.`
          : `${window} on your last three runs, all at ${bar} or better.`,
    };
  }

  if (streak > 0) {
    const seen = listOf(counted.slice(-streak).map((r) => r.value), bar);
    const left = HELD_RUNS - streak;
    return {
      state: 'hit',
      streak,
      bar,
      label: `${streak} of ${HELD_RUNS}`,
      evidence:
        `${seen} on your last ${streak === 1 ? 'run' : `${spell(streak).toLowerCase()} runs`}. ` +
        `${spell(left)} more at ${bar} or better ${left === 1 ? 'makes' : 'make'} it held.`,
    };
  }

  return {
    state: 'working',
    streak: 0,
    bar,
    label: null,
    evidence: `${figure(latest.value, bar)} on your last run. Held is three runs running at ${bar} or better.`,
  };
}
