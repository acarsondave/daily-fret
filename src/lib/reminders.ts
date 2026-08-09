// Practice reminders.
//
// The honest constraint first, because it shapes everything below: a web page
// cannot wake a sleeping phone. Scheduled delivery needs the Push API, which
// needs a server holding VAPID keys and a job that fires while nobody is
// watching. There is no such server here, and pretending otherwise would mean
// shipping a reminder that silently never arrives — the exact failure that
// makes someone stop trusting an app they were relying on.
//
// So there are three mechanisms, strongest first, and the settings screen says
// which is which rather than implying one reminder that always works:
//
//   1. A calendar event. Downloaded once, it lives in the OS calendar and fires
//      whether or not this app is open, running or installed. It is the only
//      one that survives a closed phone, so it is offered first.
//   2. A notification, while the app is open in a tab. Genuinely useful on a
//      desktop left open all day, useless on a phone in a pocket.
//   3. A nudge on the next visit. Not a reminder at all, but the thing that
//      actually catches a missed day, so it needs no permission and is on by
//      default.

import type { DailyLog } from '../types';

export interface ReminderSettings {
  /** 'HH:MM', 24-hour, in whatever timezone the user is standing in. */
  time: string;
  /** Days to practise, 0 = Sunday, matching Date#getDay. */
  days: number[];
  /** Whether to raise a browser notification while the app is open. */
  notify: boolean;
  /** Last date a nudge was shown, so a missed day is mentioned once. */
  lastNudge?: string;
}

export const DEFAULT_REMINDER: ReminderSettings = {
  time: '18:30',
  days: [1, 2, 3, 4, 5, 6, 0],
  notify: false,
};

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Monday first: a practice week is read the way a calendar is, not the way Date is. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** Minutes past midnight, or null when the string is not a time. */
export function parseTime(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** '18:30' as '6:30 pm'. The settings screen reads in whichever the user typed. */
export function formatTime(time: string): string {
  const total = parseTime(time);
  if (total === null) return time;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours < 12 ? 'am' : 'pm';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** "Every day", "Weekdays", or the days themselves. */
export function describeDays(days: readonly number[]): string {
  const set = new Set(days);
  if (set.size === 0) return 'No days chosen';
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  return WEEK_ORDER.filter((d) => set.has(d)).map((d) => DAY_NAMES[d]).join(', ');
}

/** Whether anything at all was done on a day. */
export function practisedOn(logs: Record<string, DailyLog>, date: string): boolean {
  const log = logs[date];
  if (!log) return false;
  if (log.completedTaskIds?.length) return true;
  return Object.values(log.drillResults ?? {}).some((v) => Number.isFinite(v) && v > 0);
}

export interface NudgeDecision {
  show: boolean;
  /** Consecutive scheduled days missed before today, for the wording. */
  missed: number;
}

/**
 * Whether to say something about practice on this visit.
 *
 * Deliberately conservative. It stays quiet before the chosen time (the day is
 * not over, and being chased at breakfast for an evening habit is what makes
 * people mute an app), on days that are not practice days, and once a day.
 *
 * `missed` counts scheduled days already gone, so the wording can be "it has
 * been three days" instead of a generic prod. Unscheduled days are skipped
 * rather than counted: a rest day the user asked for is not a failure.
 */
export function nudgeDecision(
  logs: Record<string, DailyLog>,
  settings: ReminderSettings,
  today: string,
  minutesNow: number,
): NudgeDecision {
  const quiet = { show: false, missed: 0 };
  const due = parseTime(settings.time);
  if (due === null || settings.days.length === 0) return quiet;

  const todayDay = dayOfWeek(today);
  if (!settings.days.includes(todayDay)) return quiet;
  if (minutesNow < due) return quiet;
  if (settings.lastNudge === today) return quiet;
  if (practisedOn(logs, today)) return quiet;

  let missed = 0;
  let cursor = previousDay(today);
  // Ten days back is far enough to say "it has been a while" and stops this
  // walking a multi-year history on every render.
  for (let i = 0; i < 10; i++) {
    if (settings.days.includes(dayOfWeek(cursor))) {
      if (practisedOn(logs, cursor)) break;
      missed += 1;
    }
    cursor = previousDay(cursor);
  }

  return { show: true, missed };
}

/** What the nudge actually says. Never scolds, never counts a streak at someone. */
export function nudgeMessage(missed: number): string {
  if (missed === 0) return 'Your practice time has come round.';
  if (missed === 1) return 'Yesterday got away. Today is still here.';
  if (missed < 5) return `${missed} days since the last one. A short session still counts.`;
  return 'It has been a while. Ten minutes is a fine way back in.';
}

export function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00`).getDay();
}

function previousDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Milliseconds until the next occurrence of `time` on a chosen day, or null. */
export function msUntilNext(settings: ReminderSettings, from: Date): number | null {
  const due = parseTime(settings.time);
  if (due === null || settings.days.length === 0) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(from);
    day.setDate(day.getDate() + offset);
    if (!settings.days.includes(day.getDay())) continue;
    day.setHours(Math.floor(due / 60), due % 60, 0, 0);
    const delta = day.getTime() - from.getTime();
    if (delta > 0) return delta;
  }
  return null;
}

// --- the calendar file ----------------------------------------------------

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
