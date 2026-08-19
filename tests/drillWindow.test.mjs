// How long a stored count was counted over.
//
// A drill's number is a count, and a count only means something beside the
// window it was taken in. The app compared those counts against per-minute bars
// (thirty changes a minute is the course's own gate) and drew a personal best
// across them, while the blocks they came from were built at sixty seconds in
// one place and ninety in another. Nothing showed, because every path that
// builds a changes drill happens to use sixty; a thirty-second block would have
// halved what "held" means without a word about it, and Chord Perfect's longer
// block already out-ranked its shorter one on the same shapes.
//
// So the window goes in the key, beside the shapes, for exactly the reason the
// shapes are there: a number that was not taken the same way is not the same
// number. Unlike the pool, though, a window divides out, so the readers fold
// every window of one drill back into a single series of rates.
//
// A key with no window is a result from before this existed. Those are read as
// sixty seconds, which is what every path wrote, and nothing about them moves.

import {
  ASSUMED_WINDOW_SEC,
  baseKey,
  keyWindow,
  perMinute,
  withWindow,
} from '../src/lib/drillWindow.ts';
import {
  countedDrillKey,
  describeDrillKey,
  isDrillKey,
  parsePoolKey,
  poolKey,
  ratePerMinute,
  timingKey,
} from '../src/lib/drillKeys.ts';
import { pairKey, parsePairKey } from '../src/lib/pairs.ts';
import { applyMeasurement, blankLog } from '../src/store/completion.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures += 1; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };

const AT = 1_700_000_000_000;

console.log('\nThe window, written on the key\n');
{
  check('a run states the seconds it was counted over',
    withWindow(pairKey('A', 'D'), 30) === 'pair:A|D@30', withWindow(pairKey('A', 'D'), 30));
  check('and the seconds come back out', keyWindow('pair:A|D@30') === 30,
    String(keyWindow('pair:A|D@30')));
  check('a key from before this existed records none', keyWindow('pair:A|D') === null,
    String(keyWindow('pair:A|D')));
  check('which is read as the minute every one of them was played over',
    ASSUMED_WINDOW_SEC === 60, String(ASSUMED_WINDOW_SEC));
  check('the drill underneath is the same drill either way',
    baseKey('pair:A|D@30') === 'pair:A|D' && baseKey('pair:A|D') === 'pair:A|D');

  check('a window of nought is refused rather than filed as a divide by zero', (() => {
    try {
      withWindow(pairKey('A', 'D'), 0);
      return false;
    } catch {
      return true;
    }
  })());
  check('and so is a key that already carries one', (() => {
    try {
      withWindow('pair:A|D@30', 60);
      return false;
    } catch {
      return true;
    }
  })());

  check('a count over half a window is twice the rate', perMinute(20, 30) === 40,
    String(perMinute(20, 30)));
  check('and over a minute it is the count itself', perMinute(20, 60) === 20);
}

console.log('\nEvery reader of a key sees through the window\n');
{
  const key = withWindow(pairKey('A', 'D'), 30);
  check('the pair still parses', parsePairKey(key)?.from === 'A' && parsePairKey(key)?.to === 'D',
    JSON.stringify(parsePairKey(key)));
  check('the pool still parses', parsePoolKey(withWindow(poolKey(['G', 'C']), 90))?.join() === 'C,G',
    String(parsePoolKey(withWindow(poolKey(['G', 'C']), 90))));
  check('it is still a drill key, not a stray task id', isDrillKey(key));
  check('and it still describes itself by what was played',
    describeDrillKey(key).label === 'A ↔ D', describeDrillKey(key).label);
  check('a windowed key with an unreadable window is not a drill key',
    !isDrillKey('pair:A|D@later'), 'pair:A|D@later');
}

console.log('\nWhat carries a window and what does not\n');
{
  check('a pair counts changes', countedDrillKey(pairKey('A', 'D')));
  check('a pool counts placements', countedDrillKey(poolKey(['A', 'D'])));
  // Strum timing stores the share of strums that landed in time. A percentage
  // over ninety seconds is the same percentage over sixty, and dividing it by
  // the block would turn a grade into nonsense.
  check('a timing score is already a rate and takes no window',
    !countedDrillKey(timingKey(80)));
  check('so its value is never rescaled', ratePerMinute(timingKey(80), 82) === 82,
    String(ratePerMinute(timingKey(80), 82)));
  check('a key the app no longer recognises is left alone too',
    !countedDrillKey('task-abc123') && ratePerMinute('task-abc123', 40) === 40);
  check('a counted key with no window is read at a minute',
    ratePerMinute(pairKey('A', 'D'), 31) === 31);
  check('and one with a window is read at its own',
    ratePerMinute(withWindow(pairKey('A', 'D'), 30), 16) === 32,
    String(ratePerMinute(withWindow(pairKey('A', 'D'), 30), 16)));
}

console.log('\nRecording a run that states its length\n');
{
  const log = blankLog('2026-08-18', 'r1');
  const written = applyMeasurement(log, 't1', { key: pairKey('A', 'D'), value: 16, durationSec: 30 }, AT);
  check('the result is filed under the window it was measured in',
    Object.keys(written.drillResults).join() === 'pair:A|D@30',
    Object.keys(written.drillResults).join());
  check('and the count is stored as counted, not converted',
    written.drillResults['pair:A|D@30'] === 16,
    String(written.drillResults['pair:A|D@30']));
  check('the run list agrees with it',
    written.drillRuns['pair:A|D@30']?.[0].value === 16);

  // The call sites that have not been told to state a length must go on writing
  // exactly the key they always wrote, or the day this ships every drill starts
  // a fresh history.
  const bare = applyMeasurement(log, 't1', { key: pairKey('A', 'D'), value: 31 }, AT);
  check('a run that states no length is filed exactly as before',
    Object.keys(bare.drillResults).join() === 'pair:A|D',
    Object.keys(bare.drillResults).join());

  const timing = applyMeasurement(log, 't1', { key: timingKey(80), value: 82, durationSec: 120 }, AT);
  check('a percentage is filed without a window even when one is offered',
    Object.keys(timing.drillResults).join() === 'timing:80',
    Object.keys(timing.drillResults).join());

  // The day's best is per key, and two windows of one drill are two keys. The
  // best across them is a question for the readers, which hold rates.
  const twice = applyMeasurement(
    applyMeasurement(log, 't1', { key: pairKey('A', 'D'), value: 31 }, AT),
    't1',
    { key: pairKey('A', 'D'), value: 16, durationSec: 30 },
    AT,
  );
  check('both runs of a day survive, under the window each was played at',
    twice.drillResults['pair:A|D'] === 31 && twice.drillResults['pair:A|D@30'] === 16,
    JSON.stringify(twice.drillResults));
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
