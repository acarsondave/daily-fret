// Where the fingers go. The app has always been able to name a chord and
// listen for it, but never to show it, so Chord Perfect said "place the shape"
// to a beginner who might not know the shape.
//
// Arrays run low E to high E, which is left to right in a standard chord box.
// -1 is a muted string, 0 is open. `fingers` is aligned with `frets`: 1 index,
// 2 middle, 3 ring, 4 little, 0 for open or muted.
//
// The fret window is derived in the diagram, not stored here: a shape that fits
// inside the first four frets is drawn against the nut, anything higher is drawn
// with a fret number. One less field to keep truthful.

export interface Barre {
  fret: number;
  /** Inclusive string indices the barre covers, low E first. */
  from: number;
  to: number;
  finger: number;
}

export interface ChordShape {
  name: string;
  frets: readonly number[];
  fingers: readonly number[];
  barre?: Barre;
  /** Shown under the diagram where the shape has a known sticking point. */
  tip?: string;
}

const SHAPES: ChordShape[] = [
  // The nine the detector can hear. These matter most: every listening drill
  // draws its targets from this set.
  { name: 'A', frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0],
    tip: 'Three fingers into one fret. Roll them back so the high E still rings.' },
  { name: 'Am', frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  { name: 'C', frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0],
    tip: 'Keep the ring finger arched or it deadens the open D.' },
  { name: 'D', frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  { name: 'Dm', frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  { name: 'E', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  { name: 'Em', frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  { name: 'G', frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3],
    tip: 'Middle finger on the low E leaves the hand ready for C.' },
  { name: 'F', frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1],
    barre: { fret: 1, from: 0, to: 5, finger: 1 },
    tip: 'The hard one. Fmaj7 is the same chord without the barre.' },

  // Everything else a beginner meets. Not detectable yet, but songs and later
  // modules name them, and a chord with no diagram is worse than no chord.
  { name: 'A7', frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  { name: 'Am7', frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  { name: 'Asus2', frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
  { name: 'Asus4', frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  { name: 'B7', frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
  { name: 'Bm', frets: [-1, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1],
    barre: { fret: 2, from: 1, to: 5, finger: 1 },
    tip: 'Barre only needs the A and high E strings clean. The rest is fingered.' },
  { name: 'C7', frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  { name: 'Cadd9', frets: [-1, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0] },
  { name: 'D7', frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  { name: 'Dm7', frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1],
    barre: { fret: 1, from: 4, to: 5, finger: 1 } },
  { name: 'Dsus2', frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 2, 0] },
  { name: 'Dsus4', frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },
  { name: 'E7', frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  { name: 'Em7', frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
  { name: 'Fmaj7', frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0],
    tip: 'F without the barre. Learn this first, then add the low strings.' },
  { name: 'G7', frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
];

const BY_NAME = new Map(SHAPES.map((s) => [s.name, s] as const));

export function getChordShape(name: string): ChordShape | null {
  return BY_NAME.get(name) ?? null;
}

export function hasChordShape(name: string): boolean {
  return BY_NAME.has(name);
}

export const CHORD_SHAPES: readonly ChordShape[] = SHAPES;

/** Frets a diagram draws. Four covers every open shape and every barre here. */
export const FRET_COUNT = 4;

export interface FretWindow {
  /** Lowest fret in view. */
  start: number;
  /** Whether the nut is in view, or a fret number is shown instead. */
  showNut: boolean;
}

/**
 * Which slice of the neck a shape needs.
 *
 * Anything reachable inside the first four frets is drawn against the nut,
 * because that is how a player reads an open shape. Higher up there is no nut to
 * draw, so the box slides to the lowest fretted note and says which fret that is.
 */
export function fretWindow(shape: ChordShape): FretWindow {
  const pressed = shape.frets.filter((f) => f > 0);
  if (!pressed.length) return { start: 1, showNut: true };
  if (Math.max(...pressed) <= FRET_COUNT) return { start: 1, showNut: true };
  return { start: Math.min(...pressed), showNut: false };
}
