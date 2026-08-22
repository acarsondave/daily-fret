// A song's own strumming, and how Get Lucky's was read.
//
// The first half of this file is the interesting half. The pattern in
// src/data/songs.ts is a claim about a video, and a comment asserting a claim is
// not evidence for it, so the reading is re-derived here from the owner's raw
// transcription every time the suite runs. If anyone ever edits that pattern to
// something the transcription does not actually imply, this fails.

import { SONGS } from '../src/data/songs.ts';
import { songStrumPatterns, songHasStrum, songPatternName, SONG_STRUM_SECONDS } from '../src/lib/songStrum.ts';
import { parsePattern, soundedSlots, SLOTS_PER_BAR, MAX_PATTERN_BARS } from '../src/lib/strumPattern.ts';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};

// --- re-deriving Get Lucky's strum -----------------------------------------
//
// What the owner wrote down from Marty Schwartz's lesson, symbol for symbol:
//
//   DOWN - UP DOWN(slap) - - UP UP - UP DOWN UP DOWN UP
//
// Fourteen symbols, which is not a bar of anything. The question is not "how do
// we make this sixteen" — it is "where can these fourteen possibly sit". The arm
// answers it: it is a pendulum, on its way down through every even slot and up
// through every odd one, so a stroke can only land on a slot facing the way it
// is already going. Search every way of inserting rests and see what survives.
console.log('\nGet Lucky, read off the transcription rather than off the comment\n');

const TRANSCRIBED = ['D', '-', 'U', 'X', '-', '-', 'U', 'U', '-', 'U', 'D', 'U', 'D', 'U'];

/** Does every stroke face the way the arm is already going at its slot? */
const facesTheArm = (slots) =>
  slots.every((s, i) => s === '-' || s === 'X' || s === (i % 2 === 0 ? 'D' : 'U'));

/** Every distinct way of inserting `n` rests into a symbol sequence. */
function withRests(seq, n) {
  if (n === 0) return [seq];
  const out = [];
  for (let at = 0; at <= seq.length; at += 1) {
    out.push(...withRests([...seq.slice(0, at), '-', ...seq.slice(at)], n - 1));
  }
  return out;
}

const fitsAt = (n) => {
  const found = new Set();
  for (const cand of withRests(TRANSCRIBED, n)) if (facesTheArm(cand)) found.add(cand.join(''));
  return [...found];
};

check('as transcribed, fourteen symbols cannot all face the arm', fitsAt(0).length === 0,
  fitsAt(0).join(' '));
check('and no single added rest rescues them', fitsAt(1).length === 0, fitsAt(1).join(' '));

const two = fitsAt(2);
check('exactly one arrangement of two added rests works', two.length === 1, two.join(' '));
check('and it is sixteen slots', two[0]?.length === 16, String(two[0]?.length));
// Against the catalogue itself, not against a literal repeated in this file.
// The first draft of this line compared the derivation to a hardcoded string,
// which meant songs.ts could drift to any other reading and only the checks
// further down would notice.
const SHIPPED = SONGS.find((s) => s.id === 'get-lucky')?.strumPatterns?.[0]?.pattern;
check('which is the pattern the catalogue ships', two[0] === SHIPPED,
  `derived ${two[0]}, shipped ${SHIPPED}`);

// The two rests are forced rather than chosen, and this says why in a way a
// comment cannot: take either one back out and the arrangement stops working.
check('the rest between the two written ups is the down the arm must pass through',
  !facesTheArm([...'D--UX--UU-UDUDU']), 'two ups in a row would be playable');
check('the rest after the opening down puts the first up on the "a" rather than the "e"',
  !facesTheArm([...'D-UX--U-U-UDUDU']), 'the shorter opening would be playable');

// --- what the catalogue actually holds -------------------------------------
console.log('\nWhat Get Lucky carries\n');

const lucky = SONGS.find((s) => s.id === 'get-lucky');
check('Get Lucky is in the catalogue', Boolean(lucky));

const deck = songStrumPatterns(lucky);
check('it offers one phrase to practise', deck.length === 1, deck.join(' '));
check('and the drill is handed the derived phrase', deck[0] === two[0], deck[0]);

const phrase = parsePattern(deck[0]);
check('the matcher can read it', phrase !== null);
check('it is whole bars the matcher accepts',
  deck[0].length % SLOTS_PER_BAR === 0 && deck[0].length <= SLOTS_PER_BAR * MAX_PATTERN_BARS,
  `${deck[0].length} slots`);
check('ten of its sixteen slots sound', soundedSlots(phrase) === 10, String(soundedSlots(phrase)));
check('the slap is a slap and not a down strum', phrase?.slots[4] === 'X', String(phrase?.slots[4]));
// Under the sixteenth reading the slap is on beat two, which is the backbeat and
// the whole reason that reading was taken. Slot 4 of sixteen sixteenths is beat
// two; stated as an assertion so a future edit that moves it has to argue.
check('and it lands on the second beat of the bar', phrase?.slots.indexOf('X') === 4,
  String(phrase?.slots.indexOf('X')));

// The chords and the capo, against the source the owner is playing from.
check('it is played Am, C, Em, D', lucky?.chords.join(' ') === 'Am C Em D', lucky?.chords.join(' '));
check('with a capo on the second fret', lucky?.capo === 2, String(lucky?.capo));

// --- a song without a drillable strum --------------------------------------
console.log('\nA song whose strum is only chart shorthand\n');

const wild = SONGS.find((s) => s.id === 'wild-thing');
check('Wild Thing is in the catalogue', Boolean(wild));
check("its strum is arrow art, not a bar of slots", parsePattern(wild.strum) === null, wild?.strum);
check('so it offers nothing to drill', songStrumPatterns(wild).length === 0);
check('and says so', songHasStrum(wild) === false);

// --- the fallback -----------------------------------------------------------
console.log('\nA song that never named a phrase but whose bar happens to be one\n');
{
  const drillable = { ...wild, strumPatterns: undefined, strum: 'D-DU-UD-' };
  check('falls back to its own bar', songStrumPatterns(drillable).join(' ') === 'D-DU-UD-');
  const shorthand = { ...wild, strumPatterns: undefined, strum: 'DDDDDD' };
  check('but only when the matcher can read it', songStrumPatterns(shorthand).length === 0);
  const refused = { ...wild, strumPatterns: [{ pattern: 'D-DUD-' }] };
  check('a written phrase the matcher refuses is dropped here', songStrumPatterns(refused).length === 0);
}

// --- naming -----------------------------------------------------------------
console.log('\nNaming a phrase that came off a song\n');
check('a song phrase is named after its song',
  songPatternName('D--UX--U-U-UDUDU', SONGS) === 'Get Lucky',
  String(songPatternName('D--UX--U-U-UDUDU', SONGS)));
check('a ladder pattern is not claimed by any song',
  songPatternName('D-DU-UD-', SONGS) === null);
{
  const twoPhrases = [{
    ...wild,
    strumPatterns: [{ pattern: 'D-DU-UD-', name: 'Verse' }, { pattern: 'DUDUDUDU' }],
  }];
  check('a song with several phrases names them individually',
    songPatternName('D-DU-UD-', twoPhrases) === 'Verse');
  check('and falls back to the title for one it did not name',
    songPatternName('DUDUDUDU', twoPhrases) === 'Wild Thing');
  check('both reach the deck, in the order written',
    songStrumPatterns(twoPhrases[0]).join(' ') === 'D-DU-UD- DUDUDUDU');
}

console.log('\nThe block\n');
check('a song strum block is shorter than the ladder block', SONG_STRUM_SECONDS === 90,
  String(SONG_STRUM_SECONDS));

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
