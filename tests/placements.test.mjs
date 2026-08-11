// Chord Perfect, driven by audio with a known number of strums in it.
//
// This suite exists because of one bug report: "the chord perfect doesn't detect
// properly. When I lift off and place to strum again, it either doesn't work or
// it just counts weirdly." That is the drill's only rep, so the drill was close
// to useless, and no unit test could have caught it: the counting was correct
// against the events it was given and wrong about what those events meant.
//
// So the audio is generated with the rep in it — attack, ring, lift, silence,
// attack — the real detector runs over it frame by frame exactly as it does on a
// microphone, and the number the drill would show is compared against the number
// of strums that were actually synthesised.
//
// The failure it pins down: counting used to require the chord to DISAPPEAR
// before it could count again, and a strummed chord rings on through the lift and
// into the next placement. Before the fix, a take of twelve strums at a normal
// playing pace counted one.

import { ChordDetector, FRAME_SIZE } from '../src/audio/detector.ts';
import { PlacementCounter } from '../src/audio/placement.ts';
import {
  SAMPLE_RATE, VOICINGS, chordPerfectTake, changesTake, renderStrum, addRoom, silence,
} from './browser/tone.mjs';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const POOL = ['Dm', 'Am', 'Em'];

/** Run audio through the real detector and report what each drill would count. */
function drive(pcm, { target, restrictTo }) {
  const counter = new PlacementCounter();
  counter.begin(target);
  let now = 0;
  let strums = 0;
  const emitted = [];
  const detector = new ChordDetector({
    sampleRate: SAMPLE_RATE,
    restrictTo,
    onLevel: (ev) => {
      if (ev.strum) strums += 1;
      counter.frame(ev, now);
    },
    onChord: (ev) => emitted.push(ev.chord),
  });
  for (let i = 0; i + FRAME_SIZE <= pcm.length; i += FRAME_SIZE) {
    now = Math.round((i / SAMPLE_RATE) * 1000);
    detector.processFrame(pcm.subarray(i, i + FRAME_SIZE));
  }
  return { placements: counter.count, strums, emitted };
}

// --- the rep, at every pace and every way the sound can behave ---------------

console.log('\nChord Perfect counts the strums it was given\n');

// The four takes are the four things a rep can sound like. The two "still
// ringing" ones are the report: at pace the chord has not finished when the next
// placement lands, so nothing about the chord's presence marks the boundary.
const TAKES = [
  ['sound dies away between reps', { repSec: 1.5, ringSec: 0.9 }],
  ['lift leaves the strings ringing open', { repSec: 1.5, ringSec: 0.9, liftRing: true }],
  ['at pace, still ringing into the next strum', { repSec: 0.8, ringSec: 0.7 }],
  ['at pace, lift ringing into the next strum', { repSec: 0.8, ringSec: 0.6, liftRing: true }],
];

for (const chord of POOL) {
  for (const [label, opts] of TAKES) {
    const reps = 12;
    const { placements, strums } = drive(chordPerfectTake(chord, reps, opts), {
      target: chord,
      restrictTo: POOL,
    });
    check(`${chord}: ${label}`, placements === reps, `${placements} counted, ${reps} strummed (${strums} strums seen)`);
  }
}

// A chord left to ring for seconds with no lift at all is not the drill's motion,
// and the last strum of such a take can land while the previous one is still
// loud enough to hide it. One missed rep out of twelve is the acceptable side of
// that trade; an invented one would not be.
{
  const { placements } = drive(chordPerfectTake('Dm', 12, { repSec: 2.4, ringSec: 2.4 }), {
    target: 'Dm', restrictTo: POOL,
  });
  check('a chord rung out for seconds still counts nearly every rep',
    placements >= 11 && placements <= 12, `${placements} of 12`);
}

// --- what must never produce a count ----------------------------------------

console.log('\nNothing the player did not do is counted\n');

{
  const room = addRoom(silence(12), 0.0015);
  const { placements } = drive(room, { target: 'Dm', restrictTo: POOL });
  check('twelve seconds of room noise', placements === 0, `${placements} counted`);
}

{
  const loudRoom = addRoom(silence(12), 0.006);
  const { placements } = drive(loudRoom, { target: 'Dm', restrictTo: POOL });
  check('a noisier room', placements === 0, `${placements} counted`);
}

{
  // The neighbours are in the pool precisely so a wrong shape has somewhere to
  // land instead of winning by default.
  const { placements } = drive(chordPerfectTake('Am', 12, { repSec: 1.5, ringSec: 0.9 }), {
    target: 'Dm', restrictTo: POOL,
  });
  check('twelve strums of the neighbouring shape', placements === 0, `${placements} counted`);
}

{
  const one = chordPerfectTake('Dm', 1, { repSec: 5, ringSec: 5, tailSec: 5 });
  const { placements } = drive(one, { target: 'Dm', restrictTo: POOL });
  check('one strum left ringing for five seconds counts once', placements === 1, `${placements} counted`);
}

{
  // A hand coming off a shape leaves the open strings sounding, and open strings
  // are read as Em (or as E, in a major ring). The matcher has to call that
  // chroma something, so the guard cannot be "do not detect it" — it has to be
  // that no strum happened. Twelve reps of Dm, every lift ringing open, while
  // the drill is asking for Em.
  const someoneElsesShape = chordPerfectTake('Dm', 12, { repSec: 1.5, ringSec: 0.9, liftRing: true });
  const asEm = drive(someoneElsesShape, { target: 'Em', restrictTo: POOL });
  check('twelve lifts, every one ringing open, while the drill wants Em',
    asEm.placements === 0,
    `${asEm.placements} counted; the matcher read those lifts as ${[...new Set(asEm.emitted)].join(' ')}`);
}

// --- the counter's own rules -------------------------------------------------

console.log('\nThe placement rule itself\n');

// One frame as the detector would report it. A strum carries how hard it hit and
// how far it rose above what it landed on, because a placement has to be paid
// for by sound that belongs to the strum rather than by a chord already ringing.
const level = (chord, strum, rms = 0.2, rise = 4) => ({
  rms, noiseFloor: 0.005, salience: 2, chroma: null, chord, margin: 0.5, strum,
  strumRms: strum ? rms : 0, strumRise: strum ? rise : 0,
});

{
  const c = new PlacementCounter();
  c.begin('Am');
  for (let i = 0; i < 200; i++) c.frame(level('Am', false), i * 23);
  check('the target chord alone, held forever, counts nothing', c.count === 0, `${c.count} counted`);
}

{
  const c = new PlacementCounter();
  c.begin('Am');
  c.frame(level('Am', true), 0);
  for (let i = 1; i < 200; i++) c.frame(level('Am', false), i * 23);
  check('one strum held forever counts exactly once', c.count === 1, `${c.count} counted`);
}

{
  const c = new PlacementCounter();
  c.begin('Am');
  for (let i = 0; i < 40; i++) c.frame(level(null, i === 0), i * 23);
  check('a strum whose chord never resolves counts nothing', c.count === 0, `${c.count} counted`);
}

{
  const c = new PlacementCounter();
  c.begin('Am');
  // A strum of the wrong shape, then the right one, with no strum of its own.
  c.frame(level('Em', true), 0);
  c.frame(level('Em', false), 23);
  for (let i = 2; i < 60; i++) c.frame(level('Am', false), i * 23);
  check('a strum credited to no shape is not redeemed by a later one',
    c.count === 0, `${c.count} counted`);
}

{
  const c = new PlacementCounter();
  c.begin('Am');
  let t = 0;
  for (let rep = 0; rep < 10; rep++) {
    c.frame(level('Am', true, 0.4), t);
    for (let i = 1; i < 30; i++) c.frame(level('Am', false, 0.3), t + i * 23);
    t += 700;
  }
  check('ten strums with no gap in the chord at all count ten', c.count === 10, `${c.count} counted`);
}

// Both of these come from a real session (diagnostics 2026-08-10) where they
// were counted as placements. Neither is one: no shape was built, and in both
// the frames that paid for the strum are the tail of a chord that was already
// sounding before it.
{
  const c = new PlacementCounter();
  c.begin('Em');
  let t = 0;
  c.frame(level('Em', true, 0.4), t);
  for (let i = 1; i < 20; i++) c.frame(level('Em', false, 0.3), t + i * 23);
  t += 20 * 23;
  // The hand mutes the strings: a transient louder than the strum, with nothing
  // behind it but the dying Em.
  c.frame(level('Em', true, 0.94, 3.3), t);
  for (let i = 1; i < 20; i++) c.frame(level('Em', false, 0.07), t + i * 23);
  check('a mute is not a placement, however loud it is', c.count === 1, `${c.count} counted`);
}

{
  const c = new PlacementCounter();
  c.begin('Em');
  let t = 0;
  c.frame(level('Em', true, 0.4), t);
  for (let i = 1; i < 12; i++) c.frame(level('Em', false, 0.23), t + i * 23);
  t += 12 * 23;
  // A swell inside the sustain of a chord that never went away. The onset
  // detector reads the ripple as an attack — just barely, at 1.20 against its
  // 1.2 bar — and the chord confirming it is the same one that was already
  // sounding, at a level close enough to the swell to look like its own.
  //
  // This one is still counted, and the assertion says so on purpose. Every rule
  // that separated it also threw away real reps: see the note in placement.ts.
  // If a change makes this read 1, that is progress and this line should move.
  c.frame(level('Em', true, 0.29, 1.2), t);
  for (let i = 1; i < 20; i++) c.frame(level('Em', false, 0.22), t + i * 23);
  check('KNOWN: a swell inside a ringing chord still counts as a placement',
    c.count === 2, `${c.count} counted`);
}

{
  const c = new PlacementCounter();
  c.begin('Am');
  // Two strums closer together than a hand can lift and rebuild a shape.
  c.frame(level('Am', true), 0);
  c.frame(level('Am', false), 23);
  c.frame(level('Am', false), 46);
  c.frame(level('Am', true), 90);
  for (let i = 1; i < 10; i++) c.frame(level('Am', false), 90 + i * 23);
  check('two strums inside one rep cannot both count', c.count === 1, `${c.count} counted`);
}

{
  const c = new PlacementCounter();
  c.begin('Am');
  c.frame(level('Am', true), 0);
  c.frame(level('Am', false), 23);
  c.frame(level('Am', false), 46);
  c.begin('Em');
  for (let i = 0; i < 40; i++) c.frame(level('Em', false), 200 + i * 23);
  check('the next shape does not inherit the last one\'s strum', c.count === 0, `${c.count} counted`);
}

// --- the drills that share the detector --------------------------------------
//
// Requiring a strum to be a rise in level, not just a spike in spectral flux,
// changes what the shared detector emits, so the two counting drills built on
// those emissions have to be shown still counting what they are given.

console.log('\nThe changes drills, on the same detector\n');

// One-Minute Changes counts an emitted chord that differs from the last, no
// faster than every 130ms.
function countChanges(emitted) {
  let last = '';
  let changes = 0;
  for (const chord of emitted) {
    if (chord === 'No Chord') continue;
    if (last !== '' && chord !== last) changes += 1;
    last = chord;
  }
  return changes;
}

for (const [pair, changes] of [[['Dm', 'Am'], 23], [['Dm', 'Em'], 23], [['Am', 'E'], 23]]) {
  const { emitted } = drive(changesTake(pair, changes, { repSec: 1.0, ringSec: 0.85 }), {
    target: pair[0], restrictTo: pair,
  });
  const counted = countChanges(emitted);
  check(`one-minute ${pair[0]}->${pair[1]}: ${counted} of ${changes} changes`,
    counted === changes, emitted.join(' '));
}

{
  // Anchor Changes rotates a ring, and the phantom chord this fix removes is
  // exactly the one that used to make the ring skip a step: a hand coming off D
  // reads as E, so the cue jumped past A.
  const ring = ['D', 'A', 'E'];
  const { emitted } = drive(changesTake(ring, 23, { repSec: 1.0, ringSec: 0.85, liftRing: true }), {
    target: 'D', restrictTo: ring,
  });
  const played = emitted.filter((c) => c !== 'No Chord');
  const expected = Array.from({ length: 24 }, (_, i) => ring[i % ring.length]);
  check(`rotation D>A>E reports the ring in order (${played.length} of 24)`,
    played.join(' ') === expected.join(' '), played.join(' '));
}

{
  // The same ring with nothing played at all. A rotation that counts a rest is
  // the failure the strum requirement is there to prevent.
  const { emitted } = drive(addRoom(silence(20), 0.0015), { target: 'D', restrictTo: ['D', 'A', 'E'] });
  check('a rotation hears no changes in an empty room',
    countChanges(emitted) === 0, emitted.join(' '));
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
