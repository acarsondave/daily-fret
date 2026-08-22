// The clock the chart is drawn against.
//
// The player's own getCurrentTime() moves in visible steps, so the chart
// interpolates between polls and corrects itself against each new reading. Two
// things have to hold for that to be safe: while the record is playing the
// clock never runs backwards, and anything that is not ordinary playback (a
// seek, an ad, a stall, a speed change) throws the projection away rather than
// easing towards a number it can no longer reach.
//
// Both are checked here with a wall clock the test supplies, so nothing depends
// on a real timer or a real video.

import {
  MAX_CORRECTION_FRACTION,
  MediaClock,
  SNAP_SECONDS,
} from '../src/lib/mediaClock.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const playing = (clock, mediaSeconds, wallMs, rate = 1) =>
  clock.sample({ mediaSeconds, wallMs, playing: true, rate });

console.log('\nFilling in the frames between polls\n');
{
  const clock = new MediaClock();
  check('an untouched clock admits it has nothing', clock.ready === false);
  playing(clock, 10, 0);
  check('and then it does', clock.ready === true);
  check('the first reading is taken as read', near(clock.read(0).seconds, 10));
  check('the first sample counts as a snap', clock.read(0).snapped === true);
  check('half a second later it is half a second later', near(clock.read(500).seconds, 10.5));
  check('a whole second later, a whole second', near(clock.read(1000).seconds, 11));
  check('and it reports what the record is doing', clock.read(1000).playing === true);
  check('and at what speed', clock.read(1000).rate === 1);
}

console.log('\nAgreeing with the player again, without a jump\n');
{
  const clock = new MediaClock();
  playing(clock, 10, 0);
  // The player is a tenth of a second ahead of where we projected. A tenth of a
  // second is not worth a visible jump; it is worth a slightly fast clock.
  playing(clock, 11.1, 1000);
  check('a small disagreement is not a snap', clock.read(1000).snapped === false);
  check('and does not move the chart', near(clock.read(1000).seconds, 11));
  check('it closes rather than jumps', clock.read(1200).seconds > 11.19);
  check('and stays behind the player while it closes', clock.read(1200).seconds < 11.31);
  // The correction runs at a fraction of the playback rate, so it converges in
  // a bounded time and can never outrun playback itself.
  const closeBy = 0.1 / MAX_CORRECTION_FRACTION;
  check('it has agreed by the time the correction allows',
    near(clock.read(1000 + closeBy * 1000).seconds, 11.1 + closeBy, 1e-3));

  // The line above reads the rate out of the source, so it tracks whatever the
  // constant happens to be and cannot pin it. These two say what the rate is
  // for. Too fast and the correction is the visible jump it exists to avoid;
  // too slow and the chart is still arguing with the player a second later.
  check('a tenth of a second is not closed inside a fifth of one',
    clock.read(1200).seconds < 11.3 - 1e-9, `${clock.read(1200).seconds}`);
  check('and is closed within a second of it opening',
    near(clock.read(2000).seconds, 12.1), `${clock.read(2000).seconds}`);

  const monotonic = [];
  let last = -Infinity;
  for (let wall = 1000; wall <= 3000; wall += 16) {
    const now = clock.read(wall).seconds;
    if (now < last) monotonic.push(wall);
    last = now;
  }
  check('the chart never runs backwards while it corrects', monotonic.length === 0);
}

console.log('\nCorrecting the other way\n');
{
  const clock = new MediaClock();
  playing(clock, 10, 0);
  playing(clock, 10.9, 1000); // the player is behind where we projected
  check('a small overrun does not jump either', near(clock.read(1000).seconds, 11));
  let last = -Infinity;
  let backwards = 0;
  for (let wall = 1000; wall <= 3000; wall += 16) {
    const now = clock.read(wall).seconds;
    if (now < last) backwards += 1;
    last = now;
  }
  check('and the chart still only moves forwards', backwards === 0);
  check('slowing down still converges on the player',
    near(clock.read(3000).seconds, 12.9, 1e-3), `${clock.read(3000).seconds}`);
}

console.log('\nWhen there is nothing to ease towards\n');
{
  const clock = new MediaClock();
  playing(clock, 10, 0);
  playing(clock, 90, 1000); // somebody dragged the scrubber
  check('a seek snaps', clock.read(1000).snapped === true);
  check('straight to where the player is', near(clock.read(1000).seconds, 90));
  check('and carries on from there', near(clock.read(2000).seconds, 91));

  const back = new MediaClock();
  playing(back, 90, 0);
  playing(back, 20, 1000); // a loop, or a scrub backwards
  check('seeking backwards snaps too', near(back.read(1000).seconds, 20));

  const edge = new MediaClock();
  playing(edge, 10, 0);
  playing(edge, 11 + SNAP_SECONDS + 0.01, 1000);
  check('just over the threshold is a snap', edge.read(1000).snapped === true);
  const under = new MediaClock();
  playing(under, 10, 0);
  playing(under, 11 + SNAP_SECONDS - 0.01, 1000);
  check('and just under it is not', under.read(1000).snapped === false);

  // Both edge cases above are measured from the constant itself, so they hold
  // whatever it is set to: SNAP_SECONDS could be raised fourteen-fold and this
  // suite would not notice. These two say where the line has to be in seconds a
  // player would feel. A second out is a lag visible against the chart and has
  // to be thrown away; a tenth is ordinary poll jitter and has to be eased.
  const wide = new MediaClock();
  playing(wide, 10, 0);
  playing(wide, 12, 1000);
  check('a whole second out is a seek, not drift', wide.read(1000).snapped === true);
  const narrow = new MediaClock();
  playing(narrow, 10, 0);
  playing(narrow, 11.1, 1000);
  check('and a tenth of a second out is drift, not a seek',
    narrow.read(1000).snapped === false);
}

console.log('\nSpeed\n');
{
  const clock = new MediaClock();
  playing(clock, 10, 0);
  playing(clock, 11, 1000, 0.75);
  check('a speed change is a snap, not a drift', clock.read(1000).snapped === true);
  check('the new rate is reported', clock.read(1000).rate === 0.75);
  check('and time is projected at it', near(clock.read(2000).seconds, 11.75));
  playing(clock, 11.75, 2000, 0.75);
  check('a steady reading at the new rate settles', clock.read(2000).snapped === false);
  check('two seconds of half speed is one second of record', (() => {
    const half = new MediaClock();
    half.sample({ mediaSeconds: 0, wallMs: 0, playing: true, rate: 0.5 });
    return near(half.read(2000).seconds, 1);
  })());
  check('a nonsense rate is refused rather than freezing the chart', (() => {
    const odd = new MediaClock();
    odd.sample({ mediaSeconds: 5, wallMs: 0, playing: true, rate: 0 });
    return odd.read(1000).rate === 1 && near(odd.read(1000).seconds, 6);
  })());
}

console.log('\nPausing, buffering and ads\n');
{
  const clock = new MediaClock();
  playing(clock, 10, 0);
  clock.sample({ mediaSeconds: 11, wallMs: 1000, playing: false, rate: 1 });
  check('a pause stops the chart dead', near(clock.read(1000).seconds, 11));
  check('and it stays stopped', near(clock.read(9000).seconds, 11));
  check('which the reading says out loud', clock.read(9000).playing === false);

  // Buffering arrives as the same "not playing" state, so the chart holds its
  // place instead of sailing on through the stall and coming back ahead.
  clock.sample({ mediaSeconds: 11, wallMs: 9000, playing: false, rate: 1 });
  check('a stall does not advance the chart', near(clock.read(12000).seconds, 11));

  playing(clock, 11, 12000);
  check('resuming snaps rather than catching up in a rush',
    clock.read(12000).snapped === true && near(clock.read(12000).seconds, 11));
  check('and runs on normally', near(clock.read(13000).seconds, 12));

  // An ad plays over the top and the player comes back somewhere else entirely.
  const advert = new MediaClock();
  playing(advert, 30, 0);
  advert.sample({ mediaSeconds: 30, wallMs: 500, playing: false, rate: 1 });
  playing(advert, 30.2, 45000);
  check('the chart does not return forty seconds ahead of the record',
    near(advert.read(45000).seconds, 30.2));
}

console.log('\nReadings the player could not give\n');
{
  // The hook drops a failed read rather than sampling a zero, so the clock has
  // to keep projecting from the last good one for as long as that takes.
  const clock = new MediaClock();
  playing(clock, 10, 0);
  check('a long gap between polls still projects', near(clock.read(5000).seconds, 15));
  check('and a reading taken then agrees', (() => {
    playing(clock, 15, 5000);
    return clock.read(5000).snapped === false && near(clock.read(5000).seconds, 15);
  })());
  check('a wall clock that goes backwards cannot rewind the chart',
    near(clock.read(4000).seconds, 15));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
