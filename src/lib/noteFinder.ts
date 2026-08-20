// Finding a named note on the neck, and what the app is entitled to say about it.
//
// THE CORRECTION THIS MAKES. src/data/skills.ts used to file note names as
// `known` on the grounds that "a naming quiz would work; listening would not".
// The second half of that is wrong. Reciting the names is not the skill; putting
// a finger on a named note quickly is, and that is a playing action with a pitch
// on the end of it. So the app calls a note, the player plays it, and the pitch
// detector confirms it.
//
// SHOWN, THEN RECALLED. This started life as a test of knowledge the player did
// not have. Rung one named a note, drew a blank neck and started a clock, which
// is a wall rather than a drill for anyone who has not already learnt where the
// naturals are. A position nobody has ever recalled is therefore lit on the neck
// and simply played; only once it has come back from memory is it asked with
// nothing drawn, and a failed recall lights it again. The two are different
// facts about a player and are kept apart everywhere: `found` counts recalls and
// nothing else, `shown` counts placements, and `positionStanding` reads only the
// first of them.
//
// WHAT THE MICROPHONE CAN AND CANNOT SETTLE. A pitch is a frequency, and a
// frequency does not carry the string it came off: C at the third fret of the A
// string and C at the eighth fret of the low E are the same 130.81 Hz and no
// analysis of the sound will ever separate them. What a pitch does settle,
// exactly, is the note and its octave, and on one named string a note and its
// octave belong to exactly one fret. So the honest claim is:
//
//   the prompt named a position, and the pitch that position makes came back.
//
// It is not "you played it there". Everything downstream is written to that
// standard: `judge` compares MIDI numbers rather than pitch classes wherever the
// prompt named a string, the neck map records the position that was *asked for*,
// and the two prompt forms where the app was never told where to look
// (`free`, `echo`) deliberately write nothing to the map at all.
//
// THE LADDER. Open-position naturals is a week. This drill has to still be worth
// opening in Grade 5, so the rungs run from the two lowest strings in first
// position to the whole neck with accidentals, then to finding a note with no
// string named at all, then to finding the same note somewhere other than where
// it was shown. Which rung a session runs at comes from that rung's own history
// and never from ambition: exactly the rule lib/tempo.ts applies to BPM.

import { pitchClass, noteAtFret, fretOf, type PitchClass } from './noteCircle';
import { DEFAULT_TUNING_ID, getTuning } from '../audio/tuning';

const STANDARD = getTuning(DEFAULT_TUNING_ID);

/** Open-string MIDI by string position, 6 being the thickest. */
const OPEN_MIDI: ReadonlyMap<number, number> = new Map(
  STANDARD.strings.map((s) => [s.position, s.midi]),
);

/** Thickest first, which is how the strings are stacked on the instrument. */
export const STRING_POSITIONS: readonly number[] = [6, 5, 4, 3, 2, 1];

/** The highest fret any rung reaches. Twelve, because the thirteenth is the first again. */
export const TOP_FRET = 12;

export function openMidiOf(stringPosition: number): number {
  const midi = OPEN_MIDI.get(stringPosition);
  if (midi === undefined) {
    throw new Error(`Standard tuning has no string at position ${stringPosition}.`);
  }
  return midi;
}

/** MIDI of one position on the neck. */
export const midiAt = (stringPosition: number, fret: number): number =>
  openMidiOf(stringPosition) + fret;

/** The seven letters, which is where every player starts. */
export const NATURALS: readonly PitchClass[] = [9, 11, 0, 2, 4, 5, 7];
/**
 * The letters the open strings sound, which is where the ladder starts.
 *
 * Read off the tuning rather than written out, so a tuning with a different set
 * of open notes asks about the notes it actually has.
 */
export const OPEN_STRING_NOTES: readonly PitchClass[] = [
  ...new Set(STANDARD.strings.map((s) => pitchClass(s.midi))),
];
/** All twelve, in circle order from A. */
export const ALL_NOTES: readonly PitchClass[] = Array.from({ length: 12 }, (_, i) => pitchClass(9 + i));

/**
 * How the prompt is put, which is not a cosmetic choice.
 *
 * - `string` names the note and the string. The answer is a position, and the
 *   pitch that comes back settles it exactly.
 * - `free` names the note and nothing else. The answer is any position on the
 *   neck that makes that note, so only the pitch class can be checked, and the
 *   app never learns where the hand went.
 * - `echo` shows a position and no letter. To answer it you have to name the
 *   note in your head and then find it somewhere else, which is the reverse
 *   direction: reading a position back into a name. A pitch that matches the
 *   class and is not the pitch that was shown is the proof.
 */
export type PromptForm = 'string' | 'free' | 'echo';

export interface FinderRung {
  /**
   * Stable, and part of every key a run of this rung is filed under. Renaming
   * one would orphan its history, so these are never edited.
   */
  id: string;
  /** What a person would call it. */
  label: string;
  form: PromptForm;
  /** Pitch classes this rung may call. */
  notes: readonly PitchClass[];
  /** String positions its prompts may name. */
  strings: readonly number[];
  minFret: number;
  maxFret: number;
  /** A find inside this is what the rung is asking for. */
  budgetMs: number;
  /**
   * True on the one rung a course lesson actually teaches.
   *
   * Which lesson is deliberately not written here. src/data/skills.ts is where
   * this app records which lessons cover a thing, and the drill reads it from
   * there; a second copy of that fact would be a second thing to keep true.
   * Every rung without this flag is this product's own ladder and is presented
   * as such, because the app does not assert a fit with a course that has not
   * asked for the thing yet.
   */
  taught?: boolean;
}

/**
 * The ladder, lowest first.
 *
 * WHERE THE BOTTOM OF IT CAME FROM. This started at "naturals on the low two
 * strings", and that was a sequencing mistake with a real cost: the first player
 * to use it said, correctly, that he did not know where the notes were. The
 * course teaches the system of note names in Grade 1 Module 5 and the six open
 * strings by name in Module 6, and nothing about the rest of the neck until well
 * after that. A drill whose first question is "where is C on the A string" is
 * therefore ahead of the course, and the two rungs below that question are the
 * fix: the open strings, which is exactly the Module 6 lesson, then the naturals
 * on one string, then two strings, then the neck.
 *
 * Above that it is ordered by what it costs a hand rather than by how much of
 * the neck it covers: the naturals below the fifth fret are the ones a beginner
 * needs for chord roots, the accidentals come next because they are the same map
 * with the gaps filled, and the whole neck only opens once first position is
 * quick. The last two rungs stop naming the string, which is where the exercise
 * turns from "where is C on the A string" into "where is C", the question barre
 * chords, CAGED and every scale shape actually ask.
 *
 * Ids never change. Inserting rungs below an existing one moves where it sits on
 * the ladder but not what its history is filed under, so nothing recorded before
 * this is orphaned. A player who had cleared a rung and now finds two easier ones
 * underneath is taken back down to them, which is the ladder's own rule working:
 * it never runs above a pace already proven, and three quick runs clear a rung.
 */
export const RUNGS: readonly FinderRung[] = [
  {
    id: 'open-strings',
    label: 'The six open strings',
    form: 'string',
    notes: OPEN_STRING_NOTES,
    strings: STRING_POSITIONS,
    minFret: 0,
    maxFret: 0,
    budgetMs: 10000,
    taught: true,
  },
  {
    // One string, and the one whose notes a player uses first: the low E carries
    // the root of every E-shape barre chord and half of what the first position
    // is built from. Reaching the fifth fret rather than the third because four
    // naturals on one string is a rung and three is a rota.
    id: 'low-e-naturals',
    label: 'Naturals on the low E',
    form: 'string',
    notes: NATURALS,
    strings: [6],
    minFret: 0,
    maxFret: 5,
    budgetMs: 9000,
  },
  {
    id: 'low-naturals',
    label: 'Naturals, low two strings',
    form: 'string',
    notes: NATURALS,
    strings: [6, 5],
    minFret: 0,
    maxFret: 3,
    budgetMs: 9000,
  },
  {
    id: 'open-naturals',
    label: 'Naturals, first position',
    form: 'string',
    notes: NATURALS,
    strings: STRING_POSITIONS,
    minFret: 0,
    maxFret: 3,
    budgetMs: 8000,
  },
  {
    id: 'naturals-five',
    label: 'Naturals to the fifth',
    form: 'string',
    notes: NATURALS,
    strings: STRING_POSITIONS,
    minFret: 0,
    maxFret: 5,
    budgetMs: 7000,
  },
  {
    id: 'accidentals-five',
    label: 'Sharps and flats to the fifth',
    form: 'string',
    notes: ALL_NOTES,
    strings: STRING_POSITIONS,
    minFret: 0,
    maxFret: 5,
    budgetMs: 7000,
  },
  {
    id: 'naturals-high',
    label: 'Naturals above the fifth',
    form: 'string',
    notes: NATURALS,
    strings: STRING_POSITIONS,
    minFret: 5,
    maxFret: TOP_FRET,
    budgetMs: 6000,
  },
  {
    id: 'whole-neck',
    label: 'The whole neck',
    form: 'string',
    notes: ALL_NOTES,
    strings: STRING_POSITIONS,
    minFret: 0,
    maxFret: TOP_FRET,
    budgetMs: 6000,
  },
  {
    id: 'any-string',
    label: 'Any string',
    form: 'free',
    notes: ALL_NOTES,
    strings: STRING_POSITIONS,
    minFret: 0,
    maxFret: TOP_FRET,
    budgetMs: 5000,
  },
  {
    id: 'octaves',
    label: 'The same note, elsewhere',
    form: 'echo',
    notes: ALL_NOTES,
    strings: STRING_POSITIONS,
    minFret: 0,
    maxFret: TOP_FRET,
    budgetMs: 7000,
  },
];

const RUNG_BY_ID = new Map(RUNGS.map((r) => [r.id, r]));

export const getRung = (id: string): FinderRung | null => RUNG_BY_ID.get(id) ?? null;

/** Where a rung sits on the ladder, counting from one. */
export const rungNumber = (id: string): number => RUNGS.findIndex((r) => r.id === id) + 1;

export interface Position {
  /** 6 is the thickest string. */
  stringPosition: number;
  fret: number;
  midi: number;
  pc: PitchClass;
}

/** Every position a rung is allowed to call. */
export function rungPositions(rung: FinderRung): Position[] {
  const out: Position[] = [];
  for (const stringPosition of rung.strings) {
    const open = openMidiOf(stringPosition);
    for (let fret = rung.minFret; fret <= rung.maxFret; fret += 1) {
      const pc = noteAtFret(open, fret);
      if (!rung.notes.includes(pc)) continue;
      out.push({ stringPosition, fret, midi: open + fret, pc });
    }
  }
  return out;
}

/** Every position on the neck, up to the twelfth fret, that makes this note. */
export function positionsOf(pc: PitchClass): Position[] {
  const out: Position[] = [];
  for (const stringPosition of STRING_POSITIONS) {
    const open = openMidiOf(stringPosition);
    const first = fretOf(open, pc);
    for (let fret = first; fret <= TOP_FRET; fret += 12) {
      out.push({ stringPosition, fret, midi: open + fret, pc });
    }
  }
  return out;
}

/** Whether this exact pitch exists anywhere on the neck below the twelfth fret. */
export function reachable(midi: number): boolean {
  return STRING_POSITIONS.some((p) => {
    const fret = midi - openMidiOf(p);
    return fret >= 0 && fret <= TOP_FRET;
  });
}

/** Which fret of one string makes this pitch, or null when none of it does. */
export function fretOn(stringPosition: number, midi: number): number | null {
  const fret = midi - openMidiOf(stringPosition);
  return fret >= 0 && fret <= TOP_FRET ? fret : null;
}

/** Frets a drawn neck holds however narrow the question is. Fewer is not a neck. */
const MIN_DRAWN_FRETS = 4;

/**
 * The stretch of neck a rung's questions live on, plus a fret either side.
 *
 * The drill used to draw all twelve frets whatever it was asking, so the first
 * rung's four-fret world was a quarter of a picture nobody could read from a
 * propped laptop. Drawing the window instead makes a fret a target the size of a
 * fingertip. The margin is there so the window still reads as part of a neck
 * rather than as a diagram of nothing in particular, and the floor under it is
 * for the open-strings rung, whose questions all live at the nut and which drawn
 * to its own width would be two enormous cells rather than a fretboard.
 */
export function rungWindow(rung: FinderRung): { from: number; to: number } {
  const from = Math.max(0, rung.minFret - 1);
  return {
    from,
    to: Math.min(TOP_FRET, Math.max(rung.maxFret + 1, from + MIN_DRAWN_FRETS - 1)),
  };
}

// --- The neck map ---------------------------------------------------------
//
// One entry per position the drill has asked for and been answered at. This is
// the thing that fills in over months, and the note circle draws it.

export interface NoteFind {
  /**
   * Times this position was recalled: asked with nothing drawn on the neck, and
   * the note it makes came back. A placement made against a lit answer is never
   * counted here, which is the whole of what keeps the two apart.
   */
  found: number;
  /** Fastest of those, in milliseconds. Zero until something has been recalled. */
  bestMs: number;
  /**
   * The most recent times, oldest first, capped at what the standing reads.
   *
   * Kept rather than averaged because a standing that can only go up is not a
   * standing. Three quick finds and then a slow one has to read as slower, and
   * a mean over months cannot move far enough to say so.
   */
  recentMs: number[];
  /** Epoch ms of the most recent find here, of either kind. */
  at: number;
  /**
   * Times this position was played with its answer lit on the neck.
   *
   * Absent on everything recorded before the drill started showing answers, and
   * absent is exactly zero rather than unknown: nothing was ever lit then, so
   * every one of those finds was made from memory.
   */
  shown?: number;
}

export type NoteMap = Record<string, NoteFind>;

/** `6:3` is the third fret of the thickest string. */
export const positionKey = (stringPosition: number, fret: number): string =>
  `${stringPosition}:${fret}`;

export function parsePositionKey(key: string): { stringPosition: number; fret: number } | null {
  const at = key.indexOf(':');
  if (at <= 0) return null;
  const stringPosition = Number(key.slice(0, at));
  const fret = Number(key.slice(at + 1));
  if (!Number.isInteger(stringPosition) || !STRING_POSITIONS.includes(stringPosition)) return null;
  if (!Number.isInteger(fret) || fret < 0 || fret > TOP_FRET) return null;
  return { stringPosition, fret };
}

/**
 * A find inside this counts as quick, wherever it was asked.
 *
 * One number rather than the asking rung's own budget, because the map is a
 * long-term record read years apart and a mark whose meaning moved with the rung
 * would be unreadable: a position drawn as quick in Grade 1 and plain in Grade 5
 * would be reporting a change in the question as a change in the player.
 */
export const QUICK_MS = 5000;
/** How many recent finds have to be quick before a position reads as quick. */
export const QUICK_RUNS = 3;

export type PositionStanding = 'unasked' | 'found' | 'quick';

/**
 * Where one position stands, as a matter of recall.
 *
 * Reads `found` and nothing else, so a position played a dozen times against a
 * lit answer still stands at `unasked`. That is not a technicality: the whole
 * value of this record is that it says what the player can do from memory, and a
 * mark earned by copying a light would make it say something else.
 *
 * `unasked` is not a failure and must never be drawn as one. It is the app
 * saying nothing, which is the only honest thing to say about a fret it has
 * never had a recall out of.
 */
export function positionStanding(find: NoteFind | undefined): PositionStanding {
  if (!find || find.found === 0) return 'unasked';
  const recent = find.recentMs.slice(-QUICK_RUNS);
  if (recent.length < QUICK_RUNS) return 'found';
  return recent.every((ms) => ms <= QUICK_MS) ? 'quick' : 'found';
}

/** Times this position has been played with its answer lit. */
export const timesShown = (find: NoteFind | undefined): number => find?.shown ?? 0;

/**
 * Whether the drill lights this position before asking for it.
 *
 * One recall retires the light for good; a failed recall brings it back for that
 * question only. Which makes the moment the light stops appearing a real
 * transition in what the player can do rather than an announcement about it.
 */
export const isShown = (find: NoteFind | undefined): boolean => !find || find.found === 0;

/**
 * One recall, folded into the map.
 *
 * Only ever called for a prompt that named a string and drew nothing. The other
 * two forms leave the map alone on purpose: the app was not told where to look,
 * so it has nothing true to write about a position.
 */
export function recordFind(
  map: NoteMap,
  stringPosition: number,
  fret: number,
  ms: number,
  at: number,
): NoteMap {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`A find cannot have taken ${ms} milliseconds.`);
  }
  const key = positionKey(stringPosition, fret);
  const previous = map[key];
  const recentMs = [...(previous?.recentMs ?? []), Math.round(ms)].slice(-QUICK_RUNS);
  const best = previous && previous.found > 0 ? previous.bestMs : Number.POSITIVE_INFINITY;
  return {
    ...map,
    [key]: {
      ...previous,
      found: (previous?.found ?? 0) + 1,
      bestMs: Math.min(best, Math.round(ms)),
      recentMs,
      at,
    },
  };
}

/**
 * One position played while its answer was lit.
 *
 * Carries no time, because there is no time worth carrying: how fast a hand
 * reaches a fret it is being pointed at says nothing about whether the player
 * knows where that fret is. It touches nothing `positionStanding` reads.
 */
export function recordShown(
  map: NoteMap,
  stringPosition: number,
  fret: number,
  at: number,
): NoteMap {
  const key = positionKey(stringPosition, fret);
  const previous = map[key];
  return {
    ...map,
    [key]: {
      found: previous?.found ?? 0,
      bestMs: previous?.bestMs ?? 0,
      recentMs: previous?.recentMs ?? [],
      shown: timesShown(previous) + 1,
      at,
    },
  };
}

/**
 * Two maps of the same neck, folded into one.
 *
 * Devices practise independently, so each holds finds the other has never seen
 * and neither copy is a superset. The later entry wins per position rather than
 * the later account: a phone that synced yesterday still knows something true
 * about the frets it was the one that asked.
 */
export function mergeNoteMaps(local: NoteMap | undefined, remote: NoteMap | undefined): NoteMap {
  if (!remote) return local ?? {};
  if (!local) return remote;
  const merged: NoteMap = { ...local };
  for (const [key, find] of Object.entries(remote)) {
    const mine = merged[key];
    if (!mine || find.at > mine.at) merged[key] = find;
  }
  return merged;
}

// --- The prompt -----------------------------------------------------------

export interface FinderPrompt {
  form: PromptForm;
  /** The note being asked for. */
  pc: PitchClass;
  /**
   * The position the prompt was built from: the answer for `string`, the note
   * shown for `echo`, and one of the places the note lives for `free`.
   *
   * Always set, because the drawing needs somewhere to put the answer when it
   * is finally given. Whether the *player* was told it is `namesString(form)`,
   * and that, not this field, is what decides whether a find may be filed
   * against a position.
   */
  stringPosition: number;
  fret: number;
  /** MIDI of that position. */
  midi: number;
  rungId: string;
}

/**
 * Whether the prompt told the player which string to look on.
 *
 * The one question that decides what a correct answer is entitled to be written
 * down as. Told, and the pitch that comes back settles a single fret; not told,
 * and the app knows a note was found and has no idea where, so the neck map is
 * left alone.
 */
export const namesString = (form: PromptForm): boolean => form === 'string';

/**
 * How hard the drill leans on a position it has not settled.
 *
 * Weighted rather than sorted, for the reason the pattern deck is: drilling only
 * the worst three would never ask a quick position again, and a position that is
 * never asked cannot be shown to have gone cold.
 */
const WEIGHT: Record<PositionStanding, number> = { unasked: 6, found: 3, quick: 1 };
/**
 * A position that has been lit and played but never recalled.
 *
 * Between the two: seeing where a note lives is worth something and is worth
 * asking about again soon, but it is not the recall the rung is after, so it
 * still outweighs everything that has come back from memory.
 */
const WEIGHT_SHOWN = 4;

const weightOf = (find: NoteFind | undefined): number => {
  const standing = positionStanding(find);
  if (standing === 'unasked' && timesShown(find) > 0) return WEIGHT_SHOWN;
  return WEIGHT[standing];
};

/**
 * What to ask next, decided by the player's own history at this rung.
 *
 * Deterministic in `roll` so the choice can be stated in a test rather than
 * waited for. `previous` is never repeated: two identical prompts running is the
 * drill asking a question it has just answered.
 */
export function nextPrompt(
  rung: FinderRung,
  map: NoteMap,
  previous: FinderPrompt | null,
  roll: number,
): FinderPrompt | null {
  const all = rungPositions(rung);
  if (!all.length) return null;
  const eligible = all.filter(
    (p) => !previous || p.stringPosition !== previous.stringPosition || p.fret !== previous.fret,
  );
  const pool = eligible.length ? eligible : all;

  const weights = pool.map((p) => weightOf(map[positionKey(p.stringPosition, p.fret)]));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let cursor = Math.min(Math.max(roll, 0), 0.999999) * total;
  let chosen = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i += 1) {
    cursor -= weights[i];
    if (cursor < 0) {
      chosen = pool[i];
      break;
    }
  }

  return {
    form: rung.form,
    pc: chosen.pc,
    stringPosition: chosen.stringPosition,
    fret: chosen.fret,
    midi: chosen.midi,
    rungId: rung.id,
  };
}

/**
 * What arrived, judged against what was asked.
 *
 * `right` on a `string` prompt is an exact MIDI match and nothing looser, which
 * is the whole of the drill's honesty: the same letter an octave away is a
 * different position and is reported as one.
 *
 * THE LOOSENING THAT WAS CONSIDERED AND REJECTED. A rule accepting the pitch
 * class wherever the rung's own frets left one place the note could be was built
 * here and then taken out again. The case for it was that a monophonic estimator
 * mis-octaves a low string, so refusing an octave-off reading would be the app
 * blaming the player for its own hearing. This estimator does not mis-octave:
 * tests/pitch.test.mjs asserts zero octave errors across the guitar range on
 * signals built to trip a naive detector, and src/audio/pitch.ts engineered that
 * out deliberately. Measured again while this was being written, over plucks
 * with no fundamental at all, quiet plucks, and inharmonic reverberant ones: not
 * one octave error in any of them.
 *
 * So the only thing the loosening would have bought is accepting the twelfth
 * fret when the nut was asked for, which is a wrong placement and not a misread.
 * A drill that cannot be failed measures nothing.
 */
export type FindOutcome =
  | { kind: 'right' }
  /** The letter is right and the octave is not, so it is a different fret. */
  | { kind: 'octave' }
  /** An `echo` answered with the very pitch that was shown. */
  | { kind: 'same' }
  | { kind: 'other' };

export function judge(prompt: FinderPrompt, midi: number): FindOutcome {
  const sameClass = pitchClass(midi) === prompt.pc;
  if (prompt.form === 'string') {
    if (midi === prompt.midi) return { kind: 'right' };
    return sameClass ? { kind: 'octave' } : { kind: 'other' };
  }
  if (prompt.form === 'free') {
    if (sameClass && reachable(midi)) return { kind: 'right' };
    return { kind: 'other' };
  }
  // echo
  if (!sameClass) return { kind: 'other' };
  if (midi === prompt.midi) return { kind: 'same' };
  return reachable(midi) ? { kind: 'right' } : { kind: 'other' };
}

// --- Where the player stands on the ladder --------------------------------

export type RungStanding = 'new' | 'learning' | 'clear';

/** Runs at a rung that have to hold before the next one opens. */
export const CLEAR_RUNS = 3;
/**
 * Finds a minute a run has to reach before it counts towards clearing a rung.
 *
 * Six, which is one find every ten seconds. Set below every rung's own budget on
 * purpose: the budget is the pace a single find is asked to arrive at, and a run
 * also contains the wrong answers, the reveals and the half second it takes to
 * hear a note die. A bar equal to the budget would mean no run ever cleared.
 */
export const CLEAR_FINDS_PER_MIN = 6;

export interface FinderRunRecord {
  /** YYYY-MM-DD. */
  date: string;
  /** Finds a minute, so runs of different lengths are one series. */
  findsPerMin: number;
  /** Median milliseconds a find took, or null on a run that found nothing. */
  medianMs: number | null;
}

/**
 * How a rung stands from the runs behind it.
 *
 * The three-run rule, the same one the pattern deck and lib/readiness.ts apply,
 * because it is the same claim: one good minute is a good minute and three in a
 * row is a skill. A run that dropped off the pace pulls the rung back to
 * learning, which is what makes this a standing rather than a score.
 */
export function rungStanding(
  runs: readonly FinderRunRecord[],
  rung: FinderRung,
): RungStanding {
  if (!runs.length) return 'new';
  const recent = runs.slice(-CLEAR_RUNS);
  if (recent.length < CLEAR_RUNS) return 'learning';
  const clear = recent.every(
    (r) => r.findsPerMin >= CLEAR_FINDS_PER_MIN && r.medianMs !== null && r.medianMs <= rung.budgetMs,
  );
  return clear ? 'clear' : 'learning';
}

/**
 * The rung today's session runs at.
 *
 * The lowest one not yet cleared, which is the same rule the metronome applies
 * to tempo: never above a pace the player has already proven. A rung that goes
 * soft therefore takes the session back down to it, and that is the intended
 * behaviour rather than a regression to work around.
 */
export function currentRung(history: Readonly<Record<string, readonly FinderRunRecord[]>>): FinderRung {
  for (const rung of RUNGS) {
    if (rungStanding(history[rung.id] ?? [], rung) !== 'clear') return rung;
  }
  return RUNGS[RUNGS.length - 1];
}

/** The median of a run's find times, or null when it found nothing. */
export function medianFindMs(times: readonly number[]): number | null {
  if (!times.length) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
