// The day's screen, in numbers, and what moved since last time.
//
// The main screen could say what was planned and what was ticked, and nothing at
// all about whether any of it worked. Every measurement the app takes lived
// behind the Progress button, which is a place people go when they already
// believe there is something to see.
//
// Two rules run this file, and both are about not overstating.
//
// A number that has never been measured is not zero. Zero is a measurement, and
// it means the drill ran and nothing was heard. So an unmeasured figure comes
// back as null and the screen reserves its place with an underscore, which says
// "this is where your number will be" rather than "your number is nothing".
//
// The delta is a fact about two specific runs of one specific drill, so it names
// which drill and which day. "You improved" is a compliment; "seven more changes
// a minute on A and D than on Friday" is evidence, and only the second one can
// be checked.
//
// Pure functions over stored days: no React, no store, so they can be run
// against a real exported history without booting the app.

import type { DailyLog } from '../types';
import { PAIR_PREFIX } from './pairs';
import { POOL_PREFIX, describeDrillKey } from './drillKeys';

export interface LedgerDelta {
  /** Signed change against the previous day this drill was measured. */
  change: number;
  /** What was played, in the app's own vocabulary for it. */
  label: string;
  unit: string;
  /** The day it is being compared against, as stored. */
  since: string;
}

export interface Ledger {
  /** Days with at least one measured number. */
  daysMeasured: number;
  /** Best changes a minute, across every pair, ever. Null until one is taken. */
  bestChanges: number | null;
  /** Best shapes placed in one Chord Perfect block. Null until one is taken. */
  bestPlaced: number | null;
  /** The most recent day that produced any number at all. */
  lastMeasured: string | null;
  /**
   * The single biggest move on the latest measured day against that drill's own
   * previous day. Null on a first session, when there is nothing to compare.
   */
  delta: LedgerDelta | null;
}

const EMPTY: Ledger = {
  daysMeasured: 0,
  bestChanges: null,
  bestPlaced: null,
  lastMeasured: null,
  delta: null,
};

/** Days that carry at least one number, oldest first. */
function measuredDays(dailyLogs: Record<string, DailyLog>): DailyLog[] {
  return Object.values(dailyLogs ?? {})
    .filter((log) => {
      const results = log.drillResults;
      if (!results) return false;
      return Object.values(results).some((v) => typeof v === 'number' && v > 0);
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function bestUnder(days: DailyLog[], prefix: string): number | null {
  let best: number | null = null;
  for (const day of days) {
    for (const [key, value] of Object.entries(day.drillResults ?? {})) {
      if (!key.startsWith(prefix)) continue;
      if (typeof value !== 'number' || value <= 0) continue;
      if (best === null || value > best) best = value;
    }
  }
  return best;
}

/**
 * What moved on the latest measured day.
 *
 * Compared per drill key against the most recent earlier day that measured the
 * same key, because those are the only two numbers that mean the same thing. The
 * largest absolute move wins, so a session that went backwards says so rather
 * than hunting the history for something flattering.
 */
function findDelta(days: DailyLog[]): LedgerDelta | null {
  if (days.length < 2) return null;
  const latest = days[days.length - 1];
  const earlier = days.slice(0, -1);
  let best: LedgerDelta | null = null;

  for (const [key, value] of Object.entries(latest.drillResults ?? {})) {
    if (typeof value !== 'number' || value <= 0) continue;
    // The day before, for this drill: not the day before in the diary. A pair
    // practised on Monday and again on Friday moved between Monday and Friday.
    let previous: { value: number; date: string } | null = null;
    for (let i = earlier.length - 1; i >= 0; i--) {
      const was = earlier[i].drillResults?.[key];
      if (typeof was === 'number' && was > 0) {
        previous = { value: was, date: earlier[i].date };
        break;
      }
    }
    if (!previous) continue;
    const change = value - previous.value;
    if (change === 0) continue;
    if (best && Math.abs(change) <= Math.abs(best.change)) continue;
    const described = describeDrillKey(key);
    best = { change, label: described.label, unit: described.unit, since: previous.date };
  }

  return best;
}

export function readLedger(dailyLogs: Record<string, DailyLog>): Ledger {
  const days = measuredDays(dailyLogs);
  if (!days.length) return EMPTY;
  return {
    daysMeasured: days.length,
    bestChanges: bestUnder(days, PAIR_PREFIX),
    bestPlaced: bestUnder(days, POOL_PREFIX),
    lastMeasured: days[days.length - 1].date,
    delta: findDelta(days),
  };
}
