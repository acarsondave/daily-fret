// The deck a strum-pattern drill deals from, and what the player's own history
// says about each card in it.
//
// The scoring lives in src/lib/strumPattern.ts and is not repeated here. This is
// the layer between that engine and the app: which patterns are in play, how
// each one stands from the runs already recorded, and the one thing the engine
// deliberately cannot answer on its own, which is whether a run's up strums were
// missed or simply never reached the microphone.

import type { DailyLog } from '../types';
import { runsFor } from '../store/completion';
import { patternKey } from './drillKeys';
import { BUILTIN_PATTERNS } from '../data/strumPatterns';
import {
  MIN_PATTERN_BARS,
  patternStanding,
  type PatternRunRecord,
  type PatternStanding,
  type PatternSummary,
} from './strumPattern';

/**
 * How many rungs of the ladder a deck holds when the task does not say.
 *
 * Four, because "Exploring Strumming" asks for a few patterns kept until each is
 * automatic rather than a collection, and because a deck has to be small enough
 * that every card comes round often enough to be recalled. The ladder's order is
 * the order to learn them in, so the opening rungs are the honest default for a
 * player the app has never seen.
 */
export const DEFAULT_DECK_SIZE = 4;

/** The patterns a drill will deal, config first. */
export function deckOf(patterns: readonly string[] | undefined): string[] {
  const chosen = patterns?.filter((p) => p.trim().length > 0) ?? [];
  if (chosen.length) return [...new Set(chosen)];
  return BUILTIN_PATTERNS.slice(0, DEFAULT_DECK_SIZE).map((p) => p.pattern);
}

/** Bars each dealt pattern is played for. Never fewer than the matcher needs. */
export function barsPerDeal(bars: number | undefined): number {
  return Math.max(MIN_PATTERN_BARS, Math.round(bars ?? MIN_PATTERN_BARS));
}

/**
 * Every recorded run of one pattern at one tempo, oldest first.
 *
 * A run reconstructed from a day that only kept its best comes back with no
 * settling, and `patternStanding` reads that as a pattern that never arrived
 * whole. That is the conservative direction and the only available one: the bar
 * a pattern settled on cannot be recovered from a number, and assuming it
 * settled would hand out "automatic" for practice nobody can see.
 */
export function patternRuns(
  dailyLogs: Record<string, DailyLog>,
  pattern: string,
  bpm: number,
): PatternRunRecord[] {
  const key = patternKey(pattern, bpm);
  const records: PatternRunRecord[] = [];
  for (const date of Object.keys(dailyLogs).sort()) {
    for (const run of runsFor(dailyLogs[date], key)) {
      records.push({ date, score: run.value, settledBar: run.settledBar ?? null });
    }
  }
  return records;
}

export interface DeckCard {
  pattern: string;
  standing: PatternStanding;
  /** Runs behind that standing, so a surface can show progress toward it. */
  runs: number;
}

/** The deck as the player's own history leaves it, in ladder order. */
export function deckCards(
  dailyLogs: Record<string, DailyLog>,
  patterns: readonly string[],
  bpm: number,
): DeckCard[] {
  return patterns.map((pattern) => {
    const runs = patternRuns(dailyLogs, pattern, bpm);
    return { pattern, standing: patternStanding(runs), runs: runs.length };
  });
}

/**
 * The share of bars a slot has to be struck in before the run counts as having
 * played it at all.
 *
 * A quarter, which is one bar in four: below that the slot is not one the
 * microphone caught intermittently, it is a slot nothing arrived in.
 */
const HEARD_FRACTION = 0.25;
/** And the share that counts as a slot the microphone had no trouble with. */
const CLEAN_FRACTION = 0.75;

/**
 * The fewest up strums a pattern needs before their joint absence means anything.
 *
 * Two. The ladder's second rung is `D-D-D-DU`, one up strum on the last slot,
 * and it is there precisely because that is the slot a beginner's arm stops
 * before. Reading that single missing up as "the microphone could not hear it"
 * would throw away the most useful thing the drill finds, so a pattern with one
 * up strum is never given this answer.
 */
const MIN_UPS_FOR_LEVEL_CLAIM = 2;

/**
 * Whether a run's up strums went missing together, which is a level problem
 * rather than a playing one.
 *
 * Up strums stop being detectable somewhere below about two thirds of the level
 * of the downs around them. That figure is measured rather than assumed: the
 * takes in tests/strumPattern.test.mjs put ups at 0.72 of the downs' amplitude
 * through the real analyser and every sounded slot is found in nearly every bar,
 * and at 0.32 the ups go missing while the downs beside them stay clean. The
 * signature of falling under the floor is therefore very specific, and it is the
 * one this asks for: every up slot empty, every down slot struck.
 *
 * It matters because the alternative is a lie. The drill cannot tell a hand that
 * skipped the ups from a hand that played them too softly for the room, and both
 * have the same remedy, so it reports what it can actually stand behind: no up
 * strum reached the microphone. Scoring them as missed would put a number on a
 * measurement that was never taken.
 */
export function upStrumsUnheard(summary: PatternSummary): boolean {
  if (!summary.enough) return false;
  const ups = summary.slots.filter((s) => s.expected === 'U');
  const downs = summary.slots.filter((s) => s.expected === 'D');
  if (ups.length < MIN_UPS_FOR_LEVEL_CLAIM || downs.length === 0) return false;
  const allUpsGone = ups.every((s) => s.bars > 0 && s.struck <= s.bars * HEARD_FRACTION);
  const downsClean = downs.every((s) => s.bars > 0 && s.struck >= s.bars * CLEAN_FRACTION);
  return allUpsGone && downsClean;
}
