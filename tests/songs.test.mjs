import {
  chartBars,
  chordsUsed,
  chordsWithoutDiagram,
  draftProblems,
  draftToSong,
  duplicateAsDraft,
  emptyDraft,
  findSong,
  isUserSong,
  mergeSongs,
  newSongId,
  normaliseStrum,
  parseChordLine,
  songToDraft,
  youtubeIdFrom,
} from '../src/lib/songCatalog.ts';
import { SONGS } from '../src/data/songs.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

const draft = (over = {}) => ({
  ...emptyDraft('u_test'),
  title: 'My Song',
  sections: [{ label: 'Verse', steps: [{ chord: 'A' }, { chord: 'D' }] }],
  ...over,
});

console.log('\nReading a chord line\n');
{
  check('plain spaces split into bars', parseChordLine('A D E D').length === 4);
  check('bar lines are separators, not chords',
    parseChordLine('A D | E D').map(s => s.chord).join('') === 'ADED');
  check('commas too', parseChordLine('Am, Em, C').length === 3);
  check('runs of whitespace collapse', parseChordLine('A    D\tE').length === 3);
  check('an empty line adds nothing', parseChordLine('   ').length === 0);
  check('a lone bar line adds nothing', parseChordLine(' | | ').length === 0);
  check('chord names survive intact',
    parseChordLine('Cadd9 Fmaj7 B7').map(s => s.chord).join(' ') === 'Cadd9 Fmaj7 B7');
}

console.log('\nStrum normalising\n');
{
  check('lowercase is accepted', normaliseStrum('ddu') === 'DDU');
  check('rests survive', normaliseStrum('D-U-') === 'D-U-');
  check('anything else is dropped', normaliseStrum('D x U 9') === 'DU');
  check('a fully invalid strum comes back empty', normaliseStrum('xyz') === '');
}

console.log('\nChords are derived, never typed\n');
{
  const sections = [
    { label: 'V', steps: [{ chord: 'A' }, { chord: 'D' }, { chord: 'A' }] },
    { label: 'C', steps: [{ chord: 'E' }, { chord: 'D' }] },
  ];
  check('each chord appears once', chordsUsed(sections).join(' ') === 'A D E');
  check('order is first appearance', chordsUsed(sections)[2] === 'E');
  check('an empty chart uses no chords', chordsUsed([]).length === 0);
  check('blank chords are ignored',
    chordsUsed([{ label: 'x', steps: [{ chord: '  ' }, { chord: 'G' }] }]).join('') === 'G');
  check('a chord with no diagram is reported',
    chordsWithoutDiagram([{ label: 'x', steps: [{ chord: 'A' }, { chord: 'Gmaj13' }] }]).join('') === 'Gmaj13');
  check('and a chord with one is not',
    chordsWithoutDiagram([{ label: 'x', steps: [{ chord: 'A' }, { chord: 'F' }] }]).length === 0);
}

console.log('\nWhat blocks a save\n');
{
  check('a good draft has no problems', draftProblems(draft()).length === 0);
  check('a nameless song is blocked',
    draftProblems(draft({ title: '  ' })).some(p => p.field === 'title'));
  check('a song with no bars is blocked',
    draftProblems(draft({ sections: [{ label: 'V', steps: [] }] })).some(p => p.field === 'sections'));
  check('an unreadable strum is blocked',
    draftProblems(draft({ strum: 'xyz' })).some(p => p.field === 'strum'));
  check('an empty strum is fine — the song default fills in',
    !draftProblems(draft({ strum: '' })).some(p => p.field === 'strum'));
  // Every problem names a field so the editor can point at it. A save that just
  // refuses is the failure mode this exists to avoid.
  check('every problem carries a message', draftProblems(draft({ title: '' })).every(p => p.message));
}

console.log('\nDraft to song\n');
{
  const song = draftToSong(draft({ bpm: '120', youtubeLink: 'https://youtu.be/gSWInYFVksg' }));
  check('the title is trimmed', draftToSong(draft({ title: '  Hey  ' })).title === 'Hey');
  check('chords come from the bars', song.chords.join(' ') === 'A D');
  check('a tempo is a number', song.bpm === 120);
  check('a link becomes a video id', song.youtubeId === 'gSWInYFVksg');
  const bare = draftToSong(draft());
  check('no tempo means no bpm field', !('bpm' in bare));
  check('no link means no youtubeId field', !('youtubeId' in bare));
  check('a missing artist gets an honest stand-in', bare.artist === 'Your chart');
  check('an empty strum falls back to two downs', draftToSong(draft({ strum: '' })).strum === 'DD');
  check('empty sections are dropped',
    draftToSong(draft({ sections: [
      { label: 'V', steps: [{ chord: 'A' }] },
      { label: 'Empty', steps: [] },
    ] })).sections.length === 1);
  check('an unnamed section still gets a label',
    draftToSong(draft({ sections: [{ label: '  ', steps: [{ chord: 'A' }] }] })).sections[0].label === 'Section');
  check('a nonsense tempo is dropped, not stored as NaN',
    !('bpm' in draftToSong(draft({ bpm: 'abc' }))));
  check('a zero tempo is dropped', !('bpm' in draftToSong(draft({ bpm: '0' }))));
  check('an unparseable link is dropped',
    !('youtubeId' in draftToSong(draft({ youtubeLink: 'not a link' }))));
}

console.log('\nRound trip\n');
{
  const original = draftToSong(draft({ bpm: '96', youtubeLink: 'gSWInYFVksg' }));
  const back = draftToSong(songToDraft(original));
  check('a song survives edit and re-save', JSON.stringify(back) === JSON.stringify(original));
  check('the stand-in artist does not become real text', songToDraft(original).artist === '');
  const built = songToDraft(SONGS[0]);
  check('a built-in opens as an editable draft', built.sections.length === SONGS[0].sections.length);
  check('and its steps are copies, not the shipped objects',
    built.sections[0].steps[0] !== SONGS[0].sections[0].steps[0]);
}

console.log('\nThe merged catalogue\n');
{
  check('no user songs means the built-in list itself', mergeSongs(undefined) === SONGS);
  check('an empty list too', mergeSongs([]) === SONGS);
  const mine = { id: 'u_1', title: 'Mine', artist: 'Me', strum: 'DD', chords: ['A'], sections: [] };
  const merged = mergeSongs([mine]);
  check('own work comes first', merged[0].id === 'u_1');
  check('the built-ins are all still there', merged.length === SONGS.length + 1);
  // A user song written over a built-in id is the user saying "mine, not yours".
  const override = { ...mine, id: SONGS[0].id };
  const overridden = mergeSongs([override]);
  check('a user song wins its id', overridden.find(s => s.id === SONGS[0].id).title === 'Mine');
  check('and does not duplicate the entry', overridden.length === SONGS.length);
  check('findSong reads the merged list', findSong(merged, 'u_1').title === 'Mine');
  check('findSong on a missing id is undefined', findSong(merged, 'nope') === undefined);
  check('findSong with no id is undefined', findSong(merged, undefined) === undefined);
  check('a user song is recognised as one', isUserSong(mine));
  check('a built-in is not', !isUserSong(SONGS[0]));
}

console.log('\nIds\n');
{
  const id = newSongId(SONGS);
  check('a new id is marked as the user\'s', isUserSong({ id }));
  check('and does not collide', !SONGS.some(s => s.id === id));
  // The id keys the song's YouTube link and its results, so a collision would
  // silently merge two songs' histories.
  const taken = [{ id }];
  check('a second id differs from the first', newSongId([...SONGS, ...taken]) !== id);
  const many = new Set();
  for (let i = 0; i < 200; i++) many.add(newSongId(SONGS));
  check('two hundred in a row are all distinct', many.size === 200, `${many.size}`);
}

console.log('\nCopying a built-in\n');
{
  const copy = duplicateAsDraft(SONGS[0], 'u_copy');
  check('the copy has its own id', copy.id === 'u_copy');
  check('and says it is a version', copy.title.includes('my version'));
  check('the chart came with it', copy.sections.length === SONGS[0].sections.length);
  check('editing the copy cannot touch the original',
    copy.sections[0].steps[0] !== SONGS[0].sections[0].steps[0]);
}

console.log('\nLinks\n');
{
  check('a youtu.be link', youtubeIdFrom('https://youtu.be/gSWInYFVksg') === 'gSWInYFVksg');
  check('a watch link', youtubeIdFrom('https://www.youtube.com/watch?v=gSWInYFVksg') === 'gSWInYFVksg');
  check('a watch link with extra params',
    youtubeIdFrom('https://www.youtube.com/watch?list=x&v=gSWInYFVksg&t=3') === 'gSWInYFVksg');
  check('an embed link', youtubeIdFrom('https://www.youtube.com/embed/gSWInYFVksg') === 'gSWInYFVksg');
  check('a shorts link', youtubeIdFrom('https://youtube.com/shorts/gSWInYFVksg') === 'gSWInYFVksg');
  check('a bare id', youtubeIdFrom('gSWInYFVksg') === 'gSWInYFVksg');
  check('an empty string is nothing', youtubeIdFrom('') === null);
  check('a wrong-length id is refused', youtubeIdFrom('abc') === null);
  check('arbitrary text is refused', youtubeIdFrom('https://example.com/song') === null);
}

console.log('\nScale\n');
{
  // A full song written out bar by bar. The grid renders every bar, so this is
  // the shape that has to stay quick.
  const big = {
    ...emptyDraft('u_big'),
    title: 'Long One',
    sections: Array.from({ length: 24 }, (_, s) => ({
      label: `Section ${s + 1}`,
      steps: Array.from({ length: 32 }, (_, b) => ({ chord: ['A', 'D', 'E', 'Am'][b % 4] })),
    })),
  };
  const started = performance.now();
  const song = draftToSong(big);
  const elapsed = performance.now() - started;
  check('768 bars convert', chartBars(song) === 768, `${chartBars(song)}`);
  check('to four distinct chords', song.chords.length === 4);
  check('in under 20ms', elapsed < 20, `${elapsed.toFixed(1)}ms`);
  check('problems still clear', draftProblems(big).length === 0);
}

// --- the key a chart is written in -----------------------------------------
//
// A beginner chart is often in an easier key than the record. That was recorded
// in code comments, which the person holding the guitar cannot read, and playing
// Get Lucky's A minor shapes against a B minor record clashes on every chord.
{
  console.log('\nThe key a chart is written in\n');
  const lucky = SONGS.find((x) => x.id === 'get-lucky');
  check('Get Lucky is in the catalogue', Boolean(lucky));
  check('and states the capo that makes it match the record', lucky?.capo === 2, String(lucky?.capo));
  check('its chords are all ones a Module 5 player has',
    lucky?.chords.every((c) => ['Am', 'C', 'Em', 'D'].includes(c)), lucky?.chords.join(', '));
  check('it changes chord every half bar', lucky?.beatsPerBar === 2, String(lucky?.beatsPerBar));
  check('so no charted step is longer than the loop moves',
    lucky?.sections.every((sec) => sec.steps.length % 4 === 0),
    lucky?.sections.map((sec) => `${sec.label}:${sec.steps.length}`).join(' '));
  check('the loop really is Am C Em D throughout',
    lucky?.sections.every((sec) => sec.steps.every((st, i) => st.chord === ['Am', 'C', 'Em', 'D'][i % 4])));
  check('it ships untimed rather than with guessed anchors',
    lucky?.sections.every((sec) => sec.atSeconds === undefined));

  const sing = SONGS.find((x) => x.id === 'sing-ed-sheeran');
  check('Sing states its capo too, which was only ever in a comment', sing?.capo === 4, String(sing?.capo));

  const noCapo = SONGS.filter((x) => x.capo === undefined);
  check('and a song without one is in the record\'s own key', noCapo.length > 0);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
