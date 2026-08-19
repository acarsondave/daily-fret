// The skill taxonomy, and the honest answer to "can we measure this".
//
// This is the spine of progression. A curriculum tells you what comes next; it
// does not tell you whether you can do it yet. That judgement needs skills with
// prerequisites, and each skill needs a measure the app can actually take.
//
// The capability column is deliberately blunt. A practice assistant that claims
// to grade something it cannot hear is worse than one that honestly says "this
// one is on a timer": a wrong verdict costs more trust than no verdict. That
// rule kept rhythm out of the drills for a long time, and the way out of it was
// not to relax the rule but to satisfy it. Strum timing is now graded because
// the click and the guitar were made separable in the signal and the accuracy
// was measured against takes with known answers (tests/timing.test.mjs), not
// because grading rhythm stopped being risky.
//
// Lesson codes are the curriculum's own, from src/data/curriculum.ts.

import type { DrillKind } from '../types';

export type SkillFamily =
  | 'chords'
  | 'changes'
  | 'rhythm'
  | 'technique'
  | 'riffs'
  | 'theory'
  | 'ear'
  | 'setup'
  | 'songs';

/**
 * How, or whether, the app can tell that this skill is improving.
 *
 * - `measured`    a drill exists and produces a number today.
 * - `measurable`  the signal is there and the analysis is not built yet. `needs`
 *                 names what is missing, in terms of DSP the app has or could
 *                 add, so this is a work list and not a wish.
 * - `timed`       the honest answer is a clock. Not a failure: some things are
 *                 genuinely about minutes on the instrument.
 * - `known`       knowledge, not motor skill. Could be checked by asking, never
 *                 by listening.
 */
export type SkillMeasure =
  | { kind: 'measured'; drill: DrillKind | 'tuner'; metric: string }
  | { kind: 'measurable'; needs: string; metric: string }
  | { kind: 'timed'; why: string }
  | { kind: 'known'; why: string };

export interface Skill {
  id: string;
  title: string;
  /** One line the learner would recognise as what they are doing. */
  summary: string;
  family: SkillFamily;
  /** Skills worth having first. Not a lock, a recommendation the coach reads. */
  requires: string[];
  measure: SkillMeasure;
  /** Curriculum lesson codes that introduce or drill it. */
  lessons: string[];
  /** Chords the skill involves, where that is the whole point of it. */
  chords?: string[];
}

// Every chord Grade 1 teaches, as its own skill: a shape is either under the
// hand or it is not, and the progression needs to know which.
const CHORD_LESSONS: Record<string, string[]> = {
  D: ['b1-105'],
  A: ['b1-108'],
  E: ['b1-201', 'b1-202'],
  Em: ['b1-302'],
  Am: ['b1-303'],
  Dm: ['b1-402'],
  C: ['b1-501'],
  G: ['b1-602'],
};

const chordSkills: Skill[] = Object.entries(CHORD_LESSONS).map(([chord, lessons]) => ({
  id: `chord.${chord}`,
  title: `${chord} chord`,
  summary: `Place ${chord} cleanly, from nothing, without looking.`,
  family: 'chords',
  requires: ['technique.finger-placement'],
  measure: {
    kind: 'measured',
    drill: 'chord-trainer',
    metric: 'clean placements from a lifted hand, per block',
  },
  lessons,
  chords: [chord],
}));

const SKILLS: Skill[] = [
  // --- Setting up -----------------------------------------------------------
  {
    id: 'setup.tuning',
    title: 'Tuning',
    summary: 'Get the guitar in tune before playing anything.',
    family: 'setup',
    requires: [],
    // Declared measured, with a drill named, and there was nothing behind it: no
    // tuning has ever reached the practice log, so the standing had no value and
    // no bar and could never move off "ready" however often the guitar was
    // tuned. A skill the taxonomy says the app grades and the app never grades
    // is the exact dishonesty this column exists to prevent, so it is filed
    // where it actually stands: the signal is already there, the recording is
    // the part that is missing.
    measure: {
      kind: 'measurable',
      needs:
        'a tuning check written to the day, which the tuner never does. It already ' +
        'reports cents per string, accurate to a fraction of one, and keeps none of it',
      metric: 'strings inside a few cents at the start of a session',
    },
    lessons: ['b1-101'],
  },
  {
    id: 'setup.holding',
    title: 'Holding the guitar',
    summary: 'Sit and hold the instrument so nothing hurts and the hand can reach.',
    family: 'setup',
    requires: [],
    measure: { kind: 'known', why: 'Posture is visual. A microphone cannot see it.' },
    lessons: ['b1-102', 'b1-304'],
  },
  {
    id: 'setup.pick',
    title: 'Holding a pick',
    summary: 'Grip the pick so it does not slip and the strum stays even.',
    family: 'setup',
    requires: [],
    measure: { kind: 'known', why: 'Grip is visual.' },
    lessons: ['b1-106', 'b1-107'],
  },
  {
    id: 'setup.capo',
    title: 'Using a capo',
    summary: 'Clamp a capo cleanly and know what it does to the chord names.',
    family: 'setup',
    requires: [],
    measure: { kind: 'known', why: 'A configuration, not a motor skill. The app just needs telling.' },
    lessons: ['b1-308'],
  },

  // --- Technique ------------------------------------------------------------
  {
    id: 'technique.finger-placement',
    title: 'Positive finger placement',
    summary: 'Fingertips on, arched, close behind the fret, so every string rings.',
    family: 'technique',
    requires: [],
    measure: {
      kind: 'measurable',
      needs: 'per-string energy in the spectrum, which the 12-bin chromagram throws away',
      metric: 'strings ringing versus strings buzzing or muted, per strum',
    },
    lessons: ['b1-103', 'b1-113'],
  },
  {
    id: 'technique.stretches',
    title: 'Finger stretches',
    summary: 'The spider walk and friends: strength and independence in the fretting hand.',
    family: 'technique',
    requires: [],
    measure: { kind: 'timed', why: 'A warm-up. Minutes done is the whole measure and it is the right one.' },
    lessons: ['b1-401'],
  },
  {
    id: 'technique.anchor-fingers',
    title: 'Anchor fingers',
    summary: 'Keep the finger that two chords share planted through the change.',
    family: 'technique',
    requires: ['chord.A', 'chord.D'],
    measure: {
      kind: 'measured',
      drill: 'chord-rotation',
      metric: 'clean changes per minute around a ring of chords that share anchors',
    },
    lessons: ['b1-109', 'b1-202'],
  },
  {
    id: 'technique.alternate-picking',
    title: 'Alternate picking',
    summary: 'Down, up, down, up, without the hand stalling on the return.',
    family: 'technique',
    requires: ['technique.finger-placement'],
    measure: {
      kind: 'measurable',
      needs:
        'a shorter refractory than the 200 ms the timing analyser holds, since alternate picking ' +
        'puts successive attacks closer together than that',
      metric: 'evenness of the gap between successive attacks',
    },
    lessons: ['b1-601'],
  },
  {
    id: 'technique.string-accuracy',
    title: 'Strumming the right strings',
    summary: 'Start the strum on the chord’s bass string and stop where it should.',
    family: 'technique',
    requires: ['chord.A', 'chord.D'],
    measure: {
      kind: 'measurable',
      needs: 'per-string energy, same missing signal as finger placement',
      metric: 'unwanted low strings sounding, per strum',
    },
    lessons: ['b1-112'],
  },
  {
    id: 'technique.muting',
    title: 'Muting',
    summary: 'Silence the strings the chord does not want.',
    family: 'technique',
    requires: ['technique.string-accuracy'],
    measure: {
      kind: 'measurable',
      needs: 'per-string energy',
      metric: 'energy on the muted strings relative to the sounded ones',
    },
    lessons: ['b2-903'],
  },

  // --- Chords and changes ---------------------------------------------------
  ...chordSkills,
  {
    id: 'changes.one-minute',
    title: 'One minute changes',
    summary: 'Move between two chords as many times as you can in a minute.',
    family: 'changes',
    requires: ['chord.A', 'chord.D'],
    measure: {
      kind: 'measured',
      drill: 'one-minute-changes',
      metric: 'clean changes per minute, per pair',
    },
    lessons: ['b1-110', 'b1-206', 'b1-702'],
  },
  {
    id: 'changes.air',
    title: 'Air changes',
    summary: 'Move the shape in the air, in time, without a strum to hide behind.',
    family: 'changes',
    requires: ['changes.one-minute'],
    measure: {
      kind: 'measurable',
      needs: 'chord recognition without a strum to trigger on, which the onset gate currently requires',
      metric: 'shape arriving on the beat with no sound in between',
    },
    lessons: ['b1-703', 'b1-704'],
  },
  {
    id: 'changes.forced',
    title: 'Changes at tempo',
    summary: 'Change on the beat whether the hand is ready or not, and let it catch up.',
    family: 'changes',
    requires: ['changes.one-minute', 'rhythm.metronome'],
    measure: {
      kind: 'measured',
      drill: 'one-minute-changes',
      metric: 'changes per minute against a prescribed tempo',
    },
    lessons: ['b1-606'],
  },
  {
    id: 'chords.grips-review',
    title: 'The eight beginner grips',
    summary: 'All eight open chords available without thinking about them.',
    family: 'chords',
    requires: Object.keys(CHORD_LESSONS).map((c) => `chord.${c}`),
    measure: {
      kind: 'measured',
      drill: 'chord-trainer',
      metric: 'placements across the whole set in one session',
    },
    lessons: ['b1-701'],
    chords: Object.keys(CHORD_LESSONS),
  },

  // --- Rhythm ---------------------------------------------------------------
  {
    id: 'rhythm.foot',
    title: 'Tapping your foot',
    summary: 'Keep the pulse with your foot while your hands do something else.',
    family: 'rhythm',
    requires: [],
    measure: { kind: 'known', why: 'A foot is not in the microphone, and asking for one would be a worse drill.' },
    lessons: ['b1-203'],
  },
  {
    id: 'rhythm.on-the-beat',
    title: 'Strumming on the beat',
    summary: 'One down strum per beat, landing where the beat is.',
    family: 'rhythm',
    requires: ['chord.A', 'rhythm.foot'],
    // The one entry in this column that has moved from measurable to measured,
    // and it took the thing the header calls the standing rule with it: rhythm
    // was excluded because a single microphone hears the click and the guitar at
    // once. It still does. What changed is that they no longer have to be told
    // apart from one signal: the click is engineered to sit between 2 and 5 kHz
    // where a strummed guitar is thinnest, so the input is split into two bands
    // and each is detected on its own (src/audio/timing.ts). The beat is then
    // read from the click as it arrives in the room, which also removes any need
    // to trust the browser's own latency figure.
    measure: {
      kind: 'measured',
      drill: 'strum-timing',
      metric: 'beats struck within 50 ms of the click, and the spread around it',
    },
    lessons: ['b1-111', 'b1-204', 'b1-205'],
  },
  {
    id: 'rhythm.metronome',
    title: 'Playing to a metronome',
    summary: 'Hold a tempo you did not choose.',
    family: 'rhythm',
    requires: ['rhythm.on-the-beat'],
    // Both halves of this are on the results card: whether the playing sits
    // ahead of or behind the click, and how wide it is around wherever it sits.
    // Deliberately not claiming more: what is measured is a block at one tempo,
    // so "holding a tempo you did not choose" is evidenced by the score at the
    // tempo the drill prescribed and not by anything about tempo changes inside
    // a block, which the drill restarts rather than measures across.
    measure: {
      kind: 'measured',
      drill: 'strum-timing',
      metric: 'push or drag against the click, and the spread around it, per block',
    },
    lessons: ['b1-403'],
  },
  {
    id: 'rhythm.up-strums',
    title: 'Up strums',
    summary: 'Strum back up between the beats without losing the down.',
    family: 'rhythm',
    requires: ['rhythm.on-the-beat'],
    measure: {
      kind: 'measurable',
      needs: 'attack timing plus direction, since an up strum is an onset at an eighth position',
      metric: 'attacks landing on the "and" rather than near it',
    },
    lessons: ['b1-305', 'b1-306'],
  },
  {
    id: 'rhythm.patterns',
    title: 'Strumming patterns',
    summary: 'A written pattern played as written, at a tempo you can hold.',
    family: 'rhythm',
    requires: ['rhythm.up-strums'],
    measure: {
      kind: 'measurable',
      needs:
        'up strums, and then a matcher that reads a written pattern as expected positions ' +
        'on the beat grid the timing drill already fits',
      metric: 'attacks matched to the pattern, misses and extras counted separately',
    },
    lessons: ['b1-307', 'b1-404', 'b1-502', 'b1-503'],
  },
  {
    id: 'rhythm.six-eight',
    title: '6/8 feel',
    summary: 'Counting and strumming in six rather than four.',
    family: 'rhythm',
    requires: ['rhythm.patterns', 'theory.time-signatures'],
    measure: {
      kind: 'measurable',
      needs: 'the pattern matcher above, in a compound meter',
      metric: 'attacks matched to the pattern',
    },
    lessons: ['b1-604'],
  },
  {
    id: 'rhythm.dynamics',
    title: 'Dynamics',
    summary: 'Play louder and quieter on purpose instead of at one volume.',
    family: 'rhythm',
    requires: ['rhythm.patterns'],
    measure: {
      kind: 'measurable',
      needs:
        'nothing new: the timing analyser already reports how far each attack rose, ' +
        'so this is a component and a stored number rather than an algorithm',
      metric: 'spread of attack loudness across a block',
    },
    lessons: ['b1-705', 'b1-706'],
  },

  // --- Riffs and songs ------------------------------------------------------
  {
    id: 'riffs.single-note',
    title: 'Single-note riffs',
    summary: 'Play a written line one note at a time, in order, in time.',
    family: 'riffs',
    requires: ['technique.finger-placement', 'theory.tab'],
    measure: {
      kind: 'measurable',
      needs:
        'nothing new: the tuner shipped a monophonic pitch detector accurate to a fraction of a cent ' +
        'and the timing drill shipped a beat grid, so a note sequence and its timing can both be ' +
        'followed. It needs a component, not an algorithm',
      metric: 'notes hit in order, and each one’s timing against the click',
    },
    lessons: ['b1-207', 'b1-309', 'b1-406', 'b1-506'],
  },
  {
    id: 'songs.play-along',
    title: 'Playing along',
    summary: 'Keep up with a real recording from start to finish.',
    family: 'songs',
    requires: ['rhythm.patterns', 'changes.one-minute'],
    measure: {
      kind: 'timed',
      why: 'Deliberate. Grading someone against a record they are enjoying is the fastest way to make them stop.',
    },
    lessons: ['b1-114', 'b1-208', 'b1-310', 'b1-407', 'b1-507', 'b1-607'],
  },
  {
    id: 'songs.memorise',
    title: 'Playing from memory',
    summary: 'Get through a song without reading anything.',
    family: 'songs',
    requires: ['songs.play-along'],
    measure: { kind: 'timed', why: 'Whether you needed the chart is something only you know.' },
    lessons: ['b1-707'],
  },

  // --- Knowledge ------------------------------------------------------------
  {
    id: 'theory.chord-boxes',
    title: 'Reading chord boxes',
    summary: 'Turn a chord diagram into a hand shape.',
    family: 'theory',
    requires: [],
    measure: { kind: 'known', why: 'Reading, not playing. A quiz could check it; a microphone cannot.' },
    lessons: ['b1-104'],
  },
  {
    id: 'theory.tab',
    title: 'Reading tab',
    summary: 'Turn six lines and some numbers into notes on the neck.',
    family: 'theory',
    requires: [],
    measure: { kind: 'known', why: 'Reading, not playing.' },
    lessons: ['b1-405'],
  },
  {
    id: 'theory.time-signatures',
    title: 'Time signatures',
    summary: 'Know what the numbers mean and how many beats you are counting.',
    family: 'theory',
    requires: [],
    measure: { kind: 'known', why: 'Knowledge.' },
    lessons: ['b1-603'],
  },
  {
    id: 'theory.note-names',
    title: 'Note names',
    summary: 'Put a finger on a named note, fast, anywhere on the neck.',
    family: 'theory',
    requires: [],
    // This used to read "Knowledge. A naming quiz would work; listening would
    // not", and the second half was wrong. Reciting the twelve names is not the
    // skill that barre roots, CAGED and every scale shape actually draw on;
    // finding a named note on the neck quickly is, and that is a playing action
    // with a pitch on the end of it. So it is measured.
    //
    // The metric says precisely what was and was not settled. A pitch does not
    // carry the string it came off, so the app confirms the note and its octave
    // and never the finger. See src/lib/noteFinder.ts.
    measure: {
      kind: 'measured',
      drill: 'note-finder',
      metric: 'Notes found a minute. The prompt names a position and the pitch that position makes is heard back; which string it came off is not something a microphone can settle.',
    },
    lessons: ['b1-504', 'b1-605'],
  },
  {
    id: 'theory.minor-chords',
    title: 'What minor chords are',
    summary: 'Why some chords sound sad, and what makes them minor.',
    family: 'theory',
    requires: [],
    measure: { kind: 'known', why: 'Knowledge.' },
    lessons: ['b1-301'],
  },
  {
    id: 'ear.training',
    title: 'Ear training',
    summary: 'Recognise what you are hearing without being told.',
    family: 'ear',
    requires: [],
    measure: {
      kind: 'known',
      why: 'The app would have to play and ask, not listen. A different kind of drill entirely.',
    },
    lessons: ['b1-708'],
  },
];

export const ALL_SKILLS: readonly Skill[] = SKILLS;

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

export const getSkill = (id: string): Skill | null => BY_ID.get(id) ?? null;

/** Skills that involve a given chord, e.g. every drill that would exercise Dm. */
export const skillsForChord = (chord: string): Skill[] =>
  SKILLS.filter((s) => s.chords?.includes(chord));

/** Skills a lesson introduces or drills. */
export const skillsForLesson = (code: string): Skill[] =>
  SKILLS.filter((s) => s.lessons.includes(code));

/**
 * Everything `id` depends on, transitively, nearest first.
 * Returns an empty list for an unknown id rather than throwing: the taxonomy is
 * data and a caller holding a stale id should degrade, not crash.
 */
export function prerequisitesOf(id: string): Skill[] {
  const out: Skill[] = [];
  const seen = new Set<string>([id]);
  let frontier = getSkill(id)?.requires ?? [];
  while (frontier.length) {
    const next: string[] = [];
    for (const req of frontier) {
      if (seen.has(req)) continue;
      seen.add(req);
      const skill = getSkill(req);
      if (!skill) continue;
      out.push(skill);
      next.push(...skill.requires);
    }
    frontier = next;
  }
  return out;
}

/** How much of the taxonomy the app can actually put a number on today. */
export function capabilitySummary(): Record<SkillMeasure['kind'], number> {
  const counts: Record<SkillMeasure['kind'], number> = {
    measured: 0,
    measurable: 0,
    timed: 0,
    known: 0,
  };
  for (const skill of SKILLS) counts[skill.measure.kind] += 1;
  return counts;
}
