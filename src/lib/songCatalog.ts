// The song catalogue: the seven built-in charts plus whatever the user has
// written, as one list.
//
// Until now `SONGS` was a module constant and every consumer imported it
// directly, which meant a song could only exist by being in the source. That is
// the wall a second user hits first: they cannot practise the song they are
// actually learning this week. Everything here exists to make a user-written
// song indistinguishable from a built-in one at the point of use — the player,
// the task pickers and the Journey all read this list and none of them care
// where a chart came from.
//
// User songs win a name collision on purpose. If someone writes their own Wild
// Thing, theirs is the one they meant.

import { SONGS, type Song, type SongSection, type SongStepDef } from '../data/songs';
import { hasChordShape } from '../data/chordShapes';

/** Prefix that marks a song as user-written. The only thing that distinguishes one. */
export const USER_SONG_PREFIX = 'u_';

export const isUserSong = (song: Song): boolean => song.id.startsWith(USER_SONG_PREFIX);

/**
 * Built-ins plus the user's own, user songs first.
 *
 * Own work sits at the top because that is what someone is coming back for; the
 * built-ins are a starter shelf, not the main library.
 */
export function mergeSongs(userSongs: readonly Song[] | undefined): Song[] {
  if (!userSongs?.length) return SONGS;
  const mine = userSongs.filter((s) => s && typeof s.id === 'string');
  const taken = new Set(mine.map((s) => s.id));
  return [...mine, ...SONGS.filter((s) => !taken.has(s.id))];
}

export function findSong(songs: readonly Song[], id: string | undefined): Song | undefined {
  return id ? songs.find((s) => s.id === id) : undefined;
}

// --- What a vocabulary opens ----------------------------------------------
//
// The app has always known which shapes each chart needs and never once used it.
// A routine's closing block was a five minute timer titled "Play a song",
// described as "anything you can get through with the chords you have", which is
// the app declining to answer a question it holds the answer to. These two are
// that answer: what you can play now, and what one more shape would open.

/** Charts every one of whose chords is already under the hand. */
export function songsPlayableWith(songs: readonly Song[], chords: readonly string[]): Song[] {
  const held = new Set(chords);
  return songs.filter((song) => song.chords.length > 0 && song.chords.every((c) => held.has(c)));
}

export interface SongOneShapeAway {
  song: Song;
  /** The single chord standing between the player and this chart. */
  missing: string;
}

/**
 * Charts that need exactly one shape the player does not have yet.
 *
 * Exactly one, never two. "Learn these three chords and you can play four more
 * songs" is a wish; "learn G" is this evening.
 */
export function songsOneShapeAway(
  songs: readonly Song[],
  chords: readonly string[],
): SongOneShapeAway[] {
  const held = new Set(chords);
  const out: SongOneShapeAway[] = [];
  for (const song of songs) {
    if (!song.chords.length) continue;
    const missing = song.chords.filter((c) => !held.has(c));
    if (missing.length !== 1) continue;
    out.push({ song, missing: missing[0] });
  }
  return out;
}

// --- Authoring ------------------------------------------------------------

/**
 * The chords a chart actually uses, in first-appearance order.
 *
 * Derived rather than typed in. A hand-maintained chord list is a second copy of
 * the same fact, and the first time someone edits a bar without editing the list
 * the intro screen starts lying about what the song needs.
 */
export function chordsUsed(sections: readonly SongSection[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const section of sections) {
    for (const step of section.steps) {
      const chord = step.chord.trim();
      if (!chord || seen.has(chord)) continue;
      seen.add(chord);
      out.push(chord);
    }
  }
  return out;
}

/**
 * Read a line of chords the way a chord sheet writes it: `A D E D | Am Em`.
 *
 * Bar lines, commas and extra spaces are separators, not content. Most people
 * already have the chart somewhere as text, and re-typing it one tap at a time
 * when it could be pasted in one go is the difference between a feature someone
 * uses and one they abandon halfway through a verse.
 */
export function parseChordLine(line: string): SongStepDef[] {
  return line
    .split(/[\s|,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((chord) => ({ chord }));
}

/**
 * A strum is downs, ups, percussive slaps and rests. Anything else is a typo,
 * not a rhythm.
 */
export function normaliseStrum(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((c) => c === 'D' || c === 'U' || c === 'X' || c === '-')
    .join('');
}

export interface SongDraft {
  id: string;
  title: string;
  artist: string;
  strum: string;
  bpm: string;
  youtubeLink: string;
  sections: SongSection[];
  /**
   * Where the last charted bar ends in the recording, in seconds.
   *
   * A number rather than a string like `bpm`, because this one is never typed:
   * it is tapped in against the record, and there is no partially-entered state
   * to preserve. Null means the chart has not been timed.
   */
  endSeconds: number | null;
  /** Beats in a bar. A string because it is typed, and blank means four. */
  beatsPerBar: string;
}

export interface DraftProblem {
  field: 'title' | 'sections' | 'strum';
  message: string;
}

/**
 * What is wrong with a draft, in the order someone would fix it.
 *
 * Returns problems rather than a boolean so the editor can say which field and
 * why. "Save" being mysteriously disabled is the worst version of validation.
 */
export function draftProblems(draft: SongDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draft.title.trim()) {
    problems.push({ field: 'title', message: 'Give the song a name.' });
  }
  const bars = draft.sections.reduce((n, s) => n + s.steps.length, 0);
  if (bars === 0) {
    problems.push({ field: 'sections', message: 'Add at least one bar to play.' });
  }
  if (draft.strum.trim() && !normaliseStrum(draft.strum)) {
    problems.push({ field: 'strum', message: 'A strum is made of D, U and - only.' });
  }
  return problems;
}

/** Chords in the chart with no diagram to show. Worth saying, never worth blocking. */
export function chordsWithoutDiagram(sections: readonly SongSection[]): string[] {
  return chordsUsed(sections).filter((c) => !hasChordShape(c));
}

// Pull a YouTube video id out of any common link shape (or a bare id). Shared
// with the player so a link that works in one place works in the other.
export function youtubeIdFrom(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /[?&]v=([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return /^[\w-]{11}$/.test(url) ? url : null;
}

/**
 * Turn a draft into a song.
 *
 * Empty optional fields are dropped rather than stored as empty strings: a song
 * with `artist: ''` renders an empty line under the title, and a `bpm: NaN`
 * would preload the metronome with nonsense.
 */
export function draftToSong(draft: SongDraft): Song {
  // Spread rather than rebuilt, so the timing anchors a section carries survive
  // a save. They were dropped here once and the symptom was a chart that timed
  // perfectly in the editor and had no timing at all the moment it was opened.
  const sections = draft.sections
    .map((s) => ({ ...s, label: s.label.trim() || 'Section', steps: s.steps }))
    .filter((s) => s.steps.length > 0);
  const bpm = Number.parseInt(draft.bpm, 10);
  const beatsPerBar = Number.parseInt(draft.beatsPerBar, 10);
  const videoId = youtubeIdFrom(draft.youtubeLink);
  const end = draft.endSeconds;

  return {
    id: draft.id,
    title: draft.title.trim(),
    artist: draft.artist.trim() || 'Your chart',
    strum: normaliseStrum(draft.strum) || 'DD',
    chords: chordsUsed(sections),
    sections,
    ...(Number.isFinite(bpm) && bpm > 0 ? { bpm } : {}),
    ...(videoId ? { youtubeId: videoId } : {}),
    ...(Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? { beatsPerBar } : {}),
    ...(end !== null && Number.isFinite(end) && end > 0 ? { endSeconds: end } : {}),
  };
}

/** A song opened for editing, back into draft shape. */
export function songToDraft(song: Song): SongDraft {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist === 'Your chart' ? '' : song.artist,
    strum: song.strum,
    bpm: song.bpm ? String(song.bpm) : '',
    youtubeLink: song.youtubeId ?? '',
    sections: song.sections.map((s) => ({ ...s, steps: s.steps.map((st) => ({ ...st })) })),
    endSeconds: song.endSeconds ?? null,
    beatsPerBar: song.beatsPerBar ? String(song.beatsPerBar) : '',
  };
}

/**
 * A fresh id for a chart being written.
 *
 * Collision-checked against what already exists rather than trusted to be
 * unique: a song id is also the key its YouTube link and its drill results are
 * filed under, so two songs sharing one would silently merge someone's history.
 */
export function newSongId(existing: readonly Song[]): string {
  const taken = new Set(existing.map((s) => s.id));
  for (let attempt = 0; ; attempt++) {
    const id = `${USER_SONG_PREFIX}${Date.now().toString(36)}${attempt || ''}${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    if (!taken.has(id)) return id;
  }
}

export function emptyDraft(id: string): SongDraft {
  return {
    id,
    title: '',
    artist: '',
    strum: 'DD',
    bpm: '',
    youtubeLink: '',
    sections: [{ label: 'Verse', steps: [] }],
    endSeconds: null,
    beatsPerBar: '',
  };
}

/**
 * A copy of a built-in, as a starting point.
 *
 * Most "write a song" sessions are really "that one, but the way my teacher
 * plays it". Starting from a chart that already works beats starting from an
 * empty grid.
 */
export function duplicateAsDraft(song: Song, newId: string): SongDraft {
  return { ...songToDraft(song), id: newId, title: `${song.title} (my version)` };
}

/** Roughly how long the chart runs, for the list. Four beats a bar at the song tempo. */
export function chartBars(song: Song): number {
  return song.sections.reduce((n, s) => n + s.steps.length, 0);
}
