// A guitar for a browser that does not have one.
//
// Chromium will play a WAV file into getUserMedia in place of a real microphone
// (--use-file-for-fake-audio-capture), which is the only way a test can prove
// the thing this product is built on: that a note played in the room reaches the
// screen. Its own built-in fake device emits a beep pattern no pitch detector
// would call a guitar string, so the file is generated here instead.
//
// Four open strings, plucked in turn with a real decay envelope so each one dies
// before the next begins. The detector's note tracking re-arms on that silence,
// so four plucks are four separate events rather than one long tone.
//
// Written to a temp path at run time rather than committed: it is 350 kB of
// samples that a dozen lines can regenerate exactly.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RATE = 16000;
/** Open E, A, D and G, at concert pitch. */
export const PLUCKED_STRINGS = [
  { name: 'E', hz: 82.41 },
  { name: 'A', hz: 110.0 },
  { name: 'D', hz: 146.83 },
  { name: 'G', hz: 196.0 },
];
const NOTE_MS = 1400;
const GAP_MS = 500;

export function writeFakeGuitarWav(path = join(tmpdir(), 'daily-fret-strings.wav')) {
  const total = Math.round(((NOTE_MS + GAP_MS) / 1000) * RATE) * PLUCKED_STRINGS.length;
  const pcm = new Int16Array(total);
  let at = 0;
  for (const { hz } of PLUCKED_STRINGS) {
    const samples = Math.round((NOTE_MS / 1000) * RATE);
    for (let i = 0; i < samples; i++) {
      const decay = Math.exp(-3.2 * (i / samples));
      const v = Math.sin((2 * Math.PI * hz * i) / RATE) * 0.55 * decay;
      pcm[at + i] = Math.max(-1, Math.min(1, v)) * 32767;
    }
    at += samples + Math.round((GAP_MS / 1000) * RATE);
  }

  const bytes = Buffer.alloc(44 + pcm.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + pcm.length * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); // PCM
  bytes.writeUInt16LE(1, 22); // mono
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer).copy(bytes, 44);
  writeFileSync(path, bytes);
  return path;
}

/** Chromium flags that put the file above on the other end of the microphone. */
export function fakeGuitarArgs(wavPath) {
  return [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${wavPath}`,
  ];
}
