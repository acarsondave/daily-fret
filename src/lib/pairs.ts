import type { Routine } from '../types';
import { baseKey } from './drillWindow';

// Chord-change results are stored per *pair*, not per task, so "A↔D" keeps its
// own benchmark regardless of which task/routine it was played in. Keys are
// order-independent and namespaced so they're easy to find in drillResults.
export const PAIR_PREFIX = 'pair:';

// A sensible beginner vocabulary used when a routine hasn't set its own yet.
const DEFAULT_VOCAB = ['A', 'D', 'E', 'G'];

export function pairKey(a: string, b: string): string {
  return `${PAIR_PREFIX}${[a, b].sort().join('|')}`;
}

// Reads through the window a run may have recorded (lib/drillWindow.ts): which
// two chords were changed between is the same question whether the block ran for
// thirty seconds or ninety.
export function parsePairKey(key: string): { from: string; to: string } | null {
  if (!key.startsWith(PAIR_PREFIX)) return null;
  const [from, to] = baseKey(key).slice(PAIR_PREFIX.length).split('|');
  if (!from || !to) return null;
  return { from, to };
}

// The chords a routine is working on. Falls back to chords derived from its
// existing change-drills, then to the default vocabulary, so older routines
// without an explicit `chords` field still behave sensibly (no migration).
export function routineChords(routine: Routine | undefined): string[] {
  if (routine?.chords && routine.chords.length) return routine.chords;
  if (!routine) return DEFAULT_VOCAB;
  const derived = new Set<string>();
  for (const t of routine.tasks) {
    if (t.drill?.kind === 'one-minute-changes') {
      if (t.drill.chordFrom) derived.add(t.drill.chordFrom);
      if (t.drill.chordTo) derived.add(t.drill.chordTo);
    }
    if (t.drill?.kind === 'chord-trainer' && t.drill.chords) {
      t.drill.chords.forEach((c) => derived.add(c));
    }
  }
  return derived.size >= 2 ? [...derived] : DEFAULT_VOCAB;
}

// Every unordered change-pair from a chord set, in a stable order.
export function chordPairs(chords: string[]): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < chords.length; i++) {
    for (let j = i + 1; j < chords.length; j++) {
      out.push({ from: chords[i], to: chords[j] });
    }
  }
  return out;
}
