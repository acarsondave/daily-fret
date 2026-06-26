import type { Routine } from '../types';
import { chordPairs, routineChords } from './pairs';

// A coached session flattens a routine into an ordered list of runnable
// segments: chord-change tasks expand across the routine's pairs, the chord
// trainer is seeded with the routine's chords, and any plain task becomes a
// timed block. This is what lets one "Coached" tap run the whole day.
export type CoachSegment =
  | { kind: 'changes'; taskId: string; title: string; from: string; to: string; seconds: number }
  | { kind: 'trainer'; taskId: string; title: string; chords: string[]; seconds: number }
  | { kind: 'timed'; taskId: string; title: string; description?: string; seconds: number };

// Parse a free-form duration label ("5 mins", "2-3 mins", "90s") into seconds.
// Durations are now captured as plain minute numbers ("5"), but legacy labels
// still parse so older saved routines keep working.
export function parseDuration(label: string | undefined): number {
  if (!label) return 180;
  const m = label.match(/\d+/);
  if (!m) return 180;
  const n = parseInt(m[0], 10);
  const isSeconds = /\bs(ec)?\b/i.test(label) && !/min/i.test(label);
  const seconds = isSeconds ? n : n * 60;
  return Math.min(1800, Math.max(15, seconds));
}

// Keep only the minute digits a user types, so the stored value is unambiguous
// ("5") and the UI can append the "mins" label optimistically.
export function sanitizeMinutes(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 3);
}

// Render a stored duration for display: numeric minutes get a "min(s)" suffix;
// legacy free-form text is shown as-is.
export function formatDuration(duration: string | undefined): string | null {
  if (!duration) return null;
  const trimmed = duration.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return `${n} min${n === 1 ? '' : 's'}`;
  }
  return trimmed;
}

export function buildSegments(routine: Routine | undefined): CoachSegment[] {
  if (!routine) return [];
  const learned = routineChords(routine);
  const segments: CoachSegment[] = [];

  for (const task of routine.tasks) {
    const kind = task.drill?.kind;
    // Interactive drills run for their own configured length (defaulting to the
    // classic 60s), derived straight from the task's drill config.
    const drillSeconds = task.drill?.durationSec ?? 60;
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
        segments.push({ kind: 'changes', taskId: task.id, title: task.title, from: p.from, to: p.to, seconds: drillSeconds });
      }
    } else if (kind === 'chord-trainer') {
      // Trainer reinforces everything learned (or its own explicit pool).
      segments.push({
        kind: 'trainer',
        taskId: task.id,
        title: task.title,
        chords: task.drill?.chords?.length ? task.drill.chords : learned,
        seconds: drillSeconds,
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
