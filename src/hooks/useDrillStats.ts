import { useMemo } from 'react';
import { useDrillLogs, getTodayString } from '../store';
import { collectDrillStats, type AllDrillStats } from '../lib/drillStats';

// The React seam over the pure stat functions in lib/drillStats.
//
// Reads through `useDrillLogs`, not the raw days: the routines used to be needed
// here to put a name to a result filed under a task id, and a result whose task
// had been deleted was dropped. Keys name the drill now, so the labels come off
// the key and a number outlives the task that produced it.
export function useDrillStats(): AllDrillStats {
  const dailyLogs = useDrillLogs();
  const today = getTodayString();

  return useMemo(() => collectDrillStats(dailyLogs, today), [dailyLogs, today]);
}
