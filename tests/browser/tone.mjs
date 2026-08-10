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

  return dir;
}
