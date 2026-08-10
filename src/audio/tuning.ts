// Musical arithmetic for the tuner. Pure functions over MIDI note numbers and
// frequencies, with no audio or DOM dependency, so the maths is testable on its
// own and the same helpers can back chord diagrams and capo handling later.

export const A4_MIDI = 69;
export const A4_HZ = 440;

// Sharps rather than flats: every guitar tuner ever made reads in sharps, and
// disagreeing with that costs trust for no gain.
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Within this many cents of target the note counts as tuned. */
export const IN_TUNE_CENTS = 4;
/** Within this, close enough that the display should already feel encouraging. */
export const NEAR_CENTS = 15;
/** How far from a string a reading may sit and still be attributed to it. */
const STRING_MATCH_CENTS = 250;

export function midiToHz(midi: number, a4Hz = A4_HZ): number {
  return a4Hz * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function hzToMidiFloat(hz: number, a4Hz = A4_HZ): number {
  return A4_MIDI + 12 * Math.log2(hz / a4Hz);
}

export function centsBetween(hz: number, targetHz: number): number {
  return 1200 * Math.log2(hz / targetHz);
}

export interface NoteName {
  name: string;
  octave: number;
}

export function midiToName(midi: number): NoteName {
  // Scientific pitch notation: MIDI 60 is C4, so the octave boundary is at C.
  const index = ((midi % 12) + 12) % 12;
  return { name: NOTE_NAMES[index], octave: Math.floor(midi / 12) - 1 };
}

export interface PitchReading {
  hz: number;
  /** Nearest equal-tempered note. */
  midi: number;
  name: string;
  octave: number;
  targetHz: number;
  /** Signed distance to that note, in cents. Always within [-50, 50]. */
  cents: number;
}

/** Chromatic reading: what note is this, and how far off. */
export function readPitch(hz: number, a4Hz = A4_HZ): PitchReading {
  const exact = hzToMidiFloat(hz, a4Hz);
  const midi = Math.round(exact);
  const { name, octave } = midiToName(midi);
  return {
    hz,
    midi,
    name,
    octave,
    targetHz: midiToHz(midi, a4Hz),
    cents: (exact - midi) * 100,
  };
}

export interface TuningString {
  /** Stable key: the string's position, 6 = lowest/thickest. */
  position: number;
  midi: number;
  name: string;
  octave: number;
  /**
   * What a person calls this string out loud: "low E", "A", "high E".
   *
   * Standard tuning has two E strings, and "E is in tune" while the other E is
   * the one being asked for is the sentence that made the tuner feel broken.
   * Scientific octaves would disambiguate and mean nothing to a beginner, so the
   * words a teacher actually uses are carried on the string itself.
   */
  label: string;
}

export interface Tuning {
  id: string;
  name: string;
  /** One line the user can act on, not a description of the notes. */
  note: string;
  /** Low (6th) to high (1st). */
  strings: TuningString[];
}

function buildStrings(midis: number[]): TuningString[] {
  const named = midis.map((midi, i) => ({
    position: midis.length - i,
    midi,
    ...midiToName(midi),
  }));

  // Only strings that share a letter need telling apart, and only two of them
  // can be told apart by "low" and "high". Where a tuning repeats a letter three
  // times (open G has three Ds), the string's number is the one label that stays
  // unambiguous, so that is what those get.
  const shared = new Map<string, number[]>();
  for (const s of named) shared.set(s.name, [...(shared.get(s.name) ?? []), s.position]);

  return named.map((s) => {
    const others = shared.get(s.name);
    if (!others || others.length === 1) return { ...s, label: s.name };
    if (others.length === 2) {
      const lowest = Math.max(...others);
      return { ...s, label: `${s.position === lowest ? 'low' : 'high'} ${s.name}` };
    }
    return { ...s, label: `${ordinal(s.position)} string, ${s.name}` };
  });
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'] as const;

function ordinal(position: number): string {
  return ORDINALS[position - 1] ?? `${position}th`;
}

export const TUNINGS: Tuning[] = [
  {
    id: 'standard',
    name: 'Standard',
    note: 'E A D G B E. What almost everything is written for.',
    strings: buildStrings([40, 45, 50, 55, 59, 64]),
  },
  {
    id: 'drop-d',
    name: 'Drop D',
    note: 'Standard with the low E dropped a tone. Power chords on one finger.',
    strings: buildStrings([38, 45, 50, 55, 59, 64]),
  },
  {
    id: 'half-step-down',
    name: 'Half step down',
    note: 'Everything a semitone flat. Easier on the fingers and the voice.',
    strings: buildStrings([39, 44, 49, 54, 58, 63]),
  },
  {
    id: 'open-g',
    name: 'Open G',
    note: 'Strum it open and you get G. Slide and blues territory.',
    strings: buildStrings([38, 43, 50, 55, 59, 62]),
  },
  {
    id: 'dadgad',
    name: 'DADGAD',
    note: 'Suspended and ringing. Folk, Celtic, and film-score air.',
    strings: buildStrings([38, 45, 50, 55, 57, 62]),
  },
];

export const DEFAULT_TUNING_ID = 'standard';

export function getTuning(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

export interface StringMatch {
  string: TuningString;
  cents: number;
}

/**
 * Which string of this tuning is being played, and how far off it is.
 *
 * Inside the instrument's range this always answers, because adjacent strings
 * sit at most 500 cents apart and so something is always within the window —
 * a badly sharp A string should still be called the A string. The window's only
 * job is to refuse pitches outside the range entirely, where the honest answer
 * is "that is not one of these six strings" rather than a nearest guess. How far
 * off a matched string is, and whether that is worth warning about, is the
 * caller's call from `cents`.
 */
export function nearestString(
  hz: number,
  tuning: Tuning,
  a4Hz = A4_HZ,
): StringMatch | null {
  let best: StringMatch | null = null;
  for (const string of tuning.strings) {
    const cents = centsBetween(hz, midiToHz(string.midi, a4Hz));
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { string, cents };
  }
  if (!best || Math.abs(best.cents) > STRING_MATCH_CENTS) return null;
  return best;
}

/** Distance to one specific string, for when the user has locked onto it. */
export function matchString(
  hz: number,
  string: TuningString,
  a4Hz = A4_HZ,
): StringMatch {
  return { string, cents: centsBetween(hz, midiToHz(string.midi, a4Hz)) };
}
