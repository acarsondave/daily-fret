// Time signatures and accents, as arithmetic.
//
// Module 6 is the first place the course leaves four: 6/8 is counted in six
// eighth-note beats with the weight on one and a lighter weight on four. The
// click has to say that out loud, because a beginner cannot hear "compound
// time" from a description, and the strumming drills have to agree with it
// about where a bar starts or every pattern is scored a few beats rotated.

import {
  METERS,
  meterOf,
  cycleAccents,
  accentFor,
  countInFor,
  nextAccentLevel,
  normaliseAccents,
} from '../src/audio/meter.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' - '+d:''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nThe three meters\n');
{
  check('4/4 is four beats, the weight on one', METERS['4/4'].beats === 4 &&
    same(METERS['4/4'].accents, ['strong', 'none', 'none', 'none']));
  check('3/4 is three beats, the weight on one', METERS['3/4'].beats === 3 &&
    same(METERS['3/4'].accents, ['strong', 'none', 'none']));
  check('6/8 is six eighth-note beats: strong one, lighter four',
    METERS['6/8'].beats === 6 &&
    same(METERS['6/8'].accents, ['strong', 'none', 'none', 'light', 'none', 'none']));
  check('6/8 clicks eighths, the others quarters',
    METERS['6/8'].pulse === 'eighth' && METERS['4/4'].pulse === 'quarter' && METERS['3/4'].pulse === 'quarter');
  check('an unknown id falls back to 4/4', meterOf('7/8').id === '4/4' && meterOf(undefined).id === '4/4');
}

console.log('\nThe accent cycle the click plays\n');
{
  check('4/4 on its own', same(cycleAccents('4/4'), ['downbeat', 'beat', 'beat', 'beat']));
  check('6/8: bell, stick, stick, lighter mark, stick, stick',
    same(cycleAccents('6/8'), ['downbeat', 'beat', 'beat', 'midbar', 'beat', 'beat']));
  check('3/4', same(cycleAccents('3/4'), ['downbeat', 'beat', 'beat']));
  // The change-rate model hands the click a cycle of 2, 4 or 8 beats per chord.
  // These have to come out exactly as they did before meters existed.
  check('4/4 over an eight-beat change: halfway mark, as before',
    same(cycleAccents('4/4', undefined, 8), ['downbeat', 'beat', 'beat', 'beat', 'midbar', 'beat', 'beat', 'beat']));
  check('4/4 over a two-beat change: no halfway mark, as before',
    same(cycleAccents('4/4', undefined, 2), ['downbeat', 'beat']));
  check('6/8 held for two bars: the second bar line is the lighter mark',
    same(cycleAccents('6/8', undefined, 12),
      ['downbeat', 'beat', 'beat', 'midbar', 'beat', 'beat', 'midbar', 'beat', 'beat', 'midbar', 'beat', 'beat']));
  check('a cycle that is not whole bars still opens on the bell',
    cycleAccents('3/4', undefined, 4)[0] === 'downbeat' && cycleAccents('3/4', undefined, 4).length === 4);
}

console.log('\nAccents are the player\'s to set\n');
{
  const mine = ['strong', 'light', 'none', 'light', 'none', 'none'];
  check('a custom 6/8 accent row is honoured',
    same(cycleAccents('6/8', mine), ['downbeat', 'midbar', 'beat', 'midbar', 'beat', 'beat']));
  check('beat one stays strong whatever is stored: it is where the bar starts',
    normaliseAccents('6/8', ['none', 'none', 'none', 'light', 'none', 'none'])[0] === 'strong');
  check('a stored row of the wrong length is the default, not a guess',
    same(normaliseAccents('6/8', ['strong', 'light']), METERS['6/8'].accents));
  check('tapping a beat cycles it: plain, light, strong, plain',
    nextAccentLevel('none') === 'light' && nextAccentLevel('light') === 'strong' && nextAccentLevel('strong') === 'none');
}

console.log('\nWhere a beat falls\n');
{
  const six = cycleAccents('6/8');
  check('position 0 and 6 are bar lines', accentFor(0, 6, six) === 'downbeat' && accentFor(6, 6, six) === 'downbeat');
  check('position 3 and 9 are the lighter four', accentFor(3, 6, six) === 'midbar' && accentFor(9, 6, six) === 'midbar');
  check('a count-in is its own voice', [-6, -1].every((p) => accentFor(p, 6, six) === 'countin'));
  // The old two-argument form is what every existing caller uses.
  check('without a row, the old rule', accentFor(4, 8) === 'midbar' && accentFor(1, 4) === 'beat');
}

console.log('\nCounting in\n');
{
  check('4/4 counts in four', countInFor('4/4') === 4);
  check('3/4 counts in three', countInFor('3/4') === 3);
  check('6/8 counts in one bar of six', countInFor('6/8') === 6);
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
