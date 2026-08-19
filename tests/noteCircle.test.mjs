// The arithmetic behind the note circle.
//
// Every claim the surface draws is a claim made here first: the distance round
// the loop in both directions, the two names one note answers to, the lap that
// closes on an octave, and where a pitch class lands on a real string. The
// drawing is checked in a browser; this is where the maths is settled.

import {
  CIRCLE_ORDER,
  CIRCLE_START,
  SEMITONES_IN_OCTAVE,
  flatName,
  fretOf,
  inlayAt,
  isSharp,
  noteAtFret,
  pitchClass,
  semitonesDown,
  semitonesUp,
  sharpName,
  stepsRound,
  toneReading,
} from '../src/lib/noteCircle.ts';
import { TUNINGS, midiToName } from '../src/audio/tuning.ts';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `: ${detail}` : ''}`);
};

const NAMES = Array.from({ length: 12 }, (_, pc) => sharpName(pc));
const pcOf = (name) => NAMES.indexOf(name);

console.log('\nThe circle\n');

check('twelve positions', CIRCLE_ORDER.length === SEMITONES_IN_OCTAVE);
check('starts at A', CIRCLE_ORDER[0] === CIRCLE_START && sharpName(CIRCLE_START) === 'A');
check('every pitch class appears once', new Set(CIRCLE_ORDER).size === SEMITONES_IN_OCTAVE);
check(
  'reads A A# B C C# D D# E F F# G G#',
  CIRCLE_ORDER.map(sharpName).join(' ') === 'A A# B C C# D D# E F F# G G#',
  CIRCLE_ORDER.map(sharpName).join(' '),
);
check('each position is one semitone past the last',
  CIRCLE_ORDER.every((pc, i) => i === 0 || pitchClass(CIRCLE_ORDER[i - 1] + 1) === pc));

check('pitchClass folds negatives', pitchClass(-1) === 11 && pitchClass(-13) === 11);
check('pitchClass folds above an octave', pitchClass(12) === 0 && pitchClass(25) === 1);

console.log('\nNames, and the two a sharp answers to\n');

// The names must be the tuner's names, not a second table that agrees today.
check('sharp names come from the tuner',
  NAMES.every((name, pc) => name === midiToName(60 + pc).name),
  NAMES.join(' '));

check('seven naturals, five sharps',
  NAMES.filter((n) => n.length === 1).length === 7 && NAMES.filter((_, pc) => isSharp(pc)).length === 5);

const ENHARMONIC = [['A#', 'B♭'], ['C#', 'D♭'], ['D#', 'E♭'], ['F#', 'G♭'], ['G#', 'A♭']];
for (const [sharp, flat] of ENHARMONIC) {
  check(`${sharp} is also ${flat}`, flatName(pcOf(sharp)) === flat, String(flatName(pcOf(sharp))));
}
check('a natural has no second name',
  ['A', 'B', 'C', 'D', 'E', 'F', 'G'].every((n) => flatName(pcOf(n)) === null));
check('the flat spelling names the letter above',
  ENHARMONIC.every(([sharp, flat]) => flat[0] === sharpName(pitchClass(pcOf(sharp) + 1))));

// The two places the letters run out of room, which is why the circle is not
// evenly lettered and why the exercise is worth doing at all.
check('B to C is one semitone', semitonesUp(pcOf('B'), pcOf('C')) === 1);
check('E to F is one semitone', semitonesUp(pcOf('E'), pcOf('F')) === 1);
check('A to B is two semitones', semitonesUp(pcOf('A'), pcOf('B')) === 2);

console.log('\nDistance, both ways round\n');

check('A up to C is three', semitonesUp(pcOf('A'), pcOf('C')) === 3);
check('A down to C is nine', semitonesDown(pcOf('A'), pcOf('C')) === 9);
check('C up to A is nine', semitonesUp(pcOf('C'), pcOf('A')) === 9);
check('C down to A is three', semitonesDown(pcOf('C'), pcOf('A')) === 3);

let complements = true;
let symmetry = true;
for (let from = 0; from < 12; from += 1) {
  for (let to = 0; to < 12; to += 1) {
    const up = semitonesUp(from, to);
    const down = semitonesDown(from, to);
    if (up < 0 || up > 11 || down < 0 || down > 11) complements = false;
    if (from !== to && up + down !== SEMITONES_IN_OCTAVE) complements = false;
    if (from === to && (up !== 0 || down !== 0)) complements = false;
    if (semitonesDown(to, from) !== up) symmetry = false;
  }
}
check('the two ways round always add to an octave', complements);
check('down one way is up the other', symmetry);

check('the walk never stands still', CIRCLE_ORDER.every((pc) => stepsRound(pc, pc) === 12));
check('the walk agrees with the modulo everywhere else',
  CIRCLE_ORDER.every((from) => CIRCLE_ORDER.every((to) =>
    from === to || stepsRound(from, to) === semitonesUp(from, to))));
check('the walk is never longer than a lap',
  CIRCLE_ORDER.every((from) => CIRCLE_ORDER.every((to) => stepsRound(from, to) <= 12)));

console.log('\nTones, and the lap that closes\n');

const READINGS = [[1, '½ tone'], [2, '1 tone'], [3, '1½ tones'], [4, '2 tones'],
                  [7, '3½ tones'], [11, '5½ tones'], [12, 'octave']];
for (const [n, want] of READINGS) {
  check(`${n} semitones reads "${want}"`, toneReading(n) === want, toneReading(n));
}

console.log('\nThe same loop on a string\n');

const standard = TUNINGS.find((t) => t.id === 'standard');
const lowE = standard.strings.find((s) => s.position === 6);
const aString = standard.strings.find((s) => s.position === 5);

check('the low E string is an E', sharpName(pitchClass(lowE.midi)) === 'E');
check('open is fret nought', fretOf(lowE.midi, pitchClass(lowE.midi)) === 0);
check('F is the first fret of the low E', fretOf(lowE.midi, pcOf('F')) === 1);
check('A is the fifth fret of the low E', fretOf(lowE.midi, pcOf('A')) === 5);
check('A is the open A string', fretOf(aString.midi, pcOf('A')) === 0);
check('every fret answer is inside one octave',
  CIRCLE_ORDER.every((pc) => {
    const fret = fretOf(lowE.midi, pc);
    return fret >= 0 && fret < 12;
  }));

check('a fret and its note agree, both ways',
  standard.strings.every((s) =>
    Array.from({ length: 24 }, (_, fret) => fret).every((fret) =>
      fretOf(s.midi, noteAtFret(s.midi, fret)) === fret % 12)));
check('twelve frets is the same note again',
  standard.strings.every((s) => noteAtFret(s.midi, 12) === noteAtFret(s.midi, 0)));
check('each fret up is one semitone up',
  standard.strings.every((s) =>
    Array.from({ length: 23 }, (_, fret) => fret).every((fret) =>
      semitonesUp(noteAtFret(s.midi, fret), noteAtFret(s.midi, fret + 1)) === 1)));
check('the string names match the tuner',
  standard.strings.every((s) => sharpName(pitchClass(s.midi)) === s.name),
  standard.strings.map((s) => s.name).join(' '));

console.log('\nThe neck markers\n');

check('nothing at the nut', inlayAt(0) === 0);
check('single dots at 3 5 7 9', [3, 5, 7, 9].every((f) => inlayAt(f) === 1));
check('double dots at the octave', inlayAt(12) === 2 && inlayAt(24) === 2);
check('the pattern repeats above the octave', [15, 17, 19, 21].every((f) => inlayAt(f) === 1));
check('nothing anywhere else',
  [1, 2, 4, 6, 8, 10, 11, 13, 14, 16, 18, 20, 22, 23].every((f) => inlayAt(f) === 0));

console.log(failures ? `\n${failures} failed\n` : '\nAll good\n');
process.exit(failures ? 1 : 0);
