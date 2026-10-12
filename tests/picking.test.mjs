// Alternate picking, heard: single-string picks against the real click, through
// the real analyser. The drill claims to hear when each pick lands and nothing
// else, so that is all this checks, plus the flat/angled split it reports.
import { TimingAnalyser, TIMING_FRAME_SIZE } from '../src/audio/timing.ts';
import { renderClick, VOICES, accentFor } from '../src/audio/metronome.ts';
import { fitBeatGrid, summariseTiming } from '../src/lib/strumTiming.ts';
import { pickHalves, PICK_CEILING_BPM } from '../src/lib/picking.ts';
import { renderStrum, addRoom } from './browser/tone.mjs';

const RATE = 44100;
let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' - ' + d : ''}`); };

function take({ bpm, string, beats = 32, offsetMs = () => 0, amp = 0.3 }) {
  const period = 60 / bpm, lead = 0.6;
  const total = Math.ceil((lead + beats * period + 1.5) * RATE);
  const audio = new Float32Array(total);
  let seed = 4242;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let k = 0; k < beats; k++) {
    const at = lead + k * period;
    const click = renderClick(VOICES[accentFor(k, 4)], RATE, random);
    const st = Math.round(at * RATE);
    for (let i = 0; i < click.length && st + i < total; i++) audio[st + i] += click[i];
    const frets = [-1, -1, -1, -1, -1, -1];
    frets[string] = 0;
    // A pick stops the string it is about to strike: the previous note is cut
    // as the next one starts, which is what alternate picking on one string is.
    renderStrum(audio, Math.round((at + offsetMs(k) / 1000) * RATE), frets, { amp, spreadMs: 0, seed: 9 + k, dampAt: period, dampMs: 25 });
  }
  addRoom(audio, 0.0015, 11);
  const picks = [], clicks = [];
  const an = new TimingAnalyser({ sampleRate: RATE, onStrum: (o) => picks.push(o.at), onClick: (o) => clicks.push(o.at) });
  for (let at = 0; at + TIMING_FRAME_SIZE <= audio.length; at += TIMING_FRAME_SIZE) an.processFrame(audio.slice(at, at + TIMING_FRAME_SIZE));
  return { picks, clicks, period };
}

console.log('\nOne pick per click, on one string\n');
for (const string of [0, 3, 5]) {
  for (const bpm of [60, 90, PICK_CEILING_BPM]) {
    const { picks, clicks, period } = take({ bpm, string, offsetMs: (k) => ((k * 37) % 41) - 20 });
    const grid = fitBeatGrid(clicks, period);
    const s = grid ? summariseTiming(picks, grid) : null;
    check(`string ${6 - string} at ${bpm}: every pick heard and scored in time`,
      picks.length === 32 && s?.enough && s.score >= 95, `${picks.length} picks, score ${s?.score}`);
  }
}

console.log('\nFlat, then angled\n');
{
  const grid = { origin: 0, period: 0.5, clicks: 40 };
  const picks = [];
  for (let k = 0; k < 20; k++) picks.push({ at: k * 0.5 + ((k * 7) % 11 - 5) / 1000, half: 'flat' });
  for (let k = 20; k < 40; k++) picks.push({ at: k * 0.5 + (k % 2 ? 0.09 : ((k * 7) % 11 - 5) / 1000), half: 'angled' });
  const h = pickHalves(picks, grid);
  check('each half is scored on its own picks', h.flat.score === 100 && h.angled.score === 50, `${h.flat.score} / ${h.angled.score}`);
  check('a half with nothing in it is not a measurement', !pickHalves([], grid).flat.enough);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
