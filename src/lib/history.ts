// Reading a practice day back.
//
// Forty-nine days of logs existed with no way to look at one. The app could tell
// you your best change rate and your streak, but not what you actually did on a
// Tuesday in July, which is the question anyone asks first when they wonder
// whether something is working.

import type { DailyLog, Routine } from '../types';
import { DRILL_UNIT } from './drills';
import { parsePairKey } from './pairs';

export interface HistoryResult {
  key: string;
  label: string;
  value: number;
  unit: string;
  /** Best on this drill before today, so a day can say what it beat. */
  previousBest: number | null;
  isBest: boolean;
}

export interface HistoryDay {
  date: string;
  /** Human date, computed once per day rather than per render. */
  label: string;
  routineName: string | null;
  completed: number;
  planned: number | null;
  results: HistoryResult[];
  feedback: string | null;
  bests: number;
}

const LABEL_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
};

/** A drill key as something a person would recognise. */
export function labelForKey(key: string, routines: readonly Routine[]): { label: string; unit: string } {
  const pair = parsePairKey(key);
  if (pair) return { label: `${pair.from} to ${pair.to}`, unit: DRILL_UNIT['one-minute-changes'] };
  for (const routine of routines) {
    const task = routine.tasks.find((t) => t.id === key);
    if (task) {
      return {
        label: task.title,
        unit: task.drill ? DRILL_UNIT[task.drill.kind] : '',
      };
    }
  }
  // A result whose task has since been deleted. Saying so is better than
  // dropping the row: the practice happened, and a history that quietly loses
  // days when a routine is edited is not a history.
  return { label: 'A drill since removed', unit: '' };
}

/**
 * The practice history, newest first.
 *
 * Personal bests are resolved by replaying forward, because "was this a best"
 * can only be answered against what came before it.
 */
export function buildHistory(
  dailyLogs: Record<string, DailyLog>,
  routines: readonly Routine[],
): HistoryDay[] {
  const dates = Object.keys(dailyLogs).sort();
  const best = new Map<string, number>();
  const days: HistoryDay[] = [];

  for (const date of dates) {
    const log = dailyLogs[date];
    if (!log) continue;
    const routine = routines.find((r) => r.id === log.routineId) ?? null;
    const results: HistoryResult[] = [];

    for (const [key, value] of Object.entries(log.drillResults ?? {})) {
      if (!Number.isFinite(value) || value <= 0) continue;
      const { label, unit } = labelForKey(key, routines);
      const previousBest = best.get(key) ?? null;
      const isBest = previousBest !== null && value > previousBest;
      results.push({ key, label, value, unit, previousBest, isBest });
      if (previousBest === null || value > previousBest) best.set(key, value);
    }

    results.sort((a, b) => b.value - a.value);

    // A day with no drill results and no completions is not a practice day; it
    // is a log entry the app created for some other reason, and listing it as
    // practice would pad the history.
    const completed = log.completedTaskIds?.length ?? 0;
    if (!results.length && !completed && !log.feedback) continue;

    days.push({
      date,
      label: new Date(`${date}T12:00:00`).toLocaleDateString(undefined, LABEL_FORMAT),
      routineName: routine?.name ?? null,
      completed,
      planned: routine?.tasks.length ?? null,
      results,
      feedback: log.feedback?.trim() || null,
      bests: results.filter((r) => r.isBest).length,
    });
  }

  return days.reverse();
}

/** Practice days per week, for a year at a glance. */
export function weeklyTotals(days: readonly HistoryDay[]): Array<{ week: string; count: number }> {
  const weeks = new Map<string, number>();
  for (const day of days) {
    const d = new Date(`${day.date}T12:00:00Z`);
    // ISO-ish: shift to the Monday of that week so the key is stable.
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, (weeks.get(key) ?? 0) + 1);
  }
  return [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, count]) => ({ week, count }));
}
