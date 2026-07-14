// Chord-only song catalog for the play-along drill. Playing a song runs two
// passes: Learn (self-paced, advance when you strum the chord, following the
// full song bar by bar) then Real play (the actual recording streams from
// YouTube with the lyrics on screen — no grading, just play along).
//
// HOW TO ADD A SONG (copy an entry and edit):
//   id/title/artist/level  display + a unique slug
//   strum      DEFAULT strum for a bar: a string of D (down) / U (up) / - (rest),
//              e.g. 'DD' = two downs, 'DDDD' = four downs. Per-bar overrides below.
//   chords     distinct chords used (drives detection). Only: A C D E G Am Dm Em F
//   sections   the song in order. Each section is { label, steps }. A step is one
//              bar: s('A') or s('A','lyric sung here') or s('E','','DDDDDD') to
//              override the strum for a long-held chord.
//
// `s(chord, lyric?, strum?)` keeps authoring terse. That's the whole job.

export type StrumDir = 'D' | 'U' | '-';

export interface SongStepDef {
  chord: string; // the chord we detect for this bar
  strum?: string; // overrides the song default for this bar
  lyric?: string; // word(s) sung starting on this chord (karaoke sync)
  tag?: string; // small label above the cell, e.g. "riff"
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
  strum: string;
  chords: string[];
  sections: SongSection[];
  youtubeId?: string; // default recording for the real-play pass (user can override)
}

const s = (chord: string, lyric?: string, strum?: string): SongStepDef => ({
  chord,
  ...(lyric ? { lyric } : {}),
  ...(strum ? { strum } : {}),
});

// The Wild Thing turnaround riff (chart shows "G A G A"). It's played as a quick
// open-string-into-A figure: four down-strums (open, A, open, A). We can't detect
// the open strings, so we target A — strumming the A inside the riff counts it. It
// stays one joined cell, and in a verse it's played first, then you sing over A.
const riff = (): SongStepDef => ({ chord: 'A', strum: 'DDDD', tag: 'riff' });

// --- Wild Thing (The Troggs) ---
// No G chord: the "G A G A" turnaround is the open-into-A riff (see `riff`).
const WT_CHORUS: SongStepDef[] = [
  s('A', 'Wild thing'), s('D'), s('E'), s('D'),
  s('A', 'you make my heart sing'), s('D'), s('E'), s('D'),
  s('D', 'you make everything'), s('A'), s('D'),
  s('E', 'groovy'), s('D'),
  s('A', 'wild thing'), s('D'), s('E'),
];
const ade = (n: number): SongStepDef[] => {
  const out: SongStepDef[] = [];
  for (let i = 0; i < n; i++) out.push(s('A'), s('D'), s('E'), s('D'));
  return out;
};

const wildThing: Song = {
  id: 'wild-thing',
  title: 'Wild Thing',
  artist: 'The Troggs',
  level: 'Beginner',
  strum: 'DD',
  chords: ['A', 'D', 'E'],
  youtubeId: 'gSWInYFVksg',
  sections: [
    // Prelude — the A-D-E vamp played before the singing starts.
    { label: 'Intro', steps: [s('A'), s('D'), s('E', '', 'DDDDDD')] },
    { label: 'Chorus', steps: WT_CHORUS },
    {
      // Each line: play the riff, then sing over A.
      label: 'Verse 1',
      steps: [
        riff(), s('A', 'Wild thing, I think I love you'),
        riff(), s('A', 'But I wanna know for sure'),
        riff(), s('A', 'Come on, hold me tight'),
        s('A', 'I love you'),
      ],
    },
    { label: 'Interlude', steps: ade(2) },
    { label: 'Chorus', steps: WT_CHORUS },
    { label: 'Interlude', steps: [...ade(3), s('A'), s('D'), s('E')] },
    {
      label: 'Verse 2',
      steps: [
        riff(), s('A', 'Wild thing, I think you move me'),
        riff(), s('A', 'But I wanna know for sure'),
        riff(), s('A', 'So come on, hold me tight'),
        s('A', 'you move me'),
      ],
    },
    { label: 'Interlude', steps: [...ade(1), s('A'), s('D'), s('E', '', 'DDDDDD')] },
    {
      label: 'Chorus',
      steps: [
        ...WT_CHORUS,
        s('A', 'come on, come on, wild thing'), s('D'), s('E'),
        s('A', 'shake it, shake it, wild thing'), s('D'), s('E'),
      ],
    },
  ],
};

const threeLittleBirds: Song = {
  id: 'three-little-birds',
  title: 'Three Little Birds',
  artist: 'Bob Marley',
  level: 'Beginner',
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
  strum: 'DDUUDU',
  chords: ['G', 'D', 'Am', 'C'],
  sections: [
    { label: 'Verse', steps: [s('G', 'Mama, take this badge off of me'), s('D'), s('Am'), s('Am'), s('G'), s('D'), s('C'), s('C')] },
    { label: 'Verse', steps: [s('G', "I can't use it anymore"), s('D'), s('Am'), s('Am'), s('G'), s('D'), s('C'), s('C')] },
    { label: 'Chorus', steps: [s('G', "Knock, knock, knockin'"), s('D'), s('C', "on heaven's door"), s('C'), s('G'), s('D'), s('C'), s('C')] },
  ],
};

// --- I Belong to You (Lenny Kravitz) --- two chords, Am and Em (JustinGuitar
// SG-026). A slow ballad, so the change is gentle: alternate Am/Em, start with a
// couple of down-strums per bar and funk it up once it's comfortable. Played in
// Am/Em for practice; the record sits a few frets higher (capo ~3 to match it).
const iBelongToYou: Song = {
  id: 'i-belong-to-you',
  title: 'I Belong to You',
  artist: 'Lenny Kravitz',
  level: 'Beginner',
  strum: 'DD',
  chords: ['Am', 'Em'],
  youtubeId: 'ucvLuGgsGS8',
  sections: [
    { label: 'Intro', steps: [s('Am'), s('Em')] },
    {
      label: 'Verse',
      steps: [s('Am'), s('Em'), s('Am'), s('Em')],
    },
    {
      label: 'Chorus',
      steps: [
        s('Am', 'You are the flame in my heart'), s('Em', 'you light my way in the dark'),
        s('Am', 'you are the ultimate star'), s('Em'),
        s('Am', 'your unconditional love'), s('Em', 'takes me to paradise'),
        s('Am', 'I belong to you and you'), s('Em', 'you belong to me too'),
      ],
    },
    { label: 'Verse', steps: [s('Am'), s('Em'), s('Am'), s('Em')] },
    {
      label: 'Chorus',
      steps: [
        s('Am', 'You are the flame in my heart'), s('Em', 'you light my way in the dark'),
        s('Am', 'you are the ultimate star'), s('Em'),
        s('Am', 'your unconditional love'), s('Em', 'takes me to paradise'),
        s('Am', 'I belong to you and you'), s('Em', 'you belong to me too'),
      ],
    },
  ],
};

// --- Sing (Ed Sheeran) --- two chords, Em and Am (JustinGuitar SG-031). Funky and
// upbeat: start with one strum per bar, then add the DDUUDU groove. Played open in
// Em/Am for practice; capo 4 matches the actual record's key.
const singEdSheeran: Song = {
  id: 'sing-ed-sheeran',
  title: 'Sing',
  artist: 'Ed Sheeran',
  level: 'Easy',
  strum: 'DDUUDU',
  chords: ['Em', 'Am'],
  youtubeId: 'tlYcUqEPN58',
  sections: [
    { label: 'Intro', steps: [s('Em'), s('Em')] },
    { label: 'Verse', steps: [s('Em'), s('Am'), s('Em'), s('Am')] },
    { label: 'Pre-Chorus', steps: [s('Em'), s('Am')] },
    {
      label: 'Chorus',
      steps: [s('Em', 'Sing!'), s('Am', 'oh-oh, oh-oh-oh'), s('Em'), s('Am', 'oh-oh, oh-oh-oh')],
    },
    { label: 'Verse', steps: [s('Em'), s('Am'), s('Em'), s('Am')] },
    { label: 'Pre-Chorus', steps: [s('Em'), s('Am')] },
    {
      label: 'Chorus',
      steps: [s('Em', 'Sing!'), s('Am', 'oh-oh, oh-oh-oh'), s('Em'), s('Am', 'oh-oh, oh-oh-oh')],
    },
  ],
};

export const SONGS: Song[] = [
  wildThing,
  threeLittleBirds,
  badMoonRising,
  knockinHeaven,
  iBelongToYou,
  singEdSheeran,
];

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
  tag?: string;
  sectionStart: boolean; // first cell of a new section
}

// The full song, one cell per bar, in order.
export function songBars(song: Song): SongCell[] {
  const cells: SongCell[] = [];
  for (const section of song.sections) {
    section.steps.forEach((step, i) => {
      cells.push({
        chord: step.chord,
        strum: step.strum ?? song.strum,
        section: section.label,
        lyric: step.lyric,
        tag: step.tag,
        sectionStart: i === 0,
      });
    });
  }
  return cells;
}

// Learn pass: collapse a chord that just repeats the previous bar (the detector
// emits once per change, so the lane advances on each chord change rather than
// per strum). A new section always starts a fresh cell, and a lyric that would
// be lost in the merge is carried onto the cell you actually play.
export function songTimeline(song: Song): SongCell[] {
  const bars = songBars(song);
  const steps: SongCell[] = [];
  for (const bar of bars) {
    const prev = steps[steps.length - 1];
    if (prev && prev.chord === bar.chord && !bar.sectionStart) {
      if (!prev.lyric && bar.lyric) prev.lyric = bar.lyric;
      continue;
    }
    steps.push({ ...bar });
  }
  return steps;
}
