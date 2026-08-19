// The pattern matcher, checked against takes whose answers are known.
//
// Two levels, because they fail differently. The first half drives the pure
// functions with onsets placed by hand, so a scoring mistake has nowhere to
// hide. The second half plays real synthesised guitar through the real
// TimingAnalyser, so a matcher that only works on ideal input is caught.
//
// The bug this suite exists to prevent is specific and has already shipped once
// in the drill this replaces: scoring a pattern against every quarter-note beat,
// which counts a slot the pattern deliberately leaves empty as a miss. A
// perfectly played "D-DU-UD-" scored 75 out of 100 that way. The first
// assertion below is that it now scores 100.

import {
  parsePattern,
  matchPattern,
  summarisePattern,
  patternStanding,
  dealNext,
  soundedSlots,
  SLOTS_PER_BAR,
  DOWN_DETECTION_LAG_MS,
  UP_DETECTION_LAG_MS,
  MIN_PATTERN_BARS,
} from '../src/lib/strumPattern.ts';
import { TimingAnalyser, TIMING_FRAME_SIZE } from '../src/audio/timing.ts';
import { renderClick, VOICES, accentFor } from '../src/audio/metronome.ts';
import { fitBeatGrid } from '../src/lib/strumTiming.ts';
import { renderStrum, addRoom, VOICINGS } from './browser/tone.mjs';

const RATE = 44100;
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};

// --- reading a pattern -----------------------------------------------------
console.log('\nReading a pattern\n');
{
  const of = parsePattern('D-DU-UD-');
  check('eight characters are eight eighth-note slots', of?.slots.length === SLOTS_PER_BAR);
  check('Old Faithful sounds five of its eight slots', soundedSlots(of) === 5, String(soundedSlots(of)));
  check('the ghosts are read as ghosts', of?.slots[1] === null && of?.slots[4] === null);
  check('the ups are read as ups', of?.slots[3] === 'U' && of?.slots[5] === 'U');

  const quarters = parsePattern('DDDD');
  check('four characters expand to a whole bar', quarters?.slots.length === SLOTS_PER_BAR);
  check('and put the arm through every offbeat',
    quarters?.slots.join(',') === 'D,,D,,D,,D,'.replaceAll(',,', ',null,').replaceAll(/(^|,)$/g, '')
    || quarters?.slots.every((s, i) => (i % 2 === 0 ? s === 'D' : s === null)));

  check('six characters are refused, not padded', parsePattern('D-DUD-') === null);
  check('an up on a quarter is refused', parsePattern('DUDU') === null);
  check('rubbish is refused', parsePattern('DXDU-UD-') === null);
  check('the source string is carried through unchanged', parsePattern('D-DU-UD-')?.source === 'D-DU-UD-');
}

// --- scoring, with the answers known ---------------------------------------
console.log('\nScoring a take whose answer is known\n');

const GRID = { origin: 1, period: 60 / 80, clicks: 40 };

/** Onsets for a run, with a per-slot decision about what the player did. */
function play(pattern, bars, { offsetMs = () => 0, drop = () => false, add = () => false } = {}) {
  const onsets = [];
  const slotPeriod = (GRID.period * 4) / pattern.slots.length;
  for (let bar = 0; bar < bars; bar += 1) {
    for (let slot = 0; slot < pattern.slots.length; slot += 1) {
      const expected = pattern.slots[slot];
      const at = GRID.origin + (bar * 4 * GRID.period) + slot * slotPeriod;
      // The player strikes; the analyser hears it a little later, by an amount
      // that depends on which way the hand was going.
      const lag = (expected === 'U' ? UP_DETECTION_LAG_MS : DOWN_DETECTION_LAG_MS) / 1000;
      if (expected && !drop(bar, slot)) onsets.push(at + lag + offsetMs(bar, slot) / 1000);
      if (!expected && add(bar, slot)) onsets.push(at + DOWN_DETECTION_LAG_MS / 1000);
    }
  }
  return onsets;
}

const run = (pattern, onsets, bars) =>
  summarisePattern(matchPattern({ onsets, grid: GRID, pattern, originBeat: 0, bars }), pattern);

{
  const oldFaithful = parsePattern('D-DU-UD-');
  const perfect = run(oldFaithful, play(oldFaithful, 8), 8);
  check('a perfect Old Faithful scores 100', perfect.score === 100, String(perfect.score));
  check('the empty slots are not counted against it', perfect.expected === 5 * 8, String(perfect.expected));
  check('nothing is reported as added', perfect.added === 0, String(perfect.added));
  check('it settles on the first bar', perfect.settledBar === 0, String(perfect.settledBar));

  const downs = parsePattern('DDDD');
  const allDowns = run(downs, play(downs, 8), 8);
  check('and all downs still scores 100', allDowns.score === 100, String(allDowns.score));
  check('so the pattern is not punished for being a pattern',
    perfect.score === allDowns.score, `${perfect.score} vs ${allDowns.score}`);
}

{
  // The classic beginner failure: the arm stops before the bar line, so the last
  // up strum never happens. A single percentage cannot say this; the slots can.
  //
  // Slot 5, not slot 7. In "D-DU-UD-" the eighth slot is a ghost, and dropping a
  // ghost is not a mistake a player can make. The first draft of this test
  // dropped slot 7, changed nothing, and passed three assertions that were
  // measuring an empty edit.
  const p = parsePattern('D-DU-UD-');
  const LAST_UP = 5;
  check('the slot under test really is the last up strum', p.slots[LAST_UP] === 'U');
  const summary = run(p, play(p, 8, { drop: (_bar, slot) => slot === LAST_UP }), 8);
  check('dropping the last up costs exactly its share', summary.score === 80, String(summary.score));
  check('and the slot itself reports never being struck',
    summary.slots[LAST_UP].struck === 0, String(summary.slots[LAST_UP].struck));
  const others = summary.slots.filter((s) => s.expected && s.slot !== LAST_UP);
  check('while every other sounded slot is clean', others.every((s) => s.inTime === 8));
  check('it never settles', summary.settledBar === null, String(summary.settledBar));
}

{
  // Two bars of fumbling, then it locks in. This is the difference between a
  // pattern you are working out and one you have.
  const p = parsePattern('D-DU-UD-');
  const onsets = play(p, 8, { offsetMs: (bar) => (bar < 2 ? 90 : 5) });
  const summary = run(p, onsets, 8);
  check('a run that settles late says which bar it settled on', summary.settledBar === 2, String(summary.settledBar));
  check('and does not score as if it were clean throughout', summary.score < 100, String(summary.score));
}

{
  // "You can add in extra strums and leave others out." An added strum is a
  // variation, and must not cost anything.
  const p = parsePattern('D-DU-UD-');
  const summary = run(p, play(p, 8, { add: (_bar, slot) => slot === 4 }), 8);
  check('an added strum is counted', summary.added === 8, String(summary.added));
  check('and does not reduce the score', summary.score === 100, String(summary.score));
}

{
  const p = parsePattern('D-DU-UD-');
  const short = run(p, play(p, 2), 2);
  check(`under ${MIN_PATTERN_BARS} bars nothing is claimed`, short.enough === false);
  check('and the score is not reported', short.score === 0, String(short.score));
}

{
  // The lag compensation is the point of this one. A player dead on the beat
  // produces onsets that are late by different amounts depending on direction;
  // both must read as zero.
  const p = parsePattern('D-DU-UD-');
  const summary = run(p, play(p, 8), 8);
  const downs = summary.slots.filter((s) => s.expected === 'D');
  const ups = summary.slots.filter((s) => s.expected === 'U');
  check('a dead-on down reads as dead on', downs.every((s) => Math.abs(s.medianMs) < 1),
    downs.map((s) => s.medianMs.toFixed(1)).join(', '));
  check('and so does a dead-on up', ups.every((s) => Math.abs(s.medianMs) < 1),
    ups.map((s) => s.medianMs.toFixed(1)).join(', '));

  // Without compensation the up strums would read early by the difference.
  const raw = summarisePattern(
    matchPattern({
      onsets: play(p, 8).map((t, i) => t - (i % 2 ? 0 : 0)),
      grid: GRID,
      pattern: { ...p, slots: p.slots.map((s) => (s === 'U' ? 'D' : s)) },
      originBeat: 0,
      bars: 8,
    }),
    p,
  );
  const wouldBe = raw.slots.filter((s, i) => p.slots[i] === 'U').map((s) => s.medianMs);
  check('and treating an up as a down would put it ~20ms early',
    wouldBe.every((v) => v < -15), wouldBe.map((v) => v.toFixed(1)).join(', '));
}

// --- the deck --------------------------------------------------------------
console.log('\nThe deck\n');
{
  check('nothing played is new', patternStanding([]) === 'new');
  check('one clean run is not automatic',
    patternStanding([{ date: '2026-08-16', score: 100, settledBar: 0 }]) === 'learning');
  const three = [0, 1, 2].map((i) => ({ date: `2026-08-1${i + 4}`, score: 95, settledBar: 0 }));
  check('three clean runs are', patternStanding(three) === 'automatic');
  check('a high score that took three bars to settle is not',
    patternStanding(three.map((r) => ({ ...r, settledBar: 3 }))) === 'learning');
  check('and one dip drops it back',
    patternStanding([...three.slice(0, 2), { date: '2026-08-17', score: 61, settledBar: 0 }]) === 'learning');

  const deck = [
    { pattern: 'DDDD', standing: 'automatic' },
    { pattern: 'D-DU-UD-', standing: 'learning' },
    { pattern: 'D-DUDUD-', standing: 'new' },
  ];
  check('the same pattern is never dealt twice running',
    [0, 0.2, 0.5, 0.9].every((r) => dealNext(deck, 'D-DU-UD-', r) !== 'D-DU-UD-'));
  const rolls = Array.from({ length: 200 }, (_, i) => i / 200);
  const dealt = rolls.map((r) => dealNext(deck, null, r));
  const share = (p) => dealt.filter((d) => d === p).length / dealt.length;
  check('the new one comes up most often', share('D-DUDUD-') > share('D-DU-UD-'),
    `${share('D-DUDUD-').toFixed(2)} vs ${share('D-DU-UD-').toFixed(2)}`);
  check('but the automatic one still comes up, because the switch is the exercise',
    share('DDDD') > 0, share('DDDD').toFixed(2));
  check('a one-pattern deck deals it rather than nothing',
    dealNext([{ pattern: 'DDDD', standing: 'new' }], 'DDDD', 0.5) === 'DDDD');
  check('an empty deck deals nothing', dealNext([], null, 0.5) === null);
}

// --- through the real analyser ---------------------------------------------
console.log('\nThrough the real analyser, on synthesised guitar\n');

const OPEN_ONLY = (frets, keep) => frets.map((f, i) => (keep.includes(i) ? f : -1));

// A down sweeps low to high across the sounding strings; an up sweeps high to
// low and, for most players, only catches the top three.
function strike(audio, atSec, chord, { up, amp, period, seed }) {
  const frets = VOICINGS[chord];
  const order = up ? [5, 4, 3] : [0, 1, 2, 3, 4, 5];
  order.forEach((string, i) => {
    if (frets[string] < 0) return;
    renderStrum(audio, Math.round((atSec + (i * 7) / 1000) * RATE), OPEN_ONLY(frets, [string]), {
      amp, dampAt: period * 0.9, spreadMs: 0, seed: seed + string,
    });
  });
}

function takeOf(patternText, { bpm = 80, bars = 8, upAmp = 0.36, drop = () => false } = {}) {
  const pattern = parsePattern(patternText);
  const beat = 60 / bpm;
  const eighth = beat / 2;
  const lead = 0.6;
  const total = Math.ceil((lead + bars * 4 * beat + 1.5) * RATE);
  const audio = new Float32Array(total);
  let seed = 4242;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let b = 0; b < bars * 4; b += 1) {
    const s = renderClick(VOICES[accentFor(b, 4)], RATE, random);
    const start = Math.round((lead + b * beat) * RATE);
    for (let i = 0; i < s.length && start + i < total; i += 1) audio[start + i] += s[i];
  }
  for (let bar = 0; bar < bars; bar += 1) {
    for (let slot = 0; slot < SLOTS_PER_BAR; slot += 1) {
      const expected = pattern.slots[slot];
      if (!expected || drop(bar, slot)) continue;
      strike(audio, lead + bar * 4 * beat + slot * eighth, 'Am', {
        up: expected === 'U', amp: expected === 'U' ? upAmp : 0.5, period: beat, seed: 7 + bar * 8 + slot,
      });
    }
  }
  addRoom(audio, 0.0015, 11);
  return { audio, pattern, lead, beat, bars };
}

function analyse(audio) {
  const strums = [];
  const clicks = [];
  const a = new TimingAnalyser({ sampleRate: RATE, onStrum: (o) => strums.push(o.at), onClick: (o) => clicks.push(o.at) });
  for (let at = 0; at + TIMING_FRAME_SIZE <= audio.length; at += TIMING_FRAME_SIZE) {
    a.processFrame(audio.slice(at, at + TIMING_FRAME_SIZE));
  }
  return { strums, clicks };
}

function measure(patternText, opts = {}) {
  const t = takeOf(patternText, opts);
  const { strums, clicks } = analyse(t.audio);
  const grid = fitBeatGrid(clicks, t.beat);
  if (!grid) return { grid: null };
  // Bar zero starts on the first beat the run actually used.
  const originBeat = Math.round((t.lead - grid.origin) / grid.period);
  const outcomes = matchPattern({ onsets: strums, grid, pattern: t.pattern, originBeat, bars: t.bars });
  return { grid, summary: summarisePattern(outcomes, t.pattern), strums: strums.length };
}

{
  const of = measure('D-DU-UD-');
  check('the click is still found under a pattern', of.grid !== null);
  check('a well played Old Faithful scores at least 90', of.summary.score >= 90, String(of.summary.score));
  check('every sounded slot is found in most bars',
    of.summary.slots.filter((s) => s.expected).every((s) => s.struck >= s.bars - 1),
    of.summary.slots.filter((s) => s.expected).map((s) => `${s.slot}:${s.struck}/${s.bars}`).join(' '));
  check('and nothing is invented in the ghost slots', of.summary.added === 0, String(of.summary.added));

  const busy = measure('D-DUDUD-');
  check('a busier pattern also scores at least 90', busy.summary.score >= 90, String(busy.summary.score));

  // The one that matters most: the drill must notice a dropped final up strum
  // on real audio, not just on hand-placed onsets.
  const stopped = measure('D-DU-UD-', { drop: (_b, slot) => slot === 5 });
  check('a hand that stops before the bar line is caught', stopped.summary.slots[5].struck === 0,
    String(stopped.summary.slots[5].struck));
  check('and it shows up as the one bad slot, not a bad run',
    stopped.summary.slots.filter((s) => s.expected && s.struck === 0).length === 1);

  // Up strums below the detection floor. The honest answer is that they are not
  // heard, and the drill must be able to tell that from a player who skipped them.
  const faint = measure('D-DU-UD-', { upAmp: 0.16 });
  const upSlots = faint.summary.slots.filter((s) => s.expected === 'U');
  check('up strums played far too softly go missing', upSlots.some((s) => s.struck < s.bars),
    upSlots.map((s) => `${s.slot}:${s.struck}/${s.bars}`).join(' '));
  check('while the downs around them stay clean',
    faint.summary.slots.filter((s) => s.expected === 'D').every((s) => s.struck >= s.bars - 1));
}

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
