/**
 * Whether a finished run measured the player or measured the microphone.
 *
 * `useSignalMeter` classifies the input as weak or unreadable throughout every
 * drill and then throws the classification away when the run ends. So a run of
 * eleven changes taken through a failing microphone went into the history
 * exactly like a run of eleven changes played badly: it reset the three-run
 * readiness streak and dragged the next tempo prescription down with it. The
 * owner's July history holds three such runs.
 *
 * The bar for withholding one is deliberately high, and both halves have to be
 * met. The whole product rests on not flattering the player, so a genuinely bad
 * run on a working microphone still counts, and so does a bad run on a
 * microphone that merely wobbled.
 */

/**
 * How far under its own recent baseline a run has to land.
 *
 * Two fifths of it. lib/tempo.ts already calls a run at 85% of baseline "a real
 * dip, not noise", and the click eases off for exactly that. This has to sit
 * well below that line, because everything between the two is an ordinary bad
 * session and the day's record is supposed to hold those.
 */
export const SHORTFALL_RATIO = 0.6;

/**
 * How much of the run the microphone has to have been unreadable for.
 *
 * A quarter. Below that the drill was mostly heard, and a run that was mostly
 * heard is a run: the count it produced is the player's.
 */
export const UNHEARD_SHARE_MIN = 0.25;

/**
 * Prior runs needed before there is a baseline to fall short of.
 *
 * Three, matching the window lib/tempo.ts judges a session against. Under that
 * there is nothing to compare with, and a first or second run always counts:
 * withholding it would leave the drill with no history at all, which is the one
 * state that makes every later judgement impossible.
 */
export const BASELINE_RUNS_MIN = 3;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * What this drill has recently been worth, from its own prior runs in date order.
 *
 * The median of the last three rather than the mean, so one outlier in the
 * window cannot set the bar the next run is judged against. Null when there are
 * fewer than three, which means there is no baseline and nothing to withhold on.
 */
export function recentBaseline(priorRates: readonly number[]): number | null {
  if (priorRates.length < BASELINE_RUNS_MIN) return null;
  return median(priorRates.slice(-BASELINE_RUNS_MIN));
}

export interface RunJudgement {
  /** This run, as a per-minute rate, in the same unit as the baseline. */
  rate: number;
  /** What the drill has recently been worth, or null when too little history. */
  baseline: number | null;
  /** Share of the run the meter read weak, unreadable or lost. 0..1. */
  unheardShare: number;
}

/**
 * Whether this run should be offered back rather than written.
 *
 * Both halves, never either alone. A shortfall on a clean microphone is a bad
 * session and belongs in the record; a struggling microphone under a normal
 * count heard enough to be trusted.
 */
export function isRunUnheard({ rate, baseline, unheardShare }: RunJudgement): boolean {
  if (baseline === null || baseline <= 0) return false;
  if (rate >= baseline * SHORTFALL_RATIO) return false;
  return unheardShare >= UNHEARD_SHARE_MIN;
}
