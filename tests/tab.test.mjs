// Reading a riff.
//
// A tab arrives as plain text a person typed into a practice note, and every
// claim the drawn staff makes is a claim made here first: which fret is on which
// string at which column, where the bars are, which of them send the player
// back, where the beats fall, and how the whole thing breaks into lines that fit
// a phone. The drawing is checked in a browser; this is where the reading is
// settled.
//
// The two properties that must never be lost are at the bottom: prose is not a
// tab just because it contains a pipe, and nothing in here throws or invents a
// note on input it cannot read.

import {
  looksLikeTab,
  parseTab,
  readScore,
  readStrings,
  readSystems,
} from '../src/lib/tab.ts';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `: ${detail}` : ''}`);
};

const score = (text) => readScore(parseTab(text)[0]);

// --- Fixtures ---------------------------------------------------------------
//
// Written out in full rather than generated, because the whole point of every
// one of them is where a character sits relative to the character above it.

// A count row over its own frets, a repeat at both ends, two bars.
// Notes land on columns 3, 6, 9, 12, 15, 18, 21, 24; so does the count.
const FIGURE = '0--0--2--2--0--0--2--2';
const COUNTED = [
  'Main riff',
  `    1  +  2  +  3  +  4  +`,
  `D|:-${FIGURE}-|-${FIGURE}-:|`,
  `A|:-${'-'.repeat(FIGURE.length)}-|-${'-'.repeat(FIGURE.length)}-:|`,
].join('\n');

// The riff the owner actually asked about: two strings, a repeat, no count.
const TWO_STRINGS = ['A|:--0--1--2--2--1--0--:|', `E|:${'-'.repeat(20)}:|`].join('\n');

// A note left ringing, written the way it was written in the note that produced
// the question "what does the bracket mean".
const TIED = ['e|--0---(0)--3--|', 'B|--------------|'].join('\n');

// Three bars, well past the width of a phone.
const WIDE = [
  'e|---------------|---------------|---------------|',
  'B|---------------|---------------|---------------|',
  'G|--0--2--4--5---|--0--2--4--5---|--0--2--4--5---|',
  'D|---------------|---------------|---------------|',
  'A|---------------|---------------|---------------|',
  'E|---------------|---------------|---------------|',
].join('\n');

// One riff written over two staves, the way a long one gets typed.
const MULTI = [
  'Verse',
  'e|--0--2--3--|',
  'B|-----------|',
  '',
  'e|--3--2--0--|',
  'B|-----------|',
].join('\n');

console.log('\nFinding the staff\n');

check('two staff lines is a tab', looksLikeTab(TWO_STRINGS));
check('one staff line is not', !looksLikeTab('e|--0--2--3--|'));
check('nothing is not', !looksLikeTab(undefined) && !looksLikeTab(''));

console.log('\nA counted riff\n');
{
  const s = score(COUNTED);
  check('the caption is kept', s.caption === 'Main riff', s.caption);
  check('two strings', s.labels.join('') === 'DA', s.labels.join(''));
  check('sixteen frets on the D string', s.notes.filter((n) => n.line === 0).length === 16);
  check('none on the A string', s.notes.filter((n) => n.line === 1).length === 0);

  const bars = s.bars;
  check('three rules', bars.length === 3, bars.map((b) => b.column).join(','));
  check('the first opens a repeat', bars[0].repeatStart && !bars[0].repeatEnd);
  check('the middle is a plain bar', !bars[1].repeatStart && !bars[1].repeatEnd);
  check('the last closes it', bars[2].repeatEnd && !bars[2].repeatStart);

  check('eight counts', s.beats.length === 8, s.beats.length);
  check('four of them are numbered', s.beats.filter((b) => b.primary).length === 4);
  check(
    'the ands land halfway between the beats',
    s.beats.map((b) => b.quarter).join(',') === '0,0.5,1,1.5,2,2.5,3,3.5',
    s.beats.map((b) => b.quarter).join(','),
  );

  // The single fact the whole count row exists for.
  const firstNote = s.notes.sort((a, b) => a.column - b.column)[0];
  check('beat one sits over the first fret played', s.beats[0].column === firstNote.column,
    `${s.beats[0].column} vs ${firstNote.column}`);
}

console.log('\nA riff on two strings\n');
{
  const s = score(TWO_STRINGS);
  check('six frets, all on the A string', s.notes.length === 6 && s.notes.every((n) => n.line === 0));
  check('it opens and closes on a repeat', s.bars[0].repeatStart && s.bars[s.bars.length - 1].repeatEnd);

  const strings = readStrings(s.labels);
  check('A is the fifth string', strings[0].position === 5, strings[0].position);
  check('E under it is the sixth', strings[1].position === 6, strings[1].position);
  check('and it is spoken as the low E', strings[1].spoken === 'low E', strings[1].spoken);
}

console.log('\nStrings, named and gauged\n');
{
  const six = readStrings(['e', 'B', 'G', 'D', 'A', 'E']);
  check('top line is the thinnest string', six[0].position === 1, six[0].position);
  check('bottom line is the thickest', six[5].position === 6, six[5].position);
  check('the two Es are told apart', six[0].spoken === 'high E' && six[5].spoken === 'low E',
    `${six[0].spoken} / ${six[5].spoken}`);

  const bare = readStrings(['', '', '', '', '', '']);
  check('an unlabelled six-line staff still gauges', bare.map((s) => s.position).join('') === '123456');
  check('but claims no note names', bare[0].spoken === 'string 1', bare[0].spoken);
}

console.log('\nA note left ringing\n');
{
  const s = score(TIED);
  const tied = s.notes.filter((n) => n.tied);
  check('the bracketed fret is read as tied', tied.length === 1 && tied[0].fret === '0', JSON.stringify(tied));
  check('the plain ones are not', s.notes.filter((n) => !n.tied).length === 2);
  check('the brackets are not notes of their own', s.notes.length === 3, s.notes.length);
}

console.log('\nTechnique between two frets\n');
{
  const s = score(['e|--0h2p0--5/7--3~~~--|', 'B|--------------------|'].join('\n'));
  const kinds = s.joins.map((j) => j.kind);
  check('a hammer, a pull, a slide and a vibrato', kinds.join(',') === 'hammer,pull,slide-up,vibrato', kinds.join(','));
  check('every join sits on the string it was written on', s.joins.every((j) => j.line === 0));
  check('and joins the two frets it sits between', s.joins.every((j) => j.to > j.from));
}

console.log('\nMulti-digit frets\n');
{
  const s = score(['e|--10--12--|', 'B|----------|'].join('\n'));
  check('ten is one note, not a one and a nought', s.notes.length === 2, s.notes.length);
  check('and it is two columns wide', s.notes.every((n) => n.width === 2));
  check('the frets read back as written', s.notes.map((n) => n.fret).join(',') === '10,12');
}

console.log('\nWrapping, not scrolling\n');
{
  const s = score(WIDE);
  check('the riff is wider than a phone', s.columns > 40, s.columns);

  const wide = readSystems(s, 200);
  check('given the room it stays on one line', wide.length === 1);

  const phone = readSystems(s, 26);
  check('on a phone it becomes several systems', phone.length >= 2, phone.length);
  check('no system is wider than the room', phone.every((sys) => sys.to - sys.from <= 26));
  check('every column is drawn exactly once',
    phone[0].from === 0 &&
      phone[phone.length - 1].to === s.columns &&
      phone.every((sys, i) => i === 0 || sys.from === phone[i - 1].to));

  // The break has to land on a barline, or a bar is cut in half across two
  // lines and the riff becomes unreadable in a different way.
  const rules = new Set(s.bars.flatMap((b) => [b.column, b.column + b.width]));
  check('every break lands on a barline', phone.slice(1).every((sys) => rules.has(sys.from)),
    phone.map((sys) => sys.from).join(','));

  // A bar that cannot fit at all still has to be drawn rather than dropped.
  const cramped = readSystems(s, 9);
  check('an impossible width still covers the riff',
    cramped[cramped.length - 1].to === s.columns && cramped.every((sys) => sys.to > sys.from));
}

console.log('\nSeveral staves\n');
{
  const blocks = parseTab(MULTI);
  check('two blocks', blocks.length === 2, blocks.length);
  check('the caption belongs to the first', blocks[0].caption === 'Verse' && blocks[1].caption === undefined);
  const scores = blocks.map(readScore);
  check('each stave carries its own notes', scores.every((s) => s.notes.length === 3));
  check('and reads in the order it was written',
    scores.map((s) => s.notes.map((n) => n.fret).join('')).join('|') === '023|320');
}

console.log('\nProse is not a tab\n');
{
  const prose = 'Play it slowly first | then take it up to speed.';
  check('one pipe in a sentence proves nothing', !looksLikeTab(prose));
  check('and it parses as a caption, not a staff',
    parseTab(prose)[0].caption === prose && parseTab(prose)[0].lines.length === 0);

  const twoSentences = 'Start slow | count out loud.\nThen speed up | keep the count.';
  check('two pipes in two sentences still prove nothing', !looksLikeTab(twoSentences));

  const numbers = 'Aim for 60 bpm today, 70 next week.';
  check('a line of numbers is not a count row',
    parseTab(numbers)[0].timing === undefined && parseTab(numbers)[0].caption === numbers);
}

console.log('\nNothing throws, nothing is invented\n');
{
  const nasty = [
    '',
    '   ',
    '|',
    '||',
    '|:',
    ':|',
    'e|',
    'e|\nB|',
    '1 + 2 + 3 + 4 +',
    'e|--(--|\nB|-----|',
    'e|--)0(--|\nB|-------|',
    'e|--h--p--|\nB|--------|',
    ' ',
    'e|'.repeat(400),
    '-'.repeat(5000),
    'e|--0--|\n\n\n\nB|--1--|',
  ];
  let threw = null;
  let invented = null;
  for (const input of nasty) {
    try {
      for (const block of parseTab(input)) {
        const s = readScore(block);
        readStrings(s.labels);
        readSystems(s, 20);
        // A fret that was never written must never appear.
        for (const note of s.notes) {
          if (!block.lines[note.line].content.includes(note.fret)) invented = `${input} -> ${note.fret}`;
        }
      }
    } catch (e) {
      threw = `${JSON.stringify(input.slice(0, 24))}: ${e && e.message}`;
      break;
    }
  }
  check('nothing throws on input it cannot read', threw === null, threw);
  check('and no fret appears that was not written', invented === null, invented);

  // Staff lines of different lengths put the closing rules at different columns,
  // which is broken input rather than a shorter riff. It still draws every fret
  // that was written; only the bar it cannot trust goes missing.
  const ragged = score(['e|--0--0--|', 'B|--1--1-|'].join('\n'));
  check('a ragged staff still draws its notes', ragged.notes.length === 4, ragged.notes.length);
  check('but claims no closing bar', ragged.bars.length === 1, ragged.bars.length);

  check('an empty note is no blocks at all', parseTab('').length === 0);
}

console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
