// How a task comes to be recorded as done.
//
// The app listens to a guitar, times drills and counts what was played. Asking
// the player to then confirm they practised is the app admitting it was not
// paying attention, and it is the one place the product's honesty leaked: a
// completion someone asserts is not evidence, but everything downstream
// (streaks, points, prescribed tempo) treated it as if it were.
//
// So completion follows from what happened, and these are the rules that decide
// it. They are pure functions over a single day's log so they can be tested
// against real shapes without booting the app, and so there is exactly one
// definition of "done" rather than one per call site.
//
// The two facts are kept apart on purpose:
//   - `completedTaskIds` says whether the task counts as done today. It is the
//     same field it has always been, so every existing reader still works.
//   - `taskRecords[taskId]` says how that came about. Absent means the app has
//     nothing of its own to say, which is what an older log looks like.

import type { DailyLog, DrillRun, TaskEvidence, TaskRecord } from '../types';

/**
 * A safety bound on runs kept per drill per day, not a policy.
 *
 * Ninety seconds a run puts a genuinely long day at a couple of dozen; this only
 * catches a loop writing thousands. If it is ever hit, the most recent runs are
 * the ones worth keeping, because consistency is a question about now.
 */
const MAX_RUNS_PER_KEY = 50;

// Evidence only ever gets stronger through a day. A drill run twice, the second
// time into a dead microphone, still happened the first time.
const STRENGTH: Record<TaskEvidence, number> = { silent: 1, timed: 2, measured: 3 };

export function blankLog(date: string, routineId: string): DailyLog {
  return { date, routineId, completedTaskIds: [] };
}

export function recordFor(log: DailyLog | undefined, taskId: string): TaskRecord | undefined {
  return log?.taskRecords?.[taskId];
}

export function isComplete(log: DailyLog | undefined, taskId: string): boolean {
  return log?.completedTaskIds.includes(taskId) ?? false;
}

function strongest(current: TaskEvidence | undefined, next: TaskEvidence): TaskEvidence {
  if (!current) return next;
  return STRENGTH[next] > STRENGTH[current] ? next : current;
}

function withRecord(log: DailyLog, taskId: string, next: TaskRecord): DailyLog {
  return { ...log, taskRecords: { ...log.taskRecords, [taskId]: next } };
}

function withCompletion(log: DailyLog, taskId: string): DailyLog {
  if (log.completedTaskIds.includes(taskId)) return log;
  return { ...log, completedTaskIds: [...log.completedTaskIds, taskId] };
}

/**
 * A drill run ended and reported a number.
 *
 * A result of zero is a failed attempt, not practice. It is recorded as such —
 * so the day can say "this ran and nothing was heard" rather than looking
 * identical to never having opened it — but it is not written into
 * `drillResults`, because a stored zero is a measurement the app never made.
 *
 * Running the same drill again neither replaces nor adds: the run is appended to
 * the day's list and `drillResults` keeps the day's best, which is what every
 * reader of that field has always meant by it. The two answer different
 * questions — "how fast can you do this" and "how consistently" — and only one
 * of them can be answered by a number that has thrown its own inputs away.
 *
 * A run the app could not hear is deliberately not in the list. Nothing there
 * distinguishes a player who played nothing from a microphone that heard
 * nothing, and a zero mixed in with real results would quietly make a run of
 * bad audio look like inconsistent playing.
 */
export function applyMeasurement(
  log: DailyLog,
  taskId: string,
  value: number,
  at: number,
  resultKey?: string,
): DailyLog {
  const previous = recordFor(log, taskId);
  const heard = Number.isFinite(value) && value > 0;
  if (!heard) {
    return withRecord(log, taskId, {
      ...previous,
      evidence: strongest(previous?.evidence, 'silent'),
      at,
    });
  }
  const key = resultKey ?? taskId;
  const best = Math.max(log.drillResults?.[key] ?? 0, value);
  const runs = [...(log.drillRuns?.[key] ?? []), { value, at }].slice(-MAX_RUNS_PER_KEY);
  const measured: DailyLog = {
    ...log,
    drillResults: { ...log.drillResults, [key]: best },
    drillRuns: { ...log.drillRuns, [key]: runs },
  };
  return withRecord(measured, taskId, { ...previous, evidence: 'measured', at });
}

/**
 * Every run of a drill on a day, however that day was recorded.
 *
 * Months of history hold only a day's best, and a best cannot be decomposed back
 * into the runs it came from. Such a day presents as a single run at that value
 * with no time attached, which understates how much was actually played — the
 * conservative direction, and the only one available: claiming three runs
 * because the number looks like a good day would be inventing evidence.
 */
export function runsFor(log: DailyLog | undefined, key: string): DrillRun[] {
  const runs = log?.drillRuns?.[key];
  if (runs) return runs;
  const summary = log?.drillResults?.[key];
  if (typeof summary === 'number' && summary > 0) return [{ value: summary }];
  return [];
}

/**
 * Below this, nothing happened. Opening a task and changing your mind two
 * seconds later is not practice, and a day that says "0:02 so far" against a
 * task is noise dressed up as honesty.
 */
export const MIN_RECORDED_SECONDS = 5;

/** What actually happened in a timed block, as opposed to what was planned. */
export interface TimedOutcome {
  /** Seconds the clock actually ran, pauses excluded. */
  elapsedSeconds: number;
  /** The clock reached zero. */
  reachedEnd: boolean;
  /** Counts as done: the clock ran out, or the player said to count it anyway. */
  done: boolean;
}

/**
 * A timer for this task ran inside the app.
 *
 * This is the honest evidence for the tasks the microphone will never hear — a
 * spider walk, stretches, a strumming pattern. It does not claim the practice
 * was good; it claims the block ran, and for how long, which is a true thing the
 * app can witness and a checkbox is not.
 *
 * `reachedEnd` is what earns the completion. Elapsed seconds are recorded either
 * way, so leaving a block half-way is on the record as exactly that — and a
 * block the player chose to count anyway is filed under their word, not under
 * the clock's.
 */
export function applyTime(
  log: DailyLog,
  taskId: string,
  outcome: TimedOutcome,
  at: number,
): DailyLog {
  const previous = recordFor(log, taskId);
  const spent = Number.isFinite(outcome.elapsedSeconds)
    ? Math.max(0, Math.round(outcome.elapsedSeconds))
    : 0;
  const settledNothing = !outcome.reachedEnd && !outcome.done;
  if (settledNothing && spent < MIN_RECORDED_SECONDS) return log;
  const next: TaskRecord = {
    ...previous,
    evidence: strongest(previous?.evidence, 'timed'),
    seconds: (previous?.seconds ?? 0) + spent,
    ranToEnd: previous?.ranToEnd === true || outcome.reachedEnd,
    at,
  };
  if (outcome.done && !outcome.reachedEnd) next.stated = true;
  return withRecord(log, taskId, next);
}

/**
 * The user said this is done.
 *
 * Automatic does not mean unarguable, so this always exists. It is stored as
 * their word rather than as evidence, and the day's list says so in as many
 * words, because a completion that rests on an assertion has to be readable as
 * one. It does not complete on its own; `settle` does, which is what keeps a
 * counted block from carrying a whole multi-block task with it.
 */
export function applyStated(log: DailyLog, taskId: string, at: number): DailyLog {
  const previous = recordFor(log, taskId);
  return withRecord(log, taskId, { ...previous, stated: true, at });
}

/**
 * The task's last run just ended: decide whether it counts as done.
 *
 * Called by whoever knows a task is finished with for now (the coached session
 * at its final segment, a standalone drill at its last pair). Splitting this
 * from the recording is what lets a multi-pair changes task keep every pair's
 * number while only settling once, and it is idempotent.
 */
export function settle(log: DailyLog, taskId: string): DailyLog {
  const record = recordFor(log, taskId);
  if (!record) return log;
  const earned = record.evidence === 'measured' || record.ranToEnd === true || record.stated === true;
  return earned ? withCompletion(log, taskId) : log;
}

/**
 * Take today's claim back.
 *
 * Deliberately leaves `drillResults` alone. What is being corrected is the claim
 * that the task is done, not the measurement: the app heard what it heard, and
 * chord-change results are keyed by pair rather than by task, so deleting them
 * here would quietly destroy another task's numbers too.
 */
export function clearRecord(log: DailyLog, taskId: string): DailyLog {
  const next: DailyLog = {
    ...log,
    completedTaskIds: log.completedTaskIds.filter((id) => id !== taskId),
  };
  if (!log.taskRecords) return next;
  const records = { ...log.taskRecords };
  delete records[taskId];
  if (Object.keys(records).length) next.taskRecords = records;
  else delete next.taskRecords;
  return next;
}
