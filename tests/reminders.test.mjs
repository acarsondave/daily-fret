import { buildIcs } from '../src/lib/calendarFile.ts';
import {
  DEFAULT_REMINDER,
  describeDays,
  formatTime,
  msUntilNext,
  nudgeDecision,
  nudgeMessage,
  parseTime,
  practisedOn,
} from '../src/lib/reminders.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

const settings = (over = {}) => ({ ...DEFAULT_REMINDER, ...over });
const done = (date) => [date, { date, routineId: 'r1', completedTaskIds: ['t1'] }];
const measured = (date, v) => [date, { date, routineId: 'r1', completedTaskIds: [], drillResults: { t1: v } }];
const blank = (date) => [date, { date, routineId: 'r1', completedTaskIds: [] }];
const logs = (...e) => Object.fromEntries(e);

console.log('\nReading a time\n');
{
  check('a normal time', parseTime('18:30') === 18 * 60 + 30);
  check('midnight', parseTime('00:00') === 0);
  check('one digit hour', parseTime('9:05') === 545);
  check('last minute of the day', parseTime('23:59') === 1439);
  check('hour 24 is refused', parseTime('24:00') === null);
  check('minute 60 is refused', parseTime('12:60') === null);
  check('nonsense is refused', parseTime('half six') === null);
  check('an empty string is refused', parseTime('') === null);
  check('seconds are refused', parseTime('18:30:00') === null);
  check('formatting reads like a clock', formatTime('18:30') === '6:30 pm');
  check('noon is pm', formatTime('12:00') === '12:00 pm');
  check('midnight is 12 am', formatTime('00:00') === '12:00 am');
  check('morning', formatTime('09:05') === '9:05 am');
  check('an unreadable time is passed through, not mangled', formatTime('oops') === 'oops');
}

console.log('\nDescribing days\n');
{
  check('all seven', describeDays([0, 1, 2, 3, 4, 5, 6]) === 'Every day');
  check('weekdays', describeDays([1, 2, 3, 4, 5]) === 'Weekdays');
  check('weekends', describeDays([0, 6]) === 'Weekends');
  check('three days read Monday first', describeDays([0, 1, 3]) === 'Mon, Wed, Sun', describeDays([0, 1, 3]));
  check('none says so', describeDays([]) === 'No days chosen');
}

console.log('\nWhether a day counts as practised\n');
{
  check('a completed task counts', practisedOn(logs(done('2026-08-09')), '2026-08-09'));
  check('a measured result counts', practisedOn(logs(measured('2026-08-09', 30)), '2026-08-09'));
  check('an empty log does not', !practisedOn(logs(blank('2026-08-09')), '2026-08-09'));
  check('a zero result does not', !practisedOn(logs(measured('2026-08-09', 0)), '2026-08-09'));
  check('a missing day does not', !practisedOn({}, '2026-08-09'));
}

console.log('\nWhen to say something\n');
{
  // 2026-08-09 is a Sunday.
  const s = settings({ time: '18:30' });
  check('nothing before the time', !nudgeDecision({}, s, '2026-08-09', 17 * 60).show);
  check('a minute before is still quiet', !nudgeDecision({}, s, '2026-08-09', 18 * 60 + 29).show);
  check('on the minute it speaks', nudgeDecision({}, s, '2026-08-09', 18 * 60 + 30).show);
  check('after too', nudgeDecision({}, s, '2026-08-09', 22 * 60).show);
  check('but not if today is done',
    !nudgeDecision(logs(done('2026-08-09')), s, '2026-08-09', 22 * 60).show);
  check('and not twice in a day',
    !nudgeDecision({}, settings({ lastNudge: '2026-08-09' }), '2026-08-09', 22 * 60).show);
  check('a dismissal yesterday does not silence today',
    nudgeDecision({}, settings({ lastNudge: '2026-08-08' }), '2026-08-09', 22 * 60).show);

  // Sunday is not a practice day here.
  const weekdays = settings({ days: [1, 2, 3, 4, 5] });
  check('quiet on a day you did not choose',
    !nudgeDecision({}, weekdays, '2026-08-09', 22 * 60).show);
  check('no days chosen means never',
    !nudgeDecision({}, settings({ days: [] }), '2026-08-09', 22 * 60).show);
  check('an unreadable time means never',
    !nudgeDecision({}, settings({ time: 'x' }), '2026-08-09', 22 * 60).show);
}

console.log('\nCounting what was missed\n');
{
  const s = settings({ time: '18:30' });
  const at = (l, d = '2026-08-09') => nudgeDecision(l, s, d, 20 * 60);
  check('practised yesterday means nothing missed',
    at(logs(done('2026-08-08'))).missed === 0, String(at(logs(done('2026-08-08'))).missed));
  check('one gap counts one',
    at(logs(done('2026-08-07'))).missed === 1, String(at(logs(done('2026-08-07'))).missed));
  check('three gaps count three',
    at(logs(done('2026-08-05'))).missed === 3, String(at(logs(done('2026-08-05'))).missed));
  check('an empty history stops at the ten-day lookback',
    at({}).missed === 10, String(at({}).missed));

  // A day the user did not schedule is a rest day they asked for, not a miss.
  const weekdaysOnly = settings({ time: '18:30', days: [1, 2, 3, 4, 5] });
  // 2026-08-10 is a Monday; the weekend before it was never scheduled.
  const weekend = nudgeDecision(logs(done('2026-08-07')), weekdaysOnly, '2026-08-10', 20 * 60);
  check('the unscheduled weekend is not counted as missed',
    weekend.show && weekend.missed === 0, `show=${weekend.show} missed=${weekend.missed}`);
}

console.log('\nWhat it says\n');
{
  check('on time, no history of missing', /come round/.test(nudgeMessage(0)));
  check('one day is gentle', !/streak|failed|broke/i.test(nudgeMessage(1)));
  check('a few days offers the small version', /still counts/.test(nudgeMessage(3)));
  check('a long gap offers ten minutes', /Ten minutes/.test(nudgeMessage(20)));
  // Never scold. A missed day is where people quit; this is the moment that
  // decides whether they open the app again.
  for (const n of [0, 1, 2, 5, 30]) {
    check(`nothing scolding at ${n}`, !/should|failed|lost|broke|don't|shame/i.test(nudgeMessage(n)));
  }
}

console.log('\nWhen the next one falls\n');
{
  const s = settings({ time: '18:30' });
  const before = new Date('2026-08-09T10:00:00');
  check('later today', msUntilNext(s, before) === (8 * 60 + 30) * 60_000,
    String(msUntilNext(s, before)));
  const after = new Date('2026-08-09T19:00:00');
  check('tomorrow once today has passed', msUntilNext(s, after) === (23 * 60 + 30) * 60_000,
    String(msUntilNext(s, after)));
  check('exactly on the minute rolls to tomorrow, never returns zero',
    msUntilNext(s, new Date('2026-08-09T18:30:00')) === 24 * 60 * 60_000);
  const mondayOnly = settings({ time: '18:30', days: [1] });
  // Sunday 19:00 -> Monday 18:30 is 23.5 hours.
  check('skips to the next chosen day',
    msUntilNext(mondayOnly, after) === (23 * 60 + 30) * 60_000,
    String(msUntilNext(mondayOnly, after)));
  check('no days means no next one', msUntilNext(settings({ days: [] }), before) === null);
  check('an unreadable time means no next one',
    msUntilNext(settings({ time: 'x' }), before) === null);
  check('every result is inside a week',
    msUntilNext(mondayOnly, before) <= 7 * 24 * 60 * 60_000);
}

console.log('\nThe calendar file\n');
{
  const from = new Date('2026-08-09T10:00:00');
  const ics = buildIcs({ settings: settings({ time: '18:30' }), minutes: 20, from, uid: 'u@daily-fret' });

  check('it is a calendar', ics.startsWith('BEGIN:VCALENDAR\r\n'));
  check('and closes', ics.trimEnd().endsWith('END:VCALENDAR'));
  check('every line ends CRLF, as the spec demands',
    ics.split('\r\n').length - 1 >= 18 && !/[^\r]\n/.test(ics));
  check('no line exceeds 75 octets',
    ics.split('\r\n').every((l) => l.length <= 75),
    ics.split('\r\n').find((l) => l.length > 75));
  check('it repeats weekly on every day',
    ics.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU'));
  check('it carries an alarm', ics.includes('BEGIN:VALARM') && ics.includes('TRIGGER:PT0S'));
  check('the block is the routine length', ics.includes('DURATION:PT20M'));
  check('the uid is carried through', ics.includes('UID:u@daily-fret'));

  // Floating local time: no Z and no TZID, so "half six" stays half six after a
  // clock change or a flight rather than drifting to 5:30am.
  const dtstart = ics.split('\r\n').find((l) => l.startsWith('DTSTART'));
  check('the start is floating local time', dtstart === 'DTSTART:20260809T183000', dtstart);
  check('today is used when the time has not passed', dtstart.includes('20260809'));

  const later = buildIcs({ settings: settings({ time: '18:30' }), minutes: 20, from: new Date('2026-08-09T19:00:00'), uid: 'u' });
  const nextStart = later.split('\r\n').find((l) => l.startsWith('DTSTART'));
  check('a time already gone starts tomorrow, never in the past',
    nextStart === 'DTSTART:20260810T183000', nextStart);

  // 2026-08-09 is a Sunday, so a Monday-only reminder must skip to the 10th.
  const monday = buildIcs({ settings: settings({ time: '07:00', days: [1] }), minutes: 15, from, uid: 'u' });
  check('the first occurrence lands on a chosen day',
    monday.includes('DTSTART:20260810T070000'), monday.split('\r\n').find((l) => l.startsWith('DTSTART')));
  check('and repeats on that day only', monday.includes('RRULE:FREQ=WEEKLY;BYDAY=MO'));

  check('a five-minute floor on the block',
    buildIcs({ settings: settings(), minutes: 0, from, uid: 'u' }).includes('DURATION:PT5M'));

  let threw = false;
  try { buildIcs({ settings: settings({ days: [] }), minutes: 20, from, uid: 'u' }); } catch { threw = true; }
  check('no days is an error, not an empty file', threw);
  threw = false;
  try { buildIcs({ settings: settings({ time: 'x' }), minutes: 20, from, uid: 'u' }); } catch { threw = true; }
  check('an unreadable time is an error too', threw);

  // A long description must fold rather than emit an over-length line.
  const folded = ics.split('\r\n').filter((l) => l.startsWith(' '));
  check('folding produces continuation lines only when needed', folded.every((l) => l.length <= 75));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
