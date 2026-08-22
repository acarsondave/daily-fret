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
//
// The fourth is that a task must name the thing it is actually going to do. Two
// blocks broke that rule for a long time and both were fixed together, because
// they were the same mistake wearing different clothes. "Anchor changes" claimed
// a technique on any three shapes the learner had, including rings with no
// shared finger anywhere in them; it now checks (lib/anchors.ts) and does not
// exist when there is nothing to anchor. "Play a song" was a five minute timer
// described as "anything you can get through with the chords you have", written
// by an app that holds a chart for every song it ships and knows exactly which
// of them those chords open (lib/songCatalog.ts). It now names one and runs it.

import type { Routine, Task } from '../types';
import { ALL_SKILLS, type Skill } from '../data/skills';
import { DETECTABLE_CHORDS } from '../audio/chords';
import { trackModules } from '../data/curriculum';
import { SONGS, type Song } from '../data/songs';
import { bestAnchoredPair, describeAnchors, type Anchor } from './anchors';
import { BEGINNER_MODULES, findModule, gradeOfModule } from './beginnerCourse';
import { chordPairs } from './pairs';
import { songsPlayableWith } from './songCatalog';

const CHORD_PERFECT_SECONDS = 90;
const CHANGES_SECONDS = 60;
const ROTATION_SECONDS = 60;
/**
 * Three minutes, not the drill's own minute.
 *
 * The measurement only needs a minute, but the practice does not stop being
 * worth doing at the end of it, and the block this replaced was a four minute
 * timer. Cutting a beginner's daily rhythm work to sixty seconds because that
 * is how long the analysis takes would be the measurement deciding the
 * practice, which is backwards. The score is a rate, so a longer run still
 * compares with a shorter one.
 */
const RHYTHM_SECONDS = 180;
/** The note finder joins the routine once the course has named the notes, and stays. */
const NOTE_NAMES_FROM_MODULE = 5;
const NOTE_FINDER_SECONDS = 60;
/** Pairs in one changes task. More than this and the task becomes a shift. */
const MAX_PAIRS = 3;
/** Shapes in one Chord Perfect block when there is no new one to target. */
const MAX_PERFECT_POOL = 3;
/** Stretches join the routine once the course has taught them, and stay. */
const STRETCHES_FROM_MODULE = 4;
/**
 * Anchor work joins on the same terms, from "How To Use Anchor Fingers"
 * (b1-109). A technique does not stop applying at the end of the module that
 * taught it, and gating on the module alone meant the rotation drill could only
 * ever appear in the two modules that mention anchors, which are also the two
 * where the shapes in hand have no anchor between them.
 */
const ANCHORS_FROM_MODULE = 1;

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

/** Where a learner is standing, worked out from the shapes they can play. */
export interface DerivedModule {
  number: number;
  title: string;
  /** Curriculum course code the module belongs to, e.g. 'bg1'. */
  track: string;
  /** Grade title, for saying which part of the course this is. */
  gradeTitle: string;
  firstLessonCode: string | null;
  /** False when no chord in the set is one the course teaches. */
  fromChords: boolean;
}

/**
 * The module a chord vocabulary puts someone in.
 *
 * This is the inverse of `chordsTaughtBy`, and it exists because the app used to
 * ask. Onboarding put a course picker and a module picker in front of a beginner
 * to produce a guess it then asked them to confirm, when the answer was already
 * derivable: a module is the point in the course by which everything they can
 * play has been taught, so the module that most recently introduced one of their
 * shapes is where they are standing.
 *
 * With no chords at all the answer is the start of the course, which is a fact
 * about the course rather than a guess about the player, and the routine built
 * from it says as much in its own description.
 */
export function moduleForChords(chords: string[]): DerivedModule | null {
  const held = new Set(chords);
  let found: number | null = null;
  for (const m of BEGINNER_MODULES) {
    const grade = gradeOfModule(m.number);
    if (!grade) continue;
    if (chordsInModule(grade.code, m.number).some((c) => held.has(c))) found = m.number;
  }
  const number = found ?? BEGINNER_MODULES[0]?.number;
  if (number === undefined) return null;
  const grade = gradeOfModule(number);
  const named = grade ? findModule(grade.code, number) : null;
  if (!grade || !named) return null;
  return {
    number,
    title: named.title,
    track: grade.code,
    gradeTitle: grade.title,
    firstLessonCode: named.firstLessonCode,
    fromChords: found !== null,
  };
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

/** The drill that actually measures a skill, or null where nothing does. */
function measuringDrill(skill: Skill): 'strum-timing' | 'strum-pattern' | null {
  if (skill.measure.kind !== 'measured') return null;
  // Tuning is measured and is not practice. It is excluded from routines
  // everywhere; this is the rhythm branch's copy of that rule.
  const drill = skill.measure.drill;
  return drill === 'strum-timing' || drill === 'strum-pattern' ? drill : null;
}

/**
 * A ring of three worth rotating, built around a change that really anchors.
 *
 * The anchored pair leads, and the third shape is whichever of the rest anchors
 * against one of them, falling back to the most recently taught. Order inside
 * the ring is the rotation the drill will deal, so putting the anchored change
 * first is putting the point of the exercise first.
 */
function anchorRing(vocabulary: string[]): { ring: string[]; anchors: Anchor[] } | null {
  if (vocabulary.length < 3) return null;
  const pair = bestAnchoredPair(vocabulary);
  if (!pair) return null;
  const rest = vocabulary.filter((c) => c !== pair.from && c !== pair.to);
  const third =
    rest.find((c) => bestAnchoredPair([pair.to, c]) !== null) ??
    rest.find((c) => bestAnchoredPair([pair.from, c]) !== null) ??
    rest[rest.length - 1];
  return { ring: [pair.from, pair.to, third], anchors: pair.anchors };
}

/**
 * The chart that closes the session, or null when the vocabulary opens none.
 *
 * Ranked, in this order, and every term earns its place:
 *
 * - a chart using a shape the module has just introduced, because putting
 *   today's work into music is the whole reason the block is last;
 * - one the catalogue already has a recording for, because a first session that
 *   ends by asking a stranger to go and find a YouTube link ends badly;
 * - the lowest capo, because a beginner three days in may not own one;
 * - the most chords, because everything left is playable by definition and the
 *   richer chart exercises more of what the player has;
 * - then catalogue order, so the answer is deterministic and the order chords
 *   were ticked in cannot change it.
 */
function pickSong(vocabulary: string[], newChords: string[]): Song | null {
  const playable = songsPlayableWith(SONGS, vocabulary);
  if (!playable.length) return null;
  const fresh = new Set(newChords);
  const rank = (song: Song): number[] => [
    song.chords.some((c) => fresh.has(c)) ? 0 : 1,
    song.youtubeId ? 0 : 1,
    song.capo ?? 0,
    -song.chords.length,
  ];
  return [...playable].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  })[0];
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

  // Anchor work, once the course has taught it and the shapes in hand actually
  // have an anchor in them. Both halves are required and only the first used to
  // be checked, so a learner in module 2 was handed a ring of A, D and E under a
  // title claiming a shared finger those three do not have between them: A and D
  // press the same fret of the G string with different fingers, and E shares
  // nothing with either. The task now describes the finger it means, by name,
  // and does not exist when there is no such finger.
  const anchorsTaught =
    has('technique.anchor-fingers') || module === null || module >= ANCHORS_FROM_MODULE;
  const anchored = anchorsTaught ? anchorRing(vocabulary) : null;
  if (anchored) {
    tasks.push(
      task('Anchor changes', {
        description:
          `Around the ring. ${anchored.ring[0]} to ${anchored.ring[1]} ` +
          `without lifting ${describeAnchors(anchored.anchors)}.`,
        drill: { kind: 'chord-rotation', durationSec: ROTATION_SECONDS, chords: anchored.ring },
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

  // Rhythm. One block, and where there is a choice it is the one the microphone
  // counts. This used to take whichever rhythm skill the module mapped first,
  // which in module 3 is up strums, a skill nothing in the signal measures; the
  // player got a four minute clock with a disclaimer under it while the pattern
  // drill the same module teaches sat unreachable. The timer is still the honest
  // answer where a module's rhythm work has no measure at all, and it says which
  // of the two it is.
  //
  // Where a module maps two measured rhythm skills, the later one wins. The
  // rhythm family is authored in teaching order in src/data/skills.ts and its
  // own `requires` chain says so (patterns requires up strums requires on the
  // beat), so the last one a module reaches is the newest work in it. Module 4
  // teaches both the metronome and a written pattern, and the pattern is what
  // that module is asking the hand to learn.
  const rhythms = skills.filter(isPracticeSkill).filter((s) => s.family === 'rhythm');
  const rhythm = rhythms.findLast((s) => measuringDrill(s) !== null) ?? rhythms[0];
  if (rhythm) {
    const measuredBy = measuringDrill(rhythm);
    tasks.push(
      measuredBy
        ? task(rhythm.title, {
            description: rhythm.summary,
            drill: { kind: measuredBy, durationSec: RHYTHM_SECONDS },
          })
        : task(rhythm.title, {
            description: `${rhythm.summary} On a timer: nothing in the signal measures this one yet.`,
            duration: '4',
          }),
    );
  }

  // Where a named note lives on the neck, found and played. After the rhythm
  // block and before the song: it is the one drill in the day that is mostly
  // thinking, the hands have done their work by here, and the song is what a
  // session should end on. Nothing is configured, because the drill reads its
  // own history and runs the lowest rung it has not cleared (lib/noteFinder.ts).
  //
  // `basis.skills` only ever holds the current module's skills, so the module
  // number is checked alongside it: the notes are named once and stay named.
  if (
    vocabulary.length &&
    (has('theory.note-names') || module === null || module >= NOTE_NAMES_FROM_MODULE)
  ) {
    tasks.push(
      task('Note finder', {
        description: 'The app names a note and a string. Find it and play it.',
        drill: { kind: 'note-finder', durationSec: NOTE_FINDER_SECONDS },
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

  // End on something that sounds like music. A named chart the vocabulary
  // actually opens, run as the play-along drill, rather than five minutes on a
  // clock under the word "anything". No song at all is the right answer when
  // nothing opens yet: there is no chart in the catalogue for two shapes, and
  // inventing a timer to stand in for one is how the old block came to exist.
  const song = pickSong(vocabulary, newChords);
  if (song) {
    tasks.push(
      task(song.title, {
        description: `${song.artist}. ${list(song.chords)}.`,
        drill: { kind: 'song', songId: song.id },
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

/**
 * Whole minutes one task will take, or 0 for one that has no length.
 *
 * Whole minutes because the number is drawn as well as printed: first run shows
 * the session as one stroke per minute, and a total that did not equal the
 * strokes beside it would be the drawing and the caption disagreeing in public.
 * Rounding per task and summing is therefore the definition, not an
 * approximation of one.
 *
 * A song play-along comes back as 0. It runs until the record ends and the
 * routine does not get to say how long that is; the block it replaced claimed
 * five minutes, which was a number nobody had measured.
 */
export function taskMinutes(task: Task): number {
  if (task.duration) return Math.max(1, Math.round(Number(task.duration)));
  if (task.blocks?.length) {
    const seconds = task.blocks.reduce((total, b) => total + b.durationSec, 0);
    return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
  }
  const drill = task.drill;
  if (!drill) return 0;
  if (drill.kind === 'song') return 0;
  const seconds =
    drill.kind === 'one-minute-changes'
      ? (drill.pairs?.length ?? 1) * (drill.durationSec ?? CHANGES_SECONDS)
      : drill.kind === 'chord-trainer'
        ? (drill.durationSec ?? CHORD_PERFECT_SECONDS)
        : (drill.durationSec ?? CHANGES_SECONDS);
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Minutes a generated routine will take, for showing before committing.
 *
 * Everything with a length, and nothing without one: a session that ends on a
 * song is this many minutes and then a song.
 */
export const routineMinutes = (routine: Routine): number =>
  routine.tasks.reduce((total, t) => total + taskMinutes(t), 0);

/**
 * How many of a routine's tasks the microphone actually counts.
 *
 * Every drill except the play-along. A song is a drill because it runs inside
 * the app, and it is deliberately never graded: nothing is recorded from it, so
 * counting it here would put a number's worth of confidence on the one block of
 * the session that cannot produce one.
 */
export const measuredTaskCount = (routine: Routine): number =>
  routine.tasks.filter((t) => t.drill && t.drill.kind !== 'song').length;
