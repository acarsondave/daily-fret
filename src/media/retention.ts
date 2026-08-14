// What is kept, and what goes.
//
// Two things are unacceptable here and they pull in opposite directions.
// Unbounded growth is unacceptable: a gigabyte a week of practice footage will
// fill a laptop and the app will have done it without ever mentioning it.
// Silent deletion is equally unacceptable: footage of your own hands is not a
// cache, and an app that throws it away without saying so is one you stop
// trusting with anything.
//
// So: a stated limit, counted in sessions rather than clips, with two absolute
// exemptions, and a record of every prune for the settings pane to read back.
//
// Pure on purpose. Deciding what to delete is exactly the logic that must be
// testable without a browser, a camera or a disk.

import type { PruneEvent, Recording } from './types';

export const MIN_KEEP_SESSIONS = 3;
export const MAX_KEEP_SESSIONS = 30;
/**
 * Eight sessions is roughly a week and a half of daily practice, which is the
 * span over which "am I still doing that thing with my thumb" is a question
 * anyone actually asks. Beyond that the footage is history, not feedback.
 */
export const DEFAULT_KEEP_SESSIONS = 8;

export function clampKeepSessions(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_KEEP_SESSIONS;
  return Math.min(MAX_KEEP_SESSIONS, Math.max(MIN_KEEP_SESSIONS, Math.round(value)));
}

/**
 * A clip nothing is allowed to prune.
 *
 * Starred is the user's own word and outranks any policy. Technique checks are
 * exempt in their own right rather than only because they are starred by
 * default: they are small, they are the deliberate ones, and they are what a
 * later analysis pass reads, so a player who unstars one has changed their mind
 * about a favourite, not asked for it to be swept up by a retention count.
 */
export function isProtected(recording: Recording): boolean {
  return recording.starred || recording.kind === 'technique-check';
}

export interface PruneDecision {
  keep: Recording[];
  drop: Recording[];
}

/**
 * Decide which clips survive a retention limit of `keepSessions` practice
 * sessions.
 *
 * Sessions are ranked by when they started, newest first, and the limit counts
 * unprotected sessions only. A run of starred sessions therefore cannot push
 * every ordinary session out of the window, which would leave someone who
 * starred a week of practice with no recent footage at all.
 */
export function planPrune(recordings: readonly Recording[], keepSessions: number): PruneDecision {
  const limit = clampKeepSessions(keepSessions);

  // When a session last recorded anything, so a long session that started
  // before a short one that finished first is still ordered by its own start.
  const startedAt = new Map<string, number>();
  for (const rec of recordings) {
    const seen = startedAt.get(rec.sessionId);
    if (seen === undefined || rec.startedAt < seen) startedAt.set(rec.sessionId, rec.startedAt);
  }

  const newestFirst = [...startedAt.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  const doomed = new Set<string>();
  let counted = 0;
  for (const sessionId of newestFirst) {
    const clips = recordings.filter((r) => r.sessionId === sessionId);
    // A session made entirely of protected clips does not spend a slot: it was
    // never at risk, so counting it would evict a session that is.
    if (clips.every(isProtected)) continue;
    counted += 1;
    if (counted > limit) doomed.add(sessionId);
  }

  const keep: Recording[] = [];
  const drop: Recording[] = [];
  for (const rec of recordings) {
    if (doomed.has(rec.sessionId) && !isProtected(rec)) drop.push(rec);
    else keep.push(rec);
  }
  return { keep, drop };
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
