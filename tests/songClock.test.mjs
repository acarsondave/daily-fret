// The clock the chart runs on when the app is keeping time itself.
//
// Everything here is checked against a source the test drives by hand, because
// the two properties that matter are about what happens between readings: the
// position never goes backwards, and it is never lost. The last block models the
// case the design exists for, a suspended audio context, by making the source
// stop advancing rather than by making it report a flag. A fake that keeps
// ticking while claiming to be stopped would let a broken clock pass.

import { SongClock } from '../src/lib/songClock.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// A source with a hand on it. `alive` false is a suspended context: its clock
// stops, which is exactly why the chart holds instead of lurching.
function fakeSource() {
  const state = { t: 0, alive: true };
  return {
    state,
    source: { now: () => state.t, running: () => state.alive },
    tick: (by) => { if (state.alive) state.t += by; },
  };
}

console.log('\nPlaying\n');
{
  const f = fakeSource();
  const clock = new SongClock(f.source);
  clock.start(0);
  check('it starts where it was told to', near(clock.read().seconds, 0));
  f.tick(1);
  check('a second later it is a second later', near(clock.read().seconds, 1));
  f.tick(0.25);
  check('and a quarter later, a quarter', near(clock.read().seconds, 1.25));
  check('it reports itself as playing', clock.read().playing === true);
  check('at normal pace', clock.read().rate === 1);
}

console.log('\nA count-in is a negative start, not an extra bar\n');
{
  const f = fakeSource();
  const clock = new SongClock(f.source);
  clock.start(-2);
  check('it begins before the first downbeat', near(clock.read().seconds, -2));
  f.tick(2);
  check('and arrives at zero on time', near(clock.read().seconds, 0));
  f.tick(0.5);
  check('then carries straight on', near(clock.read().seconds, 0.5));
}

console.log('\nPausing keeps the place\n');
{
  const f = fakeSource();
  const clock = new SongClock(f.source);
  clock.start(0);
  f.tick(3);
  clock.pause();
  check('the position is held', near(clock.read().seconds, 3));
  f.tick(10);
  check('and ten seconds of nothing changes nothing', near(clock.read().seconds, 3));
  check('a paused clock says it is not playing', clock.read().playing === false);
  clock.resume();
  check('resuming does not jump', near(clock.read().seconds, 3));
  f.tick(1);
  check('it picks up from where it stopped', near(clock.read().seconds, 4));
  check('and not from where the wall clock got to', !near(clock.read().seconds, 14));
}

console.log('\nSeeking\n');
{
  const f = fakeSource();
  const clock = new SongClock(f.source);
  clock.start(0);
  f.tick(5);
  clock.seek(20);
  const first = clock.read();
  check('the clock is where it was sent', near(first.seconds, 20));
  check('and the first read after a seek is a snap', first.snapped === true);
  check('the next one is not', clock.read().snapped === false);
  f.tick(1);
  check('and it runs on from there', near(clock.read().seconds, 21));
  clock.seek(2);
  check('seeking backwards works too', near(clock.read().seconds, 2));
}

console.log('\nChanging pace keeps the place\n');
{
  const f = fakeSource();
  const clock = new SongClock(f.source);
  clock.start(0);
  f.tick(4);
  check('four seconds in', near(clock.read().seconds, 4));
  clock.setRate(0.5);
  check('the change itself moves nothing', near(clock.read().seconds, 4));
  f.tick(4);
  check('half pace covers half the ground', near(clock.read().seconds, 6));
  check('and the rate is reported', clock.read().rate === 0.5);
  clock.setRate(2);
  check('the second change also holds the place', near(clock.read().seconds, 6));
  f.tick(1);
  check('double pace covers twice', near(clock.read().seconds, 8));
  clock.setRate(0);
  check('a pace of zero is refused', clock.read().rate === 2);
  clock.setRate(Number.NaN);
  check('so is one that is not a number', clock.read().rate === 2);
}

console.log('\nIt never runs backwards\n');
{
  const f = fakeSource();
  const clock = new SongClock(f.source);
  clock.start(-4);
  let last = -Infinity;
  let backwards = 0;
  const script = [
    () => f.tick(0.3), () => f.tick(0.7), () => clock.setRate(0.25), () => f.tick(2),
    () => clock.pause(), () => f.tick(3), () => clock.resume(), () => f.tick(0.5),
    () => clock.setRate(1.5), () => f.tick(1), () => f.tick(0.016), () => f.tick(0.016),
  ];
  for (const step of script) {
    step();
    const now = clock.read().seconds;
    if (now < last - 1e-12) backwards += 1;
    last = now;
  }
  check('through pauses, seeks and pace changes it only ever moves forward', backwards === 0, `${backwards} steps went back`);
}

console.log('\nA reading taken a hair before the anchor is not a negative position\n');
{
  // The clamp inside the clock. Both real sources are monotonic, so this is not
  // about a clock running backwards; it is about the first read of a freshly
  // started clock, taken at or fractionally before the moment it was anchored,
  // reporting the start rather than a moment before it.
  const f = fakeSource();
  const clock = new SongClock(f.source);
  clock.start(5);
  check('the first read is the start', near(clock.read().seconds, 5));
  f.state.t -= 0.002;
  check('and a reading a hair earlier is still the start', clock.read().seconds === 5,
    String(clock.read().seconds));
}

console.log('\nA context that stops advancing holds the chart\n');
{
  const f = fakeSource();
  const clock = new SongClock(f.source);
  clock.start(0);
  f.tick(2);
  check('two seconds in', near(clock.read().seconds, 2));

  // The camera takes the audio route. The context suspends, its clock stops,
  // and sometimes nothing at all is fired to say so.
  f.state.alive = false;
  f.tick(6); // wall time passes; the audio clock does not
  check('the chart holds where it was', near(clock.read().seconds, 2));
  check('and it says the sound has gone', clock.read().playing === false);

  f.state.alive = true;
  f.tick(0.5);
  check('when it comes back the chart resumes from where it held', near(clock.read().seconds, 2.5));
  check('rather than lurching forward through the silence', !near(clock.read().seconds, 8.5));
  check('and it says it is playing again', clock.read().playing === true);
}

console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
