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
): { chord: string; score: number } | null {
  const shifted = shiftAndCenter(chroma, offset);

  let bestScore = -999;
  let bestChord: string | null = null;

  for (const [name, template] of TEMPLATES) {
    let dot = 0;
    let chromaMag = 0;
    let tmplMag = 0;
    for (let i = 0; i < 12; i++) {
      dot += shifted[i] * template[i];
      chromaMag += shifted[i] * shifted[i];
      tmplMag += template[i] * template[i];
    }
    if (chromaMag > 0 && tmplMag > 0) {
      const score = dot / (Math.sqrt(chromaMag) * Math.sqrt(tmplMag));
      if (score > bestScore) {
        bestScore = score;
        bestChord = name;
      }
    }
  }

  return bestChord === null ? null : { chord: bestChord, score: bestScore };
}

/// Match a 12-bin chroma against the guitar templates. `offset` rotates pitch
/// classes for capo/tuning. Returns null when no template clears the threshold.
export function matchChord(chroma: Float32Array, offset = 0): ChordMatch | null {
  const best = bestMatch(chroma, offset);
  if (best === null || best.score < MATCH_SCORE_MIN) return null;
  const confidence = Math.min(1, Math.max(0, (best.score + 1) / 2));
  return { chord: best.chord, confidence };
}

/// Raw best cosine score, ignoring the threshold. For debugging only.
export function matchChordDebug(
  chroma: Float32Array,
  offset = 0,
): { chord: string; score: number } | null {
  return bestMatch(chroma, offset);
}
