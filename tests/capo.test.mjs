// The capo offset has a sign, and getting it backwards would make detection
// worse than leaving it at zero. Prove the direction with transposed chromas.
import { matchChord, matchChordAmong } from '../src/audio/chords.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

// Idealised chroma for a chord, then rotated up by the capo's frets, which is
// what the microphone actually hears when a capo is on the neck.
const PC = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
function chromaFor(rootName, minor, capo) {
  const root = (PC[rootName] + capo) % 12;
  const tones = [root, (root + (minor ? 3 : 4)) % 12, (root + 7) % 12];
  const c = new Float32Array(12).fill(0.05);
  tones.forEach((t, i) => { c[t] = [1.0, 0.8, 0.9][i]; });
  return c;
}

const OPEN = [['A',false],['Am',true],['C',false],['D',false],['Dm',true],['E',false],['Em',true],['G',false]];
const rootOf = (n) => n.replace(/m$/, '');

console.log('\nWith no capo, the offset must not disturb anything\n');
for (const [name, minor] of OPEN) {
  const m = matchChord(chromaFor(rootOf(name), minor, 0), 0);
  check(`${name} matches`, m?.chord === name, m?.chord);
}

console.log('\nWith a capo, the shape is still the shape the drill asked for\n');
for (const capo of [1, 2, 3, 4, 5, 7]) {
  let wrong = [];
  for (const [name, minor] of OPEN) {
    const heard = chromaFor(rootOf(name), minor, capo);
    const m = matchChord(heard, capo);
    if (m?.chord !== name) wrong.push(`${name}->${m?.chord ?? 'none'}`);
  }
  check(`capo ${capo}: every open shape still reads as itself`, wrong.length === 0, wrong.join(' '));
}

console.log('\nThe offset is doing real work, not being ignored\n');
{
  // With the capo on but the offset left at zero, detection has to be wrong;
  // if this passed, the offset would be decorative.
  const heard = chromaFor('D', false, 2);
  const uncorrected = matchChord(heard, 0);
  check('leaving the offset at zero misreads a capoed chord',
    uncorrected?.chord !== 'D', `read as ${uncorrected?.chord ?? 'none'}`);
  check('applying the offset recovers it', matchChord(heard, 2)?.chord === 'D');
  // And the wrong direction must not accidentally work.
  check('the opposite sign does not also work', matchChord(heard, -2)?.chord !== 'D',
    `read as ${matchChord(heard, -2)?.chord ?? 'none'}`);
}

console.log('\nRestricted matching, which is what the drills actually use\n');
for (const capo of [0, 2, 4]) {
  const pairs = [['Dm','Am'],['A','D'],['Em','E'],['C','G']];
  let wrong = [];
  for (const [a, b] of pairs) {
    for (const target of [a, b]) {
      const heard = chromaFor(rootOf(target), target.endsWith('m'), capo);
      const m = matchChordAmong(heard, [a, b], capo);
      if (m?.chord !== target) wrong.push(`capo${capo} ${a}/${b}:${target}->${m?.chord ?? 'none'}`);
    }
  }
  check(`capo ${capo}: restricted pairs resolve to the right target`, wrong.length === 0, wrong.join(' '));
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
