// The results ring, which now has to carry two numbers instead of one.
//
// The sentence under the ring used to say "+7 over your best" and "4 to beat
// your best". Those sentences are gone and the ring says it instead: the arc
// past the mark is the first, the gap short of the mark is the second. That
// only holds if the mark is where the player's best actually is, so the scale
// is asserted here rather than eyeballed on a results card.

import { ringScale, BEST_AT } from '../src/lib/ringScale.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };

console.log('\nA counting drill, where the best is the only scale there is\n');
{
  const first = ringScale(23, 0);
  check('a first run has no mark to beat', first.benchmark === null);
  check('and lands where the mark will appear', first.progress === BEST_AT, String(first.progress));

  const nothing = ringScale(0, 0);
  check('a first run that counted nothing draws nothing', nothing.progress === 0);

  const matched = ringScale(30, 30);
  check('matching the best lands exactly on the mark', matched.progress === BEST_AT
    && matched.benchmark === BEST_AT, JSON.stringify(matched));

  const short = ringScale(26, 30);
  check('falling short stops short of the mark', short.progress < short.benchmark,
    JSON.stringify(short));
  // 4 changes short of 30 is 13.3% of the run, and the gap on the ring is the
  // same 13.3% of the way to the mark. The gap is the sentence.
  check('and the gap is the shortfall, to scale',
    Math.abs((short.benchmark - short.progress) / short.benchmark - 4 / 30) < 1e-9,
    JSON.stringify(short));

  const over = ringScale(37, 30);
  check('beating it reaches past the mark', over.progress > over.benchmark, JSON.stringify(over));
  check('and the overshoot is the gain, to scale',
    Math.abs((over.progress - over.benchmark) / over.benchmark - 7 / 30) < 1e-9,
    JSON.stringify(over));

  check('an extraordinary run fills the ring rather than escaping it',
    ringScale(300, 30).progress === 1);
}

console.log('\nA drill with a ceiling of its own\n');
{
  const run = ringScale(78, 64, 100);
  check('the number is a fraction of the ceiling', Math.abs(run.progress - 0.78) < 1e-9,
    String(run.progress));
  check('and the mark is the best on the same scale', Math.abs(run.benchmark - 0.64) < 1e-9,
    String(run.benchmark));
  check('a first run still has no mark', ringScale(78, 0, 100).benchmark === null);
  check('a perfect run fills the ring', ringScale(100, 64, 100).progress === 1);
  check('nothing measured draws nothing', ringScale(0, 64, 100).progress === 0);
}

console.log('\nDuring the run, where it has to be readable while it moves\n');
{
  // The same call every time a change is counted. What matters is that the mark
  // never moves under the growing arc: the player is aiming at a fixed place.
  const marks = [0, 5, 17, 29, 30, 44].map((v) => ringScale(v, 30).benchmark);
  check('the mark stays put as the count climbs', marks.every((m) => m === BEST_AT),
    JSON.stringify(marks));
  const arcs = [0, 5, 17, 29, 30, 44].map((v) => ringScale(v, 30).progress);
  check('and the arc only ever grows', arcs.every((p, i) => i === 0 || p >= arcs[i - 1]),
    JSON.stringify(arcs));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
