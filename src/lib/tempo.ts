import type { DailyLog } from '../types';
import { MIN_BPM, MAX_BPM } from '../audio/metronome';

// Tempo coaching. Turns a drill's own history into the tempo the click should
// run at *today*, the way a teacher would: sit on what you have actually played,
// nudge up when you're climbing, and ease off after a bad session or a long gap.
//
// What the click is allowed to ask for, exactly, because a prescription that
// cannot be checked against a rule is just a number:
//
//   - Every branch but one prescribes at or below the best run in the window it
//     reads. It never invents a pace out of an ambition.
//   - The climbing branch is the exception and asks for up to five per cent more
//     than the run just made, and only after a session that improved on the ones
//     before it. A teacher nudges; refusing to ever ask for more than has already
//     been done is a click that can only follow.
//
// This file used to claim speed was "never prescribed above what the player has
// already shown", and it was not true: 28, 29, 30, 31 asks for 32. The claim was
// wrong rather than the behaviour, so the claim is what changed. What did have to
// change is easing: see the regress branch below, which used to ask for more than
// the session it was easing from.
//
// The unit that connects a drill to a tempo is the chord change. A one-minute
// changes drill scoring 30 is one change every two seconds; at four beats per
// change that is a 120 BPM click. So: bpm = changesPerMinute * beatsPerChange.

export type TempoTrend = 'new' | 'first' | 'progress' | 'steady' | 'regress' | 'rust';

export interface TempoPlan {
  bpm: number;
  // Beats between chord changes. The metronome accents this cycle, so the
  // accent always lands exactly where the player is meant to change.
  beatsPerChange: number;
  // The pace this tempo is asking for, or null for a plain timed block where
  // there is no change rate to hit.
  targetChangesPerMin: number | null;
  trend: TempoTrend;
  // One short line explaining the number, shown under the BPM. A prescribed
  // tempo the player cannot interrogate is just an arbitrary number.
  reason: string;
}

// Default click for blocks with no change rate of their own (technique,
// strumming, riffs). Slow enough to play something cleanly the first time.
export const DEFAULT_PRACTICE_BPM = 80;

// Where a click is genuinely useful to play to. Outside this band it is either
// too sparse to lock onto or too dense to hear over the guitar, so the plan
// changes how many beats a chord is held for instead of leaving the band.
const CLICK_MIN = 60;
const CLICK_MAX = 132;
// Longest hold first: given a choice, more beats per change means more time to
// place the shape cleanly, which is what a beginner actually needs.
const BEAT_OPTIONS = [8, 4, 2];

// How recent history maps onto today's target.
// Climbing, so ask for a little more. This is the one factor that can put the
// target above every run in the history, and it is capped at five per cent of a
// baseline that already sits under the latest run, so what it asks for is always
// within a few changes of the session just played.
const PROGRESS_FACTOR = 1.05;
const STEADY_FACTOR = 1.0;
const REGRESS_FACTOR = 0.88; // last session dipped, rebuild it clean
const RUST_FACTOR = 0.85; // long gap, warm back up
const FIRST_FACTOR = 0.9; // only one data point, sit under it

// A session this far below the recent baseline is a real dip, not noise.
const REGRESS_RATIO = 0.85;
// ...and this far above is real improvement rather than a good-day wobble.
const PROGRESS_RATIO = 1.02;
// How long before a drill's history counts as cold. Exported because the
// readiness model in lib/readiness.ts has to expire a held result on exactly
// the same schedule: the click easing off for rust while a mark still called
// the skill current would be the app contradicting itself on one screen.
export const RUST_DAYS = 14;
// How many prior sessions form the baseline the latest one is judged against.
const BASELINE_WINDOW = 3;
// The latest session carries more weight than the ones before it, but not all
// of it, so a single fluke day can't yank the prescription around.
const LATEST_WEIGHT = 0.6;

function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

// Musicians set tempo in round numbers; 2 BPM steps are fine enough to express
// a 5% progression without the readout looking like a sensor value.
function quantize(bpm: number): number {
  return Math.round(bpm / 2) * 2;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// Pick the hold length that puts the click inside the useful band. A slow
// player holds a chord for two bars at a walking click rather than following an
// unusably slow one; a fast player changes every two beats rather than chasing
// a 240 BPM click.
function fitClick(changesPerMin: number): { bpm: number; beatsPerChange: number } {
  let bestBpm = changesPerMin * 4;
  let bestBeats = 4;
  let bestDistance = Infinity;
  for (const beats of BEAT_OPTIONS) {
    const raw = changesPerMin * beats;
    const distance = raw < CLICK_MIN ? CLICK_MIN - raw : raw > CLICK_MAX ? raw - CLICK_MAX : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestBpm = raw;
      bestBeats = beats;
    }
  }
  return { bpm: quantize(clampBpm(bestBpm)), beatsPerChange: bestBeats };
}

function holdLabel(beatsPerChange: number): string {
  if (beatsPerChange >= 8) return 'one chord every two bars';
  if (beatsPerChange <= 2) return 'change every two beats';
  return 'one chord per bar';
}

export interface HistoryPoint {
  date: string;
  value: number;
}

// A drill's results in date order. `durationSec` normalises a raw count into a
// per-minute rate; results are not stored with the duration they were set at,
// so the drill's current length is the best available assumption.
export function drillSeries(
  dailyLogs: Record<string, DailyLog>,
  key: string,
  durationSec: number,
): HistoryPoint[] {
  const scale = durationSec > 0 ? 60 / durationSec : 1;
  return Object.values(dailyLogs ?? {})
    .filter((log) => typeof log.drillResults?.[key] === 'number' && log.drillResults[key] > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((log) => ({ date: log.date, value: log.drillResults![key] * scale }));
}

// The whole coach, in one pure function: recent results in, today's tempo out.
export function planTempo(series: HistoryPoint[], today: string): TempoPlan {
  if (series.length === 0) {
    return {
      bpm: DEFAULT_PRACTICE_BPM,
      beatsPerChange: 4,
      targetChangesPerMin: null,
      trend: 'new',
      reason: 'No history for this yet. Steady 80 to find the groove.',
    };
  }

  const latest = series[series.length - 1];
  const gap = daysBetween(latest.date, today);

  let baseline: number;
  let factor: number;
  let trend: TempoTrend;

  if (gap > RUST_DAYS) {
    baseline = latest.value;
    factor = RUST_FACTOR;
    trend = 'rust';
  } else if (series.length === 1) {
    baseline = latest.value;
    factor = FIRST_FACTOR;
    trend = 'first';
  } else {
    const prior = median(
      series.slice(-1 - BASELINE_WINDOW, -1).map((p) => p.value),
    );
    baseline = LATEST_WEIGHT * latest.value + (1 - LATEST_WEIGHT) * prior;
    if (latest.value < prior * REGRESS_RATIO) {
      // Ease from the run that dipped, not from a baseline weighted toward the
      // good sessions before it. Three runs at 100 and one at 30 put that
      // baseline at 58, so the branch whose whole job is to back off was asking
      // for 51 from a player who had just managed 30, and went on asking for it
      // until the window rolled over. Easing has to mean easing.
      baseline = latest.value;
      factor = REGRESS_FACTOR;
      trend = 'regress';
    } else if (latest.value >= prior * PROGRESS_RATIO) {
      factor = PROGRESS_FACTOR;
      trend = 'progress';
    } else {
      factor = STEADY_FACTOR;
      trend = 'steady';
    }
  }

  const target = Math.max(1, Math.round(baseline * factor));
  const { bpm, beatsPerChange } = fitClick(target);
  const hold = holdLabel(beatsPerChange);

  const reason =
    trend === 'rust'
      ? `${gap} days since your last go. Starting easy at ${target}/min, ${hold}.`
      : trend === 'first'
        ? `Just under your first run, ${target}/min, ${hold}. Clean before fast.`
        : trend === 'regress'
          ? `Last session dipped. Easing to ${target}/min, ${hold}, to rebuild it clean.`
          : trend === 'progress'
            ? `You're climbing. This asks for ${target}/min, ${hold}.`
            : `Holding your recent pace, ${target}/min, ${hold}.`;

  return { bpm, beatsPerChange, targetChangesPerMin: target, trend, reason };
}

// A plain timed block: no change rate to derive from, so either the tempo the
// block prescribes or the standard practice click.
export function fixedTempo(bpm: number | undefined, note?: string): TempoPlan {
  const value = quantize(clampBpm(bpm ?? DEFAULT_PRACTICE_BPM));
  return {
    bpm: value,
    beatsPerChange: 4,
    targetChangesPerMin: null,
    trend: 'new',
    reason: note ?? `Steady ${value} in 4/4. Accent on beat one.`,
  };
}
