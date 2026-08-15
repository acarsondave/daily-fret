// How often the camera should bother.
//
// Filming every coached session was the wrong default and the owner said so
// plainly: it is heavy, and the size adds up. It is also the wrong shape for
// what the footage is for. Twenty takes a week is a landfill nobody opens; one
// deliberate take a week is a record, and a record is the thing that shows a
// hand changing over months.
//
// So the question a session asks is not "is recording on" but "is this session
// the one this week". The answer is a pure function of what has already been
// filmed, which means it needs no scheduler, no stored cursor, and no clock to
// keep in sync: delete last week's clip and last week becomes unfilmed again,
// which is exactly what a player would expect.

import type { Recording, RecordingCadence } from './types';

const DAY_MS = 86_400_000;

/**
 * How long a filmed session holds the week open.
 *
 * Six days rather than seven, deliberately. At exactly seven a player who
 * practises every Sunday at the same hour is at the mercy of a few minutes
 * either way, and half their weeks would go unfilmed for no reason they could
 * see. Six lets the weekly session drift and still count as weekly.
 */
export const WEEK_MS = 6 * DAY_MS;

/**
 * Whether an automatic session recording should start now.
 *
 * Technique checks never come through here. They are asked for by hand, and a
 * cadence that refused one would be refusing the most deliberate thing the
 * player does with the camera.
 */
export function shouldFilmSession(
  recordings: readonly Recording[],
  cadence: RecordingCadence,
  nowMs: number,
): boolean {
  if (cadence === 'manual') return false;
  if (cadence === 'every-session') return true;

  const lastAutomatic = recordings
    .filter((r) => r.kind === 'session')
    .reduce((latest, r) => Math.max(latest, r.startedAt), 0);

  if (lastAutomatic === 0) return true;
  return nowMs - lastAutomatic >= WEEK_MS;
}

/**
 * When the next automatic recording becomes due, or null if one is due now.
 *
 * Read by settings so the pane can say where the player stands rather than
 * leaving them to work it out from a rule.
 */
export function nextFilmingDue(
  recordings: readonly Recording[],
  cadence: RecordingCadence,
  nowMs: number,
): number | null {
  if (cadence !== 'weekly') return null;
  if (shouldFilmSession(recordings, cadence, nowMs)) return null;

  const lastAutomatic = recordings
    .filter((r) => r.kind === 'session')
    .reduce((latest, r) => Math.max(latest, r.startedAt), 0);
  return lastAutomatic + WEEK_MS;
}
