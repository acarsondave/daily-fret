// Chord-only song catalog for the play-along drill. Each song is just an ordered
// list of chord changes grouped into sections. Strum pattern and rhythm are
// yours to own — the drill only tracks that you land the right chords in order,
// so however a song is strummed, the chord timeline is what we follow.
//
// Only chords the detector knows are allowed: A, C, D, E, G, Am, Dm, Em, F.
// Add a song by appending to SONGS; consecutive duplicate chords are collapsed
// automatically (the detector emits once per change), so write parts naturally.

export interface SongSection {
  label: string; // "Verse", "Chorus", "Riff"
  chords: string[];
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  level: 'Beginner' | 'Easy';
  chords: string[]; // distinct chords used, drives detection + the chord legend
  sections: SongSection[];
}

export const SONGS: Song[] = [
  {
    id: 'wild-thing',
    title: 'Wild Thing',
    artist: 'The Troggs',
    level: 'Beginner',
    chords: ['A', 'D', 'E'],
    sections: [
      { label: 'Verse', chords: ['A', 'D', 'E', 'A', 'D', 'E'] },
      { label: 'Chorus', chords: ['A', 'D', 'E', 'A'] },
      { label: 'Verse', chords: ['A', 'D', 'E', 'A', 'D', 'E'] },
      { label: 'Outro', chords: ['A', 'D', 'E', 'A'] },
    ],
  },
  {
    id: 'three-little-birds',
    title: 'Three Little Birds',
    artist: 'Bob Marley',
    level: 'Beginner',
    chords: ['A', 'D', 'E'],
    sections: [
      { label: 'Chorus', chords: ['A', 'D', 'A', 'E', 'A'] },
      { label: 'Verse', chords: ['A', 'D', 'A', 'E', 'A'] },
      { label: 'Chorus', chords: ['A', 'D', 'A', 'E', 'A'] },
    ],
  },
  {
    id: 'bad-moon-rising',
    title: 'Bad Moon Rising',
    artist: 'Creedence Clearwater Revival',
    level: 'Easy',
    chords: ['D', 'A', 'G'],
    sections: [
      { label: 'Verse', chords: ['D', 'A', 'G', 'D'] },
      { label: 'Chorus', chords: ['G', 'D', 'A', 'G', 'D'] },
      { label: 'Verse', chords: ['D', 'A', 'G', 'D'] },
    ],
  },
  {
    id: 'knockin-on-heavens-door',
    title: "Knockin' on Heaven's Door",
    artist: 'Bob Dylan',
    level: 'Easy',
    chords: ['G', 'D', 'Am', 'C'],
    sections: [
      { label: 'Verse', chords: ['G', 'D', 'Am', 'G', 'D', 'C'] },
      { label: 'Verse', chords: ['G', 'D', 'Am', 'G', 'D', 'C'] },
      { label: 'Chorus', chords: ['G', 'D', 'C', 'G', 'D', 'C'] },
    ],
  },
];

export function getSong(id: string | undefined): Song | undefined {
  return id ? SONGS.find((s) => s.id === id) : undefined;
}

// Flatten a song to the ordered chord-change timeline the player walks: each
// step carries its section label (for display) and collapses any chord that
// repeats the previous step, since the detector only emits on a change.
export interface SongStep {
  chord: string;
  section: string;
}

export function songTimeline(song: Song): SongStep[] {
  const steps: SongStep[] = [];
  for (const section of song.sections) {
    for (const chord of section.chords) {
      if (steps.length && steps[steps.length - 1].chord === chord) continue;
      steps.push({ chord, section: section.label });
    }
  }
  return steps;
}
