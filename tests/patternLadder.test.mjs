// The built-in pattern ladder.
//
// Two claims worth holding: every pattern is a real bar the matcher can read,
// and the ladder is actually a ladder rather than a pile.

import { BUILTIN_PATTERNS, patternName } from '../src/data/strumPatterns.ts';
import { parsePattern, soundedSlots, SLOTS_PER_BAR } from '../src/lib/strumPattern.ts';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};

console.log('\nEvery built-in is a bar the matcher can read\n');
for (const p of BUILTIN_PATTERNS) {
  const parsed = parsePattern(p.pattern);
  check(`${p.name} parses`, parsed !== null, p.pattern);
  check(`${p.name} is one bar of 4/4`, p.pattern.length === SLOTS_PER_BAR, `${p.pattern.length} slots`);
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
  check('nothing is busier than straight eighths', Math.max(...counts) === SLOTS_PER_BAR,
    counts.join(', '));
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
