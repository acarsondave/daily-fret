// Turn "I am on Grade 1 Module 4, and I can already play A, D and E" into a
// routine worth doing tomorrow morning.
//
// The rule this follows is the one the whole product rests on: practise what is
// nearly there and what is new, not everything ever learned. A generated routine
// that lists all eight chords and all twenty-eight pairs is technically complete
// and nobody will ever run it.

import type { Routine, Task } from '../types';
import { ALL_SKILLS, type Skill } from '../data/skills';
import { trackModules } from '../data/curriculum';
import { chordPairs } from './pairs';

/** A session someone will actually sit down for. */
const TARGET_MINUTES = 20;
const CHORD_PERFECT_SECONDS = 90;
const CHANGES_SECONDS = 60;
const ROTATION_SECONDS = 60;
/** Pairs in one changes task. More than this and the task becomes a shift. */
const MAX_PAIRS = 3;

export interface BuildInput {
  /** Curriculum track, e.g. 'b1'. */
  track: string;
  /** Module number within it. */
  module: number;
  /** Chords the learner says they already have. */
  knownChords: string[];
  routineName?: string;
}

/** Chords a module introduces, in curriculum order. */
export function chordsInModule(track: string, module: number): string[] {
  const lessons = trackModules(track).find((m) => m.number === module)?.lessons ?? [];
  const codes = new Set(lessons.map((l) => l.code));
  const out: string[] = [];
  for (const skill of ALL_SKILLS) {
    if (skill.family !== 'chords' || skill.chords?.length !== 1) continue;
    if (!skill.lessons.some((c) => codes.has(c))) continue;
    out.push(skill.chords[0]);
  }
  return out;
}

/** Skills a module covers, whatever their family. */
export function skillsInModule(track: string, module: number): Skill[] {
  const lessons = trackModules(track).find((m) => m.number === module)?.lessons ?? [];
  const codes = new Set(lessons.map((l) => l.code));
  return ALL_SKILLS.filter((s) => s.lessons.some((c) => codes.has(c)));
}

/**
 * The pairs worth drilling: every new chord against the chords already under the
 * hand, plus the new ones against each other.
 *
 * Deliberately not every combination. A learner who knows five chords and meets
 * a sixth has fifteen possible pairs; five of them involve the new shape and are
 * where all the difficulty is, and the other ten are revision they do not need.
 */
export function pairsToDrill(newChords: string[], knownChords: string[]): Array<{ from: string; to: string }> {
  const known = knownChords.filter((c) => !newChords.includes(c));
  const out: Array<{ from: string; to: string }> = [];
  for (const fresh of newChords) {
    for (const old of known) out.push({ from: fresh, to: old });
  }
  out.push(...chordPairs(newChords));
  // No new chords means consolidation: drill what is there against itself.
  if (!out.length) out.push(...chordPairs(known));
  return out;
}

const task = (title: string, rest: Omit<Task, 'id' | 'title'>): Task => ({
  id: crypto.randomUUID(),
  title,
  ...rest,
});

/**
 * A routine for one module.
 *
 * Order is the sequence Coached mode plays, so it is the shape of the session:
 * warm up, the hardest new thing while the hand is fresh, then changes, then
 * something to enjoy.
 */
export function buildRoutine(input: BuildInput): Routine {
  const { track, module, knownChords } = input;
  const newChords = chordsInModule(track, module);
  const skills = skillsInModule(track, module);
  const vocabulary = [...new Set([...knownChords, ...newChords])];
  const tasks: Task[] = [];

  // Warm up first, always: it is the one thing that is worse when skipped and
  // costs nothing to keep.
  if (skills.some((s) => s.id === 'technique.stretches') || module >= 4) {
    tasks.push(
      task('Finger stretches', {
        description: 'Spider walk up and back. Slow, even, no buzzes.',
        duration: '3',
      }),
    );
  }

  // The new shapes, while the hand is fresh.
  const perfectPool = newChords.length >= 2 ? newChords : vocabulary.slice(-3);
  if (perfectPool.length >= 2) {
    tasks.push(
      task('Chord Perfect', {
        description: 'Place, strum, lift every finger off, place again from nothing.',
        drill: { kind: 'chord-trainer', durationSec: CHORD_PERFECT_SECONDS, chords: perfectPool },
      }),
    );
  }

  // Anchor work, once there are enough shapes for a ring to mean anything.
  if (vocabulary.length >= 3 && skills.some((s) => s.id === 'technique.anchor-fingers')) {
    tasks.push(
      task('Anchor changes', {
        description: 'Rotate the ring, keeping the shared finger planted.',
        drill: { kind: 'chord-rotation', durationSec: ROTATION_SECONDS, chords: vocabulary.slice(0, 3) },
      }),
    );
  }

  const pairs = pairsToDrill(newChords, knownChords).slice(0, MAX_PAIRS);
  if (pairs.length) {
    tasks.push(
      task(newChords.length ? `${newChords.join(' and ')} changes` : 'Chord changes', {
        description: 'One minute each. Count only the clean ones.',
        drill: { kind: 'one-minute-changes', durationSec: CHANGES_SECONDS, pairs },
      }),
    );
  }

  // Rhythm is on a timer until the app can hear timing. Saying that in the
  // description is better than a task that looks measured and is not.
  const rhythm = skills.find((s) => s.family === 'rhythm' && s.measure.kind !== 'known');
  if (rhythm) {
    tasks.push(
      task(rhythm.title, {
        description: `${rhythm.summary} On a timer for now: the app cannot hear timing yet.`,
        duration: '4',
      }),
    );
  }

  // End on something that sounds like music.
  tasks.push(
    task('Play a song', {
      description: 'Anything you can get through with the chords you have.',
      duration: '5',
    }),
  );

  return {
    id: crypto.randomUUID(),
    name: input.routineName ?? `Module ${module} Daily`,
    description: `Built for ${track.toUpperCase()} module ${module}.`,
    isDefault: true,
    tasks,
    chords: vocabulary,
  };
}

/** Rough minutes a generated routine will take, for showing before committing. */
export function routineMinutes(routine: Routine): number {
  let seconds = 0;
  for (const t of routine.tasks) {
    if (t.duration) seconds += Number(t.duration) * 60;
    else if (t.drill?.kind === 'one-minute-changes') {
      seconds += (t.drill.pairs?.length ?? 1) * (t.drill.durationSec ?? CHANGES_SECONDS);
    } else if (t.drill?.kind === 'chord-trainer') {
      seconds += t.drill.durationSec ?? CHORD_PERFECT_SECONDS;
    } else if (t.drill) {
      seconds += t.drill.durationSec ?? CHANGES_SECONDS;
    }
  }
  return Math.max(1, Math.round(seconds / 60));
}

export { TARGET_MINUTES };
