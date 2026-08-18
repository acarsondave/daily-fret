// What is kept, and what goes.
//
// Two things are unacceptable here and they pull in opposite directions.
// Unbounded growth is unacceptable: a gigabyte a week of practice footage will
// fill a laptop and the app will have done it without ever mentioning it.
// Silent deletion is equally unacceptable: footage of your own hands is not a
// cache, and an app that throws it away without saying so is one you stop
// trusting with anything.
//
// The limit used to be counted in sessions alone, and a session is not a size.
// One coached run of a routine is one session however long it runs, so at the
// standard preset's 11.4 MB a minute a thirty-minute routine is about 340 MB in
// a single slot, and the default of eight slots was roughly 2.7 GB before the
// first prune could possibly fire. Measured on the owner's own disk: 1.0 GB of
// footage while the index believed it was holding two sessions.
//
// So the budget is bytes, because bytes are what fill a disk. The session count
// stays as a second bound, because "I do not want a month of old takes" is a
// real preference that has nothing to do with size, and whichever bites first
// wins. Technique checks get a bounded pool rather than the permanent exemption
// they had, which was a leak with no prune path at all. Starring is still
// absolute: it is the user's own word, and no limit here outranks it.
//
// Pure on purpose. Deciding what to delete is exactly the logic that must be
// testable without a browser, a camera or a disk.

import { BYTES_PER_MB, megabytesPerMinute } from './quality';
import type { PruneEvent, Recording, RecordingQuality } from './types';

export const MIN_KEEP_SESSIONS = 3;
export const MAX_KEEP_SESSIONS = 30;
/**
 * Eight sessions is roughly a week and a half of daily practice, which is the
 * span over which "am I still doing that thing with my thumb" is a question
 * anyone actually asks. Beyond that the footage is history, not feedback.
 */
export const DEFAULT_KEEP_SESSIONS = 8;

/**
 * The budget, in bytes.
 *
 * The floor is a real amount of footage rather than a token: below about a
 * quarter of a gigabyte a single long session cannot be kept whole, and a limit
 * that deletes what was just filmed is worse than no recording at all. The
 * ceiling exists so that a slip on a stepper cannot quietly commit ten per cent
 * of a laptop.
 */
export const MIN_KEEP_BYTES = 250 * BYTES_PER_MB;
export const MAX_KEEP_BYTES = 10 * 1024 * BYTES_PER_MB;
/**
 * A gigabyte and a half: about two and a quarter hours at the standard preset,
 * which is a fortnight of the owner's actual practice, and small enough that a
 * laptop owner would not notice it going missing.
 */
export const DEFAULT_KEEP_BYTES = 1536 * BYTES_PER_MB;

/**
 * How many technique checks are exempt from the budget.
 *
 * These used to be exempt for ever, on the grounds that they are small, they
 * are the deliberate ones, and a later analysis pass reads them. Two of those
 * three are true; "small" was not. Three angles at seventy-five seconds is about
 * 43 MB a check at the standard preset, they were the only clips with no prune
 * path of any kind, and footage nothing can ever delete is not a retention
 * policy. Four checks is enough to compare this month against last month, and
 * anything worth more than that gets starred.
 */
export const TECHNIQUE_POOL = 4;

/**
 * The budgets offered, smallest first.
 *
 * Three sizes rather than a slider, for the reason the quality presets are three
 * names: nobody holding a guitar wants to have an opinion about megabytes. What
 * makes them a real choice is what each one buys, and that is derived from the
 * encoder's own bitrate at the chosen quality rather than written down here, so
 * the figures move when the quality does.
 */
export const BUDGET_CHOICES: readonly number[] = [
  500 * BYTES_PER_MB,
  DEFAULT_KEEP_BYTES,
  4 * 1024 * BYTES_PER_MB,
];

export function clampKeepSessions(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_KEEP_SESSIONS;
  return Math.min(MAX_KEEP_SESSIONS, Math.max(MIN_KEEP_SESSIONS, Math.round(value)));
}

export function clampKeepBytes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_KEEP_BYTES;
  return Math.min(MAX_KEEP_BYTES, Math.max(MIN_KEEP_BYTES, Math.round(value)));
}

/** Both bounds. Whichever bites first decides. */
export interface RetentionLimits {
  keepSessions: number;
  keepBytes: number;
}

/**
 * A clip nothing is allowed to prune, whatever any limit says.
 *
 * Starring only. It is the user's own word and it outranks policy, which also
 * makes it the answer to every case the pool below is too small for.
 */
export function isProtected(recording: Recording): boolean {
  return recording.starred;
}

/**
 * The technique checks the budget may not touch: the newest {@link TECHNIQUE_POOL}
 * of them, counted as checks rather than clips, because one check is three
 * angles filmed together and half a check is not worth keeping.
 */
export function techniquePool(recordings: readonly Recording[]): Set<string> {
  const checks = new Map<string, { startedAt: number; ids: string[] }>();
  for (const rec of recordings) {
    if (rec.kind !== 'technique-check') continue;
    const seen = checks.get(rec.sessionId);
    if (seen) {
      seen.ids.push(rec.id);
      seen.startedAt = Math.min(seen.startedAt, rec.startedAt);
    } else {
      checks.set(rec.sessionId, { startedAt: rec.startedAt, ids: [rec.id] });
    }
  }
  const newestFirst = [...checks.values()].sort((a, b) => b.startedAt - a.startedAt);
  const pool = new Set<string>();
  for (const check of newestFirst.slice(0, TECHNIQUE_POOL)) {
    for (const id of check.ids) pool.add(id);
  }
  return pool;
}

export interface PruneDecision {
  keep: Recording[];
  drop: Recording[];
  /**
   * Bytes still over the budget once everything prunable has gone, or 0.
   *
   * Never silently ignored: a library of starred clips and technique checks can
   * sit above any budget, and the honest response is to say so rather than to
   * delete something the user said to keep or to pretend the limit was met.
   */
  overBudget: number;
}

/** Clips grouped by the session that filmed them, and when each session began. */
function bySession(recordings: readonly Recording[]): Map<string, Recording[]> {
  const groups = new Map<string, Recording[]>();
  for (const rec of recordings) {
    const group = groups.get(rec.sessionId);
    if (group) group.push(rec);
    else groups.set(rec.sessionId, [rec]);
  }
  return groups;
}

/**
 * Decide which clips survive the retention limits.
 *
 * Sessions are ranked by when they started, newest first, so a long session that
 * began before a short one that finished first is still the older of the two.
 * The count runs first and then the budget, both evicting whole sessions from
 * the oldest end: a session is the unit someone watches, and half of one is an
 * odd thing to be left holding.
 *
 * The count only counts sessions that have something prunable in them. A run of
 * starred sessions therefore cannot push every ordinary session out of the
 * window, which would leave someone who starred a week of practice with no
 * recent footage at all.
 */
export function planPrune(recordings: readonly Recording[], limits: RetentionLimits): PruneDecision {
  const keepSessions = clampKeepSessions(limits.keepSessions);
  const keepBytes = clampKeepBytes(limits.keepBytes);

  const pool = techniquePool(recordings);
  const prunable = (rec: Recording): boolean => !isProtected(rec) && !pool.has(rec.id);

  const groups = bySession(recordings);
  const startedAt = new Map<string, number>();
  for (const [sessionId, clips] of groups) {
    startedAt.set(sessionId, Math.min(...clips.map((c) => c.startedAt)));
  }
  const newestFirst = [...startedAt.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  const doomed = new Set<string>();
  const goingFrom = (sessionId: string): Recording[] =>
    (groups.get(sessionId) ?? []).filter(prunable);

  let counted = 0;
  for (const sessionId of newestFirst) {
    // A session with nothing prunable in it does not spend a slot: it was never
    // at risk, so counting it would evict a session that is.
    if (!goingFrom(sessionId).length) continue;
    counted += 1;
    if (counted > keepSessions) doomed.add(sessionId);
  }

  let held = 0;
  for (const rec of recordings) {
    if (doomed.has(rec.sessionId) && prunable(rec)) continue;
    held += rec.bytes;
  }

  // Then the budget, oldest end first, over whatever the count left standing.
  //
  // The newest session in the library is never one of them. A budget smaller
  // than a single long session would otherwise delete the run that had just been
  // filmed, which is the one piece of footage the player is certain to want, and
  // it would do it in the same breath as filing it. The shortfall is reported
  // instead, and the pane says so.
  const newest = newestFirst[0];
  for (let i = newestFirst.length - 1; i >= 0 && held > keepBytes; i -= 1) {
    const sessionId = newestFirst[i];
    if (sessionId === newest) continue;
    if (doomed.has(sessionId)) continue;
    const going = goingFrom(sessionId);
    if (!going.length) continue;
    doomed.add(sessionId);
    for (const rec of going) held -= rec.bytes;
  }

  const keep: Recording[] = [];
  const drop: Recording[] = [];
  for (const rec of recordings) {
    if (doomed.has(rec.sessionId) && prunable(rec)) drop.push(rec);
    else keep.push(rec);
  }
  return { keep, drop, overBudget: Math.max(0, held - keepBytes) };
}

/** The line the settings pane reads back, so a prune is never invisible. */
export function pruneEvent(dropped: readonly Recording[], at: number): PruneEvent | null {
  if (!dropped.length) return null;
  return {
    at,
    clips: dropped.length,
    bytes: dropped.reduce((sum, r) => sum + r.bytes, 0),
  };
}

export function totalBytes(recordings: readonly Recording[]): number {
  return recordings.reduce((sum, r) => sum + r.bytes, 0);
}

/** Distinct practice sessions the library holds, newest first. */
export function sessionCount(recordings: readonly Recording[]): number {
  return new Set(recordings.map((r) => r.sessionId)).size;
}

/**
 * What a budget buys, in minutes of footage at a given quality.
 *
 * Derived from the encoder's own bitrates in ./quality.ts rather than from a
 * number typed into the interface, so the price quoted before the spending is
 * the price actually charged.
 */
export function minutesInBudget(bytes: number, quality: RecordingQuality): number {
  return bytes / BYTES_PER_MB / megabytesPerMinute(quality);
}

/**
 * How long the player's sessions actually run, in minutes, or null before there
 * is anything to go on.
 *
 * The median rather than the mean: one session left recording while its owner
 * answered the door would otherwise set the expectation for all of them.
 */
export function typicalSessionMinutes(recordings: readonly Recording[]): number | null {
  const perSession = new Map<string, number>();
  for (const rec of recordings) {
    if (rec.kind !== 'session') continue;
    perSession.set(rec.sessionId, (perSession.get(rec.sessionId) ?? 0) + rec.durationMs);
  }
  if (perSession.size === 0) return null;
  const sorted = [...perSession.values()].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const ms = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return ms / 60_000;
}
