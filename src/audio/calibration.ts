// Per-guitar chord calibration. Turns real chroma observed while the user holds a
// known chord into discriminative matcher templates, so the detector recognises
// the shapes as they actually sound on this instrument/mic instead of by a
// generic hand-tuned prototype. This is what breaks the A<->D / E<->A "shared
// note lock": when D still rings the open A string, a template learned from real
// D frames (with that residual A) minus what every calibrated chord shares lets
// the distinguishing notes drive the match.
//
// Storage keeps the raw per-chord MEAN chroma plus a sample count, not the fitted
// template, so passive refinement (learning more from normal play) merges by a
// simple sample-weighted average and the discriminative fit is re-derived on load.

import type { LearnedTemplates } from './chords';

export const CHROMA_BINS = 12;

// Minimum clean frames for a chord before its learned template is trusted. Salient
// post-onset frames arrive a handful at a time per strum, so ~24 is roughly one to
// two solid held strums; below it the mean is too noisy and we keep the built-in.
export const MIN_SAMPLES = 24;

// A discriminative fit needs at least two calibrated chords to subtract a shared
// component from; with one chord there is nothing to contrast against.
const MIN_CALIBRATED_CHORDS = 2;

// A learned template this close to the shared mean carries almost no discriminative
// signal (its own magnitude is near zero); fall back to the built-in for that chord
// rather than emit a near-null vector that can never win the cosine.
const MIN_TEMPLATE_MAGNITUDE = 1e-3;

// Default cap on frames backing a chord mean. Keeps a merged calibration from
// letting one marathon session dominate, and bounds passive growth.
export const MAX_SAMPLES_PER_CHORD = 400;

// Raw peak-normalized mean chroma for one chord and how many frames it averages.
export interface ChordSamples {
  mean: number[];
  samples: number;
}

export type CalibrationData = Record<string, ChordSamples>;

// The persisted per-account calibration. Stores raw means (see file header for
// why) plus provenance; `label` carries the guitar name so multiple named
// profiles are a purely additive change later, not a migration.
export interface ChordCalibration {
  version: 1;
  createdAt: number;
  updatedAt: number;
  label?: string;
  chords: CalibrationData;
}

// Matcher templates for a stored calibration, or undefined when there is nothing
// usable yet (so callers pass `undefined` straight through to the detector).
export function templatesFor(cal: ChordCalibration | undefined): LearnedTemplates | undefined {
  if (!cal || !cal.chords) return undefined;
  const templates = fitTemplates(cal.chords);
  return Object.keys(templates).length ? templates : undefined;
}

// Accumulates peak-normalized chroma frames per chord during a capture, as a
// running sum so memory is O(chords) regardless of hold length.
export class CalibrationCollector {
  private readonly sums = new Map<string, Float64Array>();
  private readonly counts = new Map<string, number>();

  // Add one peak-normalized 12-bin chroma frame observed while `chord` was held.
  add(chord: string, chroma: ArrayLike<number>): void {
    if (chroma.length !== CHROMA_BINS) return;
    let sum = this.sums.get(chord);
    if (!sum) {
      sum = new Float64Array(CHROMA_BINS);
      this.sums.set(chord, sum);
    }
    for (let i = 0; i < CHROMA_BINS; i++) sum[i] += chroma[i];
    this.counts.set(chord, (this.counts.get(chord) ?? 0) + 1);
  }

  samples(chord: string): number {
    return this.counts.get(chord) ?? 0;
  }

  // Snapshot the collected chords as means + counts. Only chords with at least one
  // frame appear.
  toData(): CalibrationData {
    const out: CalibrationData = {};
    for (const [chord, sum] of this.sums) {
      const n = this.counts.get(chord) ?? 0;
      if (n === 0) continue;
      const mean = new Array<number>(CHROMA_BINS);
      for (let i = 0; i < CHROMA_BINS; i++) mean[i] = sum[i] / n;
      out[chord] = { mean, samples: n };
    }
    return out;
  }

  reset(): void {
    this.sums.clear();
    this.counts.clear();
  }
}

// Sample-weighted merge of two calibrations, per chord. Used by passive refinement
// to fold a session's high-confidence frames into the stored baseline without a
// single session overwhelming it (counts are capped).
export function mergeCalibration(
  base: CalibrationData,
  extra: CalibrationData,
  cap = MAX_SAMPLES_PER_CHORD,
): CalibrationData {
  const out: CalibrationData = {};
  const chords = new Set([...Object.keys(base), ...Object.keys(extra)]);
  for (const chord of chords) {
    const a = base[chord];
    const b = extra[chord];
    if (a && b) {
      const total = a.samples + b.samples;
      const mean = new Array<number>(CHROMA_BINS);
      for (let i = 0; i < CHROMA_BINS; i++) {
        mean[i] = (a.mean[i] * a.samples + b.mean[i] * b.samples) / total;
      }
      out[chord] = { mean, samples: Math.min(total, cap) };
    } else {
      const only = (a ?? b)!;
      out[chord] = { mean: only.mean.slice(), samples: Math.min(only.samples, cap) };
    }
  }
  return out;
}

function meanCenter(v: number[]): number[] {
  let mean = 0;
  for (let i = 0; i < CHROMA_BINS; i++) mean += v[i];
  mean /= CHROMA_BINS;
  return v.map((x) => x - mean);
}

function magnitude(v: readonly number[]): number {
  let m = 0;
  for (let i = 0; i < CHROMA_BINS; i++) m += v[i] * v[i];
  return Math.sqrt(m);
}

// Build matcher templates from calibration means. For each eligible chord:
//   template = meanCenter(chordMean - grandMean)
// The grand mean (equal-weight over eligible chords) is the component every chord
// shares on this rig; subtracting it removes the notes common to A and D (the
// stuck A), leaving the distinguishing roots/thirds to drive the cosine. Chords
// below MIN_SAMPLES, or whose template is near-null, are omitted so the matcher
// falls back to the built-in for them.
export function fitTemplates(data: CalibrationData): LearnedTemplates {
  const eligible = Object.entries(data).filter(
    ([, c]) => c.samples >= MIN_SAMPLES && Array.isArray(c.mean) && c.mean.length === CHROMA_BINS,
  );
  if (eligible.length < MIN_CALIBRATED_CHORDS) return {};

  const grand = new Array<number>(CHROMA_BINS).fill(0);
  for (const [, c] of eligible) {
    for (let i = 0; i < CHROMA_BINS; i++) grand[i] += c.mean[i];
  }
  for (let i = 0; i < CHROMA_BINS; i++) grand[i] /= eligible.length;

  const out: Record<string, number[]> = {};
  for (const [name, c] of eligible) {
    const disc = new Array<number>(CHROMA_BINS);
    for (let i = 0; i < CHROMA_BINS; i++) disc[i] = c.mean[i] - grand[i];
    const template = meanCenter(disc);
    if (magnitude(template) < MIN_TEMPLATE_MAGNITUDE) continue;
    out[name] = template;
  }
  return out;
}

export interface SeparationPair {
  a: string;
  b: string;
  cosine: number;
}

export interface SeparationReport {
  pairs: SeparationPair[];
  // Least-separated pair (highest cosine). Drives the "these two still look alike"
  // signal on the success screen and the Phase 6 chromagram-extension gate.
  worst: SeparationPair | null;
}

// Pairwise cosine between fitted templates. Lower is better (more distinguishable);
// ~1 means two chords are nearly indistinguishable to the matcher.
export function separationReport(templates: LearnedTemplates): SeparationReport {
  const names = Object.keys(templates);
  const pairs: SeparationPair[] = [];
  let worst: SeparationPair | null = null;
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const va = templates[names[i]];
      const vb = templates[names[j]];
      let dot = 0;
      for (let k = 0; k < CHROMA_BINS; k++) dot += va[k] * vb[k];
      const denom = magnitude(va) * magnitude(vb);
      const cos = denom > 0 ? dot / denom : 0;
      const pair = { a: names[i], b: names[j], cosine: cos };
      pairs.push(pair);
      if (!worst || cos > worst.cosine) worst = pair;
    }
  }
  return { pairs, worst };
}
