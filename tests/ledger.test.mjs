// What the day's screen is allowed to say about the numbers.
//
// Two things here are honesty rules rather than arithmetic, and both have a
// wrong answer that looks perfectly reasonable in code review.
//
// A drill that ran and heard nothing stores a zero, and the app must not read
// that as a personal best of zero or as a day of practice. And a delta is only
// meaningful against the same drill: comparing today's chord changes with last
// week's Chord Perfect block produces a number with no meaning that a screen
// would print with total confidence.

import { readLedger } from '../src/lib/ledger.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${!ok && d ? ': ' + d : ''}`); };

const day = (date, drillResults) => ({ date, routineId: 'r', completedTaskIds: [], drillResults });
const logs = (...days) => Object.fromEntries(days.map((d) => [d.date, d]));

console.log('\nNothing measured\n');
{
  const empty = readLedger({});
  check('no days', empty.daysMeasured === 0);
  check('the best change rate is unknown, not zero', empty.bestChanges === null, String(empty.bestChanges));
  check('so is the best block', empty.bestPlaced === null, String(empty.bestPlaced));
  check('and there is no delta to lead with', empty.delta === null);

  // The distinction the whole file exists for: a drill that ran into a dead
  // microphone writes a zero, and a zero is not a measurement of a player.
  const silent = readLedger(logs(day('2026-08-01', { 'pair:A|D': 0 })));
  check('a run that heard nothing is not a day of practice', silent.daysMeasured === 0,
    String(silent.daysMeasured));
  check('and does not set a best of zero', silent.bestChanges === null, String(silent.bestChanges));
}

console.log('\nOne session\n');
{
  const first = readLedger(logs(day('2026-08-01', { 'pair:A|D': 31, 'pool:A|D|E': 44 })));
  check('the day counts', first.daysMeasured === 1);
  check('changes are read from the pair keys', first.bestChanges === 31, String(first.bestChanges));
  check('and placements from the pool keys', first.bestPlaced === 44, String(first.bestPlaced));
  check('with nothing to compare against, there is no delta', first.delta === null);
  check('and the day is named', first.lastMeasured === '2026-08-01', String(first.lastMeasured));
}

console.log('\nThe second session leads with what moved\n');
{
  const two = readLedger(logs(
    day('2026-08-01', { 'pair:A|D': 31, 'pool:A|D|E': 44 }),
    day('2026-08-03', { 'pair:A|D': 38, 'pool:A|D|E': 46 }),
  ));
  check('the delta is the biggest move, not the first one found',
    two.delta?.change === 7, JSON.stringify(two.delta));
  check('it names what was played', two.delta?.label === 'A ↔ D', two.delta?.label);
  check('in that drill’s own unit', two.delta?.unit === 'cpm', two.delta?.unit);
  check('and the day it beat, which is that drill’s last day and not yesterday',
    two.delta?.since === '2026-08-01', two.delta?.since);
  check('bests are all-time, not today', two.bestChanges === 38, String(two.bestChanges));
}

console.log('\nA drill compares only against itself\n');
{
  // A ↔ D was last played on the 1st, C ↔ G only today. The delta must be the
  // pair that has two numbers, not a number invented for the pair that has one.
  const gapped = readLedger(logs(
    day('2026-08-01', { 'pair:A|D': 30 }),
    day('2026-08-02', { 'pool:A|D|E': 40 }),
    day('2026-08-09', { 'pair:A|D': 36, 'pair:C|G': 12 }),
  ));
  check('it skips the drill with no history', gapped.delta?.label === 'A ↔ D', JSON.stringify(gapped.delta));
  check('and reaches back past days that did not play it',
    gapped.delta?.since === '2026-08-01', gapped.delta?.since);
  check('the move is measured against that day', gapped.delta?.change === 6, String(gapped.delta?.change));
}

console.log('\nA session that went backwards says so\n');
{
  const worse = readLedger(logs(
    day('2026-08-01', { 'pair:A|D': 40 }),
    day('2026-08-02', { 'pair:A|D': 33 }),
  ));
  check('the delta is negative rather than hidden', worse.delta?.change === -7, JSON.stringify(worse.delta));
  check('and the best stands at the better day', worse.bestChanges === 40, String(worse.bestChanges));

  // Unchanged is not a move, and printing "+0" every day would train people to
  // stop reading the one line that is supposed to carry the news.
  const same = readLedger(logs(
    day('2026-08-01', { 'pair:A|D': 40 }),
    day('2026-08-02', { 'pair:A|D': 40 }),
  ));
  check('matching yesterday is not reported as a move', same.delta === null, JSON.stringify(same.delta));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
