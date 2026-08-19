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
  countQuarters: number;
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

function readBeats(timing: string | undefined): { beats: TabBeat[]; quarters: number } {
  if (timing === undefined) return { beats: [], quarters: 0 };

  const raw = [...timing.matchAll(COUNT_TOKEN)].map((m) => ({ column: m.index, label: m[0] }));
  if (!raw.length) return { beats: [], quarters: 0 };

  const primaries: number[] = [];
  raw.forEach((token, i) => {
    if (/^\d+$/.test(token.label)) primaries.push(i);
  });
  // A row of subdivisions with no numbered beat in it is not a count.
  if (!primaries.length) return { beats: [], quarters: 0 };

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

  return { beats, quarters: primaries.length };
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
  const { beats, quarters } = readBeats(block.timing);
  return {
    caption: block.caption,
    labels: block.lines.map((l) => l.label),
    columns,
    notes,
    joins,
    bars: readBars(block.lines, columns),
    beats,
    countQuarters: quarters,
  };
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
export type TabPrecision = 'beat' | 'bar';

export interface TabBarSpan {
  /** First and last-plus-one grid column of the bar's contents. */
  from: number;
  to: number;
  fromQuarter: number;
  toQuarter: number;
}

export interface TabTimeline {
  precision: TabPrecision;
  beatsPerBar: number;
  /** Written length, in quarter notes. */
  quarters: number;
  /** Where a close repeat sends the player back to, in quarters. */
  loopFrom: number;
  /** The quarter a close repeat sits on, which is where the loop turns. */
  loopTo: number;
  bars: TabBarSpan[];
  /** Ascending (quarter, column) pairs. Everything between them is linear. */
  anchors: { quarter: number; column: number }[];
}

/**
 * Read the riff's own clock.
 *
 * Null when the riff never says where a beat is: no count row and no interior
 * barline. The caller draws a still staff in that case, which is the whole of
 * what the source supports.
 *
 * `fallbackBeatsPerBar` is used only when there are bars but no count row to
 * measure one against. It is the click's own cycle, so the marker and the sound
 * agree about how long a bar is.
 */
export function readTimeline(score: TabScore, fallbackBeatsPerBar: number): TabTimeline | null {
  const rules = score.bars;
  const spans: { from: number; to: number }[] = [];
  for (let i = 0; i + 1 < rules.length; i++) {
    const from = rules[i].column + rules[i].width;
    const to = rules[i + 1].column;
    if (to > from) spans.push({ from, to });
  }

  const hasBeats = score.beats.length > 0;
  if (!spans.length && !hasBeats) return null;

  // A bar's length comes from the count written inside the first one. Only that
  // bar can be measured directly; every later bar is the same length by
  // definition, which is what a barline means.
  const first = spans[0];
  const inFirst = first
    ? score.beats.filter((b) => b.primary && b.column >= first.from && b.column < first.to).length
    : 0;
  const beatsPerBar = inFirst > 0
    ? inFirst
    : spans.length
      ? Math.max(1, Math.round(fallbackBeatsPerBar))
      : Math.max(1, score.countQuarters);

  const bars: TabBarSpan[] = spans.map((span, i) => ({
    ...span,
    fromQuarter: i * beatsPerBar,
    toQuarter: (i + 1) * beatsPerBar,
  }));

  const quarters = bars.length ? bars.length * beatsPerBar : score.countQuarters;
  if (!(quarters > 0)) return null;

  // Every column the source pins to a moment in time. Bar edges are always
  // known; count-row beats pin the columns inside a bar, wherever they were
  // written. Anything not pinned is filled in linearly, which is how tab is
  // spaced in the first place.
  //
  // Count beats go in first and the sort is stable, so where a beat and a
  // barline claim the same moment the beat wins. It has to: a bar's left edge is
  // the rule itself, and beat one sits a column or two past it where the first
  // fret was actually written.
  const anchors: { quarter: number; column: number }[] = [];
  for (const beat of score.beats) {
    if (beat.quarter < 0 || beat.quarter > quarters) continue;
    anchors.push({ quarter: beat.quarter, column: beat.column });
  }
  if (bars.length) {
    anchors.push({ quarter: 0, column: bars[0].from });
    for (const bar of bars) anchors.push({ quarter: bar.toQuarter, column: bar.to });
  }
  anchors.sort((a, b) => a.quarter - b.quarter);

  // Two anchors can disagree: a count character sitting a column left of the
  // barline it belongs to would send the marker backwards. Keep the first of
  // each quarter and drop anything that would not advance.
  const clean: { quarter: number; column: number }[] = [];
  for (const anchor of anchors) {
    const last = clean[clean.length - 1];
    if (!last) {
      clean.push(anchor);
      continue;
    }
    if (anchor.quarter === last.quarter) continue;
    if (anchor.column < last.column) continue;
    clean.push(anchor);
  }
  // The riff runs to its own right-hand edge even when the last thing pinned to
  // a moment sits short of it, which is what a count row with no closing barline
  // under it leaves behind.
  const furthest = clean[clean.length - 1];
  if (furthest && furthest.quarter < quarters && furthest.column < score.columns) {
    clean.push({ quarter: quarters, column: score.columns });
  }
  if (clean.length < 2) {
    clean.length = 0;
    clean.push({ quarter: 0, column: 0 }, { quarter: quarters, column: score.columns });
  }

  // Where the repeat sends the player. `|:` opens the loop, `:|` turns it. With
  // no repeat written, the whole riff is the loop, which is what practising one
  // for two minutes means anyway.
  //
  // Read off the bars rather than off the column, so the turn lands exactly on a
  // barline. Interpolating a rule's own column against the anchors puts it a
  // fraction of a beat out, and a repeat that returns on the "and" of four is a
  // repeat nobody can play to.
  const closeIndex = rules.findIndex((r) => r.repeatEnd);
  const openIndex = closeIndex >= 0 ? lastIndexBefore(rules, closeIndex, (r) => r.repeatStart) : -1;
  const closingBar = closeIndex >= 0 ? bars.find((b) => b.to === rules[closeIndex].column) : undefined;
  const openingBar = openIndex >= 0
    ? bars.find((b) => b.from === rules[openIndex].column + rules[openIndex].width)
    : undefined;
  const loopTo = closingBar
    ? closingBar.toQuarter
    : closeIndex >= 0
      ? quarterAtColumn(clean, rules[closeIndex].column, quarters)
      : quarters;
  const loopFrom = openingBar
    ? openingBar.fromQuarter
    : openIndex >= 0
      ? quarterAtColumn(clean, rules[openIndex].column + rules[openIndex].width, quarters)
      : 0;

  return {
    precision: hasBeats ? 'beat' : 'bar',
    beatsPerBar,
    quarters,
    loopFrom: loopTo > loopFrom ? loopFrom : 0,
    loopTo: loopTo > loopFrom ? loopTo : quarters,
    bars,
    anchors: clean,
  };
}

function lastIndexBefore<T>(items: readonly T[], before: number, match: (item: T) => boolean): number {
  for (let i = before - 1; i >= 0; i--) if (match(items[i])) return i;
  return -1;
}

function quarterAtColumn(
  anchors: readonly { quarter: number; column: number }[],
  column: number,
  quarters: number,
): number {
  if (column <= anchors[0].column) return anchors[0].quarter;
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (column > b.column) continue;
    const span = b.column - a.column;
    if (span <= 0) return b.quarter;
    return a.quarter + ((column - a.column) / span) * (b.quarter - a.quarter);
  }
  return quarters;
}

/** Grid column the riff has reached at `quarter`. */
export function columnAt(timeline: TabTimeline, quarter: number): number {
  const anchors = timeline.anchors;
  if (quarter <= anchors[0].quarter) return anchors[0].column;
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (quarter > b.quarter) continue;
    const span = b.quarter - a.quarter;
    if (span <= 0) return b.column;
    return a.column + ((quarter - a.quarter) / span) * (b.column - a.column);
  }
  return anchors[anchors.length - 1].column;
}

/**
 * Where the riff is after `elapsed` quarter notes of click.
 *
 * The first pass runs from the top so a lead-in before the repeat is played
 * once, the way it is written; every pass after that turns at the close repeat.
 * That jump is the whole answer to "where does this send me back to", drawn
 * instead of explained.
 */
export function positionAt(timeline: TabTimeline, elapsed: number): number {
  if (elapsed <= 0) return 0;
  if (elapsed < timeline.loopTo) return elapsed;
  const loop = timeline.loopTo - timeline.loopFrom;
  if (!(loop > 0)) return timeline.loopTo;
  return timeline.loopFrom + ((elapsed - timeline.loopTo) % loop);
}

/** Which bar of the riff `quarter` falls in, or -1 when the riff has no bars. */
export function barAt(timeline: TabTimeline, quarter: number): number {
  for (let i = 0; i < timeline.bars.length; i++) {
    if (quarter < timeline.bars[i].toQuarter) return i;
  }
  return timeline.bars.length - 1;
}

/**
 * The notes the riff expects at `quarter`, within half a subdivision either way.
 *
 * Nothing on this surface listens yet, and this is not a judgement about what
 * was played. It is the other half of one: the seam a note detector attaches to
 * when riffs stop being unheard, and the reason the drawn staff already knows
 * what it is asking for at every moment of the click.
 */
export function notesAtQuarter(
  score: TabScore,
  timeline: TabTimeline,
  quarter: number,
  tolerance = 0.25,
): TabNote[] {
  const centre = columnAt(timeline, quarter);
  const early = columnAt(timeline, Math.max(0, quarter - tolerance));
  const late = columnAt(timeline, quarter + tolerance);
  const from = Math.min(early, centre);
  const to = Math.max(late, centre);
  return score.notes.filter((n) => n.column + n.width > from && n.column <= to);
}

// ---------------------------------------------------------------------------
// Strings: which line of the staff is which string on the instrument
// ---------------------------------------------------------------------------

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
