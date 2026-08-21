// Which sessions the camera films.
//
// The rule used to be "one take per rolling six days", measured from the last
// clip. It rolled backwards through the week and it stopped after one take, so a
// day holding two sessions filmed the warm-up rather than the run that went
// well. The owner asked for both of those to change: name the day, and film
// everything on it.

import {
  DEFAULT_FILM_DAY,
  FILM_DAYS,
  filmNoticeDue,
  filmingDayKey,
  nextFilmingDue,
  readFilmDay,
  shouldFilmSession,
} from '../src/media/cadence.ts';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ` - ${detail}` : ''}`);
};

/** A local date, built the way the rule reads one. */
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();
// 2026-08-22 is a Saturday, so 23 is a Sunday and 24 a Monday.
const SATURDAY = at(2026, 8, 22);
const SUNDAY = at(2026, 8, 23);
const MONDAY = at(2026, 8, 24);

console.log('\nThe named day, and only it\n');
{
  check('films on the day it was told', shouldFilmSession('weekly', 6, SATURDAY) === true);
  check('and not on the day before', shouldFilmSession('weekly', 6, at(2026, 8, 21)) === false);
  check('and not on the day after', shouldFilmSession('weekly', 6, SUNDAY) === false);

  // The whole point of the change. The old rule filmed once and then refused for
  // six days, so a second session on the same day went unfilmed.
  check('every session on the day, not just the first',
    [8, 11, 14, 20].every((h) => shouldFilmSession('weekly', 6, at(2026, 8, 22, h))));

  // Seven days, and exactly one of them says yes.
  const week = [22, 23, 24, 25, 26, 27, 28].map((d) => shouldFilmSession('weekly', 1, at(2026, 8, d)));
  check('exactly one day a week', week.filter(Boolean).length === 1, week.join(','));
}

console.log('\nThe other cadences are untouched by the day\n');
{
  check('manual films nothing automatically',
    FILM_DAYS.every(({ day }) => shouldFilmSession('manual', day, SATURDAY) === false));
  check('every-session films whatever day it is',
    FILM_DAYS.every(({ day }) => shouldFilmSession('every-session', day, SATURDAY) === true));
}

console.log('\nWhen it comes round again\n');
{
  check('nothing is due on the day itself', nextFilmingDue('weekly', 6, SATURDAY) === null);

  const due = nextFilmingDue('weekly', 6, SUNDAY);
  check('the next Saturday is six days on', new Date(due).getDay() === 6, new Date(due).toDateString());
  check('and it is the start of that day, not the same hour',
    new Date(due).getHours() === 0 && new Date(due).getMinutes() === 0, new Date(due).toString());
  check('which is never in the past', due > SUNDAY);

  // A day away is a day away, not a week.
  const tomorrow = nextFilmingDue('weekly', 1, SUNDAY);
  check('tomorrow is tomorrow', new Date(tomorrow).getDate() === 24, new Date(tomorrow).toDateString());

  check('the other cadences never name a date',
    nextFilmingDue('manual', 6, MONDAY) === null && nextFilmingDue('every-session', 6, MONDAY) === null);

  // Every day, from every day, lands on the right weekday and stays ahead.
  let wrong = 0;
  for (const { day } of FILM_DAYS) {
    for (let d = 22; d <= 28; d++) {
      const now = at(2026, 8, d);
      const next = nextFilmingDue('weekly', day, now);
      if (next === null) { if (new Date(now).getDay() !== day) wrong += 1; continue; }
      if (new Date(next).getDay() !== day || next <= now) wrong += 1;
    }
  }
  check('every day, from every day', wrong === 0, `${wrong} wrong`);
}

console.log('\nA stored day that is not a day\n');
{
  // Settings come back off disk and out of the cloud. A day of NaN would mean
  // never filming again, silently, which is the worst way for this to fail.
  const bad = [undefined, null, -1, 7, 3.5, '6', NaN, {}];
  check('all fall back to the default',
    bad.every((v) => readFilmDay(v) === DEFAULT_FILM_DAY),
    bad.map((v) => `${String(v)}->${readFilmDay(v)}`).join(' '));
  check('and a real day is kept', FILM_DAYS.every(({ day }) => readFilmDay(day) === day));
  check('a broken day still films exactly one day a week',
    [22, 23, 24, 25, 26, 27, 28]
      .map((d) => shouldFilmSession('weekly', NaN, at(2026, 8, d)))
      .filter(Boolean).length === 1);
}

console.log('\nTelling the player before the camera opens\n');
{
  // A camera that opens without warning is the one thing this feature cannot do
  // and keep trust, so the first session of a filming day says so first.
  const on = { enabled: true, cadence: 'weekly', filmDay: 6 };
  const satKey = filmingDayKey(SATURDAY);
  const sunKey = filmingDayKey(SUNDAY);

  check('asks on the filming day', filmNoticeDue({ ...on, filmNoticeOn: null }, satKey) === true);
  check('and not on any other day', filmNoticeDue({ ...on, filmNoticeOn: null }, sunKey) === false);

  // Once a day, not once a session. The second run has already been told.
  check('does not ask twice in a day',
    filmNoticeDue({ ...on, filmNoticeOn: satKey }, satKey) === false);
  // But yesterday's answer is not this week's answer.
  check('asks again the following week',
    filmNoticeDue({ ...on, filmNoticeOn: '2026-08-15' }, satKey) === true);

  check('never asks with the camera off',
    filmNoticeDue({ ...on, enabled: false, filmNoticeOn: null }, satKey) === false);
  check('never asks when nothing is filmed automatically',
    filmNoticeDue({ ...on, cadence: 'manual', filmNoticeOn: null }, satKey) === false);
  // Filming every session still deserves the warning, once a day.
  check('asks once a day when every session films',
    filmNoticeDue({ ...on, cadence: 'every-session', filmNoticeOn: null }, sunKey) === true);

  // The day key is the local date, not UTC, or a player east or west of the
  // meridian would be told about the wrong day.
  check('the day key is the local date',
    filmingDayKey(new Date(2026, 7, 22, 23, 30).getTime()) === '2026-08-22',
    filmingDayKey(new Date(2026, 7, 22, 23, 30).getTime()));
  check('and pads a single digit month and day',
    filmingDayKey(new Date(2026, 0, 5, 9).getTime()) === '2026-01-05',
    filmingDayKey(new Date(2026, 0, 5, 9).getTime()));
}

console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
