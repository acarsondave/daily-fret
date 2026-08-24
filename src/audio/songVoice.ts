// A chord, strummed, out of the shapes the app already knows.
//
// Chart mode without this is a metronome with lyrics, and nobody opens that
// twice. What it has to clear is not "sounds like the record": it is "sounds
// like someone sitting on the sofa playing the chords with you". A plucked
// string clears that bar; a synthesised pad or a stack of sine tones does not,
// and would be worse than silence.
//
// So: Karplus-Strong, one delay line per sounding string, at the pitch the
// player's own fingers are making. The fret positions come from
// src/data/chordShapes.ts, which already knows which strings are muted, and a
// muted string contributes nothing at all rather than being quietly played open.
//
// Rendered once into a buffer per (chord, direction, capo) and replayed, exactly
// as the metronome caches its click voices, for the same two reasons: the whole
// waveform is available to shape, and a stroke then costs one node instead of a
// graph the pitch detector would have to queue behind.

import type { ChordShape } from '../data/chordShapes';

/** Standard tuning, low E to high E, as MIDI note numbers. */
export const OPEN_STRINGS = [40, 45, 50, 55, 59, 64] as const;

export type StrumDir = 'D' | 'U' | 'X';

/**
 * Seconds between one string being struck and the next.
 *
 * The whole point of a strum rather than a chord is that the strings do not
 * arrive together. Twenty milliseconds across six strings is a firm, ordinary
 * down stroke; an up stroke is a shade quicker, because it usually is.
 */
const STRING_GAP_S: Record<StrumDir, number> = { D: 0.004, U: 0.0034, X: 0.0028 };

/** How long the ring lasts, to sixty decibels down. A dead stroke barely does. */
const DECAY_S: Record<StrumDir, number> = { D: 1.5, U: 1.2, X: 0.055 };

/**
 * Where the loop filter sits, 0.5 being the classic averaging pair.
 *
 * Above it the string keeps its highs and reads as brighter, which is what an up
 * stroke sounds like: it lands on the thin strings first, with less of the pick
 * on them. A dead stroke is the same gesture with the ring taken out.
 */
const BRIGHTNESS: Record<StrumDir, number> = { D: 0.5, U: 0.62, X: 0.24 };

/** How the stroke is weighted across the strings, low to high. */
const TILT: Record<StrumDir, { low: number; high: number }> = {
  D: { low: 1, high: 0.78 },
  U: { low: 0.5, high: 1 },
  X: { low: 0.92, high: 0.92 },
};

/** Peak the finished buffer is normalised to. Under the downbeat click's 0.82. */
export const STRUM_PEAK = 0.5;

const ATTACK_S = 0.0008; // per string, so the noise burst is not itself a click
const TAPER_S = 0.006; // a decay cut off where the buffer ends is another click

export interface StringOnset {
  /** 0 is the low E. */
  string: number;
  fret: number;
  freq: number;
  /** Sample this string is struck at, from the start of the buffer. */
  startSample: number;
  gain: number;
}

const frequencyOf = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Which strings sound, in the order the pick reaches them.
 *
 * Separate from the rendering so the order and the pitches can be checked
 * without inspecting a waveform. A down stroke runs low to high, an up stroke
 * runs high to low, and a `-1` string is simply not in the list.
 */
export function strumOnsets(
  shape: ChordShape,
  dir: StrumDir,
  sampleRate: number,
  semitoneOffset: number,
): StringOnset[] {
  const gap = STRING_GAP_S[dir];
  const tilt = TILT[dir];
  const order = dir === 'U' ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
  const onsets: StringOnset[] = [];
  let step = 0;
  for (const string of order) {
    const fret = shape.frets[string];
    // A muted string is muted. Treating -1 as open is the one mistake here that
    // would be audible on every chord in the catalogue: A, D, Dm and F all mute
    // the bottom, and an open low E under D is a different chord.
    if (typeof fret !== 'number' || fret < 0) continue;
    const share = string / (OPEN_STRINGS.length - 1);
    onsets.push({
      string,
      fret,
      freq: frequencyOf(OPEN_STRINGS[string] + fret + semitoneOffset),
      startSample: Math.round(step * gap * sampleRate),
      gain: tilt.low + (tilt.high - tilt.low) * share,
    });
    step += 1;
  }
  return onsets;
}

/**
 * One strum, rendered.
 *
 * `semitoneOffset` is the capo. The backing sounds at capo pitch on purpose: the
 * chart tells the player where to put the clamp, and a backing at written pitch
 * would clash a whole tone against anyone who did what the chart said.
 */
export function renderStrum(
  shape: ChordShape,
  dir: StrumDir,
  sampleRate: number,
  semitoneOffset: number,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> {
  const onsets = strumOnsets(shape, dir, sampleRate, semitoneOffset);
  const spread = onsets.length ? onsets[onsets.length - 1].startSample : 0;
  const ring = Math.ceil(DECAY_S[dir] * sampleRate);
  const out = new Float32Array(spread + ring);
  if (!onsets.length) return out;

  const bright = BRIGHTNESS[dir];
  const attack = Math.max(2, Math.round(ATTACK_S * sampleRate));

  for (const onset of onsets) {
    const period = Math.max(2, Math.round(sampleRate / onset.freq));
    // The loop's loss is applied once per trip round the delay line, not once
    // per sample, and a delay line is one period long. So the loss that gets a
    // string sixty decibels down in `DECAY_S` seconds depends on its pitch: a
    // low E goes round eighty-two times a second and a high E three hundred and
    // thirty. Computing it per sample instead left every stroke still ringing at
    // full volume where the buffer ended, with the taper doing the whole job.
    const rho = Math.pow(10, -3 / Math.max(1e-6, (sampleRate / period) * DECAY_S[dir]));
    const line = new Float32Array(period);
    for (let i = 0; i < period; i++) line[i] = random() * 2 - 1;

    let index = 0;
    let last = 0;
    const length = out.length - onset.startSample;
    for (let n = 0; n < length; n++) {
      const current = line[index];
      // One-pole lowpass inside the loop. `bright` is how much of the string's
      // own sample survives each pass, which is what makes one stroke read as
      // brighter than another rather than merely louder.
      const filtered = rho * (bright * current + (1 - bright) * last);
      line[index] = filtered;
      last = filtered;
      const ramp = n < attack ? 0.5 * (1 - Math.cos((Math.PI * n) / (attack - 1))) : 1;
      out[onset.startSample + n] += current * onset.gain * ramp;
      index = index + 1 === period ? 0 : index + 1;
    }
  }

  // Raised cosine to exactly zero on the last sample, following renderClick: a
  // decay simply truncated where the buffer ends is a step, and a step is a
  // click across the whole spectrum.
  const taper = Math.min(out.length, Math.max(2, Math.round(TAPER_S * sampleRate)));
  for (let i = 0; i < taper && taper > 1; i++) {
    out[out.length - taper + i] *= 0.5 * (1 + Math.cos((Math.PI * i) / (taper - 1)));
  }

  let loudest = 0;
  for (let i = 0; i < out.length; i++) loudest = Math.max(loudest, Math.abs(out[i]));
  if (loudest > 0) {
    const scale = STRUM_PEAK / loudest;
    for (let i = 0; i < out.length; i++) out[i] *= scale;
  }
  return out;
}
