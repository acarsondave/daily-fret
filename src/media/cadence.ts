// How often the camera should bother.
//
// Filming every coached session was the wrong default and the owner said so
// plainly: it is heavy, and the size adds up. It is also the wrong shape for
// what the footage is for. Twenty takes a week is a landfill nobody opens; one
// deliberate take a week is a record, and a record is the thing that shows a
// hand changing over months.
//
// So the question a session asks is not "is recording on" but "is this session
// one of this week's".
//
// It used to be "is this the one this week", answered by measuring six days from
// the last clip. That rolled: film on Saturday, film again the next Friday, and
// the filming day walked backwards through the week until it landed somewhere
// inconvenient. It also stopped after one take, so a day with two sessions in it
// filmed the warm-up and not the run that went well.
//
// Now the player names the day. Every session on that day is filmed, and none on
// any other day. That is a pure function of the calendar rather than of the
// library: it needs no scheduler, no stored cursor, and no clock to keep in
// sync, and deleting a clip cannot change whether today is Saturday.

import type { RecordingCadence } from './types';

/** Days of the week as `Date.getDay()` numbers them, Sunday first. */
export const FILM_DAYS = [
  { day: 0, name: 'Sunday', short: 'Sun' },
  { day: 1, name: 'Monday', short: 'Mon' },
  { day: 2, name: 'Tuesday', short: 'Tue' },
  { day: 3, name: 'Wednesday', short: 'Wed' },
  { day: 4, name: 'Thursday', short: 'Thu' },
  { day: 5, name: 'Friday', short: 'Fri' },
  { day: 6, name: 'Saturday', short: 'Sat' },
] as const;

/** Sunday, until the player says otherwise. */
export const DEFAULT_FILM_DAY = 0;

/** A stored day that is not a day of the week is not trusted to be one. */
export const readFilmDay = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
    ? value
    : DEFAULT_FILM_DAY;

/**
 * Whether an automatic session recording should start now.
 *
 * Technique checks never come through here. They are asked for by hand, and a
 * cadence that refused one would be refusing the most deliberate thing the
 * player does with the camera.
 */
export function shouldFilmSession(
  cadence: RecordingCadence,
  filmDay: number,
  nowMs: number,
): boolean {
  if (cadence === 'manual') return false;
  if (cadence === 'every-session') return true;
  // Every session on the day, however many that turns out to be. A day with two
  // sessions in it is a day with two takes, and the second one is usually the
  // better one; the old rule filmed the warm-up and stopped.
  return new Date(nowMs).getDay() === readFilmDay(filmDay);
}

/**
 * When the next automatic recording becomes due, or null if one is due now.
 *
 * Read by settings so the pane can say where the player stands rather than
 * leaving them to work it out from a rule.
 */
export function nextFilmingDue(
  cadence: RecordingCadence,
  filmDay: number,
  nowMs: number,
): number | null {
  if (cadence !== 'weekly') return null;
  if (shouldFilmSession(cadence, filmDay, nowMs)) return null;

  // Midnight at the start of the next such day, local time. Built by stepping a
  // local Date rather than by adding milliseconds, so a week containing a
  // daylight-saving change still lands on the right morning.
  const due = new Date(nowMs);
  due.setHours(0, 0, 0, 0);
  do {
    due.setDate(due.getDate() + 1);
  } while (due.getDay() !== readFilmDay(filmDay));
  return due.getTime();
}
