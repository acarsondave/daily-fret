// What the practice log says about each rung of the note finder's ladder.
//
// The layer between the drill's own maths (lib/noteFinder.ts, which knows
// nothing about days or storage) and the app's record of what has been played.
// The same job lib/patternDeck.ts does for the strumming deck, and split out for
// the same reason: lib/drillKeys.ts already reads the rung labels, so the module
// that reads keys cannot be the module that keys are read from.

import type { DailyLog } from '../types';
import { runsFor } from '../store/completion';
import { FIND_PREFIX, findKey, ratePerMinute } from './drillKeys';
import { baseKey } from './drillWindow';
import { RUNGS, type FinderRunRecord } from './noteFinder';

/**
 * Every recorded run at one rung, oldest first.
 *
 * Counts come back as a rate, because a run is filed under a key that states the
 * window it was counted over and a ninety-second block is not worth more finds
 * than a sixty-second one. A run recorded before the median find time was kept
 * comes back with none, and `rungStanding` reads that as a run that does not
 * clear: the conservative direction and the only available one, since a time
 * cannot be recovered from a count.
 */
export function rungRuns(
  dailyLogs: Record<string, DailyLog>,
  rungId: string,
): FinderRunRecord[] {
  const base = findKey(rungId);
  const records: FinderRunRecord[] = [];
  for (const date of Object.keys(dailyLogs).sort()) {
    const log = dailyLogs[date];
    // Every window of one rung folds back onto the rung, which is what makes a
    // ninety-second run and a sixty-second run one series rather than two.
    for (const key of Object.keys(log.drillRuns ?? log.drillResults ?? {})) {
      if (!key.startsWith(FIND_PREFIX) || baseKey(key) !== base) continue;
      for (const run of runsFor(log, key)) {
        records.push({
          date,
          findsPerMin: ratePerMinute(key, run.value),
          medianMs: run.findMs ?? null,
        });
      }
    }
  }
  return records;
}

/** The whole ladder's history in one read, which is what the drill is handed. */
export function finderHistory(
  dailyLogs: Record<string, DailyLog>,
): Record<string, FinderRunRecord[]> {
  return Object.fromEntries(RUNGS.map((r) => [r.id, rungRuns(dailyLogs, r.id)]));
}
