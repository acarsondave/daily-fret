// Turning a flat list of clips into something a person can look through.
//
// The index is stored newest-first and that is the right order, but a flat list
// of eighty files is not a library. Two shapes come out of here, and they are
// deliberately kept apart rather than merged into one feed:
//
//  - Technique checks, grouped into the sitting that produced them. Three angles
//    filmed one after another are one act of looking at your own hands, and the
//    whole value of them is comparing one sitting against another months later.
//  - Practice sessions, grouped by day and then by the session inside the day,
//    because "what did I do on Tuesday" is the question the history tab already
//    answers in exactly that shape.
//
// Nothing here reads storage or React. It takes rows and returns rows, which is
// what lets the grouping be tested without a browser or a camera.

import type { Recording, RecordingEnd, TechniqueView } from './types';

export interface LibrarySession {
  sessionId: string;
  /** When the first clip of the sitting started. */
  startedAt: number;
  /** YYYY-MM-DD, from the clips themselves. */
  date: string;
  /** What was being practised, or the sitting's own name for a technique check. */
  label: string;
  clips: Recording[];
  totalMs: number;
  totalBytes: number;
  /** True when any clip in the sitting is starred, so the group can say so. */
  starred: boolean;
}

export interface LibraryDay {
  date: string;
  sessions: LibrarySession[];
  totalMs: number;
  totalBytes: number;
}

export interface Library {
  /** Technique sittings, newest first. Never pruned, so this only grows. */
  checks: LibrarySession[];
  /** Practice days, newest first. */
  days: LibraryDay[];
}

const byNewest = (a: { startedAt: number }, b: { startedAt: number }) => b.startedAt - a.startedAt;

/**
 * Collect clips that share a `sessionId` into one sitting.
 *
 * Clips inside a sitting come back oldest-first, because that is the order they
 * were filmed in and the order a technique check's three angles are meant to be
 * watched. The sittings themselves come back newest-first.
 */
function toSessions(clips: readonly Recording[]): LibrarySession[] {
  const bySession = new Map<string, Recording[]>();
  for (const clip of clips) {
    const existing = bySession.get(clip.sessionId);
    if (existing) existing.push(clip);
    else bySession.set(clip.sessionId, [clip]);
  }

  const sessions: LibrarySession[] = [];
  for (const [sessionId, group] of bySession) {
    const ordered = [...group].sort((a, b) => a.startedAt - b.startedAt);
    const first = ordered[0];
    sessions.push({
      sessionId,
      startedAt: first.startedAt,
      date: first.date,
      label: first.label,
      clips: ordered,
      totalMs: ordered.reduce((sum, r) => sum + r.durationMs, 0),
      totalBytes: ordered.reduce((sum, r) => sum + r.bytes, 0),
      starred: ordered.some((r) => r.starred),
    });
  }
  return sessions.sort(byNewest);
}

export function buildLibrary(recordings: readonly Recording[]): Library {
  const checks = toSessions(recordings.filter((r) => r.kind === 'technique-check'));
  const sessions = toSessions(recordings.filter((r) => r.kind === 'session'));

  const byDate = new Map<string, LibrarySession[]>();
  for (const session of sessions) {
    const existing = byDate.get(session.date);
    if (existing) existing.push(session);
    else byDate.set(session.date, [session]);
  }

  const days: LibraryDay[] = [];
  for (const [date, group] of byDate) {
    days.push({
      date,
      sessions: group,
      totalMs: group.reduce((sum, s) => sum + s.totalMs, 0),
      totalBytes: group.reduce((sum, s) => sum + s.totalBytes, 0),
    });
  }

  return { checks, days: days.sort((a, b) => (a.date < b.date ? 1 : -1)) };
}

/** mm:ss, or h:mm:ss once a sitting runs past the hour. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

const VIEW_NAMES: Record<TechniqueView, string> = {
  front: 'Straight on',
  neck: 'Down the neck',
  strumming: 'Strumming side',
};

export function viewName(view: TechniqueView): string {
  return VIEW_NAMES[view];
}

/**
 * What to say about a clip that did not simply finish.
 *
 * Null for a clean end, because a library that annotates every row with
 * "complete" is a library nobody reads. The point of these is that footage cut
 * short says why: a player drawing conclusions about their own playing from a
 * take the camera truncated is exactly the wrong outcome.
 */
export function endNote(endedBy: RecordingEnd): string | null {
  if (endedBy === 'complete') return null;
  if (endedBy === 'time-limit') return 'Stopped at the length limit';
  if (endedBy === 'device-lost') return 'The camera disconnected part-way';
  if (endedBy === 'hidden') return 'The screen or tab went away part-way';
  return 'Storage filled up part-way';
}
