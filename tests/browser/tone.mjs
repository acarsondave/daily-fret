// Test signals for the tuner, written as 16-bit PCM WAV.
//
// Chromium can be handed a file as its microphone
// (--use-file-for-fake-audio-capture), so the whole capture path runs for real:
// the worklet, the YIN estimator, the median filter, the settle and drift
// timers. The only thing faked is the physical microphone. Generated here at run
// time rather than committed, so the suite carries no binary fixtures.

import { writeFileSync, mkdirSync } from 'node:fs';

const RATE = 44100;

/** Standard tuning, by string position. 6 is the thickest. */
export const STANDARD = { 6: 82.41, 5: 110.0, 4: 146.83, 3: 196.0, 2: 246.94, 1: 329.63 };

export const cents = (hz, c) => hz * Math.pow(2, c / 1200);

function encode(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

// Six harmonics on a steady fundamental. A pure sine is easier to estimate than
// a real string and would flatter the detector; a harmonic stack is closer to
// what a wound string actually presents.
export function tone(hz, seconds, amp = 0.34) {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  const partials = [1, 0.55, 0.32, 0.2, 0.12, 0.07];
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    for (let k = 0; k < partials.length; k++) v += partials[k] * Math.sin(2 * Math.PI * hz * (k + 1) * t);
    out[i] = (v / 2.26) * amp;
  }
  return out;
}

export const silence = (seconds) => new Float32Array(Math.floor(RATE * seconds));

export const SAMPLE_RATE = RATE;

/**
 * A tone that dies away, so one pluck can still be sounding under the next.
 *
 * `tau` is the seconds it takes to fall to a third. A wound low string rings for
 * many seconds; a plain high one is gone in two. That difference is the whole
 * reason a tuner ever hears two strings at once.
 */
export function decaying(hz, seconds, amp = 0.34, tau = 1.6) {
  const out = tone(hz, seconds, amp);
  for (let i = 0; i < out.length; i++) out[i] *= Math.exp(-(i / RATE) / tau);
  return out;
}

/**
 * Plucks laid onto one timeline at the moments they are struck, overlapping
 * exactly as they do on a guitar. `parts` are `[startSeconds, signal]`.
 */
export function layer(seconds, parts) {
  const out = new Float32Array(Math.floor(RATE * seconds));
  for (const [at, signal] of parts) {
    const start = Math.floor(at * RATE);
    const n = Math.min(signal.length, out.length - start);
    for (let i = 0; i < n; i++) out[start + i] += signal[i];
  }
  return out;
}

// --- strummed chords ------------------------------------------------------
//
// Chord Perfect's rep is place, strum, lift clear, place again. Reproducing the
// drill needs audio with that shape in it: an attack, a ring that decays, the
// damping of a hand coming off the strings, and the next attack. Everything
// below exists to make one rep, so a take can be built with a known number of
// strums in it and the count the drill reports can be compared against a true
// number instead of against a guess.

// Open-string MIDI notes, low E to high E.
const OPEN = [40, 45, 50, 55, 59, 64];

/** Fretted positions, low E to high E; -1 is a muted (unplayed) string. */
export const VOICINGS = {
  A: [-1, 0, 2, 2, 2, 0],
  Am: [-1, 0, 2, 2, 1, 0],
  C: [-1, 3, 2, 0, 1, 0],
  D: [-1, -1, 0, 2, 3, 2],
  Dm: [-1, -1, 0, 2, 3, 1],
  E: [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0],
  G: [3, 2, 0, 0, 0, 3],
  F: [1, 3, 3, 2, 1, 1],
  // Not a chord: six open strings, which is what a guitar sounds like at the
  // moment a hand lifts off a shape and lets go.
  open: [0, 0, 0, 0, 0, 0],
};

// Deterministic noise. A test that only passes on some seeds is not a test.
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000 * 2 - 1;
  };
}

/**
 * One strummed chord, rendered into `out` starting at sample `at`.
 *
 * Each string is a decaying harmonic stack, struck a few milliseconds after the
 * one below it (a downstroke), preceded by a short pick transient so the strum
 * presents the spectral flux a real one does. `dampAt`/`dampMs` model the hand
 * coming off: the whole voicing fades over that window, which is what lifting
 * off actually does to a ringing chord.
 */
export function renderStrum(out, at, frets, opts = {}) {
  const {
    amp = 0.5,
    spreadMs = 14,
    decay = 1.9, // seconds to 1/e for the fundamental of a low string
    dampAt = null, // seconds after the attack when the hand lifts
    dampMs = 70,
    // A pick transient is what a strum has and a lift does not: strings already
    // moving simply carry on, with no contact and no rise in level.
    pick = true,
    // Seconds to fade in. A strum starts instantly; a string whose fretting hand
    // has just come off does not restart, it changes pitch while it is already
    // moving, so its open content arrives as the fretted content dies. Starting
    // it at full level instead would put a click in the audio, and a click is an
    // attack, which is precisely what a lift must not look like.
    fadeMs = 0,
    seed = 7,
  } = opts;
  const rand = noise(seed);
  const tail = out.length - at;
  const sounded = frets.filter((f) => f >= 0).length;
  if (sounded === 0) return;
  const gain = amp / Math.sqrt(sounded);

  for (let string = 0; string < 6; string++) {
    const fret = frets[string];
    if (fret < 0) continue;
    const hz = 440 * Math.pow(2, (OPEN[string] + fret - 69) / 12);
    const start = Math.round((string * spreadMs / 1000) * RATE);
    // Wound low strings sustain longer than plain high ones.
    const tau = decay * Math.pow(0.86, string);

    // Higher partials die first, which is what makes a decayed chord duller
    // than the attack that produced it.
    const partials = [];
    for (let k = 1; k <= 8; k++) {
      const f = hz * k;
      if (f > RATE / 2) break;
      partials.push({ w: 2 * Math.PI * f / RATE, a: 1 / Math.pow(k, 1.25), d: Math.exp(-1 / (RATE * tau / Math.pow(k, 0.6))) });
    }
    const level = partials.map((p) => p.a);
    let damp = 1;
    const dampStep = Math.exp(-1 / (RATE * (dampMs / 1000)));

    for (let i = start; i < tail; i++) {
      const n = i - start;
      const t = n / RATE;
      let v = 0;
      let loudest = 0;
      for (let k = 0; k < partials.length; k++) {
        v += level[k] * Math.sin(partials[k].w * n);
        level[k] *= partials[k].d;
        if (level[k] > loudest) loudest = level[k];
      }
      // Pick transient: a few ms of broadband energy at the moment of contact.
      if (pick && t < 0.005) v += rand() * 0.5 * (1 - t / 0.005);
      if (dampAt !== null && t > dampAt) damp *= dampStep;
      const fade = fadeMs > 0 ? 1 - Math.exp(-t / (fadeMs / 1000)) : 1;
      out[at + i] += v * gain * damp * fade;
      if (loudest * damp < 1e-5) break;
    }
  }
}

/**
 * A Chord Perfect take: `reps` strums of one shape, at a fixed pace.
 *
 * `ringSec` is how long the chord is left to ring before the hand lifts, so a
 * take can be built where the sound dies between reps and a take where it does
 * not. The second is the harder and more honest case: at pace the previous
 * chord is still sounding when the next strum lands.
 *
 * `liftRing` leaves the open strings sounding after the hand comes off, which is
 * what a real lift does when the strings are still moving. It is a different
 * chroma from the shape and it belongs to no chord at all.
 */
export function chordPerfectTake(chord, reps, opts = {}) {
  const {
    repSec = 1.5,
    ringSec = 0.9,
    leadSec = 0.4,
    tailSec = 1.2,
    room = 0.0015,
    amp = 0.5,
    liftRing = false,
    seed = 7,
  } = opts;
  const frets = VOICINGS[chord];
  if (!frets) throw new Error(`no voicing for "${chord}"`);
  const total = Math.ceil((leadSec + reps * repSec + tailSec) * RATE);
  const out = new Float32Array(total);
  for (let r = 0; r < reps; r++) {
    const at = Math.round((leadSec + r * repSec) * RATE);
    renderStrum(out, at, frets, { amp, dampAt: ringSec, seed: seed + r });
    if (!liftRing) continue;
    // The hand comes off and the strings carry on open: no contact, no pick, and
    // a level that picks up roughly where the fretted chord had decayed to. Only
    // the strings that were struck carry on, because the others were never
    // moving. This is the sound that used to be read as a chord in its own right.
    renderStrum(out, at + Math.round(ringSec * RATE), frets.map((f) => (f < 0 ? -1 : 0)), {
      amp: amp * 0.45,
      spreadMs: 0,
      pick: false,
      // Fades in over the same window the fretted chord is damping out across,
      // so the two cross and the level never steps up.
      fadeMs: 70,
      dampAt: Math.max(0.05, repSec - ringSec - 0.15),
      seed: seed + 100 + r,
    });
  }
  addRoom(out, room, seed);
  return out;
}

/**
 * A changes take: two or more shapes played in turn, one strum each.
 *
 * This is what One-Minute Changes and Anchor Changes actually listen to, and it
 * is the take that has to keep reporting the same number after any change to how
 * a strum is recognised. `changes` is the number of moves between shapes, so the
 * take holds `changes + 1` strums.
 */
export function changesTake(chords, changes, opts = {}) {
  const {
    repSec = 1.0,
    ringSec = 0.85,
    leadSec = 0.4,
    tailSec = 1.2,
    room = 0.0015,
    amp = 0.5,
    seed = 7,
  } = opts;
  const strums = changes + 1;
  const total = Math.ceil((leadSec + strums * repSec + tailSec) * RATE);
  const out = new Float32Array(total);
  for (let r = 0; r < strums; r++) {
    const frets = VOICINGS[chords[r % chords.length]];
    if (!frets) throw new Error(`no voicing for "${chords[r % chords.length]}"`);
    renderStrum(out, Math.round((leadSec + r * repSec) * RATE), frets, {
      amp, dampAt: ringSec, seed: seed + r,
    });
  }
  addRoom(out, room, seed);
  return out;
}

/** Background hiss, so the noise floor has something real to track. */
export function addRoom(buf, level = 0.0015, seed = 11) {
  if (level <= 0) return buf;
  const rand = noise(seed + 991);
  for (let i = 0; i < buf.length; i++) buf[i] += rand() * level;
  return buf;
}


export function write(path, parts) {
  const total = parts.reduce((n, a) => n + a.length, 0);
  const all = new Float32Array(total);
  let at = 0;
  for (const a of parts) { all.set(a, at); at += a.length; }
  writeFileSync(path, encode(all));
}

export function writeFixtures(dir) {
  mkdirSync(dir, { recursive: true });

  write(`${dir}/silence.wav`, [silence(6)]);
  write(`${dir}/flat.wav`, [tone(cents(STANDARD[5], -38), 8)]);
  write(`${dir}/tuned-a.wav`, [tone(STANDARD[5], 8)]);

  // The sequence advancing on its own: low E settles, then A settles.
  write(`${dir}/advance.wav`, [
    tone(STANDARD[6], 3.6), silence(0.5),
    tone(STANDARD[5], 3.6), silence(4),
  ]);

  // Hysteresis, in one file. A settles; then reads 8 cents flat, which must not
  // pull the tick; then 30 cents flat, which must.
  write(`${dir}/hysteresis.wav`, [
    tone(STANDARD[5], 4), silence(0.4),
    tone(cents(STANDARD[5], -8), 4), silence(0.4),
    tone(cents(STANDARD[5], -30), 4), silence(3),
  ]);

  // All six, low to high, then a settled string coming back out.
  const round = [];
  for (const p of [6, 5, 4, 3, 2, 1]) round.push(tone(STANDARD[p], 3.2), silence(0.5));
  write(`${dir}/allsix.wav`, [...round, silence(3)]);
  write(`${dir}/allsix-then-drift.wav`, [
    ...round,
    tone(cents(STANDARD[4], -35), 4),
    silence(3),
  ]);

  // The reported defect, as audio.
  //
  // The low E is struck and left ringing, and a quarter of a second later, well
  // before it has died, the high E is struck over it. The two are exactly two
  // octaves apart, so the pair repeats at the low E's period: a periodicity
  // estimator reports 82.4 Hz at full confidence and is not wrong about the
  // period, only about the question. Nothing may put a green tick on the low E
  // here. The player is sounding the high E.
  write(`${dir}/two-octaves.wav`, [
    silence(0.3),
    layer(10, [
      [0, decaying(STANDARD[6], 10, 0.3, 6)],
      [0.25, decaying(STANDARD[1], 9.7, 0.3, 6)],
    ]),
    silence(2),
  ]);

  // Playing fast. Six strings in a row, each struck before the last has died,
  // one every 400 ms. Nothing here is held long enough to be called in tune, and
  // the display must be about whichever string was struck last rather than
  // sitting on an old reading while the player has moved on.
  write(`${dir}/fast-change.wav`, [
    silence(0.3),
    layer(4.4, [6, 5, 4, 3, 2, 1].map((p, i) => [i * 0.4, decaying(STANDARD[p], 2, 0.34, 0.6)])),
    silence(3),
  ]);

  return dir;
}
