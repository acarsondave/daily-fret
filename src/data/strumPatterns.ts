// Strum patterns. A pattern is a string of D (down), U (up), and - (a slot the
// arm travels through with the pick off the strings). Built-ins ship with the
// app; users add their own, which are stored on the account. A block keeps the
// pattern string directly, so deleting a saved pattern never breaks a task that
// already uses it.
//
// ONE BAR, EIGHT SLOTS. Every pattern here is exactly eight characters, because
// a bar of 4/4 has eight eighth-note slots and the strumming arm passes through
// all of them: 1 + 2 + 3 + 4 +. That was not true until now. `DDDD` and `DUDU`
// were four characters while everything else was six or eight, which meant the
// alphabet was being used for two different things at once, one bar in some
// entries and one repeating unit in others. `D-DUD-` was worse than
// inconsistent: six eighth-note slots is three beats, which is not a bar of
// anything the course teaches, so a matcher scoring against it would have been
// scoring against a bar that does not exist.
//
// The fix is safe to make. `patternName` resolves by string, and a saved block
// stores the string, so the only cost of renumbering is that a block holding an
// old four-character string loses its display name. Nothing in the live routine
// used one.
//
// THE LADDER. The order is the order to learn them in, and each rung adds
// exactly one new difficulty over the rung before it. That matters more than
// having many of them: "Exploring Strumming" tells the player to keep a few
// patterns and add more as they go, not to collect them.

export interface StrumPattern {
  id: string;
  name: string;
  pattern: string;
  /** What this rung adds over the one before it. Shown where a player is choosing. */
  adds?: string;
}

export const BUILTIN_PATTERNS: StrumPattern[] = [
  {
    id: 'all-downs',
    name: 'All downs',
    pattern: 'D-D-D-D-',
    adds: 'The pendulum. Four downs, and the arm still travels through the offbeats.',
  },
  {
    id: 'last-up',
    name: 'One up',
    // Deliberately the last slot rather than an easier one. The "and" of four is
    // where a beginner's arm stops early, because the bar feels finished, and
    // every pattern below inherits the problem. Meeting it on a bar with one up
    // in it is cheaper than meeting it inside Old Faithful.
    pattern: 'D-D-D-DU',
    adds: 'One up strum, on the last slot, which is the one that gets dropped.',
  },
  {
    id: 'straight-eighths',
    name: 'Straight eighths',
    pattern: 'DUDUDUDU',
    adds: 'Every slot sounds. Nothing to choose, so all of it is evenness.',
  },
  {
    id: 'd-du-du-d',
    name: 'D DU DU D',
    pattern: 'D-DUDUD-',
    adds: 'The first pattern that leaves slots out while the arm keeps going.',
  },
  {
    // Justin's, counted "1 2 + + 4": take D DU DU D and drop the down strum on
    // beat 3 while keeping the up after it. The hand still travels through the
    // missing down, which is the whole point of it.
    id: 'old-faithful',
    name: 'Old faithful',
    pattern: 'D-DU-UD-',
    adds: 'A missing down strum, with the up after it kept.',
  },
  {
    id: 'old-faithful-open',
    name: 'Old faithful, open',
    pattern: 'D-DU-UDU',
    adds: 'The final up comes back. This is the bar most pop songs are strummed on.',
  },
];

// Find a pattern's display name by its string, across built-ins + custom.
export function patternName(pattern: string, custom: StrumPattern[]): string | undefined {
  const all = [...BUILTIN_PATTERNS, ...custom];
  return all.find((p) => p.pattern === pattern)?.name;
}
