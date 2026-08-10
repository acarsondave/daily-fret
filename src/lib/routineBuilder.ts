// Turn "I am on Grade 1 module 4, and I can already play A, D and E" into a
// routine worth doing tomorrow morning.
//
// Two rules run this file.
//
// The first is the one the whole product rests on: practise what is nearly there
// and what is new, not everything ever learned. A generated routine that lists
// all nine chords and all thirty-six pairs is technically complete and nobody
// will ever run it.
//
// The second arrived with the full curriculum database. The skill taxonomy in
// src/data/skills.ts covers Grade 1 and one lesson past it, so every Grade 2 and
// Grade 3 module maps to no drill at all. The builder used to produce a routine
// anyway, name it after the module and describe it as "built for" that module,
// which was a coverage claim the app cannot back: for a Grade 3 learner it
// emitted two timed tasks and nothing measured. Every build now records which
// ground it stood on and says so in the routine's own description, because the
// screen that shows the routine has to be able to repeat it.
//
// The third is `isPracticeSkill` below. A curriculum lesson is not a practice
// task, and treating the two as the same thing put "How To Hold Your Guitar" on
// a daily list next to a chord drill. See the note on that function.

import type { Routine, Task } from '../types';
import { ALL_SKILLS, type Skill } from '../data/skills';
import { DETECTABLE_CHORDS } from '../audio/chords';
import { trackModules } from '../data/curriculum';
import { BEGINNER_MODULES, findModule, gradeOfModule } from './beginnerCourse';
import { chordPairs } from './pairs';

const CHORD_PERFECT_SECONDS = 90;
const CHANGES_SECONDS = 60;
const ROTATION_SECONDS = 60;
/** Pairs in one changes task. More than this and the task becomes a shift. */
const MAX_PAIRS = 3;
/** Shapes in one Chord Perfect block when there is no new one to target. */
const MAX_PERFECT_POOL = 3;
/** Stretches join the routine once the course has taught them, and stay. */
const STRETCHES_FROM_MODULE = 4;

/** Chords the course teaches, in the order it teaches them. */
const TAUGHT_ORDER: readonly string[] = ALL_SKILLS.filter(
  (s) => s.family === 'chords' && s.chords?.length === 1,
).map((s) => (s.chords as string[])[0]);

/**
 * Every chord the app can hear, in teaching order.
 *
 * The order is the course's; the membership is the detector's. A shape the
 * matcher has no template for cannot be drilled, and a shape the course has not
 * reached yet still can be, so the two lists are combined rather than one of
 * them being trusted for both facts.
 */
export const HEARABLE_CHORDS: readonly string[] = [
  ...TAUGHT_ORDER.filter((c) => DETECTABLE_CHORDS.includes(c)),
  ...DETECTABLE_CHORDS.filter((c) => !TAUGHT_ORDER.includes(c)),
];

const inTeachingOrder = (chords: Iterable<string>): string[] => {
  const set = new Set(chords);
  const known = HEARABLE_CHORDS.filter((c) => set.has(c));
  // Anything outside the hearable set keeps its own order at the end rather than
  // being dropped: a caller holding a chord this file does not know about should
  // see it survive, not vanish.
  const rest = [...set].filter((c) => !HEARABLE_CHORDS.includes(c));
  return [...known, ...rest];
};

/** How late in the course a chord is taught. Unknown shapes sort last. */
const teachingRank = (chord: string): number => {
  const at = HEARABLE_CHORDS.indexOf(chord);
  return at === -1 ? HEARABLE_CHORDS.length : at;
};

export interface BuildInput {
  /** Curriculum course code, e.g. 'bg1'. Null when the learner follows no course we hold. */
  track: string | null;
  /** Module number within it, or null. */
  module: number | null;
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

/** Families that are about playing the instrument rather than knowing about it. */
const PRACTICE_FAMILIES = new Set(['chords', 'changes', 'rhythm', 'technique', 'riffs', 'songs']);

/**
 * Whether a curriculum skill can be a task in a daily routine.
 *
 * A lesson is not a practice task, and this file used to treat them as the same
 * thing. Every task in this app is now something you start and do inside it: a
 * drill the microphone counts, or a block a timer runs to zero. That makes the
 * wrong kind of lesson absurd rather than merely useless, because the app ends
 * up offering to run a five minute timer on "How To Hold Your Guitar".
 *
 * Two filters, both read off the taxonomy rather than off a list of titles:
 *
 * - `measure.kind === 'known'` is the taxonomy's own word for knowledge rather
 *   than motor skill: reading chord boxes, what makes a chord minor, what a capo
 *   does. You learn each of them once. There is nothing to repeat tomorrow.
 * - the `setup`, `theory` and `ear` families are about the instrument, or about
 *   knowing things, rather than about playing. Tuning is the sharp case. It is
 *   `measured`, it has a real drill behind it, and it is still not practice: it
 *   happens before practice, it has its own surface in this app, and a routine
 *   that opens with "tune up, two minutes" every single day is a routine people
 *   stop opening.
 */
const isPracticeSkill = (skill: Skill): boolean =>
  skill.measure.kind !== 'known' && PRACTICE_FAMILIES.has(skill.family);

/**
 * The next module that puts a chord under the hand, for a learner who has none.
 *
 * A first-steps routine is genuinely short, and the honest way to say so is to
 * name what makes it longer rather than to pad it out with lessons.
 */
export function nextChordMilestone(module: number): { number: number; chords: string[] } | null {
  for (const m of BEGINNER_MODULES) {
    if (m.number <= module) continue;
    const grade = gradeOfModule(m.number);
    if (!grade) continue;
    const chords = chordsInModule(grade.code, m.number);
    if (chords.length) return { number: m.number, chords };
  }
  return null;
}

/**
 * Chords the beginner course has taught by the end of a given module.
 *
 * Module numbers run continuously across the three beginner grades, so this
 * walks the whole course rather than one track: someone starting at Grade 2
 * module 10 has met every Grade 1 shape, and asking their own track alone would
 * answer "none".
 */
export function chordsTaughtBy(module: number): string[] {
  const out = new Set<string>();
  for (const m of BEGINNER_MODULES) {
    if (m.number > module) continue;
    const grade = gradeOfModule(m.number);
    if (!grade) continue;
    for (const chord of chordsInModule(grade.code, m.number)) out.add(chord);
  }
  return inTeachingOrder(out);
}

/**
 * The pairs worth drilling: every new chord against the chords already under the
 * hand, plus the new ones against each other.
 *
 * Deliberately not every combination. A learner who knows five chords and meets
 * a sixth has fifteen possible pairs; five of them involve the new shape and are
 * where all the difficulty is, and the other ten are revision they do not need.
 *
 * With no new shape this is consolidation, and the pairs come back newest first.
 * They used to come back in vocabulary order, which put D against A at the top
 * for every learner in the course and drilled the two oldest shapes they had.
 */
export function pairsToDrill(
  newChords: string[],
  knownChords: string[],
): Array<{ from: string; to: string }> {
  const known = knownChords.filter((c) => !newChords.includes(c));
  const out: Array<{ from: string; to: string }> = [];
  for (const fresh of newChords) {
    for (const old of known) out.push({ from: fresh, to: old });
  }
  out.push(...chordPairs(newChords));
  if (out.length) return out;
  return chordPairs(inTeachingOrder(known)).sort(
    (a, b) =>
      Math.max(teachingRank(b.from), teachingRank(b.to)) -
      Math.max(teachingRank(a.from), teachingRank(a.to)),
  );
}

/**
 * What a routine can honestly be built out of.
 *
 * - `module`      the module maps to skills the app owns drills for.
 * - `vocabulary`  it does not, so the chords the learner claims are the subject.
 * - `first-steps` there are no chords yet, so the session is whatever hand work
 *                 the module holds, on a timer, and it is short.
 */
export type RoutineGround = 'module' | 'vocabulary' | 'first-steps';

export interface RoutineBasis {
  ground: RoutineGround;
  /** Shapes this module introduces that the app can hear. */
  newChords: string[];
  /** Everything the routine may draw on, in teaching order. */
  vocabulary: string[];
  /** Skills the module maps to. Empty wherever the taxonomy does not reach. */
  skills: Skill[];
  /** One sentence in the app's voice saying what the routine was built from. */
  sentence: string;
}

const list = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** What the app can honestly say it built a routine from, before building it. */
export function routineBasis(input: BuildInput): RoutineBasis {
  const { track, module } = input;
  const onCourse = track !== null && module !== null;
  const newChords = onCourse ? chordsInModule(track, module) : [];
  const skills = onCourse ? skillsInModule(track, module) : [];
  const vocabulary = inTeachingOrder([...input.knownChords, ...newChords]);
  const named = onCourse ? findModule(track, module) : null;
  // The module title goes in brackets wherever it appears. Course titles carry
  // their own punctuation ("Air Changes, Dynamics & Consolidation!"), and
  // dropping one into the middle of a sentence unbracketed reads as a typo.
  const where = named ? `module ${named.number} (${named.title})` : null;

  if (!vocabulary.length) {
    const next = module === null ? null : nextChordMilestone(module);
    return {
      ground: 'first-steps',
      newChords,
      vocabulary,
      skills,
      sentence: where
        ? `First steps in ${where}. Short on purpose: nothing is counted until there is a chord under the hand${
            next ? `, and module ${next.number} brings ${list(next.chords)}` : ''
          }.`
        : 'First steps. Nothing is counted until there is a chord under the hand.',
    };
  }

  // One mapped skill is not coverage. Module 9 is called "The F Chord Journey"
  // and the taxonomy maps exactly one lesson in it (muting), so the builder was
  // able to say "there are no new shapes in module 9" about the module that
  // exists to teach F. The app only knows what a module is musically about when
  // a chord, a change or a rhythm skill points at it.
  const musical = skills.some(
    (s) => s.family === 'chords' || s.family === 'changes' || s.family === 'rhythm',
  );

  if (musical && where) {
    return {
      ground: 'module',
      newChords,
      vocabulary,
      skills,
      sentence: newChords.length
        ? `Built around ${list(newChords)}, the new shape${newChords.length > 1 ? 's' : ''} in ${where}.`
        : `There are no new shapes in ${where}, so this consolidates the ${vocabulary.length} you have.`,
    };
  }

  return {
    ground: 'vocabulary',
    newChords: [],
    vocabulary,
    skills,
    sentence: where
      ? `Daily Fret has no drills mapped to ${where} yet, so this is built from the ${vocabulary.length} chords you have.`
      : `Built from the ${vocabulary.length} chords you have.`,
  };
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
 *
 * A routine can legitimately come back empty, and that is not a failure to paper
 * over. Someone who follows no course and has ticked no chords has told the app
 * nothing it can build on, and manufacturing a block so the screen looks full is
 * the same instinct that had this file emitting "Holding the guitar" as a five
 * minute daily task. The caller checks the task count and asks for a chord.
 */
export function buildRoutine(input: BuildInput): Routine {
  const basis = routineBasis(input);
  const { module } = input;

  const tasks = buildPlayingTasks(basis, module);
  const grade = module === null ? null : gradeOfModule(module);
  const name =
    input.routineName ??
    (module === null ? 'Daily practice' : `Module ${module} Daily`);

  return {
    id: crypto.randomUUID(),
    name,
    // Says what it was built from rather than which internal track code produced
    // it. "Built for BG3 module 17." was a machine string shown to a person, and
    // it asserted a fit with module 17 that the app did not have.
    description: grade && module !== null ? `${grade.title}. ${basis.sentence}` : basis.sentence,
    isDefault: true,
    tasks,
    chords: basis.vocabulary,
  };
}

function buildPlayingTasks(basis: RoutineBasis, module: number | null): Task[] {
  const { newChords, vocabulary, skills } = basis;
  const tasks: Task[] = [];
  const has = (id: string) => skills.some((s) => s.id === id);

  // The new shapes, while the hand is fresh. With nothing new to target, the
  // most recently taught shapes are the shakiest, and they are the pool.
  const perfectPool = newChords.length
    ? newChords
    : vocabulary.slice(-MAX_PERFECT_POOL);
  if (perfectPool.length) {
    tasks.push(
      task('Chord Perfect', {
        description: 'Place, strum, lift every finger off, place again from nothing.',
        drill: { kind: 'chord-trainer', durationSec: CHORD_PERFECT_SECONDS, chords: perfectPool },
      }),
    );
  }

  // Anchor work, once there are enough shapes for a ring to mean anything.
  if (vocabulary.length >= 3 && has('technique.anchor-fingers')) {
    tasks.push(
      task('Anchor changes', {
        description: 'Rotate the ring, keeping the shared finger planted.',
        drill: { kind: 'chord-rotation', durationSec: ROTATION_SECONDS, chords: vocabulary.slice(0, 3) },
      }),
    );
  }

  const pairs = pairsToDrill(newChords, vocabulary).slice(0, MAX_PAIRS);
  if (pairs.length) {
    tasks.push(
      task(newChords.length ? `${list(newChords)} changes` : 'Chord changes', {
        description: 'One minute each. Count only the clean ones.',
        drill: { kind: 'one-minute-changes', durationSec: CHANGES_SECONDS, pairs },
      }),
    );
  }

  // Rhythm is on a timer until the app can hear timing. Saying that in the
  // description is better than a task that looks measured and is not.
  const rhythm = skills.filter(isPracticeSkill).find((s) => s.family === 'rhythm');
  if (rhythm) {
    tasks.push(
      task(rhythm.title, {
        description: `${rhythm.summary} On a timer for now: the app cannot hear timing yet.`,
        duration: '4',
      }),
    );
  }

  // Before there is a chord, the only repeatable thing a module offers is hand
  // work, and there is very little of it. Capped at two blocks: a day one player
  // has a short routine, and the description says why rather than filling it
  // with lessons that are watched once.
  if (!vocabulary.length) {
    const handWork = skills.filter((s) => isPracticeSkill(s) && s.family === 'technique');
    for (const skill of handWork.slice(0, 2)) {
      tasks.push(task(skill.title, { description: skill.summary, duration: '5' }));
    }
  }

  // End on something that sounds like music, once there is enough to make any.
  if (vocabulary.length >= 2) {
    tasks.push(
      task('Play a song', {
        description: 'Anything you can get through with the chords you have.',
        duration: '5',
      }),
    );
  }

  if (!tasks.length) return tasks;

  // Warm up first, once the course has reached it: it is the one thing that is
  // worse when skipped and costs nothing to keep. Prepended rather than pushed
  // first, because a warm-up joins a session and is not one. Three minutes of
  // stretches on their own was the whole routine for a Grade 2 learner who had
  // not yet said which chords they have.
  const warmUp =
    has('technique.stretches') || module === null || module >= STRETCHES_FROM_MODULE;
  if (!warmUp) return tasks;
  return [
    task('Finger stretches', {
      description: 'Spider walk up and back. Slow, even, no buzzes.',
      duration: '3',
    }),
    ...tasks,
  ];
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

/** How many of a routine's tasks the microphone actually counts. */
export const measuredTaskCount = (routine: Routine): number =>
  routine.tasks.filter((t) => t.drill).length;
