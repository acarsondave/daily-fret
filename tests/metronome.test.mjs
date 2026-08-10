// The click, as arithmetic and as a waveform.
//
// Two failures this covers, both of which sound like a broken metronome rather
// than a broken program, so nothing else here would have caught them:
//
//  1. Drift. The grid must stay exact over a long session. Adding one beat
//     period repeatedly is the obvious implementation and is the one that
//     accumulates; the scheduler steps from the origin instead, and this pins
//     that down over ten thousand beats.
//  2. The burst. When a tab is backgrounded its timers are clamped to a second
//     or more, so the scheduler wakes to find the grid well behind the audio
//     clock. Queuing those beats anyway starts every one of them immediately,
//     which is a machine-gun stutter the moment you switch back. They have to be
//     skipped, and the bar has to survive the skip.

import {
  planBeats,
  accentFor,
  renderClick,
  VOICES,
  MIN_BPM,
  MAX_BPM,
} from '../src/audio/metronome.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' - '+d:''}`); };

const BPM = 96;
const SPB = 60 / BPM;

console.log('\nThe grid\n');
{
  // A whole session, driven the way the scheduler drives it: wake, fill the
  // window, carry the returned state into the next wake.
  const wake = 0.025;
  const ahead = 0.12;
  let now = 0;
  let next = 0.08;
  let position = 0;
  const times = [];
  const origin = next;
  while (now < 600) {
    const plan = planBeats(next, now, ahead, SPB, position);
    for (const b of plan.beats) times.push(b.time);
    next = plan.nextTime;
    position = plan.nextPosition;
    now += wake;
  }
  check('ten minutes of beats, all of them', times.length > 950, `${times.length}`);
  const worst = times.reduce((m, t, i) => Math.max(m, Math.abs(t - (origin + i * SPB))), 0);
  check('and none more than a microsecond off the grid', worst < 1e-6, `${(worst * 1e6).toFixed(3)} us`);

  const intervals = times.slice(1).map((t, i) => t - times[i]);
  const spread = Math.max(...intervals) - Math.min(...intervals);
  check('every interval identical', spread < 1e-9, `${(spread * 1e9).toFixed(3)} ns`);
}

console.log('\nA throttled tab\n');
{
  // The clock has run on 1.5 seconds while the scheduler slept, which is what a
  // backgrounded Chromium does to a 25 ms interval.
  const now = 10.0;
  const next = 8.5; // 1.5 s, or 2.4 beats, in the past
  // ...and the window has widened to match the wake it just measured.
  const plan = planBeats(next, now, 2.5, SPB, 4);
  check('it recovers with beats to spare', plan.beats.length >= 3, `${plan.beats.length}`);
  check('nothing is scheduled in the past', plan.beats.every((b) => b.time >= now),
    JSON.stringify(plan.beats.map((b) => +(b.time - now).toFixed(4))));
  check('the beats it could not place are reported', plan.skipped === 3, `${plan.skipped}`);
  check('and the count carries the skip, so beat one still lands where it would have',
    plan.beats[0].position === 7, `${plan.beats[0]?.position}`);
  const phase = ((plan.beats[0].time - 8.5) / SPB) % 1;
  check('the resumed beat is still on the original grid', Math.abs(phase) < 1e-9, `${phase}`);
}

{
  // A wide window is what keeps the click alive across a throttled wake at all:
  // 25 ms of lookahead cannot survive a 1.5 s gap between wakes.
  const narrow = planBeats(10.08, 10.0, 0.12, SPB, 0);
  const wide = planBeats(10.08, 10.0, 2.5, SPB, 0);
  check('a normal window queues about a beat', narrow.beats.length === 1, `${narrow.beats.length}`);
  check('a throttled window queues enough to outlast the next stall',
    wide.beats.length >= 3, `${wide.beats.length}`);
  check('and both agree on where those beats go',
    wide.beats[0].time === narrow.beats[0].time);
}

{
  const slow = planBeats(0, 0, 0.12, 60 / MIN_BPM, 0);
  const fast = planBeats(0, 0, 0.12, 60 / MAX_BPM, 0);
  check('the slowest tempo still queues a beat', slow.beats.length === 1, `${slow.beats.length}`);
  check('the fastest tempo does not run away', fast.beats.length <= 2, `${fast.beats.length}`);
}

console.log('\nWhere the accents fall\n');
{
  check('four beats: one accent, on the change', accentFor(0, 4) === 'downbeat' &&
    [1, 2, 3].every((i) => accentFor(i, 4) === 'beat'));
  // The tempo model hands the click an eight-beat change cycle for slower
  // players. Eight identical clicks is not a bar you can sit a pattern inside.
  check('eight beats: a halfway mark, so it reads as two bars',
    accentFor(0, 8) === 'downbeat' && accentFor(4, 8) === 'midbar' &&
    [1, 2, 3, 5, 6, 7].every((i) => accentFor(i, 8) === 'beat'));
  check('two beats: nothing to divide, so no halfway mark',
    accentFor(0, 2) === 'downbeat' && accentFor(1, 2) === 'beat');
  check('the count-in is its own voice, whatever the cycle',
    [-4, -3, -2, -1].every((i) => accentFor(i, 8) === 'countin'));
  check('the cycle repeats', accentFor(8, 8) === 'downbeat' && accentFor(12, 8) === 'midbar');
}

console.log('\nThe click itself\n');
{
  const rate = 48000;
  // Deterministic noise, so a shipped click is the same click every run.
  let seed = 12345;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

  for (const [name, voice] of Object.entries(VOICES)) {
    seed = 12345;
    const samples = renderClick(voice, rate, rng);
    const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    check(`${name}: peaks exactly where it was asked to`,
      Math.abs(peak - voice.peak) < 1e-6, `${peak.toFixed(4)} vs ${voice.peak}`);
    // A click is an attack. If the loudest sample is not in the first couple of
    // milliseconds it is a swell, and a swell has no edge to play against.
    let peakAt = 0;
    for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) === peak) { peakAt = i; break; }
    check(`${name}: attacks inside two milliseconds`, peakAt / rate < 0.002,
      `${((peakAt / rate) * 1000).toFixed(2)} ms`);
    check(`${name}: decays away rather than stopping dead`,
      samples[samples.length - 1] === 0, `${samples[samples.length - 1]}`);
    const tail = samples.slice(samples.length - Math.round(0.001 * rate));
    check(`${name}: and is already quiet before the taper takes it`,
      tail.every((v) => Math.abs(v) < peak * 0.02),
      `${(Math.max(...tail.map(Math.abs)) / peak * 100).toFixed(1)}% of peak`);
    // Long enough to have a body, short enough that consecutive clicks at the
    // top of the useful band do not overlap into a buzz.
    const seconds = samples.length / rate;
    check(`${name}: ${(seconds * 1000).toFixed(0)} ms, well inside a beat at 240 BPM`,
      seconds > 0.015 && seconds < 60 / MAX_BPM / 2, `${(seconds * 1000).toFixed(1)} ms`);
  }

  // The three drill voices have to be told apart while a guitar is being
  // strummed over them, so they differ in where their energy sits, not only in
  // how loud they are.
  const centroid = (voice) => {
    const total = voice.partials.reduce((s, p) => s + p.amp, 0);
    return voice.partials.reduce((s, p) => s + p.freq * p.amp, 0) / total;
  };
  const down = centroid(VOICES.downbeat);
  const mid = centroid(VOICES.midbar);
  const beat = centroid(VOICES.beat);
  check('the downbeat is a different sound, not a louder one',
    Math.abs(down - beat) > 300, `${down.toFixed(0)} vs ${beat.toFixed(0)} Hz`);
  check('and the halfway mark is a third one', Math.abs(mid - beat) > 300,
    `${mid.toFixed(0)} vs ${beat.toFixed(0)} Hz`);
  check('the downbeat rings longest, so it reads as the one',
    VOICES.downbeat.lengthS > VOICES.midbar.lengthS &&
    VOICES.midbar.lengthS > VOICES.beat.lengthS);
  check('the count-in is the quietest thing the click makes',
    Object.entries(VOICES).every(([n, v]) => n === 'countin' || v.peak > VOICES.countin.peak));
  // 2 to 4 kHz is where the ear is most sensitive and where a strummed acoustic
  // guitar is least dense. A click centred lower gets buried by the instrument.
  for (const [name, voice] of Object.entries(VOICES)) {
    const c = centroid(voice);
    check(`${name}: sits above the guitar, at ${c.toFixed(0)} Hz`, c > 1900 && c < 5000);
  }
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
