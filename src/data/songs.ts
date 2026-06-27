// Chord-only song catalog for the play-along drill. Playing a song always runs
// two passes: Learn (self-paced, advance when you play the chord) then Play
// (tempo-led metronome, bars auto-advance, detection is advisory only).
//
// HOW TO ADD A SONG (no code knowledge needed — copy an entry and edit):
//   id        unique slug, e.g. 'horse-with-no-name'
//   title     display name
//   artist    display name
//   level     'Beginner' | 'Easy'
//   bpm       base tempo for the Play pass (a steady guess is fine; it's
//             adjustable live). Slow ~70, medium ~100, upbeat ~140.
//   strum     ONE bar as 8 eighth-note slots, each: D (down) U (up) - (rest).
//             e.g. 'D-D-D-D-' = four downstrokes, 'D-DU-UD-' = the common one.
//   chords    the distinct chords used — drives detection + the chord legend.
//             Only these are recognized: A C D E G Am Dm Em F.
//   sections  the song in order. Each section is { label, chords, lyric? }.
//             Each chord in `chords` is ONE bar; repeat a chord to hold it
//             longer. `lyric` is an optional tiny line shown during the section.
//
// Then it shows up in the Song picker automatically. That's the whole job.

export type StrumDir = 'D' | 'U' | '-';

export interface SongSection {
  label: string;
  chords: string[]; // one chord per bar
  lyric?: string; // optional tiny lyric line shown during this section
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  level: 'Beginner' | 'Easy';
  bpm: number;
  strum: string; // 8 chars of D/U/-
  chords: string[];
  sections: SongSection[];
}

export const SONGS: Song[] = [
  {
    // The chart's (G A G) fills are played as a fast open-string riff back to A,
    // so this version stays on A, D, E throughout.
    id: 'wild-thing',
    title: 'Wild Thing',
    artist: 'The Troggs',
    level: 'Beginner',
    bpm: 100,
    strum: 'D-D-D-D-',
    chords: ['A', 'D', 'E'],
    sections: [
      {
        label: 'Verse',
        chords: ['A', 'D', 'E', 'D', 'A', 'D', 'E', 'D', 'A', 'D', 'E', 'D', 'A', 'D', 'E'],
        lyric: 'Wild thing, you make my heart sing. You make everything groovy. Wild thing.',
      },
      { label: 'Bridge', chords: ['A'], lyric: 'Wild thing, I think I love you.' },
      { label: 'Interlude', chords: ['A', 'D', 'E', 'D', 'A', 'D', 'E', 'D'] },
      {
        label: 'Verse',
        chords: ['A', 'D', 'E', 'D', 'A', 'D', 'E', 'D', 'A', 'D', 'E', 'D', 'A', 'D', 'E'],
        lyric: 'Wild thing, you make my heart sing. You make everything groovy. Wild thing.',
      },
      {
        label: 'Outro',
        chords: ['A', 'D', 'E', 'D', 'A', 'D', 'E'],
        lyric: "Come on, come on, wild thing. Shake it, shake it, wild thing.",
      },
    ],
  },
  {
    id: 'three-little-birds',
    title: 'Three Little Birds',
    artist: 'Bob Marley',
    level: 'Beginner',
    bpm: 76,
    strum: 'D-DU-UD-',
    chords: ['A', 'D', 'E'],
    sections: [
      { label: 'Chorus', chords: ['A', 'A', 'D', 'A', 'E', 'A'], lyric: "Don't worry about a thing." },
      { label: 'Verse', chords: ['A', 'A', 'D', 'A', 'E', 'A'], lyric: 'Rise up this morning, smiled with the rising sun.' },
      { label: 'Chorus', chords: ['A', 'A', 'D', 'A', 'E', 'A'], lyric: "'Cause every little thing gonna be all right." },
    ],
  },
  {
    id: 'bad-moon-rising',
    title: 'Bad Moon Rising',
    artist: 'Creedence Clearwater Revival',
    level: 'Easy',
    bpm: 120,
    strum: 'D-DU-UD-',
    chords: ['D', 'A', 'G'],
    sections: [
      { label: 'Verse', chords: ['D', 'A', 'G', 'D'], lyric: 'I see a bad moon rising.' },
      { label: 'Chorus', chords: ['G', 'D', 'A', 'G', 'D'], lyric: "Don't go around tonight." },
      { label: 'Verse', chords: ['D', 'A', 'G', 'D'], lyric: 'I hear hurricanes a-blowing.' },
    ],
  },
  {
    id: 'knockin-on-heavens-door',
    title: "Knockin' on Heaven's Door",
    artist: 'Bob Dylan',
    level: 'Easy',
    bpm: 72,
    strum: 'D-DU-UD-',
    chords: ['G', 'D', 'Am', 'C'],
    sections: [
      { label: 'Verse', chords: ['G', 'D', 'Am', 'Am', 'G', 'D', 'C', 'C'], lyric: "Mama, take this badge off of me." },
      { label: 'Verse', chords: ['G', 'D', 'Am', 'Am', 'G', 'D', 'C', 'C'], lyric: "I can't use it anymore." },
      { label: 'Chorus', chords: ['G', 'D', 'C', 'C', 'G', 'D', 'C', 'C'], lyric: "Knock, knock, knockin' on heaven's door." },
    ],
  },
];

export function getSong(id: string | undefined): Song | undefined {
  return id ? SONGS.find((s) => s.id === id) : undefined;
}

// Parse the 8-slot strum string into directions, padded/truncated to 8.
export function parseStrum(strum: string): StrumDir[] {
  const slots: StrumDir[] = [];
  for (let i = 0; i < 8; i++) {
    const c = strum[i];
    slots.push(c === 'D' || c === 'U' ? c : '-');
  }
  return slots;
}

export interface SongStep {
  chord: string;
  section: string;
  lyric?: string;
}

// Learn pass: the ordered chord-change timeline, collapsing a chord that repeats
// the previous step (the detector only emits on a change, so holding a chord for
// several bars is one step here).
export function songTimeline(song: Song): SongStep[] {
  const steps: SongStep[] = [];
  for (const section of song.sections) {
    for (const chord of section.chords) {
      if (steps.length && steps[steps.length - 1].chord === chord) continue;
      steps.push({ chord, section: section.label, lyric: section.lyric });
    }
  }
  return steps;
}

// Play pass: every listed chord is one bar (no collapsing), so a held chord
// occupies the bars it's written for and the metronome dwells on it.
export function songBars(song: Song): SongStep[] {
  const bars: SongStep[] = [];
  for (const section of song.sections) {
    for (const chord of section.chords) {
      bars.push({ chord, section: section.label, lyric: section.lyric });
    }
  }
  return bars;
}
