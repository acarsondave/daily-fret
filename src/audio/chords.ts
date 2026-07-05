// Guitar chord matcher. Direct port of the native `chords.rs`: signed 12-bin
// templates matched by mean-centered cosine similarity (Pearson correlation).

const MATCH_SCORE_MIN = 0.5;

type Template = readonly [string, readonly number[]];

const TEMPLATES: Template[] = [
  // Indices: C C# D D# E F F# G G# A A# B
  ['A', [-0.5, 0.9, -0.5, -0.5, 0.8, -0.5, -0.5, -0.5, -0.5, 1.0, -0.5, -0.5]],
  ['Am', [0.9, -0.5, -0.5, -0.5, 0.8, -0.5, -0.5, -0.5, -0.5, 1.0, -0.5, -0.5]],
  ['C', [1.0, -0.5, -0.5, -0.5, 0.9, -0.5, -0.5, 0.8, -0.5, -0.5, -0.5, -0.5]],
  ['D', [-0.5, -0.5, 1.0, -0.5, -0.5, -0.5, 0.9, -0.5, -0.5, 0.8, -0.5, -0.5]],
  ['Dm', [-0.5, -0.5, 1.0, -0.5, -0.5, 0.9, -0.5, -0.5, -0.5, 0.8, -0.5, -0.5]],
  ['E', [-0.5, -0.5, -0.5, -0.5, 1.0, -0.5, -0.5, -0.5, 0.9, -0.5, -0.5, 0.8]],
  ['Em', [-0.5, -0.5, -0.5, -0.5, 1.0, -0.5, -0.5, 0.9, -0.5, -0.5, -0.5, 0.8]],
  ['G', [-0.5, -0.5, 0.8, -0.5, -0.5, -0.5, -0.5, 1.0, -0.5, -0.5, -0.5, 0.9]],
  // F tolerates a ringing high E (0.3) so it doesn't snap to Am.
  ['F', [0.8, -0.5, -0.5, -0.5, 0.3, 1.0, -0.5, -0.5, -0.5, 0.9, -0.5, -0.5]],
];

export interface ChordMatch {
  chord: string;
  confidence: number;
  // Cosine-score gap to the next-best *allowed* candidate. Large = unambiguous.
  // Only meaningful for restricted matches; 1 (max) for unrestricted.
  margin: number;
}

const TEMPLATE_MAP = new Map(TEMPLATES.map((t) => [t[0], t] as const));

// A per-chord learned template overrides the built-in for that name. Calibration
// (src/audio/calibration.ts) produces these from real chroma on the user's own
// guitar, so the matcher discriminates the shapes as they actually sound instead
// of by a generic hand-tuned prototype. Names without an override keep the
// built-in, so a partial calibration is safe.
export type LearnedTemplates = Record<string, readonly number[]>;

// The signed 12-bin template used for `name`: the learned vector when calibrated,
// else the built-in. Returns null for an unknown name with no override.
function templateFor(
  name: string,
  learned: LearnedTemplates | undefined,
): readonly number[] | null {
  const override = learned?.[name];
  if (override && override.length === 12) return override;
  return TEMPLATE_MAP.get(name)?.[1] ?? null;
}

function cosine(a: ArrayLike<number>, b: readonly number[], aMag: number): number {
  let dot = 0;
  let bMag = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    bMag += b[i] * b[i];
  }
  if (aMag <= 0 || bMag <= 0) return -999;
  return dot / (aMag * Math.sqrt(bMag));
}

function shiftAndCenter(chroma: Float32Array, offset: number): Float32Array {
  const shifted = new Float32Array(12);
  for (let i = 0; i < 12; i++) {
    const srcIdx = ((((i + offset) % 12) + 12) % 12);
    shifted[i] = chroma[srcIdx];
  }
  let mean = 0;
  for (let i = 0; i < 12; i++) mean += shifted[i];
  mean /= 12;
  for (let i = 0; i < 12; i++) shifted[i] -= mean;
  return shifted;
}

function bestMatch(
  chroma: Float32Array,
  offset: number,
  learned: LearnedTemplates | undefined,
): { chord: string; score: number } | null {
  const shifted = shiftAndCenter(chroma, offset);
  let chromaMag = 0;
  for (let i = 0; i < 12; i++) chromaMag += shifted[i] * shifted[i];
  const chromaNorm = Math.sqrt(chromaMag);

  let bestScore = -999;
  let bestChord: string | null = null;

  for (const [name] of TEMPLATES) {
    const template = templateFor(name, learned);
    if (!template) continue;
    const score = cosine(shifted, template, chromaNorm);
    if (score > bestScore) {
      bestScore = score;
      bestChord = name;
    }
  }

  return bestChord === null ? null : { chord: bestChord, score: bestScore };
}

/// Match a 12-bin chroma against the guitar templates. `offset` rotates pitch
/// classes for capo/tuning. `learned` overrides built-in templates per chord when
/// the user has calibrated. Returns null when no template clears the threshold.
export function matchChord(
  chroma: Float32Array,
  offset = 0,
  learned?: LearnedTemplates,
): ChordMatch | null {
  const best = bestMatch(chroma, offset, learned);
  if (best === null || best.score < MATCH_SCORE_MIN) return null;
  const confidence = Math.min(1, Math.max(0, (best.score + 1) / 2));
  return { chord: best.chord, confidence, margin: 1 };
}

/// Match a chroma against ONLY the given chord names (e.g. the two targets of a
/// 1-Minute Changes drill). Restricting the candidate set removes the entire
/// class of third-chord misdetections and lets us reason about ambiguity: the
/// returned `margin` is the score gap to the runner-up, so callers can reject
/// flapping mid-transition. Falls back to the full matcher if no names resolve.
export function matchChordAmong(
  chroma: Float32Array,
  allowed: readonly string[],
  offset = 0,
  learned?: LearnedTemplates,
): ChordMatch | null {
  const shifted = shiftAndCenter(chroma, offset);
  let chromaMag = 0;
  for (let i = 0; i < 12; i++) chromaMag += shifted[i] * shifted[i];
  if (chromaMag <= 0) return null;
  const chromaNorm = Math.sqrt(chromaMag);

  let best = -999;
  let second = -999;
  let bestChord: string | null = null;

  for (const name of allowed) {
    const template = templateFor(name, learned);
    if (!template) continue;
    const score = cosine(shifted, template, chromaNorm);
    if (score <= -999) continue;
    if (score > best) {
      second = best;
      best = score;
      bestChord = name;
    } else if (score > second) {
      second = score;
    }
  }

  if (bestChord === null) return matchChord(chroma, offset, learned);
  if (best < MATCH_SCORE_MIN) return null;
  const confidence = Math.min(1, Math.max(0, (best + 1) / 2));
  const margin = second <= -999 ? 1 : best - second;
  return { chord: bestChord, confidence, margin };
}

/// Raw best cosine score, ignoring the threshold. For debugging only.
export function matchChordDebug(
  chroma: Float32Array,
  offset = 0,
  learned?: LearnedTemplates,
): { chord: string; score: number } | null {
  return bestMatch(chroma, offset, learned);
}
