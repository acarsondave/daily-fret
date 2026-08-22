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
import { parsePattern } from './strumPattern';

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
    .map((s) => s.pattern)
    .filter((p) => parsePattern(p) !== null);
  if (written.length) return [...new Set(written)];
  return parsePattern(song.strum) !== null ? [song.strum] : [];
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
