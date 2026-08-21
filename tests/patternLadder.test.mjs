// The built-in pattern ladder.
//
// Two claims worth holding: every pattern is a real bar the matcher can read,
// and the ladder is actually a ladder rather than a pile.

import { BUILTIN_PATTERNS, patternName } from '../src/data/strumPatterns.ts';
import {
  DOWN_DETECTION_LAG_MS,
  MAX_PATTERN_BARS,
  MIN_PATTERN_PASSES,
  UP_DETECTION_LAG_MS,
  matchPattern,
  parsePattern,
  soundedSlots,
  summarisePattern,
  SLOTS_PER_BAR,
} from '../src/lib/strumPattern.ts';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};

console.log('\nEvery built-in is a bar the matcher can read\n');
for (const p of BUILTIN_PATTERNS) {
  const parsed = parsePattern(p.pattern);
  check(`${p.name} parses`, parsed !== null, p.pattern);
  check(`${p.name} is whole bars of 4/4`,
    p.pattern.length % SLOTS_PER_BAR === 0
      && p.pattern.length <= SLOTS_PER_BAR * MAX_PATTERN_BARS,
    `${p.pattern.length} slots`);
  check(`${p.name} sounds something`, parsed ? soundedSlots(parsed) > 0 : false);
  // The arm is on its way down through every even slot and up through every odd
  // one. A rung that asked for the other thing would draw a pick facing against
  // the arm crossing it and would have the wrong detection lag taken off every
  // one of its strums.
  check(`${p.name} faces the way the arm is going`,
    !!parsed && parsed.slots.every((s, i) => !s || s === (i % 2 === 0 ? 'D' : 'U')), p.pattern);
}

console.log('\nThe ladder climbs\n');
{
  const counts = BUILTIN_PATTERNS.map((p) => soundedSlots(parsePattern(p.pattern)));
  check('it starts on four downs and nothing else',
    BUILTIN_PATTERNS[0].pattern === 'D-D-D-D-', BUILTIN_PATTERNS[0].pattern);
  const ups = (s) => [...s].filter((c) => c === 'U').length;
  check('the first rung has no up strums', ups(BUILTIN_PATTERNS[0].pattern) === 0);
  check('every later rung has at least one',
    BUILTIN_PATTERNS.slice(1).every((p) => ups(p.pattern) > 0));
  check('no two rungs are the same bar',
    new Set(BUILTIN_PATTERNS.map((p) => p.pattern)).size === BUILTIN_PATTERNS.length);
  check('every rung says what it adds',
    BUILTIN_PATTERNS.slice(1).every((p) => typeof p.adds === 'string' && p.adds.length > 0));
  check('ids are unique', new Set(BUILTIN_PATTERNS.map((p) => p.id)).size === BUILTIN_PATTERNS.length);
  const perBar = BUILTIN_PATTERNS.map(
    (p, i) => counts[i] / (p.pattern.length / SLOTS_PER_BAR),
  );
  check('nothing is busier than straight eighths', Math.max(...perBar) === SLOTS_PER_BAR,
    perBar.join(', '));
  // Every rung leaves beat one sounding. It is the slot the player finds the bar
  // by, and a rung without it would be drilling a different thing.
  check('every rung starts the bar', BUILTIN_PATTERNS.every((p) => p.pattern[0] === 'D'));
  // The point of the whole set: between them the rungs leave out each of beats
  // two, three and four, so the arm learns to travel through a silent down
  // wherever it falls rather than only in Old Faithful's one place.
  const silentBeat = (beat) =>
    BUILTIN_PATTERNS.some((p) => parsePattern(p.pattern).slots[(beat - 1) * 2] === null);
  check('some rung leaves out beat two', silentBeat(2));
  check('some rung leaves out beat three', silentBeat(3));
  check('some rung leaves out beat four', silentBeat(4));
  check('and one two-bar phrase is reachable',
    BUILTIN_PATTERNS.some((p) => p.pattern.length === SLOTS_PER_BAR * 2));
}

// A rung is only a string until something plays it. Adding one to the array and
// looking at the picture proves the picture; this drives every rung through the
// matcher with a performance whose answer is known, so a pattern that cannot be
// scored cannot reach the deck.
console.log('\nEvery rung can be played and scored\n');
{
  const GRID = { origin: 1, period: 60 / 80, clicks: 40 };
  const PASSES = MIN_PATTERN_PASSES;

  /** A dead-on take of `pattern`, minus whatever `drop` leaves out. */
  const take = (pattern, drop = () => false) => {
    const onsets = [];
    const length = pattern.slots.length;
    for (let pass = 0; pass < PASSES; pass += 1) {
      for (let slot = 0; slot < length; slot += 1) {
        const stroke = pattern.slots[slot];
        if (!stroke || drop(slot)) continue;
        const lag = (stroke === 'U' ? UP_DETECTION_LAG_MS : DOWN_DETECTION_LAG_MS) / 1000;
        onsets.push(GRID.origin + ((pass * length + slot) * GRID.period) / 2 + lag);
      }
    }
    return summarisePattern(
      matchPattern({ onsets, grid: GRID, pattern, originBeat: 0, passes: PASSES }),
      pattern,
    );
  };

  for (const p of BUILTIN_PATTERNS) {
    const pattern = parsePattern(p.pattern);
    const sounded = soundedSlots(pattern);
    const perfect = take(pattern);
    check(`${p.name} scores 100 played dead on`, perfect.score === 100, String(perfect.score));
    check(`${p.name} counts every one of its own strums and no others`,
      perfect.expected === sounded * PASSES, `${perfect.expected} vs ${sounded * PASSES}`);
    check(`${p.name} arrives whole`, perfect.settledBar === 0, String(perfect.settledBar));
    check(`${p.name} invents nothing in its ghost slots`, perfect.added === 0, String(perfect.added));

    // Drop its last sounded slot: the one a stopping arm actually loses, and on
    // a two-bar phrase the one that proves the second bar is being read at all.
    const last = pattern.slots.reduce((found, s, i) => (s ? i : found), -1);
    const short = take(pattern, (slot) => slot === last);
    check(`${p.name} costs exactly one strum's share when one is dropped`,
      short.score === Math.round(((sounded - 1) / sounded) * 100),
      `${short.score} vs ${Math.round(((sounded - 1) / sounded) * 100)}`);
    check(`${p.name} names the slot that went missing`,
      short.slots[last].struck === 0
        && short.slots.filter((s) => s.expected && s.struck === 0).length === 1);
  }
}

console.log('\nNaming\n');
{
  check('a built-in resolves by its string', patternName('D-DU-UD-', []) === 'Old faithful');
  check('a custom pattern resolves too',
    patternName('DUDU-UD-', [{ id: 'x', name: 'Mine', pattern: 'DUDU-UD-' }]) === 'Mine');
  check('an unknown string resolves to nothing', patternName('D-------', []) === undefined);
}

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
