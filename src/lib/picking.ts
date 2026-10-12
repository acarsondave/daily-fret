// Alternate picking: what the drill is allowed to claim from one microphone.
//
// The timing analyser hears when a note starts. It does not hear which way the
// pick was moving or at what angle it met the string, so the drill reports
// timing and nothing more, and reports it per half, flat then angled, because
// comparing the two is the exercise (B1-601).

import { summariseTiming, type BeatGrid, type TimingSummary } from './strumTiming';

export type PickHalf = 'flat' | 'angled';

/**
 * The fastest click the drill offers, one pick per click.
 *
 * Above about 150 the analyser's refractory (src/audio/timing.ts) and the next
 * click start to crowd each other, and a drill that marks good picks missing is
 * worse than a slower one. Measured, not chosen: tests/picking.test.mjs holds
 * every string at this tempo.
 */
export const PICK_CEILING_BPM = 140;

export function pickHalves(
  picks: readonly { at: number; half: PickHalf }[],
  grid: BeatGrid,
): Record<PickHalf, TimingSummary> {
  const of = (half: PickHalf) =>
    summariseTiming(picks.filter((p) => p.half === half).map((p) => p.at), grid);
  return { flat: of('flat'), angled: of('angled') };
}
