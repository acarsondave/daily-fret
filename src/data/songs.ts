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

/**
 * One slot of arrow art: a down, an up, a percussive slap, or nothing.
 *
 * `X` reads the same way it does in tab and in the pattern matcher: the stroke
 * happens and the strings are dead. It used to fall through to a rest here,
 * which drew the one stroke in Get Lucky that carries the groove as a slot with
 * nothing in it.
 */
import { SIXTEENTHS, type SlotResolution } from '../lib/strumPattern';

export type StrumDir = 'D' | 'U' | 'X' | '-';

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

/**
 * One strumming phrase a song asks the hand to own, in the drill's own alphabet.
 *
 * Separate from {@link Song.strum} because the two answer different questions.
 * `strum` is what to draw in one bar of the chart and may be any number of
 * arrows; this is a phrase the pattern matcher can score, which means whole bars
 * of eighth-note slots and nothing else (src/lib/strumPattern.ts). A song's real
 * strumming is often longer than one of its chart's bars, and a chart cell has
 * no room to say so.
 */
export interface SongStrum {
  /** D, U, X (a percussive slap) and `-` for a slot the arm passes through. */
  pattern: string;
  /**
   * How finely this phrase divides the beat: 2 for eighths, 4 for sixteenths.
   * Absent is eighths, which is what almost every chart is.
   *
   * THIS LINE IS THE READING, AND IT IS MEANT TO BE EASY TO CHANGE. Which grid a
   * song is counted on is a claim about the record, and the only real test of it
   * is the player putting the pattern against the record and hearing whether it
   * sits. Nothing downstream hardcodes an answer: the matcher, the drill, the
   * drawn count and the history key all read the grid off the pattern itself, so
   * changing this number here is the whole of changing the reading.
   */
  slotsPerBeat?: SlotResolution;
  /**
   * What to call it. The song's own title when it has one phrase, which is the
   * usual case; named individually where a song needs more than one, because a
   * deck of two cards both labelled "Get Lucky" tells the player nothing.
   */
  name?: string;
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
  // The strumming this song asks the hand to own, as phrases the drill can
  // score. Absent means the chart's own `strum` is the only thing written down,
  // which is enough to draw and not always enough to practise.
  strumPatterns?: SongStrum[];
  // Fret the capo has to be on for these shapes to match the linked recording.
  //
  // A beginner chart is often written in an easier key than the record: Sing is
  // played open in Em and Am against a record in G sharp minor, and Get Lucky is
  // played in A minor against a record in B minor. Both were true before this
  // field existed and both were recorded only in a code comment, which is a note
  // to whoever reads the file and not to the person holding the guitar. Absent
  // means the chart is in the record's own key.
  capo?: number;
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
  // 103. The databases print about 206 for this record; that is the eighth-note
  // count, and the A-D-E vamp is one chord a bar at half of it.
  bpm: 103,
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
  bpm: 74,
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
  // 90, which is the half-time count of the 179 the databases print. The count
  // that matters here is the one this chart is written in: one chord a bar.
  bpm: 90,
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
  bpm: 140,
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
  bpm: 87,
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
  capo: 4,
  bpm: 120,
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


// --- Get Lucky (Daft Punk) ---
//
// JustinGuitar's Module 5 song list names this one: Am, C, Em and D on a loop
// that never changes, every shape a Module 5 player has, and a first C song that
// spends the whole time jumping from C to a minor chord.
//
// THE KEY, WHICH IS NOT OPTIONAL. The record is in B minor. Am C Em D is the
// beginner transposition a whole tone down, so played against the original it
// clashes on every chord. The owner's own chord sheet states it plainly at the
// top: "Capo: 2nd fret. Key: Bm. The chords without the capo are Bm7, D, F#m7, E."
// On the second fret these shapes sound the record's own chords.
//
// ONE CHORD PER BAR, NOT HALF. Justin's lesson text says half a bar; the sheet
// the owner actually reads notates "| Am | C | Em | D |", one chord to a bar, and
// puts one sung line under each. Where the two disagree, the chart follows the
// page in his hands, because a chart that does not match the sheet beside it is
// a second thing to reconcile rather than a help. Nothing rests on it either
// way: with no anchors this chart is self-paced, so the choice changes what is
// read and not what is timed.
//
// NO ANCHORS. Anchors are tapped in against one specific recording through the
// song editor, and no recording is linked yet. An untimed chart is a working
// play-along; a guessed anchor puts the chart on the wrong chord.
const gl = (chord: string, lyric?: string): SongStepDef => s(chord, lyric);
const glLoop = (times: number): SongStepDef[] => {
  const out: SongStepDef[] = [];
  for (let i = 0; i < times; i += 1) out.push(s('Am'), s('C'), s('Em'), s('D'));
  return out;
};

const getLucky: Song = {
  id: 'get-lucky',
  title: 'Get Lucky',
  artist: 'Daft Punk',
  level: 'Beginner',
  // THE STRUM, AND WHY FOURTEEN SYMBOLS ARE SIXTEEN SLOTS.
  //
  // THE SOURCE. Marty Schwartz's lesson (youtube.com/watch?v=eAIrWJZY9Ck), as
  // the owner wrote it down from the video:
  //
  //   DOWN - UP DOWN(slap) - - UP UP - UP DOWN UP DOWN UP
  //
  // Fourteen symbols. Sixteen is what a bar of sixteenths needs, so either the
  // grid is not sixteenths or two slots went missing on the way from the video
  // to the page. Two things settle it, and neither is padding it out to fit.
  //
  // THE ARM DECIDES WHERE THE STROKES GO. The strumming arm is a pendulum: it is
  // on its way down through every even slot and up through every odd one, so a
  // stroke can only land on a slot facing the way it is already going, and two
  // up strokes can never be adjacent — something has to bring the arm back down
  // between them, even if it does not sound. Lay those fourteen symbols on a
  // continuous grid under that one rule and ask how many rests have to be added
  // for every stroke to face the right way, and the answer is exactly two, in
  // exactly two places, giving exactly sixteen slots:
  //
  //   D - - U X - - U - U - U D U D U
  //
  // One rest after the opening down, so the up that follows it is the "a" of one
  // rather than the "e"; and one between the two ups the transcription writes
  // side by side, which is the down the arm has to pass through to get back up
  // there. No other number of rests fits at all, and no other arrangement of two
  // fits. That exactness is the argument. `tests/songs.test.mjs` re-derives it
  // rather than trusting this comment.
  //
  // THE GRID IS SIXTEENTHS, NOT TWO BARS OF EIGHTHS. Sixteen slots could be one
  // bar of sixteenths or two bars of eighths, and the shape is identical either
  // way; only the tempo it sits at differs, by a factor of two. Sixteenths, for
  // three reasons. The slap lands on beat two under that reading, which is the
  // backbeat and where a funk chuck belongs; under the two-bar reading it lands
  // on beat three, which is nowhere in particular. The record is a sixteenth-note
  // groove at 116 and the chords change once a bar, so one figure per chord is
  // what a loop of Am C Em D actually is. And read as two bars, the two bars
  // hold four strokes and six: not a phrase that varies on the repeat but a
  // groove sawn in half at the wrong place.
  //
  // WHAT THAT COSTS THE DRILL, STATED PLAINLY. The pattern matcher's slot is an
  // eighth note (src/lib/strumPattern.ts), so it reads these sixteen slots as two
  // bars of eighths and grades them against a click counting eighths. The arm
  // movement and every interval between strokes are identical, which is why a
  // sixteenth groove is practised this way anyway. What is not identical is the
  // number on the click, and it goes the opposite way to the obvious guess: a
  // drill slot has to be as short as a sixteenth of the record, so
  //
  //   drill click = twice the song tempo
  //
  // 232 on the drill is Get Lucky at 116. The default practice click of 80 is the
  // same groove at 40, about a third of record speed. The metronome tops out at
  // 240 (src/audio/metronome.ts), so the record's own tempo is reachable, but
  // only just, and nothing on screen currently tells the player any of this.
  // Written down here rather than guessed at twice.
  //
  // THE SLAP. `X` is the percussive slap Marty mentions, and it is its own
  // symbol rather than a `D`, because muting the strings and strumming them are
  // different jobs for the fretting hand and the owner picked this version for
  // exactly that sound. The drill scores it as a stroke that has to arrive in
  // the right slot and claims nothing about whether it was actually muted.
  //
  // WHY `strum` IS STILL ONE BAR. A song's `strum` is the default for one bar of
  // the chart and this chart holds one chord to a bar, so the phrase cannot live
  // here without printing all of it under every chord. It lives in
  // `strumPatterns` below, which is where the drill reads it from; this stays as
  // it was, the first half of the figure, which is what one bar of the chart has
  // room to say.
  strum: 'D--UX--U',
  strumPatterns: [{ pattern: 'D--UX--U-U-UDUDU', slotsPerBeat: SIXTEENTHS }],
  capo: 2,
  bpm: 116,
  chords: ['Am', 'C', 'Em', 'D'],
  sections: [
    { label: 'Intro', steps: glLoop(2) },
    {
      // The verse comes in on a D, ahead of the loop's own Am.
      label: 'Verse 1',
      steps: [
        gl('D'),
        gl('Am', 'Like the legend of the phoenix'),
        gl('C', 'All ends with beginnings'), gl('Em'),
        gl('D', 'What keeps the planet spinning'), gl('Am'),
        gl('C', 'The force from the beginning'), gl('Em'), gl('D'),
      ],
    },
    {
      label: 'Pre-chorus',
      steps: [
        gl('Am', "We've come too far"), gl('C'),
        gl('Em', 'To give up who we are'), gl('D'),
        gl('Am', "So let's raise the bar"), gl('C'),
        gl('Em', 'And our cups to the stars'), gl('D'),
      ],
    },
    {
      label: 'Chorus',
      steps: [
        gl('Am', "She's up all night till the sun"),
        gl('C', "I'm up all night to get some"),
        gl('Em', "She's up all night for good fun"),
        gl('D', "I'm up all night to get lucky"),
        gl('Am', "We're up all night till the sun"),
        gl('C', "We're up all night to get some"),
        gl('Em', "We're up all night for good fun"),
        gl('D', "We're up all night to get lucky"),
        ...glLoop(1),
      ],
    },
    {
      label: 'Verse 2',
      steps: [
        gl('D'),
        gl('Am', 'The present has no ribbon'),
        gl('C', 'Your gift keeps on giving'), gl('Em'),
        gl('D', "What is this I'm feeling?"), gl('Am'),
        gl('C', "If you want to leave, I'm with it"), gl('Em'), gl('D'),
      ],
    },
    {
      label: 'Pre-chorus',
      steps: [
        gl('Am', "We've come too far"), gl('C'),
        gl('Em', 'To give up who we are'), gl('D'),
        gl('Am', "So let's raise the bar"), gl('C'),
        gl('Em', 'And our cups to the stars'), gl('D'),
      ],
    },
    {
      label: 'Chorus',
      steps: [
        gl('Am', "We're up all night to get lucky"),
        gl('C'), gl('Em'), gl('D'),
        gl('Am', "We're up all night to get back together"),
        gl('C'), gl('Em', "We're up all night to get funky"), gl('D'),
        ...glLoop(1),
      ],
    },
    { label: 'Outro', steps: glLoop(3) },
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
  getLucky,
];

export function getSong(id: string | undefined): Song | undefined {
  return id ? SONGS.find((song) => song.id === id) : undefined;
}

export function parseStrum(strum: string): StrumDir[] {
  const out: StrumDir[] = [];
  for (const c of strum) out.push(c === 'D' || c === 'U' || c === 'X' ? c : '-');
  return out;
}

