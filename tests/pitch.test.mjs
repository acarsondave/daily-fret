import { PitchDetector } from '../src/audio/pitch.ts';
import {
  TUNINGS, midiToHz, centsBetween, readPitch, nearestString, getTuning, midiToName,
} from '../src/audio/tuning.ts';

const FRAME = 1024;
let failures = 0;
function check(label, ok, detail) {
  if (!ok) { failures++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
  else console.log(`  ok    ${label}${detail ? ' — ' + detail : ''}`);
}

// A plucked string: fundamental plus a decaying harmonic series, with the
// fundamental deliberately weak on the low strings (that is where real guitars
// trip naive detectors into reading an octave up).
function pluck(hz, sr, seconds, opts = {}) {
  const { weakFundamental = false, noise = 0, harmonics = 8, inharmonicity = 0 } = opts;
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  for (let h = 1; h <= harmonics; h++) {
    const f = hz * h * (1 + inharmonicity * h * h);
    if (f > sr / 2) break;
    let amp = 1 / h ** 1.2;
    if (h === 1 && weakFundamental) amp *= 0.15;
    const phase = (h * 1.7) % (2 * Math.PI);
    const decay = 1.2 + h * 0.5;
    for (let i = 0; i < n; i++) {
      out[i] += amp * Math.sin((2 * Math.PI * f * i) / sr + phase) * Math.exp((-decay * i) / sr);
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) {
    out[i] = (out[i] / peak) * 0.35;
    if (noise) out[i] += (Math.random() * 2 - 1) * noise;
  }
  return out;
}

function run(signal, sr) {
  const det = new PitchDetector(sr);
  const readings = [];
  for (let i = 0; i + FRAME <= signal.length; i += FRAME) {
    const r = det.push(signal.subarray(i, i + FRAME));
    if (r) readings.push(r);
  }
  return readings;
}

function medianHz(readings, minClarity = 0.7) {
  const hz = readings.filter((r) => r.hz && r.clarity >= minClarity).map((r) => r.hz).sort((a, b) => a - b);
  return hz.length ? hz[Math.floor(hz.length / 2)] : null;
}

console.log('\n1. Open strings, every tuning, at 44100 and 48000 Hz');
for (const sr of [44100, 48000]) {
  let worst = 0;
  for (const tuning of TUNINGS) {
    for (const s of tuning.strings) {
      const target = midiToHz(s.midi);
      const readings = run(pluck(target, sr, 2.0, { weakFundamental: s.position >= 5 }), sr);
      const got = medianHz(readings);
      if (got === null) { check(`${tuning.id} ${s.name}${s.octave} @${sr}`, false, 'no reading'); continue; }
      const err = Math.abs(centsBetween(got, target));
      worst = Math.max(worst, err);
      if (err > 1.0) check(`${tuning.id} ${s.name}${s.octave} @${sr}`, false, `${err.toFixed(2)} cents off`);
    }
  }
  check(`all strings within 1 cent @${sr}`, worst <= 1.0, `worst ${worst.toFixed(3)} cents`);
}

console.log('\n2. Detuned strings — the actual job');
{
  const sr = 44100;
  let worst = 0;
  for (const offset of [-49, -30, -12, -5, -1, 0, 1, 5, 12, 30, 49]) {
    for (const s of getTuning('standard').strings) {
      const target = midiToHz(s.midi) * Math.pow(2, offset / 1200);
      const readings = run(pluck(target, sr, 2.0, { weakFundamental: s.position >= 5 }), sr);
      const got = medianHz(readings);
      if (got === null) { check(`${s.name}${s.octave} ${offset}c`, false, 'no reading'); continue; }
      worst = Math.max(worst, Math.abs(centsBetween(got, target)));
      const m = nearestString(got, getTuning('standard'));
      if (!m || m.string.midi !== s.midi) check(`${s.name}${s.octave} ${offset}c attributed`, false, `got ${m ? m.string.name + m.string.octave : 'none'}`);
      else if (Math.abs(m.cents - offset) > 1.5) check(`${s.name}${s.octave} ${offset}c reported`, false, `reported ${m.cents.toFixed(1)}c`);
    }
  }
  check('detuned strings tracked within 1 cent', worst <= 1.0, `worst ${worst.toFixed(3)} cents`);
}

console.log('\n3. Adversarial input');
{
  const sr = 44100;
  const silence = new Float32Array(sr * 1);
  check('silence yields no pitch', run(silence, sr).every((r) => r.hz === null));

  const noise = new Float32Array(sr * 1);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * 0.3;
  const noiseHigh = run(noise, sr).filter((r) => r.hz !== null && r.clarity >= 0.7);
  check('white noise never reads as a confident pitch', noiseHigh.length === 0, `${noiseHigh.length} confident readings`);

  const dc = new Float32Array(sr * 1).fill(0.4);
  check('pure DC yields no pitch', run(dc, sr).every((r) => r.hz === null || r.clarity < 0.7));

  // A strummed chord is not one pitch; it must not be reported as a tuned string.
  const chord = new Float32Array(sr * 2);
  for (const midi of [40, 47, 52, 56, 59, 64]) {
    const part = pluck(midiToHz(midi), sr, 2);
    for (let i = 0; i < chord.length; i++) chord[i] += part[i] / 6;
  }
  const chordReadings = run(chord, sr);
  const confidentChord = chordReadings.filter((r) => r.clarity >= 0.9).length;
  check('a strummed chord is not confidently a note', confidentChord < chordReadings.length * 0.5,
    `${confidentChord}/${chordReadings.length} at clarity>=0.9`);

  const clipping = pluck(midiToHz(40), sr, 2);
  for (let i = 0; i < clipping.length; i++) clipping[i] = Math.max(-1, Math.min(1, clipping[i] * 12));
  const clipped = medianHz(run(clipping, sr));
  check('a clipped low E still reads as low E', clipped !== null && Math.abs(centsBetween(clipped, midiToHz(40))) < 10,
    clipped ? `${Math.abs(centsBetween(clipped, midiToHz(40))).toFixed(1)}c` : 'none');

  const noisyRoom = pluck(midiToHz(64), sr, 2, { noise: 0.06 });
  const nr = medianHz(run(noisyRoom, sr));
  check('high E survives a noisy room', nr !== null && Math.abs(centsBetween(nr, midiToHz(64))) < 5,
    nr ? `${Math.abs(centsBetween(nr, midiToHz(64))).toFixed(2)}c` : 'none');

  const stiff = pluck(midiToHz(40), sr, 2, { inharmonicity: 0.0004 });
  const st = medianHz(run(stiff, sr));
  check('an inharmonic (stiff) low string stays in range', st !== null && Math.abs(centsBetween(st, midiToHz(40))) < 15,
    st ? `${centsBetween(st, midiToHz(40)).toFixed(1)}c` : 'none');
}

console.log('\n4. Octave errors (the classic failure)');
{
  const sr = 44100;
  let wrong = 0;
  for (const midi of [38, 40, 43, 45, 49, 50, 55, 57, 59, 62, 64]) {
    for (const weak of [false, true]) {
      const target = midiToHz(midi);
      const got = medianHz(run(pluck(target, sr, 2, { weakFundamental: weak }), sr));
      if (got === null) continue;
      const semis = Math.round(12 * Math.log2(got / target));
      if (semis !== 0) { wrong++; console.log(`        ${midiToName(midi).name}${midiToName(midi).octave} weak=${weak} -> ${semis} semitones off`); }
    }
  }
  check('no octave errors across the guitar range', wrong === 0, `${wrong} misreads`);
}

console.log('\n5. Theory helpers');
{
  check('A4 is 440', midiToHz(69) === 440);
  check('midi 40 names as E2', midiToName(40).name === 'E' && midiToName(40).octave === 2);
  check('midi 64 names as E4', midiToName(64).name === 'E' && midiToName(64).octave === 4);
  check('midi 59 names as B3', midiToName(59).name === 'B' && midiToName(59).octave === 3);
  const r = readPitch(440 * Math.pow(2, 25 / 1200));
  check('a quarter-tone sharp A reads as A with +25c', r.name === 'A' && Math.abs(r.cents - 25) < 0.001, `${r.cents.toFixed(3)}c`);
  const r2 = readPitch(440 * Math.pow(2, -49 / 1200));
  check('49 cents flat of A stays on A', r2.name === 'A' && Math.abs(r2.cents + 49) < 0.001);
  const r3 = readPitch(440 * Math.pow(2, -51 / 1200));
  check('51 cents flat of A flips to G#', r3.name === 'G#', `${r3.name} ${r3.cents.toFixed(1)}c`);
  check('cents are always within half a semitone', [55, 82.4, 100, 261.6, 999, 1399].every((hz) => Math.abs(readPitch(hz).cents) <= 50.0001));
  check('a note above every string is refused', nearestString(midiToHz(70), getTuning('standard')) === null);
  check('a note below every string is refused', nearestString(midiToHz(33), getTuning('standard')) === null);
  check('a note between two strings picks the closer one',
    nearestString(midiToHz(45) * Math.pow(2, 260 / 1200), getTuning('standard'))?.string.midi === 50);
  check('inside the range every pitch is attributed to some string',
    Array.from({ length: 400 }, (_, i) => midiToHz(40 + (i * 24) / 400))
      .every((hz) => nearestString(hz, getTuning('standard')) !== null));
  check('a badly sharp A string is still called the A string',
    nearestString(midiToHz(47), getTuning('standard'))?.string.midi === 45,
    `${nearestString(midiToHz(47), getTuning('standard'))?.cents.toFixed(0)}c`);
  check('a note 2 semitones flat of low E still finds low E', nearestString(midiToHz(38), getTuning('standard'))?.string.midi === 40);
  check('drop D attributes 38 to the 6th string', nearestString(midiToHz(38), getTuning('drop-d'))?.string.position === 6);
  check('string positions run 6 (low) to 1 (high)',
    TUNINGS.every((t) => t.strings[0].position === 6 && t.strings[5].position === 1));
  check('every tuning has six strings, ascending', TUNINGS.every((t) =>
    t.strings.length === 6 && t.strings.every((s, i) => i === 0 || s.midi > t.strings[i - 1].midi)));
}

console.log('\n6. Cost');
{
  const sr = 44100;
  const sig = pluck(midiToHz(40), sr, 10);
  const det = new PitchDetector(sr);
  const t0 = process.hrtime.bigint();
  let analyses = 0;
  for (let i = 0; i + FRAME <= sig.length; i += FRAME) if (det.push(sig.subarray(i, i + FRAME))) analyses++;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perAnalysis = ms / analyses;
  console.log(`        ${analyses} analyses over 10s of audio, ${ms.toFixed(1)}ms total, ${perAnalysis.toFixed(2)}ms each`);
  check('under 2% of a core', ms / 10000 < 0.02, `${((ms / 10000) * 100).toFixed(2)}% duty`);
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
