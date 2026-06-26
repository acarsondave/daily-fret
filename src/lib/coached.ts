import type { Routine } from '../types';
import { chordPairs, routineChords } from './pairs';

// A coached session flattens a routine into an ordered list of runnable
// segments: chord-change tasks expand across the routine's pairs, the chord
// trainer is seeded with the routine's chords, and any plain task becomes a
// timed block. This is what lets one "Coached" tap run the whole day.
export type CoachSegment =
  | { kind: 'changes'; taskId: string; title: string; from: string; to: string }
  | { kind: 'trainer'; taskId: string; title: string; chords: string[] }
  | { kind: 'timed'; taskId: string; title: string; description?: string; seconds: number };

// Parse a free-form duration label ("5 mins", "2-3 mins", "90s") into seconds.
export function parseDuration(label: string | undefined): number {
  if (!label) return 180;
  const m = label.match(/\d+/);
  if (!m) return 180;
  const n = parseInt(m[0], 10);
  const isSeconds = /\bs(ec)?\b/i.test(label) && !/min/i.test(label);
  const seconds = isSeconds ? n : n * 60;
  return Math.min(1800, Math.max(15, seconds));
}

export function buildSegments(routine: Routine | undefined): CoachSegment[] {
  if (!routine) return [];
  const learned = routineChords(routine);
  const segments: CoachSegment[] = [];

  for (const task of routine.tasks) {
    const kind = task.drill?.kind;
    if (kind === 'one-minute-changes') {
      // Changes use the task's comfortable chord set (so a freshly-learned
      // chord can stay out of switching practice until you're ready), falling
      // back to the legacy single pair, then the routine's learned chords.
      const changeChords = task.drill?.chords?.length
        ? task.drill.chords
        : task.drill?.chordFrom && task.drill?.chordTo
          ? [task.drill.chordFrom, task.drill.chordTo]
          : learned;
      for (const p of chordPairs(changeChords)) {
        segments.push({ kind: 'changes', taskId: task.id, title: task.title, from: p.from, to: p.to });
      }
    } else if (kind === 'chord-trainer') {
      // Trainer reinforces everything learned (or its own explicit pool).
      segments.push({
        kind: 'trainer',
        taskId: task.id,
        title: task.title,
        chords: task.drill?.chords?.length ? task.drill.chords : learned,
      });
    } else {
      segments.push({
        kind: 'timed',
        taskId: task.id,
        title: task.title,
        description: task.description,
        seconds: parseDuration(task.duration),
      });
    }
  }

  return segments;
}
