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
  MIN_GRADED_STROKE_GAP_MS,
  SIXTEENTHS,
  gradableCeilingBpm,
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
 * Derived from what the microphone can actually resolve, and no longer chosen.
 * It used to be seventy-five, taken from the scoring: a strum counts as in time
 * within IN_TIME_MS, fifty milliseconds, the matcher gives an onset to the
 * nearest slot within half a slot, and at 75 a sixteenth slot is 200 ms so the
 * fifty stays the meaningful half it is on an eighth-note pattern.
 *
 * That reasoning is still right and it was answering the wrong question. Two
 * hundred milliseconds is also, to the millisecond, the point below which the
 * analyser cannot report two strums at all (MIN_STRUM_GAP_MS in
 * src/audio/timing.ts), so the cap sat exactly on a cliff nobody had noticed and
 * on the wrong side of it. Measured through the real analyser, a perfectly
 * played take of Get Lucky's phrase at this cap came back at 20 per cent with
 * two thirds of its strokes reported missing.
 *
 * So the cap now comes off the detector. What it does NOT do is make the phrase
 * gradable on its own: `strokesTooCloseToHear` in ./strumPattern is what the
 * drill consults per pattern, and it still refuses a phrase whose own strokes
 * fall inside the floor once a person's timing is allowed for. The cap keeps the
 * click honest; the guard keeps the score honest.
 *
 * The rest of the old reasoning stands. Tempo is prescribed from what the player
 * has actually held and never above it, the drill is where the shape is built,
 * and the record is where the shape gets fast. `IN_TIME_MS` is deliberately not
 * touched: widening or narrowing it changes what every stored score in the app
 * ever meant.
 */
export const SIXTEENTH_MAX_BPM = Math.floor(
  60000 / (MIN_GRADED_STROKE_GAP_MS * SIXTEENTHS),
);

/**
 * The tempo a deck may actually be held at, so that every card in it can be
 * scored honestly.
 *
 * Off each pattern's own closest pair of strokes rather than off its grid. A
 * grid is a poor proxy for the question: `16.D---D---D---D---` is counted in
 * sixteenths and puts a whole beat between its strokes, while `DUDUDUDU` is
 * counted in eighths and runs out of room before the click band does. What
 * decides it is the shortest gap the pattern asks the hand for, which is what
 * {@link gradableCeilingBpm} reads.
 *
 * Slowing the click rather than refusing to score is the better of the two
 * honest answers, and it is available because the drill's own position is
 * already that the shape is built slowly and the record is where it gets fast.
 * The refusal still exists (`strokesTooCloseToHear` in ./strumPattern) and
 * covers the case this cannot: the player is free to move the click from the metronome panel
 * mid-run, and a drill cannot follow them up there and still mean anything.
 */
export function cappedTempo(deck: readonly string[], bpm: number): number {
  const ceiling = deck.reduce((lowest, source) => {
    const pattern = parsePattern(source);
    return pattern ? Math.min(lowest, gradableCeilingBpm(pattern)) : lowest;
  }, Infinity);
  return Number.isFinite(ceiling) ? Math.min(bpm, ceiling) : bpm;
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
      // Against the written string, mark and all. The catalogue keeps the slots
      // and the grid in two fields; everything downstream of `songStrumPatterns`
      // carries them as one string, and that string is what a card is drawn
      // from and what a run is filed under. Comparing the bare slots meant Get
      // Lucky's phrase matched nothing anywhere it was actually asked about, so
      // its card and its history row both read `16.D--UX--U-U-UDUDU`.
      if (writePattern(strum.pattern, strum.slotsPerBeat ?? EIGHTHS) === pattern) {
        return strum.name ?? song.title;
      }
    }
  }
  return null;
}
