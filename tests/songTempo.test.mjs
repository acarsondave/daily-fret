// Laying a chart out from a tempo instead of from anchors.
//
// The decisive test in here is the last one. Two engines now produce the thing
// the chart reads, and if they disagree about its shape then every screen that
// takes a timeline has two behaviours instead of one. So an anchored song whose
// anchors sit exactly on its nominal tempo is laid out both ways and the two
// results are compared field by field, not merely spot-checked.

import { buildTempoTimeline, songPace, DEFAULT_SONG_BPM } from '../src/lib/songTempo.ts';
import { buildTimeline, barIndexAt, sectionIndexAt } from '../src/lib/songTiming.ts';
import { SONGS } from '../src/data/songs.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const s = (chord, lyric, strum) => ({ chord, ...(lyric ? { lyric } : {}), ...(strum ? { strum } : {}) });

console.log('\nBars land where the arithmetic says they land\n');
{
  // 120 bpm, four to a bar: half a second a beat, two seconds a bar.
  const song = {
    id: 'x', title: 'X', artist: 'Y', strum: 'DD', chords: ['A'],
    sections: [
      { label: 'Verse', steps: [s('A'), s('D'), s('E')] },
      { label: 'Bridge', steps: [s('G'), s('C')] },
    ],
  };
  const built = buildTempoTimeline(song, 120);
  check('a chart with bars can be laid out', built.ok === true);
  const t = built.timeline;
  check('the first downbeat is time zero', near(t.startSeconds, 0));
  check('three bars of four at 120 is six seconds', near(t.sections[0].endSeconds, 6));
  check('the second section starts where the first ended', near(t.sections[1].startSeconds, 6));
  check('and the chart ends at ten', near(t.endSeconds, 10), String(t.endSeconds));
  check('a bar is two seconds', near(t.bars[1].startSeconds, 2) && near(t.bars[1].endSeconds, 4));
  check('beats accumulate across sections', t.bars[4].beatStart === 16, String(t.bars[4].beatStart));
  check('every bar is in the chart', t.bars.length === 5);
  check('the total is twenty beats', t.beats === 20, String(t.beats));

  // The reason positions have to be right: this is what the chart asks.
  check('at 3.1 seconds the second bar is under the playhead', barIndexAt(t, 3.1) === 1);
  check('at 6.1 seconds the second section is', sectionIndexAt(t, 6.1) === 1);
  check('before the first downbeat there is no bar', barIndexAt(t, -0.5) === -1);
}

console.log('\nA section may be counted in something other than four\n');
{
  const song = {
    id: 'x', title: 'X', artist: 'Y', strum: 'D', chords: ['A'], beatsPerBar: 4,
    sections: [
      { label: 'Verse', steps: [s('A'), s('D')] },
      { label: 'Waltz', beatsPerBar: 3, steps: [s('G'), s('C')] },
    ],
  };
  const t = buildTempoTimeline(song, 120).timeline;
  check('the four-bar section is four seconds', near(t.sections[0].endSeconds, 4));
  check('a bar of three is a second and a half', near(t.bars[2].endSeconds - t.bars[2].startSeconds, 1.5));
  check('the waltz section is three seconds', near(t.sections[1].endSeconds - t.sections[1].startSeconds, 3));
  check('and the bar reports its own count', t.bars[2].beats === 3);
  check('a song-wide count applies where a section says nothing', t.bars[0].beats === 4);
}

console.log('\nWhat a bar carries comes from the step, not from the tempo\n');
{
  const song = {
    id: 'x', title: 'X', artist: 'Y', strum: 'DD', chords: ['A'],
    sections: [{ label: 'Verse', steps: [
      { chord: 'A', lyric: 'sung here', strum: 'DDDD' },
      { chord: 'D', tag: 'riff' },
    ] }],
  };
  const t = buildTempoTimeline(song, 90).timeline;
  check('a bar with its own strum keeps it', t.bars[0].strum === 'DDDD');
  check('a bar without one takes the song default', t.bars[1].strum === 'DD');
  check('the lyric rides along', t.bars[0].lyric === 'sung here');
  check('so does a tag', t.bars[1].tag === 'riff');
  check('a bar with no lyric has no lyric key', 'lyric' in t.bars[1] === false);
  check('the first bar of a section is flagged', t.bars[0].opensSection === true);
  check('and the second is not', t.bars[1].opensSection === false);
}

console.log('\nTempo actually changes the answer\n');
{
  const song = {
    id: 'x', title: 'X', artist: 'Y', strum: 'D', chords: ['A'],
    sections: [{ label: 'Verse', steps: [s('A'), s('D'), s('E'), s('G')] }],
  };
  const fast = buildTempoTimeline(song, 120).timeline;
  const slow = buildTempoTimeline(song, 60).timeline;
  check('half the tempo is twice the time', near(slow.endSeconds, fast.endSeconds * 2));
  check('but the same number of beats', slow.beats === fast.beats);
  check('and the same layout coordinates', slow.bars[3].beatStart === fast.bars[3].beatStart);
  check('70 percent of 116 is a slower chart',
    buildTempoTimeline(song, 81).timeline.endSeconds > buildTempoTimeline(song, 116).timeline.endSeconds);
}

console.log('\nA chart with nothing in it says so, in the anchored engine\'s own words\n');
{
  const bare = { id: 'x', title: 'X', artist: 'Y', strum: 'D', chords: [], sections: [] };
  const one = buildTempoTimeline(bare, 120);
  check('no sections is a gap', one.ok === false);
  check('and it is the same code the anchored engine returns', one.gap.code === 'empty');
  check('with the same words', one.gap.message === buildTimeline(bare).gap.message);

  const empty = { ...bare, sections: [{ label: 'Verse', steps: [] }] };
  check('no bars anywhere is a gap', buildTempoTimeline(empty, 120).ok === false);

  const half = { ...bare, sections: [{ label: 'Verse', steps: [s('A')] }, { label: 'Solo', steps: [] }] };
  const partial = buildTempoTimeline(half, 120);
  check('one empty section is a gap', partial.ok === false);
  check('and it names the section', partial.gap.sectionIndex === 1, JSON.stringify(partial.gap));

  check('a tempo of zero is a gap, not an infinite chart',
    buildTempoTimeline({ ...bare, sections: [{ label: 'V', steps: [s('A')] }] }, 0).ok === false);
}

console.log('\nThe two engines produce the same kind of thing\n');
{
  // Anchors placed exactly on the nominal tempo. 100 bpm, four to a bar, so a
  // bar is 2.4 seconds and each section starts a whole number of bars in.
  const spb = 60 / 100;
  const bar = spb * 4;
  const sections = [
    { label: 'Intro', steps: [s('A'), s('D')] },
    { label: 'Verse', steps: [s('E', 'a line'), s('A'), s('D', '', 'DDDD')] },
    { label: 'Outro', steps: [s('A', '', 'D')] },
  ];
  let at = 0;
  const anchored = {
    id: 'x', title: 'X', artist: 'Y', strum: 'DDUUDU', chords: ['A', 'D', 'E'], bpm: 100,
    sections: sections.map((sec) => {
      const withAnchor = { ...sec, atSeconds: at };
      at += sec.steps.length * bar;
      return withAnchor;
    }),
    endSeconds: at,
  };

  const fromAnchors = buildTimeline(anchored);
  const fromTempo = buildTempoTimeline(anchored, 100);
  check('the anchored engine can lay this out', fromAnchors.ok === true, fromAnchors.ok ? '' : fromAnchors.gap.message);
  check('and so can the tempo engine', fromTempo.ok === true);

  // Field by field rather than by a deep-equal helper, so a failure names the
  // field that moved instead of printing two objects.
  const a = fromAnchors.timeline;
  const b = fromTempo.timeline;
  check('the same number of bars', a.bars.length === b.bars.length);
  check('the same number of sections', a.sections.length === b.sections.length);
  check('the same total beats', a.beats === b.beats);
  check('the same start', near(a.startSeconds, b.startSeconds, 1e-9));
  check('the same end', near(a.endSeconds, b.endSeconds, 1e-9));

  const barFields = ['index', 'sectionIndex', 'sectionLabel', 'opensSection', 'chord', 'strum', 'lyric', 'tag', 'beats', 'beatStart'];
  let barMismatch = null;
  for (let i = 0; i < a.bars.length && !barMismatch; i++) {
    for (const f of barFields) {
      if (a.bars[i][f] !== b.bars[i][f]) barMismatch = `bar ${i} ${f}: ${a.bars[i][f]} vs ${b.bars[i][f]}`;
    }
    for (const f of ['startSeconds', 'endSeconds']) {
      if (!near(a.bars[i][f], b.bars[i][f], 1e-9)) barMismatch = `bar ${i} ${f}: ${a.bars[i][f]} vs ${b.bars[i][f]}`;
    }
    const keys = (o) => Object.keys(o).sort().join(',');
    if (keys(a.bars[i]) !== keys(b.bars[i])) barMismatch = `bar ${i} keys: ${keys(a.bars[i])} vs ${keys(b.bars[i])}`;
  }
  check('every bar agrees, field for field', barMismatch === null, barMismatch ?? '');

  let sectionMismatch = null;
  for (let i = 0; i < a.sections.length && !sectionMismatch; i++) {
    for (const f of ['index', 'label', 'firstBar', 'barCount', 'beatStart', 'beats']) {
      if (a.sections[i][f] !== b.sections[i][f]) sectionMismatch = `section ${i} ${f}`;
    }
    for (const f of ['startSeconds', 'endSeconds']) {
      if (!near(a.sections[i][f], b.sections[i][f], 1e-9)) sectionMismatch = `section ${i} ${f}: ${a.sections[i][f]} vs ${b.sections[i][f]}`;
    }
  }
  check('every section agrees, field for field', sectionMismatch === null, sectionMismatch ?? '');
}

console.log('\nWhose tempo the number is\n');
{
  const withBpm = { id: 'a', title: 'A', artist: 'B', strum: 'D', chords: [], sections: [], bpm: 116 };
  const without = { id: 'a', title: 'A', artist: 'B', strum: 'D', chords: [], sections: [] };
  const plan = { bpm: 72, beatsPerChange: 4, targetChangesPerMin: 18, trend: 'steady', reason: '' };

  check('a written tempo is the song\'s', songPace(withBpm, null).source === 'song');
  check('and it is the number', songPace(withBpm, null).bpm === 116);
  check('a written tempo is what the ring fills toward', songPace(withBpm, null).fullBpm === 116);
  check('the practice plan does not override it', songPace(withBpm, plan).bpm === 116);

  check('with no written tempo the player\'s own number is used', songPace(without, plan).bpm === 72);
  check('and it is named as the player\'s', songPace(without, plan).source === 'practice');
  check('with nothing at all there is still a tempo', songPace(without, null).bpm === DEFAULT_SONG_BPM);
  check('a song with no written tempo has nothing to be a fraction of',
    songPace(without, plan).fullBpm === null);

  check('a chosen tempo wins', songPace(withBpm, plan, 81).bpm === 81);
  check('and says it was chosen', songPace(withBpm, plan, 81).source === 'chosen');
  check('while still knowing the record\'s pace', songPace(withBpm, plan, 81).fullBpm === 116);
}

console.log('\nEvery song in the catalogue can actually be played\n');
{
  // The claim the whole mode rests on. Before this, buildTimeline returned
  // no-anchors for all eight, so the scrolling chart had never once run for a
  // shipped song. If a song loses its tempo or its bars, this is where it shows.
  const broken = [];
  const untimed = [];
  for (const song of SONGS) {
    if (!(typeof song.bpm === 'number' && song.bpm > 0)) untimed.push(song.id);
    const built = buildTempoTimeline(song, song.bpm ?? DEFAULT_SONG_BPM);
    if (!built.ok) broken.push(`${song.id}: ${built.gap.message}`);
  }
  check('every built-in song carries a written tempo', untimed.length === 0, untimed.join(', '));
  check('and every one of them lays out as a chart', broken.length === 0, broken.join(' | '));
  check('none of them can be laid out against a recording',
    SONGS.every((song) => buildTimeline(song).ok === false),
    'a song has been anchored; this check has served its purpose and can go');

  // A tempo that is wrong by a factor of two is the mistake worth catching, and
  // it shows up as a chart whose length is nothing like the song's.
  const long = SONGS.filter((song) => {
    const t = buildTempoTimeline(song, song.bpm).timeline;
    return t.endSeconds < 15 || t.endSeconds > 420;
  }).map((song) => `${song.id} ${Math.round(buildTempoTimeline(song, song.bpm).timeline.endSeconds)}s`);
  check('and each runs for a plausible number of minutes', long.length === 0, long.join(', '));
}

console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
