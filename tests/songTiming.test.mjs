// Where a chart's bars sit in a recording.
//
// This is the part of the play-along that has to be right, and it is the part
// no browser test can check: a real YouTube embed will not load in CI, and even
// if it did, "is the chart on the beat" is not a thing an assertion can see. So
// the maths is separated from the video entirely and driven here against fixed
// numbers, and the browser test drives the same code against a fake clock.

import {
  DEFAULT_BEATS_PER_BAR,
  barIndexAt,
  beatCursorAt,
  beatPositionAt,
  beatsUntilNextBar,
  buildTimeline,
  formatVideoTime,
  loopTarget,
  secondsAtBeat,
  secondsPerBeat,
  sectionIndexAt,
} from '../src/lib/songTiming.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const song = (over = {}) => ({
  id: 't', title: 'Test', artist: 'Nobody', strum: 'DD', chords: ['A', 'D'],
  sections: [
    { label: 'Verse', atSeconds: 10, steps: [{ chord: 'A' }, { chord: 'D' }] },
    { label: 'Chorus', atSeconds: 18, steps: [{ chord: 'A' }, { chord: 'D' }, { chord: 'A' }] },
  ],
  endSeconds: 27,
  ...over,
});

const built = (over) => {
  const result = buildTimeline(song(over));
  if (!result.ok) throw new Error(`expected a timeline, got ${result.gap.code}`);
  return result.timeline;
};

console.log('\nA chart laid out against its recording\n');
{
  const line = built();
  check('every bar is placed', line.bars.length === 5);
  check('and every section', line.sections.length === 2);
  check('the chart starts at the first anchor', line.startSeconds === 10);
  check('and ends where the song says it ends', line.endSeconds === 27);
  check('beats are counted across the whole chart', line.beats === 20, `${line.beats}`);
  check('a bar is four beats unless told otherwise', line.bars[0].beats === DEFAULT_BEATS_PER_BAR);
  check('the song default strum lands on every bar', line.bars.every((b) => b.strum === 'DD'));
  check('a section knows its own first bar', line.sections[1].firstBar === 2);
  check('only the first bar of a section flies the label',
    line.bars.filter((b) => b.opensSection).length === 2);
  check('and every bar knows which section it is in',
    line.bars.map((b) => b.sectionIndex).join('') === '00111');
}

console.log('\nBars are interpolated inside their section, never across it\n');
{
  const line = built();
  // The verse spans 8 seconds over 8 beats and the chorus 9 over 12. If bars
  // were laid out from one tempo for the whole song, one of the two would be
  // wrong; this is the entire reason anchors are per section.
  check('the verse runs at one second a beat', near(secondsPerBeat(line.bars[0]), 1));
  check('the chorus runs faster, from its own span', near(secondsPerBeat(line.bars[2]), 0.75));
  check('the first bar starts on its anchor', line.bars[0].startSeconds === 10);
  check('bars inside a section divide it evenly', near(line.bars[1].startSeconds, 14));
  check('a section ends exactly on the next anchor', near(line.bars[1].endSeconds, 18));
  check('and the next section starts exactly there', line.bars[2].startSeconds === 18);
  check('the last bar ends exactly on the stated end', near(line.bars[4].endSeconds, 27));
  // The claim the whole design rests on: error cannot accumulate past a
  // section, because every section is pinned at both ends.
  check('no bar boundary drifts from its anchors',
    line.sections.every((s) => near(line.bars[s.firstBar].startSeconds, s.startSeconds)
      && near(line.bars[s.firstBar + s.barCount - 1].endSeconds, s.endSeconds)));
}

console.log('\nBeats in a bar\n');
{
  const waltz = built({ beatsPerBar: 3, endSeconds: 24 });
  check('a song can be in three', waltz.bars[0].beats === 3);
  check('and the beat count follows', waltz.beats === 15, `${waltz.beats}`);
  const mixed = built({
    sections: [
      { label: 'Verse', atSeconds: 10, steps: [{ chord: 'A' }, { chord: 'D' }] },
      { label: 'Bridge', atSeconds: 18, beatsPerBar: 6, steps: [{ chord: 'A' }] },
    ],
    endSeconds: 24,
  });
  check('a single section can differ from the song', mixed.bars[1].beats === 4);
  check('and its own bar carries the override', mixed.bars[2].beats === 6);
  check('a nonsense beat count falls back to four rather than dividing by zero',
    built({ beatsPerBar: 0 }).bars[0].beats === 4);
}

console.log('\nFinding the bar you are playing\n');
{
  const line = built();
  check('before the first downbeat there is no bar', barIndexAt(line, 9.9) === -1);
  check('the downbeat itself is the first bar', barIndexAt(line, 10) === 0);
  check('a moment inside a bar finds it', barIndexAt(line, 11.5) === 0);
  check('a bar boundary belongs to the bar it opens', barIndexAt(line, 14) === 1);
  check('across a section boundary too', barIndexAt(line, 18) === 2);
  check('the last instant is still the last bar', barIndexAt(line, 26.999) === 4);
  check('past the end is past the end', barIndexAt(line, 27) === 5);
  check('and stays past it', barIndexAt(line, 900) === 5);
  // The search is a binary search over up to several hundred bars and runs on
  // every animation frame, so it is checked exhaustively rather than at a few
  // hand-picked points.
  const wrong = line.bars.filter((bar) => {
    const mid = (bar.startSeconds + bar.endSeconds) / 2;
    return barIndexAt(line, mid) !== bar.index || barIndexAt(line, bar.startSeconds) !== bar.index;
  });
  check('every bar is found at its own start and middle', wrong.length === 0, `${wrong.length} wrong`);
}

console.log('\nThe beat coordinate the ribbon is drawn in\n');
{
  const line = built();
  check('the chart opens at beat zero', beatPositionAt(line, 10) === 0);
  check('a beat in is a beat in', near(beatPositionAt(line, 11), 1));
  check('the second bar opens on beat four', near(beatPositionAt(line, 14), 4));
  check('the chorus opens on beat eight', near(beatPositionAt(line, 18), 8));
  check('and moves at the chorus tempo', near(beatPositionAt(line, 18.75), 9));
  check('before the chart it runs negative, so the ribbon keeps moving',
    near(beatPositionAt(line, 8), -2));
  check('and past the end it keeps going', near(beatPositionAt(line, 27.75), 21));
  // The position must be continuous or the ribbon jumps at every section seam.
  const jumps = [];
  for (let t = 8; t < 29; t += 0.05) {
    const step = beatPositionAt(line, t + 0.05) - beatPositionAt(line, t);
    if (step <= 0 || step > 0.2) jumps.push(t.toFixed(2));
  }
  check('it never jumps or goes backwards', jumps.length === 0, jumps.slice(0, 3).join(' '));

  const roundTrips = [-3, 0, 4, 8, 11.5, 20, 23].filter(
    (beat) => !near(beatPositionAt(line, secondsAtBeat(line, beat)), beat, 1e-6),
  );
  check('seconds and beats convert both ways', roundTrips.length === 0, roundTrips.join(' '));
}

console.log('\nThe tick underneath\n');
{
  const line = built();
  check('the downbeat is beat one', beatCursorAt(line, 10).beat === 1);
  check('a beat later is beat two', beatCursorAt(line, 11).beat === 2);
  check('the last beat of a bar does not spill into the next',
    beatCursorAt(line, 13.99).beat === 4);
  check('the bar length comes with it', beatCursorAt(line, 10).ofBeats === 4);
  check('phase says how far through the beat', near(beatCursorAt(line, 10.5).phase, 0.5));
  check('outside the chart nothing is ticking', beatCursorAt(line, 5).beat === 0);
}

console.log('\nThe count-in\n');
{
  const line = built();
  check('two seconds before the start is two beats away', near(beatsUntilNextBar(line, 8), 2));
  check('inside a bar it counts to the next downbeat', near(beatsUntilNextBar(line, 11), 3));
  check('at a chorus tempo it counts in chorus beats', near(beatsUntilNextBar(line, 19.5), 2));
  check('past the end there is nothing to count into', beatsUntilNextBar(line, 40) === 0);
}

console.log('\nSections and looping\n');
{
  const line = built();
  check('before the chart there is no section', sectionIndexAt(line, 5) === -1);
  check('the verse is the verse', sectionIndexAt(line, 12) === 0);
  check('the chorus is the chorus', sectionIndexAt(line, 20) === 1);
  check('past the end is past the last section', sectionIndexAt(line, 40) === 2);
  // The loop lands a hair early on purpose: seeking is not instant, and coming
  // back after the downbeat clips the chord you looped to hear.
  check('a loop returns just before the downbeat', loopTarget(line, 1) < 18);
  check('but not by much', 18 - loopTarget(line, 1) < 0.3);
  check('a loop of the first section cannot seek to a negative time',
    loopTarget(built({ sections: [
      { label: 'A', atSeconds: 0.05, steps: [{ chord: 'A' }] },
      { label: 'B', atSeconds: 4, steps: [{ chord: 'D' }] },
    ], endSeconds: 8 }), 0) >= 0);
  check('a loop of a section that is not there falls back to the start',
    loopTarget(line, 99) === line.startSeconds);
}

console.log('\nA chart that cannot be timed says so\n');
{
  // Never a guessed tempo. A chart that scrolls to approximately the right
  // place is trusted, and then the player blames their own hands for it.
  const gapOf = (over) => {
    const result = buildTimeline(song(over));
    return result.ok ? null : result.gap;
  };
  check('a song nobody has timed', gapOf({
    sections: [{ label: 'V', steps: [{ chord: 'A' }] }], endSeconds: undefined,
  })?.code === 'no-anchors');
  check('and it does not claim a timeline anyway',
    buildTimeline({ ...song(), sections: [{ label: 'V', steps: [{ chord: 'A' }] }] }).ok === false);
  const half = gapOf({ sections: [
    { label: 'Verse', atSeconds: 10, steps: [{ chord: 'A' }] },
    { label: 'Chorus', steps: [{ chord: 'D' }] },
  ] });
  check('half a song timed is not a timed song', half?.code === 'missing-anchor');
  check('and it names the section to fix', half?.sectionIndex === 1);
  check('the message is something a person can act on', /Chorus/.test(half?.message ?? ''));
  check('anchors that go backwards', gapOf({
    sections: [
      { label: 'Verse', atSeconds: 20, steps: [{ chord: 'A' }] },
      { label: 'Chorus', atSeconds: 10, steps: [{ chord: 'D' }] },
    ],
  })?.code === 'out-of-order');
  check('two sections starting at the same instant', gapOf({
    sections: [
      { label: 'Verse', atSeconds: 10, steps: [{ chord: 'A' }] },
      { label: 'Chorus', atSeconds: 10, steps: [{ chord: 'D' }] },
    ],
  })?.code === 'out-of-order');
  check('an end that is not after the last anchor', gapOf({ endSeconds: 12 })?.code === 'out-of-order');
  check('no end at all', gapOf({ endSeconds: undefined })?.code === 'no-end');
  check('a chart with no bars', gapOf({ sections: [{ label: 'V', steps: [] }] })?.code === 'empty');
  check('no sections at all', gapOf({ sections: [] })?.code === 'empty');
  check('a timed song with an empty section in the middle', gapOf({
    sections: [
      { label: 'Verse', atSeconds: 10, steps: [{ chord: 'A' }] },
      { label: 'Silence', atSeconds: 14, steps: [] },
      { label: 'Chorus', atSeconds: 18, steps: [{ chord: 'D' }] },
    ],
  })?.code === 'empty-section');
  check('every gap carries a message', ['no-end', 'out-of-order'].every((code) =>
    (gapOf(code === 'no-end' ? { endSeconds: undefined } : { endSeconds: 12 })?.message ?? '').length > 0));
}

console.log('\nTimecodes, as the editor writes them\n');
{
  check('under a minute', formatVideoTime(9.24) === '0:09.2');
  check('over a minute', formatVideoTime(83.5) === '1:23.5');
  check('exactly on the minute', formatVideoTime(120) === '2:00.0');
  check('zero', formatVideoTime(0) === '0:00.0');
  check('a negative time is never printed', formatVideoTime(-4) === '0:00.0');
}

console.log('\nScale\n');
{
  // A five-minute song written out bar by bar. barIndexAt runs on every frame,
  // so the cost of finding a bar has to stay flat as the chart gets longer.
  const long = {
    ...song(),
    sections: Array.from({ length: 40 }, (_, i) => ({
      label: `Section ${i + 1}`,
      atSeconds: i * 8,
      steps: Array.from({ length: 8 }, () => ({ chord: 'A' })),
    })),
    endSeconds: 40 * 8,
  };
  const result = buildTimeline(long);
  check('it builds', result.ok === true);
  const line = result.timeline;
  check('320 bars', line.bars.length === 320);
  const started = performance.now();
  for (let i = 0; i < 20000; i++) beatPositionAt(line, (i % 3200) / 10);
  const elapsed = performance.now() - started;
  check('twenty thousand frame lookups in under 30ms', elapsed < 30, `${elapsed.toFixed(1)}ms`);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
