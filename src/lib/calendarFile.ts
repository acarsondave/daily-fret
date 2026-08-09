// The reminder as a calendar event.
//
// Split from src/lib/reminders.ts on purpose, and not only for tidiness: the
// nudge decision runs on every visit and lives in the entry bundle, while this
// serialiser is reached only from the settings panel. Keeping them in one file
// meant every first paint carried an RFC 5545 writer nobody had asked for.

import { parseTime, WEEK_ORDER, type ReminderSettings } from './reminders';

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
// RFC 5545 wants CRLF and no line over 75 octets. Folding is a continuation
// line starting with one space. Calendar apps are strict about both, and a file
// that fails to import is worse than no file.
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

const pad = (n: number) => String(n).padStart(2, '0');

function stampUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export interface IcsOptions {
  settings: ReminderSettings;
  /** How long the routine takes, so the block in the calendar is honest. */
  minutes: number;
  /** First day the event may fall on. */
  from: Date;
  uid: string;
}

/**
 * A daily recurring calendar event.
 *
 * The start time is deliberately *floating* — no timezone and no Z — so it
 * means "half six wherever I am" rather than a fixed instant that drifts an
 * hour twice a year and lands at 5:30am after a flight.
 */
export function buildIcs({ settings, minutes, from, uid }: IcsOptions): string {
  const due = parseTime(settings.time);
  if (due === null || !settings.days.length) throw new Error('Reminder has no time or no days');

  const start = new Date(from);
  start.setHours(Math.floor(due / 60), due % 60, 0, 0);
  // Never schedule the first occurrence in the past: some calendars import it
  // silently as an event that already happened and no alarm ever fires.
  if (start.getTime() <= from.getTime()) start.setDate(start.getDate() + 1);
  while (!settings.days.includes(start.getDay())) start.setDate(start.getDate() + 1);

  const local =
    `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}` +
    `T${pad(start.getHours())}${pad(start.getMinutes())}00`;

  const byDay = WEEK_ORDER.filter((d) => settings.days.includes(d)).map((d) => ICS_DAYS[d]).join(',');
  const block = Math.max(5, Math.round(minutes));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daily Fret//Practice reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stampUtc(from)}`,
    `DTSTART:${local}`,
    `DURATION:PT${block}M`,
    `RRULE:FREQ=WEEKLY;BYDAY=${byDay}`,
    `SUMMARY:${escapeText('Guitar practice')}`,
    `DESCRIPTION:${escapeText('Your daily routine in Daily Fret.')}`,
    'BEGIN:VALARM',
    'TRIGGER:PT0S',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText('Guitar practice')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.map(fold).join('\r\n')}\r\n`;
}
