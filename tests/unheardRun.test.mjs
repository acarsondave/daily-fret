// A run the microphone could not hear is not a result.
//
// `useSignalMeter` classifies the input as weak or unreadable throughout every
// drill, and the classification was discarded the moment the run ended. So a run
// of eleven changes taken through a failing microphone was written to the
// history exactly like a run of eleven changes played badly: it reset the
// three-run readiness streak and pulled the next tempo prescription down with
// it. The owner's July history holds three of them.
//
// The dangerous half of this fix is the other direction. The whole product rests
// on not flattering the player, so most of what follows is the cases that must
// STILL count: a genuinely bad run on a working microphone, a bad run on a
// microphone that merely wobbled, and the early runs of a drill with no history
// to fall short of. If this file ever goes quiet on those, the app has started
// hiding bad sessions from the person who played them.

import {
  isRunUnheard,
  recentBaseline,
  SHORTFALL_RATIO,
  UNHEARD_SHARE_MIN,
  BASELINE_RUNS_MIN,
} from '../src/lib/unheardRun.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };

const withheld = (label, input, expected) => {
  const got = isRunUnheard(input);
  check(label, got === expected, `withheld=${got}, wanted ${expected} (${JSON.stringify(input)})`);
};

console.log('\nThe baseline is the drill\'s own recent runs\n');
{
  check('two runs are not a baseline', recentBaseline([30, 32]) === null, String(recentBaseline([30, 32])));
  check('three are', recentBaseline([30, 32, 34]) === 32, String(recentBaseline([30, 32, 34])));
  check('and only the last three count',
    recentBaseline([2, 2, 2, 30, 32, 34]) === 32, String(recentBaseline([2, 2, 2, 30, 32, 34])));
  // The median, so one freak session inside the window cannot set the bar the
  // next run is judged against.
  check('one outlier in the window does not move it',
    recentBaseline([30, 90, 32]) === 32, String(recentBaseline([30, 90, 32])));
  check('the window size is the one tempo coaching judges against', BASELINE_RUNS_MIN === 3);
}

console.log('\nA run the microphone could not hear is withheld\n');
{
  // The shape of the real July runs: a drill worth about 30 a minute, a run of
  // 11, and a meter that spent most of it saying weak or unreadable.
  withheld('eleven changes on a drill worth thirty, half of it unreadable',
    { rate: 11, baseline: 30, unheardShare: 0.5 }, true);
  withheld('and the same run with the meter bad for exactly a quarter of it',
    { rate: 11, baseline: 30, unheardShare: UNHEARD_SHARE_MIN }, true);
  withheld('a run of nothing at all through a dead-sounding microphone',
    { rate: 0, baseline: 30, unheardShare: 0.9 }, true);
}

console.log('\nA bad run on a working microphone still counts\n');
{
  withheld('the same eleven changes, heard cleanly throughout',
    { rate: 11, baseline: 30, unheardShare: 0 }, false);
  withheld('and heard cleanly for all but a moment',
    { rate: 11, baseline: 30, unheardShare: 0.1 }, false);
  // The line has to sit clear of an ordinary bad day. lib/tempo.ts already calls
  // 85% of baseline "a real dip" and eases the click for it; everything between
  // that and this belongs in the record.
  withheld('a real dip of the kind tempo coaching already eases for',
    { rate: 30 * 0.85, baseline: 30, unheardShare: 0.9 }, false);
  withheld('a run just above the shortfall line, however bad the signal was',
    { rate: 30 * SHORTFALL_RATIO, baseline: 30, unheardShare: 1 }, false);
  withheld('a zero on a microphone that was working the whole time',
    { rate: 0, baseline: 30, unheardShare: 0 }, false);
}

console.log('\nAnd a drill with no history to fall short of always counts\n');
{
  withheld('the first run of a pair, whatever the signal did',
    { rate: 3, baseline: null, unheardShare: 1 }, false);
  // A baseline of zero is a drill whose prior runs were all nothing. There is no
  // shortfall against nothing, and treating one as a signal failure would stop a
  // drill that has never been heard from ever recording its first real number.
  withheld('a drill whose recent runs were all zero', { rate: 0, baseline: 0, unheardShare: 1 }, false);
}

console.log('\nBoth halves are required, never either alone\n');
{
  withheld('a bad signal on a normal run', { rate: 30, baseline: 30, unheardShare: 1 }, false);
  withheld('a heavy shortfall on a clean signal', { rate: 1, baseline: 30, unheardShare: 0 }, false);
  withheld('both together', { rate: 1, baseline: 30, unheardShare: 1 }, true);
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
