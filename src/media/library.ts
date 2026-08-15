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

// --- the spine ---------------------------------------------------------------
//
// The library above answers "what is there". The spine answers the question the
// footage actually exists to answer, which is "what have I been doing since
// May". It is the same rows arranged as a calendar rather than a feed: months in
// order, the days inside them that have footage, and for each month how much of
// it was filmed at all. A month with two entries and a month with nine should
// not look alike, and in a list they do.

export interface SpineDay {
  date: string;
  dayOfMonth: number;
  /** Three letters. The spine is scanned, not read. */
  weekday: string;
  sessions: LibrarySession[];
  totalMs: number;
  /** A technique check sits on the spine like anything else, but marked. */
  hasCheck: boolean;
}

export interface SpineMonth {
  /** YYYY-MM, which is also its sort key. */
  key: string;
  label: string;
  year: number;
  days: SpineDay[];
  totalMs: number;
  /** Days of this month with footage, against days the month actually has. */
  filmedDays: number;
  daysInMonth: number;
}

export interface Spine {
  months: SpineMonth[];
  filmedDays: number;
  totalMs: number;
  totalBytes: number;
  earliest: string | null;
  latest: string | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Parsed as local time, deliberately.
 *
 * `new Date('2026-08-15')` is UTC midnight, which in any negative offset renders
 * as the fourteenth. A practice diary that files a session under the day before
 * the one the player remembers is worse than no diary.
 */
function localDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function buildSpine(recordings: readonly Recording[]): Spine {
  const sessions = toSessions(recordings);

  const byDate = new Map<string, LibrarySession[]>();
  for (const session of sessions) {
    const existing = byDate.get(session.date);
    if (existing) existing.push(session);
    else byDate.set(session.date, [session]);
  }

  const byMonth = new Map<string, SpineDay[]>();
  for (const [date, group] of byDate) {
    const when = localDate(date);
    const day: SpineDay = {
      date,
      dayOfMonth: when.getDate(),
      weekday: WEEKDAYS[when.getDay()],
      sessions: group,
      totalMs: group.reduce((sum, s) => sum + s.totalMs, 0),
      hasCheck: group.some((s) => s.clips.some((c) => c.kind === 'technique-check')),
    };
    const key = date.slice(0, 7);
    const existing = byMonth.get(key);
    if (existing) existing.push(day);
    else byMonth.set(key, [day]);
  }

  const months: SpineMonth[] = [];
  for (const [key, days] of byMonth) {
    const [year, month] = key.split('-').map(Number);
    months.push({
      key,
      label: MONTH_LABELS[month - 1],
      year,
      days: days.sort((a, b) => b.dayOfMonth - a.dayOfMonth),
      totalMs: days.reduce((sum, d) => sum + d.totalMs, 0),
      filmedDays: days.length,
      // Day zero of the next month is the last day of this one.
      daysInMonth: new Date(year, month, 0).getDate(),
    });
  }

  const dates = [...byDate.keys()].sort();
  return {
    months: months.sort((a, b) => (a.key < b.key ? 1 : -1)),
    filmedDays: byDate.size,
    totalMs: sessions.reduce((sum, s) => sum + s.totalMs, 0),
    totalBytes: recordings.reduce((sum, r) => sum + r.bytes, 0),
    earliest: dates[0] ?? null,
    latest: dates[dates.length - 1] ?? null,
  };
}

/**
 * Earlier technique clips shot from the same angle, newest first.
 *
 * This is the one comparison the footage can honestly support. Two takes of the
 * same angle months apart show a hand that has changed; two different angles
 * show nothing at all, and offering that pairing would be inviting the player to
 * read a difference that is only the camera having moved.
 */
export function sameViewBefore(
  recordings: readonly Recording[],
  clip: Recording,
): Recording[] {
  if (clip.kind !== 'technique-check' || !clip.view) return [];
  return recordings
    .filter((r) => r.kind === 'technique-check'
      && r.view === clip.view
      && r.id !== clip.id
      && r.startedAt < clip.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** How long ago, for a label that sits beside a comparison. */
export function gapLabel(fromMs: number, toMs: number): string {
  const days = Math.round(Math.abs(toMs - fromMs) / 86_400_000);
  if (days < 1) return 'the same day';
  if (days === 1) return 'a day apart';
  if (days < 14) return `${days} days apart`;
  if (days < 60) return `${Math.round(days / 7)} weeks apart`;
  return `${Math.round(days / 30)} months apart`;
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
