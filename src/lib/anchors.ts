// Whether two chords actually share a finger, read off the shapes.
//
// An anchor finger is Justin's term and it is a precise one: a finger that never
// leaves the string through the change. Same string, same fret, same finger, in
// both shapes. Nothing looser qualifies. Two shapes that happen to press the
// same fret with different fingers still require the hand to lift and re-place,
// which is the whole thing an anchor saves you.
//
// This exists because the routine builder asserted the technique instead of
// checking for it. It emitted a task called "Anchor changes", described as
// "rotate the ring, keeping the shared finger planted", for any three chords a
// learner had once the course had shown them the lesson. For the ring the app
// actually dealt first, A to D to E, there is no shared finger anywhere: A and D
// both press fret 2 of the G string but with different fingers, and E shares
// nothing with either. So the app was naming a technique the player could not
// perform on the shapes it had just handed them, which is the same class of
// error as reporting a number nobody measured.

import { getChordShape } from '../data/chordShapes';

export interface Anchor {
  /** String index, low E first, matching ChordShape.frets. */
  string: number;
  fret: number;
  /** 1 index, 2 middle, 3 ring, 4 little. */
  finger: number;
}

/** Fingers that stay exactly where they are between two shapes, low string first. */
export function anchorsBetween(from: string, to: string): Anchor[] {
  const a = getChordShape(from);
  const b = getChordShape(to);
  if (!a || !b || from === to) return [];
  const out: Anchor[] = [];
  for (let string = 0; string < a.frets.length; string++) {
    const fret = a.frets[string];
    const finger = a.fingers[string];
    // Open and muted strings are not anchors. Nothing is being held down, so
    // nothing is staying put.
    if (fret <= 0 || finger <= 0) continue;
    if (b.frets[string] !== fret || b.fingers[string] !== finger) continue;
    out.push({ string, fret, finger });
  }
  return out;
}

/**
 * The strongest anchored change inside a set of shapes, or null when there is
 * none.
 *
 * Strongest means the most fingers staying down, then the earlier pair in the
 * order given, so the answer does not depend on the order chords were ticked in.
 */
export function bestAnchoredPair(
  chords: readonly string[],
): { from: string; to: string; anchors: Anchor[] } | null {
  let best: { from: string; to: string; anchors: Anchor[] } | null = null;
  for (let i = 0; i < chords.length; i++) {
    for (let j = i + 1; j < chords.length; j++) {
      const anchors = anchorsBetween(chords[i], chords[j]);
      if (!anchors.length) continue;
      if (!best || anchors.length > best.anchors.length) {
        best = { from: chords[i], to: chords[j], anchors };
      }
    }
  }
  return best;
}

const FINGER_NAMES = ['', 'first', 'second', 'third', 'little'] as const;
/** Strings low to high, as a player names them. */
const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high E'] as const;

/**
 * What stays put, in the words a player would use.
 *
 * Names the finger and the string rather than a fret number, because that is
 * what you check while your hand is on the neck and your eyes are elsewhere.
 * Returned as a noun phrase with no sentence around it: the anchor belongs to
 * one change, and only the caller knows which change it is talking about. A
 * ring of three has an anchor on one of its legs and not on the other two, and
 * a sentence built here would have claimed it for all of them.
 */
export function describeAnchors(anchors: readonly Anchor[]): string {
  const named = anchors.map(
    (a) =>
      `your ${FINGER_NAMES[a.finger] ?? 'anchor'} finger on the ${STRING_NAMES[a.string] ?? 'same'} string`,
  );
  if (!named.length) return '';
  // "or" rather than "and": every call site so far puts this after "without",
  // where "and" reads as permission to lift one of them.
  return named.join(' or ');
}
