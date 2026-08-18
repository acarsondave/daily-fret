// Whether a result can be repeated.
//
// The rule under test is deliberately strict: three runs running, no dip
// tolerated. An earlier draft allowed one miss in the last four, and the case
// named "a dip resets it" below is the one that reversed the decision. If that
// case ever goes green while the rule still claims to be strict, the model has
// quietly gone back to flattering the player.

import {
  readiness,
  everHeld,
  HELD_RUNS,
  STALE_DAYS,
  CHANGES_BAR,
  CHORD_BAR,
  ROTATION_BAR,
} from '../src/lib/readiness.ts';
import { RUST_DAYS } from '../src/lib/tempo.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

// Runs on consecutive days ending on 2026-08-01, which is `today` everywhere
// below unless a case states its own.
const TODAY = '2026-08-01';
const dayBefore = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const runs = (...values) =>
  values.map((value, i) => ({ date: dayBefore(TODAY, values.length - 1 - i), value }));

const at = (values, today) => readiness(runs(...values), CHANGES_BAR, today ?? TODAY);

console.log('\nNothing to say\n');
{
  const r = readiness([], CHANGES_BAR, TODAY);
  check('no runs is not a state to draw', r.state === 'none' && r.label === null);
  check('and says nothing rather than nothing-yet', r.evidence === '', JSON.stringify(r.evidence));
  check('a run of zero is not a run', at([0]).state === 'none');
  check('nor is a negative one', at([-5]).state === 'none');
  check('nor is a broken one', readiness([{ date: TODAY, value: NaN }], CHANGES_BAR, TODAY).state === 'none');
}

console.log('\nClimbing toward held\n');
{
  const under = at([24]);
  check('under the bar is working, not a miss to be scolded for', under.state === 'working');
  check('and names the number and the rule', /24 on your last run/.test(under.evidence)
    && /three runs running at 30/.test(under.evidence), under.evidence);

  const one = at([36]);
  check('one clearing run is a hit, not held', one.state === 'hit' && one.streak === 1);
  check('and says how many more', /two more at 30 or better make it held/i.test(one.evidence), one.evidence);
  check('with a countable label', one.label === '1 of 3', one.label);

  const two = at([31, 36]);
  check('two is still a hit', two.state === 'hit' && two.streak === 2);
  check('and the sentence agrees in number', /one more at 30 or better makes it held/i.test(two.evidence),
    two.evidence);
  check('naming both runs', /31 and 36 on your last two runs/.test(two.evidence), two.evidence);

  const three = at([34, 31, 36]);
  check('three running is held', three.state === 'held' && three.label === 'Held');
  check('and states the three numbers', /34, 31 and 36 on your last three runs/.test(three.evidence),
    three.evidence);
  check('and names the bar it cleared', /at 30 or better/.test(three.evidence), three.evidence);
}

console.log('\nStrict: a dip resets it\n');
{
  // The reversal, stated as a test. Pass, miss, pass, pass is three clearing
  // runs out of four and the player still cannot do it reliably.
  const dipped = at([36, 24, 33, 35]);
  check('a miss two runs back is not forgiven', dipped.state === 'hit', dipped.state);
  check('and the streak counts only from the miss forward', dipped.streak === 2, String(dipped.streak));
  check('so the player is told they are one short', /one more/i.test(dipped.evidence), dipped.evidence);

  const recovered = at([36, 24, 33, 35, 31]);
  check('three clean runs after the dip is held again', recovered.state === 'held');

  check('a value exactly on the bar clears it',
    at([30, 30, 30]).state === 'held');
  check('a value one under does not',
    at([30, 29, 30]).state === 'hit');
}

console.log('\nResting is not failing\n');
{
  // Three clearing runs spread over three weeks, the last of them recent. The
  // rule counts runs, so the gaps are invisible.
  const spread = readiness(
    [
      { date: '2026-07-10', value: 34 },
      { date: '2026-07-21', value: 31 },
      { date: '2026-07-30', value: 36 },
    ],
    CHANGES_BAR,
    TODAY,
  );
  check('runs are counted, not calendar days', spread.state === 'held', spread.evidence);

  // The blocked-microphone case: a session that recorded a zero sits between
  // two real runs. Counting it as a failure would let a permissions problem
  // wipe out weeks of evidence.
  check('a silent session does not break a streak', at([34, 0, 31, 36]).state === 'held');
}

console.log('\nGoing cold\n');
{
  const fresh = at([34, 31, 36], dayBefore(TODAY, -STALE_DAYS));
  check(`held survives exactly ${STALE_DAYS} idle days`, fresh.state === 'held', fresh.evidence);

  const gone = at([34, 31, 36], dayBefore(TODAY, -(STALE_DAYS + 1)));
  check('and lapses the day after', gone.state === 'lapsed', gone.evidence);
  check('the lapse keeps the streak rather than pretending it never happened', gone.streak === 3);
  check('it counts the idle days', /not run for 15 days/.test(gone.evidence), gone.evidence);
  check('and says what would bring it back', /one run at 30 or better/i.test(gone.evidence), gone.evidence);

  // Only a claim that was made can lapse. Two clearing runs is not a claim.
  const stalePartial = at([31, 36], dayBefore(TODAY, -60));
  check('a partial streak going cold is still just a hit', stalePartial.state === 'hit', stalePartial.state);
}

console.log('\nA long run says so\n');
{
  const long = at([33, 34, 35, 36, 37]);
  check('past three it reports the real streak', long.state === 'held' && long.streak === 5);
  check('and says how long', /5 runs in a row at 30 or better/.test(long.evidence), long.evidence);
  check('while still showing the last three', /last three were 35, 36 and 37/.test(long.evidence),
    long.evidence);
}

console.log('\nNumbers as the player would write them\n');
{
  const floaty = readiness(
    [
      { date: '2026-07-30', value: 33.6 },
      { date: '2026-07-31', value: 30.2 },
      { date: '2026-08-01', value: 35.4 },
    ],
    CHANGES_BAR,
    TODAY,
  );
  check('a measured rate is rounded for reading', /34, 30 and 35/.test(floaty.evidence), floaty.evidence);

  // 29.6 against a bar of 30 used to print "30 on your last run. Held is three
  // runs running at 30 or better", which is one sentence disagreeing with
  // itself. Rounding may never carry a value across the bar it missed.
  const nearMiss = at([30, 30, 29.6]);
  check('a near miss is still a miss', nearMiss.state === 'working', nearMiss.state);
  check('and the number shown is not rounded into a pass',
    /29\.6 on your last run/.test(nearMiss.evidence), nearMiss.evidence);
  check('while a value that rounds down and still passes stays whole',
    /30, 30 and 30 on your last three runs/.test(at([30.4, 30.2, 30.4]).evidence),
    at([30.4, 30.2, 30.4]).evidence);
}

console.log('\nBars, and the two models that must agree\n');
{
  check('the changes bar is the course\'s own 30', CHANGES_BAR === 30);
  check('the app\'s own per-chord bar is lower', CHORD_BAR === 20 && CHORD_BAR < CHANGES_BAR);
  check('rotation sits between them', ROTATION_BAR === 25);
  check('held takes three runs', HELD_RUNS === 3);
  // If these ever drift, the metronome eases the tempo for rust while the mark
  // still claims the skill is current, and the app contradicts itself on one
  // screen.
  check('readiness and the tempo model agree on when evidence goes cold',
    STALE_DAYS === RUST_DAYS, `readiness ${STALE_DAYS}, tempo ${RUST_DAYS}`);

  // The bar is a parameter, not a constant baked into the sentences.
  const rotation = readiness(runs(26, 27, 28), ROTATION_BAR, TODAY);
  check('another drill\'s bar is used and quoted', rotation.state === 'held'
    && /at 25 or better/.test(rotation.evidence), rotation.evidence);
}

console.log('\nEdge cases\n');
{
  check('a single run held long ago is a hit, not a lapse',
    at([40], dayBefore(TODAY, -90)).state === 'hit');
  check('an unparseable date does not crash',
    readiness([{ date: 'nonsense', value: 40 }], CHANGES_BAR, TODAY).state === 'hit');
  check('a huge history is still read from the end',
    readiness(
      Array.from({ length: 500 }, (_, i) => ({ date: dayBefore(TODAY, 500 - i), value: i < 497 ? 5 : 40 })),
      CHANGES_BAR,
      TODAY,
    ).state === 'held');
  check('every state carries a sentence except the empty one',
    [at([24]), at([36]), at([31, 36]), at([34, 31, 36]), at([34, 31, 36], dayBefore(TODAY, -40))]
      .every((r) => r.evidence.length > 0));
}

console.log('\nWritten like a person wrote it\n');
{
  // "38 on your last run. two more at 30 or better make it held" shipped past a
  // case-insensitive assertion and was only caught by looking at the screen. A
  // sentence that opens in lower case is the tell that a string was assembled
  // rather than written.
  const every = [
    at([24]), at([36]), at([31, 36]), at([34, 31, 36]), at([33, 34, 35, 36, 37]),
    at([34, 31, 36], dayBefore(TODAY, -40)),
  ];
  const badly = every
    .flatMap((r) => r.evidence.split(/(?<=\.)\s+/))
    .filter((s) => s.length > 0 && !/^[A-Z0-9]/.test(s));
  check('every sentence opens in upper case or on a number', badly.length === 0, badly.join(' | '));
  check('and every one of them ends in a full stop',
    every.every((r) => r.evidence.endsWith('.')), every.map((r) => r.evidence).join(' | '));
}

// everHeld is the one sticky reading in the model, and stickiness is exactly the
// property that made the old progression model dishonest. It exists for locks
// only, so what it must get right is the difference between "has done it" and
// "can do it now", in both directions.
console.log('\nWhether it was ever held, which is a different question\n');
{
  const of = (...values) => everHeld(runs(...values), CHANGES_BAR);
  check('one good run was never held', !of(40));
  check('nor two', !of(40, 33));
  check('three running was', of(31, 33, 30));
  check('and stays true however badly it goes afterwards', of(31, 33, 30, 4, 2, 1));
  check('three clearing runs split by a dip were not', !of(31, 33, 4, 30, 32),
    'the dip means no three in a row');
  check('a streak anywhere in the history counts, not just at the end',
    of(4, 31, 33, 30, 4));
  check('the bar is respected exactly',
    of(CHANGES_BAR, CHANGES_BAR, CHANGES_BAR) && !of(CHANGES_BAR - 1, CHANGES_BAR, CHANGES_BAR),
    'at the bar counts, under it does not');
  check('a run the mic never heard is skipped rather than counted as a failure',
    of(31, 33, 0, 30), 'a zero is silence, not a bad run');
  check('nothing recorded was never held', !everHeld([], CHANGES_BAR));
  // The two readings have to disagree, or the sticky one has no reason to exist.
  const cold = runs(31, 33, 30);
  check('a lapsed drill is not held now but was held once',
    readiness(cold, CHANGES_BAR, dayBefore(TODAY, -(STALE_DAYS + 1))).state === 'lapsed' &&
      everHeld(cold, CHANGES_BAR));
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
