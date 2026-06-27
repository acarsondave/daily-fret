// Chord-only song catalog for the play-along drill. Playing a song runs two
// passes: Learn (self-paced, advance when you play the chord) then Play
// (tempo-led karaoke, the lane scrolls and bars auto-advance; detection is
// advisory only — it lights the chord when you hit it, never grades).
//
// HOW TO ADD A SONG (copy an entry and edit):
//   id/title/artist/level  display + a unique slug
//   bpm        tempo for the Play pass (adjustable live)
//   strum      DEFAULT strum for a bar: a string of D (down) / U (up) / - (rest),
//              e.g. 'DD' = two downs, 'DDDD' = four downs. Per-bar overrides below.
//   chords     distinct chords used (drives detection). Only: A C D E G Am Dm Em F
//   sections   the song in order. Each section is { label, steps }. A step is one
//              bar: s('A') or s('A','lyric sung here') or s('E', '', 'DDDDDD') to
//              override the strum for a long-held chord.
//
// `s(chord, lyric?, strum?)` keeps authoring terse. That's the whole job.

export type StrumDir = 'D' | 'U' | '-';

export interface SongStepDef {
  chord: string;
  strum?: string; // overrides the song default for this bar
  lyric?: string; // word(s) sung starting on this chord (karaoke sync)
}

export interface SongSection {
  label: string;
  steps: SongStepDef[];
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  level: 'Beginner' | 'Easy';
  bpm: number;
  strum: string;
  chords: string[];
  sections: SongSection[];
}

const s = (chord: string, lyric?: string, strum?: string): SongStepDef => ({
  chord,
  ...(lyric ? { lyric } : {}),
  ...(strum ? { strum } : {}),
});

// --- Wild Thing (The Troggs), faithful to the common chart ---
const WT_CHORUS: SongStepDef[] = [
  s('A', 'Wild thing'), s('D'),
  s('E'), s('D', 'you make my heart sing'), s('A'), s('D'),
  s('E'), s('D', 'you make everything groovy'), s('A'), s('D'),
  s('E'), s('D'), s('A', 'wild thing'), s('D'), s('E'), s('G'), s('A'), s('G'),
];
const WT_INTERLUDE: SongStepDef[] = [s('A'), s('D'), s('E'), s('D'), s('A'), s('D'), s('E'), s('D')];

const wildThing: Song = {
  id: 'wild-thing',
  title: 'Wild Thing',
  artist: 'The Troggs',
  level: 'Beginner',
  bpm: 100,
  strum: 'DD',
  chords: ['A', 'D', 'E', 'G'],
  sections: [
    // Prelude — played before the singing starts.
    { label: 'Intro', steps: [s('A'), s('D'), s('E', '', 'DDDDDD')] },
    { label: 'Chorus', steps: WT_CHORUS },
    {
      label: 'Verse 1',
      steps: [
        s('A', 'Wild thing,'), s('G'), s('A', 'I think I love you'), s('G'),
        s('A', 'but'), s('G'), s('A', 'I wanna know for sure'), s('G'),
        s('A'), s('G', "so come on, hold me tight"), s('A', 'I love you'),
      ],
    },
    { label: 'Interlude', steps: WT_INTERLUDE },
    { label: 'Chorus', steps: WT_CHORUS },
    {
      label: 'Solo',
      steps: [
        s('A'), s('D'), s('E'), s('D'), s('A'), s('D'), s('E'), s('D'),
        s('A'), s('D'), s('E'), s('D'), s('A'), s('D'), s('E'), s('G'), s('A'), s('G'),
      ],
    },
    {
      label: 'Verse 2',
      steps: [
        s('A', 'Wild thing,'), s('G'), s('A', 'I think you move me'), s('G'),
        s('A', 'but'), s('G'), s('A', 'I wanna know for sure'), s('G'),
        s('A'), s('G', "so come on, hold me tight"), s('A', 'you move me'),
      ],
    },
    { label: 'Interlude', steps: WT_INTERLUDE },
    { label: 'Chorus', steps: WT_CHORUS },
  ],
};

const threeLittleBirds: Song = {
  id: 'three-little-birds',
  title: 'Three Little Birds',
  artist: 'Bob Marley',
  level: 'Beginner',
  bpm: 76,
  strum: 'DDUUDU',
  chords: ['A', 'D', 'E'],
  sections: [
    { label: 'Chorus', steps: [s('A', "Don't worry"), s('A', 'about a thing'), s('D'), s('A', "'cause every little thing"), s('E'), s('A', 'gonna be all right')] },
    { label: 'Verse', steps: [s('A', 'Rise up this morning'), s('A'), s('D', 'smiled with the rising sun'), s('A'), s('E', 'three little birds'), s('A', 'by my doorstep')] },
    { label: 'Chorus', steps: [s('A', "Don't worry"), s('A', 'about a thing'), s('D'), s('A', "'cause every little thing"), s('E'), s('A', 'gonna be all right')] },
  ],
};

const badMoonRising: Song = {
  id: 'bad-moon-rising',
  title: 'Bad Moon Rising',
  artist: 'Creedence Clearwater Revival',
  level: 'Easy',
  bpm: 120,
  strum: 'DDUUDU',
  chords: ['D', 'A', 'G'],
  sections: [
    { label: 'Verse', steps: [s('D', 'I see a bad moon rising'), s('A'), s('G'), s('D')] },
    { label: 'Chorus', steps: [s('G', "Don't go around tonight"), s('D'), s('A', "it's bound to take your life"), s('G'), s('D')] },
    { label: 'Verse', steps: [s('D', 'I hear hurricanes a-blowing'), s('A'), s('G'), s('D')] },
  ],
};

const knockinHeaven: Song = {
  id: 'knockin-on-heavens-door',
  title: "Knockin' on Heaven's Door",
  artist: 'Bob Dylan',
  level: 'Easy',
  bpm: 72,
  strum: 'DDUUDU',
  chords: ['G', 'D', 'Am', 'C'],
  sections: [
    { label: 'Verse', steps: [s('G', 'Mama, take this badge off of me'), s('D'), s('Am'), s('Am'), s('G'), s('D'), s('C'), s('C')] },
    { label: 'Verse', steps: [s('G', "I can't use it anymore"), s('D'), s('Am'), s('Am'), s('G'), s('D'), s('C'), s('C')] },
    { label: 'Chorus', steps: [s('G', "Knock, knock, knockin'"), s('D'), s('C', "on heaven's door"), s('C'), s('G'), s('D'), s('C'), s('C')] },
  ],
};

export const SONGS: Song[] = [wildThing, threeLittleBirds, badMoonRising, knockinHeaven];

export function getSong(id: string | undefined): Song | undefined {
  return id ? SONGS.find((song) => song.id === id) : undefined;
}

export function parseStrum(strum: string): StrumDir[] {
  const out: StrumDir[] = [];
  for (const c of strum) out.push(c === 'D' || c === 'U' ? c : '-');
  return out;
}

export interface SongCell {
  chord: string;
  strum: string;
  section: string;
  lyric?: string;
  sectionStart: boolean; // first cell of a new section
}

// Play pass: every step is one bar, in order.
export function songBars(song: Song): SongCell[] {
  const cells: SongCell[] = [];
  for (const section of song.sections) {
    section.steps.forEach((step, i) => {
      cells.push({
        chord: step.chord,
        strum: step.strum ?? song.strum,
        section: section.label,
        lyric: step.lyric,
        sectionStart: i === 0,
      });
    });
  }
  return cells;
}

// Learn pass: collapse a chord that repeats the previous bar (the detector emits
// once per change), but keep a lyric/section-start that would otherwise be lost.
export function songTimeline(song: Song): SongCell[] {
  const bars = songBars(song);
  const steps: SongCell[] = [];
  for (const bar of bars) {
    const prev = steps[steps.length - 1];
    if (prev && prev.chord === bar.chord) {
      if (!prev.lyric && bar.lyric) prev.lyric = bar.lyric;
      continue;
    }
    steps.push({ ...bar });
  }
  return steps;
}
