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

// The failure the owner actually hit: not the estimator picking the wrong
// octave, but two strings an octave apart sounding at once. Their sum repeats at
// the lower string's period, so the estimate is right about the period and the
// tuner was wrong to read it as an identification. There is no correct single
// answer here; the only correct behaviour is to know that and say so.
console.log('\n4b. Two strings at once, which is what "playing fast" produces');
{
  const sr = 44100;

  const mix = (a, b, seconds, opts = {}) => {
    const { amps = [0.5, 0.5], weakA = false, offsetSec = 0.2 } = opts;
    const one = pluck(midiToHz(a), sr, seconds, { weakFundamental: weakA });
    const two = pluck(midiToHz(b), sr, seconds - offsetSec);
    const out = new Float32Array(one.length);
    const at = Math.floor(offsetSec * sr);
    for (let i = 0; i < one.length; i++) out[i] = one[i] * amps[0];
    for (let i = 0; i < two.length && at + i < out.length; i++) out[at + i] += two[i] * amps[1];
    return out;
  };

  const confident = (readings) => readings.filter((r) => r.hz !== null && r.clarity >= 0.75);

  // The bar the surface actually applies, transcribed from usePitchDetector:
  // three of the last five confident analyses. One analysis is not evidence, and
  // a quiet tail in a noisy room throws one every so often.
  const WINDOW = 5;
  const MIN = 3;
  const says = (readings) => {
    const live = confident(readings);
    for (let i = MIN - 1; i < live.length; i++) {
      const from = Math.max(0, i - WINDOW + 1);
      let flagged = 0;
      for (let k = from; k <= i; k++) if (live[k].secondNoteAt !== null) flagged++;
      if (flagged >= MIN) return true;
    }
    return false;
  };
  const share = (readings) => {
    const live = confident(readings);
    return live.length ? live.filter((r) => r.secondNoteAt !== null).length / live.length : 0;
  };

  // Nothing that is one string may ever be called two, in any tuning, with or
  // without the weak fundamental a wound string really has. A false alarm here
  // is a tuner that refuses to finish.
  let falseAlarms = 0;
  for (const tuning of TUNINGS) {
    for (const s of tuning.strings) {
      for (const weak of [false, true]) {
        const readings = run(pluck(midiToHz(s.midi), sr, 2, { weakFundamental: weak }), sr);
        if (says(readings)) {
          falseAlarms++;
          console.log(`        ${tuning.id} ${s.label} weak=${weak} -> ${(share(readings) * 100).toFixed(0)}% of analyses`);
        }
      }
    }
  }
  check('one string is never mistaken for two', falseAlarms === 0, `${falseAlarms} strings flagged`);

  // The reported case. The two E strings are exactly 4:1, so the pair repeats at
  // the low E's period and the estimator says low E at full confidence. It is
  // right about the period. Reading that as "the low E is in tune" is the bug.
  const twoOctaves = run(mix(40, 64, 2.5), sr);
  const heard = medianHz(twoOctaves);
  check('both E strings ringing still estimates as the low E',
    heard !== null && Math.abs(centsBetween(heard, midiToHz(40))) < 10,
    heard ? `${heard.toFixed(1)} Hz` : 'no reading');
  check('but the reading knows it is not one string', says(twoOctaves),
    `${(share(twoOctaves) * 100).toFixed(0)}% of analyses`);
  check('and knows it is the double octave',
    confident(twoOctaves).some((r) => r.secondNoteAt === 4));

  // The other ratios a six-string makes with itself: E2 against B3 is 3:1 to
  // within two cents, and drop D, open G and DADGAD all carry a 2:1 pair.
  check('a twelfth apart is caught', says(run(mix(40, 59, 2.5), sr)),
    `${(share(run(mix(40, 59, 2.5), sr)) * 100).toFixed(0)}%`);
  check('an octave apart is caught', says(run(mix(38, 50, 2.5), sr)),
    `${(share(run(mix(38, 50, 2.5), sr)) * 100).toFixed(0)}%`);

  // The limit, stated rather than hidden. When the upper string of an octave
  // pair is the one carrying the energy, the estimator reports that string, and
  // there is no second note above it to find. That is not a wrong answer: the
  // upper string is what is sounding, and it is the string the tuner names.
  const upperWins = run(mix(38, 50, 2.5, { weakA: true }), sr);
  const upper = medianHz(upperWins);
  check('when the upper string dominates, the upper string is what is read',
    upper !== null && Math.abs(centsBetween(upper, midiToHz(50))) < 15,
    upper ? `${upper.toFixed(1)} Hz` : 'no reading');

  // A string ringing quietly behind the one being tuned is the ordinary state of
  // a guitar and must not stop the tuner working. The estimator locks onto the
  // loud string; the quiet one does not sit on its partials.
  const sympathetic = run(mix(64, 40, 2.5, { amps: [0.85, 0.15], offsetSec: 0 }), sr);
  const dominant = medianHz(sympathetic);
  check('a quietly ringing neighbour does not stop the tuner',
    dominant !== null && Math.abs(centsBetween(dominant, midiToHz(64))) < 10 && !says(sympathetic),
    `${dominant ? dominant.toFixed(1) : 'none'} Hz, ${(share(sympathetic) * 100).toFixed(0)}% of analyses`);
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

  // String matching compares frequencies. Nothing anywhere folds a reading to a
  // pitch class, which would make every E the same E and is the shape of the bug
  // the owner reported. These are the readings that would pass a pitch-class
  // test and must not pass this one.
  const standard = getTuning('standard');
  check('the high E is never attributed to the low E string',
    nearestString(midiToHz(64), standard)?.string.position === 1);
  check('nor the low E to the high E string',
    nearestString(midiToHz(40), standard)?.string.position === 6);
  check('an A an octave above the A string is not the A string',
    nearestString(midiToHz(57), standard)?.string.position !== 5,
    `${nearestString(midiToHz(57), standard)?.string.label}`);
  check('no reading is ever matched to a string more than 250 cents away',
    Array.from({ length: 600 }, (_, i) => 60 + i)
      .map((hz) => nearestString(hz, standard))
      .every((m) => m === null || Math.abs(m.cents) <= 250));
  check('every string in every tuning matches itself and nothing else',
    TUNINGS.every((t) => t.strings.every((s) => {
      const m = nearestString(midiToHz(s.midi), t);
      return m !== null && m.string.position === s.position && Math.abs(m.cents) < 0.001;
    })));
}

console.log('\n7. What a person calls each string');
{
  const standard = getTuning('standard');
  const label = (position) => standard.strings.find((s) => s.position === position)?.label;
  // Two E strings, and "E is in tune" while the other E is the one being asked
  // for is the sentence that made the tuner feel broken.
  check('the 6th is the low E', label(6) === 'low E', label(6));
  check('the 1st is the high E', label(1) === 'high E', label(1));
  check('a letter that appears once is just the letter', label(5) === 'A' && label(4) === 'D',
    `${label(5)}, ${label(4)}`);
  check('drop D tells its two Ds apart',
    getTuning('drop-d').strings.find((s) => s.position === 6)?.label === 'low D');
  // Open G has three Ds, which "low" and "high" cannot separate, so those fall
  // back to the one label that stays unambiguous.
  check('three of a letter falls back to the string number',
    getTuning('open-g').strings.filter((s) => s.name === 'D').every((s) => /string, D$/.test(s.label)),
    getTuning('open-g').strings.filter((s) => s.name === 'D').map((s) => s.label).join(' / '));
  check('every string in every tuning has a distinct label',
    TUNINGS.every((t) => new Set(t.strings.map((s) => s.label)).size === 6));
  check('no label is empty', TUNINGS.every((t) => t.strings.every((s) => s.label.length > 0)));
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
