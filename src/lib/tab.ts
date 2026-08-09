// Guitar tab parsing. A riff's practice note is authored as plain text, so the
// app has to recognise a tab staff and take it apart before it can be rendered
// as one. Everything here is pure and total: unparseable input falls back to
// being treated as prose, never throws, and never invents a note.

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
   * to be rendered in the monospace grid rather than as prose.
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
    // out into the pinned gutter.
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

export type TabTokenKind = 'fret' | 'bar' | 'technique' | 'rest';

export interface TabToken {
  kind: TabTokenKind;
  text: string;
}

// Break a staff line into runs so the fret numbers can be the figure and the
// dashes the ground. Multi-digit frets stay one token, or "10" would render as
// a 1 and a 0 and read as two notes.
const TOKEN = /(\d+)|(\|+)|([hpbrsxt/\\~^()<>]+)|([^\d|hpbrsxt/\\~^()<>]+)/gi;

export function tokenizeTabLine(content: string): TabToken[] {
  const tokens: TabToken[] = [];
  for (const m of content.matchAll(TOKEN)) {
    if (m[1] !== undefined) tokens.push({ kind: 'fret', text: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'bar', text: m[2] });
    else if (m[3] !== undefined) tokens.push({ kind: 'technique', text: m[3] });
    else tokens.push({ kind: 'rest', text: m[4] });
  }
  return tokens;
}
