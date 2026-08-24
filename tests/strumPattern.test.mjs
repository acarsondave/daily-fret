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
  closestStrokesMs,
  gradableCeilingBpm,
  strokesTooCloseToHear,
  parsePattern,
  matchPattern,
  summarisePattern,
  patternStanding,
  dealNext,
  soundedSlots,
  SLOTS_PER_BAR,
  DOWN_DETECTION_LAG_MS,
  UP_DETECTION_LAG_MS,
  MIN_PATTERN_PASSES,
} from '../src/lib/strumPattern.ts';
import { TimingAnalyser, TIMING_FRAME_SIZE, MIN_STRUM_GAP_MS } from '../src/audio/timing.ts';
import { SIXTEENTH_MAX_BPM, cappedTempo } from '../src/lib/songStrum.ts';
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
  // This used to read `DXDU-UD-`, from before X meant anything. It means the
  // percussive slap now, so the rubbish had to be rubbish that stayed rubbish.
  check('rubbish is refused', parsePattern('DZDU-UD-') === null);
  // The arm cannot be going up on a downbeat, so this is not a hard pattern, it
  // is an impossible one. Taken as written it would draw a pick facing the wrong
  // way and subtract the up strum's detection lag from a down stroke.
  check('an up strum on a downbeat is refused', parsePattern('U-DU-UD-') === null);
  check('a down strum on an offbeat is refused', parsePattern('D-DD-UD-') === null);
  check('the source string is carried through unchanged', parsePattern('D-DU-UD-')?.source === 'D-DU-UD-');

  // Every length the alphabet may be, at the edges. Four is a bar of quarters,
  // eight is a bar, sixteen is the two-bar phrase "Exploring Strumming" asks
  // for, and nothing between or beyond those is a phrase anybody counted.
  const phrase = parsePattern('D-DU-UD-D-DU-UDU');
  check('sixteen characters are two bars', phrase?.slots.length === SLOTS_PER_BAR * 2);
  check('and the second bar is read as its own half',
    phrase?.slots[15] === 'U' && phrase?.slots[7] === null);
  check('twelve characters are refused', parsePattern('D-DU-UD-D-DU') === null);
  check('twenty-four are refused too',
    parsePattern('D-DU-UD-D-DU-UD-D-DU-UD-') === null);
  check('and the parity rule holds across the bar line',
    parsePattern('D-DU-UD-U-DU-UD-') === null);
}

// --- scoring, with the answers known ---------------------------------------
console.log('\nScoring a take whose answer is known\n');

const GRID = { origin: 1, period: 60 / 80, clicks: 40 };

/** Onsets for a run, with a per-slot decision about what the player did. */
function play(pattern, passes, { offsetMs = () => 0, drop = () => false, add = () => false } = {}) {
  const onsets = [];
  // A slot is an eighth note whatever the phrase is: half a beat, always.
  const slotPeriod = GRID.period / 2;
  const length = pattern.slots.length;
  for (let pass = 0; pass < passes; pass += 1) {
    for (let slot = 0; slot < length; slot += 1) {
      const expected = pattern.slots[slot];
      const at = GRID.origin + (pass * length + slot) * slotPeriod;
      // The player strikes; the analyser hears it a little later, by an amount
      // that depends on which way the hand was going.
      // A slap has no direction of its own, so it is heard with the lag of
      // whichever way the arm is already going through that slot.
      const facing = expected === 'D' || expected === 'U' ? expected : slot % 2 === 0 ? 'D' : 'U';
      const lag = (facing === 'U' ? UP_DETECTION_LAG_MS : DOWN_DETECTION_LAG_MS) / 1000;
      if (expected && !drop(pass, slot)) onsets.push(at + lag + offsetMs(pass, slot) / 1000);
      if (!expected && add(pass, slot)) onsets.push(at + DOWN_DETECTION_LAG_MS / 1000);
    }
  }
  return onsets;
}

const run = (pattern, onsets, passes) =>
  summarisePattern(matchPattern({ onsets, grid: GRID, pattern, originBeat: 0, passes }), pattern);

{
  const oldFaithful = parsePattern('D-DU-UD-');
  const perfect = run(oldFaithful, play(oldFaithful, 8), 8);
  check('a perfect Old Faithful scores 100', perfect.score === 100, String(perfect.score));
  check('the empty slots are not counted against it', perfect.expected === 5 * 8, String(perfect.expected));
  check('nothing is reported as added', perfect.added === 0, String(perfect.added));
  check('it settles the first time round', perfect.settledBar === 0, String(perfect.settledBar));

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
  const summary = run(p, play(p, 8, { drop: (_pass, slot) => slot === LAST_UP }), 8);
  check('dropping the last up costs exactly its share', summary.score === 80, String(summary.score));
  check('and the slot itself reports never being struck',
    summary.slots[LAST_UP].struck === 0, String(summary.slots[LAST_UP].struck));
  const others = summary.slots.filter((s) => s.expected && s.slot !== LAST_UP);
  check('while every other sounded slot is clean', others.every((s) => s.inTime === 8));
  check('it never settles', summary.settledBar === null, String(summary.settledBar));
}

{
  // Two goes of fumbling, then it locks in. This is the difference between a
  // pattern you are working out and one you have.
  const p = parsePattern('D-DU-UD-');
  const onsets = play(p, 8, { offsetMs: (pass) => (pass < 2 ? 90 : 5) });
  const summary = run(p, onsets, 8);
  check('a run that settles late says which pass it settled on', summary.settledBar === 2, String(summary.settledBar));
  check('and does not score as if it were clean throughout', summary.score < 100, String(summary.score));
}

{
  // "You can add in extra strums and leave others out." An added strum is a
  // variation, and must not cost anything.
  const p = parsePattern('D-DU-UD-');
  const summary = run(p, play(p, 8, { add: (_pass, slot) => slot === 4 }), 8);
  check('an added strum is counted', summary.added === 8, String(summary.added));
  check('and does not reduce the score', summary.score === 100, String(summary.score));
}

{
  const p = parsePattern('D-DU-UD-');
  const short = run(p, play(p, 2), 2);
  check(`under ${MIN_PATTERN_PASSES} goes nothing is claimed`, short.enough === false);
  check('and the score is not reported', short.score === 0, String(short.score));
}

{
  // A two-bar phrase, scored end to end. The thing that would break silently is
  // the slot period: read the sixteen slots as one bar and every one of them is
  // a sixteenth note, which puts the whole phrase at double speed and scores a
  // perfect take as a total miss.
  const phrase = parsePattern('D-DU-UD-D-DU-UDU');
  const perfect = run(phrase, play(phrase, 4), 4);
  check('a perfect two-bar phrase scores 100', perfect.score === 100, String(perfect.score));
  check('both bars are counted, not just the first',
    perfect.expected === 11 * 4, String(perfect.expected));
  check('it settles the first time round', perfect.settledBar === 0, String(perfect.settledBar));
  check('nothing is invented in its ghost slots', perfect.added === 0, String(perfect.added));

  // The last slot is the only thing that separates this phrase's two bars, so
  // dropping it is the test that the second bar is really being read as its own.
  const dropped = run(phrase, play(phrase, 4, { drop: (_pass, slot) => slot === 15 }), 4);
  check('a strum missed in the second bar lands on the second bar',
    dropped.slots[15].struck === 0 && dropped.slots[7].expected === null,
    `${dropped.slots[15].struck}`);
  check('and costs exactly its own share', dropped.score === Math.round((10 / 11) * 100),
    String(dropped.score));

  // Four goes at a two-bar phrase is eight bars of playing. Three is not enough,
  // for the same reason three bars of a one-bar pattern was not.
  const short = run(phrase, play(phrase, 3), 3);
  check('three goes at a phrase is still not enough to claim anything',
    short.enough === false);
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
      passes: 8,
    }),
    p,
  );
  const wouldBe = raw.slots.filter((s, i) => p.slots[i] === 'U').map((s) => s.medianMs);
  check('and treating an up as a down would put it ~20ms early',
    wouldBe.every((v) => v < -15), wouldBe.map((v) => v.toFixed(1)).join(', '));
}

// --- the deck --------------------------------------------------------------
// --- the percussive slap ----------------------------------------------------
//
// A slap is a stroke that arrives, and that is the whole of what is scored. It
// has no direction of its own, so the drill takes the arm's: on an even slot the
// arm is coming down, so the slap is heard with a down stroke's detection lag.
// Getting that wrong would put every slap twenty milliseconds out inside a fifty
// millisecond budget, and report it as the player rushing.
//
// What is deliberately NOT asserted anywhere: that the strings were muted. The
// analyser reports onsets. A slap and a strummed chord in the same slot at the
// same moment are the same evidence, and the drill says so by scoring them the
// same rather than by claiming to tell them apart.
console.log('\nA pattern with a percussive slap in it\n');
{
  const lucky = parsePattern('D--UX--U-U-UDUDU');
  check('the slap parses as its own thing', lucky?.slots[4] === 'X', String(lucky?.slots[4]));
  check('and it is sixteen slots', lucky?.slots.length === 16, String(lucky?.slots.length));
  check('a slap counts as a slot that sounds', soundedSlots(lucky) === 10, String(soundedSlots(lucky)));

  const clean = run(lucky, play(lucky, 6), 6);
  check('a clean take scores 100', clean.score === 100, String(clean.score));
  check('the slap is one of the strokes expected',
    clean.expected === 10 * 6, String(clean.expected));
  check('it settles the first time round', clean.settledBar === 0, String(clean.settledBar));

  // A slap on an even slot is played on the way down. Heard with an up stroke's
  // lag instead, it would land twenty milliseconds from where it was played.
  const slapSlot = clean.slots.find((sl) => sl.expected === 'X');
  check('the slap slot is reported as a slap', slapSlot?.expected === 'X');
  check('and lands where it was played', Math.abs(slapSlot?.medianMs ?? 99) < 1,
    String(slapSlot?.medianMs));

  // Drop only the slap and the drill says which slot went missing, rather than
  // handing back one lower percentage.
  const dropped = run(lucky, play(lucky, 6, { drop: (_pass, slot) => slot === 4 }), 6);
  check('dropping the slap is visible on its own slot',
    dropped.slots[4].struck === 0, String(dropped.slots[4].struck));
  check('and the slots around it are untouched',
    dropped.slots[3].struck === 6 && dropped.slots[7].struck === 6);
  check('while the score falls by exactly the slap',
    dropped.score === Math.round((54 / 60) * 100), String(dropped.score));

  // An up strum cannot sit on a downbeat, but a slap can sit anywhere, because
  // it is played with whatever the arm is already doing.
  check('a slap is allowed on a downbeat', parsePattern('X-DU-UD-') !== null);
  check('and on an offbeat', parsePattern('D-DX-UD-') !== null);
  check('a quarter-note slap expands like a down', parsePattern('DXDD')?.slots[2] === 'X');
}

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
// low and, for most players, only catches the top three. A slap crosses the
// same strings with the fretting hand killing them, so it keeps the pick
// transient and loses everything after it.
function strike(audio, atSec, chord, { up, amp, period, seed, muted = false }) {
  const frets = VOICINGS[chord];
  const order = up ? [5, 4, 3] : [0, 1, 2, 3, 4, 5];
  order.forEach((string, i) => {
    if (frets[string] < 0) return;
    renderStrum(audio, Math.round((atSec + (i * 7) / 1000) * RATE), OPEN_ONLY(frets, [string]), {
      amp,
      dampAt: muted ? 0.005 : period * 0.9,
      dampMs: muted ? 12 : 70,
      spreadMs: 0,
      seed: seed + string,
    });
  });
}

function takeOf(patternText, { bpm = 80, passes = 8, upAmp = 0.36, drop = () => false } = {}) {
  const pattern = parsePattern(patternText);
  const length = pattern.slots.length;
  const beat = 60 / bpm;
  // Off the pattern's own grid rather than off a constant. This used to divide
  // by two under every pattern, which meant a sixteenth-note phrase could not be
  // synthesised at all and the one grid the drill had just learned to read had
  // never been played through the analyser.
  const slotSec = beat / pattern.slotsPerBeat;
  const lead = 0.6;
  const beats = (passes * length) / pattern.slotsPerBeat;
  const total = Math.ceil((lead + beats * beat + 1.5) * RATE);
  const audio = new Float32Array(total);
  let seed = 4242;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let b = 0; b < beats; b += 1) {
    const s = renderClick(VOICES[accentFor(b, 4)], RATE, random);
    const start = Math.round((lead + b * beat) * RATE);
    for (let i = 0; i < s.length && start + i < total; i += 1) audio[start + i] += s[i];
  }
  for (let pass = 0; pass < passes; pass += 1) {
    for (let slot = 0; slot < length; slot += 1) {
      const expected = pattern.slots[slot];
      if (!expected || drop(pass, slot)) continue;
      strike(audio, lead + (pass * length + slot) * slotSec, 'Am', {
        up: expected === 'U',
        amp: expected === 'U' ? upAmp : 0.5,
        period: beat,
        seed: 7 + pass * SLOTS_PER_BAR + slot,
        muted: expected === 'X',
      });
    }
  }
  addRoom(audio, 0.0015, 11);
  return { audio, pattern, lead, beat, passes };
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
  // The pattern's first slot sits on the first beat the run actually used.
  const originBeat = Math.round((t.lead - grid.origin) / grid.period);
  const outcomes = matchPattern({ onsets: strums, grid, pattern: t.pattern, originBeat, passes: t.passes });
  return { grid, summary: summarisePattern(outcomes, t.pattern), strums: strums.length };
}

{
  const of = measure('D-DU-UD-');
  check('the click is still found under a pattern', of.grid !== null);
  check('a well played Old Faithful scores at least 90', of.summary.score >= 90, String(of.summary.score));
  check('every sounded slot is found in nearly every pass',
    of.summary.slots.filter((s) => s.expected).every((s) => s.struck >= s.passes - 1),
    of.summary.slots.filter((s) => s.expected).map((s) => `${s.slot}:${s.struck}/${s.passes}`).join(' '));
  check('and nothing is invented in the ghost slots', of.summary.added === 0, String(of.summary.added));

  const busy = measure('D-DUDUD-');
  check('a busier pattern also scores at least 90', busy.summary.score >= 90, String(busy.summary.score));

  // A two-bar phrase through the real analyser, not only through hand-placed
  // onsets. A phrase read at the wrong resolution still produces a number, and
  // the number would be the drill blaming the player for the drill's arithmetic.
  const phrase = measure('D-DU-UD-D-DU-UDU', { passes: 4 });
  check('a two-bar phrase scores at least 90 on real audio',
    phrase.summary.score >= 90, String(phrase.summary.score));
  check('and every one of its sixteen slots is judged',
    phrase.summary.slots.length === SLOTS_PER_BAR * 2, String(phrase.summary.slots.length));
  check('with the second bar found as reliably as the first',
    phrase.summary.slots.slice(8).filter((s) => s.expected).every((s) => s.struck >= s.passes - 1),
    phrase.summary.slots.slice(8).filter((s) => s.expected).map((s) => `${s.slot}:${s.struck}/${s.passes}`).join(' '));

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
  check('up strums played far too softly go missing', upSlots.some((s) => s.struck < s.passes),
    upSlots.map((s) => `${s.slot}:${s.struck}/${s.passes}`).join(' '));
  check('while the downs around them stay clean',
    faint.summary.slots.filter((s) => s.expected === 'D').every((s) => s.struck >= s.passes - 1));
}


// --- how close two strums can be ------------------------------------------
//
// The number the whole sixteenth-note question turns on, measured rather than
// argued. The analyser goes quiet for PLAY_REFRACTORY_MS after every strum and
// then has to see the level fall back before it will fire again, so there is a
// spacing below which a run of strums simply is not reported, whatever the
// player did. MIN_STRUM_GAP_MS is that spacing, and these two takes are what it
// is worth. If either the constant or the detector moves, one of them fails.
console.log('\nHow close two strums can be and still both be heard\n');
{
  const evenly = (gapMs, count = 8) => {
    const total = Math.ceil((1 + (count * gapMs) / 1000 + 2) * RATE);
    const audio = new Float32Array(total);
    for (let i = 0; i < count; i += 1) {
      strike(audio, 0.6 + (i * gapMs) / 1000, 'Am', {
        up: false, amp: 0.5, period: 0.2, seed: 11 + i * 6,
      });
    }
    addRoom(audio, 0.0015, 11);
    return analyse(audio).strums.length;
  };

  const atFloor = evenly(MIN_STRUM_GAP_MS);
  check(`at ${MIN_STRUM_GAP_MS} ms apart every strum is reported`, atFloor === 8, `${atFloor}/8`);
  const under = evenly(MIN_STRUM_GAP_MS - 10);
  check(`ten milliseconds closer and some are not`, under < 8, `${under}/8`);
}

// --- what the drill may put a number on ------------------------------------
console.log('\nWhat the drill may put a number on\n');
{
  const lucky = parsePattern('16.D--UX--U-U-UDUDU');
  const faithful = parsePattern('D-DU-UD-');
  const eighths = parsePattern('DUDUDUDU');
  const quarters = parsePattern('D-D-D-D-');

  // The gap is round the phrase, not across it: the pattern repeats, so its last
  // stroke and its first are neighbours in the hand.
  check('a lone stroke on beat one has no gap to be too small',
    closestStrokesMs(parsePattern('D-------'), 200) === Infinity);
  const wrapped = parsePattern('D------U');
  check('and a stroke on the last slot is measured against the next time round',
    closestStrokesMs(wrapped, 120) === closestStrokesMs(eighths, 120),
    String(closestStrokesMs(wrapped, 120)));

  check('quarter notes are a long way clear anywhere in the click band',
    !strokesTooCloseToHear(quarters, 132), String(closestStrokesMs(quarters, 132)));
  // The consequence worth stating plainly, because it changes what the ladder
  // does at the top of the band. Old Faithful puts two of its strokes an eighth
  // apart, so it is in exactly the same position as straight eighths: 227 ms at
  // 132 BPM, which clears the analyser and does not clear a person playing one
  // of them slightly early.
  check('any pattern with two strokes an eighth apart runs out at 132',
    strokesTooCloseToHear(faithful, 132) && strokesTooCloseToHear(eighths, 132),
    String(closestStrokesMs(faithful, 132)));
  check('and at 120 both are fine',
    !strokesTooCloseToHear(faithful, 120) && !strokesTooCloseToHear(eighths, 120),
    String(closestStrokesMs(eighths, 120)));
  check('so their ceiling sits between the two, under the click band top',
    gradableCeilingBpm(eighths) >= 120 && gradableCeilingBpm(eighths) < 132,
    String(gradableCeilingBpm(eighths)));
  check('and the drill takes the click there rather than refusing to score',
    cappedTempo(['D-DU-UD-'], 132) === gradableCeilingBpm(faithful),
    String(cappedTempo(['D-DU-UD-'], 132)));

  // The case that forced all of this.
  check("Get Lucky's phrase is too fast at the record's tempo",
    strokesTooCloseToHear(lucky, 116), String(Math.round(closestStrokesMs(lucky, 116))));
  // Seventy-five is where the cap used to sit. It was picked off the scoring
  // window and it landed, to the millisecond, on the analyser's own floor.
  check('and at the 75 BPM this used to be capped to',
    strokesTooCloseToHear(lucky, 75), String(Math.round(closestStrokesMs(lucky, 75))));
  // Which is why the cap moved. The drill now takes the click all the way down
  // to where the phrase can be measured, rather than running it at a tempo where
  // the number it files is about the microphone.
  check('so the drill caps the click to its ceiling and not to its grid',
    cappedTempo(['16.D--UX--U-U-UDUDU'], 116) === gradableCeilingBpm(lucky),
    `${cappedTempo(['16.D--UX--U-U-UDUDU'], 116)} vs ${gradableCeilingBpm(lucky)}`);
  check('and at that tempo it is finally something the microphone can resolve',
    !strokesTooCloseToHear(lucky, gradableCeilingBpm(lucky)),
    String(Math.round(closestStrokesMs(lucky, gradableCeilingBpm(lucky)))));
  // A sixteenth grid is not the problem by itself. A sixteenth phrase whose
  // strokes are a beat apart is as gradable as anything else.
  check('a sixteenth phrase with no adjacent strokes is fine at the cap',
    !strokesTooCloseToHear(parsePattern('16.D---D---D---D---'), SIXTEENTH_MAX_BPM));
}

// --- and what happens when it does anyway ----------------------------------
//
// The number the guard exists for. This is a take played exactly right, through
// the real analyser, at the fastest tempo the drill will run this phrase at.
console.log("\nGet Lucky's phrase, played perfectly, at one cap and then the other\n");
{
  const LUCKY = '16.D--UX--U-U-UDUDU';
  // The same take twice. Nothing about the playing changes between these two
  // blocks; only the click does, and only by twelve beats a minute.
  const was = measure(LUCKY, { bpm: 75, passes: 6, upAmp: 0.5 });
  check('at the old 75 BPM cap it is scored far below what it was played at',
    was.grid !== null && was.summary.score < 60, String(was.summary?.score));
  check('with slots it struck every single time reported as never struck',
    was.summary.slots.filter((s) => s.expected && s.struck === 0).length >= 4,
    was.summary.slots.filter((s) => s.expected).map((s) => `${s.slot}:${s.struck}/${s.passes}`).join(' '));
  check('and the guard refuses to put a number on exactly that run',
    strokesTooCloseToHear(parsePattern(LUCKY), 75));

  const now = measure(LUCKY, { bpm: SIXTEENTH_MAX_BPM, passes: 6, upAmp: 0.5 });
  check(`at the ${SIXTEENTH_MAX_BPM} BPM it is capped to now, the same take scores like a good one`,
    now.grid !== null && now.summary.score >= 80, String(now.summary?.score));
  check('and the guard is satisfied there',
    !strokesTooCloseToHear(parsePattern(LUCKY), SIXTEENTH_MAX_BPM));
}

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
