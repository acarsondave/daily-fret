// Strum patterns for timed strumming blocks. A pattern is a string of D (down),
// U (up), and - (rest). Built-ins ship with the app; users add their own, which
// are stored on the account. A block keeps the pattern string directly, so
// deleting a saved pattern never breaks a task that already uses it.

export interface StrumPattern {
  id: string;
  name: string;
  pattern: string;
}

export const BUILTIN_PATTERNS: StrumPattern[] = [
  { id: 'all-downs', name: 'All downs', pattern: 'DDDD' },
  { id: 'down-up', name: 'Down-up', pattern: 'DUDU' },
  { id: 'wild-1', name: 'D DU D', pattern: 'D-DUD-' },
  { id: 'wild-2', name: 'D DUDU D', pattern: 'D-DUDUD-' },
  { id: 'old-faithful', name: 'Old faithful', pattern: 'DD-UDU' },
];

// Find a pattern's display name by its string, across built-ins + custom.
export function patternName(pattern: string, custom: StrumPattern[]): string | undefined {
  const all = [...BUILTIN_PATTERNS, ...custom];
  return all.find((p) => p.pattern === pattern)?.name;
}
