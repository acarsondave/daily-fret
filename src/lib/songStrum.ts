// The strumming a song asks for, as something the pattern drill can deal.
//
// WHY THIS EXISTS. The owner learns a song by learning its strum first: drill
// the pattern until the hand owns it, and the song plays itself. That is how he
// got Old Faithful and 505, and it is the route he trusts. Up to now the app
// could not support it without him copying a pattern string into a task by hand
// every time, which is a chore he will do once and then stop doing. A song
// already knows its own strumming; this is the one function that turns that
// knowledge into a deck.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not make anything easier. The deck
// it returns goes through exactly the same matcher, the same four passes and the
// same standing rule as any deck the ladder deals, and a song's phrase is
// usually harder than the rung the player is on rather than kinder. The only
// thing that changes is which patterns are in front of them.

import type { Song } from '../data/songs';
import {
  EIGHTHS,
  SIXTEENTHS,
  parsePattern,
  writePattern,
  type SlotResolution,
} from './strumPattern';

/**
 * How long a song's strum block runs.
 *
 * Ninety seconds, against the three minutes the ladder block gets. A song deck
 * is usually one card, so there is no switching to test and no reason to hold
 * the block open past the point where the phrase has been round enough times to
 * be scored several times over: at any tempo the drill actually prescribes, this
 * is four or five goes at the phrase, each of them four passes long.
 *
 * It is also the block that sits between a full session and the song itself, and
 * a session that has already run twenty minutes cannot afford a second three
 * minute rhythm block before the part the player came for.
 */
export const SONG_STRUM_SECONDS = 90;

/**
 * The phrases this song asks the hand to own, in deck order.
 *
 * Written phrases first, because they are the ones somebody transcribed on
 * purpose. Failing that, the chart's own one-bar default, but only where the
 * matcher can actually read it: most `strum` fields in the catalogue are arrow
 * art for a chart cell ("DD" is two downs held across a bar) rather than a bar of
 * eighth-note slots, and handing one of those to the drill would file real runs
 * against a bar that does not exist.
 *
 * Anything the matcher refuses is dropped here rather than downstream, for the
 * reason `deckOf` gives: a deck of things that can be scored is the only deck
 * worth having.
 */
export function songStrumPatterns(song: Song | undefined): string[] {
  if (!song) return [];
  const written = (song.strumPatterns ?? [])
    // The grid travels with the string, because the string is the whole of what
    // reaches the drill and the history key. See `writePattern`.
    .map((s) => writePattern(s.pattern, s.slotsPerBeat ?? EIGHTHS))
    .filter((p) => parsePattern(p) !== null);
  if (written.length) return [...new Set(written)];
  return parsePattern(song.strum) !== null ? [song.strum] : [];
}

/**
 * Whether every card in a deck is counted on the same grid.
 *
 * One click serves every card the drill deals, and a click is beats. A deck
 * holding an eighth-note rung beside a sixteenth-note phrase would put four
 * strokes in the beat on one card and two on the next without the tempo moving,
 * which is not a switch between patterns, it is a switch between songs. The
 * drill's own exercise is recall under switch, and that only means anything when
 * the thing being switched is the pattern.
 *
 * A song's block is one card today, so this is an invariant rather than a
 * problem being solved. It is stated and tested because the day someone builds a
 * deck out of two sources is the day it stops being obviously true.
 */
export function deckIsOneGrid(deck: readonly string[]): boolean {
  const grids = new Set(
    deck.map((p) => parsePattern(p)?.slotsPerBeat).filter((g): g is SlotResolution => g !== undefined),
  );
  return grids.size <= 1;
}

/**
 * The fastest click a sixteenth-note pattern is drilled at.
 *
 * Seventy-five, and the number comes from the scoring rather than from taste. A
 * strum counts as in time within IN_TIME_MS (src/lib/strumTiming.ts), fifty
 * milliseconds, and the
 * matcher gives an onset to the nearest slot within half a slot. At sixteenths
 * and 116 BPM, the record's own tempo, half a slot is 65 ms: over three quarters
 * of the window that decides which slot a strum belongs to also counts as in
 * time, so almost anything landing in roughly the right place scores perfectly
 * and the drill stops telling the player anything. At 75 a sixteenth slot is
 * 200 ms, half of it is 100 ms, and the fifty stays the meaningful half it is on
 * an eighth-note pattern at ordinary tempos.
 *
 * So the drill deliberately never runs this phrase at the record's speed. That
 * is the app's own position rather than a compromise: tempo is prescribed from
 * what the player has actually held and never above it, the drill is where the
 * shape is built, and the record is where the shape gets fast. A drill that has
 * stopped discriminating is worse than a drill that is slow.
 *
 * `IN_TIME_MS` is deliberately not touched. Widening or narrowing the window
 * changes what every stored score in the app ever meant.
 */
export const SIXTEENTH_MAX_BPM = 75;

/** The tempo a deck may actually be held at, given how finely it is counted. */
export function cappedTempo(deck: readonly string[], bpm: number): number {
  const finest = deck.reduce(
    (most, p) => Math.max(most, parsePattern(p)?.slotsPerBeat ?? EIGHTHS),
    EIGHTHS as number,
  );
  return finest === SIXTEENTHS ? Math.min(bpm, SIXTEENTH_MAX_BPM) : bpm;
}

/**
 * Whether a song has strumming the drill can practise.
 *
 * Its own function because two callers ask the question without wanting the
 * answer: the coached session, deciding whether to run the block at all, and the
 * routine, working out how many minutes a song task really takes.
 */
export const songHasStrum = (song: Song | undefined): boolean =>
  songStrumPatterns(song).length > 0;

/**
 * What to call a pattern that came off a song, or null when none did.
 *
 * The deck card and the Progress row both name what was played, and a phrase
 * that lives on a song rather than on the ladder has no name in
 * `src/data/strumPatterns.ts` to find. Without this a month of runs on Get
 * Lucky's strum would be labelled `D--UX--U-U-UDUDU`, which is the pattern and
 * is not its name.
 *
 * The song's own title, unless the song named the phrase itself, which is what a
 * song with more than one phrase has to do: two cards both reading "Get Lucky"
 * would tell the player nothing about which is in front of them.
 */
export function songPatternName(pattern: string, songs: readonly Song[]): string | null {
  for (const song of songs) {
    for (const strum of song.strumPatterns ?? []) {
      if (strum.pattern === pattern) return strum.name ?? song.title;
    }
  }
  return null;
}
