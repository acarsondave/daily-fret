import type { Routine, Task, TimedBlock } from '../types';
import { chordPairs, routineChords } from './pairs';

// A coached session flattens a routine into an ordered list of runnable
// segments: chord-change tasks expand across the routine's pairs, the chord
// trainer is seeded with the routine's chords, and any plain task becomes a
// timed block. This is what lets one "Coached" tap run the whole day.
export type CoachSegment =
  | { kind: 'changes'; taskId: string; title: string; from: string; to: string; seconds: number }
  | { kind: 'trainer'; taskId: string; title: string; chords: string[]; seconds: number }
  | { kind: 'rotation'; taskId: string; title: string; chords: string[]; seconds: number }
  | { kind: 'song'; taskId: string; title: string; songId: string }
  | { kind: 'timing'; taskId: string; title: string; seconds: number; bpm?: number }
  | {
      kind: 'patterns';
      taskId: string;
      title: string;
      seconds: number;
      bpm?: number;
      /** The deck to deal from. Absent takes the opening rungs of the ladder. */
      patterns?: string[];
      /** Bars each dealt pattern is played for. */
      bars?: number;
    }
  | { kind: 'timed'; taskId: string; title: string; description?: string; seconds: number; pattern?: string; bpm?: number };

// Parse a free-form duration label ("5 mins", "2-3 mins", "90s") into seconds.
// Durations are now captured as plain minute numbers ("5"), but legacy labels
// still parse so older saved routines keep working.
//
// The unit is read from the word attached to the number rather than from
// anywhere in the string. The old test was /\bs(ec)?\b/, and a word boundary
// never falls between a digit and the s written against it, so "90s" and
// "30 seconds" both came back as minutes and clamped to the half-hour ceiling:
// a ninety-second warm-up turned into a thirty-minute block, in the two spellings
// the comment above names as supported.
const SECONDS_UNIT = /^s(ec|ecs|econd|econds)?$/i;

export function parseDuration(label: string | undefined): number {
  if (!label) return 180;
  const m = label.match(/(\d+)\s*([a-z]*)/i);
  if (!m) return 180;
  const n = parseInt(m[1], 10);
  const seconds = SECONDS_UNIT.test(m[2]) ? n : n * 60;
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

/**
 * The timed blocks a non-drill task is made of.
 *
 * A task with no blocks is one block: itself. Stated once here because the
 * coached session and a task launched straight from the day's list have to run
 * the same thing, and the day's record is only honest if the timer that earned a
 * completion is the same timer either way.
 */
export function timedBlocks(task: Task): TimedBlock[] {
  if (task.blocks?.length) {
    return task.blocks.map((block) => ({ ...block, bpm: block.bpm ?? task.bpm }));
  }
  return [
    {
      id: task.id,
      label: task.title,
      durationSec: parseDuration(task.duration),
      note: task.description,
      bpm: task.bpm,
    },
  ];
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
      // Explicit pairs (when set) prescribe the exact transitions; otherwise fall
      // back to every combination of the comfortable chord set.
      const explicit = task.drill?.pairs?.filter((p) => p.from && p.to && p.from !== p.to);
      const pairs = explicit?.length ? explicit : chordPairs(changeChords);
      for (const p of pairs) {
        segments.push({ kind: 'changes', taskId: task.id, title: task.title, from: p.from, to: p.to, seconds: drillSeconds });
      }
    } else if (kind === 'chord-rotation') {
      // Anchor changes: cycle the task's ordered ring (falls back to the routine's
      // learned chords so an unconfigured rotation still runs).
      segments.push({
        kind: 'rotation',
        taskId: task.id,
        title: task.title,
        chords: task.drill?.chords?.length ? task.drill.chords : learned,
        seconds: drillSeconds,
      });
    } else if (kind === 'chord-trainer') {
      // Trainer reinforces everything learned (or its own explicit pool).
      segments.push({
        kind: 'trainer',
        taskId: task.id,
        title: task.title,
        chords: task.drill?.chords?.length ? task.drill.chords : learned,
        seconds: drillSeconds,
      });
    } else if (kind === 'strum-timing') {
      // Strum timing runs as its own segment rather than falling through to a
      // plain timer. It has to: the timer branch below would announce it, count
      // it in and then measure nothing, which is exactly the "the app says it
      // heard something it did not" failure the product is built to avoid.
      segments.push({
        kind: 'timing',
        taskId: task.id,
        title: task.title,
        seconds: drillSeconds,
        bpm: task.drill?.bpm,
      });
    } else if (kind === 'strum-pattern') {
      // Its own segment for the same reason timing is: the timer branch below
      // would announce it, count it in and then measure nothing, which is the
      // "the app says it heard something it did not" failure the product exists
      // to avoid.
      segments.push({
        kind: 'patterns',
        taskId: task.id,
        title: task.title,
        seconds: drillSeconds,
        bpm: task.drill?.bpm,
        patterns: task.drill?.patterns,
        bars: task.drill?.bars,
      });
    } else if (kind === 'song' && task.drill?.songId) {
      // Play-along: no fixed length, it ends when the record does.
      segments.push({
        kind: 'song',
        taskId: task.id,
        title: task.title,
        songId: task.drill.songId,
      });
    } else {
      // Configurable timed task: each block runs as its own segment, announced
      // by its label, so one task (e.g. "Strumming") can hold several patterns.
      // A task with no blocks is a single block covering the whole task.
      for (const block of timedBlocks(task)) {
        segments.push({
          kind: 'timed',
          taskId: task.id,
          title: block.label,
          description: block.note,
          seconds: block.durationSec,
          pattern: block.pattern,
          bpm: block.bpm,
        });
      }
    }
  }

  return segments;
}

/**
 * How long a paused session stays the same sitting.
 *
 * Twelve hours, so an evening session interrupted at 21:00 is still waiting the
 * next morning and a session from last week is not. The calendar day used to
 * decide this, and it is the wrong instrument: it makes a session paused ten
 * minutes before midnight stale ten minutes later, which is precisely when a
 * practice is most likely to be interrupted and least likely to be finished.
 */
export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Whether a saved coached session is still worth offering back.
 *
 * Takes `now` rather than reading the clock, so the awkward cases (paused at
 * 23:50, reopened at 00:10) can be stated in a test instead of waited for.
 */
export function isResumable(
  progress: { date: string; startedAt?: number },
  now: number,
  today: string,
): boolean {
  // Progress written before sessions carried a start time. The date it holds is
  // the only thing it can be judged on, so it is judged the way it always was.
  if (progress.startedAt === undefined) return progress.date === today;
  const age = now - progress.startedAt;
  return age >= 0 && age < RESUME_WINDOW_MS;
}

/**
 * How long the break after a segment lasts, decided by the segment it follows.
 *
 * It used to be thirty seconds after everything. Measured across thirty-one real
 * sessions, the gap from one drill's finish mark to the next drill's start mark
 * ran 42 to 48 seconds whatever had just happened, which on a nine-task routine
 * is over six minutes of a twenty-minute prescription spent watching a number
 * count down.
 *
 * Cutting it everywhere would have been the wrong repair. A rest is part of the
 * exercise after a counted minute at full effort and dead time after a stretch,
 * so the length is a property of the work that just ended:
 *
 *   changes, rotation   60  A counted minute at full effort. The course's own
 *                           instruction between one-minute-changes attempts is a
 *                           full minute off, and the anchor rotation is the same
 *                           minute over a ring instead of a pair.
 *   trainer             45  Full effort too, but every rep of Chord Perfect
 *                           contains its own lift-off, and the block already runs
 *                           past a hundred seconds.
 *   timing, patterns    20  One strum per click at a fixed tempo. That costs
 *                           concentration rather than the hands.
 *   song                15  Played to the record, at the record's own pace.
 *   timed                8  A stretch or a block of muted strumming. Long enough
 *                           to reach the neck again and no longer.
 */
const REST_AFTER: Record<CoachSegment['kind'], number> = {
  changes: 60,
  rotation: 60,
  trainer: 45,
  timing: 20,
  patterns: 20,
  song: 15,
  timed: 8,
};

export function restSecondsAfter(ended: CoachSegment, next: CoachSegment | undefined): number {
  // Nothing follows the last segment, so there is nothing to rest before.
  if (!next) return 0;
  // Two timed blocks of one task are one exercise with a label change halfway
  // through. A full announced rest between "Pattern 1" and "Pattern 2" of the
  // same strumming task interrupts the thing it is meant to sit between.
  if (ended.kind === 'timed' && next.kind === 'timed' && ended.taskId === next.taskId) return 0;
  return REST_AFTER[ended.kind];
}

/**
 * Whether a rest is long enough for the coach's second line to land inside it.
 *
 * That line arrives six seconds in, which on an eight-second break is the coach
 * still talking as the next drill is being announced.
 */
export function restIsSpoken(seconds: number): boolean {
  return seconds >= 30;
}
