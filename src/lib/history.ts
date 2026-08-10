// Reading a practice day back.
//
// Forty-nine days of logs existed with no way to look at one. The app could tell
// you your best change rate and your streak, but not what you actually did on a
// Tuesday in July, which is the question anyone asks first when they wonder
// whether something is working.

import type { DailyLog, Routine } from '../types';
import { DRILL_UNIT } from './drills';
import { describeDrillKey, isDrillKey } from './drillKeys';

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

interface Labelled {
  label: string;
  unit: string;
}

// A result whose task has since been deleted. Saying so is better than dropping
// the row: the practice happened, and a history that quietly loses days when a
// routine is edited is not a history.
const REMOVED: Labelled = { label: 'A drill since removed', unit: '' };

/**
 * A labeller with the routines' tasks indexed once.
 *
 * Built up front rather than scanned per result: a five-year history holds
 * thousands of results, and looking each one up by walking every task of every
 * routine turned reading the history into a nested loop over data that never
 * changes inside the call.
 *
 * A key that names what was played answers for itself, and is asked first: the
 * task index only knows about keys written under a task id, and a `pool:` or
 * `ring:` number falling through it would be labelled "A drill since removed" on
 * the day it was practised. Task ids stay behind it for the history recorded
 * before drillKeys.ts existed and never aliased.
 */
function makeLabeller(routines: readonly Routine[]): (key: string) => Labelled {
  const byTaskId = new Map<string, Labelled>();
  for (const routine of routines) {
    for (const task of routine.tasks) {
      if (byTaskId.has(task.id)) continue;
      byTaskId.set(task.id, {
        label: task.title,
        unit: task.drill ? DRILL_UNIT[task.drill.kind] : '',
      });
    }
  }
  const drills = new Map<string, Labelled>();
  return (key) => {
    if (isDrillKey(key)) {
      const cached = drills.get(key);
      if (cached) return cached;
      const { label, unit } = describeDrillKey(key);
      const labelled = { label, unit };
      drills.set(key, labelled);
      return labelled;
    }
    return byTaskId.get(key) ?? REMOVED;
  };
}

/** A drill key as something a person would recognise. */
export function labelForKey(key: string, routines: readonly Routine[]): Labelled {
  return makeLabeller(routines)(key);
}

// One formatter, reused. `toLocaleDateString` builds an Intl formatter on every
// call, and at one call per practised day that was the single most expensive
// thing about opening the history.
let dateFormatter: Intl.DateTimeFormat | null = null;
const formatDate = (date: string): string => {
  dateFormatter ??= new Intl.DateTimeFormat(undefined, LABEL_FORMAT);
  return dateFormatter.format(new Date(`${date}T12:00:00`));
};

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
  const labelFor = makeLabeller(routines);
  const routineById = new Map(routines.map((r) => [r.id, r] as const));

  for (const date of dates) {
    const log = dailyLogs[date];
    if (!log) continue;
    const routine = routineById.get(log.routineId) ?? null;
    const results: HistoryResult[] = [];

    for (const [key, value] of Object.entries(log.drillResults ?? {})) {
      if (!Number.isFinite(value) || value <= 0) continue;
      const { label, unit } = labelFor(key);
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

    // Routines are read as they stand now, so an edited routine can claim fewer
    // tasks than the day actually completed. "5 of 3 done" is not a fact about
    // that day, so the comparison is dropped rather than repaired. An empty
    // routine goes the same way: it planned nothing, and "0 of 0 done" is not a
    // report of a day, it is what a missing denominator looks like when nobody
    // checked. The day still says what it did, above.
    const taskCount = routine?.tasks.length ?? null;
    const planned =
      taskCount !== null && taskCount > 0 && completed <= taskCount ? taskCount : null;

    days.push({
      date,
      label: formatDate(date),
      routineName: routine?.name ?? null,
      completed,
      planned,
      results,
      feedback: log.feedback?.trim() || null,
      bests: results.filter((r) => r.isBest).length,
    });
  }

  return days.reverse();
}

/** The Monday of the week a date falls in, as an ISO date. Stable week key. */
function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function weekAfter(monday: string): string {
  const d = new Date(`${monday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

export interface WeekTotal {
  week: string;
  count: number;
}

/**
 * Practice days per week, for half a year at a glance.
 *
 * Weeks with no practice are emitted as zeros rather than skipped. Skipping
 * them compressed time: a month away drew as no gap at all, so a run of
 * practice that was broken read as unbroken, which is the one thing this chart
 * exists to tell the truth about.
 *
 * `through` is any date in the week the caller considers "now". Without it the
 * series stops at the last week practised, and someone who put the guitar down
 * three weeks ago would see a chart that ends on a full bar.
 */
export function weeklyTotals(days: readonly HistoryDay[], through?: string): WeekTotal[] {
  const weeks = new Map<string, number>();
  for (const day of days) {
    const key = mondayOf(day.date);
    weeks.set(key, (weeks.get(key) ?? 0) + 1);
  }
  if (weeks.size === 0) return [];

  const keys = [...weeks.keys()].sort();
  const first = keys[0];
  const lastPractised = keys[keys.length - 1];
  const end = through ? [mondayOf(through), lastPractised].sort()[1] : lastPractised;

  const totals: WeekTotal[] = [];
  for (let week = first; week <= end; week = weekAfter(week)) {
    totals.push({ week, count: weeks.get(week) ?? 0 });
  }
  return totals;
}
