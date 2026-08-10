import { useMemo } from 'react';
import { useUserData, getTodayString } from '../store';
import { collectDrillStats, type AllDrillStats } from '../lib/drillStats';

// The React seam over the pure stat functions in lib/drillStats.
export function useDrillStats(): AllDrillStats {
  const { dailyLogs, routines } = useUserData();
  const today = getTodayString();

  return useMemo(
    () => collectDrillStats(dailyLogs, routines, today),
    [dailyLogs, routines, today],
  );
}
