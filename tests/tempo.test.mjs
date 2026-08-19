// What the click is allowed to ask for.
//
// planTempo had no test of any kind, which is how its header came to claim
// "speed is never prescribed above what the player has already shown" while a
// series of 28, 29, 30, 31 prescribed 32. The claim was wrong rather than the
// behaviour: a teacher nudges. So the rule this suite holds the file to is the
// one it actually runs, stated exactly, and the two adversarial shapes are the
// ones that broke it before: a steady climb, and a session that fell off a cliff.

import {
  planTempo,
  fixedTempo,
  drillSeries,
  DEFAULT_PRACTICE_BPM,
  RUST_DAYS,
} from '../src/lib/tempo.ts';
import { MIN_BPM, MAX_BPM } from '../src/audio/metronome.ts';
import { trainerBlockSeconds } from '../src/lib/drills.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

const START = Date.UTC(2026, 6, 1);
const iso = (offset) => new Date(START + offset * 86_400_000).toISOString().slice(0, 10);
/** A run a day, oldest first, ending the day before `today`. */
const series = (...values) =>
  values.map((value, i) => ({ date: iso(i - values.length), value }));
const TODAY = iso(0);
const plan = (...values) => planTempo(series(...values), TODAY);
/** The runs the plan is allowed to read: the latest, and up to three before it. */
const window = (values) => values.slice(-4);

console.log('\nNothing to go on\n');
{
  const p = planTempo([], TODAY);
  check('an empty history gets the standard practice click', p.bpm === DEFAULT_PRACTICE_BPM,
    String(p.bpm));
  check('and no pace to hit, because none is known', p.targetChangesPerMin === null);
  check('and says so rather than inventing a reason', /No history/.test(p.reason), p.reason);
  check('the trend is new, not steady', p.trend === 'new', p.trend);
}

console.log('\nOne run is not a trend\n');
{
  const p = plan(30);
  check('a single run sits under itself', p.targetChangesPerMin < 30, String(p.targetChangesPerMin));
  check('by a tenth', p.targetChangesPerMin === 27, String(p.targetChangesPerMin));
  check('and the trend says why', p.trend === 'first', p.trend);
  check('the reason names the number it asks for',
    p.reason.includes('27/min'), p.reason);
}

console.log('\nClimbing: the exception, and the size of it\n');
{
  // The three shapes from the audit, which are the normal shape of steady
  // improvement. Each one asks for more than the player has ever done.
  for (const [runs, expected] of [[[28,29,30,31], 32], [[25,26,27,28], 29], [[40,42,44,46], 47]]) {
    const p = plan(...runs);
    const best = Math.max(...runs);
    check(`${runs.join(', ')} asks for ${expected}`, p.targetChangesPerMin === expected,
      String(p.targetChangesPerMin));
    check('  which is above the best run there has ever been', p.targetChangesPerMin > best);
    check('  and the app calls that climbing', p.trend === 'progress', p.trend);
    check('  and says so, with the number, so it can be argued with',
      /climbing/i.test(p.reason) && p.reason.includes(`${expected}/min`), p.reason);
    check('  the nudge is at most five per cent over the run just made',
      p.targetChangesPerMin <= Math.round(runs[runs.length - 1] * 1.05),
      `${p.targetChangesPerMin} vs ${runs[runs.length - 1]}`);
  }
  // Climbing off a low base: the weighted baseline still sits under a single
  // big jump, so a fluke session does not become the new floor.
  const jump = plan(20, 30, 40, 50);
  check('one big jump does not become the target', jump.targetChangesPerMin < 50,
    String(jump.targetChangesPerMin));
}

console.log('\nEasing actually eases\n');
{
  // Three sessions at 100 and one at 30. The weighted baseline used to put this
  // at 51, so the branch whose job is to back off asked a player who had just
  // managed 30 for seventy per cent more, and kept asking until the window
  // rolled over three sessions later.
  const p = plan(100, 100, 100, 30);
  check('a dip is eased from the dip, not from the good runs before it',
    p.targetChangesPerMin <= 30, String(p.targetChangesPerMin));
  check('and eased below it, because rebuilding it clean is the point',
    p.targetChangesPerMin === 26, String(p.targetChangesPerMin));
  check('the trend names it', p.trend === 'regress', p.trend);
  check('and the reason does not claim to be easing while asking for more',
    /Easing to 26\/min/.test(p.reason), p.reason);

  // Repeating the bad session must not repeat the unreachable ask.
  const again = plan(100, 100, 30, 30);
  check('a second dipped session is not asked for more than the first',
    again.targetChangesPerMin <= 30, String(again.targetChangesPerMin));
}

console.log('\nHolding, and coming back cold\n');
{
  const level = plan(30, 30, 30, 30);
  check('a flat history holds its pace', level.targetChangesPerMin === 30,
    String(level.targetChangesPerMin));
  check('and is called steady', level.trend === 'steady', level.trend);

  const slipping = plan(35, 34, 33, 32);
  check('drifting down within tolerance is still steady', slipping.trend === 'steady',
    slipping.trend);
  check('and is never asked for more than its best run',
    slipping.targetChangesPerMin <= 35, String(slipping.targetChangesPerMin));

  const cold = planTempo(series(30, 31, 32), iso(RUST_DAYS + 1));
  check('a long gap eases off', cold.trend === 'rust', cold.trend);
  check('to under the last run', cold.targetChangesPerMin < 32, String(cold.targetChangesPerMin));
  check('and the reason counts the days', /days since your last go/.test(cold.reason), cold.reason);
  const justInside = planTempo(series(30, 31, 32), iso(RUST_DAYS - 1));
  check('a fortnight is not yet cold', justInside.trend !== 'rust', justInside.trend);
}

console.log('\nThe rule, over every shape a history can take\n');
{
  // The claim in the header, checked rather than asserted: only the climbing
  // branch may exceed the runs it read, and only by the nudge.
  const shapes = [];
  const values = [8, 12, 17, 23, 30, 31, 44, 60, 90];
  for (const a of values) for (const b of values) for (const c of values) for (const d of values) {
    shapes.push([a, b, c, d]);
  }
  for (const n of values) shapes.push([n], [n, n], [n, Math.round(n * 1.4)]);

  let overWindow = 0;
  let overNudge = 0;
  let notPositive = 0;
  let badBeats = 0;
  let outOfBand = 0;
  for (const runs of shapes) {
    const p = plan(...runs);
    const best = Math.max(...window(runs));
    const latest = runs[runs.length - 1];
    if (p.targetChangesPerMin > best && p.trend !== 'progress') overWindow += 1;
    if (p.trend === 'progress' && p.targetChangesPerMin > Math.round(latest * 1.05)) overNudge += 1;
    if (!(p.targetChangesPerMin >= 1)) notPositive += 1;
    if (![2, 4, 8].includes(p.beatsPerChange)) badBeats += 1;
    if (p.bpm < MIN_BPM || p.bpm > MAX_BPM || p.bpm % 2 !== 0) outOfBand += 1;
  }
  console.log(`    ${shapes.length} histories`);
  check('nothing but the climbing branch ever asks for more than the runs it read',
    overWindow === 0, `${overWindow} did`);
  check('and the climbing branch never asks for more than five per cent over the last run',
    overNudge === 0, `${overNudge} did`);
  check('every prescription is a pace someone could play', notPositive === 0,
    `${notPositive} were not`);
  check('the hold is always one of the three the metronome can accent', badBeats === 0,
    `${badBeats} were not`);
  check('and the click stays inside the band, on an even number', outOfBand === 0,
    `${outOfBand} were not`);
}

console.log('\nThe click the target turns into\n');
{
  const slow = plan(9, 9, 9, 9);
  check('a slow player is not given an unusably slow click', slow.bpm >= 60, String(slow.bpm));
  check('by holding each chord longer instead', slow.beatsPerChange === 8,
    String(slow.beatsPerChange));
  check('and the reason says how long', /two bars/.test(slow.reason), slow.reason);

  const quick = plan(60, 60, 60, 60);
  check('a quick player is not chased by a 240 click', quick.bpm <= 132, String(quick.bpm));
  check('by changing every two beats', quick.beatsPerChange === 2, String(quick.beatsPerChange));

  const normal = plan(30, 30, 30, 30);
  check('the usual case is one chord per bar', normal.beatsPerChange === 4,
    String(normal.beatsPerChange));
  check('and the click is the pace times the hold',
    normal.bpm === normal.targetChangesPerMin * normal.beatsPerChange,
    `${normal.bpm} vs ${normal.targetChangesPerMin}x${normal.beatsPerChange}`);
}

console.log('\nBlocks with no pace of their own\n');
{
  const given = fixedTempo(96);
  check('a block that names its tempo keeps it', given.bpm === 96, String(given.bpm));
  check('and has no pace to hit', given.targetChangesPerMin === null);
  const bare = fixedTempo(undefined);
  check('one that names none gets the standard click', bare.bpm === DEFAULT_PRACTICE_BPM,
    String(bare.bpm));
  check('a tempo below the metronome band is pulled into it', fixedTempo(5).bpm === MIN_BPM,
    String(fixedTempo(5).bpm));
  check('and one above it too', fixedTempo(900).bpm === MAX_BPM, String(fixedTempo(900).bpm));
  check('an odd tempo is rounded to something a musician would say',
    fixedTempo(97).bpm % 2 === 0, String(fixedTempo(97).bpm));
  check('a block can say its own thing', fixedTempo(80, 'Down strums only.').reason ===
    'Down strums only.');
}

console.log('\nReading a drill\'s history out of the logs\n');
{
  const logs = {
    '2026-07-03': { date: '2026-07-03', routineId: 'r', drillResults: { 'pair:A|D': 20 } },
    '2026-07-01': { date: '2026-07-01', routineId: 'r', drillResults: { 'pair:A|D': 15 } },
    '2026-07-02': { date: '2026-07-02', routineId: 'r', drillResults: { 'pair:A|D': 0 } },
    '2026-07-04': { date: '2026-07-04', routineId: 'r', drillResults: { 'pair:D|E': 40 } },
  };
  const read = drillSeries(logs, 'pair:A|D', 60);
  check('only this drill\'s runs are read', read.length === 2, String(read.length));
  check('and in date order', read[0].date < read[1].date, read.map(r => r.date).join(' '));
  check('a run the mic never heard is not a run', read.every(r => r.value > 0),
    read.map(r => r.value).join(' '));
  // A count over half a minute is twice the count per minute, and the tempo is
  // set per minute. A drill scored over 30 seconds that skipped this would be
  // prescribed at half the pace the player is actually managing.
  const half = drillSeries(logs, 'pair:A|D', 30);
  check('a short drill is normalised to a rate per minute',
    half.map(r => r.value).join() === '30,40', half.map(r => r.value).join());
  check('a missing drill is an empty history, not a crash',
    drillSeries(logs, 'pair:C|G', 60).length === 0);
  check('and an empty history is a plan the coach can still make',
    planTempo(drillSeries(logs, 'pair:C|G', 60), TODAY).bpm === DEFAULT_PRACTICE_BPM);
}

console.log('\nChord Perfect, read against the block it actually ran\n');
{
  // The score is every placement in the block, and drillSeries turns it into a
  // rate by dividing by the length it was played over. Chord Perfect's length is
  // not the length the task asked for: every shape gets a floor of its own, so a
  // 90-second task over five shapes runs 100 seconds. Handed 90, the coach read
  // the player eleven per cent fast and the click then asked for a pace they had
  // never reached, which is the one thing the prescription may not do.
  const POOL = 5;
  const CONFIGURED = 90;
  const real = trainerBlockSeconds(CONFIGURED, POOL);
  check('five shapes at the twenty-second floor is a hundred seconds, not ninety',
    real === 100, String(real));
  check('and the floor only binds when the share is under it',
    trainerBlockSeconds(200, POOL) === 200, String(trainerBlockSeconds(200, POOL)));
  check('a two-shape minute is still a minute', trainerBlockSeconds(60, 2) === 60,
    String(trainerBlockSeconds(60, 2)));

  const logs = {};
  [70, 72, 74].forEach((value, i) => {
    const date = iso(i - 3);
    logs[date] = { date, routineId: 'r', drillResults: { 'pool:A|C|D|E|G': value } };
  });
  const asPlayed = planTempo(drillSeries(logs, 'pool:A|C|D|E|G', real), TODAY);
  const asConfigured = planTempo(drillSeries(logs, 'pool:A|C|D|E|G', CONFIGURED), TODAY);
  check('reading it against the configured length overstates the pace',
    asConfigured.targetChangesPerMin > asPlayed.targetChangesPerMin,
    `${asConfigured.targetChangesPerMin} vs ${asPlayed.targetChangesPerMin}`);
  // 74 placements over the 100 seconds they were played in is 44.4 a minute, and
  // the climbing branch is allowed five per cent over a baseline that already
  // sits under the latest run. Anything past the latest run itself is the coach
  // asking for a pace nobody has recorded.
  const latestPerMinute = (74 * 60) / real;
  check('the pace asked for stays within reach of the run just played',
    asPlayed.targetChangesPerMin <= Math.ceil(latestPerMinute * 1.05),
    `${asPlayed.targetChangesPerMin} against ${latestPerMinute.toFixed(1)}/min just played`);
  check('and the click matches the pace it names',
    Math.abs(asPlayed.bpm / asPlayed.beatsPerChange - asPlayed.targetChangesPerMin) <= 1,
    `${asPlayed.bpm} BPM every ${asPlayed.beatsPerChange} beats vs ${asPlayed.targetChangesPerMin}/min`);
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
