// One task, one exercise.
//
// A task used to be able to bundle several pieces of work. A changes task over
// three chords ran as three separate pairs, and a timed task could hold several
// blocks, each a different strumming pattern. That made it impossible to
// practise one set of changes on its own: the only way in was the whole task.
//
// So a task is now atomic, and this file is the one place that says what that
// means and how an older, bundled task becomes several. It runs on every door a
// task comes in through (the store's writes, the routine builder, a routine
// arriving from the cloud), so nothing combined survives into a routine.
//
// Two things make the migration safe to run anywhere, any number of times:
//
//   - Part ids are derived, not random: `${task.id}:${from}>${to}` for a pair
//     and `${task.id}:${block.id}` for a block. Two devices splitting the same
//     routine agree on every id without talking to each other, and running the
//     split twice is the split once.
//   - The split is recorded as parent id -> part ids, append-only. A day that
//     completed the combined task completed every part of it; that is read
//     through this map rather than written back into old days, which stay
//     exactly as they were recorded.

import type { DailyLog, Routine, Task, TaskRecord } from '../types';
import { chordPairs, routineChords } from './pairs';

/** Parent task id -> the ids of the parts it was split into. */
export type TaskSplits = Record<string, string[]>;

type Pair = { from: string; to: string };

/** The pairs a changes task drills, exactly as the coached session reads them. */
function pairsOf(task: Task, routine: Routine | undefined): Pair[] {
  const drill = task.drill;
  if (drill?.kind !== 'one-minute-changes') return [];
  const explicit = drill.pairs?.filter((p) => p.from && p.to && p.from !== p.to);
  if (explicit?.length) return explicit;
  const chords = drill.chords?.length
    ? drill.chords
    : drill.chordFrom && drill.chordTo
      ? [drill.chordFrom, drill.chordTo]
      : routineChords(routine);
  return chordPairs(chords);
}

/** Whether a task holds more than one exercise. */
export function isCombined(task: Task, routine?: Routine): boolean {
  if (task.drill?.kind === 'one-minute-changes') return pairsOf(task, routine).length > 1;
  if (!task.drill && (task.blocks?.length ?? 0) > 1) return true;
  return false;
}

/**
 * The atomic tasks a task is made of. An atomic task comes back as itself, in a
 * list of one, so the caller can tell nothing happened by identity.
 */
export function splitTask(task: Task, routine?: Routine): Task[] {
  if (!isCombined(task, routine)) return [task];
  const group = task.group ?? { id: task.id, title: task.title };

  if (task.drill?.kind === 'one-minute-changes') {
    const seconds = task.drill.durationSec ?? 60;
    return pairsOf(task, routine).map(({ from, to }) => {
      const part: Task = {
        id: `${task.id}:${from}>${to}`,
        title: `${group.title} · ${from} ↔ ${to}`,
        drill: {
          kind: 'one-minute-changes',
          durationSec: seconds,
          chords: [from, to],
          pairs: [{ from, to }],
        },
        group,
      };
      if (task.description) part.description = task.description;
      // A stated duration was the whole task's; each part is one pair now.
      if (task.duration) part.duration = String(Math.max(1, Math.round(seconds / 60)));
      if (task.bpm !== undefined) part.bpm = task.bpm;
      return part;
    });
  }

  // A multi-block timer. Each block becomes a one-block task, which keeps its
  // seconds, pattern, note and tempo exactly; a plain task has room for none.
  return (task.blocks ?? []).map((block) => {
    const part: Task = {
      id: `${task.id}:${block.id}`,
      title: block.label,
      blocks: [block.bpm === undefined && task.bpm !== undefined ? { ...block, bpm: task.bpm } : block],
      group,
    };
    if (task.description) part.description = task.description;
    return part;
  });
}

/**
 * Split every combined task in a routine, in place of the task it replaces.
 *
 * Returns the routine itself when nothing needed splitting, so a caller can
 * skip a write (and a sync) on the overwhelmingly common no-op.
 */
export function splitRoutine(routine: Routine): { routine: Routine; splits: TaskSplits } {
  const splits: TaskSplits = {};
  let changed = false;
  const tasks: Task[] = [];
  for (const task of routine.tasks) {
    const parts = splitTask(task, routine);
    if (parts.length === 1 && parts[0] === task) {
      tasks.push(task);
      continue;
    }
    changed = true;
    splits[task.id] = parts.map((p) => p.id);
    tasks.push(...parts);
  }
  return { routine: changed ? { ...routine, tasks } : routine, splits };
}

/**
 * Split every routine, folding what was split into the map already held.
 *
 * Both the list and the map keep their identity when there was nothing to do.
 */
export function splitRoutines(
  routines: readonly Routine[],
  existing: TaskSplits | undefined,
): { routines: Routine[]; splits: TaskSplits | undefined } {
  let changed = false;
  let splits = existing;
  const next = routines.map((r) => {
    const out = splitRoutine(r);
    if (out.routine === r) return r;
    changed = true;
    splits = mergeTaskSplits(splits, out.splits);
    return out.routine;
  });
  return { routines: changed ? next : (routines as Routine[]), splits };
}

/**
 * Union of two split maps. An entry is never overwritten: the first record of
 * what a task became is the one its old days were completed against.
 */
export function mergeTaskSplits(
  a: TaskSplits | undefined,
  b: TaskSplits | undefined,
): TaskSplits | undefined {
  if (!b) return a;
  if (!a) return b;
  let out: TaskSplits | undefined;
  for (const [id, parts] of Object.entries(b)) {
    if (a[id] !== undefined) continue;
    out ??= { ...a };
    out[id] = parts;
  }
  return out ?? a;
}

/**
 * Every task id a day counts as done, with each completed combined task
 * standing for all of its parts (and their parts, if a part was split again).
 */
export function completedSet(log: DailyLog | undefined, splits: TaskSplits | undefined): Set<string> {
  const done = new Set(log?.completedTaskIds ?? []);
  if (!splits) return done;
  const queue = [...done];
  while (queue.length) {
    const id = queue.pop() as string;
    for (const part of splits[id] ?? []) {
      if (done.has(part)) continue;
      done.add(part);
      queue.push(part);
    }
  }
  return done;
}

export function isTaskDone(log: DailyLog | undefined, taskId: string, splits: TaskSplits | undefined): boolean {
  if (log?.completedTaskIds.includes(taskId)) return true;
  if (!splits) return false;
  return completedSet(log, splits).has(taskId);
}

/**
 * How many tasks a day completed, counting each completed combined task as the
 * parts it now is. A day recorded after the split counts exactly as it did.
 */
export function completedCount(log: DailyLog | undefined, splits: TaskSplits | undefined): number {
  if (!splits) return log?.completedTaskIds.length ?? 0;
  let n = 0;
  for (const id of completedSet(log, splits)) if (!splits[id]) n += 1;
  return n;
}

/**
 * The record a task has for a day, falling back to the combined task it was
 * split out of. Only ever reached on the day of the split: from then on, every
 * run is recorded against the part that ran.
 */
export function recordThroughSplit(
  log: DailyLog | undefined,
  taskId: string,
  splits: TaskSplits | undefined,
): TaskRecord | undefined {
  const own = log?.taskRecords?.[taskId];
  if (own || !splits || !log?.taskRecords) return own;
  for (const [parent, parts] of Object.entries(splits)) {
    if (parts.includes(taskId)) return recordThroughSplit(log, parent, splits);
  }
  return undefined;
}
