// The deck the strum-pattern drill deals from, the key its results are filed
// under, and the phase the pendulum is drawn against.
//
// The scoring engine has its own suite (tests/strumPattern.test.mjs) and is not
// re-checked here. What this pins is everything the drill wraps around it: that
// two tempos are two series, that a pattern nobody has settled cannot be called
// automatic, that a run whose up strums all went missing is reported as unheard
// rather than as missed, and that the marker on screen is in phase with the
// click the player is listening to.

import {
  describeDrillKey,
  isDrillKey,
  patternKey,
  parsePatternKey,
} from '../src/lib/drillKeys.ts';
import {
  DEFAULT_DECK_SIZE,
  barsPerDeal,
  deckCards,
  deckOf,
  patternRuns,
  upStrumsUnheard,
} from '../src/lib/patternDeck.ts';
import { MIN_PATTERN_BARS, matchPattern, parsePattern, summarisePattern } from '../src/lib/strumPattern.ts';
import { BUILTIN_PATTERNS } from '../src/data/strumPatterns.ts';
import { applyMeasurements } from '../src/store/completion.ts';
import { phaseAt } from '../src/audio/metronome.ts';

let failures = 0;
const check = (l, ok, d) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${!ok && d ? `: ${d}` : ''}`);
};

// --- the key ---------------------------------------------------------------
console.log('\nWhat a dealt pattern is filed under\n');
{
  const key = patternKey('D-DU-UD-', 82);
  check('the key names the pattern and the tempo', key === 'pattern:D-DU-UD-@80', key);
  check('it round-trips', JSON.stringify(parsePatternKey(key)) === JSON.stringify({ pattern: 'D-DU-UD-', bpm: 80 }));
  check('the app recognises it as a drill key', isDrillKey(key));
  check('81 and 84 are the same practice',
    patternKey('D-DU-UD-', 81) === patternKey('D-DU-UD-', 84));
  check('80 and 100 are not',
    patternKey('D-DU-UD-', 80) !== patternKey('D-DU-UD-', 100));
  check('and two patterns at one tempo are not either',
    patternKey('D-DU-UD-', 80) !== patternKey('DUDUDUDU', 80));

  const described = describeDrillKey(key);
  check('it describes itself by the pattern a player would recognise',
    described.label === 'Old faithful · 80 BPM', described.label);
  check('with the unit its number carries', described.unit === '% in time', described.unit);
  const own = describeDrillKey(patternKey('D-DUDU--', 90));
  check('a pattern with no built-in name keeps its own string',
    own.label === 'D-DUDU-- · 90 BPM', own.label);
  check('rubbish after the prefix is refused, not guessed at',
    parsePatternKey('pattern:notapattern@80') === null);
  check('and a key with no tempo is refused too',
    parsePatternKey('pattern:D-DU-UD-') === null);
}

// --- the deck --------------------------------------------------------------
console.log('\nThe deck\n');
{
  check('an unconfigured deck is the opening rungs of the ladder',
    deckOf(undefined).join(' ') ===
      BUILTIN_PATTERNS.slice(0, DEFAULT_DECK_SIZE).map((p) => p.pattern).join(' '),
    deckOf(undefined).join(' '));
  check('a task states its own deck', deckOf(['DUDUDUDU']).join(' ') === 'DUDUDUDU');
  check('and a duplicate card is dealt once',
    deckOf(['DUDUDUDU', 'DUDUDUDU']).length === 1);
  check('an empty deck falls back rather than dealing nothing',
    deckOf([]).length === DEFAULT_DECK_SIZE);

  check('a deal is never shorter than the matcher will judge',
    barsPerDeal(1) === MIN_PATTERN_BARS, String(barsPerDeal(1)));
  check('and a task asking for longer gets it', barsPerDeal(8) === 8);
}

console.log('\nWhat the history says about each card\n');
{
  const KEY = patternKey('D-DU-UD-', 80);
  const log = (date, runs) => {
    let day = { date, routineId: 'r1', completedTaskIds: [] };
    for (const run of runs) {
      day = applyMeasurements(day, 't1', [{ key: KEY, value: run.score, settledBar: run.settledBar }], 1);
    }
    return day;
  };

  const clean = {
    '2026-08-01': log('2026-08-01', [{ score: 92, settledBar: 0 }]),
    '2026-08-02': log('2026-08-02', [{ score: 88, settledBar: 0 }]),
    '2026-08-03': log('2026-08-03', [{ score: 95, settledBar: 0 }]),
  };
  const runs = patternRuns(clean, 'D-DU-UD-', 80);
  check('every run of the pattern is found, oldest first',
    runs.map((r) => r.score).join(',') === '92,88,95', runs.map((r) => r.score).join(','));
  check('and each keeps the bar it settled on',
    runs.every((r) => r.settledBar === 0));
  check('three clean runs make a pattern automatic',
    deckCards(clean, ['D-DU-UD-'], 80)[0].standing === 'automatic');
  check('a pattern read at another tempo is a different card',
    deckCards(clean, ['D-DU-UD-'], 120)[0].standing === 'new');

  const slow = {
    '2026-08-01': log('2026-08-01', [{ score: 92, settledBar: 2 }]),
    '2026-08-02': log('2026-08-02', [{ score: 91, settledBar: 1 }]),
    '2026-08-03': log('2026-08-03', [{ score: 95, settledBar: 1 }]),
  };
  check('a pattern you recover by bar two is still being learned',
    deckCards(slow, ['D-DU-UD-'], 80)[0].standing === 'learning');

  // A day recorded before this drill existed kept only its best, so nothing in
  // it can say when the pattern arrived. The conservative reading is the only
  // available one.
  const legacy = {
    '2026-07-01': { date: '2026-07-01', routineId: 'r1', completedTaskIds: [], drillResults: { [KEY]: 96 } },
  };
  check('a day with only a best has no settling to report',
    patternRuns(legacy, 'D-DU-UD-', 80)[0].settledBar === null);
  check('so it never buys an automatic standing',
    deckCards(legacy, ['D-DU-UD-'], 80)[0].standing === 'learning');
  check('a card nobody has played is new',
    deckCards({}, ['DUDUDUDU'], 80)[0].standing === 'new');
}

// --- up strums the microphone never got ------------------------------------
console.log('\nUp strums too quiet to hear\n');

const GRID = { origin: 1, period: 60 / 80, clicks: 40 };

/** A run of `pattern` where `play(slot)` decides whether each slot sounded. */
function summaryOf(patternText, bars, play) {
  const pattern = parsePattern(patternText);
  const slotPeriod = (GRID.period * 4) / pattern.slots.length;
  const onsets = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let slot = 0; slot < pattern.slots.length; slot += 1) {
      if (!pattern.slots[slot] || !play(slot, bar)) continue;
      const lag = (pattern.slots[slot] === 'U' ? 3 : 23) / 1000;
      onsets.push(GRID.origin + bar * 4 * GRID.period + slot * slotPeriod + lag);
    }
  }
  return summarisePattern(
    matchPattern({ onsets, grid: GRID, pattern, originBeat: 0, bars }),
    pattern,
  );
}

{
  const played = summaryOf('D-DU-UD-', 8, () => true);
  check('a run with every strum heard is not called quiet', !upStrumsUnheard(played));

  const noUps = summaryOf('D-DU-UD-', 8, (slot) => slot !== 3 && slot !== 5);
  check('a run where the ups all went missing is', upStrumsUnheard(noUps));
  check('and the downs around them are reported clean',
    noUps.slots.filter((s) => s.expected === 'D').every((s) => s.struck === s.bars));

  const oneUpGone = summaryOf('D-DU-UD-', 8, (slot) => slot !== 5);
  check('one up strum going missing is a dropped strum, not a level problem',
    !upStrumsUnheard(oneUpGone));

  // The ladder's second rung has one up strum, on the slot a beginner's arm
  // stops before. Calling that inaudible would throw away the drill's most
  // useful finding.
  const lastUp = summaryOf('D-D-D-DU', 8, (slot) => slot !== 7);
  check('a pattern with a single up is never given this answer', !upStrumsUnheard(lastUp));
  check('its dropped up is still reported as never struck',
    lastUp.slots[7].struck === 0, String(lastUp.slots[7].struck));

  const short = summaryOf('D-DU-UD-', 2, (slot) => slot !== 3 && slot !== 5);
  check('a run too short to judge says nothing about levels', !upStrumsUnheard(short));
}

// --- the pendulum's phase --------------------------------------------------
console.log('\nThe phase the marker is drawn against\n');
{
  const SPB = 0.75; // 80 BPM
  // The scheduler has queued up to a second of clicks ahead; the next one it has
  // not placed is at 10.0 and is the fourth beat of the bar.
  const mid = phaseAt(10.0, 9.5, SPB, 4, 4);
  check('the most recent click is counted back to, not forward from',
    mid.position === 3, String(mid?.position));
  check('and the marker is a quarter of a beat past it',
    Math.abs(mid.sinceSeconds - 0.25) < 1e-9, String(mid?.sinceSeconds));

  const onIt = phaseAt(10.0, 10.0, SPB, 4, 4);
  check('landing exactly on a click reports that click', onIt.position === 4, String(onIt?.position));
  check('with nothing elapsed', onIt.sinceSeconds === 0);

  const deep = phaseAt(10.0, 8.1, SPB, 4, 4);
  check('a full queue counts back as many beats as it needs',
    deep.position === 1, String(deep?.position));
  check('and never reports more than a beat elapsed',
    deep.sinceSeconds >= 0 && deep.sinceSeconds < SPB, String(deep?.sinceSeconds));

  const justBehind = phaseAt(10.0, 10.3, SPB, 4, 4);
  check('a scheduler a fraction of a beat behind still knows where it is',
    justBehind.position === 4 && Math.abs(justBehind.sinceSeconds - 0.3) < 1e-9,
    JSON.stringify(justBehind));
  check('a scheduler that has not woken in a whole beat has no phase to give',
    phaseAt(10.0, 11.2, SPB, 4, 4) === null);
  check('and a stopped tempo has none either', phaseAt(10.0, 9.5, 0, 4, 4) === null);

  const countIn = phaseAt(0.5, 0.4, SPB, -2, 4);
  check('a count-in reports its own negative beats', countIn.position === -3, String(countIn?.position));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
