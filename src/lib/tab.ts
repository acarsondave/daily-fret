// Guitar tab parsing. A riff's practice note is authored as plain text, so the
// app has to recognise a tab staff and take it apart before it can be rendered
// as one. Everything here is pure and total: unparseable input falls back to
// being treated as prose, never throws, and never invents a note.
//
// Two layers, and the split matters. `parseTab` finds the staff in the prose and
// hands back the author's own monospace grid, unchanged. `readScore` reads that
// grid as music: which fret sits on which string at which column, where the bars
// are, which of them send the player back, and where the beats fall. The
// renderer draws the second layer and never sees a dash or a pipe.

import { DEFAULT_TUNING_ID, getTuning } from '../audio/tuning';

export interface TabLine {
  /** The string name to the left of the first barline, e.g. "e", "A". */
  label: string;
  /** Everything from the first barline on, including it. */
  content: string;
}

export interface TabBlock {
  /** Any non-staff prose that introduced this block, e.g. "Riff (x2)". */
  caption?: string;
  /**
   * A count line sitting above the staff ("1 + 2 + 3 + 4 +"), already shifted
   * into the staff's own column space. This is NOT a caption: it only means
   * anything while its columns line up with the frets underneath it, so it has
   * to be read in the same column space as the staff rather than as prose.
   */
  timing?: string;
  lines: TabLine[];
}

// A staff line is an optional string name followed by a barline: "e|---", "A |",
// or a bare "|---". The note letter may carry an accidental for a dropped or
// altered tuning ("D#|", "Eb|").
const STAFF_LINE = /^[ \t]*([A-Ga-g][#b]?)?[ \t]*\|(.*)$/;

// A count line is beats and subdivisions only: "1 + 2 + 3 + 4 +", "1 e + a".
// Anything carrying a real word is prose and stays a caption.
const COUNT_LINE = /^[\s0-9+&eaEA.·|-]*[0-9][\s0-9+&eaEA.·|-]*$/;

function isCountLine(raw: string): boolean {
  const bare = raw.replace(/\s/g, '');
  if (bare.length < 3) return false;
  return COUNT_LINE.test(raw);
}

// Prose can easily contain a pipe, so a single one proves nothing. A tab is at
// least two staff lines: one string is a fragment, two is a staff.
export function looksLikeTab(text: string | undefined): boolean {
  if (!text) return false;
  let staffLines = 0;
  for (const raw of text.split('\n')) {
    if (STAFF_LINE.test(raw)) staffLines += 1;
    if (staffLines >= 2) return true;
  }
  return false;
}

// Split into blocks on blank lines, then split each block into its staff lines
// and the caption that introduced them.
export function parseTab(text: string): TabBlock[] {
  const blocks: TabBlock[] = [];

  for (const chunk of text.split(/\n[ \t]*\n/)) {
    const captionParts: string[] = [];
    const lines: TabLine[] = [];
    // Kept raw (not trimmed) because its leading spaces are what put each beat
    // over the right fret.
    let countRaw: string | null = null;
    // Where the barline sits in the source, so a count line authored above
    // "D|--5--" can be shifted into the same column space once the "D" moves
    // out into the staff's own gutter.
    let prefixLen: number | null = null;

    for (const raw of chunk.split('\n')) {
      const match = raw.match(STAFF_LINE);
      if (match) {
        if (prefixLen === null) prefixLen = raw.indexOf('|');
        lines.push({ label: (match[1] ?? '').trim(), content: `|${match[2]}` });
      } else if (countRaw === null && isCountLine(raw)) {
        countRaw = raw.replace(/\s+$/, '');
      } else if (raw.trim()) {
        captionParts.push(raw.trim());
      }
    }

    // A count line only counts as one if there is a staff under it to count.
    let timing: string | undefined;
    if (countRaw !== null) {
      if (lines.length) {
        const shift = prefixLen ?? 0;
        // Only drop the prefix columns when they are blank; a count line that
        // starts hard against the margin is already in the staff's space.
        timing = /^\s*$/.test(countRaw.slice(0, shift))
          ? countRaw.slice(shift)
          : countRaw;
      } else {
        captionParts.unshift(countRaw.trim());
      }
    }

    if (!lines.length && !captionParts.length) continue;

    // Ragged staff lines make the closing barlines land at different columns.
    // Pad with spaces so the staff has a clean right edge; padding with dashes
    // would be adding notes the author did not write.
    const width = lines.reduce((max, l) => Math.max(max, l.content.length), 0);
    for (const line of lines) line.content = line.content.padEnd(width, ' ');

    blocks.push({
      caption: captionParts.length ? captionParts.join(' ') : undefined,
      timing,
      lines,
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// The score: the author's grid, read as music
// ---------------------------------------------------------------------------

/** One fret number, on one string, at one column of the block's grid. */
export interface TabNote {
  /** First grid column the numeral occupies. */
  column: number;
  /** Columns it occupies. "10" is two, and has to break the string over both. */
  width: number;
  /** Index into the block's lines. 0 is the top staff line. */
  line: number;
  /**
   * The fret, as written. Text rather than a number because nothing here does
   * arithmetic on it and "0" is a fret, not a falsy value waiting to bite.
   */
  fret: string;
  /**
   * Written in brackets: "(0)". In authored tab that is a note still ringing
   * from an earlier strike rather than a fresh one, which is why it is drawn as
   * a tie rather than as a note with punctuation round it.
   */
  tied: boolean;
}

/** What the character between two frets on one string asks the hand to do. */
export type TabJoinKind = 'hammer' | 'pull' | 'slide-up' | 'slide-down' | 'bend' | 'vibrato';

export interface TabJoin {
  line: number;
  kind: TabJoinKind;
  /** Column the join leaves from (the end of the left note). */
  from: number;
  /** Column the join arrives at (the start of the right note). */
  to: number;
}

export interface TabBar {
  /** Grid column of the leftmost rule. */
  column: number;
  /** Columns the rule occupies, so "||" is never split down the middle. */
  width: number;
  /** ":|", which sends the player back. */
  repeatEnd: boolean;
  /** "|:", which is where a repeat sends them. */
  repeatStart: boolean;
  /** Two rules rather than one. */
  heavy: boolean;
}

export interface TabBeat {
  /** Grid column the count sits over. */
  column: number;
  /** As written: "1", "+", "e", "a". */
  label: string;
  /** Position in quarter notes from the count row's own beat one. */
  quarter: number;
  /** A numbered beat rather than a subdivision of one. */
  primary: boolean;
}

export interface TabScore {
  caption?: string;
  /** String names as authored, top line first. */
  labels: string[];
  /** Grid width, in columns. */
  columns: number;
  notes: TabNote[];
  joins: TabJoin[];
  bars: TabBar[];
  beats: TabBeat[];
  /** Quarter notes the count row spans, or 0 when there is no count row. */
}

const DIGITS = /\d/;

/**
 * How many staff lines have to carry a pipe at one column before it is a barline.
 *
 * Measured against the lines that have anything at all there, not against the
 * whole staff: `parseTab` pads short lines with spaces, so a closing barline
 * genuinely is missing from the lines the author left short, and demanding all
 * six would lose the bar that closes most real riffs.
 */
function isBarColumn(lines: readonly TabLine[], column: number): boolean {
  let pipes = 0;
  let filled = 0;
  for (const line of lines) {
    const ch = line.content[column];
    if (ch === undefined || ch === ' ') continue;
    filled += 1;
    if (ch === '|') pipes += 1;
  }
  return pipes >= 2 && pipes * 2 >= filled;
}

const JOIN_CHARS: Record<string, TabJoinKind> = {
  h: 'hammer',
  p: 'pull',
  '/': 'slide-up',
  '\\': 'slide-down',
  s: 'slide-up',
  b: 'bend',
  '~': 'vibrato',
};

function readNotes(lines: readonly TabLine[]): { notes: TabNote[]; joins: TabJoin[] } {
  const notes: TabNote[] = [];
  const joins: TabJoin[] = [];

  lines.forEach((line, index) => {
    const content = line.content;
    const mine: TabNote[] = [];
    for (let i = 0; i < content.length; i++) {
      if (!DIGITS.test(content[i])) continue;
      let end = i;
      while (end + 1 < content.length && DIGITS.test(content[end + 1])) end += 1;
      // A bracket on either side, allowing "(0)" and the rarer "( 0 )".
      const before = content.slice(0, i).replace(/[\s-]+$/, '');
      const after = content.slice(end + 1).replace(/^[\s-]+/, '');
      const tied = before.endsWith('(') && after.startsWith(')');
      mine.push({ column: i, width: end - i + 1, line: index, fret: content.slice(i, end + 1), tied });
      i = end;
    }
    notes.push(...mine);

    for (let n = 0; n + 1 < mine.length; n++) {
      const left = mine[n];
      const right = mine[n + 1];
      const between = content.slice(left.column + left.width, right.column);
      // One articulation character, or none. Two of them is a figure this
      // renderer has no drawing for, and guessing which one wins would be
      // inventing a technique the author did not write.
      const found = [...between].filter((ch) => ch in JOIN_CHARS);
      if (found.length !== 1) continue;
      joins.push({
        line: index,
        kind: JOIN_CHARS[found[0]],
        from: left.column + left.width,
        to: right.column,
      });
    }

    // Vibrato is the one mark that can trail a note with nothing after it.
    for (const match of content.matchAll(/~+/g)) {
      const from = match.index;
      const to = from + match[0].length;
      const trailing = mine.some((n) => n.column + n.width === from);
      const followed = mine.some((n) => n.column === to);
      if (trailing && !followed) joins.push({ line: index, kind: 'vibrato', from, to });
    }
  });

  return { notes, joins };
}

function readBars(lines: readonly TabLine[], columns: number): TabBar[] {
  const bars: TabBar[] = [];
  const colonAt = (column: number) => lines.some((l) => l.content[column] === ':');

  for (let c = 0; c < columns; c++) {
    if (!isBarColumn(lines, c)) continue;
    let end = c;
    while (end + 1 < columns && isBarColumn(lines, end + 1)) end += 1;
    bars.push({
      column: c,
      width: end - c + 1,
      repeatEnd: colonAt(c - 1),
      repeatStart: colonAt(end + 1),
      heavy: end > c,
    });
    c = end;
  }
  return bars;
}

// Beats and subdivisions. Digits group so a count in twelve reads "10", "11",
// "12" rather than as five separate beats.
const COUNT_TOKEN = /\d+|[+&eaEA.·]/g;

function readBeats(timing: string | undefined): TabBeat[] {
  if (timing === undefined) return [];

  const raw = [...timing.matchAll(COUNT_TOKEN)].map((m) => ({ column: m.index, label: m[0] }));
  if (!raw.length) return [];

  const primaries: number[] = [];
  raw.forEach((token, i) => {
    if (/^\d+$/.test(token.label)) primaries.push(i);
  });
  // A row of subdivisions with no numbered beat in it is not a count.
  if (!primaries.length) return [];

  const beats: TabBeat[] = raw.map((token, i) => {
    // The last numbered beat at or before this token, or a virtual one just off
    // the front so a count opening on an offbeat still lands in order.
    let group = -1;
    while (group + 1 < primaries.length && primaries[group + 1] <= i) group += 1;
    const start = group >= 0 ? primaries[group] : -1;
    const next = primaries[group + 1] ?? raw.length;
    // Subdivisions share the quarter evenly. "1 + " halves it, "1 e + a"
    // quarters it, and neither needs to be declared anywhere.
    const divisions = next - start;
    return {
      column: token.column,
      label: token.label,
      quarter: group + (i - start) / divisions,
      primary: /^\d+$/.test(token.label),
    };
  });

  return beats;
}

/**
 * The author's grid, read as music.
 *
 * Total, like everything above it: a block with no lines comes back as an empty
 * score rather than as an error, because the caller's fallback for that is
 * already prose.
 */
export function readScore(block: TabBlock): TabScore {
  const columns = block.lines.reduce((max, l) => Math.max(max, l.content.length), 0);
  const { notes, joins } = readNotes(block.lines);
  const bars = readBars(block.lines, columns);
  return {
    caption: block.caption,
    labels: block.lines.map((l) => l.label),
    columns,
    notes,
    joins,
    bars,
    beats: carryCount(readBeats(block.timing), bars),
  };
}

/**
 * A count row written over the first bar only, carried across the rest.
 *
 * Authors write the count once and stop at the first barline, which is what a
 * person does when the count is obviously the same in every bar. The riff then
 * draws with a ruler over its opening and nothing over the rest of itself, and
 * that is exactly what it looks like: unfinished.
 *
 * Carrying it is not inventing a rhythm. A count row is a ruler, the bars it is
 * being carried into are the same width as the one it was measured on, and the
 * grid inside it is uniform. Under those three conditions the continuation is
 * the only thing the row could have said, so the app writes down what the author
 * already meant rather than drawing half a ruler.
 *
 * All three conditions are required, and each of them fails closed. A count
 * already reaching the last bar is left alone. Ragged bars mean the app cannot
 * tell where a bar ends, so nothing is carried. And an author who counts two
 * bars differently has said so explicitly, which is a statement, not an
 * omission.
 */
function carryCount(beats: TabBeat[], bars: TabBar[]): TabBeat[] {
  if (!beats.length || bars.length < 3) return beats;

  const spans: { from: number; to: number }[] = [];
  for (let i = 0; i + 1 < bars.length; i++) {
    const from = bars[i].column + bars[i].width;
    const to = bars[i + 1].column;
    if (to > from) spans.push({ from, to });
  }
  if (spans.length < 2) return beats;

  // Same width everywhere, or the app does not know what one bar is worth.
  const width = spans[0].to - spans[0].from;
  if (!spans.every((s) => s.to - s.from === width)) return beats;

  // Only the opening bar is counted. Anything reaching further is the author
  // speaking about the later bars, and is left exactly as written.
  const first = beats.filter((b) => b.column >= spans[0].from && b.column < spans[0].to);
  if (first.length !== beats.length) return beats;

  const quartersPerBar = Math.round(first.filter((b) => b.primary).length);
  if (quartersPerBar < 1) return beats;

  const carried = [...beats];
  for (let bar = 1; bar < spans.length; bar++) {
    const shift = spans[bar].from - spans[0].from;
    for (const beat of first) {
      carried.push({
        ...beat,
        column: beat.column + shift,
        quarter: beat.quarter + bar * quartersPerBar,
      });
    }
  }
  return carried;
}

// ---------------------------------------------------------------------------
// The timeline: where the beats are, and how precisely the riff says so
// ---------------------------------------------------------------------------

/**
 * How precisely a riff states its own rhythm, which is exactly how precisely a
 * playhead is allowed to move through it.
 *
 * `beat` means a count row placed every beat over its own fret, so a marker can
 * be drawn on the beat. `bar` means only the barlines are known, so the most the
 * app can honestly show is which bar is being played. There is no third value:
 * a riff with neither gets no timeline and no playhead at all, because a marker
 * sweeping to a rhythm nobody wrote is the app inventing music.
 */
export interface TabString {
  /** 1 is the thinnest string. It is what the line's drawn gauge comes from. */
  position: number;
  /** What the gutter prints: the author's own letter wherever they gave one. */
  label: string;
  /** What a screen reader says instead of seeing the line. */
  spoken: string;
}

/**
 * Match the staff's lines to real strings.
 *
 * Top line is the thinnest, which is the one convention every tab in existence
 * agrees on. Labels are matched against standard tuning in order, so a two-line
 * riff labelled "D" and "A" lands on the fourth and fifth strings rather than on
 * the first and second, and both the gauge and the spoken name follow.
 *
 * An unlabelled six-line staff is standard tuning, because a six-line tab staff
 * with no letters is a thing only standard tuning is ever written as. It is only
 * claimed in the drawing: what is spoken stays "string 6", because the drawing
 * is describing the instrument and the words would be describing the author.
 */
export function readStrings(labels: readonly string[]): TabString[] {
  const strings = [...getTuning(DEFAULT_TUNING_ID).strings].sort((a, b) => a.position - b.position);
  const out: TabString[] = [];
  let cursor = 0;

  labels.forEach((label, index) => {
    const wanted = label.trim().toUpperCase();
    const found = wanted
      ? strings.findIndex((s, i) => i >= cursor && s.name.toUpperCase() === wanted)
      : -1;
    if (found >= 0) {
      cursor = found + 1;
      out.push({ position: strings[found].position, label, spoken: strings[found].label });
      return;
    }
    // No usable letter: fall back to the line's own place on the staff, which
    // for a full six-line staff is the string it must be.
    const position = index + 1;
    out.push({ position, label, spoken: label ? `${label} string` : `string ${position}` });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Systems: the staff, broken into lines that fit
// ---------------------------------------------------------------------------

/** A run of grid columns drawn as one line of staff. */
export interface TabSystem {
  from: number;
  /** Exclusive. */
  to: number;
}

/**
 * Break the staff into systems that fit, the way notation has done for
 * centuries, rather than leaving one line to be dragged sideways with the hand
 * that is supposed to be holding the guitar.
 *
 * Breaks land on barlines wherever one is close enough, because a bar split in
 * half across two lines is unreadable. A bar longer than a whole line is cut
 * where it has to be; nothing else can be done with it, and it is better than a
 * scrollbar.
 */
export function readSystems(score: TabScore, maxColumns: number): TabSystem[] {
  const width = Math.max(1, Math.floor(maxColumns));
  if (score.columns <= width) return [{ from: 0, to: score.columns }];

  // Where a line may end. A repeat opening belongs at the head of the next
  // system, not dangling off the end of this one, so it breaks before its rule
  // rather than after it.
  const breaks = score.bars
    .map((bar) => (bar.repeatStart ? bar.column : bar.column + bar.width))
    .filter((column) => column > 0 && column < score.columns);
  breaks.push(score.columns);

  const systems: TabSystem[] = [];
  let from = 0;
  while (from < score.columns) {
    let to = 0;
    for (const candidate of breaks) {
      if (candidate <= from) continue;
      if (candidate - from > width) break;
      to = candidate;
    }
    if (to <= from) to = Math.min(score.columns, from + width);
    systems.push({ from, to });
    from = to;
  }
  return systems;
}
