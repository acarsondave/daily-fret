// Turning round at the ends of an anchor path.
//
// The anchor drill used to loop, so D, A, E ran D→A→E→D→A→E for as long as you
// held it. That drilled each transition one way only and threw in an E→D jump
// between two chords that are not neighbours in the exercise at all. It now
// sweeps: D→A→E→A→D→A→E, both directions of every neighbouring pair and nothing
// else.
//
// Tested as the whole sequence rather than as single steps, because the bug this
// kind of code has is never one wrong index, it is a turn that repeats a chord
// or skips one, and only a run of steps shows that.

import { sweepStep } from '../src/lib/sweep.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${!ok && d ? ' · ' + d : ''}`); };

/** Walk a path from a starting index and report the chords in the order cued. */
function walk(ring, startAt, steps, startDir = 1) {
  const out = [ring[startAt]];
  let at = startAt;
  let dir = startDir;
  for (let i = 0; i < steps; i += 1) {
    const s = sweepStep(at, dir, ring.length);
    at = s.next;
    dir = s.dir;
    out.push(ring[at]);
  }
  return out;
}

console.log('\nThe owner\'s own drill\n');
{
  const ring = ['D', 'A', 'E'];
  const seq = walk(ring, 0, 8).join(' ');
  check('sweeps back and forth instead of looping',
    seq === 'D A E A D A E A D', seq);

  // The exact thing the loop got wrong: it went ...E then straight back to D.
  check('and never jumps from the last chord to the first',
    !seq.includes('E D') && !seq.includes('D E'), seq);
}

console.log('\nEvery neighbour, both ways, and nothing else\n');
{
  const ring = ['D', 'A', 'E'];
  const seq = walk(ring, 0, 12);
  const pairs = new Set();
  for (let i = 1; i < seq.length; i += 1) pairs.add(`${seq[i - 1]}>${seq[i]}`);
  check('all four neighbouring transitions are drilled',
    ['D>A', 'A>E', 'E>A', 'A>D'].every((p) => pairs.has(p)),
    [...pairs].join(' '));
  check('and no transition between non-neighbours ever happens',
    pairs.size === 4, [...pairs].join(' '));
}

console.log('\nStarting anywhere\n');
{
  const ring = ['D', 'A', 'E'];
  // The drill takes whichever chord the player opens on, so the turn has to be
  // right from any of them.
  check('from the middle', walk(ring, 1, 6).join(' ') === 'A E A D A E A',
    walk(ring, 1, 6).join(' '));
  // Opening on the last chord: the only way on is backwards, and the caller
  // hands in -1 for exactly that.
  check('from the far end, travelling back', walk(ring, 2, 6, -1).join(' ') === 'E A D A E A D',
    walk(ring, 2, 6, -1).join(' '));
}

console.log('\nPaths that are not three long\n');
{
  check('two chords sweep the same as they looped',
    walk(['A', 'D'], 0, 5).join(' ') === 'A D A D A D',
    walk(['A', 'D'], 0, 5).join(' '));

  const five = ['C', 'G', 'Am', 'F', 'E'];
  check('five turn at both ends',
    walk(five, 0, 8).join(' ') === 'C G Am F E F Am G C',
    walk(five, 0, 8).join(' '));

  // rotationRing refuses to build one of these, and this must not quietly
  // become a loop if that ever changes.
  const one = sweepStep(0, 1, 1);
  check('a single chord cannot move and does not wrap',
    one.next === 0, JSON.stringify(one));
  const none = sweepStep(0, 1, 0);
  check('and neither does an empty path', none.next === 0, JSON.stringify(none));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
