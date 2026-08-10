// What Progress claims about whether the practice is working.
//
// The panel used to compare the first result ever recorded to the latest, which
// on a long history reports a large gain forever while the last month slides.
// It also rounded a small decline to "0%" and drew it as a flat line. Both are
// the app flattering the player, which is the one thing it must never do.

import { pickFocus, recentTrend, recommendNext, trendLabel } from '../src/lib/drillStats.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?': '+d:''}`); };

const series = (...values) =>
  values.map((value, i) => ({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, value }));

const pair = (key, values, today = null) => ({
  key, kind: 'pair', label: key, unit: 'cpm', from: 'A', to: 'D',
  best: values.length ? Math.max(...values) : 0, today, series: series(...values),
});

console.log('\nA trend about now, not about the beginning\n');
{
  check('one run is not a trend', recentTrend(series(40)) === null);

  // The defect, stated: months of early gain followed by a month of decline.
  const climbThenSlide = recentTrend(series(20, 30, 40, 50, 60, 70, 60, 55, 50));
  check('a slide after a long climb reads as a slide', climbThenSlide.direction === 'down',
    JSON.stringify(climbThenSlide));

  const rising = recentTrend(series(40, 40, 40, 50, 50, 50));
  check('a rise reads as a rise', rising.direction === 'up');
  check('with the percentage of the recent window', Math.round(rising.percent) === 25,
    String(rising.percent));
  check('and says what it compared', rising.basis === 'last 3 sessions against the 3 before',
    rising.basis);

  const flat = recentTrend(series(40, 40, 40, 40));
  check('no movement is level', flat.direction === 'flat' && flat.percent === 0);

  const short = recentTrend(series(40, 44));
  check('two runs compare one against one', short.window === 1, JSON.stringify(short));
  check('and say so', short.basis === 'latest session against the one before', short.basis);

  const fromNothing = recentTrend(series(0, 0, 30, 40));
  check('a rise from zero has no percentage to give', fromNothing.percent === null);
  check('but still has a direction', fromNothing.direction === 'up');

  const window = recentTrend(series(10, 10, 10, 10, 10, 10, 10, 10, 20));
  check('the window never grows past its limit', window.window === 3, String(window.window));
}

console.log('\nA decline is never rounded into a flat line\n');
{
  const barely = recentTrend(series(1000, 997));
  check('a fraction of a percent is still a decline', barely.direction === 'down');
  check('and is labelled as one rather than as zero', trendLabel(barely) === '-<1%',
    trendLabel(barely));
  check('a real rise carries its sign', trendLabel(recentTrend(series(40, 50))) === '+25%',
    trendLabel(recentTrend(series(40, 50))));
  check('level says level', trendLabel(recentTrend(series(40, 40))) === 'level');
  check('a rise off zero says up without a number',
    trendLabel(recentTrend(series(0, 30))) === 'up');
}

console.log('\nWhat the panel opens on, without being asked\n');
{
  check('nothing to show is null', pickFocus([]) === null);

  const stale = pair('stale', [90, 90, 90, 90]);
  const moving = pair('moving', [40, 40, 60, 60]);
  check('the drill that moved wins over the highest number',
    pickFocus([stale, moving]).key === 'moving');

  const drilledToday = pair('today', [30, 31], 31);
  check('but today’s run wins over everything',
    pickFocus([stale, moving, drilledToday]).key === 'today');

  const single = pair('single', [70]);
  check('a lone run is not put on a chart as if it were a trend',
    pickFocus([single, moving]).key === 'moving');
  check('unless it is all there is', pickFocus([single]).key === 'single');
}

console.log('\nWhat to practise next\n');
{
  check('no history, no recommendation', recommendNext([]) === null);
  check('and a pair that was never run is not recommended',
    recommendNext([pair('empty', [])]) === null);

  const slow = pair('slow', [20, 20, 20, 20]);
  const sliding = pair('sliding', [60, 60, 40, 40]);
  const reco = recommendNext([slow, sliding]);
  check('a pair sliding backwards beats a merely slow one', reco.stat.key === 'sliding',
    reco.stat.key);
  check('and says why', reco.reason === 'Slipping on your recent runs', reco.reason);

  const steady = recommendNext([slow, pair('fast', [80, 80, 80, 80])]);
  check('with nothing sliding, the slowest is the pick', steady.stat.key === 'slow');
  check('named as not drilled today', steady.reason === 'Not drilled today', steady.reason);

  const doneToday = recommendNext([pair('slow', [20, 20], 20), pair('fast', [80, 80], 80)]);
  check('everything done today still returns the slowest', doneToday.stat.key === 'slow');
  check('with a reason that does not pretend otherwise',
    doneToday.reason === 'Your slowest pair', doneToday.reason);

  const untouched = recommendNext([pair('slow', [20, 20], 20), pair('rested', [90, 90])]);
  check('a pair left alone today is preferred over one already drilled',
    untouched.stat.key === 'rested');
}

console.log('\nNo em dashes in anything the panel says\n');
{
  const said = [
    recentTrend(series(40, 50)).basis,
    recommendNext([pair('a', [20, 20, 40, 10])]).reason,
    recommendNext([pair('a', [20, 20])]).reason,
    recommendNext([pair('a', [20, 20], 20)]).reason,
    trendLabel(recentTrend(series(40, 50))),
  ];
  check('none of them', said.every((s) => !/[—–]/.test(s)), said.join(' | '));
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
