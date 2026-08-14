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
//   atSeconds  OPTIONAL, per section: where its first downbeat lands in the
//              linked recording. Tapped in, not typed — the song editor's timing
//              mode captures a whole song in one pass. With every section
//              anchored (plus the song's `endSeconds`) the chart scrolls in time
//              with the record; without them it stays a plain play-along.
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
  // Where this section's first downbeat lands in the linked recording.
  //
  // The chart scrolls in time with the record, and extrapolating four minutes
  // of bars from one tempo and one offset does not survive contact with a real
  // performance: half a percent of tempo error is over a bar out by the last
  // chorus, which is worse than showing no chart. So every section carries its
  // own anchor and bars are interpolated only inside it. Error stays bounded to
  // the length of one section, where half a percent is a tenth of a second.
  //
  // Optional because a chart is perfectly playable untimed. A song where these
  // are missing falls back to the plain video, and says so.
  atSeconds?: number;
  // Beats in a bar through this section, when it differs from the song's.
  beatsPerBar?: number;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  // Carried by the built-in charts, shown nowhere. Optional so a written song
  // does not have to answer a question the app never asks.
  level?: 'Beginner' | 'Easy';
  strum: string;
  chords: string[];
  sections: SongSection[];
  youtubeId?: string; // default recording for the real-play pass (user can override)
  bpm?: number; // the record's tempo, used to preload the metronome
  // Where the song actually starts in the linked video, so the real-play pass
  // doesn't open on a minute of intro before there's anything to play.
  startSeconds?: number;
  // Beats in a bar, when the song is not in four. A section may override it.
  beatsPerBar?: number;
  // Where the last charted bar finishes in the recording. The final section has
  // no following anchor to interpolate towards, so it is given one explicitly
  // rather than guessed at from the nominal tempo.
  endSeconds?: number;
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
// SG-026). Chart transcribed from the Ultimate Guitar sheets (record is in Cm/Gm;
// this is that pattern in open Am/Em). Slow ballad — start with a couple of downs
// per bar and funk it up once it's comfortable. Capo 3 to match the actual record.
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
      label: 'Verse 1',
      steps: [
        s('Am', 'You are the flame in my heart'),
        s('Em', 'you are the ultimate star'),
        s('Am', 'you lift me from up above'),
        s('Em', 'takes me to paradise'),
      ],
    },
    {
      label: 'Chorus',
      steps: [
        s('Am', 'I belong to you and you'),
        s('Em', 'you belong to me too'),
        s('Am', 'you make my life complete'),
        s('Em', 'you make me feel so'), s('Am'), s('Em', 'sweet'),
      ],
    },
    {
      label: 'Verse 2',
      steps: [
        s('Am', 'You make me feel so divine'),
        s('Em', 'before you I was blind'),
        s('Am', "but since I've opened my eyes"),
        s('Em', 'so I could open up my mind'),
        s('Am', 'I always loved you from the start'),
        s('Em', 'that I had to do it everyday'),
        s('Am', 'so I put away the fight'),
        s('Em', 'giving you the most in every way'),
      ],
    },
    {
      label: 'Chorus',
      steps: [
        s('Am', 'I belong to you and you'),
        s('Em', 'you belong to me too'),
        s('Am', 'you make my life complete'),
        s('Em', 'you make me feel so'), s('Am'), s('Em', 'sweet'),
      ],
    },
    { label: 'Solo', steps: [s('Am'), s('Em'), s('Am'), s('Em')] },
    {
      label: 'Chorus',
      steps: [
        s('Am', 'I belong to you'),
        s('Em', 'you belong to me too'),
        s('Am', 'you make my life complete'),
        s('Em', 'you make me feel so sweet'),
      ],
    },
    { label: 'Outro', steps: [s('Em')] },
  ],
};

// --- Sing (Ed Sheeran) --- two chords, Em and Am (JustinGuitar SG-031). Chart
// transcribed from the Ultimate Guitar sheets, which play it open in Em/Am with a
// capo on 4 to match the record (key G#m). Funky 120bpm groove — start one strum
// per bar, then build toward the DDUUDU feel.
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
    {
      label: 'Verse 1',
      steps: [
        s('Em', "It's late in the evening"),
        s('Am', 'ignoring everybody here'),
        s('Em', "I don't wanna know"),
        s('Am', 'to hold your body close'),
      ],
    },
    {
      label: 'Pre-Chorus',
      steps: [
        s('Em', 'I need you darling'),
        s('Am', "won't you let me know"),
        s('Em', 'if you love me, get involved'),
        s('Am', 'feel it rushing through you'),
      ],
    },
    {
      label: 'Chorus',
      steps: [s('Em', 'Louder!'), s('Am', 'Sing!'), s('Em', 'this love is a blaze')],
    },
    {
      label: 'Verse 2',
      steps: [
        s('Em', 'I saw flames from the stage'),
        s('Am', 'let it go'),
        s('Em', 'I told her my name'),
        s('Am', 'one thing led to another'),
      ],
    },
    {
      label: 'Pre-Chorus',
      steps: [
        s('Em', 'I need you darling'),
        s('Am', "won't you let me know"),
        s('Em', 'if you love me, get involved'),
        s('Am', 'feel it rushing through you'),
      ],
    },
    {
      label: 'Chorus',
      steps: [s('Em', 'Louder!'), s('Am', 'Sing!'), s('Em', 'this love is a blaze')],
    },
    {
      label: 'Bridge',
      steps: [
        s('Em', 'Can you feel it?'),
        s('Am', 'music from the back'),
        s('Em', 'but can you feel it?'),
        s('Am', 'oh no no no?'),
      ],
    },
    {
      label: 'Chorus',
      steps: [
        s('Em', 'I need you darling'),
        s('Am', "won't you let me know"),
        s('Em', 'if you love me, get involved'),
        s('Am', 'Sing!'),
      ],
    },
  ],
};

// --- 505 (Arctic Monkeys) --- two chords the whole way through, Dm and Em,
// alternating every two bars. Transcribed from the Ultimate Guitar chart. That
// chart also prints an E diagram, but E never appears in the progression, so the
// song is charted with what it actually plays.
//
// The record moves between a slow section (one strum, let it ring for two bars)
// and a fast section (straight eighths). Verse 3 onward is the fast half, and
// the chart's Dm*/Em* are the same two chords played up the neck; open Dm and Em
// are the right shapes to learn them on.
const FAST = 'DUDUDUDU';
const dmEm = (n: number, strum?: string): SongStepDef[] => {
  const out: SongStepDef[] = [];
  for (let i = 0; i < n; i++) out.push(s('Dm', undefined, strum), s('Em', undefined, strum));
  return out;
};

const fiveOhFive: Song = {
  id: '505-arctic-monkeys',
  title: '505',
  artist: 'Arctic Monkeys',
  level: 'Beginner',
  strum: 'D',
  chords: ['Dm', 'Em'],
  youtubeId: 'd8CR8fSTm-Y',
  bpm: 140,
  startSeconds: 50,
  sections: [
    { label: 'Intro', steps: dmEm(2) },
    {
      label: 'Chorus',
      steps: [
        s('Dm', "I'm going back to 505"),
        s('Em', "if it's a 7 hour flight"),
        s('Dm', 'or a forty-five minute drive'),
        s('Em', 'in my imagination'),
        s('Dm', "you're waiting lying on your side"),
        s('Em', 'with your hands between your thighs'),
        s('Dm'), s('Em'),
      ],
    },
    {
      label: 'Verse 1',
      steps: [
        s('Dm', 'Stop and wait a sec'),
        s('Em', 'when you look at me like that'),
        s('Dm', 'my darling what did you expect?'),
        s('Em', 'I probably still adore you'),
        s('Dm', 'with your hands around my neck'),
        s('Em', 'or I did last time I checked'),
      ],
    },
    { label: 'Instrumental', steps: dmEm(1) },
    {
      label: 'Verse 2',
      steps: [
        s('Dm', 'Not shy of a spark'),
        s('Em', 'the knife twists at the thought'),
        s('Dm', 'that I should fall short of the mark'),
        s('Em', 'frightened by the bite'),
        s('Dm', "though it's no harsher than the bark"),
        s('Em', 'the middle of adventure'),
        s('Dm', 'is such a perfect place to start'),
        s('Em'),
      ],
    },
    {
      label: 'Chorus',
      steps: [
        s('Dm', "I'm going back to 505"),
        s('Em', "if it's a 7 hour flight"),
        s('Dm', 'or a forty-five minute drive'),
        s('Em', 'in my imagination'),
        s('Dm', "you're waiting lying on your side"),
        s('Em', 'with your hands between your thighs'),
        s('Dm'), s('Em'),
      ],
    },
    { label: 'Interlude', steps: dmEm(4) },
    {
      label: 'Verse 3 (fast)',
      steps: [
        s('Dm', 'But I crumble completely when you cry', FAST),
        s('Em', 'it seems like once again', FAST),
        s('Dm', "you've had to greet me with goodbye", FAST),
        s('Em', "I'm always just about to go", FAST),
        s('Dm', 'and spoil the surprise', FAST),
        s('Em', 'take my hands off of your eyes', FAST),
        s('Dm', 'too soon', FAST),
        s('Em', undefined, FAST),
      ],
    },
    {
      label: 'Chorus (fast)',
      steps: [
        s('Dm', "I'm going back to 505", FAST),
        s('Em', "if it's a 7 hour flight", FAST),
        s('Dm', 'or a 45 minute drive', FAST),
        s('Em', 'in my imagination', FAST),
        s('Dm', "you're waiting lying on your side", FAST),
        s('Em', 'with your hands between your thighs', FAST),
        s('Dm', 'and a smile', FAST),
        s('Em', undefined, FAST),
      ],
    },
    { label: 'Solo', steps: dmEm(4, FAST) },
    { label: 'Outro', steps: dmEm(2, FAST) },
  ],
};

export const SONGS: Song[] = [
  wildThing,
  threeLittleBirds,
  badMoonRising,
  knockinHeaven,
  iBelongToYou,
  singEdSheeran,
  fiveOhFive,
];

export function getSong(id: string | undefined): Song | undefined {
  return id ? SONGS.find((song) => song.id === id) : undefined;
}

export function parseStrum(strum: string): StrumDir[] {
  const out: StrumDir[] = [];
  for (const c of strum) out.push(c === 'D' || c === 'U' ? c : '-');
  return out;
}

