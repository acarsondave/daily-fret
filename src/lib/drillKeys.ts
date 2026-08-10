// What a stored drill result is a result *of*.
//
// Every number in a day's `drillResults` needs a key, and for two of the four
// drills that key used to be the id of the task the drill was launched from. A
// task id names a row in a list. Rename the row, rebuild the routine, or
// generate a new one, and every number underneath it stops belonging to
// anything: Progress cannot find it, the tempo prescription reads an empty
// history and starts the player over, and months of practice quietly leave the
// app. Chord changes never had the problem, because `pair:A|D` names the thing
// that was played rather than the place it was played from.
//
// So every key states what was played:
//
//   pair:A|D        two chords, changed between (src/lib/pairs.ts)
//   chord:F         one shape, placed from nothing
//   pool:A|C|D|E|G  one Chord Perfect block, scored across the pool it drilled
//   ring:A>E>D      one turn of an anchor rotation
//
// A key with no prefix is a result written before this existed, under a task id.
// Those are never rewritten. They are read through `resolveDrillLogs`, which
// leaves the stored day exactly as it was recorded.

import type { DailyLog, DrillRun, Routine, Task } from '../types';
import { DRILL_UNIT } from './drills';
import { PAIR_PREFIX, parsePairKey } from './pairs';

export const CHORD_PREFIX = 'chord:';
export const POOL_PREFIX = 'pool:';
export const RING_PREFIX = 'ring:';

const POOL_SEP = '|';
const RING_SEP = '>';

/** Chord Perfect's pool when a task never said which shapes to drill. */
export const DEFAULT_TRAINER_POOL = ['A', 'D', 'E', 'G', 'C'];
/** The classic anchor ring, for a rotation with no ring of its own. */
export const DEFAULT_ROTATION_RING = ['D', 'A', 'E'];

/** One shape, placed and released. */
export function chordKey(chord: string): string {
  return `${CHORD_PREFIX}${chord}`;
}

export function parseChordKey(key: string): string | null {
  if (!key.startsWith(CHORD_PREFIX)) return null;
  return key.slice(CHORD_PREFIX.length) || null;
}

/**
 * A Chord Perfect block, named by the shapes it drilled.
 *
 * Sorted and de-duplicated, because the pool is a set: the order the blocks
 * happened to run in is not a property of the practice, and two sessions over
 * the same five shapes are the same drill either way. Pool membership *is* a
 * property of it, though, and deliberately part of the key: the score is every
 * placement in the block, so a six-shape session and a five-shape session are
 * not comparable numbers and must not share a series.
 */
export function poolKey(chords: readonly string[]): string {
  return `${POOL_PREFIX}${[...new Set(chords)].sort().join(POOL_SEP)}`;
}

export function parsePoolKey(key: string): string[] | null {
  if (!key.startsWith(POOL_PREFIX)) return null;
  const chords = key.slice(POOL_PREFIX.length).split(POOL_SEP).filter(Boolean);
  return chords.length ? chords : null;
}

/**
 * The lexicographically smallest rotation of a cycle.
 *
 * A rotation is a loop, so D→A→E and A→E→D are the same practice started at a
 * different point and have to land on the same key. Reversing it is not: E→A→D
 * is a different set of moves for the hand, and it keeps its own key.
 */
function canonicalRing(chords: readonly string[]): string[] {
  let best = [...chords];
  let bestJoined = best.join(RING_SEP);
  for (let i = 1; i < chords.length; i += 1) {
    const rotated = [...chords.slice(i), ...chords.slice(0, i)];
    const joined = rotated.join(RING_SEP);
    if (joined < bestJoined) {
      best = rotated;
      bestJoined = joined;
    }
  }
  return best;
}

export function ringKey(chords: readonly string[]): string {
  return `${RING_PREFIX}${canonicalRing(chords).join(RING_SEP)}`;
}

export function parseRingKey(key: string): string[] | null {
  if (!key.startsWith(RING_PREFIX)) return null;
  const chords = key.slice(RING_PREFIX.length).split(RING_SEP).filter(Boolean);
  return chords.length ? chords : null;
}

/** The shapes a Chord Perfect block will drill, config first. */
export function trainerPool(chords: readonly string[] | undefined): string[] {
  return chords?.length ? [...new Set(chords)] : [...DEFAULT_TRAINER_POOL];
}

/** The ring a rotation will cycle. Two chords is the least that can rotate. */
export function rotationRing(chords: readonly string[] | undefined): string[] {
  return chords && chords.length >= 2 ? [...chords] : [...DEFAULT_ROTATION_RING];
}

export type DrillKeyKind = 'pair' | 'chord' | 'pool' | 'ring' | 'retired';

export interface DrillKeyDescription {
  kind: DrillKeyKind;
  /** What a person would call it. */
  label: string;
  /** What the number counts. Empty where the app no longer knows. */
  unit: string;
}

// A number whose key names a task the app can no longer find. Saying so is
// better than dropping the row: the practice happened, and a history that
// quietly loses days when a routine is edited is not a history. The wording
// matches src/lib/history.ts, which has said this about the same situation
// since before the keys were fixed.
const RETIRED: DrillKeyDescription = {
  kind: 'retired',
  label: 'A drill since removed',
  unit: '',
};

/**
 * A stored key as something a person would recognise.
 *
 * The labels name the shapes and nothing else. Spelling the drill out
 * ("Chord Perfect · A C D E G") truncated to "Chord Perfe..." in a Progress row
 * on a phone, which is the drill's name at the cost of the only part that says
 * what was played. Which drill it was is already carried by the separator and by
 * the unit sitting beside the number: shapes placed across a pool, changes
 * around a ring, changes a minute between a pair.
 */
export function describeDrillKey(key: string): DrillKeyDescription {
  const pair = parsePairKey(key);
  if (pair) {
    return {
      kind: 'pair',
      label: `${pair.from} ↔ ${pair.to}`,
      unit: DRILL_UNIT['one-minute-changes'],
    };
  }
  const chord = parseChordKey(key);
  if (chord) {
    return { kind: 'chord', label: `${chord} shape`, unit: DRILL_UNIT['chord-trainer'] };
  }
  const pool = parsePoolKey(key);
  if (pool) {
    return { kind: 'pool', label: pool.join(' '), unit: DRILL_UNIT['chord-trainer'] };
  }
  const ring = parseRingKey(key);
  if (ring) {
    return { kind: 'ring', label: ring.join(' → '), unit: DRILL_UNIT['chord-rotation'] };
  }
  return RETIRED;
}

/** Whether a key names a drill at all, or a task id from before these existed. */
export const isDrillKey = (key: string): boolean =>
  key.startsWith(PAIR_PREFIX) ||
  key.startsWith(CHORD_PREFIX) ||
  key.startsWith(POOL_PREFIX) ||
  key.startsWith(RING_PREFIX);

/**
 * The key a task's *score* is written under, or null when it has no single one.
 *
 * Only the two drills that used to key by task id have one: a changes task fans
 * out into a key per pair, and a song or a timed block is never measured.
 *
 * Deliberately refuses a drill with no chords of its own. A pool has to be
 * guessed for one of those, and a guessed key would file real numbers against a
 * set of shapes that may never have been played. Every door that creates one of
 * these tasks writes its chords, so this is a legacy shape rather than a case.
 */
export function sessionKeyForTask(task: Task): string | null {
  const drill = task.drill;
  if (!drill?.chords?.length) return null;
  if (drill.kind === 'chord-trainer') return poolKey(drill.chords);
  if (drill.kind === 'chord-rotation') return ringKey(drill.chords);
  return null;
}

/**
 * What each task id used to mean, captured while the tasks are still here.
 *
 * This is the whole migration. The routines as they stand are the only thing
 * that can still connect a task id to the drill whose numbers were filed under
 * it, and that connection is gone the moment the task is renamed away, rebuilt
 * or regenerated. So it is snapshotted the first time this build sees the
 * routines, and after that it is append-only: an entry is never overwritten,
 * because a task whose chords were edited afterwards was not the task the old
 * numbers were played on.
 *
 * Returns `existing` unchanged when there is nothing new, so a caller can tell
 * a real capture from a no-op by identity and skip the write.
 */
export function captureDrillKeyAliases(
  routines: readonly Routine[],
  existing: Record<string, string> | undefined,
): Record<string, string> | undefined {
  let next: Record<string, string> | undefined;
  for (const routine of routines) {
    for (const task of routine.tasks) {
      if (existing?.[task.id] !== undefined || next?.[task.id] !== undefined) continue;
      const key = sessionKeyForTask(task);
      if (!key) continue;
      next ??= { ...existing };
      next[task.id] = key;
    }
  }
  return next ?? existing;
}

/**
 * Two alias maps folded into one, losing nothing.
 *
 * Devices capture independently, so the cloud copy and the local one can each
 * hold entries the other has never seen. An alias is a statement about a task
 * that has already been practised, so the older claim is the one to keep and a
 * union is the only merge that cannot drop a task id.
 */
export function mergeDrillKeyAliases(
  local: Record<string, string> | undefined,
  remote: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!remote) return local;
  if (!local) return remote;
  let merged: Record<string, string> | undefined;
  for (const [taskId, key] of Object.entries(remote)) {
    if (local[taskId] !== undefined) continue;
    merged ??= { ...local };
    merged[taskId] = key;
  }
  return merged ?? local;
}

// One resolved copy per (logs, aliases) pair. The resolution is a read adapter
// over the whole history, so recomputing it per render would fold months of
// logs on every keystroke elsewhere; caching on the two input references also
// keeps the result referentially stable, which is what the memoised hooks
// downstream are counting on.
const resolvedCache = new WeakMap<
  Record<string, DailyLog>,
  { aliases: Record<string, string>; logs: Record<string, DailyLog> }
>();

function resolveLog(log: DailyLog, aliases: Record<string, string>): DailyLog {
  const results = log.drillResults;
  const runs = log.drillRuns;
  const touches =
    (results !== undefined && Object.keys(results).some((k) => aliases[k] !== undefined)) ||
    (runs !== undefined && Object.keys(runs).some((k) => aliases[k] !== undefined));
  if (!touches) return log;

  const next: DailyLog = { ...log };
  if (results) {
    const moved: Record<string, number> = {};
    for (const [key, value] of Object.entries(results)) {
      const to = aliases[key] ?? key;
      const have = moved[to];
      // A day can hold both an old task-keyed number and a new one, on the day
      // the keys changed under someone mid-practice. The day's best is what
      // this field has always meant, so that is what survives the move.
      moved[to] = have === undefined ? value : Math.max(have, value);
    }
    next.drillResults = moved;
  }
  if (runs) {
    const moved: Record<string, DrillRun[]> = {};
    for (const [key, list] of Object.entries(runs)) {
      const to = aliases[key] ?? key;
      const have = moved[to];
      moved[to] = have === undefined ? list : [...have, ...list];
    }
    next.drillRuns = moved;
  }
  return next;
}

/**
 * The practice logs as today's key vocabulary reads them.
 *
 * Nothing is written. The stored day is byte-identical to the day it was
 * recorded, which is what lets the owner's other device keep opening it on an
 * older build while this one is rolling out, and what makes the whole migration
 * reversible: if an alias were ever wrong, the numbers it moved are still
 * sitting under the key they were written with.
 */
export function resolveDrillLogs(
  dailyLogs: Record<string, DailyLog>,
  aliases: Record<string, string> | undefined,
): Record<string, DailyLog> {
  if (!aliases || Object.keys(aliases).length === 0) return dailyLogs;
  const cached = resolvedCache.get(dailyLogs);
  if (cached && cached.aliases === aliases) return cached.logs;

  let changed = false;
  const out: Record<string, DailyLog> = {};
  for (const [date, log] of Object.entries(dailyLogs)) {
    const resolved = resolveLog(log, aliases);
    if (resolved !== log) changed = true;
    out[date] = resolved;
  }
  const logs = changed ? out : dailyLogs;
  resolvedCache.set(dailyLogs, { aliases, logs });
  return logs;
}
