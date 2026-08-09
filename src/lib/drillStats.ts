// Pure data functions only: no React, no store. The hook that feeds them lives
// in hooks/useDrillStats.ts. Keeping them separable is what lets these be run
// against a real exported history without booting the app.
import { parsePairKey } from './pairs';
import { DRILL_UNIT, TASK_KEYED_KINDS } from './drills';
import type { DailyLog, Routine } from '../types';

export interface DrillHistory {
  best: number; // personal best across all days
  series: number[]; // chronological, one point per day
}

// History for a drill stored under its task id (e.g. Chord Perfect's placement
// count), oldest first. The chord-changes drill is keyed by pair instead — see
// pairs.ts.
export function taskDrillHistory(
  dailyLogs: Record<string, DailyLog>,
  taskId: string,
): DrillHistory {
  const points = Object.values(dailyLogs ?? {})
    .filter((l) => typeof l.drillResults?.[taskId] === 'number')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => l.drillResults![taskId]);
  return { best: points.reduce((m, v) => Math.max(m, v), 0), series: points };
}

export interface SeriesPoint {
  date: string;
  value: number;
}

// One measurable thing the player can watch move. Two families share this shape
// so Progress can chart either without knowing which it is holding:
//  - `pair`: a chord change, keyed A↔D, measured in changes per minute;
//  - `task`: a whole drill, keyed by task id, measured in its own unit.
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
export function pairStats(dailyLogs: Record<string, DailyLog>, today: string): PairStat[] {
  const byPair = new Map<string, PairStat>();

  for (const log of Object.values(dailyLogs)) {
    const results = log.drillResults;
    if (!results) continue;
    for (const [key, value] of Object.entries(results)) {
      const pair = parsePairKey(key);
      if (!pair || typeof value !== 'number') continue;
      let stat = byPair.get(key);
      if (!stat) {
        stat = {
          key,
          kind: 'pair',
          label: `${pair.from} ↔ ${pair.to}`,
          unit: DRILL_UNIT['one-minute-changes'],
          from: pair.from,
          to: pair.to,
          best: 0,
          today: null,
          series: [],
        };
        byPair.set(key, stat);
      }
      stat.series.push({ date: log.date, value });
      stat.best = Math.max(stat.best, value);
      if (log.date === today) stat.today = value;
    }
  }

  const stats = [...byPair.values()];
  for (const s of stats) s.series.sort(sortByDate);
  return stats;
}

// Task-keyed drill history: Chord Perfect and the anchor rotation.
//
// These write their result under the task id, and Progress only ever parsed
// chord-pair keys, so two of the four drills produced history that drove tempo
// prescription but was invisible to the person who earned it. The title and
// unit are not stored with the result, so both are resolved from the routines
// as they exist now; a drill whose task has since been deleted is dropped
// rather than shown as an unnamed number.
export function taskStats(
  dailyLogs: Record<string, DailyLog>,
  routines: Routine[],
  today: string,
): DrillStat[] {
  const meta = new Map<string, { label: string; unit: string }>();
  for (const routine of routines) {
    for (const task of routine.tasks) {
      const kind = task.drill?.kind;
      if (!kind || !TASK_KEYED_KINDS.includes(kind)) continue;
      meta.set(task.id, { label: task.title, unit: DRILL_UNIT[kind] });
    }
  }
  if (meta.size === 0) return [];

  const byTask = new Map<string, DrillStat>();
  for (const log of Object.values(dailyLogs)) {
    const results = log.drillResults;
    if (!results) continue;
    for (const [key, value] of Object.entries(results)) {
      const info = meta.get(key);
      if (!info || typeof value !== 'number') continue;
      let stat = byTask.get(key);
      if (!stat) {
        stat = {
          key,
          kind: 'task',
          label: info.label,
          unit: info.unit,
          best: 0,
          today: null,
          series: [],
        };
        byTask.set(key, stat);
      }
      stat.series.push({ date: log.date, value });
      stat.best = Math.max(stat.best, value);
      if (log.date === today) stat.today = value;
    }
  }

  const stats = [...byTask.values()];
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
  routines: Routine[],
  today: string,
): AllDrillStats {
  const pairs = pairStats(dailyLogs, today);
  const tasks = taskStats(dailyLogs, routines, today);
  return { pairs, tasks, any: pairs.length > 0 || tasks.length > 0 };
}

export interface Recommendation {
  stat: PairStat;
  reason: string;
}

// Pick the single pair most worth drilling next. Priority: a pair not yet
// practiced today, then the weakest by personal best. Returns null with no data.
export function recommendNext(stats: PairStat[]): Recommendation | null {
  const withHistory = stats.filter((s) => s.series.length > 0);
  if (withHistory.length === 0) return null;

  const notToday = withHistory.filter((s) => s.today === null);
  const pool = notToday.length ? notToday : withHistory;
  const pick = [...pool].sort((a, b) => a.best - b.best)[0];

  const reason =
    pick.today === null ? 'Not practiced today' : 'Your slowest pair — push it';
  return { stat: pick, reason };
}
