// Pure data functions only: no React, no store. The hook that feeds them lives
// in hooks/useDrillStats.ts. Keeping them separable is what lets these be run
// against a real exported history without booting the app.
import { parsePairKey } from './pairs';
import { DRILL_UNIT } from './drills';
import { describeDrillKey, ratePerMinute } from './drillKeys';
import { baseKey } from './drillWindow';
import { runsFor } from '../store/completion';
import type { DailyLog } from '../types';

export interface DrillHistory {
  best: number; // personal best across all days
  series: number[]; // chronological, one point per day
}

/**
 * One drill's history, oldest first, in the unit the drill is compared in.
 *
 * The key names what was played (a pair, a shape, a Chord Perfect pool, an
 * anchor ring); see lib/drillKeys.ts. A run that recorded the window it was
 * counted over is filed under a key carrying that window, and it belongs to this
 * history: a ninety-second Chord Perfect block and a sixty-second one over the
 * same shapes are the same drill, so they are read as one series of rates rather
 * than as two series, or as one series whose best is simply whichever block ran
 * longest. That last one is what this used to do.
 */
export function keyDrillHistory(
  dailyLogs: Record<string, DailyLog>,
  key: string,
): DrillHistory {
  const points = Object.values(dailyLogs ?? {})
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((l) => ratesFor(l, key));
  return { best: points.reduce((m, v) => Math.max(m, v), 0), series: points };
}

/**
 * Every rate a day holds for one drill, however many windows it was played at.
 *
 * A day can hold more than one when the same drill was run at two lengths, which
 * is two keys and therefore two of that day's bests. Both are kept: they are two
 * runs, and dropping either would be the app deciding which of the player's
 * sessions counted.
 */
function ratesFor(log: DailyLog, key: string): number[] {
  const results = log.drillResults;
  if (!results) return [];
  const out: number[] = [];
  for (const [stored, value] of Object.entries(results)) {
    if (typeof value !== 'number' || baseKey(stored) !== key) continue;
    out.push(ratePerMinute(stored, value));
  }
  return out;
}

/**
 * The keys one day holds for any of these drills, windows and all.
 *
 * A stored key states the drill and, where the run said so, the seconds it was
 * counted over (lib/drillWindow.ts). So nothing may look a drill key up
 * directly: the note finder is the one drill that reports its own block length,
 * every one of its results is filed under `find:<rung>@60`, and a reader asking
 * for `find:<rung>` finds nothing at all.
 */
function storedKeysFor(log: DailyLog | undefined, drills: readonly string[]): string[] {
  const results = log?.drillResults;
  if (!results) return [];
  return Object.keys(results).filter((stored) => drills.includes(baseKey(stored)));
}

/**
 * The best of a day's results across several drills, as a rate.
 *
 * Several, because one task can fan out into several keys: a changes task is a
 * key per pair, and the row above it wants one number. Rates rather than the
 * counts they are stored as, for the reason every other reader holds rates: two
 * block lengths are not two numbers to pick the larger of.
 */
export function bestOnDay(log: DailyLog | undefined, drills: readonly string[]): number | null {
  const results = log?.drillResults;
  if (!results) return null;
  let best: number | null = null;
  for (const stored of storedKeysFor(log, drills)) {
    const value = results[stored];
    if (typeof value !== 'number') continue;
    const rate = ratePerMinute(stored, value);
    if (best === null || rate > best) best = rate;
  }
  return best;
}

/** Runs a day recorded across several drills. A day that kept only its best counts as one. */
export function runsOnDay(log: DailyLog | undefined, drills: readonly string[]): number {
  if (!log) return 0;
  let count = 0;
  for (const stored of storedKeysFor(log, drills)) count += runsFor(log, stored).length;
  return count;
}

/** The best across every day, for a row reporting a personal best. */
export function bestAcrossDays(
  dailyLogs: Record<string, DailyLog>,
  drills: readonly string[],
): number | null {
  let best: number | null = null;
  for (const log of Object.values(dailyLogs ?? {})) {
    const day = bestOnDay(log, drills);
    if (day !== null && (best === null || day > best)) best = day;
  }
  return best;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

// One measurable thing the player can watch move. Two families share this shape
// so Progress can chart either without knowing which it is holding:
//  - `pair`: a chord change, keyed A↔D, measured in changes per minute;
//  - `task`: anything else a drill produced, in its own unit.
export interface DrillStat {
  key: string; // the storage key results are written under
  kind: 'pair' | 'task';
  label: string; // "A ↔ D", or the task's title
  unit: string; // 'cpm' | 'changes' | 'placed'
  best: number;
  today: number | null;
  series: SeriesPoint[]; // chronological, one point per day
}

// A pair stat, narrowed. `recommendNext` only works on pairs, because "practise
// this next" means a specific transition, not a whole drill.
export interface PairStat extends DrillStat {
  kind: 'pair';
  from: string;
  to: string;
}

function sortByDate(a: SeriesPoint, b: SeriesPoint) {
  return a.date.localeCompare(b.date);
}

// Chord-change history by *pair* (e.g. A↔D) across every routine and day.
//
// Grouped by the drill rather than by the stored key, and held as rates rather
// than as raw counts, so a pair drilled for thirty seconds one day and sixty the
// next is one history of one thing. See lib/drillWindow.ts.
export function pairStats(dailyLogs: Record<string, DailyLog>, today: string): PairStat[] {
  const byPair = new Map<string, PairStat>();

  for (const log of Object.values(dailyLogs)) {
    const results = log.drillResults;
    if (!results) continue;
    for (const [key, value] of Object.entries(results)) {
      const pair = parsePairKey(key);
      if (!pair || typeof value !== 'number') continue;
      const drill = baseKey(key);
      let stat = byPair.get(drill);
      if (!stat) {
        stat = {
          key: drill,
          kind: 'pair',
          label: `${pair.from} ↔ ${pair.to}`,
          unit: DRILL_UNIT['one-minute-changes'],
          from: pair.from,
          to: pair.to,
          best: 0,
          today: null,
          series: [],
        };
        byPair.set(drill, stat);
      }
      const rate = ratePerMinute(key, value);
      stat.series.push({ date: log.date, value: rate });
      stat.best = Math.max(stat.best, rate);
      if (log.date === today) stat.today = rate;
    }
  }

  const stats = [...byPair.values()];
  for (const s of stats) s.series.sort(sortByDate);
  return stats;
}

// Everything that is not a chord change: each shape Chord Perfect drilled, each
// pool it scored, each anchor ring that was turned.
//
// The label used to be looked up in the routines, because the result was filed
// under a task id and a task id says nothing. Keys name what was played now, so
// the key is the label, and a drill goes on saying what it is long after the
// task that launched it was renamed or rebuilt.
//
// A key that still names a task id is a result from before that was true and
// whose task the alias map could not identify. It is shown as a drill since
// removed rather than dropped: losing the number would be worse than the ugly
// name, and the day it was earned on still happened.
export function taskStats(dailyLogs: Record<string, DailyLog>, today: string): DrillStat[] {
  const byKey = new Map<string, DrillStat>();
  for (const log of Object.values(dailyLogs)) {
    const results = log.drillResults;
    if (!results) continue;
    for (const [key, value] of Object.entries(results)) {
      if (typeof value !== 'number' || parsePairKey(key)) continue;
      const drill = baseKey(key);
      let stat = byKey.get(drill);
      if (!stat) {
        const described = describeDrillKey(drill);
        stat = {
          key: drill,
          kind: 'task',
          label: described.label,
          unit: described.unit,
          best: 0,
          today: null,
          series: [],
        };
        byKey.set(drill, stat);
      }
      const rate = ratePerMinute(key, value);
      stat.series.push({ date: log.date, value: rate });
      stat.best = Math.max(stat.best, rate);
      if (log.date === today) stat.today = rate;
    }
  }

  const stats = [...byKey.values()];
  for (const s of stats) s.series.sort(sortByDate);
  return stats;
}

export interface AllDrillStats {
  pairs: PairStat[];
  tasks: DrillStat[];
  /** True when there is anything at all to show. */
  any: boolean;
}

export function collectDrillStats(
  dailyLogs: Record<string, DailyLog>,
  today: string,
): AllDrillStats {
  const pairs = pairStats(dailyLogs, today);
  const tasks = taskStats(dailyLogs, today);
  return { pairs, tasks, any: pairs.length > 0 || tasks.length > 0 };
}

export interface Trend {
  direction: 'up' | 'down' | 'flat';
  /**
   * Percent change against the earlier window, unrounded. Null when the earlier
   * window averaged zero, because there is no percentage of nothing.
   */
  percent: number | null;
  /** How many sessions sit on each side of the comparison. */
  window: number;
  /** What was compared, in words, so the number is never a bare claim. */
  basis: string;
}

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * How a drill is moving *now*.
 *
 * Progress used to compare the first result ever recorded to the latest, which
 * on a long history is a biography rather than a trend: months of early
 * improvement keep reporting a large gain while the last three weeks slide.
 * This averages the recent sessions against the same number of sessions before
 * them, so a plateau reads as a plateau and a decline reads as a decline.
 */
export function recentTrend(series: readonly SeriesPoint[], window = 3): Trend | null {
  if (series.length < 2) return null;

  const w = Math.min(window, Math.floor(series.length / 2));
  const values = series.map((p) => p.value);
  const recent = mean(values.slice(-w));
  const prior = mean(values.slice(-2 * w, -w));
  const delta = recent - prior;

  // Direction comes from the raw difference, never from the rounded percentage.
  // A 0.4% slide is a slide, and rounding it into a flat line flatters the
  // player at the exact moment the app should be honest with them.
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const basis =
    w === 1 ? 'latest session against the one before' : `last ${w} sessions against the ${w} before`;

  return { direction, percent: prior > 0 ? (delta / prior) * 100 : null, window: w, basis };
}

/** A trend short enough for a chip, with no real move rounded away to nothing. */
export function trendLabel(trend: Trend): string {
  if (trend.direction === 'flat') return 'level';
  if (trend.percent === null) return trend.direction === 'up' ? 'up' : 'down';
  const rounded = Math.round(Math.abs(trend.percent));
  const sign = trend.direction === 'up' ? '+' : '-';
  return rounded === 0 ? `${sign}<1%` : `${sign}${rounded}%`;
}

/**
 * The drill the panel should open on, chosen rather than asked for.
 *
 * Nothing here should need a click before it says something. Progress used to
 * open on whichever drill sorted highest by personal best, which is the least
 * informative choice available: a number that may not have moved in months.
 * Today's run wins, because it is the thing the player just did; after that,
 * whichever drill has moved furthest against its own recent runs.
 */
export function pickFocus(stats: readonly DrillStat[]): DrillStat | null {
  if (stats.length === 0) return null;

  const readable = stats.filter((s) => s.series.length >= 2);
  if (readable.length === 0) return stats[0];

  const scored = readable.map((stat) => {
    const trend = recentTrend(stat.series);
    return {
      stat,
      today: stat.today !== null ? 1 : 0,
      movement: trend && trend.percent !== null ? Math.abs(trend.percent) : 0,
    };
  });
  scored.sort((a, b) => b.today - a.today || b.movement - a.movement);
  return scored[0].stat;
}

export interface Recommendation {
  stat: PairStat;
  reason: string;
}

/**
 * The single pair most worth drilling next.
 *
 * Pairs already drilled today step aside unless they are all there is. Within
 * what is left, a pair sliding backwards wins over a merely slow one: the slow
 * pair is the one the player already knows about, the sliding one is not.
 */
export function recommendNext(stats: readonly PairStat[]): Recommendation | null {
  const withHistory = stats.filter((s) => s.series.length > 0);
  if (withHistory.length === 0) return null;

  const notToday = withHistory.filter((s) => s.today === null);
  const pool = notToday.length ? notToday : withHistory;

  const sliding = pool
    .map((stat) => ({ stat, trend: recentTrend(stat.series) }))
    .filter((entry): entry is { stat: PairStat; trend: Trend } => entry.trend?.direction === 'down')
    .sort((a, b) => (a.trend.percent ?? 0) - (b.trend.percent ?? 0));

  if (sliding.length) return { stat: sliding[0].stat, reason: 'Slipping on your recent runs' };

  const pick = [...pool].sort((a, b) => a.best - b.best)[0];
  return { stat: pick, reason: pick.today === null ? 'Not drilled today' : 'Your slowest pair' };
}
