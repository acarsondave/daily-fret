import { useMemo } from 'react';
import { useUserData, getTodayString } from '../store';

export interface PairStat {
  taskId: string;
  title: string;
  from: string;
  to: string;
  best: number; // personal best cpm across all days
  today: number | null; // today's best cpm, if practiced today
  series: { date: string; cpm: number }[]; // chronological
}

// Aggregates every one-minute-changes drill task (deduped across routines) with
// its history, for the Progress views. Only tasks that still exist are included.
export function useDrillStats(): PairStat[] {
  const userData = useUserData();
  const today = getTodayString();

  return useMemo(() => {
    const dailyLogs = userData?.dailyLogs ?? {};
    const routines = userData?.routines ?? [];
    const logs = Object.values(dailyLogs);
    const stats: PairStat[] = [];
    const seen = new Set<string>();

    for (const routine of routines) {
      for (const task of routine.tasks) {
        if (task.drill?.kind !== 'one-minute-changes') continue;
        if (seen.has(task.id)) continue;
        seen.add(task.id);

        const series = logs
          .filter((l) => typeof l.drillResults?.[task.id] === 'number')
          .map((l) => ({ date: l.date, cpm: l.drillResults![task.id] }))
          .sort((a, b) => a.date.localeCompare(b.date));

        stats.push({
          taskId: task.id,
          title: task.title,
          from: task.drill.chordFrom ?? '?',
          to: task.drill.chordTo ?? '?',
          best: series.reduce((m, s) => Math.max(m, s.cpm), 0),
          today: dailyLogs[today]?.drillResults?.[task.id] ?? null,
          series,
        });
      }
    }

    return stats;
  }, [userData, today]);
}
