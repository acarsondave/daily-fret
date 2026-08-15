// When the camera should bother.
//
// Filming every coached session was heavy enough that the owner asked for it to
// stop, so the rule that replaced it decides whether footage happens at all.
// Getting it wrong in either direction is expensive: too eager and the disk
// fills with takes nobody opens, too shy and a month goes unfilmed and the
// archive has a hole in it that cannot be filled afterwards.

import { WEEK_MS, nextFilmingDue, shouldFilmSession } from '../src/media/cadence.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${!ok && d ? ' · ' + d : ''}`); };

const NOW = 1_770_000_000_000;
const DAY = 86_400_000;

const clip = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  sessionId: 's', kind: 'session', date: '2026-08-14',
  taskId: 't1', routineId: 'r1', label: 'Spider walk',
  startedAt: NOW, durationMs: 60_000, bytes: 1_000_000,
  mimeType: 'video/webm', quality: 'standard', width: 1280, height: 720,
  hasAudio: true, starred: false, endedBy: 'complete',
  location: { backend: 'opfs', key: 'k' },
  ...over,
});

console.log('\nWeekly, the default\n');
{
  check('an empty library films straight away',
    shouldFilmSession([], 'weekly', NOW) === true);

  check('having just filmed, it does not film again',
    shouldFilmSession([clip({ startedAt: NOW - DAY })], 'weekly', NOW) === false);

  check('nor three days later',
    shouldFilmSession([clip({ startedAt: NOW - 3 * DAY })], 'weekly', NOW) === false);

  check('six days later it is due again',
    shouldFilmSession([clip({ startedAt: NOW - 6 * DAY })], 'weekly', NOW) === true);

  check('and a fortnight later, certainly',
    shouldFilmSession([clip({ startedAt: NOW - 14 * DAY })], 'weekly', NOW) === true);

  // Six days rather than seven so a player who practises at the same hour every
  // Sunday is not decided by a few minutes either way.
  check('the window is six days, not seven', WEEK_MS === 6 * DAY, String(WEEK_MS / DAY));
}

console.log('\nWhat counts as the last one\n');
{
  check('the newest session decides, not the first in the list',
    shouldFilmSession(
      [clip({ startedAt: NOW - 30 * DAY }), clip({ startedAt: NOW - DAY })],
      'weekly', NOW,
    ) === false);

  // A technique check is asked for by hand and must never satisfy the weekly
  // automatic session, or filming one would silently skip that week's session.
  check('a technique check does not hold the week open',
    shouldFilmSession(
      [clip({ kind: 'technique-check', startedAt: NOW - DAY })],
      'weekly', NOW,
    ) === true);

  check('deleting last week reopens it',
    shouldFilmSession([], 'weekly', NOW) === true);
}

console.log('\nThe other two settings\n');
{
  check('every-session always films',
    shouldFilmSession([clip({ startedAt: NOW })], 'every-session', NOW) === true);
  check('manual never films automatically',
    shouldFilmSession([], 'manual', NOW) === false);
  check('manual stays off even after months',
    shouldFilmSession([clip({ startedAt: NOW - 90 * DAY })], 'manual', NOW) === false);
}

console.log('\nSaying when\n');
{
  check('nothing is due when it is due now', nextFilmingDue([], 'weekly', NOW) === null);
  const due = nextFilmingDue([clip({ startedAt: NOW - DAY })], 'weekly', NOW);
  check('otherwise it names the moment', due === NOW - DAY + WEEK_MS, String(due));
  check('only weekly has a due date', nextFilmingDue([], 'every-session', NOW) === null);

}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
