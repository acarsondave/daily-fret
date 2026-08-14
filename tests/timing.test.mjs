// Strum timing, measured rather than asserted.
//
// This drill makes a claim no other drill in the app makes: that it can say how
// many milliseconds early or late a strum was. The claim rests on being able to
// tell a strum from the metronome click that is playing out of the same speakers
// the microphone is listening to, and on the analysis being accurate enough that
// the number means something. Neither is something to take on trust, so this
// suite synthesises takes with known answers and checks the recovered numbers
// against them.
//
// Every take is the real click (renderClick, from the shipping metronome) mixed
// with real synthesised guitar (renderStrum, the same generator the chord drills
// are tested with) at exactly known times, and run through the real analyser.
//
// What it establishes, and the numbers it was written from:
//
//   Click bleed. With a one millisecond attack ramp on the click and the guitar
//   band closing at 800 Hz, the loudest click voice (the downbeat bell) leaves
//   0.0066 in the guitar's band against a detection bar of 0.027, and the
//   quietest leaves 0.0005. Guitar-only takes therefore never fire the click
//   detector and click-only takes never fire the strum detector.
//
//   Accuracy. A chord whose six strings are struck at exactly the same instant
//   is reported 0.4 ms late with a spread of 0.2 ms, so the analysis itself adds
//   essentially nothing. A real downstroke reads later, by about 9 ms when the
//   sweep is brisk and 18 ms when it is ordinary, because that is when its sound
//   actually arrives. That is documented, not corrected: see the note in
//   src/audio/timing.ts.
//
//   Honesty on headphones. With no click in the room at all there is no beat
//   grid, and the drill reports that rather than measuring the guitar against
//   itself.

import { TimingAnalyser, TIMING_FRAME_SIZE } from '../src/audio/timing.ts';
import { renderClick, VOICES, accentFor } from '../src/audio/metronome.ts';
import {
  fitBeatGrid,
  summariseTiming,
  offsetAt,
  IN_TIME_MS,
} from '../src/lib/strumTiming.ts';
import { renderStrum, addRoom, VOICINGS } from './browser/tone.mjs';

const RATE = 44100;

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/**
 * One take. `offsetsMs(beat)` is how far off the beat that strum is played, so
 * the truth is known exactly and the recovered offsets can be subtracted from it.
 *
 * `spreadMs` is milliseconds between one string and the next: 6 is an ordinary
 * downstroke sweeping the strings in about thirty milliseconds, 2 is a brisk
 * one, 14 is a deliberate slow one.
 */
function take({
  bpm = 80,
  beats = 40,
  offsetsMs = () => 0,
  clickGain = 1,
  chord = 'A',
  amp = 0.5,
  ring = 0.9,
  spreadMs = 6,
  skip = () => false,
} = {}) {
  const period = 60 / bpm;
  const lead = 0.6;
  const total = Math.ceil((lead + beats * period + 1.5) * RATE);
  const audio = new Float32Array(total);
  let seed = 4242;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const clicks = [];
  const truth = [];
  for (let k = 0; k < beats; k += 1) {
    const beatAt = lead + k * period;
    clicks.push(beatAt);
    if (clickGain > 0) {
      const samples = renderClick(VOICES[accentFor(k, 4)], RATE, random);
      const start = Math.round(beatAt * RATE);
      for (let i = 0; i < samples.length && start + i < total; i += 1) {
        audio[start + i] += samples[i] * clickGain;
      }
    }
    if (skip(k)) continue;
    truth.push({ beat: k, offsetMs: offsetsMs(k) });
    renderStrum(audio, Math.round((beatAt + offsetsMs(k) / 1000) * RATE), VOICINGS[chord], {
      amp,
      dampAt: period * ring,
      spreadMs,
      seed: 7 + k,
    });
  }
  addRoom(audio, 0.0015, 11);
  return { audio, clicks, truth, period };
}

function analyse(audio) {
  const strums = [];
  const clicks = [];
  const analyser = new TimingAnalyser({
    sampleRate: RATE,
    onStrum: (onset) => strums.push(onset.at),
    onClick: (onset) => clicks.push(onset.at),
  });
  for (let at = 0; at + TIMING_FRAME_SIZE <= audio.length; at += TIMING_FRAME_SIZE) {
    analyser.processFrame(audio.slice(at, at + TIMING_FRAME_SIZE));
  }
  return { strums, clicks };
}

/** Per-beat error of the recovered offsets against the offsets that were played. */
function errorsAgainstTruth(summary, truth) {
  const byBeat = new Map(summary.offsets.map((o) => [o.beat, o.offsetMs]));
  // The grid numbers its own beats from its own origin; align on the first one
  // that was actually played.
  const shift = summary.offsets[0].beat - truth[0].beat;
  const errors = [];
  let unmatched = 0;
  for (const played of truth) {
    const got = byBeat.get(played.beat + shift);
    if (got === undefined) {
      unmatched += 1;
      continue;
    }
    errors.push(got - played.offsetMs);
  }
  return { errors, unmatched };
}

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const sd = (values) => {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};
const ms = (v) => `${v.toFixed(1)} ms`;

// ---------------------------------------------------------------------------

console.log('\nThe click, in the microphone\n');
{
  // Nothing but clicks. If the strum detector fires here it is hearing the
  // click, which is the failure this whole design exists to prevent.
  const t = take({ beats: 24, skip: () => true });
  const { strums, clicks } = analyse(t.audio);
  check('every click is heard', clicks.length === t.clicks.length, `${clicks.length} of ${t.clicks.length}`);
  check('and no click is mistaken for a strum', strums.length === 0, `${strums.length} phantom strums`);

  const errors = clicks.map((at, i) => (at - t.clicks[i]) * 1000);
  check(`clicks land where they were scheduled (${ms(mean(errors))}, spread ${ms(sd(errors))})`,
    Math.abs(mean(errors)) < 2 && sd(errors) < 2);
}

{
  // The loud case the brief asks for, and the quiet one either side of it. The
  // click's level at the microphone is whatever the player's speakers are doing,
  // so neither detector may depend on it.
  for (const [label, clickGain] of [['half volume', 0.5], ['double volume', 2]]) {
    const t = take({ beats: 24, clickGain, offsetsMs: (k) => [-30, 16, -8, 38][k % 4] });
    const { strums, clicks } = analyse(t.audio);
    check(`at ${label}, every click is still heard`,
      clicks.length >= t.clicks.length - 1, `${clicks.length} of ${t.clicks.length}`);
    check(`at ${label}, every strum is still heard`,
      strums.length >= t.truth.length, `${strums.length} of ${t.truth.length}`);
  }
}

{
  // Nothing but guitar. A strum does put energy above 2 kHz, and if that fires
  // the click detector the drill would build a beat grid out of the player's own
  // strums and report perfect time back to them.
  const t = take({ beats: 24, clickGain: 0 });
  const { clicks } = analyse(t.audio);
  check('a guitar with no click never fires the click detector', clicks.length === 0,
    `${clicks.length} phantom clicks`);
  check('so there is no beat grid to measure against', fitBeatGrid(clicks, t.period) === null);
}

console.log('\nHow accurately a strum is placed\n');
{
  // Six strings struck at the same instant. Not playable, and that is the point:
  // it isolates the analyser from the strum, and says what the analysis costs.
  const t = take({ beats: 24, spreadMs: 0 });
  const { strums, clicks } = analyse(t.audio);
  const grid = fitBeatGrid(clicks, t.period);
  check('the grid is found', grid !== null);
  const summary = summariseTiming(strums, grid);
  const { errors } = errorsAgainstTruth(summary, t.truth);
  check(`an instantaneous chord is placed to within a millisecond (${ms(mean(errors))}, spread ${ms(sd(errors))})`,
    Math.abs(mean(errors)) < 1.5 && sd(errors) < 1.5);
}

{
  // What the residual lag actually is, as a function of how fast the strum is
  // swept. It rises with the sweep because the sound genuinely arrives later,
  // which is why it is documented rather than subtracted.
  const lags = [];
  for (const spreadMs of [2, 6, 14]) {
    const t = take({ beats: 24, spreadMs });
    const { strums, clicks } = analyse(t.audio);
    const summary = summariseTiming(strums, fitBeatGrid(clicks, t.period));
    const { errors } = errorsAgainstTruth(summary, t.truth);
    lags.push({ spreadMs, lag: mean(errors), spread: sd(errors) });
  }
  check('a brisk downstroke reads under 15 ms late', lags[0].lag > 0 && lags[0].lag < 15, ms(lags[0].lag));
  check('an ordinary one reads under 25 ms late', lags[1].lag < 25, ms(lags[1].lag));
  check('and a slow sweep reads later still, as its sound does',
    lags[2].lag > lags[1].lag && lags[1].lag > lags[0].lag,
    lags.map((l) => `${l.spreadMs}ms/string: ${ms(l.lag)}`).join(', '));
  check('the run-to-run spread stays inside 10 ms throughout',
    lags.every((l) => l.spread < 10), lags.map((l) => ms(l.spread)).join(', '));
}

console.log('\nA played take, against what was played\n');
{
  const played = (k) => [-32, 18, -6, 41, -21, 9, 27, -14][k % 8];
  const CASES = [
    ['80 BPM, human jitter', { offsetsMs: played }],
    ['80 BPM, click at double volume', { offsetsMs: played, clickGain: 2 }],
    ['80 BPM, quiet playing', { offsetsMs: played, amp: 0.15 }],
    ['120 BPM', { bpm: 120, offsetsMs: played }],
    ['60 BPM', { bpm: 60, offsetsMs: played }],
    ['110 BPM, never damped', { bpm: 110, offsetsMs: played, ring: 3 }],
    ['80 BPM, an E chord', { offsetsMs: played, chord: 'E' }],
    ['80 BPM, five beats missed', { offsetsMs: played, skip: (k) => k % 8 === 3 }],
  ];

  for (const [label, config] of CASES) {
    const t = take(config);
    const { strums, clicks } = analyse(t.audio);
    const grid = fitBeatGrid(clicks, t.period);
    if (!grid) {
      check(`${label}: a beat grid is found`, false, `only ${clicks.length} clicks heard`);
      continue;
    }
    check(`${label}: the fitted tempo is the metronome's`,
      Math.abs(grid.period - t.period) * 1000 < 1,
      `${ms((grid.period - t.period) * 1000)} out`);

    const summary = summariseTiming(strums, grid);
    check(`${label}: every strum played is counted`,
      summary.beatsPlayed >= t.truth.length - 1,
      `${summary.beatsPlayed} of ${t.truth.length}`);
    check(`${label}: and none are invented`, summary.extras === 0, `${summary.extras} extras`);

    const { errors, unmatched } = errorsAgainstTruth(summary, t.truth);
    // The lag is a property of the strum, so it is removed before the spread is
    // judged: what is under test here is whether one strum's offset can be told
    // from another's, which is the whole basis of the consistency statistic.
    const jitter = sd(errors);
    check(`${label}: offsets are recovered to within 12 ms of each other (spread ${ms(jitter)})`,
      jitter < 12, `${unmatched} unmatched`);
  }
}

console.log('\nWhat the summary says about a run\n');
{
  const grid = { origin: 0, period: 0.75, clicks: 40 };
  const at = (beat, offsetMs) => beat * 0.75 + offsetMs / 1000;

  {
    // A run with three gross mistimings in it. This is the case the median
    // absolute deviation exists for: a standard deviation over the same numbers
    // is nearly twice as large and describes the disasters rather than the
    // playing.
    const tidy = [8, -6, 4, -9, 7, -5, 6, -8, 5, -7, 9, -4];
    const strums = [...tidy, 180, -170, 200].map((offset, i) => at(i, offset));
    const summary = summariseTiming(strums, grid);
    check('a handful of disasters cannot move the spread', summary.spreadMs < 14,
      `${ms(summary.spreadMs)}`);
    check('while a standard deviation over the same run would be swamped',
      sd(summary.offsets.map((o) => o.offsetMs)) > summary.spreadMs * 2,
      `${ms(sd(summary.offsets.map((o) => o.offsetMs)))} against ${ms(summary.spreadMs)}`);
  }

  {
    // A double strum on one beat is one beat played, not two, and the beat keeps
    // the closer of the two.
    const strums = [at(0, -10), at(1, 5), at(1, 90), at(2, -3), ...Array.from({ length: 8 }, (_, i) => at(3 + i, 6))];
    const summary = summariseTiming(strums, grid);
    check('a double strum is one beat and one extra',
      summary.beatsPlayed === 11 && summary.extras === 1,
      `${summary.beatsPlayed} beats, ${summary.extras} extras`);
    check('and the beat keeps the strum that was closer to it',
      Math.abs(summary.offsets.find((o) => o.beat === 1).offsetMs - 5) < 0.001);
  }

  {
    // Beats nobody played are counted against the run, because keeping time
    // includes not stopping. Beats before the first strum and after the last are
    // not: they are not a thing the player got wrong.
    const wobble = [4, -9, 11, -6, 8, -12, 5, -7, 10, -5];
    const strums = [0, 1, 2, 3, 5, 6, 7, 9, 10, 11].map((beat, i) => at(beat, wobble[i]));
    const summary = summariseTiming(strums, grid);
    check('the span runs from the first strum to the last',
      summary.expectedBeats === 12 && summary.beatsPlayed === 10,
      `${summary.beatsPlayed} of ${summary.expectedBeats}`);
    check('and the score is the beats struck in time, over the beats there were',
      summary.score === Math.round((100 * 10) / 12), `${summary.score}`);
  }

  {
    const short = summariseTiming([at(0, -8), at(1, 12), at(2, -4)], grid);
    check('three beats is not a measurement', !short.enough && short.score === 0);
  }

  {
    // Offsets no human produces. This is what measuring the guitar against its
    // own brightness would look like, and it must not be reported as a score.
    const strums = Array.from({ length: 16 }, (_, i) => at(i, 0.5));
    const summary = summariseTiming(strums, grid);
    check('a spread no person could play is refused rather than celebrated',
      summary.selfReferential && !summary.enough);
  }

  {
    const strums = Array.from({ length: 16 }, (_, i) => at(i, i % 2 ? IN_TIME_MS - 5 : -(IN_TIME_MS - 5)));
    const summary = summariseTiming(strums, grid);
    check(`strums inside ${IN_TIME_MS} ms all count as in time`, summary.score === 100);
    const outside = summariseTiming(
      Array.from({ length: 16 }, (_, i) => at(i, IN_TIME_MS + 5)),
      grid,
    );
    check('and strums outside it count as none of them', outside.score === 0);
  }
}

console.log('\nThe beat grid\n');
{
  const period = 0.6;
  const clicks = Array.from({ length: 20 }, (_, i) => 1.234 + i * period);

  {
    const grid = fitBeatGrid(clicks, period);
    check('a clean run of clicks is fitted exactly',
      Math.abs(grid.period - period) < 1e-9 && Math.abs(offsetAt(grid, clicks[7]).offsetMs) < 1e-6);
  }

  {
    // Clicks that were masked by a loud strum are simply missing, and the beats
    // they mark are still on the grid. This is why the grid is fitted at all
    // rather than each strum being matched to the nearest click it can find.
    const gappy = clicks.filter((_, i) => i % 3 !== 1);
    const grid = fitBeatGrid(gappy, period);
    check('a grid survives a third of its clicks going missing',
      Math.abs(grid.period - period) < 1e-6);
    check('and still names the beats that were never heard',
      Math.abs(offsetAt(grid, clicks[1]).offsetMs) < 1e-6);
  }

  {
    // One bright transient that leaked into the click band, landing nowhere near
    // the beat. It must not drag the grid.
    const grid = fitBeatGrid([...clicks, clicks[4] + period * 0.4], period);
    check('a stray onset is thrown out rather than fitted',
      Math.abs(grid.period - period) < 1e-6 && grid.clicks === clicks.length);
  }

  {
    // A clock that is not quite this metronome's, which is what drift over a
    // long run would look like. Small drift is absorbed; a wrong tempo is not.
    const drifted = clicks.map((t, i) => t + i * period * 0.0002);
    const grid = fitBeatGrid(drifted, period);
    check('a slow drift is measured rather than ignored',
      grid !== null && grid.period > period && Math.abs(grid.period - period * 1.0002) < 1e-6);
    check('but a tempo that is not this one is refused',
      fitBeatGrid(clicks.map((_, i) => 1.234 + i * period * 1.5), period) === null);
  }

  {
    check('three clicks are not a grid', fitBeatGrid(clicks.slice(0, 3), period) === null);
    check('and neither is nothing at all', fitBeatGrid([], period) === null);
  }
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
